//! Storefront (IGDB) cache DAO.
//!
//! Two tables:
//! - `store_cache(category, page)` — paginated catalogue snapshots.
//! - `store_detail(slug)` — full per-game detail payloads.
//!
//! The frontend previously kept these behind a top-level
//! `<app_data_dir>/store_cache.json`. We split them into the two
//! tables here so a `category=trending&page=0` refresh updates only
//! one row, not the entire blob.

use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::params;

use super::pool::Db;

const DEFAULT_TTL_SEC: u64 = 6 * 60 * 60; // 6h — matches existing behaviour

/// Upsert a catalog page (compact JSON `payload` for `category` at
/// `page` index).
pub fn upsert_category_page(
    db: &Db,
    category: &str,
    page: u32,
    payload_json: &str,
) -> Result<(), String> {
    let conn = db.conn().map_err(|e| format!("store_cache conn: {e}"))?;
    let now = unix_now();
    conn.execute(
        "INSERT INTO store_cache(category, page, payload_json, fetched_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(category, page) DO UPDATE SET
             payload_json = excluded.payload_json,
             fetched_at   = excluded.fetched_at",
        params![category, page, payload_json, now],
    )
    .map_err(|e| format!("store_cache upsert: {e}"))?;
    Ok(())
}

/// Upsert a per-slug detail payload.
pub fn upsert_detail(db: &Db, slug: &str, payload_json: &str) -> Result<(), String> {
    let conn = db.conn().map_err(|e| format!("store_cache conn: {e}"))?;
    let now = unix_now();
    conn.execute(
        "INSERT INTO store_detail(slug, payload_json, fetched_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(slug) DO UPDATE SET
             payload_json = excluded.payload_json,
             fetched_at   = excluded.fetched_at",
        params![slug, payload_json, now],
    )
    .map_err(|e| format!("store_detail upsert: {e}"))?;
    Ok(())
}

/// Read a category page if it's fresher than `ttl_seconds`. Returns
/// `None` if no row exists or the row is older than the TTL.
pub fn read_category_page(
    db: &Db,
    category: &str,
    page: u32,
    ttl_seconds: Option<u64>,
) -> Result<Option<String>, String> {
    let conn = db.conn().map_err(|e| format!("store_cache conn: {e}"))?;
    let ttl = ttl_seconds.unwrap_or(DEFAULT_TTL_SEC);
    let min_ts = unix_now().saturating_sub(ttl);
    let mut stmt = conn
        .prepare(
            "SELECT payload_json, fetched_at FROM store_cache
              WHERE category = ?1 AND page = ?2",
        )
        .map_err(|e| format!("store_cache read prepare: {e}"))?;
    let mut rows = stmt
        .query(params![category, page])
        .map_err(|e| format!("store_cache read query: {e}"))?;
    if let Some(row) = rows.next().map_err(|e| format!("store_cache row: {e}"))? {
        let payload: String = row.get(0).map_err(|e| format!("store_cache payload: {e}"))?;
        let fetched: u64 = row.get(1).map_err(|e| format!("store_cache fetched: {e}"))?;
        return Ok(if fetched >= min_ts { Some(payload) } else { None });
    }
    Ok(None)
}

/// Read a per-slug detail if fresh.
pub fn read_detail(
    db: &Db,
    slug: &str,
    ttl_seconds: Option<u64>,
) -> Result<Option<String>, String> {
    let conn = db.conn().map_err(|e| format!("store_cache conn: {e}"))?;
    let ttl = ttl_seconds.unwrap_or(DEFAULT_TTL_SEC);
    let min_ts = unix_now().saturating_sub(ttl);
    let mut stmt = conn
        .prepare("SELECT payload_json, fetched_at FROM store_detail WHERE slug = ?1")
        .map_err(|e| format!("store_detail read prepare: {e}"))?;
    let mut rows = stmt
        .query(params![slug])
        .map_err(|e| format!("store_detail read query: {e}"))?;
    if let Some(row) = rows.next().map_err(|e| format!("store_detail row: {e}"))? {
        let payload: String = row.get(0).map_err(|e| format!("store_detail payload: {e}"))?;
        let fetched: u64 = row.get(1).map_err(|e| format!("store_detail fetched: {e}"))?;
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
