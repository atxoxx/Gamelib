//! Source link management for the download feature.
//!
//! "Sources" are JSON files hosted on a third-party URL that list
//! available downloads for various games. The most common shape is
//! the **Hydra** format — a single object with a `name` and a
//! `downloads` array, where each entry has `title`, `fileSize`,
//! magnet / .torrent URIs, and `uploadDate`.
//!
//! ## Persistence (Phase 2 of the storage-migration plan)
//!
//! `<app_data_dir>/sources.json` and `<app_data_dir>/sources_cache/{id}.json`
//! are gone. Source metadata now lives in the `sources` SQLite
//! table; cached payload blobs live in `sources_cache`; every
//! download title is its own row in `downloads` and is mirrored
//! into the FTS5 virtual table `downloads_fts` by SQL triggers.
//!
//! The local fuzzy search (`source_manager::search`) now hits that
//! FTS5 index with `bm25` ranking — sub-millisecond on catalogs in
//! the six-figure-title range, where the old in-memory
//! O(N)-over-titles scan took hundreds of milliseconds and
//! consumed tens of MB of `HashMap` memory at startup.
//!
//! ## Concurrency
//!
//! `SourceManager` no longer needs a `tokio::sync::Mutex` — the
//! underlying SQLite pool serialises one writer at a time and
//! concurrent readers are cheap. The Tauri `State` binding has
//! changed from `Arc<tokio::sync::Mutex<SourceManager>>` to
//! `Arc<SourceManager>`. Each method takes `&self` (read paths) or
//! `&mut self` only where a `reqwest::Client::post(...).send()`
//! forces it (the client itself is `Send + !Sync`-friendly when
//! borrowed by `&self` for a single request).
//!
//! All public signatures (`SourceLink`, `CachedSource`,
//! `GameSource`, `SourceDownload`, `MatchedDownload`,
//! `HydraRepack`/`HydraSearchResponse`, etc.) are unchanged so
//! the frontend can keep its existing types in
//! `src/types/source.ts` and the Tauri command names are
//! unchanged in `lib.rs`.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::db::{self, Db};

// ─── Constants ──────────────────────────────────────────────────────────────

/// Production Hydra API base URL.
const HYDRA_API_BASE: &str = "https://hydra-api-us-east-1.losbroxas.org";

// ─── JSON schema (Hydra-compatible) ─────────────────────────────────────────

/// A single download entry inside a source.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SourceDownload {
    pub title: String,
    #[serde(default, alias = "filesize", alias = "file_size")]
    pub file_size: String,
    /// Magnet links, .torrent URLs, or both. Treated as opaque
    /// URIs by this module — `torrent_engine` validates the scheme
    /// before handing off.
    #[serde(default)]
    pub uris: Vec<String>,
    #[serde(default, alias = "uploaddate", alias = "upload_date")]
    pub upload_date: Option<String>,
    /// Optional pre-parsed magnet — some sources (Hydra) populate
    /// this as a convenience for clients that can't parse a magnet
    /// URI themselves. We use it as a fallback when the `uris`
    /// array is missing or empty.
    #[serde(default)]
    pub magnet: Option<String>,
}

/// A full source: name + a list of downloads.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GameSource {
    pub name: String,
    pub downloads: Vec<SourceDownload>,
}

// ─── Hydra API types ────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
struct AddDownloadSourceRequest {
    url: String,
}

#[derive(Debug, Serialize)]
struct SyncDownloadSourcesRequest {
    ids: Vec<String>,
}

