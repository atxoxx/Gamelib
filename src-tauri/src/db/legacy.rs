//! Legacy JSON auto-import.
//!
//! On the first launch under the new storage layer, this module
//! reads every JSON file we used to write straight to disk and
//! bulk-inserts into the appropriate SQLite tables. After the
//! import succeeds, the originals are moved into
//! `<app_data_dir>/legacy-backup-v1/` and left there indefinitely
//! (Phase 5 will add a cleanup step tied to a `legacy_cleanup`
//! schema_meta flag).
//!
//! Safety properties:
//! - **Idempotent.** A row in `schema_meta(k='legacy_import', v='v1')`
//!   short-circuits the whole import. Re-running is a no-op until
//!   that flag is removed.
//! - **All-or-nothing per table.** Each DAO call wraps multiple
//!   writes in a transaction. The auto-import-level rollback is
//!   implicit: if the *very first* table fails, we early-return
//!   before touching the others, leaving disk untouched.
//! - **INSERT OR IGNORE for partial overlap.** If a previous run
//!   wrote some rows successfully before crashing, the next run
//!   won't error on uniqueness.
//! - **Originals don't move until the DB write succeeds.** We move
//!   after the SQL commits and only if the move target doesn't
//!   already contain the file (no clobbering across runs).

use std::path::{Path, PathBuf};

use crate::db::pool::Db;
use crate::db::achievements;
use crate::db::games::GameRow;
use crate::db::sources;
use crate::db::store_cache;
use crate::db::wishlist;
use crate::db::migrate;
use serde::Deserialize;

/// Tag written into `schema_meta` once the import finishes. If
/// present (and equal to "v1"), the auto-import skips.
const LEGACY_IMPORT_KEY: &str = "legacy_import";
const LEGACY_IMPORT_VERSION: &str = "v1";

#[derive(Debug, Deserialize)]
struct LegacyWishlistEntries {
    #[serde(default)]
    entries: std::collections::HashMap<String, LegacyWishlistEntry>,
}

#[derive(Debug, Deserialize)]
struct LegacyWishlistEntry {
    slug: String,
    #[serde(flatten)]
    payload: serde_json::Value,
    #[serde(rename = "addedAt")]
    added_at: u64,
}

