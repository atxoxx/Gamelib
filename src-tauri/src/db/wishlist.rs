// the public API surface until that path lands.
#![allow(dead_code)]

//! Wishlist DAO.
//!
//! Stores one row per wishlisted Steam / IGDB-keyed game, keyed by
//! its `slug` (which is unique per IGDB title). Mirrors today's
//! `<app_data_dir>/wishlist_cache.json` shape — the React frontend
//! keeps using the same shape on its side (see
//! `src/hooks/useWishlist.ts`) so no Tauri command signature changes
//! are needed; commands now read/write through this DAO instead of
//! touching the JSON file directly.
//!
//! Concurrency: every method takes `&Db` and borrows a connection
//! from the pool. Calls are sync (SQLite on WAL is sub-ms).

use rusqlite::params;

use super::pool::Db;

// DAO helpers (`remove`) are part of the planned WishlistContext
// "delete from card" drag-out path. Module-level allow preserves
/// Compact-JSON entry payload (a serialised `StoreGameSummary` plus
/// the `addedAt` timestamp).
pub type WishlistEntryJson = String;

/// Upsert a wishlisted game. `added_at` is unix milliseconds to match
/// the frontend's existing key (`Date.now()`).
pub fn upsert(db: &Db, slug: &str, payload_json: &str, added_at: u64) -> Result<(), String> {
    let conn = db.conn().map_err(|e| format!("wishlist conn: {e}"))?;
    conn.execute(
        "INSERT INTO wishlist(slug, payload_json, added_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(slug) DO UPDATE SET
             payload_json = excluded.payload_json,
             added_at     = excluded.added_at",
        params![slug, payload_json, added_at],
    )
    .map_err(|e| format!("wishlist upsert: {e}"))?;
    Ok(())
}

/// Delete a wishlisted game by slug. Idempotent: returns Ok even if
/// the row never existed.
pub fn remove(db: &Db, slug: &str) -> Result<(), String> {
    let conn = db.conn().map_err(|e| format!("wishlist conn: {e}"))?;
    conn.execute("DELETE FROM wishlist WHERE slug = ?1", params![slug])
        .map_err(|e| format!("wishlist remove: {e}"))?;
    Ok(())
}

/// Return every wishlisted entry sorted by added_at desc.
pub fn list(db: &Db) -> Result<Vec<(String, WishlistEntryJson, u64)>, String> {
    let conn = db.conn().map_err(|e| format!("wishlist conn: {e}"))?;
    let mut stmt = conn
        .prepare("SELECT slug, payload_json, added_at FROM wishlist ORDER BY added_at DESC")
        .map_err(|e| format!("wishlist list prepare: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, u64>(2)?,
            ))
        })
        .map_err(|e| format!("wishlist list query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("wishlist row: {e}"))?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_list_remove_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        super::super::migrate::run_migrations(&db).unwrap();

        upsert(&db, "elden-ring", r#"{"slug":"elden-ring"}"#, 1).unwrap();
        upsert(&db, "doom-eternal", r#"{"slug":"doom-eternal"}"#, 2).unwrap();
        let rows = list(&db).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].0, "doom-eternal"); // newer first

        upsert(&db, "doom-eternal", r#"{"slug":"doom-eternal","updated":true}"#, 99)
            .unwrap();
        let rows = list(&db).unwrap();
        assert_eq!(rows.iter().find(|r| r.0 == "doom-eternal").unwrap().1,
                   r#"{"slug":"doom-eternal","updated":true}"#);

        remove(&db, "elden-ring").unwrap();
        assert_eq!(list(&db).unwrap().len(), 1);
        // idempotent
        remove(&db, "elden-ring").unwrap();
    }
}
