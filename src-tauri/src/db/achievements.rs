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

/// Read a single cached game as `(steam_app_id, payload_json, last_synced)`.
/// Returns `None` when the game has no cached achievement row yet.
pub fn get(db: &Db, game_id: &str) -> Result<Option<(u32, String, Option<u64>)>, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT steam_app_id, payload_json, last_synced
               FROM achievements_cache WHERE game_id = ?1",
        )
        .map_err(|e| format!("achievements get prepare: {e}"))?;
    let mut rows = stmt
        .query(params![game_id])
        .map_err(|e| format!("achievements get query: {e}"))?;
    if let Some(r) = rows.next().map_err(|e| format!("achievements get row: {e}"))? {
        let steam_app_id: u32 = r.get(0).map_err(|e| format!("achievements get c0: {e}"))?;
        let payload: String = r.get(1).map_err(|e| format!("achievements get c1: {e}"))?;
        let last_synced: Option<i64> =
            r.get(2).map_err(|e| format!("achievements get c2: {e}"))?;
        return Ok(Some((steam_app_id, payload, last_synced.map(|n| n as u64))));
    }
    Ok(None)
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
            // Union incoming `achieved` state with any already-persisted
            // unlocks so a whole-cache save (e.g. a Steam re-sync) can
            // never relock an achievement the local crack watcher
            // unlocked (or vice-versa). Achievements are monotonic —
            // once unlocked, always unlocked.
            let mut payload = payload.clone();
            if let Ok(existing) = read_payload_row(&tx, game_id) {
                if let Some(existing) = existing {
                    union_achieved_into(&mut payload, &existing);
                }
            }
            let serialized = serde_json::to_string(&payload)
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

/// Read the persisted payload JSON for one game inside a transaction.
fn read_payload_row(
    tx: &rusqlite::Transaction,
    game_id: &str,
) -> Result<Option<serde_json::Value>, String> {
    let mut stmt = tx
        .prepare("SELECT payload_json FROM achievements_cache WHERE game_id = ?1")
        .map_err(|e| format!("achievements read_payload prepare: {e}"))?;
    let mut rows = stmt
        .query(params![game_id])
        .map_err(|e| format!("achievements read_payload query: {e}"))?;
    if let Some(r) = rows
        .next()
        .map_err(|e| format!("achievements read_payload row: {e}"))?
    {
        let payload: String = r
            .get(0)
            .map_err(|e| format!("achievements read_payload col: {e}"))?;
        let value = serde_json::from_str(&payload)
            .map_err(|e| format!("achievements read_payload parse: {e}"))?;
        return Ok(Some(value));
    }
    Ok(None)
}

/// Merge already-unlocked achievements from `existing` into `incoming`,
/// keeping `incoming`'s schema/metadata but never relocking. Recomputes
/// the `unlocked`/`locked`/`total` counters afterward.
fn union_achieved_into(incoming: &mut serde_json::Value, existing: &serde_json::Value) {
    let existing_unlocked: std::collections::HashMap<String, u64> = existing
        .get("achievements")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter(|a| a.get("achieved").and_then(|v| v.as_bool()).unwrap_or(false))
                .filter_map(|a| {
                    let name = a.get("apiName").and_then(|v| v.as_str())?.to_uppercase();
                    let ut = a.get("unlockTime").and_then(|v| v.as_u64()).unwrap_or(0);
                    Some((name, ut))
                })
                .collect()
        })
        .unwrap_or_default();

    if existing_unlocked.is_empty() {
        return;
    }

    let Some(arr) = incoming
        .get_mut("achievements")
        .and_then(|v| v.as_array_mut())
    else {
        return;
    };

    let mut unlocked_count: u64 = 0;
    for a in arr.iter_mut() {
        let name = a
            .get("apiName")
            .and_then(|v| v.as_str())
            .map(|s| s.to_uppercase())
            .unwrap_or_default();
        let already = a.get("achieved").and_then(|v| v.as_bool()).unwrap_or(false);
        if let Some(&ut) = existing_unlocked.get(&name) {
            if let Some(obj) = a.as_object_mut() {
                obj.insert("achieved".into(), serde_json::Value::Bool(true));
                let cur = obj
                    .get("unlockTime")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                if cur == 0 && ut > 0 {
                    obj.insert("unlockTime".into(), serde_json::Value::Number(ut.into()));
                }
            }
        }
        if a.get("achieved").and_then(|v| v.as_bool()).unwrap_or(already) {
            unlocked_count += 1;
        }
    }

    let total = arr.len() as u64;
    if let Some(obj) = incoming.as_object_mut() {
        obj.insert("unlocked".into(), serde_json::Value::Number(unlocked_count.into()));
        obj.insert(
            "locked".into(),
            serde_json::Value::Number((total - unlocked_count).into()),
        );
        obj.insert("total".into(), serde_json::Value::Number(total.into()));
    }
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
