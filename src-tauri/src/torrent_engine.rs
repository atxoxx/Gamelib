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
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::OnceCell;
use tokio::time::interval;

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
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SavedMetadata {
    pub source_uri: String,
    pub save_path: String,
    pub game_id: Option<String>,
    pub source_name: String,
    pub added_at: u64,
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
}

// ─── Engine wrapper ─────────────────────────────────────────────────────────

/// Wrapper around `librqbit::Session` plus our own metadata map.
pub struct TorrentEngine {
    session: Option<Arc<librqbit::Session>>,
    /// Mirror of the session's torrents with our extra fields,
    /// keyed by frontend-facing id (`"dl_<n>"`).
    downloads: HashMap<String, TorrentDownload>,
    state_dir: PathBuf,
}

impl TorrentEngine {
    pub fn new(state_dir: PathBuf) -> Self {
        Self {
            session: None,
            downloads: HashMap::new(),
            state_dir,
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
        let Some(session) = self.session.as_ref() else {
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

        let collected: Vec<TorrentDownload> = session.with_torrents(|iter| {
            let mut results = Vec::new();
            for (id, mt) in iter {
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
                let status = map_state_to_status(&stats.state, total, downloaded);
                let (download_speed, upload_speed, seeds, peers) =
                    extract_live_stats(&stats);

                let fid = make_frontend_id(id);
                let meta = saved_metadata.get(&fid);
                let source_uri = meta.map(|m| m.source_uri.clone()).unwrap_or_default();
                let save_path = meta.map(|m| m.save_path.clone()).unwrap_or_default();
                let game_id = meta.and_then(|m| m.game_id.clone());
                let source_name = meta
                    .map(|m| m.source_name.clone())
                    .unwrap_or_else(|| "Restored".to_string());
                let added_at = meta.map(|m| m.added_at).unwrap_or(0);

                // Fetch files list if metadata is available
                let files = mt.with_metadata(|meta_data| {
                    meta_data.file_infos.iter().enumerate().map(|(i, info)| {
                        let f_downloaded = stats.file_progress.get(i).copied().unwrap_or(0);
                        let f_size = info.len;
                        let f_progress = if f_size > 0 {
                            f_downloaded as f32 / f_size as f32
                        } else {
                            0.0
                        };
                        TorrentFile {
                            name: info.relative_filename.to_string_lossy().into_owned(),
                            size: f_size,
                            downloaded: f_downloaded,
                            progress: f_progress,
                        }
                    }).collect::<Vec<TorrentFile>>()
                }).unwrap_or_default();

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
                });
            }
            results
        });
        for d in collected {
            self.downloads.insert(d.id.clone(), d);
        }
        self.save_downloads_metadata();
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
            })
        }).collect();
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
///
/// Method (not a free function) so the impl-block callers can
/// write it without `Self::`; the `torrent_add` command calls
/// it as `Self::build_peer_opts()`. AddTorrentOptions inherits
/// the session's `peer_opts` automatically — no need to repeat
/// the same struct on every add.
    fn build_peer_opts() -> Option<librqbit::PeerConnectionOptions> {
        Some(librqbit::PeerConnectionOptions {
            connect_timeout: Some(Duration::from_secs(15)),
            read_write_timeout: Some(Duration::from_secs(45)),
            keep_alive_interval: Some(Duration::from_secs(60)),
        })
    }

