//! Source link management for the download feature.
//!
//! "Sources" are JSON files hosted on a third-party URL that list
//! available downloads for various games. The most common shape is
//! the **Hydra** format — a single object with a `name` and a
//! `downloads` array, where each entry has `title`, `fileSize`, and
//! `uris` (an array of magnet: / .torrent URLs).
//!
//! Instead of fetching source JSON directly or opening an in-app
//! Webview, we delegate to the **Hydra API** — a community service
//! that crawls, validates, and serves download-source data. Adding
//! a source POSTs the URL to Hydra's `/download-sources` endpoint;
//! refreshing calls `/download-sources/sync`. Both are unauthenticated.
//!
//! ## Persistence
//!
//! Source metadata (id, url, name, enabled, last_fetched, game_count,
//! hydra_source_id) is persisted to `<app_data_dir>/sources.json` after
//! every mutation. The full download payload is persisted on disk as
//! `<app_data_dir>/sources_cache/{source_id}.json` and re-loaded on
//! startup so sources work offline after the first Hydra fetch.
//!
//! ## Concurrency
//!
//! The struct sits behind a `tokio::sync::Mutex` in Tauri state. All
//! methods take `&mut self`, so callers `lock().await` for the duration
//! of the operation. Network calls to the Hydra API happen inside the
//! lock — acceptable because source operations are user-driven and
//! infrequent.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

// ─── Constants ──────────────────────────────────────────────────────────────

/// Production Hydra API base URL.
const HYDRA_API_BASE: &str = "https://hydra-api-us-east-1.losbroxas.org";

// ─── JSON schema (Hydra-compatible) ─────────────────────────────────────────

/// A single download entry inside a source.
///
/// Field aliases: the Hydra format uses `fileSize` and `uploadDate`
/// (camelCase) but some other schemas (Hydra forks, hand-rolled
/// lists) use `filesize` or `file_size`. We accept any of the three so
/// a pasted URL from a non-canonical source still works.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SourceDownload {
    pub title: String,
    #[serde(default, alias = "filesize", alias = "file_size")]
    pub file_size: String,
    /// Magnet links, .torrent URLs, or both. Treated as opaque URIs
    /// by this module — torrent_engine validates the scheme before
    /// handing off.
    #[serde(default)]
    pub uris: Vec<String>,
    #[serde(default, alias = "uploaddate", alias = "upload_date")]
    pub upload_date: Option<String>,
    /// Optional pre-parsed magnet — some sources (Hydra) populate
    /// this as a convenience for clients that can't parse a magnet
    /// URI themselves. We use it as a fallback when the `uris` array
    /// is missing or empty.
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

/// Request body for `POST /download-sources`.
#[derive(Debug, Serialize)]
struct AddDownloadSourceRequest {
    url: String,
}

/// Request body for `POST /download-sources/sync`.
#[derive(Debug, Serialize)]
struct SyncDownloadSourcesRequest {
    ids: Vec<String>,
}

/// Response from `POST /download-sources` and entries in the
/// `POST /download-sources/sync` response array.
/// The Hydra API returns catalog metadata only — the actual `downloads`
/// array must be fetched directly from the source URL.
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

// ─── User-facing records ────────────────────────────────────────────────────

/// Metadata for a single source the user has added. Persisted to
/// `<app_data_dir>/sources.json` after every mutation.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SourceLink {
    pub id: String,
    /// ID assigned by the Hydra API — used as the key for subsequent
    /// sync/refresh calls. Empty string for legacy sources added
    /// before the Hydra API migration.
    #[serde(default)]
    pub hydra_source_id: String,
    pub url: String,
    pub name: String,
    pub enabled: bool,
    /// Unix seconds of the last successful fetch, or `None` if the
    /// source has never been fetched (e.g. URL failed validation).
    pub last_fetched: Option<u64>,
    /// Number of download entries in the most recent successful
    /// fetch. Zero is valid (an empty source).
    pub game_count: usize,
}

