//! Generic key/value store.
//!
//! Stores non-sensitive metadata (Steam library-sync timestamps,
//! last Epic login time, etc.) under string keys. Values are
//! compact JSON or plain strings — opaque to the schema.
//!
//! Survives logout / login cycles; the keyring is intentionally
//! reserved for actual credentials, this is for everything *around*
//! them.

use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::params;

use super::pool::Db;

pub fn get(db: &Db, key: &str) -> Result<Option<String>, String> {
    let conn = db.conn().map_err(|e| format!("kv conn: {e}"))?;
    let mut stmt = conn
        .prepare("SELECT v FROM kv_store WHERE k = ?1")
        .map_err(|e| format!("kv get prepare: {e}"))?;
    let mut rows = stmt
        .query(params![key])
        .map_err(|e| format!("kv get query: {e}"))?;
    if let Some(row) = rows.next().map_err(|e| format!("kv get row: {e}"))? {
        let v: String = row.get(0).map_err(|e| format!("kv get col: {e}"))?;
        return Ok(Some(v));
    }
    Ok(None)
}

pub fn set(db: &Db, key: &str, value: &str) -> Result<(), String> {
    let conn = db.conn().map_err(|e| format!("kv conn: {e}"))?;
    conn.execute(
        "INSERT INTO kv_store(k, v, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(k) DO UPDATE SET
             v = excluded.v,
             updated_at = excluded.updated_at",
        params![key, value, unix_now()],
    )
    .map_err(|e| format!("kv set: {e}"))?;
    Ok(())
}

pub fn delete(db: &Db, key: &str) -> Result<(), String> {
    let conn = db.conn().map_err(|e| format!("kv conn: {e}"))?;
    conn.execute("DELETE FROM kv_store WHERE k = ?1", params![key])
        .map_err(|e| format!("kv delete: {e}"))?;
    Ok(())
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
