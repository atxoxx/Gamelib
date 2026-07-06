//! Source link management for the download feature.
//!
//! "Sources" are JSON files hosted on a third-party URL that list
//! available downloads for various games. The most common shape is
//! the **Hydra** format — a single object with a `name` and a
//! `downloads` array, where each entry has `title`, `fileSize`, and
//! `uris` (an array of magnet: / .torrent URLs).
//!
//! We deliberately do NOT try to validate that a source URL is
//! "trustworthy" — the user adds the URL, the user is responsible
//! for it. We do cap source size on fetch (1 MB) to keep a malicious
//! URL from streaming the entire disk through `reqwest`.
//!
//! ## Persistence
//!
//! Source metadata (id, url, name, enabled, last_fetched, game_count)
//! is persisted to `<app_data_dir>/sources.json` after every mutation.
//! We persist ONLY the metadata — the parsed `GameSource` payload
//! (which can be megabytes) is held in memory and re-fetched on
//! app start, since a stale in-memory cache is much worse than a
//! 5-second wait for a refresh.
//!
//! ## Concurrency
//!
//! The struct sits behind a `Mutex` in Tauri state. All methods take
//! `&mut self`, so callers `lock().await` for the duration of the
//! operation. Refreshes that hit the network do their HTTP work
//! OUTSIDE the lock (see `refresh_source`) so concurrent reads
//! (searches) aren't blocked while a fetch is in flight.

use base64::{Engine as _, engine::general_purpose};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

// ─── JSON schema (Hydra-compatible) ─────────────────────────────────────────

/// A single download entry inside a source.
///
/// Field aliases: the Hydra format uses `fileSize` and `uploadDate`
/// (camelCase) but some other schemas (Hydra forks, hand-rolled
// lists) use `filesize` or `file_size`. We accept any of the three so
// a pasted URL from a non-canonical source still works.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SourceDownload {
    pub title: String,
    #[serde(alias = "filesize", alias = "file_size")]
    pub file_size: String,
    /// Magnet links, .torrent URLs, or both. Treated as opaque URIs
    /// by this module — torrent_engine validates the scheme before
    /// handing off.
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

// ─── User-facing records ────────────────────────────────────────────────────

/// Metadata for a single source the user has added. Persisted to
/// `<app_data_dir>/sources.json` after every mutation.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SourceLink {
    pub id: String,
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

/// One cached source. Held in memory only (not persisted) so a
/// restart re-fetches and re-validates.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CachedSource {
    pub source_id: String,
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
    /// In-memory cache. Keyed by `SourceLink.id`.
    cache: HashMap<String, CachedSource>,
    /// Where `sources.json` is written. Set at construction so the
    /// Tauri command layer doesn't need to re-resolve it.
    sources_file: PathBuf,
    /// Shared HTTP client. Reused across refreshes so connection
    /// pools survive between requests.
    client: reqwest::Client,
}

impl SourceManager {
    pub fn new(cache_dir: PathBuf) -> Self {
        Self {
            sources: Vec::new(),
            cache: HashMap::new(),
            sources_file: cache_dir.join("sources.json"),
            client: reqwest::Client::builder()
                .user_agent("Gamelib/1.0 (+source-manager)")
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .expect("HTTP client build is infallible with these settings"),
        }
    }

    /// Load sources from disk. Called once at startup. Missing file
    /// is not an error — it just means the user has no sources yet.
    pub fn load_sources(&mut self) -> Result<(), String> {
        if !self.sources_file.exists() {
            return Ok(());
        }
        let data = fs::read_to_string(&self.sources_file)
            .map_err(|e| format!("Failed to read sources.json: {}", e))?;
        // Empty file (e.g. a crashed previous write left it zero
        // bytes) parses as an empty Vec rather than erroring.
        if data.trim().is_empty() {
            return Ok(());
        }
        self.sources = serde_json::from_str(&data)
            .map_err(|e| format!("Failed to parse sources.json: {}", e))?;
        Ok(())
    }

    /// Persist current source metadata to disk. Called after every
    /// mutation (add / remove / toggle). The cache is intentionally
    /// not persisted.
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

