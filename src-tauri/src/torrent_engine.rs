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
        let persistent_opts = librqbit::SessionOptions {
            persistence: Some(librqbit::SessionPersistenceConfig::Json {
                folder: Some(self.state_dir.clone()),
            }),
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
                //    session simply doesn't write to disk.
                let transient_opts = librqbit::SessionOptions {
                    persistence: None,
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
                results.push(TorrentDownload {
                    id: make_frontend_id(id),
                    name,
                    source_uri: String::new(),
                    save_path: String::new(),
                    downloaded,
                    total_size: if total > 0 { Some(total) } else { None },
                    progress,
                    download_speed,
                    upload_speed,
                    seeds,
                    peers,
                    status,
                    game_id: None,
                    source_name: "Restored".to_string(),
                    added_at: 0,
                });
            }
            results
        });
        for d in collected {
            self.downloads.insert(d.id.clone(), d);
        }
    }

    /// Add a new download. `source_uri` is a magnet link or .torrent URL.
    pub async fn add(
        &mut self,
        source_uri: String,
        save_path: String,
        game_id: Option<String>,
        source_name: String,
    ) -> Result<String, String> {
        let session = self
            .session
            .as_ref()
            .ok_or_else(|| "Torrent engine not initialized".to_string())?;
        let trimmed = source_uri.trim().to_string();
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
        let add_opts = librqbit::AddTorrentOptions {
            output_folder: Some(save_path.clone().into()),
            ..Default::default()
        };
        let response = session
            .add_torrent(add, Some(add_opts))
            .await
            .map_err(|e| format!("Failed to add torrent: {}", e))?;

        let handle = response
            .into_handle()
            .ok_or_else(|| "Torrent was added for listing only (no handle)".to_string())?;

        let handle_id = handle.id();
        let name = handle
            .name()
            .unwrap_or_else(|| "Fetching metadata\u{2026}".to_string());
        let id_str = make_frontend_id(handle_id);
        let download = TorrentDownload {
            id: id_str.clone(),
            name,
            source_uri: trimmed,
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
        };
        self.downloads.insert(id_str.clone(), download);
        Ok(id_str)
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
                    });
                }
                (entries, ids)
            });

        let alive_set: HashMap<String, ()> =
            alive_ids.into_iter().map(|id| (id, ())).collect();

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
                if d.name.is_empty()
                    || d.name == "Fetching metadata\u{2026}"
                {
                    if let Some(n) = entry.name {
                        d.name = n;
                    }
                }
            }
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
) -> Result<String, String> {
    let engine = engine()
        .await
        .ok_or_else(|| "Torrent engine not initialized".to_string())?;
    let result = {
        let mut guard = engine.lock().await;
        guard
            .add(magnet_uri, save_path, game_id, source_name)
            .await
    };
    result
}

#[tauri::command]
pub async fn torrent_pause(id: String) -> Result<(), String> {
    let engine = engine()
        .await
        .ok_or_else(|| "Torrent engine not initialized".to_string())?;
    let result = {
        let guard = engine.lock().await;
        guard.pause(&id).await
    };
    result
}

#[tauri::command]
pub async fn torrent_resume(id: String) -> Result<(), String> {
    let engine = engine()
        .await
        .ok_or_else(|| "Torrent engine not initialized".to_string())?;
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
    let engine = engine()
        .await
        .ok_or_else(|| "Torrent engine not initialized".to_string())?;
    let result = {
        let mut guard = engine.lock().await;
        guard.remove(&id, delete_files.unwrap_or(false)).await
    };
    result
}

#[tauri::command]
pub async fn torrent_get_all() -> Result<Vec<TorrentDownload>, String> {
    let engine = engine()
        .await
        .ok_or_else(|| "Torrent engine not initialized".to_string())?;
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
    let engine = engine()
        .await
        .ok_or_else(|| "Torrent engine not initialized".to_string())?;
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
    let engine = engine()
        .await
        .ok_or_else(|| "Torrent engine not initialized".to_string())?;
    let result = {
        let guard = engine.lock().await;
        guard.resume_all().await
    };
    result
}