/// Response from `POST /download-sources` and entries in the
/// `POST /download-sources/sync` response array.
///
/// The Hydra API returns catalog metadata only (id, name,
/// fingerprint, download_count, status) — the full download
/// list is served by separate repack/search endpoints
/// (`/games/steam/:appid/download-sources`,
/// `/catalogue/search`). We use `download_count` for the
/// source's `game_count` when the raw source URL is
/// unreachable (HTTP 403, Cloudflare, etc.).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct HydraDownloadSourceResponse {
    id: String,
    url: String,
    name: String,
    fingerprint: String,
    download_count: usize,
    status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CatalogueSearchRequest {
    title: String,
    take: usize,
    skip: usize,
    download_source_fingerprints: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HydraSearchEdge {
    object_id: String,
    title: String,
    shop: String,
}

#[derive(Debug, Deserialize)]
struct HydraSearchResponse {
    edges: Vec<HydraSearchEdge>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct HydraRepack {
    id: String,
    title: String,
    file_size: Option<String>,
    uris: Vec<String>,
    #[serde(default)]
    magnet: Option<String>,
    upload_date: Option<String>,
    download_source_id: String,
    download_source_name: String,
}

// ─── User-facing records ────────────────────────────────────────────────────

/// Metadata for a single source the user has added. Persisted to
/// the `sources` SQLite table.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SourceLink {
    pub id: String,
    /// ID assigned by the Hydra API — used as the key for
    /// subsequent sync / refresh calls. Empty string for legacy
    /// sources added before the Hydra API migration.
    #[serde(default)]
    pub hydra_source_id: String,
    pub url: String,
    pub name: String,
    pub enabled: bool,
    /// Unix seconds of the last successful fetch, or `None` if
    /// the source has never been fetched.
    pub last_fetched: Option<u64>,
    /// Number of download entries in the most recent successful
    /// fetch.
    pub game_count: usize,
}

/// Cached source payload. Persisted to the `sources_cache`
/// SQLite table (compact JSON of `GameSource`).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CachedSource {
    pub source_id: String,
    /// ID assigned by the Hydra API. Empty string if not yet
    /// registered.
    pub hydra_source_id: String,
    pub data: GameSource,
    /// Unix seconds of when this was fetched.
    pub fetched_at: u64,
}

/// A matched download for the DownloadModal. The frontend renders
/// these directly; `match_score` is a 0–1 value the UI uses to
/// sort / dim sub-matches.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MatchedDownload {
    pub source_name: String,
    pub source_id: String,
    pub title: String,
    pub file_size: String,
    pub uris: Vec<String>,
    /// Resolved magnet URI (if the source provided one explicitly,
    /// OR if we found a `magnet:` URI inside the `uris` array).
    pub magnet: Option<String>,
    pub upload_date: Option<String>,
    /// 0.0 (no match) – 1.0 (perfect match). The FTS5 `bm25`
    /// ranker returns a negative value (more negative = closer
    /// match); we map to [0, 1] for the frontend.
    pub match_score: f32,
}

// ─── SourceManager ──────────────────────────────────────────────────────────

pub struct SourceManager {
    db: Db,
    /// Shared HTTP client. Cheap to clone; we hold one for the
    /// lifetime of the app.
    client: reqwest::Client,
}

impl SourceManager {
    /// Build the manager. The DB must already be open (Phase 1's
    /// `db::init` does this).
    pub fn new(db: Db) -> Self {
        Self {
            db,
            client: reqwest::Client::builder()
                .user_agent("Gamelib/1.0 (+hydra-api)")
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .expect("HTTP client build is infallible with these settings"),
        }
    }

    // ── Public API ─────────────────────────────────────────────────────

    /// Add a new source via the Hydra API. POSTs the URL to
    /// `/download-sources`, persists the returned data, and returns
    /// the new `SourceLink`.
    pub async fn add_source(
        &self,
        url: String,
        name: String,
    ) -> Result<SourceLink, String> {
        let trimmed = url.trim().to_string();
        if trimmed.is_empty() {
            return Err("Source URL is empty".to_string());
        }
        if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
            return Err("Source URL must start with http:// or https://".to_string());
        }
        if self.url_exists(&trimmed)? {
            return Err("This source URL has already been added".to_string());
        }

        // 1. Register with Hydra.
        let hydra_resp = self.hydra_add_source(&trimmed).await?;

