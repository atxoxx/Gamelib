// upcoming `ActivityPage` history drill-down invocation paths.
#![allow(dead_code)]

//! Sessions DAO.
//!
//! One row per game-session. Today the React frontend keeps the
//! canonical copy of the session history in `localStorage`
//! (`gamelib-sessions`). With Phase 3 the backend writes one row per
//! `game-exited` event. Phase 5 (deferred) will switch the
//! frontend to read from this table instead.
//!
//! Why write the row even though the frontend keeps its own copy?
//! - Single source of truth for the backend integrations (Settings
//!   page activity stats, future history exports).
//! - Crash-safe (atomic SQL inserts; no half-written JSON).

use rusqlite::params;

use super::pool::Db;

// DAO helpers (`list_for_game`, `count_all`) are part of the
// future Phase-5 frontend migration off localStorage session
// history. Module-level allow preserves the API surface for the
/// Insert one finished-session row.
///
/// `metrics_json` carries the serialised `SessionMetrics` payload
/// (`None` ⇒ the row's NULL-safe columns stay 0 — older snapshots
/// may not have a metrics blob yet). All averages default to 0 if
/// the watcher reports `None` for the field.
pub fn insert(
    db: &Db,
    game_id: &str,
    game_name: &str,
    started_at_ms: u64,
    ended_at_ms: u64,
    elapsed_seconds: u64,
    avg_fps: Option<f32>,
    avg_cpu: Option<f32>,
    avg_gpu: Option<f32>,
    avg_ram: Option<f32>,
    metrics_json: Option<&str>,
) -> Result<i64, String> {
    let conn = db.conn().map_err(|e| format!("sessions conn: {e}"))?;
    conn.execute(
        "INSERT INTO sessions(
            game_id, game_name, started_at, ended_at, elapsed_seconds,
            avg_fps, avg_cpu, avg_gpu, avg_ram, metrics_json
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            game_id,
            game_name,
            started_at_ms as i64,
            ended_at_ms as i64,
            elapsed_seconds as i64,
            avg_fps.map(|n| n as f64),
            avg_cpu.map(|n| n as f64),
            avg_gpu.map(|n| n as f64),
            avg_ram.map(|n| n as f64),
            metrics_json,
        ],
    )
    .map_err(|e| format!("sessions insert: {e}"))?;
    Ok(conn.last_insert_rowid())
}