    /// Add a new source. The URL is validated by attempting a
    /// fetch — we don't add a source we couldn't reach.
    pub async fn add_source(&mut self, url: String, name: String) -> Result<SourceLink, String> {
        let trimmed = url.trim().to_string();
        if trimmed.is_empty() {
            return Err("Source URL is empty".to_string());
        }
        // Reject obviously non-HTTP(S) URLs early so a typo'd
        // `file://` doesn't make it past validation.
        if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
            return Err("Source URL must start with http:// or https://".to_string());
        }
        // Duplicate-URL check. Same URL twice is almost certainly
        // a mistake, and we use URL as the join key when looking
        // for the matching source on subsequent fetches.
        if self.sources.iter().any(|s| s.url == trimmed) {
            return Err("This source URL has already been added".to_string());
        }
        // Fetch + parse before persisting. If the URL is unreachable
        // or the JSON is malformed, we surface the error and the
        // user gets nothing.
        let data = self.fetch_source(&trimmed).await?;
        self.commit_source(trimmed, name, data)
    }

    /// Add a new source from a pre-fetched JSON text payload.
    ///
    /// Used by the Settings "Add Source" flow when the upstream URL
    /// is Cloudflare-protected and the user has to manually click
    /// through a JS challenge inside an in-app Webview. The webview
    /// reads the rendered JSON (typically wrapped in a `<pre>` tag)
    /// and passes the text here, skipping the `reqwest` fetch entirely.
    ///
    /// The same URL/duplicate validation as `add_source` is applied,
    /// and the parsed `GameSource` payload is persisted by the same
    /// `commit_source` helper — both paths share the cache + metadata
    /// write so a source added either way behaves identically.
    pub async fn add_source_from_json(
        &mut self,
        url: String,
        name: String,
        json_text: String,
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
        // Trim defensive whitespace — the webview extraction path
        // may pick up trailing newlines or BOM markers depending on
        // how the source server formatted the response.
        let trimmed_json = json_text.trim();
        if trimmed_json.is_empty() {
            return Err("Captured JSON is empty".to_string());
        }
        let data: GameSource = serde_json::from_str(trimmed_json)
            .map_err(|e| format!("Source JSON parse failed: {}", e))?;
        // Note: we intentionally don't reject empty `downloads`
        // arrays — an empty source is valid Hydra JSON, and the
        // HTTP-fetch path (`add_source`) accepts it the same way.
        // Keeping the two paths symmetrical avoids "the same JSON
        // works when fetched but not when captured" surprises.
        self.commit_source(trimmed, name, data)
    }

    /// Persist a fully-parsed `GameSource`. Shared by `add_source`
    /// (HTTP-fetched) and `add_source_from_json` (Webview-captured)
    /// so both flows produce identical `SourceLink` records and
    /// populate the in-memory cache the same way.
    ///
    /// Assumes the caller has already validated the URL and
    /// confirmed there's no duplicate — those are URL-shape checks
    /// that don't depend on the body, so they're hoisted to each
    /// entry point for clearer error messages.
    fn commit_source(
        &mut self,
        url: String,
        name: String,
        data: GameSource,
    ) -> Result<SourceLink, String> {
        let now_nanos = unix_now_nanos();
        let now_seconds = unix_now();
        // `src_{nanos}_{counter}` gives uniqueness even for
        // back-to-back `add_source` calls that land in the same
        // nanosecond. The counter is monotonic across the process
        // lifetime so two parallel Tauri commands can't collide.
        let counter = SOURCE_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
        let id = format!("src_{}_{}", now_nanos, counter);
        let display_name = if name.trim().is_empty() {
            derive_name_from_url(&url)
        } else {
            name.trim().to_string()
        };
        let source = SourceLink {
            id: id.clone(),
            url,
            name: display_name,
            enabled: true,
            last_fetched: Some(now_seconds),
            game_count: data.downloads.len(),
        };
        self.cache.insert(
            id.clone(),
            CachedSource {
                source_id: id.clone(),
                data,
                fetched_at: now_seconds,
            },
        );
        self.sources.push(source.clone());
        self.save_sources()?;
        Ok(source)
    }

    /// Remove a source by id. Idempotent — returns Ok(()) if the
    /// id isn't found, so the frontend can be optimistic.
    pub fn remove_source(&mut self, id: &str) -> Result<(), String> {
        self.sources.retain(|s| s.id != id);
        self.cache.remove(id);
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

    /// Fetch the JSON at `url` and parse it as a `GameSource`.
    /// Network failures, HTTP errors, and JSON parse errors all
    /// surface as a `String` error.
    pub async fn fetch_source(&self, url: &str) -> Result<GameSource, String> {
        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| format!("Network error: {}", e))?;
        let status = response.status();
        if !status.is_success() {
            return Err(format!("HTTP {} from source", status.as_u16()));
        }
        // Cap the body so a malicious URL can't stream forever.
        const MAX_BYTES: u64 = 1_048_576; // 1 MiB
        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("Body read failed: {}", e))?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err(format!(
                "Source is too large ({} bytes > {} byte cap)",
                bytes.len(),
                MAX_BYTES
            ));
        }
        serde_json::from_slice::<GameSource>(&bytes)
            .map_err(|e| format!("Source JSON parse failed: {}", e))
    }

    /// Re-fetch the JSON for one source and refresh the in-memory
    /// cache + the persisted metadata. The HTTP work happens AFTER
    /// the lock is released (see the Tauri command wrapper) so
    /// concurrent reads aren't blocked.
    pub async fn refresh_source(&mut self, id: &str) -> Result<(), String> {
        let url = self
            .sources
            .iter()
            .find(|s| s.id == id)
            .ok_or_else(|| format!("Source not found: {}", id))?
            .url
            .clone();
        let data = self.fetch_source(&url).await?;
        let now = unix_now();
        self.cache.insert(
            id.to_string(),
            CachedSource {
                source_id: id.to_string(),
                data,
                fetched_at: now,
            },
        );
        if let Some(s) = self.sources.iter_mut().find(|s| s.id == id) {
            s.last_fetched = Some(now);
            s.game_count = self.cache[id].data.downloads.len();
        }
        self.save_sources()
    }

    /// Refresh every enabled source. Per-source failures are
    /// logged and skipped so one broken source doesn't fail the
    /// batch. Returns `Err(joined_failures)` when every refresh
    /// from the snapshot failed; returns `Ok(())` when at least
    /// one succeeded (partial success is still considered
    /// success — the cached version is still usable for the
    /// sources that worked).
    ///
    /// Concurrency: the count of "what we attempted" is
    /// snapshotted into `snapshot_len` *before* the loop runs.
    /// The previous implementation re-counted
    /// `self.sources.iter().filter(|s| s.enabled).count()` after
    /// the loop, which was a TOCTOU race: a `toggle_source` or
    /// `remove_source` arriving between the loop and the count
    /// would change the denominator and make the
    /// "did everything fail?" comparison nondeterministic. With
    /// `&mut self` held throughout, no concurrent mutation can
    /// happen, but using the snapshot is still the correct
    /// semantic — it compares against what we actually
    /// attempted, not what `self` looks like after the fact.
    pub async fn refresh_all(&mut self) -> Result<(), String> {
        let ids: Vec<String> = self
            .sources
            .iter()
            .filter(|s| s.enabled)
            .map(|s| s.id.clone())
            .collect();
        let snapshot_len = ids.len();
        if snapshot_len == 0 {
            return Ok(());
        }
        let mut failures: Vec<String> = Vec::new();
        for id in ids {
            if let Err(e) = self.refresh_source(&id).await {
                eprintln!("[source_manager] refresh {} failed: {}", id, e);
                failures.push(e);
            }
        }
        // Strict semantics: fail the whole call only if EVERY
        // refresh from the snapshot failed. A single source
        // returning a network error shouldn't fail the user's
        // "refresh all" intent.
        if failures.len() == snapshot_len {
            return Err(failures.join("; "));
        }
        Ok(())
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

/// Per-process counter for source-fetcher WebviewWindow labels.
/// Combined with `process::id()` this gives a label that's unique
/// across the process lifetime even if two `add_source_via_webview`
/// commands run concurrently (or back-to-back within the same
/// nanosecond, which the previous `nanos + pid` scheme could
/// collide on with low-resolution clocks).
static SOURCE_FETCHER_ID_COUNTER: AtomicU64 = AtomicU64::new(0);

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
    let stem = path.trim_end_matches(".json").replace(['-', '_'], " ");
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

// ─── Webview-based source capture ──────────────────────────────────────────
//
// `add_source_via_webview` exists for the (very common) case where the
// upstream source URL is gated by a Cloudflare "are you human?"
// interstitial: the Rust `reqwest` client can't run the JS challenge
// and never gets a `cf_clearance` cookie, so the HTTP-fetch path
// returns the CF HTML instead of the JSON.
//
// We open the URL in a Tauri WebviewWindow, inject a small floating
// "Capture JSON" + "Cancel" overlay via `initialization_script`,
// and wait for the user to click Capture after clearing the CF
// challenge (with the in-Webview cookie jar).
//
// Communication uses `on_navigation` interception (same pattern as
// `steam/auth.rs`) with a custom `gamelib-source://` URL scheme.
//
// To work around WebView2's ~2 MB top-frame navigation URL limit,
// large payloads are split into chunks by the JS and sent as
// sequential navigations:
//   * `gamelib-source://chunk/<index>/<total>/<data>` — one chunk
//   * `gamelib-source://cancel` — user clicked Cancel
//   * Window close / 5-min timeout — implicit cancel
//
// The Rust side collects chunks in a `ChunkState` shared via
// `Arc<Mutex<>>`. When all chunks arrive, they're joined and
// sent through the channel as a single signal.
//
// URL-safe base64 (`-`/`_` instead of `+`/`/`, no `=` padding)
// avoids WebView2 URL normalization corrupting the payload.
//
// Why not Tauri events (`window.__TAURI__.event.emit`)? The IPC
// bridge (`window.__TAURI_INTERNALS__`) is reliably injected into
// the main window via `withGlobalTauri`, but in
// `WebviewWindowBuilder` webviews loading external URLs, the
// bridge is not available — the async `emit()` silently fails
// with an unhandled Promise rejection.
//
// Chrome-mimicking user agent is mandatory: Cloudflare detects
// WebView2's default UA on Windows and serves a blank page. We
// re-use the same UA string `steam/auth.rs` uses for Steam login.

/// JavaScript injected into every page of the source-fetcher
/// Webview. Adds a floating "Capture JSON" + "Cancel" overlay that
/// stays on top of the page (including Cloudflare interstitials).
///
/// Runs at document_start. We poll for `document.body` because CF
/// can wipe + replace the DOM multiple times, defeating a one-shot
/// `DOMContentLoaded` listener. The `MutationObserver` fallback
/// re-attaches the overlay if a page wipe removes it. The id
/// check (`gamelib-source-fetcher`) makes the injection idempotent
/// so we never end up with two overlays on a re-injected page.
///
/// `buildUI` returns the assembled overlay with its `showStatus`
/// helper closed over the status element — that scoping is
/// important because the overlay can be torn down and rebuilt by
/// the MutationObserver re-injection, and each rebuild needs its
/// own status element.
pub const SOURCE_FETCHER_INIT_SCRIPT: &str = r#"
(function() {
    if (window.__gamelibSourceFetcherInjected) return;
    window.__gamelibSourceFetcherInjected = true;

    // URL-safe base64: replaces +/ with -_ and strips = padding
    // so WebView2 URL normalisation doesn't corrupt the payload.
    function toBase64Url(str) {
        var utf8 = unescape(encodeURIComponent(str));
        var base64 = btoa(utf8);
        return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    }

    function buildUI() {
        var host = document.createElement('div');
        host.id = 'gamelib-source-fetcher';
        host.style.cssText = [
            'position: fixed',
            'top: 16px',
            'right: 16px',
            'z-index: 2147483647',
            'display: flex',
            'flex-direction: column',
            'gap: 8px',
            'min-width: 160px',
            'font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            'user-select: none'
        ].join(';');

        var captureBtn = document.createElement('button');
        captureBtn.type = 'button';
        captureBtn.textContent = 'Capture JSON';
        captureBtn.style.cssText = [
            'padding: 10px 16px',
            'background: #1f6feb',
            'color: #fff',
            'border: 0',
            'border-radius: 6px',
            'font: inherit',
            'cursor: pointer',
            'box-shadow: 0 4px 12px rgba(0,0,0,0.25)'
        ].join(';');

        var cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = [
            'padding: 8px 14px',
            'background: #6e7681',
            'color: #fff',
            'border: 0',
            'border-radius: 6px',
            'font: 500 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            'cursor: pointer',
            'box-shadow: 0 4px 12px rgba(0,0,0,0.25)'
        ].join(';');

        var status = document.createElement('div');
        status.id = 'gsf-status';
        status.style.cssText = [
            'display: none',
            'padding: 8px 10px',
            'border-radius: 6px',
            'background: rgba(239, 68, 68, 0.12)',
            'color: #ef4444',
            'font: 500 11px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            'word-break: break-word'
        ].join(';');

        host.appendChild(captureBtn);
        host.appendChild(cancelBtn);
        host.appendChild(status);

        function showStatus(msg, kind) {
            status.textContent = msg;
            status.style.display = 'block';
            status.style.color = kind === 'error' ? '#ef4444' : '#1f6feb';
            status.style.background = kind === 'error'
                ? 'rgba(239, 68, 68, 0.12)'
                : 'rgba(31, 111, 235, 0.12)';
        }

        captureBtn.onclick = function() {
            // Guard against interleaved captures: if the
            // MutationObserver rebuilds the overlay mid-capture
            // (e.g. after a CF page wipe), the new button would
            // be re-enabled. Prevent a second capture from
            // firing while the first one's setTimeout chain is
            // still in flight.
            if (window.__gamelibCapturing) return;
            window.__gamelibCapturing = true;
            captureBtn.disabled = true;
            var prevText = captureBtn.textContent;
            captureBtn.textContent = 'Capturing…';
            try {
                var pre = document.querySelector('pre');
                var text = pre
                    ? (pre.textContent || pre.innerText || '')
                    : ((document.body && (document.body.innerText || document.body.textContent)) || '');
                var b64 = toBase64Url(text);
                // Split large payloads into ≤1.5 MB chunks to
                // stay under WebView2's ~2 MB top-frame
                // navigation URL limit. The Rust side collects
                // chunks via `on_navigation` and reassembles
                // them when all chunks have arrived.
                var MAX_CHUNK = 1500000;
                var chunks = [];
                for (var i = 0; i < b64.length; i += MAX_CHUNK) {
                    chunks.push(b64.slice(i, i + MAX_CHUNK));
                }
                var total = chunks.length;
                // Fire chunk navigations sequentially via
                // setTimeout. Each navigation is intercepted +
                // blocked by Rust's `on_navigation`, so the
                // page stays intact and JS timers continue to
                // fire.
                for (var c = 0; c < total; c++) {
                    (function(idx) {
                        setTimeout(function() {
                            location.href =
                                'gamelib-source://chunk/'
                                + idx + '/' + total + '/'
                                + chunks[idx];
                        }, idx * 100);
                    })(c);
                }
            } catch (err) {
                captureBtn.textContent = prevText;
                captureBtn.disabled = false;
                window.__gamelibCapturing = false;
                showStatus('Capture failed: ' + err, 'error');
            }
        };

        cancelBtn.onclick = function() {
            location.href = 'gamelib-source://cancel';
        };

        return host;
    }

    function inject() {
        if (!document.body) return false;
        if (document.getElementById('gamelib-source-fetcher')) return true;
        document.body.appendChild(buildUI());
        return true;
    }

    // First attempt: try immediately in case `document.body` is
    // already there (e.g. injected on a re-navigation).
    if (inject()) return;

    // Poll for `document.body` appearing. CF interstitials replace
    // the body on the challenge result, so we also re-inject via
    // a MutationObserver in case the user navigates past CF while
    // our poll is mid-cycle.
    var attempts = 0;
    var poll = setInterval(function() {
        attempts += 1;
        if (inject() || attempts > 120) { // ~60s
            clearInterval(poll);
        }
    }, 500);

    // Belt-and-suspenders: if a page wipe removes the overlay,
    // re-inject on the next DOM mutation. Cheap (we early-return
    // if our element still exists).
    try {
        new MutationObserver(function() {
            if (!document.getElementById('gamelib-source-fetcher')) {
                inject();
            }
        }).observe(document.documentElement, { childList: true, subtree: true });
    } catch (_) { /* observer unavailable on very old WebView2 builds */ }
})();
"#;

/// Chrome-mimicking UA — see `steam/auth.rs` for the rationale.
/// We re-declare it here (rather than reaching into the steam
/// module) to keep the source fetcher self-contained.
pub const SOURCE_FETCHER_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/// Decode a URL-safe base64 string (RFC 4648 §5) back to the
/// original UTF-8 text. Reverses the JS `toBase64Url()` transform:
/// `-` → `+`, `_` → `/`, re-add padding, then base64-decode.
fn decode_base64url(base64url: &str) -> Result<String, String> {
    let standard = base64url.replace('-', "+").replace('_', "/");
    let padded = match standard.len() % 4 {
        2 => standard + "==",
        3 => standard + "=",
        _ => standard,
    };
    let bytes = general_purpose::STANDARD
        .decode(&padded)
        .map_err(|e| format!("Base64 decode failed: {e}"))?;
    String::from_utf8(bytes).map_err(|e| format!("UTF-8 decode failed: {e}"))
}

/// Per-call state for chunked base64url reassembly.
/// Shared between the `on_navigation` callback (which collects
/// chunks from sequential navigations) and `on_window_event`
/// (which needs to co-exist with the same `Arc<Mutex<>>`).
///
/// `total` is set once by the first-arriving chunk and treated
/// as authoritative thereafter — subsequent chunks with a
/// different total are ignored to guard against malformed or
/// interleaved payloads.
#[derive(Default)]
struct ChunkState {
    chunks: Vec<String>,
    received: usize,
    total: Option<usize>,
}

/// Open the given source URL in a Cloudflare pass-through Webview,
/// wait for the user to click "Capture JSON", parse the resulting
/// JSON, and persist a new source — same `commit_source` path used
/// by the regular HTTP fetch. Returns the new `SourceLink`.
///
/// Large payloads are split into chunks by the injected JS and
/// reassembled here before decoding.
#[tauri::command]
pub async fn add_source_via_webview(
    app: AppHandle,
    state: tauri::State<'_, Arc<tokio::sync::Mutex<SourceManager>>>,
    url: String,
    name: String,
) -> Result<SourceLink, String> {
    use std::time::Duration;
    use url::Url;

    // Pre-validate the URL the same way the fetch path does, so
    // the user gets a useful error before a new window opens.
    let trimmed_url = url.trim().to_string();
    if trimmed_url.is_empty() {
        return Err("Source URL is empty".to_string());
    }
    if !trimmed_url.starts_with("http://") && !trimmed_url.starts_with("https://") {
        return Err("Source URL must start with http:// or https://".to_string());
    }
    let parsed_url: Url = trimmed_url
        .parse()
        .map_err(|e| format!("Invalid URL: {e}"))?;

    // Unique per-call window label. The init script no longer
    // bakes in the label (we switched from per-call event names
    // to the fixed `gamelib-source://` scheme), but the label
    // is still needed for Tauri's window management.
    let label = format!(
        "source-fetcher-{}-{}",
        std::process::id(),
        SOURCE_FETCHER_ID_COUNTER.fetch_add(1, Ordering::Relaxed),
    );

    // Channel for navigation callbacks. Pattern matches
    // `steam/auth.rs`: `on_navigation` sends a signal through
    // a `std::sync::mpsc` channel, and we `spawn_blocking` +
    // `recv_timeout` to wait in an async-safe way.
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    let tx_nav = tx.clone();
    let rx = Arc::new(Mutex::new(rx));

    // Shared chunk collector — the `on_navigation` callback
    // stores each arriving chunk, and when `received == total`
    // it sends the joined base64url through the channel.
    let chunks_state = Arc::new(Mutex::new(ChunkState::default()));
    let chunks_nav = Arc::clone(&chunks_state);

    let webview = WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::External(parsed_url),
    )
    .title("Add Source — Cloudflare Pass-Through")
    .inner_size(960.0, 720.0)
    .min_inner_size(640.0, 480.0)
    .resizable(true)
    .user_agent(SOURCE_FETCHER_USER_AGENT)
    .initialization_script(SOURCE_FETCHER_INIT_SCRIPT)
    .on_navigation(move |url| {
        let url_str = url.as_str();
        // `gamelib-source://chunk/<index>/<total>/<data>` — one
        // chunk of a (possibly large) base64url payload. Split
        // by the JS to stay under the ~2 MB URL limit.
        if url_str.starts_with("gamelib-source://chunk/") {
            let rest = &url_str["gamelib-source://chunk/".len()..];
            let parts: Vec<&str> = rest.splitn(3, '/').collect();
            if parts.len() == 3 {
                if let (Ok(idx), Ok(total)) =
                    (parts[0].parse::<usize>(), parts[1].parse::<usize>())
                {
                    if total == 0 {
                        return false; // malformed chunk
                    }
                    let mut state = chunks_nav.lock().unwrap();
                    // Lock total on first chunk; ignore later
                    // chunks with a different total (defense
                    // against interleaved captures or malformed
                    // sequential navigations).
                    if let Some(existing) = state.total {
                        if existing != total {
                            return false;
                        }
                    } else {
                        state.total = Some(total);
                    }
                    if state.chunks.len() < total {
                        state.chunks.resize(total, String::new());
                    }
                    if idx < total {
                        if state.chunks[idx].is_empty() {
                            state.received += 1;
                        }
                        state.chunks[idx] = parts[2].to_string();
                    }
                    if state.received == total {
                        let combined =
                            state.chunks.join("");
                        let _ = tx_nav.send(combined);
                    }
                }
            }
            return false; // Block the navigation
        }
        // `gamelib-source://cancel` — user clicked Cancel.
        if url_str.starts_with("gamelib-source://cancel") {
            let _ = tx_nav.send("__CANCEL__".to_string());
            return false;
        }
        true // Allow all other navigations
    })
    .build()
    .map_err(|e| format!("Failed to open source page: {e}"))?;

    // Send a cancel signal when the user closes the webview (X button)
    // so the Rust function returns immediately instead of waiting for
    // the 5-minute timeout. `Sender` is `Send` (not `Sync`), so we
    // clone and move the clone into the closure.
    let tx_close = tx.clone();
    webview.on_window_event(move |event| {
        if matches!(
            event,
            tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
        ) {
            let _ = tx_close.send("__CANCEL__".to_string());
        }
    });

    // Wait for a signal (capture or cancel) with a 5-minute
    // timeout. Window close is covered implicitly: when the
    // user closes the window, the navigation callback never
    // fires and `recv_timeout` eventually returns `Err`.
    let signal = {
        let rx = Arc::clone(&rx);
        tokio::task::spawn_blocking(move || {
            rx.lock().unwrap().recv_timeout(Duration::from_secs(300))
        })
        .await
        .map_err(|e| format!("Join error: {e}"))?
    };

    // Close the webview — we have the data (or a cancel/timeout).
    let _ = webview.close();

    match signal {
        Ok(s) if s == "__CANCEL__" => Err("Cancelled".to_string()),
        Ok(base64url) => {
            let json_text = decode_base64url(&base64url)?;
            state
                .lock()
                .await
                .add_source_from_json(trimmed_url, name, json_text)
                .await
        }
        Err(_timeout) => {
            Err("Source capture timed out after 5 minutes".to_string())
        }
    }
}

// ─── Tauri commands ─────────────────────────────────────────────────────────
//
// State is `Arc<tokio::sync::Mutex<SourceManager>>`. The Tauri command
// futures need to be `Send` (Tauri's invoke handler requires it), and
// `tokio::sync::MutexGuard` is `Send` across `.await` — using
// `std::sync::Mutex` here produced non-Send futures because the guard
// isn't designed to be held across an await point.
//
// The sync `setup` closure in `lib.rs` needs to call `load_sources`
// without an async runtime, so it uses `tokio::sync::Mutex::blocking_lock()`
// — that method is explicitly designed for sync-context access to a
// tokio mutex and blocks the current thread for the duration of the
// lock (acceptable because setup runs before the runtime is fully
// active).
//
// The lock IS held across the HTTP `await` in `add_source`,
// `refresh_source`, and `refresh_all` — that ties up one tokio worker
// per concurrent source command. Source commands are user-driven
// (add / remove / refresh) and never overlap heavily, so the trade is
// acceptable. If contention becomes a problem, the right fix is to
// release the guard before the HTTP work (refactor each async method
// into a "fetch" + a "commit" pair, with the fetch owning the shared
// `reqwest::Client` via `Arc`).

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
