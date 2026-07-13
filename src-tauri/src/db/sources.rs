//! Sources DAO + FTS5 search.
//!
//! The hot path for "search downloads to find the game the user
//! clicked on" was previously an O(N) scan over every title of
//! every cached source, with the entire source catalog held in
//! memory as a `HashMap<String, CachedSource>`. We replace that
//! with [`search`], which hits SQLite's FTS5 `bm25` ranker for a
//! sub-millisecond indexed query.
//!
//! Schema (see `schema_v1.sql`):
//!
//! ```text
//! sources           ── SourceLink metadata (per-row upserts).
//! sources_cache     ── Full GameSource blob per source (compact JSON).
//! downloads         ── One row per download title with the heavy
//!                       cols (title, file size, uris, magnet).
//! downloads_fts     ── FTS5 virtual table (mirrored via triggers).
//! ```
//!
//! Triggers on `downloads` keep `downloads_fts` consistent. Callers
//! never write to `downloads_fts` directly.

use rusqlite::params;

use super::pool::Db;
use crate::source_manager::{CachedSource, GameSource, MatchedDownload, SourceLink};

// ── Source metadata CRUD ────────────────────────────────────────

/// Insert or update a source's metadata.
pub fn upsert_source(db: &Db, source: &SourceLink) -> Result<(), String> {
    let conn = db.conn().map_err(|e| format!("sources conn: {e}"))?;
    conn.execute(
        "INSERT INTO sources(id, hydra_source_id, url, name, enabled,
                              last_fetched, game_count, added_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET
            hydra_source_id = excluded.hydra_source_id,
            url             = excluded.url,
            name            = excluded.name,
            enabled         = excluded.enabled,
            last_fetched    = excluded.last_fetched,
            game_count      = excluded.game_count",
        params![
            source.id,
            source.hydra_source_id,
            source.url,
            source.name,
            source.enabled as i32,
            source.last_fetched,
            source.game_count as i64,
            unix_now_secs(),
        ],
    )
    .map_err(|e| format!("sources upsert: {e}"))?;
    Ok(())
}

/// Toggle a source's `enabled` bit.
pub fn toggle_source(db: &Db, id: &str) -> Result<(), String> {
    let conn = db.conn().map_err(|e| format!("sources conn: {e}"))?;
    conn.execute(
        "UPDATE sources SET enabled = 1 - enabled WHERE id = ?1",
        params![id],
    )
    .map_err(|e| format!("sources toggle: {e}"))?;
    Ok(())
}

/// Delete a source and all its cache / downloads / FTS rows
/// (cascading FKs).
pub fn remove_source(db: &Db, id: &str) -> Result<(), String> {
    let conn = db.conn().map_err(|e| format!("sources conn: {e}"))?;
    conn.execute("DELETE FROM sources WHERE id = ?1", params![id])
        .map_err(|e| format!("sources delete: {e}"))?;
    Ok(())
}

/// Return every source (metadata only).
pub fn list_sources(db: &Db) -> Result<Vec<SourceLink>, String> {
    let conn = db.conn().map_err(|e| format!("sources conn: {e}"))?;
    let mut stmt = conn
        .prepare(
            "SELECT id, hydra_source_id, url, name, enabled,
                    last_fetched, game_count
               FROM sources
              ORDER BY name COLLATE NOCASE",
        )
        .map_err(|e| format!("sources list prepare: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(SourceLink {
                id: r.get(0)?,
                hydra_source_id: r.get(1)?,
                url: r.get(2)?,
                name: r.get(3)?,
                enabled: r.get::<_, i64>(4)? != 0,
                last_fetched: r.get::<_, Option<u64>>(5)?,
                game_count: r.get::<_, i64>(6)? as usize,
            })
        })
        .map_err(|e| format!("sources list query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("sources row: {e}"))?);
    }
    Ok(out)
}

// ── Source cache (full GameSource blob) + downloads (FTS5-backed) ──