/// Build a fresh `TorrentDownload` record for a newly-added
/// torrent. Extracted so the Tauri command can call it after
/// the `add_torrent` network call returns (with the engine
/// mutex re-acquired for just this fast in-memory step).
    fn build_download(
        id_str: String,
        name: String,
        source_uri: String,
        save_path: String,
        game_id: Option<String>,
        source_name: String,
    ) -> TorrentDownload {
        TorrentDownload {
            id: id_str,
            name,
            source_uri,
            save_path,
            downloaded: 0,
            total_size: None,
            progress: None,
            download_speed: 0,
            upload_speed: 0,
            seeds: 0,
            peers: 0,
            status: DownloadStatus::FetchingMetadata,
            game_id,
            source_name,
            added_at: unix_now(),
            files: Vec::new(),
        }
    }

    /// Pause a download. No-op on already-paused / completed torrents.
    pub async fn pause(&self, id: &str) -> Result<(), String> {
        let numeric_id = parse_handle_id(id)?;
        let session = self
            .session
            .as_ref()
            .ok_or_else(|| "Torrent engine not initialized".to_string())?;
        let handle = find_handle(session, numeric_id)
            .ok_or_else(|| format!("Download not found: {}", id))?;
        session.pause(&handle).await.map_err(|e| {
            format!("Failed to pause: {}", e)
        })?;
        Ok(())
    }

    /// Resume a paused download. No-op on already-downloading / completed.
    pub async fn resume(&self, id: &str) -> Result<(), String> {
        let numeric_id = parse_handle_id(id)?;
        let session = self
            .session
            .as_ref()
            .ok_or_else(|| "Torrent engine not initialized".to_string())?;
        let handle = find_handle(session, numeric_id)
            .ok_or_else(|| format!("Download not found: {}", id))?;
        session.unpause(&handle).await.map_err(|e| {
            format!("Failed to resume: {}", e)
        })?;
        Ok(())
    }

    /// Remove a download and optionally its downloaded files.
    pub async fn remove(&mut self, id: &str, delete_files: bool) -> Result<(), String> {
        let numeric_id = parse_handle_id(id)?;
        let session = self
            .session
            .as_ref()
            .ok_or_else(|| "Torrent engine not initialized".to_string())?;
        // Find the handle to verify it exists, then delete by id.
        if find_handle(session, numeric_id).is_some() {
            // Use the numeric id directly — `TorrentIdOrHash` should
            // accept `usize` via `From` or be constructable from it.
            session
                .delete(
                    librqbit::api::TorrentIdOrHash::Id(numeric_id),
                    delete_files,
                )
                .await
                .map_err(|e| format!("Failed to remove: {}", e))?;
        }
        self.downloads.remove(id);
        self.save_downloads_metadata();
        Ok(())
    }

    /// Pause every active (non-completed) torrent. Used by the
    /// "Pause all" toolbar action on the Downloads page. Already-paused
    /// and already-completed torrents are no-ops at the librqbit
    /// level, so we just iterate every entry and skip the ones
    /// that are neither Downloading / FetchingMetadata / Queued.
    ///
    /// Returns the number of torrents that actually transitioned
    /// (or were already in the target state) so the frontend can
    /// surface a sensible toast.
    pub async fn pause_all(&self) -> Result<usize, String> {
        let session = self
            .session
            .as_ref()
            .ok_or_else(|| "Torrent engine not initialized".to_string())?;
        // We must collect `Arc<ManagedTorrent>` under the
        // `with_torrents` lock and release it before any
        // `session.pause(...).await` call — the closure runs while
        // holding the session's internal mutex, so a cross-await
        // would deadlock. Cloning the Arc is just a refcount bump
        // and lets us avoid a second O(N) `find_handle` scan per
        // id (which would make the whole pass O(N²)).
        //
        // We also call `mt.stats()` exactly once per torrent and
        // bind the result: librqbit updates stats continuously, so
        // calling it 3× (once for state, once for total_bytes,
        // once for progress_bytes) could observe inconsistent
        // values and mis-classify a torrent.
        let to_pause: Vec<Arc<librqbit::ManagedTorrent>> =
            session.with_torrents(|iter| {
                iter.filter_map(|(_id, mt)| {
                    let stats = mt.stats();
                    let state = &stats.state;
                    let status = map_state_to_status(
                        state,
                        stats.total_bytes,
                        stats.progress_bytes,
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
        for handle in to_pause {
            if session.pause(&handle).await.is_ok() {
                affected += 1;
            }
        }
        Ok(affected)
    }

    /// Resume every paused / not-yet-started torrent. Mirror of
    /// `pause_all`. Completed torrents are skipped.
    pub async fn resume_all(&self) -> Result<usize, String> {
        let session = self
            .session
            .as_ref()
            .ok_or_else(|| "Torrent engine not initialized".to_string())?;
        let to_resume: Vec<Arc<librqbit::ManagedTorrent>> =
            session.with_torrents(|iter| {
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
                            stats.progress_bytes
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
        for handle in to_resume {
            if session.unpause(&handle).await.is_ok() {
                affected += 1;
            }
        }
        Ok(affected)
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

    /// Refresh our metadata cache from the session. Called every ~2 s
    /// by the background polling task.
    pub async fn refresh_stats(&mut self) {
        let Some(session) = self.session.clone() else {
            return;
        };
        /// Aggregated per-torrent snapshot pulled from librqbit under
        /// the session lock. Replaces the previous 10-tuple to keep
        /// the collect/deconstruct sites readable and order-safe.
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
            files: Vec<TorrentFile>,
        }
        let (collected, alive_ids): (Vec<StatsEntry>, Vec<String>) =
            session.with_torrents(|iter| {
                let mut entries = Vec::new();
                let mut ids = Vec::new();
                for (id, mt) in iter {
                    let fid = make_frontend_id(id);
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
                        map_state_to_status(&stats.state, total, downloaded);
                    let (download_speed, upload_speed, seeds, peers) =
                        extract_live_stats(&stats);

                    // Fetch files list if metadata is available
                    let files = mt.with_metadata(|meta_data| {
                        meta_data.file_infos.iter().enumerate().map(|(i, info)| {
                            let f_downloaded = stats.file_progress.get(i).copied().unwrap_or(0);
                            let f_size = info.len;
                            let f_progress = if f_size > 0 {
                                f_downloaded as f32 / f_size as f32
                            } else {
                                0.0
                            };
                            TorrentFile {
                                name: info.relative_filename.to_string_lossy().into_owned(),
                                size: f_size,
                                downloaded: f_downloaded,
                                progress: f_progress,
                            }
                        }).collect::<Vec<TorrentFile>>()
                    }).unwrap_or_default();

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
                    });
                }
                (entries, ids)
            });

        let alive_set: HashMap<String, ()> =
            alive_ids.into_iter().map(|id| (id, ())).collect();

        let mut save_needed = false;
        for entry in collected {
            if let Some(d) = self.downloads.get_mut(&entry.fid) {
                d.downloaded = entry.downloaded;
                d.total_size = entry.total;
                d.progress = entry.progress;
                d.download_speed = entry.download_speed;
                d.upload_speed = entry.upload_speed;
                d.seeds = entry.seeds;
                d.peers = entry.peers;
                d.status = entry.status;
                d.files = entry.files;
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
                    files: entry.files,
                };
                self.downloads.insert(entry.fid.clone(), download);
                save_needed = true;
            }
        }
        if save_needed {
            self.save_downloads_metadata();
        }
        self.downloads
            .retain(|id, _| alive_set.contains_key(id));
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

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Build the frontend-facing id from a librqbit numeric torrent id.
fn make_frontend_id(numeric_id: usize) -> String {
    format!("dl_{}", numeric_id)
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
fn map_state_to_status(
    state: &librqbit::TorrentStatsState,
    total: u64,
    downloaded: u64,
) -> DownloadStatus {
    match state {
        librqbit::TorrentStatsState::Paused => DownloadStatus::Paused,
        librqbit::TorrentStatsState::Error => {
            DownloadStatus::Error("Torrent error".into())
        }
        librqbit::TorrentStatsState::Initializing => {
            DownloadStatus::FetchingMetadata
        }
        librqbit::TorrentStatsState::Live => {
            if total > 0 && downloaded >= total {
                DownloadStatus::Completed
            } else if total == 0 {
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
        for (id, mt) in iter {
            if id == numeric_id {
                return Some(Arc::clone(mt));
            }
        }
        None
    })
}

// ─── Global singleton + background polling task ──────────────────────────────

static ENGINE: OnceCell<Arc<tokio::sync::Mutex<TorrentEngine>>> =
    OnceCell::const_new();

/// Accessor for the global engine.
pub async fn engine() -> Option<Arc<tokio::sync::Mutex<TorrentEngine>>> {
    ENGINE.get().cloned()
}

/// Poll the global engine until it's initialized, up to ~2 s
/// (20 × 100 ms). Mostly a safety net for the cold-start race:
/// `initialize_engine` is spawned from the lib.rs `setup` closure
/// and may not finish before the first user click. Without this
/// grace period, a user who clicks Download within the first
/// ~100 ms of app launch sees a spurious "engine not initialized"
/// error and assumes the download failed.
async fn wait_for_engine() -> Result<Arc<tokio::sync::Mutex<TorrentEngine>>, String> {
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
    engine.initialize().await?;
    let shared = Arc::new(tokio::sync::Mutex::new(engine));
    ENGINE
        .set(shared.clone())
        .map_err(|_| "Torrent engine already initialized".to_string())?;

    let app_for_task = app.clone();
    tokio::spawn(async move {
        let mut tick = interval(Duration::from_secs(2));
        tick.tick().await; // skip immediate first tick
        loop {
            tick.tick().await;
            let snapshot = {
                let mut guard = shared.lock().await;
                guard.refresh_stats().await;
                guard.list()
            };
            let _ = app_for_task.emit("download-progress", &snapshot);
        }
    });
    Ok(())
}

// ─── Tauri commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn torrent_add(
    magnet_uri: String,
    save_path: String,
    game_id: Option<String>,
    source_name: String,
) -> Result<TorrentDownload, String> {
    let engine = wait_for_engine().await?;

    // Step 1: Clone the session Arc while holding the lock briefly.
    // We need the session to call `add_torrent`, but we don't want
    // to hold the engine mutex during the (potentially 30 s)
    // network call — that would block all other torrent commands
    // (pause, resume, remove, get_all, etc.) for the full timeout
    // and leave the user unable to cancel a stuck download.
    let session = {
        let guard = engine.lock().await;
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

    let add = librqbit::AddTorrent::from_url(trimmed.clone());
    // Be explicit about what we want from AddTorrentOptions so
    // a future librqbit default change doesn't silently alter
    // behavior. The fields below are the ones that matter for
    // the "magnet hangs and never starts" symptom:
    //   * output_folder — where librqbit writes the downloaded
    //     files. Always set; the frontend never lets the user
    //     start a download without picking a folder first.
    //   * overwrite — don't fail when the output folder already
    //     contains a partial download from a previous attempt.
    //     librqbit's default is `false`, which is too strict for
    //     a restart-friendly app.
    //   * list_only — `false` means "start downloading
    //     immediately". librqbit's default is already `false`,
    //     but pinning it makes the intent explicit and protects
    //     against an accidental default flip upstream.
    // All other options keep librqbit's defaults (tracker
    // announce on, DHT on, no file selection filters, etc.).
    let add_opts = librqbit::AddTorrentOptions {
        output_folder: Some(save_path.clone().into()),
        overwrite: true,
        list_only: false,
        ..Default::default()
    };
    // 120 s timeout on the entire add_torrent operation. If
    // librqbit hangs waiting for DHT bootstrap or tracker
    // responses (common when the user's firewall blocks the
    // default bootstrap nodes like `router.bittorrent.com`),
    // the user gets a clear error instead of an infinite
    // spinner. The torrent may still be added to librqbit
    // internally; the timeout just means *our* command
    // returns so the UI can react.
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

    let handle = response
        .into_handle()
        .ok_or_else(|| "Torrent was added for listing only (no handle)".to_string())?;

    let handle_id = handle.id();
    let id_str = make_frontend_id(handle_id);

    // Step 3: Re-acquire the lock to insert into the downloads
    // map. This is fast (no network I/O), so the lock is held
    // for milliseconds, not the full timeout.
    //
    // Dedup: if librqbit already manages this id (either because
    // the user double-clicked Start, or because a previous
    // `add_torrent` returned the `AlreadyManaged` variant for the
    // same infohash), refresh the user-supplied association
    // fields on the cached record and return it. We deliberately
    // leave the live stats (downloaded / total_size / progress /
    // download_speed / upload_speed / seeds / peers / status /
    // name) alone — those are owned by the background poller,
    // not by the user. The `save_path` / `game_id` /
    // `source_name` refresh lets the user re-add the same
    // torrent with a different folder or game association
    // without us silently keeping the old values.
    let mut guard = engine.lock().await;
    if guard.downloads_mut().contains_key(&id_str) {
        let updated = {
            let existing = guard.downloads_mut().get_mut(&id_str).unwrap();
            existing.save_path = save_path;
            existing.game_id = game_id;
            existing.source_name = source_name;
            existing.clone()
        };
        guard.save_downloads_metadata();
        return Ok(updated);
    }

    let name = handle
        .name()
        .unwrap_or_else(|| "Fetching metadata\u{2026}".to_string());
    // Capture the insert key before `build_download` consumes
    // `id_str` — saves one `String` allocation per add compared
    // to cloning `id_str` into both the helper and the insert.
    let key = id_str.clone();
    let download = TorrentEngine::build_download(
        id_str,
        name,
        trimmed,
        save_path,
        game_id,
        source_name,
    );
    guard.downloads_mut().insert(key, download.clone());
    guard.save_downloads_metadata();
    Ok(download)
}

#[tauri::command]
pub async fn torrent_pause(id: String) -> Result<(), String> {
    let engine = wait_for_engine().await?;
    let result = {
        let guard = engine.lock().await;
        guard.pause(&id).await
    };
    result
}

#[tauri::command]
pub async fn torrent_resume(id: String) -> Result<(), String> {
    let engine = wait_for_engine().await?;
    let result = {
        let guard = engine.lock().await;
        guard.resume(&id).await
    };
    result
}

#[tauri::command]
pub async fn torrent_remove(
    id: String,
    delete_files: Option<bool>,
) -> Result<(), String> {
    let engine = wait_for_engine().await?;
    let result = {
        let mut guard = engine.lock().await;
        guard.remove(&id, delete_files.unwrap_or(false)).await
    };
    result
}

#[tauri::command]
pub async fn torrent_get_all() -> Result<Vec<TorrentDownload>, String> {
    let engine = wait_for_engine().await?;
    let result = {
        let guard = engine.lock().await;
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
    let result = {
        let guard = engine.lock().await;
        guard.pause_all().await
    };
    result
}

/// Mirror of `torrent_pause_all` for the "Resume all" toolbar
/// action. Skips completed torrents.
#[tauri::command]
pub async fn torrent_resume_all() -> Result<usize, String> {
    let engine = wait_for_engine().await?;
    let result = {
        let guard = engine.lock().await;
        guard.resume_all().await
    };
    result
}
