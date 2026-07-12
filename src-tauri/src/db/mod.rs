//! Persistent storage layer.
//!
//! Phase 1–4 of the storage migration moves every JSON file in
//! `<app_data_dir>` and the bulk of the frontend `localStorage`
//! payloads into one SQLite database (`gamelib.db`) under that same
//! directory. Sensitive credentials (Steam / Epic OAuth, debrid API
//! keys) move into the OS keychain via [`crate::db::secrets`].
//!
//! ## Module map
//!
//! - [`atomic`] — Phase-0 crash-safe write helper for the legacy
//!   JSON files that haven't been migrated yet.
//! - [`pool`] — r2d2 + WAL-mode SQLite connection pool.
//! - [`schema`] — embedded SQL DDL + version registry.
//! - [`migrate`] — versioned migration runner, called once at
//!   startup after [`Db::open`].
//! - [`legacy`] — auto-importer that reads the original JSON files
//!   into the DB and moves them to `legacy-backup-v1/`.
//! - [`secrets`] — thin wrapper over the `keyring` crate (OS
//!   keychain). Used for Epic/Steam OAuth tokens and debrid keys.
//! - [`sources`] / [`games`] / [`sessions`] / [`wishlist`] /
//!   [`store_cache`] / [`achievements`] / [`news`] — one DAO per
//!   table, exposing typed CRUD helpers.
//!
//! ## Lifecycle
//!
//! ```text
//! lib.rs::run()
//!   └── .setup(|app| {
//!         let db = db::Db::open(&app.path().app_data_dir()?)?;
//!         db::migrate::run_migrations(&db)?;          // creates v1 schema
//!         db::legacy::auto_import(&db, &data_dir)?;   // one-shot import
//!         app.manage(db);
//!       })
//! ```
//!
//! Tauri commands extract the DB via
//! `app.state::<Db>().inner().clone()` so they can take it by
//! reference (avoids recompiling SP-style borrowing chains across
//! `.await`).

pub mod achievements;
pub mod atomic;
pub mod games;
pub mod kv;
pub mod legacy;
pub mod migrate;
pub mod news;
pub mod pool;
pub mod schema;
pub mod secrets;
pub mod sessions;
pub mod sources;
pub mod store_cache;
pub mod wishlist;

pub use pool::Db;

/// Convenience: open the DB at `app_data_dir/gamelib.db`,
/// apply pending migrations, and run the legacy auto-import.
/// Returns the ready-to-`app.manage()` pool.
pub fn init(app_data_dir: &std::path::Path) -> Result<Db, String> {
    let db = Db::open(app_data_dir)?;
    migrate::run_migrations(&db)?;
    legacy::auto_import(&db, app_data_dir)?;
    Ok(db)
}