/// One cached source. Persisted to `<app_data_dir>/sources_cache/{source_id}.json`
/// so the downloads list survives a restart.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CachedSource {
    pub source_id: String,
    /// ID assigned by the Hydra API. Empty string if not yet registered.
    #[serde(default)]
    pub hydra_source_id: String,
    pub data: GameSource,
    /// Unix seconds of when this was fetched.
    pub fetched_at: u64,
}

/// A matched download for the DownloadModal. The frontend renders
/// these directly; `match_score` is a 0-1 value the UI uses to
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
    /// OR if we found a `magnet:` URI inside the `uris` array). The
    /// torrent engine prefers this over the raw uris array.
    pub magnet: Option<String>,
    pub upload_date: Option<String>,
    /// 0.0 (no match) - 1.0 (perfect match).
    pub match_score: f32,
}

// ─── SourceManager ──────────────────────────────────────────────────────────

pub struct SourceManager {
    /// Disk-backed metadata list.
    sources: Vec<SourceLink>,
    /// In-memory cache. Hydrated from disk on startup; kept in sync
    /// with disk after every add/refresh.
    cache: HashMap<String, CachedSource>,
    /// Where `sources.json` is written. Set at construction so the
    /// Tauri command layer doesn't need to re-resolve it.
    sources_file: PathBuf,
    /// Where per-source download cache files live.
    cache_dir: PathBuf,
    /// Shared HTTP client. Used for Hydra API calls.
    client: reqwest::Client,
}

impl SourceManager {
    pub fn new(cache_dir: PathBuf) -> Self {
        let sources_cache = cache_dir.join("sources_cache");
        Self {
            sources: Vec::new(),
            cache: HashMap::new(),
            sources_file: cache_dir.join("sources.json"),
            cache_dir: sources_cache,
            client: reqwest::Client::builder()
                .user_agent("Gamelib/1.0 (+hydra-api)")
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .expect("HTTP client build is infallible with these settings"),
        }
    }

    /// Load sources + cached downloads from disk. Called once at
    /// startup. Missing files are not errors — they just mean the
    /// user has no sources yet.
    pub fn load_sources(&mut self) -> Result<(), String> {
        // ── Metadata ──────────────────────────────────────────────
        if self.sources_file.exists() {
            let data = fs::read_to_string(&self.sources_file)
                .map_err(|e| format!("Failed to read sources.json: {}", e))?;
            if !data.trim().is_empty() {
                self.sources = serde_json::from_str(&data)
                    .map_err(|e| format!("Failed to parse sources.json: {}", e))?;
            }
        }

        // ── Cache ─────────────────────────────────────────────────
        if self.cache_dir.exists() {
            if let Ok(entries) = fs::read_dir(&self.cache_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().map_or(false, |e| e == "json") {
                        match fs::read_to_string(&path) {
                            Ok(data) => {
                                if data.trim().is_empty() {
                                    continue;
                                }
                                match serde_json::from_str::<CachedSource>(&data) {
                                    Ok(cached) => {
                                        self.cache
                                            .insert(cached.source_id.clone(), cached);
                                    }
                                    Err(e) => {
                                        eprintln!(
                                            "[source_manager] failed to parse cache file {:?}: {}",
                                            path, e
                                        );
                                    }
                                }
                            }
                            Err(e) => {
                                eprintln!(
                                    "[source_manager] failed to read cache file {:?}: {}",
                                    path, e
                                );
                            }
                        }
                    }
                }
            }
        }