/// Persist a `GameSource` payload: update sources_cache and
/// atomically replace every downloads row for the source.
///
/// We use a single transaction so partial state (FTS5 out of
/// sync with `sources_cache`) can't appear on disk.
pub fn commit_cached_source(
    db: &Db,
    source_id: &str,
    hydra_source_id: &str,
    game_source: &GameSource,
    fetched_at: u64,
) -> Result<usize, String> {
    let payload_json =
        serde_json::to_string(game_source).map_err(|e| format!("serialize GameSource: {e}"))?;

    let mut conn = db.conn().map_err(|e| format!("sources cache: {e}"))?;
    let tx = conn.transaction().map_err(|e| format!("sources cache tx: {e}"))?;

    tx.execute(
        "INSERT INTO sources_cache(source_id, hydra_source_id, fetched_at, payload_json)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(source_id) DO UPDATE SET
            hydra_source_id = excluded.hydra_source_id,
            fetched_at      = excluded.fetched_at,
            payload_json    = excluded.payload_json",
        params![source_id, hydra_source_id, fetched_at, payload_json],
    )
    .map_err(|e| format!("sources_cache upsert: {e}"))?;

    // Triggers on downloads mirror into downloads_fts, so wiping +
    // re-inserting naturally rebuilds the index. Cheaper than
    // computing a diff: insert throughput on SQLite is high
    // (thousands of rows per ms) and FTS5 mirror ingestion is
    // automatic.
    tx.execute("DELETE FROM downloads WHERE source_id = ?1", params![source_id])
        .map_err(|e| format!("downloads delete: {e}"))?;

    let count = {
        let mut stmt = tx
            .prepare(
                "INSERT INTO downloads(source_id, row_id, title, file_size, upload_date, uris_json, magnet)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )
            .map_err(|e| format!("downloads prepare: {e}"))?;
        for (i, dl) in game_source.downloads.iter().enumerate() {
            let uris_json = serde_json::to_string(&dl.uris)
                .map_err(|e| format!("serialize uris: {e}"))?;
            stmt.execute(params![
                source_id,
                i as i64,
                dl.title,
                dl.file_size,
                dl.upload_date,
                uris_json,
                dl.magnet,
            ])
            .map_err(|e| format!("downloads insert {i}: {e}"))?;
        }
        game_source.downloads.len()
    };

    // Update the source's game_count + last_fetched bookkeeping.
    tx.execute(
        "UPDATE sources SET game_count = ?1, last_fetched = ?2 WHERE id = ?3",
        params![count as i64, fetched_at, source_id],
    )
    .map_err(|e| format!("sources game_count: {e}"))?;

    tx.commit().map_err(|e| format!("sources cache commit: {e}"))?;
    Ok(count)
}

/// Return the cached `GameSource` for `source_id` (or None if
/// there isn't one yet).
pub fn read_cached_source(db: &Db, source_id: &str) -> Result<Option<CachedSource>, String> {
    let conn = db.conn().map_err(|e| format!("sources conn: {e}"))?;
    let mut stmt = conn
        .prepare(
            "SELECT source_id, hydra_source_id, fetched_at, payload_json
               FROM sources_cache WHERE source_id = ?1",
        )
        .map_err(|e| format!("sources_cache read prepare: {e}"))?;
    let mut rows = stmt
        .query(params![source_id])
        .map_err(|e| format!("sources_cache read query: {e}"))?;
    let Some(row) = rows.next().map_err(|e| format!("sources_cache row: {e}"))? else {
        return Ok(None);
    };
    let source_id: String = row.get(0).map_err(|e| format!("col 0: {e}"))?;
    let hydra_source_id: String = row.get(1).map_err(|e| format!("col 1: {e}"))?;
    let fetched_at: u64 = row.get(2).map_err(|e| format!("col 2: {e}"))?;
    let payload: String = row.get(3).map_err(|e| format!("col 3: {e}"))?;
    let data: GameSource =
        serde_json::from_str(&payload).map_err(|e| format!("parse GameSource: {e}"))?;
    Ok(Some(CachedSource {
        source_id,
        hydra_source_id,
        data,
        fetched_at,
    }))
}

/// Return every source's metadata alongside its cache (if any).
/// Used by the SourceContext on the frontend.
pub fn list_sources_with_cache(
    db: &Db,
) -> Result<Vec<(SourceLink, Option<CachedSource>)>, String> {
    let sources = list_sources(db)?;
    let mut out = Vec::with_capacity(sources.len());
    for source in &sources {
        out.push((source.clone(), read_cached_source(db, &source.id)?));
    }
    Ok(out)
}

// ── FTS5 search ────────────────────────────────────────────────

/// Fuzzy catalog search over cached downloads. Replaces the in-memory
/// O(N) scan from the old `SourceManager::search` with a
/// `bm25`-ranked FTS5 query.
///
/// `query` is treated as a search phrase. We:
/// 1. Sanitise — strip FTS5 reserved characters (`"`, `*`) so a
///    mistyped query doesn't blow up.
/// 2. Tokenise by whitespace, append `*` to enable prefix-match.
///
/// Only enabled sources participate in the ranking.
pub fn search(db: &Db, query: &str, limit: usize) -> Result<Vec<MatchedDownload>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    // Pre-replace `-` / `+` (FTS5 must/must-not prefix operators) with
    // whitespace BEFORE splitting so "elden-ring DLC" tokenises into
    // [\"elden\", \"ring\", \"DLC\"] instead of [\"eldenring\", \"DLC\"] — each
    // prefix-matched independently.
    let normalised = q.replace(['-', '+'], " ");
    let mut tokens = Vec::new();
    for raw in normalised.split_whitespace() {
        // Strip FTS5 operators + special chars so "elden-ring" becomes
        // two prefix-matched tokens instead of `elden* -ring*` (which
        // FTS5 would otherwise interpret as an EXCLUSION of "ring").
        let cleaned: String = raw
            .chars()
            .filter(|&c| {
                !matches!(
                    c,
                    '"' | '*' | '(' | ')' | ':' | '-' | '+' | '^'
                )
            })
            .collect();
        if cleaned.is_empty() {
            continue;
        }
        // Drop uppercase FTS5 operator keywords (AND/OR/NOT/NEAR)
        // so "elden NOT remastered" doesn't accidentally exclude
        // "remastered" repacks.
        let upper = cleaned.to_ascii_uppercase();
        if matches!(upper.as_str(), "AND" | "OR" | "NOT" | "NEAR") {
            continue;
        }
        tokens.push(format!("{cleaned}*"));
    }
    if tokens.is_empty() {
        return Ok(Vec::new());
    }
    let fts_query = tokens.join(" ");

    let conn = db.conn().map_err(|e| format!("sources conn: {e}"))?;
    // Rank by bm25(downloads_fts): smaller = better. We sort ASC.
    // The JOIN drops rows whose source is disabled.
    let mut stmt = conn
        .prepare(
            "SELECT d.source_id, d.title, d.file_size, d.upload_date,
                    d.uris_json, d.magnet,
                    s.name AS source_name,
                    bm25(downloads_fts) AS score
               FROM downloads_fts
               JOIN downloads d ON d.row_id = downloads_fts.rowid
                                  AND d.source_id = downloads_fts.source_id
               JOIN sources  s ON s.id = d.source_id
              WHERE downloads_fts MATCH ?1
                AND s.enabled = 1
              ORDER BY score
              LIMIT ?2",
        )
        .map_err(|e| format!("FTS prepare: {e}"))?;

    let rows = stmt
        .query_map(params![fts_query, limit as i64], |r| {
            let source_id: String = r.get(0)?;
            let title: String = r.get(1)?;
            let file_size: String = r.get(2)?;
            let upload_date: Option<String> = r.get(3)?;
            let uris_json: String = r.get(4)?;
            let magnet: Option<String> = r.get(5)?;
            let source_name: String = r.get(6)?;
            let score: f32 = r.get::<_, f64>(7)? as f32;
            let uris: Vec<String> = serde_json::from_str(&uris_json).unwrap_or_default();
            let resolved_magnet = magnet.or_else(|| {
                uris.iter().find(|u| u.starts_with("magnet:")).cloned()
            });
            Ok(MatchedDownload {
                source_name,
                source_id,
                title,
                file_size,
                uris,
                magnet: resolved_magnet,
                upload_date,
                match_score: score,
            })
        })
        .map_err(|e| format!("FTS query: {e}"))?;

    let mut out = Vec::new();
    for row in rows {
        // Negative scores (lower = better) are confusing to the
        // frontend which expects 0..1. We re-normalise: scores are
        // already negative from bm25, but the frontend's UI uses
        // match_score as a relative magnitude. We expose the raw
        // bm25 value (more negative = stronger match), so we keep
        // the negative and let the frontend scale as needed.
        out.push(row.map_err(|e| format!("FTS row: {e}"))?);
    }
    Ok(out)
}

// ── helpers ────────────────────────────────────────────────────

fn unix_now_secs() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