        // 2. Try to fetch the raw source JSON for local caching.
        //    This may fail (HTTP 403, Cloudflare, etc.) — in that
        //    case we fall back to Hydra's `download_count` for the
        //    game tally. The actual download links are served by
        //    Hydra's repack/search endpoints, not the raw JSON.
        let (game_source, effective_count) =
            match self.fetch_source_json(&hydra_resp.url).await {
                Ok(src) => {
                    let count = src.downloads.len();
                    (src, count)
                }
                Err(e) => {
                    eprintln!(
                        "[source_manager] fetch_source_json failed for {}: {}; using Hydra download_count ({})",
                        hydra_resp.url, e, hydra_resp.download_count
                    );
                    (
                        GameSource {
                            name: hydra_resp.name.clone(),
                            downloads: Vec::new(),
                        },
                        hydra_resp.download_count,
                    )
                }
            };

        let now_secs = unix_now();
        let local_id = format!("src_{}_{}", unix_now_nanos(), SOURCE_ID_COUNTER.fetch_add(1, Ordering::Relaxed));
        let display_name = if name.trim().is_empty() {
            derive_name_from_url(&trimmed)
        } else {
            name.trim().to_string()
        };

        // When the raw source JSON was unreachable we still have
        // Hydra's download_count — use it so the UI shows the real
        // number of titles rather than "0 games". commit_cached_source
        // will overwrite with the actual parsed count when downloads
        // are available; when they aren't it falls through to our
        // effective_count.
        let source = SourceLink {
            id: local_id.clone(),
            hydra_source_id: hydra_resp.id.clone(),
            url: trimmed.clone(),
            name: display_name.clone(),
            enabled: true,
            last_fetched: Some(now_secs),
            game_count: effective_count,
        };
        db::sources::upsert_source(&self.db, &source)?;

        // Cache the payload (also writes into downloads_fts).
        let game_count = db::sources::commit_cached_source(
            &self.db,
            &local_id,
            &hydra_resp.id,
            &game_source,
            now_secs,
        )?;
        // Prefer the parsed count when downloads were available;
        // otherwise the Hydra-supplied effective_count is correct.
        let final_count = if game_count > 0 { game_count } else { effective_count };