/// Return the most-recent N sessions across all games (newest
/// first).
pub fn list_recent(db: &Db, limit: u32) -> Result<Vec<SessionRecord>, String> {
    let conn = db.conn().map_err(|e| format!("sessions conn: {e}"))?;
    let mut stmt = conn
        .prepare(
            "SELECT id, game_id, started_at, ended_at, elapsed_seconds,
                    avg_fps, avg_cpu, avg_gpu, avg_ram, metrics_json, game_name
                FROM sessions
               ORDER BY started_at DESC
               LIMIT ?1",
        )
        .map_err(|e| format!("sessions list prepare: {e}"))?;
    let rows = stmt
        .query_map(params![limit as i64], |r| {
            Ok(SessionRecord {
                id: r.get::<_, i64>(0)?,
                game_id: r.get(1)?,
                started_at_ms: r.get::<_, i64>(2)? as u64,
                ended_at_ms: r.get::<_, Option<i64>>(3)?.map(|n| n as u64),
                elapsed_seconds: r.get::<_, Option<i64>>(4)?.map(|n| n as u64),
                avg_fps: r.get::<_, Option<f64>>(5)?.map(|f| f as f32),
                avg_cpu: r.get::<_, Option<f64>>(6)?.map(|f| f as f32),
                avg_gpu: r.get::<_, Option<f64>>(7)?.map(|f| f as f32),
                avg_ram: r.get::<_, Option<f64>>(8)?.map(|f| f as f32),
                metrics_json: r.get(9)?,
                game_name: r.get(10)?,
            })
        })
        .map_err(|e| format!("sessions list query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("sessions row: {e}"))?);
    }
    Ok(out)
}

/// Return every session for a single game.
pub fn list_for_game(db: &Db, game_id: &str) -> Result<Vec<SessionRecord>, String> {
    let conn = db.conn().map_err(|e| format!("sessions conn: {e}"))?;
    let mut stmt = conn
        .prepare(
            "SELECT id, game_id, started_at, ended_at, elapsed_seconds,
                    avg_fps, avg_cpu, avg_gpu, avg_ram, metrics_json, game_name
                FROM sessions
               WHERE game_id = ?1
               ORDER BY started_at DESC",
        )
        .map_err(|e| format!("sessions list_for_game prepare: {e}"))?;
    let rows = stmt
        .query_map(params![game_id], |r| {
            Ok(SessionRecord {
                id: r.get::<_, i64>(0)?,
                game_id: r.get(1)?,
                started_at_ms: r.get::<_, i64>(2)? as u64,
                ended_at_ms: r.get::<_, Option<i64>>(3)?.map(|n| n as u64),
                elapsed_seconds: r.get::<_, Option<i64>>(4)?.map(|n| n as u64),
                avg_fps: r.get::<_, Option<f64>>(5)?.map(|f| f as f32),
                avg_cpu: r.get::<_, Option<f64>>(6)?.map(|f| f as f32),
                avg_gpu: r.get::<_, Option<f64>>(7)?.map(|f| f as f32),
                avg_ram: r.get::<_, Option<f64>>(8)?.map(|f| f as f32),
                metrics_json: r.get(9)?,
                game_name: r.get(10)?,
            })
        })
        .map_err(|e| format!("sessions list_for_game query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("sessions row: {e}"))?);
    }
    Ok(out)
}

/// Library-wide session count (for the home dashboard).
pub fn count_all(db: &Db) -> Result<u64, String> {
    let conn = db.conn().map_err(|e| format!("sessions conn: {e}"))?;
    let n: i64 = conn
        .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
        .map_err(|e| format!("sessions count: {e}"))?;
    Ok(n.max(0) as u64)
}

/// Return every session across all games (newest first). Used by the
/// frontend Activity dashboard, which keeps the full history in memory
/// for aggregation. Pagination is unnecessary here — the dataset is
/// bounded by real playtime and SQLite returns it in well under a ms.
pub fn list_all(db: &Db) -> Result<Vec<SessionRecord>, String> {
    let conn = db.conn().map_err(|e| format!("sessions conn: {e}"))?;
    let mut stmt = conn
        .prepare(
            "SELECT id, game_id, started_at, ended_at, elapsed_seconds,
                    avg_fps, avg_cpu, avg_gpu, avg_ram, metrics_json, game_name
                FROM sessions
               ORDER BY started_at DESC",
        )
        .map_err(|e| format!("sessions list_all prepare: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(SessionRecord {
                id: r.get::<_, i64>(0)?,
                game_id: r.get(1)?,
                started_at_ms: r.get::<_, i64>(2)? as u64,
                ended_at_ms: r.get::<_, Option<i64>>(3)?.map(|n| n as u64),
                elapsed_seconds: r.get::<_, Option<i64>>(4)?.map(|n| n as u64),
                avg_fps: r.get::<_, Option<f64>>(5)?.map(|f| f as f32),
                avg_cpu: r.get::<_, Option<f64>>(6)?.map(|f| f as f32),
                avg_gpu: r.get::<_, Option<f64>>(7)?.map(|f| f as f32),
                avg_ram: r.get::<_, Option<f64>>(8)?.map(|f| f as f32),
                metrics_json: r.get(9)?,
                game_name: r.get(10)?,
            })
        })
        .map_err(|e| format!("sessions list_all query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("sessions row: {e}"))?);
    }
    Ok(out)
}

/// Delete a single session row by its primary key. Returns the number
/// of rows removed (0 if the id didn't exist).
pub fn delete(db: &Db, id: i64) -> Result<u64, String> {
    let conn = db.conn().map_err(|e| format!("sessions conn: {e}"))?;
    let n = conn
        .execute("DELETE FROM sessions WHERE id = ?1", params![id])
        .map_err(|e| format!("sessions delete: {e}"))?;
    Ok(n as u64)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SessionRecord {
    pub id: i64,
    #[serde(rename = "gameId")]
    pub game_id: String,
    #[serde(rename = "gameName", skip_serializing_if = "Option::is_none")]
    pub game_name: Option<String>,
    #[serde(rename = "startedAt")]
    pub started_at_ms: u64,
    #[serde(rename = "endedAt", skip_serializing_if = "Option::is_none")]
    pub ended_at_ms: Option<u64>,
    #[serde(rename = "elapsedSeconds", skip_serializing_if = "Option::is_none")]
    pub elapsed_seconds: Option<u64>,
    #[serde(rename = "avgFps", skip_serializing_if = "Option::is_none")]
    pub avg_fps: Option<f32>,
    #[serde(rename = "avgCpu", skip_serializing_if = "Option::is_none")]
    pub avg_cpu: Option<f32>,
    #[serde(rename = "avgGpu", skip_serializing_if = "Option::is_none")]
    pub avg_gpu: Option<f32>,
    #[serde(rename = "avgRam", skip_serializing_if = "Option::is_none")]
    pub avg_ram: Option<f32>,
    #[serde(rename = "metricsJson", skip_serializing_if = "Option::is_none")]
    pub metrics_json: Option<String>,
}