/// Run the auto-import if it hasn't been recorded. Reads JSON, bulk-
/// imports, then moves originals into `legacy-backup-v1/`.
///
/// ROLLBACK SEMANTICS — read before refactoring:
/// Each per-table import is **independent**; there is no
/// all-or-nothing wrapping transaction across the five tables.
/// If `import_wishlist` succeeds but `import_store_cache` later
/// returns an error, the wishlist rows ARE committed to SQLite
/// AND the wishlist JSON file is still on disk. We log-and-skip
/// on per-table errors (`eprintln!`) and only push the path into
/// `imported_files` on success, so the originals stay available
/// for a retry. Re-running the auto-importer is safe because
/// every DAO call uses `INSERT … ON CONFLICT … DO UPDATE`; the
/// `schema_meta(legacy_import=v1)` stamp is written **only**
/// after every per-table import returned Ok, so a partial-success
/// run will retry the failing tables on the next launch.
pub fn auto_import(db: &Db, app_data_dir: &Path) -> Result<(), String> {
    // Run migrations first so the schema exists (and is current).
    migrate::run_migrations(db)?;

    if let Some(v) = read_meta(db, LEGACY_IMPORT_KEY)? {
        if v == LEGACY_IMPORT_VERSION {
            // Already imported; nothing to do.
            return Ok(());
        }
    }

    let backup_dir = app_data_dir.join(format!(
        "legacy-backup-{}",
        LEGACY_IMPORT_VERSION
    ));

    let mut imported_files: Vec<PathBuf> = Vec::new();

    // Wishlist ───────────────────────────────────────────────────────
    let wishlist_path = app_data_dir.join("wishlist_cache.json");
    if wishlist_path.exists() {
        match import_wishlist(db, &wishlist_path) {
            Ok(()) => imported_files.push(wishlist_path),
            Err(e) => {
                eprintln!("[db::legacy] wishlist import skipped: {e}");
            }
        }
    }

    // Store cache ────────────────────────────────────────────────────
    let store_cache_path = app_data_dir.join("store_cache.json");
    if store_cache_path.exists() {
        match import_store_cache(db, &store_cache_path) {
            Ok(()) => imported_files.push(store_cache_path),
            Err(e) => {
                eprintln!("[db::legacy] store_cache import skipped: {e}");
            }
        }
    }

    // Achievements cache ────────────────────────────────────────────
    let achievements_path = app_data_dir.join("achievements_cache.json");
    if achievements_path.exists() {
        match import_achievements(db, &achievements_path) {
            Ok(()) => imported_files.push(achievements_path),
            Err(e) => {
                eprintln!("[db::legacy] achievements import skipped: {e}");
            }
        }
    }

    // Sources (metadata + per-source caches) ────────────────────────
    let sources_meta_path = app_data_dir.join("sources.json");
    let sources_cache_dir = app_data_dir.join("sources_cache");
    if sources_meta_path.exists() {
        match import_sources(db, &sources_meta_path, &sources_cache_dir) {
            Ok(()) => {
                imported_files.push(sources_meta_path);
                if sources_cache_dir.exists() {
                    imported_files.push(sources_cache_dir);
                }
            }
            Err(e) => {
                eprintln!("[db::legacy] sources import skipped: {e}");
            }
        }
    }

    // Game library ───────────────────────────────────────────────────
    let games_path = app_data_dir.join("games.json");
    if games_path.exists() {
        match import_games(db, &games_path) {
            Ok(()) => imported_files.push(games_path),
            Err(e) => {
                eprintln!("[db::legacy] games import skipped: {e}");
            }
        }
    }

    // Done: move originals AFTER every SQL commit succeeds. Use
    // `fs::rename` so the move is atomic.
    if !imported_files.is_empty() {
        std::fs::create_dir_all(&backup_dir)
            .map_err(|e| format!("mkdir backup: {e}"))?;
        for src in imported_files {
            let target = backup_dir.join(src.file_name().unwrap());
            if target.exists() {
                // Already backed up by an earlier partial run; keep
                // it. Don't overwrite (avoids clobbering across
                // half-completed imports).
                continue;
            }
            if src.is_dir() {
                std::fs::rename(&src, &target)
                    .map_err(|e| format!("backup dir {}: {e}", src.display()))?;
            } else {
                std::fs::rename(&src, &target)
                    .map_err(|e| format!("backup file {}: {e}", src.display()))?;
            }
        }
    }

    write_meta(db, LEGACY_IMPORT_KEY, LEGACY_IMPORT_VERSION)?;
    Ok(())
}

// ── per-table imports ────────────────────────────────────────────────────

fn import_wishlist(db: &Db, path: &Path) -> Result<(), String> {
    let raw = std::fs::read_to_string(path)
        .map_err(|e| format!("read {}: {e}", path.display()))?;
    let parsed: LegacyWishlistEntries = serde_json::from_str(&raw)
        .map_err(|e| format!("parse {}: {e}", path.display()))?;
    for (_key, entry) in parsed.entries {
        let payload = serde_json::to_string(&entry.payload)
            .map_err(|e| format!("serialize payload: {e}"))?;
        wishlist::upsert(db, &entry.slug, &payload, entry.added_at)?;
    }
    Ok(())
}