        Ok(SourceLink {
            id: local_id,
            hydra_source_id: hydra_resp.id,
            url: trimmed,
            name: display_name,
            enabled: true,
            last_fetched: Some(now_secs),
            game_count: final_count,
        })
    }

    /// Remove a source by id. Idempotent — returns Ok even if the
    /// id never existed, so the frontend can be optimistic.
    pub fn remove_source(&self, id: &str) -> Result<(), String> {
        db::sources::remove_source(&self.db, id)
    }

    /// Toggle a source's enabled flag.
    pub fn toggle_source(&self, id: &str) -> Result<(), String> {
        db::sources::toggle_source(&self.db, id)
    }

    /// Snapshot of the current source list.
    pub fn list_sources(&self) -> Result<Vec<SourceLink>, String> {
        db::sources::list_sources(&self.db)
    }

    /// Snapshot of the current source list, optionally with each
    /// source's cached payload. Cheap because `read_cached_source`
    /// is a single indexed SELECT.
    pub fn list_sources_with_cache(
        &self,
    ) -> Result<Vec<(SourceLink, Option<CachedSource>)>, String> {
        db::sources::list_sources_with_cache(&self.db)
    }

    /// Refresh one source.
    pub async fn refresh_source(&self, id: &str) -> Result<(), String> {
        self.refresh_source_inner(id, false).await
    }

    /// Refresh every enabled source.
    pub async fn refresh_all(&self) -> Result<(), String> {
        self.refresh_all_inner().await
    }

    /// FTS5-backed offline search. Crucially this is now a single
    /// `MATCH ... ORDER BY bm25(downloads_fts) LIMIT N` query — the
    /// in-memory `score_match` O(N) scan is gone.
    pub fn search(&self, query: &str) -> Vec<MatchedDownload> {
        match db::sources::search(&self.db, query, 50) {
            Ok(results) => rescale_scores(results),
            Err(e) => {
                eprintln!("[source_manager] FTS search failed: {e}");
                Vec::new()
            }
        }
    }

    /// Online-only search via the Hydra API for sources the user
    /// has added. Falls back to offline FTS5 if Hydra is
    /// unreachable.
    pub async fn search_online(
        &self,
        query: &str,
        steam_app_id: Option<u32>,
    ) -> Result<Vec<MatchedDownload>, String> {
        let q = query.trim();
        if q.is_empty() {
            return Ok(Vec::new());
        }

        let sources = db::sources::list_sources(&self.db)?;
        let mut enabled_hydra_ids = Vec::new();
        let mut hydra_to_local = HashMap::new();
        for source in &sources {
            if source.enabled && !source.hydra_source_id.is_empty() {
                enabled_hydra_ids.push(source.hydra_source_id.clone());
                hydra_to_local.insert(source.hydra_source_id.clone(), source.id.clone());
            }
        }

        if enabled_hydra_ids.is_empty() {
            return Ok(self.search(q));
        }

        let mut repacks = Vec::new();

        if let Some(appid) = steam_app_id {
            if let Ok(list) = self.fetch_repacks_by_appid(appid, &enabled_hydra_ids).await {
                repacks = list;
            }
        }

        if repacks.is_empty() {
            if let Ok(list) = self.search_catalogue_by_title(q, &enabled_hydra_ids).await {
                repacks = list;
            }
        }

        if !repacks.is_empty() {
            let query_tokens: Vec<String> = q
                .split_whitespace()
                .map(|t| t.to_ascii_lowercase())
                .collect();
            let mut results = Vec::new();
            for repack in repacks {
                let score = score_match(&query_tokens, q, &repack.title);
                if score < 0.3 {
                    continue;
                }
                let local_id = hydra_to_local
                    .get(&repack.download_source_id)
                    .cloned()
                    .unwrap_or_default();
                let magnet = repack.magnet.clone().or_else(|| {
                    repack
                        .uris
                        .iter()
                        .find(|u| u.starts_with("magnet:"))
                        .cloned()
                });
                results.push(MatchedDownload {
                    source_name: repack.download_source_name.clone(),
                    source_id: local_id,
                    title: repack.title.clone(),
                    file_size: repack.file_size.clone().unwrap_or_default(),
                    uris: repack.uris.clone(),
                    magnet,
                    upload_date: repack.upload_date.clone(),
                    match_score: score,
                });
            }
            results.sort_by(|a, b| {
                b.match_score
                    .partial_cmp(&a.match_score)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            return Ok(results);
        }

        Ok(self.search(q))
    }

    // ── Refresh helpers (private) ─────────────────────────────────────

    async fn refresh_source_inner(
        &self,
        id: &str,
        is_bulk: bool,
    ) -> Result<(), String> {
        let sources = db::sources::list_sources(&self.db)?;
        let Some(source) = sources.iter().find(|s| s.id == id).cloned() else {
            return Err(format!("Source not found: {id}"));
        };
        let now = unix_now();
        let hydra_id = if source.hydra_source_id.is_empty() {
            self.ensure_hydra_id(&source).await?
        } else {
            source.hydra_source_id.clone()
        };

        // When we have a valid Hydra id, try the bulk-sync endpoint first.
        if !hydra_id.is_empty() {
            let results = self.hydra_sync_sources(&[hydra_id.clone()]).await?;
            if !results.is_empty() {
                let hydra_resp = &results[0];
                let game_source_opt = self.fetch_source_json(&hydra_resp.url).await.ok();
                cache_hydra_response(&self.db, source.id.clone(), hydra_resp, game_source_opt, now)?;
                return Ok(());
            }
        }

        // Fallback: direct fetch from the source URL.
        match self.fetch_source_json(&source.url).await {
            Ok(game_source) => {
                db::sources::commit_cached_source(
                    &self.db,
                    &source.id,
                    &hydra_id,
                    &game_source,
                    now,
                )?;
                Ok(())
            }
            Err(e) => {
                if is_bulk {
                    eprintln!(
                        "[source_manager] refresh {} failed: {e}",
                        source.id
                    );
                    Ok(())
                } else {
                    Err(format!("Refresh failed: {e}"))
                }
            }
        }
    }

    async fn refresh_all_inner(&self) -> Result<(), String> {
        let sources = db::sources::list_sources(&self.db)?;
        let enabled: Vec<SourceLink> =
            sources.into_iter().filter(|s| s.enabled).collect();
        if enabled.is_empty() {
            return Ok(());
        }
        let now = unix_now();

        // 1. Ensure all enabled sources have a Hydra ID.
        let mut hydra_ids: Vec<String> = Vec::with_capacity(enabled.len());
        let mut local_to_hydra: HashMap<String, String> = HashMap::new();
        for source in &enabled {
            match self.ensure_hydra_id(source).await {
                Ok(hid) => {
                    local_to_hydra.insert(source.id.clone(), hid.clone());
                    if !hid.is_empty() {
                        hydra_ids.push(hid);
                    }
                }
                Err(e) => eprintln!(
                    "[source_manager] failed to get Hydra ID for {}: {e}",
                    source.id
                ),
            }
        }

        // 2. Bulk sync.
        let mut refreshed = 0usize;
        let mut hydrated: HashSet<String> = HashSet::new();
        if !hydra_ids.is_empty() {
            if let Ok(results) = self.hydra_sync_sources(&hydra_ids).await {
                let hydra_to_local: HashMap<String, String> = local_to_hydra
                    .iter()
                    .map(|(k, v)| (v.clone(), k.clone()))
                    .collect();
                for hydra_resp in &results {
                    if let Some(local_id) = hydra_to_local.get(&hydra_resp.id) {
                        let game_source_opt =
                            self.fetch_source_json(&hydra_resp.url).await.ok();
                        cache_hydra_response(&self.db, local_id.clone(), hydra_resp, game_source_opt, now)?;
                        hydrated.insert(local_id.clone());
                        refreshed += 1;
                    }
                }
            } else {
                eprintln!(
                    "[source_manager] Hydra bulk sync failed; falling back to individual refreshes"
                );
            }
        }

        // 3. Refresh any sources not covered by Hydra sync.
        for source in &enabled {
            if hydrated.contains(&source.id) {
                continue;
            }
            let _ = self.refresh_source_inner(&source.id, true).await;
            refreshed += 1;
        }

        if refreshed == 0 && !enabled.is_empty() {
            Err(format!(
                "Failed to refresh any of {} enabled source(s)",
                enabled.len()
            ))
        } else {
            Ok(())
        }
    }

    /// POSTs the local source URL to Hydra if not already
    /// registered; returns the existing or newly-assigned Hydra id.
    ///
    /// If the Hydra registration fails (e.g. the URL was already
    /// registered by a previous run whose `hydra_source_id` was
    /// lost), we return the empty string rather than aborting the
    /// refresh. Callers fall through to the direct-fetch path which
    /// doesn't need a Hydra id.
    async fn ensure_hydra_id(&self, source: &SourceLink) -> Result<String, String> {
        if !source.hydra_source_id.is_empty() {
            return Ok(source.hydra_source_id.clone());
        }
        match self.hydra_add_source(&source.url).await {
            Ok(hydra_resp) => {
                let mut updated = source.clone();
                updated.hydra_source_id = hydra_resp.id.clone();
                db::sources::upsert_source(&self.db, &updated)?;
                Ok(hydra_resp.id)
            }
            Err(e) => {
                eprintln!(
                    "[source_manager] ensure_hydra_id: Hydra registration failed for {}: {e}",
                    source.id
                );
                // Return the (possibly-empty) fallback so
                // callers can proceed with a direct fetch.
                Ok(source.hydra_source_id.clone())
            }
        }
    }

    fn url_exists(&self, url: &str) -> Result<bool, String> {
        let all = db::sources::list_sources(&self.db)?;
        Ok(all.iter().any(|s| s.url == url))
    }

    // ── Hydra API helpers ──────────────────────────────────────────────

    async fn hydra_add_source(&self, url: &str) -> Result<HydraDownloadSourceResponse, String> {
        let endpoint = format!("{}/download-sources", HYDRA_API_BASE);
        let response = self
            .client
            .post(&endpoint)
            .json(&AddDownloadSourceRequest { url: url.to_string() })
            .send()
            .await
            .map_err(|e| format!("Hydra API unreachable: {e}"))?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Hydra API returned HTTP {}: {}", status.as_u16(), body));
        }
        response
            .json::<HydraDownloadSourceResponse>()
            .await
            .map_err(|e| format!("Failed to parse Hydra API response: {e}"))
    }

    async fn fetch_source_json(&self, url: &str) -> Result<GameSource, String> {
        let response = self
            .client
            .get(url)
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            )
            .send()
            .await
            .map_err(|e| format!("Failed to fetch source JSON: {e}"))?;
        if !response.status().is_success() {
            return Err(format!("HTTP {} from source URL", response.status().as_u16()));
        }
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if content_type.contains("text/html") {
            return Err("Source URL returned HTML (likely Cloudflare challenge)".to_string());
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("Body read failed: {e}"))?;
        serde_json::from_slice::<GameSource>(&bytes)
            .map_err(|e| format!("Source JSON parse failed: {e}"))
    }

    async fn hydra_sync_sources(
        &self,
        ids: &[String],
    ) -> Result<Vec<HydraDownloadSourceResponse>, String> {
        let endpoint = format!("{}/download-sources/sync", HYDRA_API_BASE);
        let response = self
            .client
            .post(&endpoint)
            .json(&SyncDownloadSourcesRequest { ids: ids.to_vec() })
            .send()
            .await
            .map_err(|e| format!("Hydra API unreachable: {e}"))?;
        let status = response.status();
        if status.as_u16() == 404 {
            return Ok(Vec::new());
        }
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(format!(
                "Hydra API returned HTTP {}: {}",
                status.as_u16(),
                body
            ));
        }
        response
            .json::<Vec<HydraDownloadSourceResponse>>()
            .await
            .map_err(|e| format!("Failed to parse Hydra sync response: {e}"))
    }

    async fn fetch_repacks_by_appid(
        &self,
        steam_app_id: u32,
        hydra_source_ids: &[String],
    ) -> Result<Vec<HydraRepack>, String> {
        let url = format!("{}/games/steam/{}/download-sources", HYDRA_API_BASE, steam_app_id);
        let mut query_params = vec![("take".to_string(), "100".to_string()), ("skip".to_string(), "0".to_string())];
        for id in hydra_source_ids {
            query_params.push(("downloadSourceIds[]".to_string(), id.clone()));
        }
        let response = self
            .client
            .get(&url)
            .query(&query_params)
            .send()
            .await
            .map_err(|e| format!("Failed to send query to Hydra API: {e}"))?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(format!(
                "Hydra API returned HTTP {}: {}",
                status.as_u16(),
                body
            ));
        }
        response
            .json::<Vec<HydraRepack>>()
            .await
            .map_err(|e| format!("Failed to parse Hydra repacks response: {e}"))
    }

    async fn search_catalogue_by_title(
        &self,
        title: &str,
        hydra_source_ids: &[String],
    ) -> Result<Vec<HydraRepack>, String> {
        let search_url = format!("{}/catalogue/search", HYDRA_API_BASE);
        let mut search_req = CatalogueSearchRequest {
            title: title.to_string(),
            take: 10,
            skip: 0,
            download_source_fingerprints: Vec::new(),
        };
        let search_resp = self
            .client
            .post(&search_url)
            .json(&search_req)
            .send()
            .await
            .map_err(|e| format!("Catalogue search request failed: {e}"))?;

        let status = search_resp.status();
        let mut search_result = if status.is_success() {
            search_resp
                .json::<HydraSearchResponse>()
                .await
                .map_err(|e| format!("Failed to parse search response: {e}"))?
        } else {
            HydraSearchResponse { edges: Vec::new() }
        };

        if search_result.edges.is_empty() {
            let cleaned = clean_search_title(title);
            if cleaned != title {
                search_req.title = cleaned;
                if let Ok(resp) = self.client.post(&search_url).json(&search_req).send().await {
                    if resp.status().is_success() {
                        if let Ok(res) = resp.json::<HydraSearchResponse>().await {
                            search_result = res;
                        }
                    }
                }
            }
        }
        if search_result.edges.is_empty() {
            return Ok(Vec::new());
        }

        let trimmed_title = title.trim();
        let query_tokens: Vec<String> = trimmed_title
            .split_whitespace()
            .map(|t| t.to_ascii_lowercase())
            .collect();
        let best_match = search_result.edges.iter().max_by(|a, b| {
            let a_exact = a.title.eq_ignore_ascii_case(trimmed_title);
            let b_exact = b.title.eq_ignore_ascii_case(trimmed_title);
            if a_exact != b_exact {
                return if a_exact {
                    std::cmp::Ordering::Greater
                } else {
                    std::cmp::Ordering::Less
                };
            }
            let score_a = score_match(&query_tokens, trimmed_title, &a.title);
            let score_b = score_match(&query_tokens, trimmed_title, &b.title);
            score_a
                .partial_cmp(&score_b)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let Some(best_match) = best_match else {
            return Ok(Vec::new());
        };
        if score_match(&query_tokens, trimmed_title, &best_match.title) < 0.3 {
            return Ok(Vec::new());
        }

        let repacks_url = format!(
            "{}/games/{}/{}/download-sources",
            HYDRA_API_BASE, best_match.shop, best_match.object_id
        );
        let mut query_params = vec![("take".to_string(), "100".to_string()), ("skip".to_string(), "0".to_string())];
        for id in hydra_source_ids {
            query_params.push(("downloadSourceIds[]".to_string(), id.clone()));
        }
        let repacks_resp = self
            .client
            .get(&repacks_url)
            .query(&query_params)
            .send()
            .await
            .map_err(|e| format!("Failed to get repacks from Hydra API: {e}"))?;
        let repacks_status = repacks_resp.status();
        if !repacks_status.is_success() {
            let body = repacks_resp.text().await.unwrap_or_default();
            return Err(format!(
                "Hydra API returned HTTP {} on repacks: {}",
                repacks_status.as_u16(),
                body
            ));
        }
        repacks_resp
            .json::<Vec<HydraRepack>>()
            .await
            .map_err(|e| format!("Failed to parse repacks response: {e}"))
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

fn cache_hydra_response(
    db: &Db,
    local_source_id: String,
    hydra_resp: &HydraDownloadSourceResponse,
    game_source_opt: Option<GameSource>,
    fetched_at: u64,
) -> Result<(), String> {
    let game_source = game_source_opt.unwrap_or_else(|| GameSource {
        name: hydra_resp.name.clone(),
        downloads: Vec::new(),
    });
    db::sources::commit_cached_source(db, &local_source_id, &hydra_resp.id, &game_source, fetched_at)?;
    // When the raw JSON was unreachable the cached downloads are
    // empty (game_count was set to 0 by commit_cached_source), but
    // Hydra's download_count is still authoritative. Patch the
    // source's game_count so the UI shows the real tally.
    if game_source.downloads.is_empty() && hydra_resp.download_count > 0 {
        db::sources::update_game_count(db, &local_source_id, hydra_resp.download_count)?;
    }
    Ok(())
}

/// Match bm25's "more negative = better" output back to the
/// frontend's `[0, 1]` range. bm25 doesn't have a fixed scale per
/// corpus, so we apply a simple saturation curve — strong matches
/// map near 1.0, weak matches near 0.0.
fn rescale_scores(input: Vec<MatchedDownload>) -> Vec<MatchedDownload> {
    let min = input
        .iter()
        .map(|m| m.match_score)
        .fold(f32::INFINITY, f32::min);
    let max = input
        .iter()
        .map(|m| m.match_score)
        .fold(f32::NEG_INFINITY, f32::max);
    let span = (max - min).abs();
    let only_one = input.len() == 1;
    input
        .into_iter()
        .map(|mut m| {
            m.match_score = if only_one {
                // Isolated result: bm25 has no relative scale, so
                // we don't claim "perfect match". Surface a neutral
                // 0.5 so the UI's match-score ordering is not
                // misleading when the corpus returned exactly one
                // fuzzy hit.
                0.5
            } else if span > 0.0 {
                1.0 - ((m.match_score - min) / span)
            } else {
                0.5
            };
            m
        })
        .collect()
}

fn clean_search_title(title: &str) -> String {
    let mut cleaned = title
        .replace('®', "")
        .replace('™', "")
        .replace('©', "");
    if let Some(pos) = cleaned.find(':') {
        let first_part = cleaned[..pos].trim();
        if first_part.len() >= 3 {
            cleaned = first_part.to_string();
        }
    } else if let Some(pos) = cleaned.find('-') {
        let first_part = cleaned[..pos].trim();
        if first_part.len() >= 3 {
            cleaned = first_part.to_string();
        }
    }
    cleaned.trim().to_string()
}

static SOURCE_ID_COUNTER: AtomicU64 = AtomicU64::new(0);

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn unix_now_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

fn derive_name_from_url(url: &str) -> String {
    let path = url
        .split('?')
        .next()
        .unwrap_or(url)
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("Source")
        .to_string();
    let stem = if path.is_empty() {
        "Source".to_string()
    } else {
        path.trim_end_matches(".json").replace(['-', '_'], " ")
    };
    stem.split_whitespace()
        .map(|w| {
            let mut chars = w.chars();
            match chars.next() {
                Some(c) => c.to_ascii_uppercase().to_string() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn score_match(query_tokens: &[String], raw_query: &str, title: &str) -> f32 {
    let title_lc = title.to_ascii_lowercase();
    if query_tokens.is_empty() {
        return 0.0;
    }
    let mut hits = 0;
    for tok in query_tokens {
        if title_lc.contains(tok) {
            hits += 1;
        }
    }
    let token_score = hits as f32 / query_tokens.len() as f32;
    let substring_bonus = if title_lc.contains(&raw_query.to_ascii_lowercase()) {
        0.2
    } else {
        0.0
    };
    (token_score * 0.8 + substring_bonus).min(1.0)
}

// ─── Tauri commands ─────────────────────────────────────────────────────────
//
// State binding: `Arc<SourceManager>` directly (no Mutex —
// concurrency is provided by SQLite WAL + the per-method
// `&self`/`&mut self` borrow). All commands extract state via
// `app.state::<Arc<SourceManager>>()` or accept it as a
// `tauri::State<'_, Arc<SourceManager>>` parameter.

#[tauri::command]
pub async fn sources_add(
    state: tauri::State<'_, Arc<SourceManager>>,
    url: String,
    name: String,
) -> Result<SourceLink, String> {
    state.add_source(url, name).await
}

#[tauri::command]
pub async fn sources_remove(
    state: tauri::State<'_, Arc<SourceManager>>,
    id: String,
) -> Result<(), String> {
    state.remove_source(&id)
}

#[tauri::command]
pub async fn sources_toggle(
    state: tauri::State<'_, Arc<SourceManager>>,
    id: String,
) -> Result<(), String> {
    state.toggle_source(&id)
}

#[tauri::command]
pub async fn sources_list(
    state: tauri::State<'_, Arc<SourceManager>>,
) -> Result<Vec<SourceLink>, String> {
    state.list_sources()
}

#[tauri::command]
pub async fn sources_refresh(
    state: tauri::State<'_, Arc<SourceManager>>,
    id: String,
) -> Result<(), String> {
    state.refresh_source(&id).await
}

#[tauri::command]
pub async fn sources_refresh_all(
    state: tauri::State<'_, Arc<SourceManager>>,
) -> Result<(), String> {
    state.refresh_all().await
}

#[tauri::command]
pub async fn sources_search_game(
    state: tauri::State<'_, Arc<SourceManager>>,
    query: String,
    steam_app_id: Option<u32>,
) -> Result<Vec<MatchedDownload>, String> {
    state.search_online(&query, steam_app_id).await
}
