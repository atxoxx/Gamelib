//! SQLite connection pool.
//!
//! [`Db`] owns an [`r2d2::Pool`] of [`rusqlite::Connection`]s.
//! Every backend command reads from or writes to this pool instead of
//! hitting the filesystem directly (Phase 0's atomic helper is now only
//! used by the legacy JSON files that are still being auto-imported
//! from disk, see [`crate::db::legacy`]).
//!
//! ## Why a pool
//!
//! A single [`rusqlite::Connection`] is **not** thread-safe (`!Sync`).
//! Tauri dispatches every command to a tokio worker, so a single
//! shared connection would require a mutex around every operation.
//! `r2d2` + WAL-mode SQLite gives us concurrent reads with one writer,
//! without a contended mutex on the hot path.
//!
//! ## Why sync calls in async commands
//!
//! [`r2d2_sqlite::SqliteConnectionManager`] is sync — opening a
//! connection and running a query is a synchronous Rust call. We
//! deliberately do **not** wrap these calls in `tokio::task::spawn_blocking`:
//! the underlying SQLite work on a local file is sub-millisecond, and
//! `spawn_blocking` would add thread-pool scheduling overhead that
//! exceeds the actual query time. `tauri-plugin-store` follows the
//! same sync-in-async pattern for the same reason.
//!
//! ## PRAGMAs
//!
//! Set on every connection by the manager's customizer:
//! - `journal_mode = WAL` — concurrent readers + one writer.
//! - `synchronous = NORMAL` — durable with WAL, much fewer fsyncs than FULL.
//! - `foreign_keys = ON` — required for `ON DELETE CASCADE` from
//!   `sources` → `sources_cache` / `downloads`.

use std::path::Path;

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::Connection;

/// Wrapper around the SQLite pool. We pass this through Tauri's
/// `State` container so commands can pull it via
/// `app.state::<Db>()` or accept it directly through a `State`
/// parameter.
#[derive(Clone)]
pub struct Db {
    pool: Pool<SqliteConnectionManager>,
}

impl Db {
    /// Open (and create if missing) gamelib.db under `app_data_dir`,
    /// then set up PRAGMAs via a connection customizer.
    pub fn open(app_data_dir: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(app_data_dir)
            .map_err(|e| format!("create app_data_dir: {e}"))?;
        let db_path = app_data_dir.join("gamelib.db");
        let manager = SqliteConnectionManager::file(&db_path)
            .with_init(init_connection);
        let pool = Pool::builder()
            .max_size(8)
            .build(manager)
            .map_err(|e| format!("build pool: {e}"))?;
        Ok(Self { pool })
    }

    /// Borrow a connection from the pool. Returns the r2d2
    /// `PooledConnection` which auto-returns to the pool on drop.
    pub fn conn(&self) -> Result<r2d2::PooledConnection<SqliteConnectionManager>, String> {
        self.pool.get().map_err(|e| format!("acquire conn: {e}"))
    }
}

/// Per-connection PRAGMA setup. Runs on each new connection issued by
/// the pool (including the very first one). Errors are logged but not
/// returned — `PRAGMA journal_mode=WAL` on the first connection will
/// create the `-wal`/`-shm` sidecar files; a transient failure
/// (e.g. file lock) shouldn't block us from returning a pool entry to
/// the caller (we'd hit the same failure again on retry).
fn init_connection(conn: &mut Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;\n\
         PRAGMA synchronous = NORMAL;\n\
         PRAGMA foreign_keys = ON;\n\
         PRAGMA busy_timeout = 5000;\n\
         PRAGMA wal_autocheckpoint = 1000;\n",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_creates_db_in_tempdir() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        let conn = db.conn().unwrap();
        // `journal_mode` returns the actual mode in the single column.
        let mode: String = conn
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap();
        assert_eq!(mode.to_lowercase(), "wal");
    }

    #[test]
    fn pool_recycles_connections() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        for _ in 0..16 {
            let _conn = db.conn().unwrap();
        }
    }
}
