// dead-code lint rather than deleting keeps the API stable.
#![allow(dead_code)]

//! Achievements-cache DAO.
//!
//! Stores the cached per-game `GameAchievementData` blob. Replaces
//! `<app_data_dir>/achievements_cache.json`. One row per `game_id`
//! (the local library id, not the IGDB or Steam id).
//!
//! Errors are mapped to `String` at every `?` site via
//! `.map_err(|e| e.to_string())?` so the public API stays
//! `Result<T, String>` without dragging `rusqlite::Error` out of
//! the module.

use rusqlite::params;

use super::pool::Db;

// DAO functions are part of the public storage-migration API surface —
// callers step in here from Tauri commands or future migration shims
// and some helpers (e.g. `list_all`, `clear`) are intentionally kept on
// stand-by for upcoming cache-invalidation paths. Suppressing the
/// Upsert a game-level achievement payload.
pub fn upsert(
    db: &Db,
    game_id: &str,
    steam_app_id: u32,
    payload_json: &str,
    last_synced: u64,
) -> Result<(), String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO achievements_cache(game_id, steam_app_id, payload_json, last_synced)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(game_id) DO UPDATE SET
             steam_app_id = excluded.steam_app_id,
             payload_json = excluded.payload_json,
             last_synced  = excluded.last_synced",
        params![game_id, steam_app_id, payload_json, last_synced],
    )
    .map_err(|e| format!("achievements upsert: {e}"))?;
    Ok(())
}

/// Read every cached game as `(game_id, steam_app_id, payload_json)`.
pub fn list_all(db: &Db) -> Result<Vec<(String, u32, String)>, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT game_id, steam_app_id, payload_json FROM achievements_cache")
        .map_err(|e| format!("achievements list prepare: {e}"))?;
    // `query_map` requires the closure to return `rusqlite::Result`,
    // so the inner `?` chains `rusqlite::Error` (and we map each
    // row outside the closure).
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, u32>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| format!("achievements list query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("achievements row: {e}"))?);
    }
    Ok(out)
}

/// Drop every cached game (used by `clearCache`).
pub fn clear(db: &Db) -> Result<(), String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM achievements_cache", [])
        .map_err(|e| format!("achievements clear: {e}"))?;
    Ok(())
}

/// Phase-1 batch upsert used by the `save_achievements_cache`
/// command. The frontend ships a `{ games: { <gameId>: <payload> } }`
/// JSON blob; we parse it once and upsert one row per game inside a
/// single transaction so partial rows never appear on disk.
pub fn upsert_many_from_payload(
    db: &Db,
    games: &serde_json::Map<String, serde_json::Value>,
) -> Result<(), String> {
    if games.is_empty() {
        return Ok(());
    }
    let mut conn = db.conn().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO achievements_cache(game_id, steam_app_id, payload_json, last_synced)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(game_id) DO UPDATE SET
                     steam_app_id = excluded.steam_app_id,
                     payload_json = excluded.payload_json,
                     last_synced  = excluded.last_synced",
            )
            .map_err(|e| format!("achievements batch prepare: {e}"))?;
        for (game_id, payload) in games {
            let steam_app_id = payload
                .get("steamAppId")
                .and_then(|v| v.as_u64())
                .map(|n| n as u32)
                .unwrap_or(0);
            let serialized = serde_json::to_string(payload)
                .map_err(|e| format!("serialize achievements: {e}"))?;
            let last_synced = payload
                .get("lastSynced")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            stmt.execute(rusqlite::params![
                game_id,
                steam_app_id,
                serialized,
                last_synced
            ])
            .map_err(|e| format!("achievements batch {game_id}: {e}"))?;
        }
    }
    tx.commit().map_err(|e| format!("achievements batch commit: {e}"))?;
    Ok(())
}

/// Read every cached row and assemble the legacy
/// `{ "games": { "<gameId>": <payload> } }` JSON shape the React
/// frontend's `AchievementContext` already understands.
pub fn read_all_as_payload_json(db: &Db) -> Result<String, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT game_id, steam_app_id, payload_json, last_synced
               FROM achievements_cache
              ORDER BY game_id",
        )
        .map_err(|e| format!("achievements read_all prepare: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, u32>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<i64>>(3)?.map(|n| n as u64),
            ))
        })
        .map_err(|e| format!("achievements read_all query: {e}"))?;
    let mut games = serde_json::Map::new();
    for row in rows {
        let (game_id, steam_app_id, payload, last_synced) =
            row.map_err(|e| format!("row: {e}"))?;
        let mut value: serde_json::Value =
            serde_json::from_str(&payload).unwrap_or(serde_json::Value::Null);
        if let Some(map) = value.as_object_mut() {
            map.insert(
                "steamAppId".to_string(),
                serde_json::Value::Number(steam_app_id.into()),
            );
            if let Some(ts) = last_synced {
                map.insert(
                    "lastSynced".to_string(),
                    serde_json::Value::Number(ts.into()),
                );
            }
        }
        games.insert(game_id, value);
    }
    Ok(serde_json::json!({ "games": games }).to_string())
}