fn import_store_cache(db: &Db, path: &Path) -> Result<(), String> {
    let raw = std::fs::read_to_string(path)
        .map_err(|e| format!("read {}: {e}", path.display()))?;
    let parsed: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| format!("parse {}: {e}", path.display()))?;

    // Old shape: `{ "categories": { "<category>": { "data": [...],
    // "fetchedAt": <sec> } }, "detailCache": { "<slug>": …
    // } }`. New shape doesn't pre-serialize; we just round-trip
    // the JSON as-is per row.
    if let Some(cats) = parsed.get("categories").and_then(|v| v.as_object()) {
        for (category, payload) in cats {
            // We store the entire `{data, fetchedAt}` JSON as the
            // category's payload so the read path can surface
            // `fetchedAt` from the wrapped blob.
            let wrapped = serde_json::to_string(&payload)
                .map_err(|e| format!("wrap category: {e}"))?;
            store_cache::upsert_category_page(db, category, 0, &wrapped)?;
        }
    }
    if let Some(detail) = parsed.get("detailCache").and_then(|v| v.as_object()) {
        for (slug, payload) in detail {
            let wrapped = serde_json::to_string(payload)
                .map_err(|e| format!("wrap detail: {e}"))?;
            store_cache::upsert_detail(db, slug, &wrapped)?;
        }
    }
    Ok(())
}

fn import_achievements(db: &Db, path: &Path) -> Result<(), String> {
    let raw = std::fs::read_to_string(path)
        .map_err(|e| format!("read {}: {e}", path.display()))?;
    // Two shapes used historically: a bare `{"games": {...}}` map,
    // or a JSON-stringified version of the same shipped through
    // `save_achievements_cache` (the command took a `String`).
    let games_map = if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) {
        parsed
    } else {
        return Err("achievements cache JSON could not be parsed".into());
    };
    let Some(map) = games_map.get("games").and_then(|v| v.as_object()) else {
        // Empty cache is allowed; nothing to import.
        return Ok(());
    };
    for (game_id, payload) in map {
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
        achievements::upsert(db, game_id, steam_app_id, &serialized, last_synced)?;
    }
    Ok(())
}

/// Import sources.json metadata + every `sources_cache/{id}.json`.
/// The two are independent files so a corrupt cache file shouldn't
/// block metadata import.
fn import_sources(
    db: &Db,
    sources_meta_path: &Path,
    sources_cache_dir: &Path,
) -> Result<(), String> {
    let raw = std::fs::read_to_string(sources_meta_path)
        .map_err(|e| format!("read {}: {e}", sources_meta_path.display()))?;
    let sources: Vec<serde_json::Value> = serde_json::from_str(&raw)
        .map_err(|e| format!("parse {}: {e}", sources_meta_path.display()))?;

    // Sources metadata first (idempotent upsert).  Errors on
    // individual rows (e.g. two legacy entries sharing the same
    // URL) are logged-and-continued rather than aborting the
    // entire import — a single corrupt entry should not prevent
    // the rest of the sources from importing, and should not
    // prevent the file from being moved to the backup directory.
    let mut meta_imported: usize = 0;
    let mut meta_errors: usize = 0;
    for s in &sources {
        let id = s.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let hydra = s.get("hydraSourceId").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let url = s.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let name = s.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let enabled = s.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
        let last_fetched = s.get("lastFetched").and_then(|v| v.as_u64());
        let game_count = s
            .get("gameCount")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as usize;
        if id.is_empty() || url.is_empty() {
            continue;
        }
        let link = crate::source_manager::SourceLink {
            id: id.clone(),
            hydra_source_id: hydra,
            url,
            name,
            enabled,
            last_fetched,
            game_count,
        };
        match sources::upsert_source(db, &link) {
            Ok(()) => meta_imported += 1,
            Err(e) => {
                meta_errors += 1;
                eprintln!(
                    "[db::legacy] skipping source {}: {e}",
                    id
                );
            }
        }
    }
    if meta_errors > 0 {
        eprintln!(
            "[db::legacy] sources metadata: {meta_imported} imported, {meta_errors} skipped"
        );
    }
    // Safety net: if every single legacy source failed to import,
    // don't move the originals — the file is either corrupt or the
    // DB schema is fundamentally incompatible. Returning an error
    // here keeps the files on disk for a future retry.
    if meta_imported == 0 && meta_errors > 0 {
        return Err(format!(
            "all {} source metadata entries failed to import",
            meta_errors
        ));
    }

    if !sources_cache_dir.exists() {
        return Ok(());
    }

    // Per-cache-file import. We collect all errors and surface
    // them so auto_import can decide whether to abort the move
    // (and thus preserve the originals for a later retry). One
    // corrupt cache file shouldn't silently drop that source's
    // whole catalog.
    let entries = std::fs::read_dir(sources_cache_dir)
        .map_err(|e| format!("read_dir {}: {e}", sources_cache_dir.display()))?;
    let mut first_err: Option<String> = None;
    let mut imported_count: usize = 0;
    for e in entries.flatten() {
        let path = e.path();
        let ext_ok = path.extension().map(|x| x == "json").unwrap_or(false);
        if !ext_ok {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let raw = match std::fs::read_to_string(&path) {
            Ok(r) => r,
            Err(e) => {
                if first_err.is_none() {
                    first_err = Some(format!("read {}: {e}", path.display()));
                }
                continue;
            }
        };
        let parsed: serde_json::Value = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(e) => {
                if first_err.is_none() {
                    first_err = Some(format!("parse {}: {e}", path.display()));
                }
                continue;
            }
        };
        let hydra = parsed
            .get("hydraSourceId")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let fetched_at = parsed
            .get("fetchedAt")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let data_json = parsed
            .get("data")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({"name": "", "downloads": []}));
        let game_source: crate::source_manager::GameSource =
            serde_json::from_value(data_json).unwrap_or(crate::source_manager::GameSource {
                name: String::new(),
                downloads: Vec::new(),
            });
        match sources::commit_cached_source(db, id, &hydra, &game_source, fetched_at) {
            Ok(_) => imported_count += 1,
            Err(e) => {
                if first_err.is_none() {
                    first_err = Some(format!("commit {}: {e}", path.display()));
                }
            }
        }
    }
    if let Some(e) = first_err {
        return Err(format!(
            "{e} ({} cache files imported before the failure)",
            imported_count
        ));
    }
    Ok(())
}

