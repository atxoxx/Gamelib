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

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

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
        let now_nanos = unix_now_nanos();
        let now_seconds = unix_now();
        // `src_{nanos}_{counter}` gives uniqueness even for
        // back-to-back `add_source` calls that land in the same
        // nanosecond. The counter is monotonic across the process
        // lifetime so two parallel Tauri commands can't collide.
        let counter = SOURCE_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
        let id = format!("src_{}_{}", now_nanos, counter);
        let display_name = if name.trim().is_empty() {
            derive_name_from_url(&trimmed)
        } else {
            name.trim().to_string()
        };
        let source = SourceLink {
            id: id.clone(),
            url: trimmed,
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
