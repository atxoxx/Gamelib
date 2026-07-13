//! Torrent download engine — wraps `librqbit` 8.x to provide a
//! session-managed download queue with progress, pause/resume, and
//! on-disk persistence across app restarts.
//!
//! ## librqbit 8.1.1 API notes
//!
//! - `Session::new_with_opts(folder, SessionOptions)` or `Session::new(folder)`
//!   returns `Arc<Self>`. Do NOT re-wrap.
//! - `SessionPersistenceConfig::Json { folder: Option<PathBuf> }` enables
//!   session-state persistence across restarts.
//! - `session.with_torrents(|iter| ...)` yields `(usize, &Arc<ManagedTorrent>)`.
//! - `session.add_torrent(...)` returns `AddTorrentResponse` with
//!   `Added(usize, Arc<ManagedTorrent>)` / `AlreadyManaged(...)` variants.
//!   Use `response.into_handle() -> Option<Arc<ManagedTorrent>>` to extract.
//! - `ManagedTorrent` is at `librqbit::ManagedTorrent` (not `ManagedTorrentHandle`).
//!   Methods: `id() -> usize`, `name() -> Option<String>`, `stats() -> TorrentStats`.
//! - `session.pause(&handle)` / `session.unpause(&handle)` for pause/resume.
//! - `session.delete(id, delete_files)` for removal (id via `with_torrents` match).
//! - `TorrentStats.total_bytes` is `u64` (not `Option<u64>`). `0` when unknown.
//! - `TorrentStats.state` is `TorrentStatsState` enum: `Initializing | Live | Paused | Error`.
//! - Live download/upload speed and peer swarm counts are exposed via
//!   `TorrentStats.live` (`Option<LiveStats>`). The `LiveStats.download_speed`
//!   and `LiveStats.upload_speed` fields are `Speed { mbps: f64 }`, where
//!   `mbps` is actually Mebibytes/sec (the field is mis-named; its `Display`
//!   impl formats as `"{:.2} MiB/s"`). Multiply by `1_048_576.0` to get
//!   bytes/sec for the frontend's `formatBytesPerSecond` helper.
//!   `LiveStats.snapshot.peer_stats: AggregatePeerStats` exposes
//!   `{ queued, connecting, live, seen, dead, not_needed, steals }` —
//!   `live` is the currently-connected count, `seen` is the total ever
//!   seen this session. We report `peers = live`, `seeds = seen - live`
//!   (the known-but-not-currently-connected remainder).
//! - `SessionOptions` has no `disable_upload` field.
//!
//! ## Persistence
//!
//! `<app_data_dir>/torrent-engine/` holds the librqbit session state
//! and per-torrent metadata. Restart-safe: paused torrents resume from
//! where they were, downloading ones pick up at their piece boundary.
//!
//! ## Event emission
//!
//! A background tokio task (spawned in `initialize_engine`) ticks every
//! 2 s, calls `refresh_stats` + `list`, and emits a `download-progress`
//! event with the full `Vec<TorrentDownload>` payload. The frontend
//! `DownloadContext` listens for this and re-renders the progress
//! panel.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock, Mutex as StdMutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::OnceCell;
use tokio::time::interval;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

