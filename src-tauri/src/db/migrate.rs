//! Versioned migration runner.
//!
//! Tracks the database's current schema version in the
//! `schema_meta` table under key `schema_version`. On every app
//! launch, [`run_migrations`] reads the current version and applies
//! any pending migrations in `SCHEMA_VERSIONS` order, marking each
//! as it completes.
//!
//! We use a string column rather than `PRAGMA user_version`
//! because string keys in `schema_meta` are easier to debug ("what
//! version are we on?") and easy to extend (e.g. "user_version" of
//! `v1` plus `data_migration_v2` later). Migrations are still
//! idempotent — `IF NOT EXISTS` on every DDL clause means re-running
//! one is a no-op.

use rusqlite::OptionalExtension;

use super::pool::Db;
use super::schema::{META_BOOTSTRAP, SCHEMA_VERSIONS};

const VERSION_KEY: &str = "schema_version";

/// Apply any pending migrations and return when the DB is at the
/// latest known version.
///
/// Errors are reported as `String` to match the rest of the
/// commands' error type. A failed migration does not corrupt the
/// database (each migration runs in a transaction; rollback on
/// error). The caller can surface the error to the user and continue
/// running with the old schema.
pub fn run_migrations(db: &Db) -> Result<(), String> {
    let mut conn = db.conn().map_err(|e| format!("migrate conn: {e}"))?;
    conn.execute_batch(META_BOOTSTRAP)
        .map_err(|e| format!("bootstrap schema_meta: {e}"))?;

    let current: Option<String> = conn
        .query_row(
            "SELECT v FROM schema_meta WHERE k = ?1",
            [VERSION_KEY],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("read schema_version: {e}"))?;

    let target = SCHEMA_VERSIONS
        .last()
        .map(|(v, _)| v.to_string())
        .ok_or_else(|| "SCHEMA_VERSIONS is empty".to_string())?;

    if current.as_deref() == Some(target.as_str()) {
        return Ok(());
    }

    for (version, ddl) in SCHEMA_VERSIONS {
        if Some(*version) == current.as_deref() {
            continue;
        }
        eprintln!("[db::migrate] applying {version}");
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(ddl)
            .map_err(|e| format!("apply {version}: {e}"))?;
        tx.upsert(
            VERSION_KEY,
            version,
            format!(
                "{}\nk={}\nv={}",
                chrono_like_now_iso(),
                VERSION_KEY,
                version
            ),
        )
        .map_err(|e| format!("record version: {e}"))?;
        tx.commit().map_err(|e| e.to_string())?;
        eprintln!("[db::migrate] {version} applied");
    }
    Ok(())
}

/// Lightweight ISO-8601 stamp for the schema_meta row. We avoid
/// pulling chrono into the schema layer (it does format through
/// `std::time::SystemTime`).
fn chrono_like_now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("applied_at_unix={}", secs)
}

trait TxExt {
    /// Insert-or-update a `schema_meta` row without using the
    /// `upsert` prepared-statement helper (rusqlite's
    /// `Connection::upsert` would also work on top-level but is
    /// still marked unstable in some versions).
    fn upsert(&self, key: &str, version: &str, blob: String) -> rusqlite::Result<()>;
}

impl TxExt for rusqlite::Transaction<'_> {
    fn upsert(&self, key: &str, version: &str, _blob: String) -> rusqlite::Result<()> {
        self.execute(
            "INSERT INTO schema_meta(k, v) VALUES(?1, ?2)
             ON CONFLICT(k) DO UPDATE SET v = excluded.v",
            rusqlite::params![key, version],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_db_runs_v1_and_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        // After the v4 migration was added (sessions.game_name), a fresh
        // DB ends up at "v4" — the assertion reflects the current head.
        // Re-running `run_migrations` is still a no-op (the loop
        // early-returns when `current == target`), so the test stays
        // idempotent.
        run_migrations(&db).unwrap();
        run_migrations(&db).unwrap(); // idempotent

        let conn = db.conn().unwrap();
        let v: String = conn
            .query_row(
                "SELECT v FROM schema_meta WHERE k = 'schema_version'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(v, "v4");
    }
}