        Ok(())
    }

    /// Persist current source metadata to disk. Called after every
    /// mutation (add / remove / toggle / refresh).
    fn save_sources(&self) -> Result<(), String> {
        if let Some(parent) = self.sources_file.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create sources dir: {}", e))?;
        }
        let data = serde_json::to_string_pretty(&self.sources)
            .map_err(|e| format!("Failed to serialize sources: {}", e))?;
        fs::write(&self.sources_file, data)
            .map_err(|e| format!("Failed to write sources.json: {}", e))?;
        Ok(())
    }

    /// Save a single cached source to disk.
    fn save_cache_for_source(&self, cached: &CachedSource) -> Result<(), String> {
        fs::create_dir_all(&self.cache_dir)
            .map_err(|e| format!("Failed to create cache dir: {}", e))?;
        let file_path = self.cache_dir.join(format!("{}.json", cached.source_id));
        let data = serde_json::to_string_pretty(cached)
            .map_err(|e| format!("Failed to serialize cache: {}", e))?;
        fs::write(&file_path, data)
            .map_err(|e| format!("Failed to write cache file: {}", e))?;
        Ok(())
    }

    /// Delete a cached source file from disk.
    fn remove_cache_for_source(&self, source_id: &str) {
        let file_path = self.cache_dir.join(format!("{}.json", source_id));
        if file_path.exists() {
            let _ = fs::remove_file(&file_path);
        }
    }

    // ── Hydra API helpers ──────────────────────────────────────────────

    /// POST to Hydra `/download-sources` to register a URL and get
    /// back catalog metadata (id, name, fingerprint, downloadCount).
    /// The actual download entries must be fetched separately from
    /// the source URL via `fetch_source_json`.
    async fn hydra_add_source(
        &self,
        url: &str,
    ) -> Result<HydraDownloadSourceResponse, String> {
        let endpoint = format!("{}/download-sources", HYDRA_API_BASE);
        let response = self
            .client
            .post(&endpoint)
            .json(&AddDownloadSourceRequest {
                url: url.to_string(),
            })
            .send()
            .await
            .map_err(|e| format!("Hydra API unreachable: {}", e))?;

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
            .json::<HydraDownloadSourceResponse>()
            .await
            .map_err(|e| format!("Failed to parse Hydra API response: {}", e))
    }

    /// GET the source JSON directly from the source URL and parse it
    /// as a `GameSource`. This is the source-of-truth for the actual
    /// download entries (title, fileSize, uris). May fail if the URL
    /// is behind Cloudflare or otherwise unreachable.
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
            .map_err(|e| format!("Failed to fetch source JSON: {}", e))?;

        let status = response.status();
        if !status.is_success() {
            return Err(format!("HTTP {} from source URL", status.as_u16()));
        }

        // Check content-type to detect Cloudflare HTML challenges.
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if content_type.contains("text/html") {
            return Err("Source URL returned HTML (likely Cloudflare challenge)".to_string());
        }

        // No size cap — source JSON files can be several MB for
        // large catalogs (e.g. 3+ MB). Streaming the full body is
        // safe because serde_json validates it incrementally.
        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("Body read failed: {}", e))?;
        serde_json::from_slice::<GameSource>(&bytes)
            .map_err(|e| format!("Source JSON parse failed: {}", e))
    }

    /// POST to Hydra `/download-sources/sync` to refresh one or more
    /// sources. Returns the array of updated source data.
    ///
    /// Tolerates 404 (source not in Hydra catalog) and returns an
    /// empty Vec rather than erroring — the caller can fall back to
    /// fetching the source JSON directly from its URL.
    async fn hydra_sync_sources(
        &self,
        ids: &[String],
    ) -> Result<Vec<HydraDownloadSourceResponse>, String> {
        let endpoint = format!("{}/download-sources/sync", HYDRA_API_BASE);
        let response = self
            .client
            .post(&endpoint)
            .json(&SyncDownloadSourcesRequest {
                ids: ids.to_vec(),
            })
            .send()
            .await
            .map_err(|e| format!("Hydra API unreachable: {}", e))?;

        let status = response.status();
        // 404 means none of the submitted IDs are in Hydra's catalog
        // — not a fatal error, just no results.
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
            .map_err(|e| format!("Failed to parse Hydra sync response: {}", e))
    }

    /// Ensure a source has a Hydra ID. If `hydra_source_id` is empty,
    /// register the URL with Hydra and save the returned ID. Returns
    /// the (possibly newly obtained) Hydra source ID.
    async fn ensure_hydra_id(&mut self, local_source_id: &str) -> Result<String, String> {
        // Find the source index in self.sources (not just the ref)
        // so we can mutate in place.
        let idx = self
            .sources
            .iter()
            .position(|s| s.id == local_source_id)
            .ok_or_else(|| format!("Source not found: {}", local_source_id))?;

        if !self.sources[idx].hydra_source_id.is_empty() {
            return Ok(self.sources[idx].hydra_source_id.clone());
        }

        // Register with Hydra.
        let url = self.sources[idx].url.clone();
        let hydra_resp = self.hydra_add_source(&url).await?;

        // Update the source's hydra_source_id.
        self.sources[idx].hydra_source_id = hydra_resp.id;
        self.save_sources()?;

        Ok(self.sources[idx].hydra_source_id.clone())
    }

    /// Persist the cached download data + update in-memory state for a
    /// source. Shared by `cache_hydra_response` and the direct-fetch
    /// fallback paths in `refresh_source` / `refresh_all`.
    ///
    /// `fallback_count` is used when the fetched `game_source.downloads`
    /// is empty — typically `hydra_resp.download_count` (for Cloudflare-
    /// protected sources where direct fetch failed) or 0 (pure direct fetch).
    fn commit_cached_source(
        &mut self,
        local_source_id: &str,
        hydra_source_id: String,
        game_source: GameSource,
        fetched_at: u64,
        fallback_count: usize,
    ) -> usize {
        let game_count = if game_source.downloads.is_empty() && fallback_count > 0 {
            fallback_count
        } else {
            game_source.downloads.len()
        };
        let cached = CachedSource {
            source_id: local_source_id.to_string(),
            hydra_source_id,
            data: game_source,
            fetched_at,
        };

        if let Err(e) = self.save_cache_for_source(&cached) {
            eprintln!(
                "[source_manager] failed to save cache for {}: {}",
                local_source_id, e
            );
        }
        self.cache
            .insert(local_source_id.to_string(), cached);

        if let Some(s) = self.sources.iter_mut().find(|s| s.id == local_source_id) {
            s.last_fetched = Some(fetched_at);
            s.game_count = game_count;
        }

        game_count
    }

    /// Cache the download data for a source using Hydra metadata.
    /// Accepts an `Option<GameSource>` from the (possibly failed)
    /// direct source-URL fetch. When `None`, defaults to an empty
    /// downloads list.
    fn cache_hydra_response(
        &mut self,
        local_source_id: &str,
        hydra_resp: &HydraDownloadSourceResponse,
        game_source_opt: Option<GameSource>,
        fetched_at: u64,
    ) {
        let game_source = game_source_opt.unwrap_or_else(|| GameSource {
            name: hydra_resp.name.clone(),
            downloads: Vec::new(),
        });
        self.commit_cached_source(
            local_source_id,
            hydra_resp.id.clone(),
            game_source,
            fetched_at,
            hydra_resp.download_count,
        );
    }

    // ── Public API ───────────────────────────────────────────────────────

    /// Add a new source via the Hydra API. POSTs the URL to
    /// `/download-sources`, persists the returned data, and returns
    /// the new `SourceLink`.
    pub async fn add_source(
        &mut self,
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
        if self.sources.iter().any(|s| s.url == trimmed) {
            return Err("This source URL has already been added".to_string());
        }

        // 1. Register with Hydra API to get catalog metadata.
        let hydra_resp = self.hydra_add_source(&trimmed).await?;

        // 2. Fetch the full source JSON from the URL for the actual
        //    downloads array. Cloudflare-protected sources may fail
        //    here — we still save the source; the fallback_count in
        //    commit_cached_source keeps the Hydra download_count.
        let game_source = match self.fetch_source_json(&hydra_resp.url).await {
            Ok(src) => src,
            Err(e) => {
                eprintln!(
                    "[source_manager] Warning: fetch_source_json failed for {}: {}",
                    hydra_resp.url, e
                );
                GameSource {
                    name: hydra_resp.name.clone(),
                    downloads: Vec::new(),
                }
            }
        };

        // Build local metadata.
        let now_nanos = unix_now_nanos();
        let now_seconds = unix_now();
        let counter = SOURCE_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
        let local_id = format!("src_{}_{}", now_nanos, counter);

        let display_name = if name.trim().is_empty() {
            derive_name_from_url(&trimmed)
        } else {
            name.trim().to_string()
        };

        let source = SourceLink {
            id: local_id.clone(),
            hydra_source_id: hydra_resp.id.clone(),
            url: trimmed.clone(),
            name: display_name.clone(),
            enabled: true,
            last_fetched: Some(now_seconds),
            game_count: 0, // populated by commit_cached_source below
        };
        self.sources.push(source);

        // Cache the downloads + update game_count + persist.
        let game_count = self.commit_cached_source(
            &local_id,
            hydra_resp.id.clone(),
            game_source,
            now_seconds,
            hydra_resp.download_count,
        );
        self.save_sources()?;

        let source = SourceLink {
            id: local_id,
            hydra_source_id: hydra_resp.id,
            url: trimmed,
            name: display_name,
            enabled: true,
            last_fetched: Some(now_seconds),
            game_count,
        };

        Ok(source)
    }

    /// Remove a source by id. Idempotent — returns Ok(()) if the
    /// id isn't found, so the frontend can be optimistic.
    pub fn remove_source(&mut self, id: &str) -> Result<(), String> {
        self.sources.retain(|s| s.id != id);
        self.cache.remove(id);
        self.remove_cache_for_source(id);
        self.save_sources()
    }

    /// Toggle a source's enabled flag. No-op (with an error) if the
    /// id isn't found.
    pub fn toggle_source(&mut self, id: &str) -> Result<(), String> {
        if let Some(s) = self.sources.iter_mut().find(|s| s.id == id) {
            s.enabled = !s.enabled;
            self.save_sources()?;
            Ok(())
        } else {
            Err(format!("Source not found: {}", id))
        }
    }

    /// Refresh a single source. Tries Hydra sync first; if that
    /// returns nothing (404, unknown ID), falls back to re-fetching
    /// the source JSON directly from the source URL.
    /// Legacy sources without a Hydra ID are auto-registered first.
    pub async fn refresh_source(&mut self, id: &str) -> Result<(), String> {
        let now = unix_now();

        // Try Hydra sync if we have (or can get) a Hydra ID.
        let hydra_sync_result = async {
            let hydra_id = self.ensure_hydra_id(id).await?;
            self.hydra_sync_sources(&[hydra_id]).await
        }
        .await;

        match hydra_sync_result {
            Ok(results) if !results.is_empty() => {
                // Hydra returned fresh metadata — use it + re-fetch JSON.
                let hydra_resp = &results[0];
                let game_source_opt = self
                    .fetch_source_json(&hydra_resp.url)
                    .await
                    .ok();
                self.cache_hydra_response(id, hydra_resp, game_source_opt, now);
            }
            _ => {
                // Hydra sync failed or returned nothing. Fall back to
                // fetching the source JSON directly from the URL.
                let source = self
                    .sources
                    .iter()
                    .find(|s| s.id == id)
                    .ok_or_else(|| format!("Source not found: {}", id))?;
                let url = source.url.clone();
                let hydra_id = source.hydra_source_id.clone();

                match self.fetch_source_json(&url).await {
                    Ok(game_source) => {
                        self.commit_cached_source(id, hydra_id, game_source, now, 0);
                    }
                    Err(e) => {
                        eprintln!(
                            "[source_manager] refresh {} failed (Hydra sync + direct fetch both failed): {}",
                            id, e
                        );
                        return Err(format!("Refresh failed: {}", e));
                    }
                }
            }
        }

        self.save_sources()
    }

    /// Refresh every enabled source. Tries Hydra bulk sync first;
    /// any sources not covered by Hydra are refreshed individually
    /// via direct source-URL fetch.
    pub async fn refresh_all(&mut self) -> Result<(), String> {
        let enabled: Vec<(String, String, String)> = self
            .sources
            .iter()
            .filter(|s| s.enabled)
            .map(|s| (s.id.clone(), s.url.clone(), s.hydra_source_id.clone()))
            .collect();

        if enabled.is_empty() {
            return Ok(());
        }

        let now = unix_now();
        let mut refreshed = 0usize;
        let mut hydrated = HashSet::new();

        // 1. Ensure all enabled sources have a Hydra ID.
        let mut hydra_ids: Vec<String> = Vec::with_capacity(enabled.len());
        for (local_id, _, _) in &enabled {
            match self.ensure_hydra_id(local_id).await {
                Ok(hid) => {
                    if !hid.is_empty() {
                        hydra_ids.push(hid);
                    }
                }
                Err(e) => {
                    eprintln!(
                        "[source_manager] failed to get Hydra ID for {}: {}",
                        local_id, e
                    );
                }
            }
        }

        // 2. Bulk sync with Hydra.
        if !hydra_ids.is_empty() {
            if let Ok(results) = self.hydra_sync_sources(&hydra_ids).await {
                let hydra_to_local: HashMap<String, String> = self
                    .sources
                    .iter()
                    .map(|s| (s.hydra_source_id.clone(), s.id.clone()))
                    .collect();

                for hydra_resp in &results {
                    if let Some(local_id) = hydra_to_local.get(&hydra_resp.id) {
                        let game_source_opt =
                            self.fetch_source_json(&hydra_resp.url).await.ok();
                        self.cache_hydra_response(
                            local_id,
                            hydra_resp,
                            game_source_opt,
                            now,
                        );
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

        // 3. Refresh any sources not covered by Hydra sync via
        //    direct source-URL fetch.
        for (local_id, url, _) in &enabled {
            if hydrated.contains(local_id) {
                continue;
            }
            match self.fetch_source_json(url).await {
                Ok(game_source) => {
                    let hydra_id = self
                        .sources
                        .iter()
                        .find(|s| &s.id == local_id)
                        .map(|s| s.hydra_source_id.clone())
                        .unwrap_or_default();
                    self.commit_cached_source(local_id, hydra_id, game_source, now, 0);
                    refreshed += 1;
                }
                Err(e) => {
                    eprintln!(
                        "[source_manager] refresh {} failed: {}",
                        local_id, e
                    );
                }
            }
        }

        self.save_sources()?;

        if refreshed == 0 && !enabled.is_empty() {
            Err(format!(
                "Failed to refresh any of {} enabled source(s)",
                enabled.len()
            ))
        } else {
            Ok(())
        }
    }

    /// Get a snapshot of the current source list (metadata only,
    /// not the cached downloads).
    pub fn list_sources(&self) -> Vec<SourceLink> {
        self.sources.clone()
    }

    /// Search every ENABLED source's cached downloads for a fuzzy
    /// match against `query`. Returns matches sorted by score
    /// descending.
    ///
    /// `query` is the game name the user is looking for. Matching:
    ///   * Tokenize on whitespace.
    ///   * Score = (tokens present in title) / (total tokens).
    ///   * Bonus +0.2 if the FULL query is a substring of the title.
    ///   * Threshold of 0.3 to keep the result list focused.
    pub fn search(&self, query: &str) -> Vec<MatchedDownload> {
        let q = query.trim();
        if q.is_empty() {
            return Vec::new();
        }
        let query_tokens: Vec<String> = q
            .split_whitespace()
            .map(|t| t.to_ascii_lowercase())
            .collect();
        let mut results = Vec::new();
        for source in &self.sources {
            if !source.enabled {
                continue;
            }
            let Some(cached) = self.cache.get(&source.id) else {
                continue;
            };
            for download in &cached.data.downloads {
                let score = score_match(&query_tokens, q, &download.title);
                if score < 0.3 {
                    continue;
                }
                let magnet = download
                    .magnet
                    .clone()
                    .or_else(|| {
                        download
                            .uris
                            .iter()
                            .find(|u| u.starts_with("magnet:"))
                            .cloned()
                    });
                results.push(MatchedDownload {
                    source_name: source.name.clone(),
                    source_id: source.id.clone(),
                    title: download.title.clone(),
                    file_size: download.file_size.clone(),
                    uris: download.uris.clone(),
                    magnet,
                    upload_date: download.upload_date.clone(),
                    match_score: score,
                });
            }
        }
        results.sort_by(|a, b| {
            b.match_score
                .partial_cmp(&a.match_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        results
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Monotonic per-process counter that ensures generated source ids
/// are unique even when two `add_source` calls land in the same
/// nanosecond (which can happen on a fast SSD with parallel command
/// dispatch). Combined with `unix_now_nanos()` this gives a
/// 128-bit unique-enough id without pulling in the `uuid` crate.
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
    // Take the last non-empty path segment, strip the .json
    // extension, replace separators with spaces, title-case it.
    // Examples:
    //   "https://hydra.example/sources/fitgirl.json" -> "Fitgirl"
    //   "https://example.com/list" -> "List"
    let path = url
        .split('?')
        .next()
        .unwrap_or(url)
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("Source")
        .to_string();
    // Guard against empty path segments (e.g. trailing slash URLs).
    let stem = if path.is_empty() {
        "Source".to_string()
    } else {
        path.trim_end_matches(".json").replace(['-', '_'], " ")
    };
    // Title-case the first letter of each word.
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
// State is `Arc<tokio::sync::Mutex<SourceManager>>`. The Tauri command
// futures need to be `Send` (Tauri's invoke handler requires it), and
// `tokio::sync::MutexGuard` is `Send` across `.await` — using
// `std::sync::Mutex` here produced non-Send futures because the guard
// isn't designed to be held across an await point.
//
// The lock IS held across the Hydra API `await` in `add_source`,
// `refresh_source`, and `refresh_all` — that ties up one tokio worker
// per concurrent source command. Source commands are user-driven
// (add / remove / refresh) and never overlap heavily, so the trade is
// acceptable.

#[tauri::command]
pub async fn sources_add(
    state: tauri::State<'_, Arc<tokio::sync::Mutex<SourceManager>>>,
    url: String,
    name: String,
) -> Result<SourceLink, String> {
    state.lock().await.add_source(url, name).await
}

/// Remove a source by id. Idempotent — returns Ok(()) if the
/// id isn't found, so the frontend can be optimistic.
#[tauri::command]
pub async fn sources_remove(
    state: tauri::State<'_, Arc<tokio::sync::Mutex<SourceManager>>>,
    id: String,
) -> Result<(), String> {
    state.lock().await.remove_source(&id)
}

#[tauri::command]
pub async fn sources_toggle(
    state: tauri::State<'_, Arc<tokio::sync::Mutex<SourceManager>>>,
    id: String,
) -> Result<(), String> {
    state.lock().await.toggle_source(&id)
}

#[tauri::command]
pub async fn sources_list(
    state: tauri::State<'_, Arc<tokio::sync::Mutex<SourceManager>>>,
) -> Result<Vec<SourceLink>, String> {
    Ok(state.lock().await.list_sources())
}

#[tauri::command]
pub async fn sources_refresh(
    state: tauri::State<'_, Arc<tokio::sync::Mutex<SourceManager>>>,
    id: String,
) -> Result<(), String> {
    state.lock().await.refresh_source(&id).await
}

#[tauri::command]
pub async fn sources_refresh_all(
    state: tauri::State<'_, Arc<tokio::sync::Mutex<SourceManager>>>,
) -> Result<(), String> {
    state.lock().await.refresh_all().await
}

#[tauri::command]
pub async fn sources_search_game(
    state: tauri::State<'_, Arc<tokio::sync::Mutex<SourceManager>>>,
    query: String,
) -> Result<Vec<MatchedDownload>, String> {
    Ok(state.lock().await.search(&query))
}