// ─── Public DTOs ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase", tag = "kind", content = "message")]
pub enum DownloadStatus {
    Queued,
    FetchingMetadata,
    Downloading,
    Paused,
    Completed,
    Error(String),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TorrentFile {
    pub name: String,
    pub size: u64,
    pub downloaded: u64,
    pub progress: f32,
    pub selected: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SavedMetadata {
    pub source_uri: String,
    pub save_path: String,
    pub game_id: Option<String>,
    pub source_name: String,
    pub added_at: u64,
    pub auto_extract: Option<bool>,
    pub extracted: Option<bool>,
    pub total_size: Option<u64>,
    #[serde(default)]
    pub files: Vec<TorrentFile>,
    pub status: Option<DownloadStatus>,
    pub uris: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TorrentDownload {
    pub id: String,
    pub name: String,
    /// The magnet URI or .torrent URL that was passed in.
    pub source_uri: String,
    /// Folder the engine is downloading into.
    pub save_path: String,
    /// Bytes downloaded so far. `0` until metadata arrives.
    pub downloaded: u64,
    /// Total bytes of all selected files. `None` while metadata
    /// is still being fetched (total_bytes == 0).
    pub total_size: Option<u64>,
    /// 0.0 - 1.0; `None` while total_size is unknown.
    pub progress: Option<f32>,
    /// Live download speed in bytes/sec. `0` while the torrent is
    /// paused / errored / not yet live.
    pub download_speed: u64,
    /// Live upload speed in bytes/sec. `0` while the torrent is
    /// paused / errored / not yet live.
    pub upload_speed: u64,
    /// Peers currently connected to us. Mirrors
    /// `LiveStats.snapshot.peer_stats.live`.
    pub peers: u32,
    /// Peers we know about but aren't currently connected to
    /// (`seen - live`, saturating). Approximates "seeds in the
    /// swarm we can reach out to later". Strict seed/leech
    /// distinction would require per-peer iteration, which we
    /// avoid on the 2 s poll path.
    pub seeds: u32,
    pub status: DownloadStatus,
    /// Optional: the GameContext `game.id` this download was
    /// started for.
    pub game_id: Option<String>,
    /// Display name of the source (e.g. "FitGirl").
    pub source_name: String,
    /// Unix seconds when the user added the download.
    pub added_at: u64,
    pub files: Vec<TorrentFile>,
    pub auto_extract: Option<bool>,
    pub extracted: Option<bool>,
    pub uris: Option<Vec<String>>,
}

// ─── Engine wrapper ─────────────────────────────────────────────────────────

/// Wrapper around `librqbit::Session` plus our own metadata map.
pub struct TorrentEngine {
    session: Option<Arc<librqbit::Session>>,
    /// Mirror of the session's torrents with our extra fields,
    /// keyed by frontend-facing id (`"dl_<n>"`).
    downloads: HashMap<String, TorrentDownload>,
    state_dir: PathBuf,
    auto_paused_completed: std::collections::HashSet<String>,
    app: Option<AppHandle>,
    /// Dirty flag — set by any mutation, cleared when the background
    /// task flushes to disk. Prevents dozens of sync `fs::write`
    /// calls per second when multiple torrents are active.
    dirty: bool,
    /// Hash of the last payload emitted via `download-progress`.
    /// When the next tick computes the same hash, we skip the emit
    /// entirely — saves the frontend from an unnecessary re-render.
    last_emitted_hash: u64,
    pub direct_counters: HashMap<String, Arc<std::sync::atomic::AtomicU64>>,
    pub direct_last_calc: HashMap<String, (u64, std::time::Instant)>,
}

impl TorrentEngine {
    pub fn new(state_dir: PathBuf) -> Self {
        Self {
            session: None,
            downloads: HashMap::new(),
            state_dir,
            auto_paused_completed: std::collections::HashSet::new(),
            app: None,
            dirty: false,
            last_emitted_hash: 0,
            direct_counters: HashMap::new(),
            direct_last_calc: HashMap::new(),
        }
    }

    /// Emit current downloads to the frontend, but only if the
    /// payload actually changed since the last emission. Uses a
    /// quick hash comparison to avoid serializing + sending an
    /// identical JSON blob every 2 s when nothing is moving.
    pub fn emit_progress(&mut self) {
        if let Some(app) = &self.app {
            let snapshot = self.list();
            let hash = hash_downloads(&snapshot);
            if hash != self.last_emitted_hash {
                self.last_emitted_hash = hash;
                let _ = app.emit("download-progress", &snapshot);
            }
        }
    }

    /// Force-emit regardless of hash (used after user-initiated
    /// mutations where we want immediate UI feedback).
    pub fn emit_progress_force(&mut self) {
        if let Some(app) = &self.app {
            let snapshot = self.list();
            self.last_emitted_hash = hash_downloads(&snapshot);
            let _ = app.emit("download-progress", &snapshot);
        }
    }

    /// Mark the metadata as needing a disk flush. The background
    /// polling task will write to disk on its next tick.
    pub fn mark_dirty(&mut self) {
        self.dirty = true;
    }

    /// If dirty, flush metadata to disk and clear the flag.
    /// Called by the background polling task every 2 s.
    pub fn flush_if_dirty(&mut self) {
        if self.dirty {
            self.save_downloads_metadata();
            self.dirty = false;
        }
    }

    /// Open (or create) a librqbit session. Called once at app boot.
    /// No-op if already initialised.
    ///
    /// ## Fallback behavior
    ///
    /// librqbit 8.1.1's persistent DHT lives in an OS-level cache dir
    /// (resolved via the `directories` crate, separate from the
    /// session state folder we pass in). On any platform that
    /// cache dir may be read-only, hold a path with invalid
    /// unicode, or contain a corrupted routing table from a
    /// previous run — in any of those cases `Session::new_with_opts`
    /// aborts with "error initializing persistent DHT" and the
    /// whole engine fails to start, taking the Download modal
    /// down with it.
    ///
    /// We try the full persistence setup first, and on ANY init
    /// error fall back to a non-persistent session (`persistence:
    /// None`). The DHT will be in-memory only and downloads won't
    /// resume across restarts, but the rest of the app stays
    /// functional and the user can still grab a one-shot download.
    pub async fn initialize(&mut self) -> Result<(), String> {
        if self.session.is_some() {
            return Ok(());
        }
        std::fs::create_dir_all(&self.state_dir)
            .map_err(|e| format!("Failed to create state dir: {}", e))?;

        // 1. Try the full persistent setup.
        //
        // Performance tuning (see `build_peer_opts` doc comment
        // for the per-field rationale). Summary: the defaults
        // are tuned for "thousands of small torrents on a
        // server", which is the wrong profile for a desktop
        // client downloading 1–3 game repacks at a time. The
        // biggest wins are `listen_port_range` + UPnP (lets
        // peers reach us through the home router) and the
        // shorter `peer_opts` timeouts (cycle to fast peers
        // faster).
        let persistent_opts = librqbit::SessionOptions {
            persistence: Some(librqbit::SessionPersistenceConfig::Json {
                folder: Some(self.state_dir.clone()),
            }),
            fastresume: true,
            listen_port_range: Some(6881..6891),
            enable_upnp_port_forwarding: true,
            peer_opts: Self::build_peer_opts(),
            concurrent_init_limit: Some(4),
            // `defer_writes_up_to` is in MEGABYTES (per librqbit's
            // doc comment), NOT pieces or bytes. 4 MiB is enough
            // to coalesce piece-sized writes into ~1–2 disk
            // flushes per second without pinning a noticeable
            // amount of RAM for a typical 50 GB game download.
            // Default is 0 (no deferral → per-packet writes,
            // which thrashes SSDs under heavy I/O).
            defer_writes_up_to: Some(4),
            ..Default::default()
        };

        let session = match librqbit::Session::new_with_opts(
            self.state_dir.clone(),
            persistent_opts,
        )
        .await
        {
            Ok(s) => s,
            Err(e) => {
                let err_msg = e.to_string();
                eprintln!(
                    "[gamelib] Warning: persistent torrent session init failed: {}",
                    err_msg
                );
                eprintln!(
                    "[gamelib] Falling back to non-persistent session \
                     (downloads will not resume after app restart)."
                );

                // 2. Fall back to a no-persistence session. librqbit
                //    handles this gracefully — the DHT and the
                //    session state both stay in memory and the
                //    session simply doesn't write to disk. We
                //    keep the same performance tuning as the
                //    persistent branch so the fallback isn't
                //    silently slower than the primary path.
                let transient_opts = librqbit::SessionOptions {
                    persistence: None,
                    fastresume: true,
                    listen_port_range: Some(6881..6891),
                    enable_upnp_port_forwarding: true,
                    peer_opts: Self::build_peer_opts(),
                    concurrent_init_limit: Some(4),
                    defer_writes_up_to: Some(4),
                    ..Default::default()
                };
                librqbit::Session::new_with_opts(
                    self.state_dir.clone(),
                    transient_opts,
                )
                .await
                .map_err(|fallback_err| {
                    format!(
                        "Failed to open torrent session (even without persistence): {} \
                         (original persistent-init error: {})",
                        fallback_err, err_msg
                    )
                })?
            }
        };

        self.session = Some(session);
        self.sync_from_session();
        Ok(())
    }

    /// Walk the librqbit session and re-build our metadata map.
    fn sync_from_session(&mut self) {
        let Some(session) = self.session.clone() else {
            return;
        };

        // Load saved metadata from downloads.json if it exists
        let metadata_path = self.state_dir.join("downloads.json");
        let saved_metadata: HashMap<String, SavedMetadata> = if metadata_path.exists() {
            std::fs::read_to_string(&metadata_path)
                .ok()
                .and_then(|content| serde_json::from_str(&content).ok())
                .unwrap_or_default()
        } else {
            HashMap::new()
        };

        // Pre-populate our downloads list from saved metadata (completed history, etc.)
        self.downloads.clear();
        for (id, meta) in &saved_metadata {
            let status = meta.status.clone().unwrap_or(DownloadStatus::Completed);
            let name = std::path::Path::new(&meta.save_path)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("Restored Download")
                .to_string();
            // Cold-start re-stamp decision for FetchingMetadata / Paused
            // rows. Bound BEFORE the struct literal because the
            // `status,` field-init below moves `status`. The
            // FetchingMetadata grace-arm in `refresh_stats` keeps rows
            // by `(now - added_at) < 300`; if a user closed the app
            // mid-FetchingMetadata, the saved `added_at` predates the
            // grace window and would be pruned within 2 s of init.
            // Treating app restart as a fresh "still alive" tick
            // re-applies the grace window from this point forward.
            // Completed rows keep their original `added_at` for UI
            // sort stability.
            let needs_fresh_added_at = matches!(
                status,
                DownloadStatus::FetchingMetadata | DownloadStatus::Paused
            );
            self.downloads.insert(id.clone(), TorrentDownload {
                id: id.clone(),
                name,
                source_uri: meta.source_uri.clone(),
                save_path: meta.save_path.clone(),
                downloaded: if matches!(status, DownloadStatus::Completed) { meta.total_size.unwrap_or(0) } else { 0 },
                total_size: meta.total_size,
                progress: if matches!(status, DownloadStatus::Completed) { Some(1.0) } else { Some(0.0) },
                download_speed: 0,
                upload_speed: 0,
                seeds: 0,
                peers: 0,
                status,
                game_id: meta.game_id.clone(),
                source_name: meta.source_name.clone(),
                // Cold-start re-stamp for FetchingMetadata / Paused rows:
                // the FetchingMetadata grace-arm in `refresh_stats` keeps
                // rows by `(now - added_at) < 300`, so if a user closed
                // the app mid-FetchingMetadata (before the previous fix
                // existed, the row vanished; with the extended grace,
                // `added_at` from a previous run is too old and the row
                // would be pruned within 2 s of init). Re-stamping here
                // treats app restart as a fresh "still alive" tick so the
                // grace window applies from this point forward. Completed
                // rows keep the original `added_at` to preserve UI sort.
                added_at: if needs_fresh_added_at {
                    unix_now()
                } else {
                    meta.added_at
                },
                files: meta.files.clone(),
                auto_extract: meta.auto_extract,
                extracted: meta.extracted,
                uris: meta.uris.clone(),
            });
        }

        let to_delete_restored = std::sync::Mutex::new(Vec::new());
        let collected: Vec<TorrentDownload> = session.with_torrents(|iter| {
            let mut results = Vec::new();
            for (_id, mt) in iter {
                let stats = mt.stats();
                let name = mt
                    .name()
                    .unwrap_or_else(|| "Unknown".to_string());
                let total = stats.total_bytes;
                let downloaded = stats.progress_bytes;
                let progress = if total > 0 {
                    Some(downloaded as f32 / total as f32)
                } else {
                    None
                };
                let status = map_state_to_status(&stats.state, total, downloaded, stats.error.as_deref());

                // Only auto-delete restored torrents that have genuinely
                // transferred bytes. Without the `downloaded > 0` gate
                // we'd queue deletion for librqbit's transient
                // `finished = true` state on a previously list_only
                // torrent (where progress_bytes stayed 0 throughout
                // the live phase).
                if matches!(status, DownloadStatus::Completed) && downloaded > 0 {
                    to_delete_restored.lock().unwrap().push(mt.clone());
                }

                let (download_speed, upload_speed, seeds, peers) =
                    extract_live_stats(&stats);

                let info_hash = &mt.shared().info_hash;
                let fid = make_frontend_id_from_hash(&info_hash.0);
                let meta = saved_metadata.get(&fid);
                let source_uri = meta.map(|m| m.source_uri.clone()).unwrap_or_default();
                let save_path = meta.map(|m| m.save_path.clone()).unwrap_or_default();
                let game_id = meta.and_then(|m| m.game_id.clone());
                let source_name = meta
                    .map(|m| m.source_name.clone())
                    .unwrap_or_else(|| "Restored".to_string());
                let added_at = meta.map(|m| m.added_at).unwrap_or(0);
                let auto_extract = meta.and_then(|m| m.auto_extract).unwrap_or(false);
                let extracted = meta.and_then(|m| m.extracted).unwrap_or(false);

                // Fetch files list if metadata is available. We keep
                // the Option around: returning a transiently-empty
                // vec here would wipe a recently-confirmed file
                // selection out of `downloads.files` on the next
                // poll and break the file-selector UX (Bug #1).
                //
                // librqbit 8.1.1's `with_metadata` returns
                // `Result<R, anyhow::Error>` (not `Option<R>`), so
                // we `.ok()` to flatten the success path to an
                // `Option` for the `or_else` fallback below.
                let only_files_list = mt.only_files();
                let live_files: Option<Vec<TorrentFile>> = mt.with_metadata(|meta_data| {
                    meta_data.file_infos.iter().enumerate().map(|(i, info)| {
                        let f_downloaded = stats.file_progress.get(i).copied().unwrap_or(0);
                        let f_size = info.len;
                        let f_progress = if f_size > 0 {
                            f_downloaded as f32 / f_size as f32
                        } else {
                            0.0
                        };
                        let f_selected = match &only_files_list {
                            Some(indices) => indices.contains(&i),
                            None => true,
                        };
                        TorrentFile {
                            name: info.relative_filename.to_string_lossy().into_owned(),
                            size: f_size,
                            downloaded: f_downloaded,
                            progress: f_progress,
                            selected: f_selected,
                        }
                    }).collect::<Vec<TorrentFile>>()
                }).ok();
                // Preserve the saved file list when the live
                // metadata isn't currently available — the torrent
                // may be in a transient `Initializing` state where
                // `with_metadata` returns Err even though we
                // previously cached a stable file list.
                let files = live_files
                    .or_else(|| meta.map(|m| m.files.clone()).filter(|v| !v.is_empty()))
                    .unwrap_or_default();

                results.push(TorrentDownload {
                    id: fid,
                    name,
                    source_uri,
                    save_path,
                    downloaded,
                    total_size: if total > 0 { Some(total) } else { None },
                    progress,
                    download_speed,
                    upload_speed,
                    seeds,
                    peers,
                    status,
                    game_id,
                    source_name,
                    added_at,
                    files,
                    auto_extract: Some(auto_extract),
                    extracted: Some(extracted),
                    uris: meta.and_then(|m| m.uris.clone()),
                });
            }
            results
        });

        let mut to_extract_restored = Vec::new();
        for d in collected {
            let is_completed = matches!(d.status, DownloadStatus::Completed);
            if is_completed && d.auto_extract.unwrap_or(false) && !d.extracted.unwrap_or(false) {
                let mut updated_d = d.clone();
                updated_d.extracted = Some(true);
                to_extract_restored.push((updated_d.id.clone(), updated_d.save_path.clone(), updated_d.name.clone(), updated_d.files.clone()));
                self.downloads.insert(updated_d.id.clone(), updated_d);
            } else {
                self.downloads.insert(d.id.clone(), d);
            }
        }
        self.mark_dirty();

        for (id, save_path, name, files) in to_extract_restored {
            let engine_clone = ENGINE.get().cloned();
            tokio::spawn(async move {
                println!("[TorrentEngine] Restored completed download {} with pending auto-extraction. Extracting...", name);
                let id_clone = id.clone();
                let files_clone = files.clone();
                let save_path_clone = save_path.clone();
                let success = tokio::task::spawn_blocking(move || {
                    extract_archives_for_torrent(&id_clone, &save_path_clone, &files_clone)
                })
                .await
                .map(|r| r.is_ok())
                .unwrap_or(false);

                if success {
                    println!("[TorrentEngine] Extraction complete for {}. Deleting archives.", name);
                    delete_archives_for_torrent(&save_path, &files);
                }
                if let Some(engine) = engine_clone {
                    let mut guard = engine.write().await;
                    if let Some(d) = guard.downloads_mut().get_mut(&id) {
                        d.extracted = Some(true);
                        guard.mark_dirty();
                        guard.emit_progress_force();
                    }
                }
            });
        }

        let to_delete_restored = to_delete_restored.into_inner().unwrap();
        for handle in to_delete_restored {
            let session_clone = session.clone();
            tokio::spawn(async move {
                println!("[TorrentEngine] Restored completed torrent in librqbit session. Deleting from session to release file locks.");
                let _ = session_clone.delete(librqbit::api::TorrentIdOrHash::Id(handle.id()), false).await;
            });
        }
    }

    fn save_downloads_metadata(&self) {
        let metadata_path = self.state_dir.join("downloads.json");
        let saved: HashMap<String, SavedMetadata> = self.downloads.iter().map(|(id, d)| {
            (id.clone(), SavedMetadata {
                source_uri: d.source_uri.clone(),
                save_path: d.save_path.clone(),
                game_id: d.game_id.clone(),
                source_name: d.source_name.clone(),
                added_at: d.added_at,
                auto_extract: d.auto_extract,
                extracted: d.extracted,
                total_size: d.total_size,
                files: d.files.clone(),
                status: Some(d.status.clone()),
                uris: d.uris.clone(),
            })
        }).collect();
        // Serialize in memory, then write. The write itself is
        // blocking but we only call this from the background task
        // (via flush_if_dirty) or during critical mutations.
        if let Ok(content) = serde_json::to_string_pretty(&saved) {
            let _ = std::fs::write(&metadata_path, content);
        }
    }

    /// Accessor for the librqbit session Arc. Returns `None` if
    /// the engine hasn't been initialized yet. The caller can
    /// `.clone()` the returned Arc and use it independently of
    /// the engine mutex — that's how `torrent_add` avoids
    /// holding the lock during the (potentially slow) network
    /// I/O on the session.
    pub fn session(&self) -> Option<&Arc<librqbit::Session>> {
        self.session.as_ref()
    }

    pub fn downloads_map(&self) -> &HashMap<String, TorrentDownload> {
        &self.downloads
    }

    /// Mutable accessor for the downloads metadata map. The caller
    /// must hold the engine mutex. Used by `torrent_add` to insert
    /// the new `TorrentDownload` record after `add_torrent`
    /// returns; the insert itself is fast (no network I/O) so
    /// the lock is only held for milliseconds.
    pub fn downloads_mut(&mut self) -> &mut HashMap<String, TorrentDownload> {
        &mut self.downloads
    }

/// Build the peer-connection options applied to the librqbit
/// session. The fields here are the single biggest factor in
/// "is this torrent actually downloading at the speed the user
/// expects?":
///
/// * `connect_timeout: 2 s` — librqbit's default is 10 s. A
///   10 s window for *every* peer handshake means a slow
///   tracker can hold up the whole swarm discovery phase.
///   2 s drops unresponsive peers fast and lets us cycle
///   to good ones. Slightly above the 1.5 s TCP SYN retry
///   so transient packet loss doesn't get treated as a
///   dead peer.
///
/// * `read_write_timeout: 20 s` — librqbit's default is 60 s.
///   60 s of silence is far too generous for a protocol that
///   expects a chatter of piece requests; 20 s catches
///   genuinely stuck peers (e.g. a NAT mapping that timed
///   out upstream) without dropping a slow-but-alive peer
///   on a high-latency link.
///
/// * `keep_alive_interval: 30 s` — librqbit's default is 120 s.
///   30 s is the standard BitTorrent protocol's recommended
///   keep-alive cadence and matches what uTorrent / qBittorrent
///   ship with. Catches NAT bindings before they expire
///   (most home routers idle mappings at 60–120 s), so we
///   keep more of our peer connections alive between
///   piece bursts.
    fn build_peer_opts() -> Option<librqbit::PeerConnectionOptions> {
        Some(librqbit::PeerConnectionOptions {
            connect_timeout: Some(Duration::from_secs(2)),
            read_write_timeout: Some(Duration::from_secs(20)),
            keep_alive_interval: Some(Duration::from_secs(30)),
        })
    }

    /// Snapshot of all current downloads, sorted active-first.
    pub fn list(&self) -> Vec<TorrentDownload> {
        let mut all: Vec<TorrentDownload> =
            self.downloads.values().cloned().collect();
        all.sort_by(|a, b| match (&a.status, &b.status) {
            (DownloadStatus::Completed, DownloadStatus::Completed) => {
                b.added_at.cmp(&a.added_at)
            }
            (DownloadStatus::Completed, _) => std::cmp::Ordering::Greater,
            (_, DownloadStatus::Completed) => std::cmp::Ordering::Less,
            _ => b.added_at.cmp(&a.added_at),
        });
        all
    }

    pub async fn refresh_stats(&mut self) {
        let Some(session) = self.session.clone() else {
            return;
        };
        /// Aggregated per-torrent snapshot pulled from librqbit under
        /// the session lock. Replaces the previous 10-tuple to keep
        /// the collect/deconstruct sites readable and order-safe.
        ///
        /// `files` is `Option<Vec<TorrentFile>>` rather than `Vec<…>`:
        /// a transient `with_metadata` miss (during librqbit
        /// `Initializing` → `Live` transitions, or during the few
        /// hundred ms after `unpause`) must NOT wipe the
        /// cached file list — the user's confirmed file selection
        /// would disappear from the UI on the next poll. See Bug 1.
        struct StatsEntry {
            fid: String,
            downloaded: u64,
            total: Option<u64>,
            progress: Option<f32>,
            status: DownloadStatus,
            name: Option<String>,
            download_speed: u64,
            upload_speed: u64,
            seeds: u32,
            peers: u32,
            files: Option<Vec<TorrentFile>>,
            handle: Arc<librqbit::ManagedTorrent>,
        }
        let (collected, alive_ids): (Vec<StatsEntry>, Vec<String>) =
            session.with_torrents(|iter| {
                let mut entries = Vec::new();
                let mut ids = Vec::new();
                for (_id, mt) in iter {
                    let info_hash = &mt.shared().info_hash;
                    let fid = make_frontend_id_from_hash(&info_hash.0);
                    ids.push(fid.clone());
                    let stats = mt.stats();
                    let total = stats.total_bytes;
                    let downloaded = stats.progress_bytes;
                    let progress = if total > 0 {
                        Some(downloaded as f32 / total as f32)
                    } else {
                        None
                    };
                    let status =
                        map_state_to_status(&stats.state, total, downloaded, stats.error.as_deref());
                    let (download_speed, upload_speed, seeds, peers) =
                        extract_live_stats(&stats);

                    // Fetch files list if metadata is available.
                    // `None` here means "metadata not yet parsed";
                    // we'll preserve whatever files were already
                    // cached against this id rather than overwrite
                    // them with `[]`.
                    //
                    // librqbit 8.1.1's `with_metadata` returns
                    // `Result<R, anyhow::Error>`, so we `.ok()` to
                    // get an `Option` for `StatsEntry.files`.
                    let only_files_list = mt.only_files();
                    let files: Option<Vec<TorrentFile>> = mt.with_metadata(|meta_data| {
                        meta_data.file_infos.iter().enumerate().map(|(i, info)| {
                            let f_downloaded = stats.file_progress.get(i).copied().unwrap_or(0);
                            let f_size = info.len;
                            let f_progress = if f_size > 0 {
                                f_downloaded as f32 / f_size as f32
                            } else {
                                0.0
                            };
                            let f_selected = match &only_files_list {
                                Some(indices) => indices.contains(&i),
                                None => true,
                            };
                            TorrentFile {
                                name: info.relative_filename.to_string_lossy().into_owned(),
                                size: f_size,
                                downloaded: f_downloaded,
                                progress: f_progress,
                                selected: f_selected,
                            }
                        }).collect::<Vec<TorrentFile>>()
                    }).ok();

                    entries.push(StatsEntry {
                        fid,
                        downloaded,
                        total: if total > 0 { Some(total) } else { None },
                        progress,
                        status,
                        name: mt.name(),
                        download_speed,
                        upload_speed,
                        seeds,
                        peers,
                        files,
                        handle: Arc::clone(mt),
                    });
                }
                (entries, ids)
            });

        let alive_set: HashMap<String, ()> =
            alive_ids.into_iter().map(|id| (id, ())).collect();

        let mut save_needed = false;
        let mut to_extract = Vec::new();
        let mut to_delete = Vec::new();

        for entry in collected {
            if let Some(d) = self.downloads.get_mut(&entry.fid) {
                let was_completed = matches!(d.status, DownloadStatus::Completed);

                d.downloaded = entry.downloaded;
                d.total_size = entry.total;
                d.progress = entry.progress;
                d.download_speed = entry.download_speed;
                d.upload_speed = entry.upload_speed;
                d.seeds = entry.seeds;
                d.peers = entry.peers;
                // Preserve an explicit Error status set by a background
                // task (e.g. torrent_add timeout handler). Without this
                // guard, refresh_stats would see a stalled torrent still
                // in the librqbit session in Initializing state and
                // overwrite the user-visible Error back to
                // FetchingMetadata — the "stuck at FetchingMetadata"
                // bug. The background task's timeout handler now also
                // deletes the torrent from the session (belt-and-
                // suspenders), but retaining this gate in refresh_stats
                // protects against any future codepath that sets Error
                // before cleaning up the session entry.
                if !matches!(&d.status, DownloadStatus::Error(_))
                    || matches!(&entry.status, DownloadStatus::Error(_))
                {
                    d.status = entry.status;
                }
                // Only overwrite the file list when we have a live
                // snapshot from librqbit. A `None` snapshot preserves
                // the user's confirmed selection across a transient
                // metadata miss (Bug 1 — see StatsEntry doc comment).
                if let Some(files) = entry.files {
                    d.files = files;
                }

                let is_completed = matches!(d.status, DownloadStatus::Completed);
                if is_completed {
                    // Don't auto-delete a torrent that hasn't actually
                    // transferred any bytes. librqbit can leave
                    // `finished = true` on a torrent that was
                    // previously in list_only mode (Bug 2); trusting
                    // that alone would make us delete the entry before
                    // any real download happens. We've already assigned
                    // `d.downloaded = entry.downloaded` above, so this
                    // single check is the authoritative gate.
                    let actually_downloaded = d.downloaded > 0;
                    if actually_downloaded && !self.auto_paused_completed.contains(&entry.fid) {
                        self.auto_paused_completed.insert(entry.fid.clone());
                        to_delete.push(entry.handle.clone());
                    }
                    if !was_completed && actually_downloaded && d.auto_extract.unwrap_or(false) && !d.extracted.unwrap_or(false) {
                        d.extracted = Some(true);
                        save_needed = true;
                        to_extract.push((d.id.clone(), d.save_path.clone(), d.name.clone(), d.files.clone()));
                    }
                }

                if d.name.is_empty()
                    || d.name == "Fetching metadata\u{2026}"
                {
                    if let Some(n) = entry.name {
                        d.name = n;
                        save_needed = true;
                    }
                }
            } else {
                // Auto-discovery
                let name = entry.name.unwrap_or_else(|| "Restored".to_string());
                let download = TorrentDownload {
                    id: entry.fid.clone(),
                    name,
                    source_uri: String::new(),
                    save_path: String::new(),
                    downloaded: entry.downloaded,
                    total_size: entry.total,
                    progress: entry.progress,
                    download_speed: entry.download_speed,
                    upload_speed: entry.upload_speed,
                    seeds: entry.seeds,
                    peers: entry.peers,
                    status: entry.status,
                    game_id: None,
                    source_name: "Discovered".to_string(),
                    added_at: unix_now(),
                    files: entry.files.unwrap_or_default(),
                    auto_extract: Some(false),
                    extracted: Some(false),
                    uris: None,
                };
                self.downloads.insert(entry.fid.clone(), download);
                save_needed = true;
            }
        }
        // Update direct downloads progress, total_size, and speed
        let mut direct_save_needed = false;
        let ids: Vec<String> = self.downloads.keys().cloned().collect();
        for id in ids {
            if id.starts_with("dd_") || id.starts_with("db_") {
                let mut speed = 0;
                let mut current_bytes = 0;
                if let Some(counter) = self.direct_counters.get(&id) {
                    current_bytes = counter.load(std::sync::atomic::Ordering::SeqCst);
                    
                    let now = std::time::Instant::now();
                    if let Some((last_bytes, last_instant)) = self.direct_last_calc.get(&id) {
                        let elapsed = now.duration_since(*last_instant).as_secs_f64();
                        let bytes_diff = current_bytes.saturating_sub(*last_bytes);
                        speed = if elapsed > 0.0 {
                            (bytes_diff as f64 / elapsed) as u64
                        } else {
                            0
                        };
                    }
                    self.direct_last_calc.insert(id.clone(), (current_bytes, now));
                }

                if let Some(d) = self.downloads.get_mut(&id) {
                    if matches!(d.status, DownloadStatus::Downloading) {
                        if d.downloaded != current_bytes {
                            d.downloaded = current_bytes;
                            direct_save_needed = true;
                        }
                        if d.download_speed != speed {
                            d.download_speed = speed;
                            direct_save_needed = true;
                        }
                        
                        if let Some(total) = d.total_size {
                            if total > 0 {
                                let prog = Some((current_bytes as f32 / total as f32).min(1.0));
                                if d.progress != prog {
                                    d.progress = prog;
                                    direct_save_needed = true;
                                }
                            }
                        }
                    } else {
                        if d.download_speed != 0 {
                            d.download_speed = 0;
                            direct_save_needed = true;
                        }
                    }
                }
            }
        }

        if save_needed || direct_save_needed {
            self.mark_dirty();
        }

        // 130s = librqbit `add_torrent` background timeout (120s)
        // + 10s buffer. Guarantees the FetchingMetadata keep-arm
        // hands off cleanly to the Error(_) keep-arm when the
        // timeout fires instead of having the row pruned.
        const FETCHING_METADATA_GRACE_SECS: u64 = 130;

        // Transition stale FetchingMetadata rows to Error BEFORE
        // the retain pass, so the Error keep-arm catches them.
        // Without this, a FetchingMetadata download whose
        // background task hasn't added the torrent to the session
        // would be silently pruned after 130 s — the user sees
        // the download vanish with no explanation.
        let now = unix_now();
        for (id, d) in self.downloads.iter_mut() {
            if matches!(d.status, DownloadStatus::FetchingMetadata)
                && id.starts_with("dl_")
                && !alive_set.contains_key(id)
                && now.saturating_sub(d.added_at) >= FETCHING_METADATA_GRACE_SECS
            {
                eprintln!(
                    "[gamelib] FetchingMetadata timed out after {} s for {}; \
                     transitioning to Error.",
                    now.saturating_sub(d.added_at),
                    id
                );
                d.status = DownloadStatus::Error(
                    "Timed out fetching metadata — no peers responded. \
                     Check your firewall or try a different source."
                        .to_string(),
                );
                save_needed = true;
            }
        }

        self.downloads
            .retain(|id, d| {
                id.starts_with("dd_") ||
                id.starts_with("db_") ||
                alive_set.contains_key(id) ||
                matches!(d.status, DownloadStatus::Completed) ||
                matches!(d.status, DownloadStatus::Error(_)) ||
                (matches!(d.status, DownloadStatus::Paused) && !d.files.is_empty() && !d.source_uri.is_empty() && id.starts_with("dl_")) ||
                (matches!(d.status, DownloadStatus::FetchingMetadata) && unix_now().saturating_sub(d.added_at) < FETCHING_METADATA_GRACE_SECS && id.starts_with("dl_"))
            });

        self.direct_counters.retain(|id, _| self.downloads.contains_key(id));
        self.direct_last_calc.retain(|id, _| self.downloads.contains_key(id));

        self.auto_paused_completed.retain(|id| self.downloads.contains_key(id));

        for (id, save_path, name, files) in to_extract {
            let engine_clone = ENGINE.get().cloned();
            tokio::spawn(async move {
                println!("[TorrentEngine] Starting auto-extraction for {}", name);
                let id_clone = id.clone();
                let files_clone = files.clone();
                let save_path_clone = save_path.clone();
                let success = tokio::task::spawn_blocking(move || {
                    extract_archives_for_torrent(&id_clone, &save_path_clone, &files_clone)
                })
                .await
                .map(|r| r.is_ok())
                .unwrap_or(false);

                if success {
                    println!("[TorrentEngine] Extraction complete for {}. Deleting archives.", name);
                    delete_archives_for_torrent(&save_path, &files);
                }
                if let Some(engine) = engine_clone {
                    let mut guard = engine.write().await;
                    if let Some(d) = guard.downloads_mut().get_mut(&id) {
                        d.extracted = Some(true);
                        guard.mark_dirty();
                        guard.emit_progress_force();
                    }
                }
            });
        }

        for handle in to_delete {
            let session_clone = session.clone();
            tokio::spawn(async move {
                println!("[TorrentEngine] Torrent download completed. Deleting from librqbit session to release file locks.");
                let _ = session_clone.delete(librqbit::api::TorrentIdOrHash::Id(handle.id()), false).await;
            });
        }
    }

    /// Open the system folder picker.
    pub async fn pick_folder(app: &AppHandle) -> Result<Option<String>, String> {
        use tauri_plugin_dialog::DialogExt;
        let app = app.clone();
        let path = tokio::task::spawn_blocking(move || {
            app.dialog().file().blocking_pick_folder()
        })
        .await
        .map_err(|e| format!("Folder picker task failed: {}", e))?;
        Ok(path.map(|p| p.to_string()))
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

pub fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Build the frontend-facing id from a librqbit numeric torrent id.
fn make_frontend_id(numeric_id: usize) -> String {
    format!("dl_{}", numeric_id)
}

fn make_frontend_id_from_hash(info_hash: &[u8; 20]) -> String {
    let mut hash_bytes = [0u8; 8];
    hash_bytes.copy_from_slice(&info_hash[0..8]);
    let numeric_id = (u64::from_be_bytes(hash_bytes) & 0x7fffffffffffffff) as usize;
    make_frontend_id(numeric_id)
}


/// Compute a quick hash of the download list for change detection.
/// Used by `emit_progress` to skip duplicate emissions.
fn hash_downloads(downloads: &[TorrentDownload]) -> u64 {
    let mut hasher = DefaultHasher::new();
    for d in downloads {
        d.id.hash(&mut hasher);
        // Hash the fields that the frontend actually renders.
        // Skipping serialization keeps this O(n) with no alloc.
        d.downloaded.hash(&mut hasher);
        d.total_size.hash(&mut hasher);
        // progress is f32 — hash the bits
        if let Some(p) = d.progress {
            p.to_bits().hash(&mut hasher);
        }
        d.download_speed.hash(&mut hasher);
        d.upload_speed.hash(&mut hasher);
        d.peers.hash(&mut hasher);
        d.seeds.hash(&mut hasher);
        // status kind
        match &d.status {
            DownloadStatus::Queued => 0u8.hash(&mut hasher),
            DownloadStatus::FetchingMetadata => 1u8.hash(&mut hasher),
            DownloadStatus::Downloading => 2u8.hash(&mut hasher),
            DownloadStatus::Paused => 3u8.hash(&mut hasher),
            DownloadStatus::Completed => 4u8.hash(&mut hasher),
            DownloadStatus::Error(msg) => {
                5u8.hash(&mut hasher);
                msg.hash(&mut hasher);
            }
        }
        d.name.hash(&mut hasher);
    }
    hasher.finish()
}

/// Parse the `"dl_<n>"` frontend id into the librqbit numeric id.
fn parse_handle_id(frontend_id: &str) -> Result<usize, String> {
    frontend_id
        .strip_prefix("dl_")
        .ok_or_else(|| format!("Invalid download id: {}", frontend_id))?
        .parse::<usize>()
        .map_err(|e| format!("Invalid numeric id in '{}': {}", frontend_id, e))
}

/// Pull the live download speed, upload speed, seed and peer counts
/// out of a `TorrentStats` snapshot. Returns `(0, 0, 0, 0)` when the
/// torrent is in any state that doesn't publish live data
/// (Initializing / Paused / Error / no live snapshot yet).
///
/// `Speed.mbps` is mis-named: the field is actually Mebibytes per
/// second (its `Display` impl formats `"{:.2} MiB/s"`). We multiply
/// by `1_048_576.0` (1024 * 1024) to get bytes/sec for the wire
/// format — the frontend's `formatBytesPerSecond` expects bytes/sec.
/// NaN/inf would cast to `0` under `as u64` (defined Rust semantics),
/// so the only "bad" speed librqbit could hand us is silently dropped
/// to 0 — acceptable, since a NaN/inf speed is a librqbit internal
/// bug we can't recover from here.
fn extract_live_stats(
    stats: &librqbit::TorrentStats,
) -> (u64, u64, u32, u32) {
    let Some(live) = stats.live.as_ref() else {
        return (0, 0, 0, 0);
    };
    let download_speed = (live.download_speed.mbps * 1_048_576.0) as u64;
    let upload_speed = (live.upload_speed.mbps * 1_048_576.0) as u64;
    // librqbit's `peer_stats` fields are `u64`. Saturate to `u32::MAX`
    // rather than silently truncating — a torrent with >4B peers is
    // not a real-world case but the safe cast keeps the wire format
    // honest.
    let peers = u32::try_from(live.snapshot.peer_stats.live)
        .unwrap_or(u32::MAX);
    // `seen` is "all peers ever observed"; subtracting the currently
    // connected ones gives the known-but-not-connected remainder,
    // which is the closest proxy for "seeds in the swarm" we can
    // compute without per-peer iteration on the 2 s poll path.
    let seeds = u32::try_from(
        live.snapshot
            .peer_stats
            .seen
            .saturating_sub(live.snapshot.peer_stats.live),
    )
    .unwrap_or(u32::MAX);
    (download_speed, upload_speed, seeds, peers)
}

/// Map `TorrentStatsState` to our `DownloadStatus` enum.
///
/// ## Completion semantics (Bug 2 fix)
///
/// We deliberately ignore `librqbit::TorrentStats.finished`
/// (hence the absence of a `finished` parameter) and instead key
/// completion purely off byte counts. `finished` is `true` as
/// soon as every selected piece is local — INCLUDING the case
/// where the torrent was registered in `list_only` mode, where no
/// piece is ever downloaded. After we apply `update_only_files` +
/// `unpause` to that torrent, the stale `finished = true` flag
/// stays in place. Trusting it would make us mark the torrent
/// Completed before any bytes ever transferred (and then
/// auto-delete it on the next poll).
///
/// Completion therefore requires `total > 0 && downloaded >= total`,
/// which implies `downloaded > 0` automatically. A 0-bytes
/// torrent can never be Completed, regardless of how the bits
/// are flipped inside librqbit.
fn map_state_to_status(
    state: &librqbit::TorrentStatsState,
    total: u64,
    downloaded: u64,
    error: Option<&str>,
) -> DownloadStatus {
    if total > 0 && downloaded >= total {
        return DownloadStatus::Completed;
    }
    match state {
        librqbit::TorrentStatsState::Paused => DownloadStatus::Paused,
        librqbit::TorrentStatsState::Error => {
            DownloadStatus::Error(error.unwrap_or("Torrent error").to_string())
        }
        librqbit::TorrentStatsState::Initializing => {
            DownloadStatus::FetchingMetadata
        }
        librqbit::TorrentStatsState::Live => {
            if total == 0 {
                DownloadStatus::FetchingMetadata
            } else {
                DownloadStatus::Downloading
            }
        }
    }
}

/// Find a `ManagedTorrent` by its numeric id. Returns `None` if not found.
fn find_handle(
    session: &Arc<librqbit::Session>,
    numeric_id: usize,
) -> Option<Arc<librqbit::ManagedTorrent>> {
    session.with_torrents(|iter| {
        for (_id, mt) in iter {
            let info_hash = &mt.shared().info_hash;
            let mut hash_bytes = [0u8; 8];
            hash_bytes.copy_from_slice(&info_hash.0[0..8]);
            let computed_id = (u64::from_be_bytes(hash_bytes) & 0x7fffffffffffffff) as usize;
            if computed_id == numeric_id {
                return Some(Arc::clone(mt));
            }
        }
        None
    })
}

/// Remove a torrent from the librqbit session by its frontend-facing
/// id string (`"dl_<n>"`). No-op if the id doesn't parse or the
/// torrent isn't currently in the session.
///
/// Used by the background task in `torrent_add` to clean up after
/// a timed-out or failed `add_torrent` call — without this cleanup
/// the stalled torrent stays in the session forever, causing
/// `refresh_stats` to keep overwriting the Error status the
/// background task set.
async fn cleanup_session_torrent(
    session: &Arc<librqbit::Session>,
    id_str: &str,
) {
    if let Ok(numeric_id) = parse_handle_id(id_str) {
        if let Some(handle) = find_handle(session, numeric_id) {
            let _ = session
                .delete(librqbit::api::TorrentIdOrHash::Id(handle.id()), false)
                .await;
        }
    }
}

// ─── Global singleton + background polling task ──────────────────────────────

static ENGINE: OnceCell<Arc<tokio::sync::RwLock<TorrentEngine>>> =
    OnceCell::const_new();

/// Accessor for the global engine.
pub async fn engine() -> Option<Arc<tokio::sync::RwLock<TorrentEngine>>> {
    ENGINE.get().cloned()
}

/// Poll the global engine until it's initialized, up to ~2 s
/// (20 × 100 ms). Mostly a safety net for the cold-start race:
/// `initialize_engine` is spawned from the lib.rs `setup` closure
/// and may not finish before the first user click. Without this
/// grace period, a user who clicks Download within the first
/// ~100 ms of app launch sees a spurious "engine not initialized"
/// error and assumes the download failed.
async fn wait_for_engine() -> Result<Arc<tokio::sync::RwLock<TorrentEngine>>, String> {
    const MAX_ATTEMPTS: usize = 20;
    const DELAY_MS: u64 = 100;
    for _ in 0..MAX_ATTEMPTS {
        if let Some(engine) = engine().await {
            return Ok(engine);
        }
        tokio::time::sleep(Duration::from_millis(DELAY_MS)).await;
    }
    Err("Torrent engine not initialized".to_string())
}

/// Initialize the global engine and spawn the background polling task.
pub async fn initialize_engine(
    app: AppHandle,
    app_data_dir: PathBuf,
) -> Result<(), String> {
    let state_dir = app_data_dir.join("torrent-engine");
    let mut engine = TorrentEngine::new(state_dir);
    engine.app = Some(app.clone());
    engine.initialize().await?;
    let shared = Arc::new(tokio::sync::RwLock::new(engine));
    ENGINE
        .set(shared.clone())
        .map_err(|_| "Torrent engine already initialized".to_string())?;

    tokio::spawn(async move {
        let mut tick = interval(Duration::from_secs(2));
        tick.tick().await; // skip immediate first tick
        loop {
            tick.tick().await;
            {
                let mut guard = shared.write().await;
                guard.refresh_stats().await;
                guard.flush_if_dirty();
                guard.emit_progress();
            }
        }
    });
    Ok(())
}

// ─── Tauri commands ─────────────────────────────────────────────────────────

fn normalize_path(p: &str) -> String {
    let mut normalized = p.replace('/', "\\");
    while normalized.contains("\\\\") {
        normalized = normalized.replace("\\\\", "\\");
    }
    if normalized.ends_with('\\') && normalized.len() > 3 {
        normalized.pop();
    }
    normalized
}

#[tauri::command]
pub async fn torrent_add(
    magnet_uri: String,
    save_path: String,
    game_id: Option<String>,
    source_name: String,
    auto_extract: Option<bool>,
    list_only: Option<bool>,
) -> Result<TorrentDownload, String> {
    let engine = wait_for_engine().await?;
    let save_path = normalize_path(&save_path);

    // Step 1: Clone the session Arc while holding the lock briefly.
    let session = {
        let guard = engine.read().await;
        guard
            .session()
            .ok_or_else(|| "Torrent engine not initialized".to_string())?
            .clone()
    };

    // Step 2: Validate the URI and call `add_torrent` WITHOUT
    // holding the engine mutex.
    let trimmed = magnet_uri.trim().to_string();
    if !(trimmed.starts_with("magnet:")
        || trimmed.starts_with("http://")
        || trimmed.starts_with("https://"))
    {
        return Err(
            "Source URI must be a magnet: link or http(s):// torrent URL"
                .to_string(),
        );
    }

    let is_list_only = list_only.unwrap_or(false);

    // ── Non-blocking path for !list_only ───────────────────────────────
    //
    // session.add_torrent() can take up to 120 s for magnet URIs while
    // librqbit fetches metadata from the DHT / trackers. We must NOT
    // block the Tauri command that long — the frontend shows "Starting
    // download…" and the modal stays open. Instead:
    //
    // 1. Insert a placeholder record immediately (with a temp ID) so the
    //    frontend sees "Fetching Metadata" right away.
    // 2. Return the placeholder record to the frontend (the command
    //    resolves in < 1 ms).
    // 3. A background tokio task calls add_torrent and, on success,
    //    derives the REAL frontend ID from handle.shared().info_hash —
    //    the authoritative hash that librqbit actually uses. The temp
    //    record is then swapped for the real one via remove + insert.
    //
    // Deriving the ID from the handle's info_hash is mandatory:
    // parse_magnet_hash (old code) could extract a different hash
    // (Base32 vs hex, v2 vs v1) than what librqbit internally uses.
    // That mismatch caused the original "stuck at Fetching Metadata"
    // bug — our record had ID dl_A but the torrent in the session had
    // ID dl_B, and refresh_stats never matched them.
    //
    // For list_only=true ("Fetch Files List" flow), we stay on the
    // synchronous path below because AddTorrentOptions.list_only
    // returns quickly (librqbit just registers the infohash) and the
    // frontend needs the file list immediately before it can show the
    // file-selection UI.
    if !is_list_only {
        // Unique temp id — starts with "dl_" so refresh_stats retain
        // logic (id.starts_with("dl_")) keeps the placeholder alive.
        // unix_now() is second-precision; the atomic counter guards
        // against the (extremely rare) case of two torrent_add calls
        // within the same second getting the same id.
        static TEMP_ID_CTR: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let ctr = TEMP_ID_CTR.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let temp_id = format!("dl_pending_{}_{}", unix_now(), ctr);

        let placeholder = TorrentDownload {
            id: temp_id.clone(),
            name: "Fetching metadata\u{2026}".to_string(),
            source_uri: trimmed.clone(),
            save_path: save_path.clone(),
            downloaded: 0,
            total_size: None,
            progress: Some(0.0),
            download_speed: 0,
            upload_speed: 0,
            seeds: 0,
            peers: 0,
            status: DownloadStatus::FetchingMetadata,
            game_id: game_id.clone(),
            source_name: source_name.clone(),
            added_at: unix_now(),
            files: vec![],
            auto_extract: Some(auto_extract.unwrap_or(false)),
            extracted: Some(false),
            uris: None,
        };

        {
            let mut guard = engine.write().await;
            guard.downloads_mut().insert(temp_id.clone(), placeholder.clone());
            guard.mark_dirty();
            guard.emit_progress_force();
        }

        // Spawn the background task that does the actual
        // session.add_torrent() without blocking the caller.
        let engine_clone = Arc::clone(&engine);
        let temp_id_clone = temp_id.clone();
        let trimmed_clone = trimmed.clone();
        let save_path_clone = save_path.clone();
        let game_id_clone = game_id.clone();
        let source_name_clone = source_name.clone();
        let auto_extract_val = auto_extract.unwrap_or(false);

        tokio::spawn(async move {
            let add = librqbit::AddTorrent::from_url(trimmed_clone.clone());
            let add_opts = librqbit::AddTorrentOptions {
                output_folder: Some(save_path_clone.clone().into()),
                overwrite: true,
                list_only: false,
                ..Default::default()
            };

            match tokio::time::timeout(
                Duration::from_secs(120),
                session.add_torrent(add, Some(add_opts)),
            )
            .await
            {
                Ok(Ok(response)) => {
                    match response {
                        librqbit::AddTorrentResponse::Added(_, handle)
                        | librqbit::AddTorrentResponse::AlreadyManaged(_, handle) =>
                        {
                            let info_hash = &handle.shared().info_hash;
                            let real_id =
                                make_frontend_id_from_hash(&info_hash.0);

                            let name = handle.name().unwrap_or_else(|| {
                                "Fetching metadata\u{2026}".to_string()
                            });

                            let only_files_list = handle.only_files();
                            let files = handle
                                .with_metadata(|meta_data| {
                                    meta_data
                                        .file_infos
                                        .iter()
                                        .enumerate()
                                        .map(|(i, info)| {
                                            let f_selected = match &only_files_list {
                                                Some(indices) => indices.contains(&i),
                                                None => true,
                                            };
                                            TorrentFile {
                                                name: info
                                                    .relative_filename
                                                    .to_string_lossy()
                                                    .into_owned(),
                                                size: info.len,
                                                downloaded: 0,
                                                progress: 0.0,
                                                selected: f_selected,
                                            }
                                        })
                                        .collect::<Vec<TorrentFile>>()
                                })
                                .unwrap_or_default();

                            let total_size = handle.stats().total_bytes;

                            // AlreadyManaged may still be paused from a
                            // prior list_only addition.
                            let _ = session.unpause(&handle).await;

                            let mut guard = engine_clone.write().await;
                            // Snapshot the placeholder's state BEFORE
                            // removing it. If the user paused the
                            // placeholder while the background task was
                            // running, we must carry that Paused state
                            // forward to the real record and actually
                            // pause the handle in-session.
                            let was_paused = guard
                                .downloads_mut()
                                .get(&temp_id_clone)
                                .map(|d| {
                                    matches!(
                                        d.status,
                                        DownloadStatus::Paused
                                    )
                                })
                                .unwrap_or(false);

                            // Remove the temp placeholder record.
                            guard.downloads_mut().remove(&temp_id_clone);

                            if was_paused {
                                let _ = session.pause(&handle).await;
                            }

                            // Insert (or update) the record with the
                            // real, authoritative frontend id.
                            let download = TorrentDownload {
                                id: real_id.clone(),
                                name,
                                source_uri: trimmed_clone,
                                save_path: save_path_clone,
                                downloaded: 0,
                                total_size: if total_size > 0 {
                                    Some(total_size)
                                } else {
                                    None
                                },
                                progress: Some(0.0),
                                download_speed: 0,
                                upload_speed: 0,
                                seeds: 0,
                                peers: 0,
                                status: if was_paused {
                                    DownloadStatus::Paused
                                } else {
                                    DownloadStatus::FetchingMetadata
                                },
                                game_id: game_id_clone,
                                source_name: source_name_clone,
                                added_at: unix_now(),
                                files,
                                auto_extract: Some(auto_extract_val),
                                extracted: Some(false),
                                uris: None,
                            };
                            guard
                                .downloads_mut()
                                .insert(real_id, download);
                            guard.mark_dirty();
                            guard.emit_progress_force();
                        }
                        librqbit::AddTorrentResponse::ListOnly(_) => {
                            // Shouldn't happen with list_only=false.
                            let mut guard = engine_clone.write().await;
                            if let Some(d) = guard
                                .downloads_mut()
                                .get_mut(&temp_id_clone)
                            {
                                d.status = DownloadStatus::Error(
                                    "Internal error: unexpected ListOnly \
                                     response for non-list_only torrent"
                                        .to_string(),
                                );
                            }
                            guard.mark_dirty();
                            guard.emit_progress_force();
                        }
                    }
                }
                Ok(Err(e)) => {
                    let mut guard = engine_clone.write().await;
                    if let Some(d) =
                        guard.downloads_mut().get_mut(&temp_id_clone)
                    {
                        d.status = DownloadStatus::Error(format!(
                            "Failed to add torrent: {}",
                            e
                        ));
                    }
                    guard.mark_dirty();
                    guard.emit_progress_force();
                }
                Err(_) => {
                    let mut guard = engine_clone.write().await;
                    if let Some(d) =
                        guard.downloads_mut().get_mut(&temp_id_clone)
                    {
                        d.status = DownloadStatus::Error(
                            "Timed out fetching metadata — no peers \
                             responded. Check your firewall or try a \
                             different source."
                                .to_string(),
                        );
                    }
                    guard.mark_dirty();
                    guard.emit_progress_force();
                }
            }
        });

        return Ok(placeholder);
    }

    // ── Synchronous path (list_only=true only) ──────────────────────────
    //
    // list_only doesn't need to fetch metadata from the DHT — librqbit
    // just registers the infohash and returns immediately. We stay on
    // the synchronous path here because:
    //   1. It's fast (returns in milliseconds, not 120 s).
    //   2. The frontend (DownloadModal "Fetch Files List" step) needs
    //      the file list immediately so the file-selection UI appears.

    let add = librqbit::AddTorrent::from_url(trimmed.clone());
    let add_opts = librqbit::AddTorrentOptions {
        output_folder: Some(save_path.clone().into()),
        overwrite: true,
        list_only: is_list_only,
        ..Default::default()
    };

    let response = tokio::time::timeout(
        Duration::from_secs(120),
        session.add_torrent(add, Some(add_opts)),
    )
    .await
    .map_err(|_| {
        "Torrent is taking too long to fetch metadata — your network \
         may be blocking DHT or trackers. Check your firewall or try \
         a different source."
            .to_string()
    })?
    .map_err(|e| format!("Failed to add torrent: {}", e))?;

    let (id_str, name, files, total_size, status) = match response {
        librqbit::AddTorrentResponse::Added(_, handle)
        | librqbit::AddTorrentResponse::AlreadyManaged(_, handle) =>
        {
            let info_hash = &handle.shared().info_hash;
            let id_str = make_frontend_id_from_hash(&info_hash.0);
            let name = handle
                .name()
                .unwrap_or_else(|| "Fetching metadata\u{2026}".to_string());

            let only_files_list = handle.only_files();
            let files = handle
                .with_metadata(|meta_data| {
                    meta_data
                        .file_infos
                        .iter()
                        .enumerate()
                        .map(|(i, info)| {
                            let f_selected = match &only_files_list {
                                Some(indices) => indices.contains(&i),
                                None => true,
                            };
                            TorrentFile {
                                name: info
                                    .relative_filename
                                    .to_string_lossy()
                                    .into_owned(),
                                size: info.len,
                                downloaded: 0,
                                progress: 0.0,
                                selected: f_selected,
                            }
                        })
                        .collect::<Vec<TorrentFile>>()
                })
                .unwrap_or_default();

            let total_size = handle.stats().total_bytes;

            (
                id_str,
                name,
                files,
                Some(total_size),
                DownloadStatus::FetchingMetadata,
            )
        }
        librqbit::AddTorrentResponse::ListOnly(res) => {
            let id_str = make_frontend_id_from_hash(&res.info_hash.0);
            let name = res
                .info
                .name
                .as_ref()
                .map(|n| n.to_string())
                .unwrap_or_else(|| "Unknown".to_string());
            let files = res
                .info
                .iter_file_details()
                .ok()
                .map(|iter| {
                    iter.map(|info| TorrentFile {
                        name: info
                            .filename
                            .to_pathbuf()
                            .map(|p| p.to_string_lossy().into_owned())
                            .unwrap_or_default(),
                        size: info.len,
                        downloaded: 0,
                        progress: 0.0,
                        selected: true,
                    })
                    .collect::<Vec<TorrentFile>>()
                })
                .unwrap_or_default();
            let total_size = files.iter().map(|f| f.size).sum::<u64>();

            (id_str, name, files, Some(total_size), DownloadStatus::Paused)
        }
    };

    let mut guard = engine.write().await;
    if guard.downloads_mut().contains_key(&id_str) {
        let updated = {
            let existing = guard.downloads_mut().get_mut(&id_str).unwrap();
            existing.save_path = save_path;
            existing.game_id = game_id;
            existing.source_name = source_name;
            existing.added_at = unix_now();
            existing.auto_extract = Some(auto_extract.unwrap_or(false));
            existing.clone()
        };
        guard.mark_dirty();
        guard.emit_progress_force();
        return Ok(updated);
    }

    let key = id_str.clone();
    let download = TorrentDownload {
        id: id_str,
        name,
        source_uri: trimmed,
        save_path,
        downloaded: 0,
        total_size: if total_size.unwrap_or(0) > 0 {
            total_size
        } else {
            None
        },
        progress: Some(0.0),
        download_speed: 0,
        upload_speed: 0,
        seeds: 0,
        peers: 0,
        status,
        game_id,
        source_name,
        added_at: unix_now(),
        files,
        auto_extract: Some(auto_extract.unwrap_or(false)),
        extracted: Some(false),
        uris: None,
    };
    guard.downloads_mut().insert(key, download.clone());
    guard.mark_dirty();
    guard.emit_progress_force();
    Ok(download)
}

#[tauri::command]
pub async fn torrent_pause(id: String) -> Result<(), String> {
    let engine = wait_for_engine().await?;

    if id.starts_with("dd_") || id.starts_with("db_") {
        let mut guard = engine.write().await;
        if let Some(d) = guard.downloads_mut().get_mut(&id) {
            d.status = DownloadStatus::Paused;
            d.download_speed = 0;
            guard.mark_dirty();
            guard.emit_progress_force();
        }
        return Ok(());
    }

    // Try to find and pause the torrent in the librqbit session
    // first. If the torrent hasn't been added to the session yet
    // (e.g. the background task in torrent_add is still fetching
    // metadata), fall back to a metadata-only pause — update the
    // status in our map directly. The background task will see
    // Paused status when it completes and respect it.
    let session = {
        let guard = engine.read().await;
        guard.session().ok_or_else(|| "Torrent engine not initialized".to_string())?.clone()
    };

    let mut session_paused = false;
    if let Ok(numeric_id) = parse_handle_id(&id) {
        if let Some(handle) = find_handle(&session, numeric_id) {
            session.pause(&handle).await.map_err(|e| {
                format!("Failed to pause: {}", e)
            })?;
            session_paused = true;
        }
    }

    {
        let mut guard = engine.write().await;
        if let Some(d) = guard.downloads_mut().get_mut(&id) {
            // If the torrent wasn't in the session, still mark it
            // as paused in our metadata map so the UI reflects the
            // user's intent. The background task or refresh_stats
            // will reconcile when the torrent appears in the session.
            d.status = DownloadStatus::Paused;
            if session_paused {
                d.download_speed = 0;
            }
            guard.mark_dirty();
            guard.emit_progress_force();
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn torrent_resume(id: String) -> Result<(), String> {
    let engine = wait_for_engine().await?;

    if id.starts_with("dd_") || id.starts_with("db_") {
        let mut guard = engine.write().await;
        let (url, save_path) = {
            let d = guard.downloads_mut().get(&id)
                .ok_or_else(|| format!("Download not found: {}", id))?;
            if !matches!(d.status, DownloadStatus::Paused | DownloadStatus::Error(_)) {
                return Err("Download is not paused or in error state".to_string());
            }
            if d.source_uri.starts_with("magnet:") {
                return Err("Cannot resume debrid download in metadata phase".to_string());
            }
            (d.source_uri.clone(), d.save_path.clone())
        };

        if let Some(d) = guard.downloads_mut().get_mut(&id) {
            d.status = DownloadStatus::Downloading;
            guard.mark_dirty();
            guard.emit_progress_force();
        }

        let bytes_counter = Arc::new(std::sync::atomic::AtomicU64::new(0));
        guard.direct_counters.insert(id.clone(), Arc::clone(&bytes_counter));

        let engine_weak = Arc::downgrade(&engine);
        tokio::spawn(async move {
            crate::downloader::direct::run_direct_download(
                id,
                url,
                save_path,
                bytes_counter,
                engine_weak,
            ).await;
        });

        return Ok(());
    }

    // Try to find and unpause the torrent in the librqbit session
    // first. If the torrent hasn't been added to the session yet
    // (e.g. the background task in torrent_add is still fetching
    // metadata), fall back to a metadata-only resume — update the
    // status in our map and reset the grace-period clock.
    let session = {
        let guard = engine.read().await;
        guard.session().ok_or_else(|| "Torrent engine not initialized".to_string())?.clone()
    };

    let mut session_resumed = false;
    if let Ok(numeric_id) = parse_handle_id(&id) {
        if let Some(handle) = find_handle(&session, numeric_id) {
            session.unpause(&handle).await.map_err(|e| {
                format!("Failed to resume: {}", e)
            })?;
            session_resumed = true;
        }
    }

    {
        let mut guard = engine.write().await;
        let d = guard.downloads_mut().get_mut(&id)
            .ok_or_else(|| format!("Download not found: {}", id))?;
        if !matches!(d.status, DownloadStatus::Paused | DownloadStatus::Error(_)) {
            return Err("Download is not paused or in error state".to_string());
        }

        // When the torrent isn't in the session, do a metadata-
        // only resume so the UI reflects the user's intent.
        // Reset added_at to give the FetchingMetadata grace
        // period a fresh 130 s clock — the background task from
        // torrent_add (or the next refresh_stats tick) will
        // reconcile the status when the torrent materialises.
        if !session_resumed {
            d.status = DownloadStatus::FetchingMetadata;
            d.added_at = unix_now();
        } else {
            // Session-resumed; added_at doesn't need resetting —
            // the torrent is actively managed by librqbit and
            // refresh_stats keeps it alive in alive_set.
            d.status = if d.total_size.unwrap_or(0) > 0 {
                DownloadStatus::Downloading
            } else {
                DownloadStatus::FetchingMetadata
            };
        }
        guard.mark_dirty();
        guard.emit_progress_force();
    }

    Ok(())
}

#[tauri::command]
pub async fn torrent_remove(
    id: String,
    delete_files: Option<bool>,
) -> Result<(), String> {
    let engine = wait_for_engine().await?;
    let delete_files = delete_files.unwrap_or(false);

    kill_extraction(&id);

    let (session, download_opt) = {
        let mut guard = engine.write().await;
        let session = guard.session().cloned();
        let download_opt = guard.downloads_mut().remove(&id);
        guard.mark_dirty();
        guard.emit_progress_force();
        (session, download_opt)
    };

    tokio::spawn(async move {
        if let Some(session) = session {
            if let Ok(numeric_id) = parse_handle_id(&id) {
                if let Some(handle) = find_handle(&session, numeric_id) {
                    let real_session_id = handle.id();
                    let _ = session
                        .delete(
                            librqbit::api::TorrentIdOrHash::Id(real_session_id),
                            delete_files,
                        )
                        .await;
                }
            }
        }

        if delete_files {
            if let Some(download) = download_opt {
                let _ = tokio::task::spawn_blocking(move || {
                    let save_path_buf = std::path::PathBuf::from(&download.save_path);
                    
                    // 1. Delete each downloaded file
                    for file in &download.files {
                        let file_path = save_path_buf.join(&file.name);
                        if file_path.exists() && file_path.is_file() {
                            let _ = std::fs::remove_file(&file_path);
                        }
                    }
                    
                    // 2. Delete empty parent subdirectories recursively (excluding root save_path)
                    let mut dirs_to_check = Vec::new();
                    for file in &download.files {
                        let file_path = save_path_buf.join(&file.name);
                        let mut parent = file_path.parent();
                        while let Some(p) = parent {
                            if p.starts_with(&save_path_buf) && p != save_path_buf {
                                dirs_to_check.push(p.to_path_buf());
                                parent = p.parent();
                            } else {
                                break;
                            }
                        }
                    }
                    
                    dirs_to_check.sort_by(|a, b| b.components().count().cmp(&a.components().count()));
                    dirs_to_check.dedup();
                    
                    for dir in dirs_to_check {
                        if dir.exists() && dir.is_dir() {
                            if let Ok(entries) = std::fs::read_dir(&dir) {
                                if entries.count() == 0 {
                                    let _ = std::fs::remove_dir(&dir);
                                }
                            }
                        }
                    }

                    // 3. Remove torrent folder if empty
                    let torrent_dir = save_path_buf.join(&download.name);
                    if torrent_dir.exists() && torrent_dir.is_dir() {
                        if let Ok(entries) = std::fs::read_dir(&torrent_dir) {
                            if entries.count() == 0 {
                                let _ = std::fs::remove_dir(&torrent_dir);
                            }
                        }
                    }
                }).await;
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn torrent_get_all() -> Result<Vec<TorrentDownload>, String> {
    let engine = wait_for_engine().await?;
    let result = {
        let guard = engine.read().await;
        Ok(guard.list())
    };
    result
}

#[tauri::command]
pub async fn torrent_select_save_path(
    app: AppHandle,
) -> Result<Option<String>, String> {
    TorrentEngine::pick_folder(&app).await
}

/// Bulk-pause every active torrent. Returns the count of torrents
/// that were (re)paused. See `TorrentEngine::pause_all` for the
/// exact definition of "active" and the no-op behavior on already-
/// paused or completed torrents.
#[tauri::command]
pub async fn torrent_pause_all() -> Result<usize, String> {
    let engine = wait_for_engine().await?;
    let session = {
        let guard = engine.read().await;
        guard.session().ok_or_else(|| "Torrent engine not initialized".to_string())?.clone()
    };

    let to_pause: Vec<Arc<librqbit::ManagedTorrent>> = session.with_torrents(|iter| {
        iter.filter_map(|(_id, mt)| {
            let stats = mt.stats();
            let state = &stats.state;
            let status = map_state_to_status(
                state,
                stats.total_bytes,
                stats.progress_bytes,
                stats.error.as_deref(),
            );
            let should_pause = matches!(
                state,
                librqbit::TorrentStatsState::Live
                    | librqbit::TorrentStatsState::Initializing
            ) && !matches!(status, DownloadStatus::Completed);
            if should_pause {
                Some(Arc::clone(mt))
            } else {
                None
            }
        })
        .collect()
    });

    let mut affected = 0usize;
    for handle in &to_pause {
        if session.pause(handle).await.is_ok() {
            affected += 1;
        }
    }

    let mut guard = engine.write().await;
    let mut direct_paused = 0;
    for (id, d) in guard.downloads_mut().iter_mut() {
        if (id.starts_with("dd_") || id.starts_with("db_")) && matches!(d.status, DownloadStatus::Downloading) {
            d.status = DownloadStatus::Paused;
            d.download_speed = 0;
            direct_paused += 1;
        }
    }

    if affected > 0 || direct_paused > 0 {
        for handle in &to_pause {
            let info_hash = &handle.shared().info_hash;
            let fid = make_frontend_id_from_hash(&info_hash.0);
            if let Some(d) = guard.downloads_mut().get_mut(&fid) {
                d.status = DownloadStatus::Paused;
            }
        }
        guard.mark_dirty();
        guard.emit_progress_force();
    }

    Ok(affected + direct_paused)
}

#[tauri::command]
pub async fn torrent_set_speed_limits(
    download_limit_kbps: Option<u32>,
    upload_limit_kbps: Option<u32>,
    disable_upload: bool,
) -> Result<(), String> {
    let engine = wait_for_engine().await?;
    let session = {
        let guard = engine.read().await;
        guard.session().ok_or_else(|| "Torrent engine not initialized".to_string())?.clone()
    };

    let download_bps = download_limit_kbps
        .filter(|&v| v > 0)
        .and_then(|v| std::num::NonZeroU32::new(v * 1024));

    let upload_bps = if disable_upload {
        std::num::NonZeroU32::new(1) // 1 byte/sec is effectively disabled
    } else {
        upload_limit_kbps
            .filter(|&v| v > 0)
            .and_then(|v| std::num::NonZeroU32::new(v * 1024))
    };

    session.ratelimits.set_download_bps(download_bps);
    session.ratelimits.set_upload_bps(upload_bps);

    Ok(())
}

/// Mirror of `torrent_pause_all` for the "Resume all" toolbar
/// action. Skips completed torrents.
#[tauri::command]
pub async fn torrent_resume_all() -> Result<usize, String> {
    let engine = wait_for_engine().await?;
    let session = {
        let guard = engine.read().await;
        guard.session().ok_or_else(|| "Torrent engine not initialized".to_string())?.clone()
    };

    let to_resume: Vec<Arc<librqbit::ManagedTorrent>> = session.with_torrents(|iter| {
        iter.filter_map(|(_id, mt)| {
            let stats = mt.stats();
            let state = &stats.state;
            let pausable = matches!(
                state,
                librqbit::TorrentStatsState::Paused
            ) || matches!(
                map_state_to_status(
                    state,
                    stats.total_bytes,
                    stats.progress_bytes,
                    stats.error.as_deref(),
                ),
                DownloadStatus::Paused
            );
            if pausable {
                Some(Arc::clone(mt))
            } else {
                None
            }
        })
        .collect()
    });

    let mut affected = 0usize;
    for handle in &to_resume {
        if session.unpause(handle).await.is_ok() {
            affected += 1;
        }
    }

    let mut guard = engine.write().await;
    let mut direct_resumed = 0;
    let mut to_spawn = Vec::new();

    for (id, d) in guard.downloads_mut().iter_mut() {
        if (id.starts_with("dd_") || id.starts_with("db_")) && matches!(d.status, DownloadStatus::Paused) {
            let is_magnet = d.source_uri.starts_with("magnet:");
            if !is_magnet {
                d.status = DownloadStatus::Downloading;
                to_spawn.push((id.clone(), d.source_uri.clone(), d.save_path.clone()));
                direct_resumed += 1;
            }
        }
    }

    for (id, url, save_path) in to_spawn {
        let bytes_counter = Arc::new(std::sync::atomic::AtomicU64::new(0));
        guard.direct_counters.insert(id.clone(), Arc::clone(&bytes_counter));

        let engine_weak = Arc::downgrade(&engine);
        tokio::spawn(async move {
            crate::downloader::direct::run_direct_download(
                id,
                url,
                save_path,
                bytes_counter,
                engine_weak,
            ).await;
        });
    }

    if affected > 0 || direct_resumed > 0 {
        for handle in &to_resume {
            let info_hash = &handle.shared().info_hash;
            let fid = make_frontend_id_from_hash(&info_hash.0);
            if let Some(d) = guard.downloads_mut().get_mut(&fid) {
                d.status = if d.total_size.unwrap_or(0) > 0 {
                    DownloadStatus::Downloading
                } else {
                    DownloadStatus::FetchingMetadata
                };
            }
        }
        guard.mark_dirty();
        guard.emit_progress_force();
    }

    Ok(affected + direct_resumed)
}

#[tauri::command]
pub async fn torrent_update_only_files(
    id: String,
    only_files: Vec<usize>,
) -> Result<(), String> {
    let engine = wait_for_engine().await?;
    let numeric_id = parse_handle_id(&id)?;
    let session = {
        let guard = engine.read().await;
        guard.session().ok_or_else(|| "Torrent engine not initialized".to_string())?.clone()
    };
    let handle = find_handle(&session, numeric_id)
        .ok_or_else(|| format!("Download not found: {}", id))?;
    let only_files_set: std::collections::HashSet<usize> = only_files.into_iter().collect();
    session.update_only_files(&handle, &only_files_set).await.map_err(|e| {
        format!("Failed to update files: {}", e)
    })?;

    {
        let mut guard = engine.write().await;
        guard.refresh_stats().await;
        guard.emit_progress_force();
    }

    Ok(())
}

#[tauri::command]
pub async fn torrent_start_selected(
    id: String,
    only_files: Vec<usize>,
    auto_extract: bool,
) -> Result<(), String> {
    let engine = wait_for_engine().await?;

    // Snapshot what we know about the torrent BEFORE we go async —
    // especially the file list. The async branch below can run for
    // a while (waiting on metadata), during which the user might
    // interact with the engine through other commands, so pulling
    // the inputs out under the lock now avoids grabbing the lock
    // later and keeps the snapshot consistent with what we showed
    // in the file-selection UI.
    let source_uri;
    let save_path;
    let game_id;
    let source_name;
    let existing_files: Vec<TorrentFile>;
    {
        let mut guard = engine.write().await;
        {
            let d = guard.downloads.get_mut(&id)
                .ok_or_else(|| format!("Download not found in engine: {}", id))?;
            d.status = DownloadStatus::FetchingMetadata;
            d.added_at = unix_now();
            source_uri = d.source_uri.clone();
            save_path = normalize_path(&d.save_path);
            game_id = d.game_id.clone();
            source_name = d.source_name.clone();
            existing_files = d.files.clone();
        }
        guard.emit_progress_force();
    }

    let session = {
        let guard = engine.read().await;
        guard.session().ok_or_else(|| "Torrent engine not initialized".to_string())?.clone()
    };

    let engine_clone = Arc::clone(&engine);
    tokio::spawn(async move {
        // The torrent was already added with list_only=true (during
        // the "Fetch Files List" step in DownloadModal). Calling
        // add_torrent again would normally return AlreadyManaged,
        // but the original add's `list_only` flag isn't undone by
        // a re-add — librqbit continues to treat the torrent as a
        // metadata-only entry and never starts piece downloads.
        //
        // Force a clean slate by removing the list_only entry from
        // the librqbit session first. Re-adding the same magnet
        // afterwards is fast: librqbit retains the metadata in its
        // session-state cache, so the new add_torrent returns
        // straight to Live without another DHT bootstrap.
        if let Ok(numeric_id) = parse_handle_id(&id) {
            if let Some(handle) = find_handle(&session, numeric_id) {
                let real_session_id = handle.id();
                if let Err(e) = session
                    .delete(librqbit::api::TorrentIdOrHash::Id(real_session_id), false)
                    .await
                {
                    eprintln!("[gamelib] torrent_start_selected: pre-delete failed (will continue): {}", e);
                }
            }
        }

        let add = librqbit::AddTorrent::from_url(source_uri.clone());
        let add_opts = librqbit::AddTorrentOptions {
            output_folder: Some(save_path.clone().into()),
            overwrite: true,
            list_only: false,
            only_files: Some(only_files.clone()),
            ..Default::default()
        };

        match tokio::time::timeout(
            Duration::from_secs(120),
            session.add_torrent(add, Some(add_opts)),
        )
        .await
        {
            Ok(Ok(response)) => {
                let handle_opt = response.into_handle();
                if handle_opt.is_none() {
                    eprintln!("[gamelib] torrent_start_selected: add_torrent returned a response with no handle (unexpected for list_only=false); surfacing as Error.");
                }
                if let Some(mut handle) = handle_opt {
                    let only_files_set: std::collections::HashSet<usize> =
                        only_files.into_iter().collect();

                    // `update_only_files` requires metadata to be
                    // loaded; if we call it before librqbit has parsed
                    // the .torrent / magnet metadata, it returns an
                    // error and our file selection is silently lost.
                    // Retry briefly (up to ~30s) until metadata is
                    // available so the user's selection actually
                    // sticks.
                    //
                    // librqbit 8.1.1's `with_metadata` returns
                    // `Result<R, Error>`, not `Option<R>`, so we use
                    // `.is_ok()` to test for the parsed-metadata
                    // success state.
                    let mut update_ok = false;
                    for attempt in 0..30 {
                        if handle.with_metadata(|_| ()).is_ok() {
                            match session
                                .update_only_files(&handle, &only_files_set)
                                .await
                            {
                                Ok(()) => {
                                    update_ok = true;
                                    break;
                                }
                                Err(e) => {
                                    eprintln!(
                                        "[gamelib] torrent_start_selected: update_only_files failed (will retry): {}",
                                        e
                                    );
                                }
                            }
                        } else if attempt == 9 {
                            // Single progress log at ~10s so a stuck
                            // download shows up in the logs instead
                            // of looking like a hang. Don't spam
                            // every iteration.
                            eprintln!(
                                "[gamelib] torrent_start_selected: metadata not parsed after 10s; continuing to wait for file selection to apply..."
                            );
                        }
                        tokio::time::sleep(Duration::from_secs(1)).await;
                    }
                    if !update_ok {
                        eprintln!(
                            "[gamelib] torrent_start_selected: gave up waiting for metadata; file selection may not be applied."
                        );
                    }

                    if let Err(e) = session.unpause(&handle).await {
                        eprintln!("[gamelib] torrent_start_selected: unpause failed: {}", e);
                    }

                    // SAFETY NET (librqbit session-state restore quirk):
                    //
                    // The "Choose Files" flow added this infohash with
                    // `list_only=true` *before* calling this command. That
                    // list_only add left a `finished=true` marker in
                    // librqbit's on-disk session-state JSON under
                    // `state_dir`. When we then `delete` + re-add the same
                    // infohash with `list_only=false` + `unpause`, the
                    // on-disk cache can be restored before librqbit has
                    // had a chance to re-check the pieces — yielding
                    // `stats.progress_bytes == stats.total_bytes > 0` on
                    // the very first `handle.stats()` call, even though
                    // no piece has been transferred on disk. Without
                    // this guard, `map_state_to_status` would mark the
                    // download `Completed` immediately and the user
                    // would see "Finished" with empty save_path bytes.
                    //
                    // Force one more clean delete + re-add cycle if the
                    // first cycle's stats report the torrent as already
                    // complete. The re-add bypasses the cached row and
                    // starts fresh. Two attempts is enough in practice:
                    // either the first one dislodges the cache, or the
                    // second one does (the effective working set has
                    // shrunk by then and librqbit won't re-restore the
                    // same virtual-completed entry).
                    let mut retry_attempted = false;
                    for stale_attempt in 0..2 {
                        let snapshot = handle.stats();
                        if snapshot.progress_bytes < snapshot.total_bytes
                            || snapshot.total_bytes == 0
                        {
                            break;
                        }
                        retry_attempted = true;
                        eprintln!(
                            "[gamelib] torrent_start_selected: stale \"completed\" state \
                             detected (progress_bytes={}, total_bytes={}) — forcing clean \
                             re-add (attempt {}/2)",
                            snapshot.progress_bytes,
                            snapshot.total_bytes,
                            stale_attempt + 1
                        );
                        if let Err(e) = session
                            .delete(
                                librqbit::api::TorrentIdOrHash::Id(handle.id()),
                                false,
                            )
                            .await
                        {
                            eprintln!(
                                "[gamelib] torrent_start_selected: stale-retry delete \
                                 failed (will continue): {}",
                                e
                            );
                        }
                        let retry = librqbit::AddTorrent::from_url(source_uri.clone());
                        let retry_opts = librqbit::AddTorrentOptions {
                            output_folder: Some(save_path.clone().into()),
                            overwrite: true,
                            list_only: false,
                            only_files: Some(
                                only_files_set.iter().copied().collect(),
                            ),
                            ..Default::default()
                        };
                        // 120s matches the original `add_torrent` budget so a slow
                        // tracker (the very thing that just finished a 2-minute
                        // fetch) doesn't get aborted earlier on the retry than
                        // on the first attempt.
                        let retry_response = tokio::time::timeout(
                            Duration::from_secs(120),
                            session.add_torrent(retry, Some(retry_opts)),
                        )
                        .await;
                        match retry_response {
                            Ok(Ok(resp)) => {
                                if let Some(new_handle) = resp.into_handle() {
                                    // CRITICAL: apply only_files BEFORE unpause,
                                    // and wait for metadata to load first. Without
                                    // this wait the call silently fails (librqbit
                                    // hasn't parsed metadata yet) and the torrent
                                    // downloads ALL files — ballooning the
                                    // transfer to many× the user's selection and
                                    // making the user perceive a "very slow" rate
                                    // relative to what they expected to download.
                                    // Mirror the outer update_only_files retry
                                    // loop's pattern so file selection sticks.
                                    let mut update_ok = false;
                                    for attempt in 0..30 {
                                        if new_handle.with_metadata(|_| ()).is_ok() {
                                            match session
                                                .update_only_files(
                                                    &new_handle,
                                                    &only_files_set,
                                                )
                                                .await
                                            {
                                                Ok(()) => {
                                                    update_ok = true;
                                                    break;
                                                }
                                                Err(e) => {
                                                    eprintln!(
                                                        "[gamelib] torrent_start_selected: \
                                                         stale-retry update_only_files \
                                                         failed (will retry): {}",
                                                        e
                                                    );
                                                }
                                            }
                                        } else if attempt == 9 {
                                            eprintln!(
                                                "[gamelib] torrent_start_selected: \
                                                 stale-retry metadata not parsed \
                                                 after 10s; continuing to wait \
                                                 for file selection to apply..."
                                            );
                                        }
                                        tokio::time::sleep(Duration::from_secs(1)).await;
                                    }
                                    if !update_ok {
                                        eprintln!(
                                            "[gamelib] torrent_start_selected: stale-retry \
                                             gave up waiting for metadata; file selection \
                                             may not be applied and torrent may \
                                             download ALL files."
                                        );
                                    }
                                    let _ = session.unpause(&new_handle).await;
                                    handle = new_handle;
                                } else {
                                    // Unexpected — `list_only=false`
                                    // should always yield a handle.
                                    // Log so ops can see why the
                                    // retry didn't dislodge the
                                    // stale state. The post-retry
                                    // demotion below will then
                                    // demote `initial_status` so the
                                    // user sees `Downloading` (the
                                    // honest state matching the
                                    // still-empty save folder) rather
                                    // than the bogus `Completed`.
                                    eprintln!(
                                        "[gamelib] torrent_start_selected: stale-retry \
                                         returned a response with no handle \
                                         (unexpected for list_only=false)."
                                    );
                                    break;
                                }
                            }
                            Ok(Err(e)) => {
                                eprintln!(
                                    "[gamelib] torrent_start_selected: stale-retry \
                                     add_torrent failed (will abort retry): {}",
                                    e
                                );
                                break;
                            }
                            Err(_) => {
                                eprintln!(
                                    "[gamelib] torrent_start_selected: stale-retry \
                                     add_torrent timed out (will abort retry)."
                                );
                                break;
                            }
                        }
                    }

                    let info_hash = &handle.shared().info_hash;
                    let new_id_str = make_frontend_id_from_hash(&info_hash.0);

                    let stats = handle.stats();
                    let total_bytes = stats.total_bytes;
                    let initial_status = map_state_to_status(
                        &stats.state,
                        total_bytes,
                        stats.progress_bytes,
                        stats.error.as_deref(),
                    );

                    // FINAL SAFETY NET: only fires when the retry loop
                    // above actually entered (i.e. the pre-retry stats
                    // looked stale) AND the post-retry stats STILL report
                    // `progress_bytes == total_bytes > 0`. Without the
                    // `retry_attempted` gate, an honestly-fast tiny
                    // torrent that genuinely completes in ~1s would be
                    // unnecessarily demoted to `Downloading` for one poll
                    // cycle (visible status flicker on the popover); with
                    // it, the demotion is reserved for cases where the
                    // retry loop confirmed a real librqbit quirk and
                    // still couldn't shake it loose.
                    let initial_status = if retry_attempted
                        && matches!(initial_status, DownloadStatus::Completed)
                        && total_bytes > 0
                        && stats.progress_bytes == total_bytes
                    {
                        eprintln!(
                            "[gamelib] torrent_start_selected: retry couldn't \
                             dislodge stale completed state; demoting \
                             initial Completed to Downloading \
                             (progress={}, total={}).",
                            stats.progress_bytes, total_bytes
                        );
                        DownloadStatus::Downloading
                    } else {
                        initial_status
                    };

                    let mut guard = engine_clone.write().await;
                    if new_id_str != id {
                        guard.downloads_mut().remove(&id);
                    }

                    let name = handle
                        .name()
                        .unwrap_or_else(|| "Downloading\u{2026}".to_string());

                    // Build the file list from the live handle when
                    // metadata is available; otherwise fall back to
                    // the cached `existing_files` snapshot so the UI
                    // doesn't briefly show an empty list. Either
                    // path applies `only_files_set` to `.selected`
                    // so the engine-derived file list matches the
                    // user's choice.
                    let live_files: Option<Vec<TorrentFile>> = handle.with_metadata(|meta_data| {
                        meta_data.file_infos.iter().enumerate().map(|(i, info)| {
                            let f_selected = only_files_set.contains(&i);
                            TorrentFile {
                                name: info.relative_filename.to_string_lossy().into_owned(),
                                size: info.len,
                                downloaded: 0,
                                progress: 0.0,
                                selected: f_selected,
                            }
                        }).collect::<Vec<TorrentFile>>()
                    }).ok();
                    let files = live_files.unwrap_or_else(|| {
                        existing_files
                            .into_iter()
                            .enumerate()
                            .map(|(i, mut f)| {
                                // Default `.selected = true` for any
                                // index the user kept in the
                                // selection set, otherwise false.
                                f.selected = only_files_set.contains(&i);
                                f.downloaded = 0;
                                f.progress = 0.0;
                                f
                            })
                            .collect()
                    });

                    // `total_bytes` is the size of the entire
                    // torrent, but the user may have deselected most
                    // of the files — using the full size as the
                    // progress denominator would make the bar
                    // report a misleadingly low percentage of
                    // "remaining" work. Sum only the SELECTED files
                    // so the denominator matches what we're
                    // actually downloading.
                    let selected_sum: u64 = files
                        .iter()
                        .filter(|f| f.selected)
                        .map(|f| f.size)
                        .sum();
                    let total_size = if selected_sum > 0 {
                        Some(selected_sum)
                    } else {
                        // No selected files (shouldn't happen
                        // because the UI gates on size > 0) — fall
                        // back to stats.total_bytes, then to None.
                        if total_bytes > 0 {
                            Some(total_bytes)
                        } else {
                            None
                        }
                    };

                    let download = TorrentDownload {
                        id: new_id_str.clone(),
                        name,
                        source_uri,
                        save_path,
                        downloaded: 0,
                        total_size,
                        progress: Some(0.0),
                        download_speed: 0,
                        upload_speed: 0,
                        seeds: 0,
                        peers: 0,
                        // Don't hardcode `Downloading` — trust the
                        // librqbit state. If the torrent is still
                        // `Initializing` we'll show FetchingMetadata
                        // until it goes Live, which is the honest
                        // status. (Bug 2's class of issues are
                        // addressed by `map_state_to_status` and
                        // the auto-delete gate in `refresh_stats`,
                        // not by overstating the status here.)
                        status: initial_status,
                        game_id,
                        source_name,
                        added_at: unix_now(),
                        files,
                        auto_extract: Some(auto_extract),
                        extracted: Some(false),
                        uris: None,
                    };
                    guard.downloads_mut().insert(new_id_str, download);
                    guard.mark_dirty();
                    guard.emit_progress_force();
                } else {
                    // No handle from `into_handle()` — surface as
                    // an Error status so the user gets feedback
                    // instead of a stuck FetchingMetadata row.
                    let mut guard = engine_clone.write().await;
                    if let Some(d) = guard.downloads_mut().get_mut(&id) {
                        d.status = DownloadStatus::Error(
                            "Failed to start torrent: no handle returned".to_string(),
                        );
                        guard.mark_dirty();
                        guard.emit_progress_force();
                    }
                }
            }
            Ok(Err(e)) => {
                eprintln!("[gamelib] Failed to add torrent in background: {}", e);
                let mut guard = engine_clone.write().await;
                if let Some(d) = guard.downloads_mut().get_mut(&id) {
                    d.status = DownloadStatus::Error(format!("Failed to start torrent: {}", e));
                    guard.mark_dirty();
                    guard.emit_progress_force();
                }
            }
            Err(_) => {
                eprintln!("[gamelib] Timeout starting torrent in background");
                let mut guard = engine_clone.write().await;
                if let Some(d) = guard.downloads_mut().get_mut(&id) {
                    d.status = DownloadStatus::Error("Timeout starting torrent".to_string());
                    guard.mark_dirty();
                    guard.emit_progress_force();
                }
            }
        }
    });

    Ok(())
}

static RUNNING_EXTRACTIONS: OnceLock<Arc<StdMutex<HashMap<String, u32>>>> = OnceLock::new();

fn running_extractions() -> Arc<StdMutex<HashMap<String, u32>>> {
    RUNNING_EXTRACTIONS.get_or_init(|| Arc::new(StdMutex::new(HashMap::new()))).clone()
}

#[cfg(windows)]
fn kill_pid(pid: u32) {
    let _ = std::process::Command::new("taskkill")
        .args(&["/F", "/PID", &pid.to_string()])
        .output();
}

#[cfg(not(windows))]
fn kill_pid(pid: u32) {
    let _ = std::process::Command::new("kill")
        .args(&["-9", &pid.to_string()])
        .output();
}

pub fn kill_extraction(id: &str) {
    let map = running_extractions();
    let pid_opt = {
        let mut guard = map.lock().unwrap();
        guard.remove(id)
    };
    if let Some(pid) = pid_opt {
        println!("[TorrentEngine] Killing extraction process (PID {}) for torrent {}", pid, id);
        kill_pid(pid);
    }
}

pub fn cleanup_extractions() {
    let map = running_extractions();
    let mut guard = map.lock().unwrap();
    for (id, pid) in guard.drain() {
        println!("[TorrentEngine] App exit: killing extraction process (PID {}) for torrent {}", pid, id);
        kill_pid(pid);
    }
}

fn run_command_tracked(id: &str, mut cmd: std::process::Command) -> Result<(), String> {
    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn process: {}", e))?;
    let pid = child.id();
    
    {
        let map = running_extractions();
        let mut guard = map.lock().unwrap();
        guard.insert(id.to_string(), pid);
    }
    
    let status = child.wait().map_err(|e| format!("Failed to wait for process (PID {}): {}", pid, e))?;
    
    {
        let map = running_extractions();
        let mut guard = map.lock().unwrap();
        guard.remove(id);
    }
    
    if status.success() {
        Ok(())
    } else {
        Err(format!("Process (PID {}) exited with error status: {}", pid, status))
    }
}

pub fn extract_archives_for_torrent(id: &str, save_path: &str, files: &[TorrentFile]) -> Result<(), String> {
    let save_path_buf = PathBuf::from(save_path);
    let mut extracted_any = false;
    let mut last_err = None;

    for file in files {
        let file_path = save_path_buf.join(&file.name);
        if !file_path.exists() {
            continue;
        }

        let ext = file_path.extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();

        let name_lower = file.name.to_lowercase();
        let is_archive = match ext.as_str() {
            "zip" => true,
            "7z" => !name_lower.ends_with(".7z.002") && !name_lower.contains(".7z.00"),
            "rar" => {
                if name_lower.contains(".part") {
                    name_lower.contains(".part1.rar") || name_lower.contains(".part01.rar")
                } else {
                    true
                }
            }
            _ => false,
        };

        if is_archive {
            let dest_dir = file_path.parent().unwrap_or(&save_path_buf);
            println!("[TorrentEngine] Extracting {:?} to {:?}", file_path, dest_dir);
            match extract_archive(id, &file_path, dest_dir) {
                Ok(_) => {
                    extracted_any = true;
                }
                Err(e) => {
                    println!("[TorrentEngine] Extract error for {:?}: {}", file_path, e);
                    last_err = Some(e);
                }
            }
        }
    }

    if extracted_any {
        Ok(())
    } else if let Some(e) = last_err {
        Err(e)
    } else {
        Ok(())
    }
}

fn delete_archives_for_torrent(save_path: &str, files: &[TorrentFile]) {
    let save_path_buf = PathBuf::from(save_path);
    for file in files {
        let file_path = save_path_buf.join(&file.name);
        if !file_path.exists() {
            continue;
        }

        let ext = file_path.extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();

        let name_lower = file.name.to_lowercase();
        let is_archive_part = match ext.as_str() {
            "zip" | "rar" | "7z" | "tar" | "gz" => true,
            _ => {
                let has_numeric_part = ext.chars().all(|c| c.is_ascii_digit());
                let is_rar_part = ext.starts_with('r') && ext[1..].chars().all(|c| c.is_ascii_digit());
                let is_zip_part = ext.starts_with('z') && ext[1..].chars().all(|c| c.is_ascii_digit());
                
                has_numeric_part || is_rar_part || is_zip_part || name_lower.contains(".7z.")
            }
        };

        if is_archive_part {
            println!("[TorrentEngine] Deleting archive file {:?}", file_path);
            let _ = std::fs::remove_file(file_path);
        }
    }
}

pub fn extract_archive(id: &str, archive_path: &std::path::Path, dest_dir: &std::path::Path) -> Result<(), String> {
    use std::process::Command;
    let paths_to_try = [
        PathBuf::from("7z"),
        PathBuf::from("C:\\Program Files\\7-Zip\\7z.exe"),
        PathBuf::from("C:\\Program Files (x86)\\7-Zip\\7z.exe"),
    ];

    let mut found_7z = false;
    let mut exe_path = PathBuf::new();

    for p in &paths_to_try {
        if p.to_string_lossy() == "7z" {
            if Command::new("7z").arg("-h").output().is_ok() {
                found_7z = true;
                exe_path = p.clone();
                break;
            }
        } else if p.exists() {
            found_7z = true;
            exe_path = p.clone();
            break;
        }
    }

    if found_7z {
        let mut cmd = Command::new(&exe_path);
        cmd.arg("x")
           .arg(archive_path)
           .arg(format!("-o{}", dest_dir.to_string_lossy()))
           .arg("-y");
        
        return run_command_tracked(id, cmd);
    }

    let ext = archive_path.extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    if ext == "zip" {
        let mut cmd = Command::new("tar");
        cmd.arg("-xf")
           .arg(archive_path)
           .arg("-C")
           .arg(dest_dir);
        
        if run_command_tracked(id, cmd).is_ok() {
            return Ok(());
        }
    }

    if ext == "zip" {
        let mut cmd = Command::new("powershell");
        cmd.arg("-Command")
           .arg(format!(
               "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
               archive_path.to_string_lossy(),
               dest_dir.to_string_lossy()
           ));
        
        return run_command_tracked(id, cmd);
    }

    Err(format!(
        "No extractor (7z/tar/PowerShell) found or format not supported for extension .{}",
        ext
    ))
}

#[tauri::command]
pub async fn torrent_open_folder(app: AppHandle, id: String) -> Result<(), String> {
    let engine = wait_for_engine().await?;
    let path_str = {
        let guard = engine.read().await;
        let d = guard.downloads_map().get(&id)
            .ok_or_else(|| format!("Download not found: {}", id))?;
        d.save_path.clone()
    };
    
    let path = std::path::Path::new(&path_str);
    let target_path = if path.is_file() {
        path.parent().unwrap_or(path)
    } else {
        path
    };
    
    if !target_path.exists() {
        return Err("Download folder does not exist yet".to_string());
    }
    
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_path(target_path.to_string_lossy().as_ref(), None::<&str>)
        .map_err(|e| format!("Failed to open folder: {}", e))
}