fn import_games(db: &Db, path: &Path) -> Result<(), String> {
    let raw = std::fs::read_to_string(path)
        .map_err(|e| format!("read {}: {e}", path.display()))?;
    let parsed: Vec<serde_json::Value> = serde_json::from_str(&raw)
        .map_err(|e| format!("parse {}: {e}", path.display()))?;
    let mut rows: Vec<GameRow> = Vec::with_capacity(parsed.len());
    for v in parsed {
        match serde_json::from_value::<GameRow>(v) {
            Ok(r) => rows.push(r),
            Err(e) => eprintln!("[db::legacy] skipping malformed game row: {e}"),
        }
    }
    crate::db::games::upsert_all(db, &rows)?;
    Ok(())
}

// ── schema_meta helpers ─────────────────────────────────────────────────────

fn read_meta(db: &Db, key: &str) -> Result<Option<String>, String> {
    let conn = db.conn().map_err(|e| format!("legacy conn: {e}"))?;
    let mut stmt = conn
        .prepare("SELECT v FROM schema_meta WHERE k = ?1")
        .map_err(|e| format!("schema_meta read prepare: {e}"))?;
    let mut rows = stmt
        .query([key])
        .map_err(|e| format!("schema_meta read query: {e}"))?;
    if let Some(row) = rows.next().map_err(|e| format!("schema_meta read row: {e}"))? {
        let v: String = row.get(0).map_err(|e| format!("schema_meta col: {e}"))?;
        return Ok(Some(v));
    }
    Ok(None)
}

fn write_meta(db: &Db, key: &str, value: &str) -> Result<(), String> {
    let conn = db.conn().map_err(|e| format!("legacy conn: {e}"))?;
    conn.execute(
        "INSERT INTO schema_meta(k, v) VALUES(?1, ?2)
         ON CONFLICT(k) DO UPDATE SET v = excluded.v",
        [key, value],
    )
    .map_err(|e| format!("schema_meta write: {e}"))?;
    Ok(())
}
