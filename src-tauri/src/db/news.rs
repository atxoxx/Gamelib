// the dead-code lint preserves the future-proofed surface.
#![allow(dead_code)]

//! News-feed cache DAO.
//!
//! Stores the most-recent fetch per RSS / Atom source URL. The
//! frontend keep a copy in `localStorage` (`useNewsFeeds.ts`) so
//! reads can stay sync on first paint. With the DB-backed cache
//! in place, future Phases can switch the hook to read via
//! `invoke('news_cache_read')` and treat the localStorage copy as
//! a write-through prefetch.

use rusqlite::params;
use std::time::{SystemTime, UNIX_EPOCH};

use super::pool::Db;

// DAO helpers (`upsert`, `read`, `unix_now`, `DEFAULT_TTL_SEC`) are
// kept on stand-by — the React frontend reads via `useNewsFeeds`'s
// localStorage copy today, and Phase 5 is planned to migrate the
// hook to invoke `news_cache_read` through this DAO. Suppressing
const DEFAULT_TTL_SEC: u64 = 30 * 60; // 30 min — RSS feeds aren't time-critical

pub fn upsert(db: &Db, source_url: &str, payload_json: &str) -> Result<(), String> {
    let conn = db.conn().map_err(|e| format!("news conn: {e}"))?;
    let now = unix_now();
    conn.execute(
        "INSERT INTO news_cache(source_url, payload_json, fetched_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(source_url) DO UPDATE SET
             payload_json = excluded.payload_json,
             fetched_at   = excluded.fetched_at",
        params![source_url, payload_json, now],
    )
    .map_err(|e| format!("news_cache upsert: {e}"))?;
    Ok(())
}

pub fn read(db: &Db, source_url: &str, ttl_seconds: Option<u64>) -> Result<Option<String>, String> {
    let conn = db.conn().map_err(|e| format!("news conn: {e}"))?;
    let ttl = ttl_seconds.unwrap_or(DEFAULT_TTL_SEC);
    let min_ts = unix_now().saturating_sub(ttl);
    let mut stmt = conn
        .prepare("SELECT payload_json, fetched_at FROM news_cache WHERE source_url = ?1")
        .map_err(|e| format!("news_cache read prepare: {e}"))?;
    let mut rows = stmt
        .query(params![source_url])
        .map_err(|e| format!("news_cache read query: {e}"))?;
    if let Some(row) = rows.next().map_err(|e| format!("news_cache row: {e}"))? {
        let payload: String = row.get(0).map_err(|e| format!("news_cache payload: {e}"))?;
        let fetched: u64 = row.get(1).map_err(|e| format!("news_cache fetched: {e}"))?;
        return Ok(if fetched >= min_ts { Some(payload) } else { None });
    }
    Ok(None)
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
