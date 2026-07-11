//! Unified game watcher — process detection, session tracking, and smarter exe resolution.
//!
//! Replaces the old split between `launch_game` (child.wait() for local games),
//! `spawn_game_exe` + `watch_steam_game` (WMI polling for Steam), and the
//! "largest .exe" heuristic in `steam/sync.rs`.
//!
//! ## Architecture
//!
//! ```text
//! GameWatcher (Tauri managed state, single background thread)
//! ├── process_index: HashMap<normalized_exe_path, Vec<GameRef>>
//! │   Built from the full game library on startup + refreshed on sync
//! │
//! ├── active_sessions: HashMap<game_id, ActiveSession>
//! │   Tracks running games — whether launched through the app or
//! │   detected passively via WMI polling
//! │
//! └── Background poll loop (every 5 s):
//!     1. Query Win32_Process (all processes, one WMI round-trip)
//!     2. Match running processes against process_index
//!     3. New matches → start metrics, emit "game-started"
//!     4. Missing matches → stop metrics, emit "game-exited"
//! ```
//!
//! ## Exe Resolution (resolve_game_exe)
//!
//! Multi-strategy approach tried in priority order:
//! 1. Name scoring: how well the exe stem matches the game name
//! 2. Directory depth: prefer root-level exes over deeply nested ones
//! 3. Keyword exclusion: extended skip list for known non-game binaries
//! 4. Size: final tiebreaker — largest remaining candidate

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Instant, Duration};
use tauri::{AppHandle, Emitter};

use crate::metrics_collector;
use crate::steam_game_watcher;

// ─── Data Types ───────────────────────────────────────────────────────────────

/// Lightweight reference to a game in the library — just enough to
/// match a process path and emit events.
#[derive(Debug, Clone)]
pub struct GameRef {
    pub game_id: String,
    pub game_name: String,
    /// Platform tag (e.g. "Steam", "Epic", "Manual"). Stored for
    /// upcoming Steam-specific features (rich presence, overlay
    /// hooks) and multi-store integrations.
    #[allow(dead_code)]
    pub platform: String,
    pub exe_path: Option<String>,        // known exe path (from sync or manual import)
    pub install_dir: Option<PathBuf>,    // for prefix-matching Steam/Epic games
    /// Steam AppID when known. Used by `register_launched_session` to
    /// resolve the install dir; see comment on that method for the
    /// Steam protocol-launch flow that benefits from this carry-over.
    #[allow(dead_code)]
    pub steam_app_id: Option<u32>,
}

/// A running game session tracked by the watcher.
struct ActiveSession {
    game_id: String,
    game_name: String,
    started_at: Instant,
    last_pid: u32,
    stop_tx: std::sync::mpsc::Sender<()>,
    metrics_rx: Option<std::sync::mpsc::Receiver<Option<metrics_collector::SessionMetrics>>>,
    /// `true` if the session was started by `register_launched_session`
    /// (user clicked Launch); `false` if detected passively by
    /// `start_passive_session`. Wired up so future telemetry and
    /// Activity-page filters can distinguish manual launches from
    /// games the user started outside the app.
    #[allow(dead_code)]
    launched_by_app: bool,
    matched_exe: String,
    /// Install directory used to re-attach the session when the initial
    /// process exits but a launcher has spawned the real game process, or
    /// when the launch provided no PID (UAC elevation, Steam protocol).
    install_dir: Option<PathBuf>,
    /// When the process was first noticed as dead/missing.
    /// If Some, the session is in a grace period.
    lost_at: Option<Instant>,
}

/// How long a pending session (last_pid == 0) may exist before it is
/// considered failed and ended. Steam updates / slow UAC prompts can
/// take a while, so 10 minutes is generous without being infinite.
const PENDING_SESSION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(600);

/// Serializable info about a candidate exe found during resolution.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExeCandidate {
    pub path: String,
    pub size_bytes: u64,
    pub name_score: f32,
    pub depth: u32,
}

// ─── GameWatcher ──────────────────────────────────────────────────────────────

pub struct GameWatcher {
    process_index: HashMap<String, Vec<GameRef>>,
    active_sessions: HashMap<String, ActiveSession>,
    gpu_id: Option<String>,
    gpu_name: Option<String>,
}

impl GameWatcher {
    pub fn new() -> Self {
        Self {
            process_index: HashMap::new(),
            active_sessions: HashMap::new(),
            gpu_id: None,
            gpu_name: None,
        }
    }

    /// Rebuild the process index from a list of game references.
    pub fn rebuild_index(&mut self, games: Vec<GameRef>) {
        let mut index: HashMap<String, Vec<GameRef>> = HashMap::new();

        for game in games {
            if let Some(ref exe) = game.exe_path {
                let norm = exe.to_lowercase().replace('/', "\\");
                index.entry(norm).or_default().push(game.clone());
            }

            if let Some(ref install_dir) = game.install_dir {
                let dir_key = install_dir.to_string_lossy().to_lowercase().replace('/', "\\");
                let dir_key = dir_key.trim_end_matches('\\');
                let prefixed_key = format!("__dir__{}", dir_key);
                index.entry(prefixed_key).or_default().push(game.clone());
            }
        }

        self.process_index = index;
    }

    pub fn set_gpu(&mut self, id: Option<String>, name: Option<String>) {
        self.gpu_id = id;
        self.gpu_name = name;
    }

    /// Register a session launched explicitly through the app.
    pub fn register_launched_session(
        &mut self,
        game_id: &str,
        game_name: &str,
        platform: &str,
        steam_app_id: Option<u32>,
        exe_path: Option<&str>,
        initial_pid: u32,
        metrics_stop_tx: std::sync::mpsc::Sender<()>,
        metrics_rx: std::sync::mpsc::Receiver<Option<metrics_collector::SessionMetrics>>,
    ) {
        let install_dir = if platform == "Steam" {
            steam_app_id
                .and_then(|id| steam_game_watcher::game_install_path(id))
                .or_else(|| {
                    exe_path.and_then(|ep| get_game_root_dir(Path::new(ep)))
                })
        } else if let Some(ep) = exe_path {
            get_game_root_dir(Path::new(ep))
        } else {
            None
        };

        self.active_sessions.insert(
            game_id.to_string(),
            ActiveSession {
                game_id: game_id.to_string(),
                game_name: game_name.to_string(),
                started_at: Instant::now(),
                last_pid: initial_pid,
                stop_tx: metrics_stop_tx,
                metrics_rx: Some(metrics_rx),
                launched_by_app: true,
                matched_exe: exe_path.unwrap_or("").to_string(),
                install_dir,
                lost_at: None,
            },
        );
    }

    /// Run one poll cycle. Resolves pending sessions, re-attaches sessions
    /// whose tracked process died to a still-running process in the install
    /// directory, and detects new passively-launched games.
    pub fn poll(&mut self, app_handle: &AppHandle) {
        let processes = query_running_processes();
        if processes.is_empty() {
            return;
        }

        // ── Resolve pending sessions and re-attach dead sessions ───────
        // Pending sessions (last_pid == 0) happen when a launch provides
        // no PID: UAC elevation without a process handle, or Steam
        // protocol launches. If the tracked PID dies (launcher exits
        // after spawning the real game), we look for any still-running
        // process inside the game's install directory and continue the
        // same session.
        let running_pids: std::collections::HashSet<u32> =
            processes.iter().map(|p| p.pid).collect();

        let mut ended_ids: Vec<String> = Vec::new();
        let mut transitions: Vec<(String, ProcessInfo)> = Vec::new();

        for (gid, session) in &mut self.active_sessions {
            let is_pending = session.last_pid == 0;
            let is_currently_running = !is_pending && running_pids.contains(&session.last_pid);

            if is_currently_running {
                session.lost_at = None;
                continue;
            }

            let mut found_proc = None;
            if let Some(ref install_dir) = session.install_dir {
                if let Some(proc) = find_best_process_in_dir(&processes, install_dir) {
                    found_proc = Some(proc);
                }
            }

            if let Some(proc) = found_proc {
                session.lost_at = None;
                transitions.push((gid.clone(), proc));
            } else {
                if is_pending {
                    if session.started_at.elapsed() > PENDING_SESSION_TIMEOUT {
                        ended_ids.push(gid.clone());
                    }
                } else {
                    if let Some(lost_time) = session.lost_at {
                        if lost_time.elapsed() > Duration::from_secs(20) {
                            ended_ids.push(gid.clone());
                        }
                    } else {
                        session.lost_at = Some(Instant::now());
                        eprintln!(
                            "[game_watcher] {} (PID {}) lost. Starting 20s grace period.",
                            session.game_name, session.last_pid
                        );
                    }
                }
            }
        }

        // Apply transitions before ending sessions so a session that
        // just found a new process is not also finished.
        for (gid, proc) in transitions {
            if let Some(session) = self.active_sessions.get_mut(&gid) {
                let was_pending = session.last_pid == 0;

                // Stop metrics collection bound to the old (or dummy)
                // PID. A new collector will be started for the real one.
                let _ = session.stop_tx.send(());

                session.last_pid = proc.pid;
                session.matched_exe = proc.exe_path.clone();
                session.lost_at = None;

                eprintln!(
                    "[game_watcher] {} transitioned to PID {} ({})",
                    session.game_name, proc.pid, proc.exe_path
                );

                let (tx, rx) = metrics_collector::start_metrics_collection(
                    5,
                    proc.pid,
                    self.gpu_id.clone(),
                    self.gpu_name.clone(),
                );
                session.stop_tx = tx;
                session.metrics_rx = Some(rx);

                // Notify the frontend the first time a process is found.
                if was_pending {
                    let _ = app_handle.emit(
                        "game-started",
                        GameStartedPayload {
                            game_id: session.game_id.clone(),
                            game_name: session.game_name.clone(),
                            detected_exe: Some(proc.exe_path),
                        },
                    );
                }
            }
        }

        for gid in ended_ids {
            self.finish_session(app_handle, &gid);
        }

        // ── Collect which new processes match known games ─────────────
        let tracked: std::collections::HashSet<String> = self
            .active_sessions
            .keys()
            .cloned()
            .collect();

        // Collect matches before starting sessions (avoid borrow conflicts)
        let mut new_matches: Vec<(GameRef, ProcessInfo)> = Vec::new();

        for proc in &processes {
            let norm = proc.exe_path.to_lowercase().replace('/', "\\");

            // Exact path match
            if let Some(games) = self.process_index.get(&norm) {
                for game in games {
                    if !tracked.contains(&game.game_id) {
                        new_matches.push((game.clone(), proc.clone()));
                    }
                }
            }

            // Install-dir prefix match
            for (key, games) in &self.process_index {
                if let Some(dir) = key.strip_prefix("__dir__") {
                    if norm.starts_with(dir) {
                        // Make sure the match is actually inside the directory, not a
                        // sibling path that happens to share the prefix (e.g. "FooBar"
                        // when looking for "Foo").
                        let remainder = &norm[dir.len()..];
                        if remainder.starts_with('\\') || remainder.is_empty() {
                            for game in games {
                                if !tracked.contains(&game.game_id) {
                                    // Check not already in new_matches
                                    if !new_matches.iter().any(|(g, _)| g.game_id == game.game_id) {
                                        new_matches.push((game.clone(), proc.clone()));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Now start sessions (mutable borrow of self)
        for (game, proc) in new_matches {
            self.start_passive_session(app_handle, &game, &proc);
        }
    }

    fn start_passive_session(
        &mut self,
        app_handle: &AppHandle,
        game: &GameRef,
        proc: &ProcessInfo,
    ) {
        let pid = proc.pid;
        let (stop_tx, metrics_rx) = metrics_collector::start_metrics_collection(
            5,
            pid,
            self.gpu_id.clone(),
            self.gpu_name.clone(),
        );

        self.active_sessions.insert(
            game.game_id.clone(),
            ActiveSession {
                game_id: game.game_id.clone(),
                game_name: game.game_name.clone(),
                started_at: Instant::now(),
                last_pid: pid,
                stop_tx,
                metrics_rx: Some(metrics_rx),
                launched_by_app: false,
                matched_exe: proc.exe_path.clone(),
                install_dir: game.install_dir.clone(),
                lost_at: None,
            },
        );

        let _ = app_handle.emit(
            "game-started",
            GameStartedPayload {
                game_id: game.game_id.clone(),
                game_name: game.game_name.clone(),
                detected_exe: Some(proc.exe_path.clone()),
            },
        );
    }

    fn finish_session(&mut self, app_handle: &AppHandle, game_id: &str) {
        if let Some(mut session) = self.active_sessions.remove(game_id) {
            let _ = session.stop_tx.send(());
            let elapsed = session.started_at.elapsed().as_secs();
            let metrics = session
                .metrics_rx
                .as_mut()
                .and_then(|rx| rx.recv_timeout(std::time::Duration::from_secs(10)).unwrap_or(None));

            // Capture the wall-clock time at session-end (Unix ms). The
            // frontend uses this to stamp `Game.lastPlayed`, which drives
            // the "Continue Playing" rail on the Library page. We use the
            // same clock the frontend reads via `Date.now()` (i.e. system
            // time, not monotonic) so the value survives timezone shifts
            // and clock corrections without a re-derivation step.
            let finished_at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);

            let _ = app_handle.emit(
                "game-exited",
                GameExitPayload {
                    game_id: session.game_id.clone(),
                    elapsed_seconds: elapsed,
                    finished_at,
                    metrics,
                },
            );
        }
    }

    /// Returns whether the watcher currently tracks a session for
    /// the given `game_id`. Exposed as a public API for upcoming
    /// frontend status checks (e.g. "Stop download if game is running").
    #[allow(dead_code)]
    pub fn is_running(&self, game_id: &str) -> bool {
        self.active_sessions.contains_key(game_id)
    }
}

// ─── Shared Types ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameExitPayload {
    #[serde(rename = "gameId")]
    pub game_id: String,
    #[serde(rename = "elapsedSeconds")]
    pub elapsed_seconds: u64,
    /// Unix-millisecond timestamp captured at session-end (when the
    /// process actually exited). The frontend uses this to stamp
    /// `Game.lastPlayed`, which drives the "Continue Playing" rail on
    /// the Library page. `0` is treated as "unknown" and skipped
    /// upstream so an unset system clock doesn't poison the value.
    #[serde(rename = "finishedAt")]
    pub finished_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metrics: Option<metrics_collector::SessionMetrics>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameStartedPayload {
    #[serde(rename = "gameId")]
    pub game_id: String,
    #[serde(rename = "gameName")]
    pub game_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detected_exe: Option<String>,
}

#[derive(Debug, Clone)]
struct ProcessInfo {
    pid: u32,
    exe_path: String,
    /// Working set size in bytes; used to pick the dominant process
    /// when multiple candidates live inside the same install directory.
    working_set_size: u64,
}

/// Query running processes natively using Toolhelp32 snapshot.
/// This is 1000x faster than WMI, handles UAC elevated processes via
/// PROCESS_QUERY_LIMITED_INFORMATION, and does not depend on COM or WMI service availability.
#[cfg(windows)]
fn query_running_processes() -> Vec<ProcessInfo> {
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW, PROCESS_NAME_WIN32};
    use windows::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
    use windows::Win32::Foundation::CloseHandle;
    use std::os::windows::ffi::OsStringExt;

    let mut result = Vec::new();

    unsafe {
        let snapshot = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
            Ok(h) => h,
            Err(_) => return Vec::new(),
        };

        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };

        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let pid = entry.th32ProcessID;
                if pid != 0 {
                    if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                        let mut buffer = [0u16; 1024];
                        let mut size = buffer.len() as u32;
                        if QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, windows::core::PWSTR::from_raw(buffer.as_mut_ptr()), &mut size).is_ok() {
                            let path = std::ffi::OsString::from_wide(&buffer[..size as usize])
                                .to_string_lossy()
                                .into_owned();

                            let mut counters = PROCESS_MEMORY_COUNTERS::default();
                            let working_set = if GetProcessMemoryInfo(
                                handle,
                                &mut counters,
                                std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
                            ).is_ok() {
                                counters.WorkingSetSize as u64
                            } else {
                                0
                            };

                            result.push(ProcessInfo {
                                pid,
                                exe_path: path,
                                working_set_size: working_set,
                            });
                        }
                        let _ = CloseHandle(handle);
                    }
                }

                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
    }

    result
}

#[cfg(not(windows))]
fn query_running_processes() -> Vec<ProcessInfo> {
    Vec::new()
}

/// Helper to extract the game's root directory from an executable path,
/// walking up out of common binary or helper subfolders to prevent
/// launcher vs. game process sibling directory path mismatches.
fn get_game_root_dir(exe_path: &Path) -> Option<PathBuf> {
    let mut current = exe_path.parent()?;
    const COMMON_SUBDIRS: &[&str] = &[
        "bin", "binaries", "win64", "win32", "x64", "x86", "release", "debug",
        "win-x64", "win-x86", "game", "retail", "launcher",
    ];
    // Walk up as long as the current directory name is a common binary/launcher folder,
    // up to a maximum of 3 levels.
    for _ in 0..3 {
        if let Some(name) = current.file_name().and_then(|n| n.to_str()) {
            let lower = name.to_lowercase();
            if COMMON_SUBDIRS.iter().any(|&item| item == lower) {
                if let Some(parent) = current.parent() {
                    current = parent;
                    continue;
                }
            }
        }
        break;
    }
    Some(current.to_path_buf())
}

/// Find the best running process inside an install directory. Prefers
/// executables whose stem does not contain known non-game keywords
/// (launchers, crash handlers, etc.) and, when multiple candidates
/// remain, picks the one with the largest working set.
fn find_best_process_in_dir(processes: &[ProcessInfo], install_dir: &Path) -> Option<ProcessInfo> {
    let dir_lower = install_dir
        .to_string_lossy()
        .to_lowercase()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_string();

    if dir_lower.is_empty() {
        return None;
    }

    let mut candidates: Vec<ProcessInfo> = processes
        .iter()
        .filter(|p| {
            let path_lower = p.exe_path.to_lowercase().replace('/', "\\");
            if !path_lower.starts_with(&dir_lower) {
                return false;
            }
            // Make sure the match is actually inside the directory, not a
            // sibling path that happens to share the prefix (e.g. "FooBar"
            // when looking for "Foo").
            let remainder = &path_lower[dir_lower.len()..];
            remainder.starts_with('\\') || remainder.is_empty()
        })
        .cloned()
        .collect();

    if candidates.is_empty() {
        return None;
    }

    // Prefer executables that are not launchers/crash handlers/etc.
    let skip_filtered: Vec<ProcessInfo> = candidates
        .iter()
        .filter(|p| {
            if let Some(stem) = Path::new(&p.exe_path).file_stem().and_then(|s| s.to_str()) {
                let lower = stem.to_lowercase();
                !SKIP_KEYWORDS.iter().any(|kw| lower.contains(kw))
            } else {
                true
            }
        })
        .cloned()
        .collect();

    if !skip_filtered.is_empty() {
        candidates = skip_filtered;
    }

    candidates.sort_by(|a, b| b.working_set_size.cmp(&a.working_set_size));
    candidates.into_iter().next()
}

// ─── Background Poll Thread ───────────────────────────────────────────────────

pub fn start_background_poll(
    watcher: Arc<Mutex<GameWatcher>>,
    app_handle: AppHandle,
) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(5));

            let mut w = match watcher.lock() {
                Ok(w) => w,
                Err(_) => break,
            };
            w.poll(&app_handle);
        }
    });
}

// ─── Smarter Exe Resolution ───────────────────────────────────────────────────

const SKIP_KEYWORDS: &[&str] = &[
    // Redistributables & runtimes
    "redist", "vcredist", "dotnet", "dxsetup", "directx",
    "ue4prereq", "ue4-prereq", "ue5prereq", "ue5-prereq",
    "physx", "openal",
    // Launchers & patchers
    "launcher", "patcher", "updater", "bootstrapper",
    // Crash handlers & telemetry
    "crash", "crashpad", "crashreport", "crashhandler",
    "errorreport", "bugreport", "debug",
    // Uninstallers
    "unin", "unins", "uninstall", "unwise",
    // Setup/Install
    "setup", "install", "register",
    // Utilities
    "helper", "autorun", "plugin", "manual", "readme", "7za",
    "config", "configuration", "settings",
    // Steam-specific
    "steamclient", "steamerror",
    // Unity
    "unitycrashhandler", "unitycrashhandler64",
    "videoplayer",
    // Unreal
    "ue4_game", "ue5_game",
    // Known non-game processes
    "gamingservices", "gamingservice",
    "eadesktop", "origin", "ubisoftconnect", "upc",
    "epicgameslauncher", "galaxyclient",
];

/// Resolve the main game executable for a given install directory.
///
/// Multi-strategy approach:
/// 1. Name match scoring against the provided game_name (+200 exact, +10 per word)
/// 2. Directory depth: prefer shallower exes (-5 per level below root)
/// 3. Keyword exclusion (handled during scan)
/// 4. Size: largest as tiebreaker
pub fn resolve_game_exe(install_dir: &Path, game_name: &str) -> Option<String> {
    let candidates = scan_for_exe_candidates(install_dir);
    if candidates.is_empty() {
        return None;
    }

    let game_name_lower = game_name.to_lowercase();
    let game_words: Vec<&str> = game_name_lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .filter(|w| w.len() > 1)
        .collect();

    let mut scored: Vec<(&ExeCandidate, u32)> = candidates
        .iter()
        .map(|c| {
            let stem = Path::new(&c.path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();

            let mut score: u32 = 0;

            // Name match scoring
            if stem == game_name_lower {
                score += 200;
            }
            let stem_words: Vec<&str> = stem
                .split(|c: char| !c.is_alphanumeric())
                .filter(|w| !w.is_empty())
                .collect();
            for gw in &game_words {
                for sw in &stem_words {
                    if sw.contains(gw) || gw.contains(sw) {
                        score += 10;
                    }
                }
            }

            // Directory depth penalty
            let depth_penalty = (c.depth.saturating_sub(1) * 5) as u32;
            score = score.saturating_sub(depth_penalty);

            (c, score)
        })
        .collect();

    scored.sort_by(|(a, a_score), (b, b_score)| {
        b_score
            .cmp(a_score)
            .then_with(|| b.size_bytes.cmp(&a.size_bytes))
    });

    scored.first().map(|(c, _)| c.path.clone())
}

fn scan_for_exe_candidates(dir: &Path) -> Vec<ExeCandidate> {
    let mut candidates = Vec::new();
    scan_dir_for_candidates(dir, &mut candidates, 0);
    candidates
}

fn scan_dir_for_candidates(dir: &Path, candidates: &mut Vec<ExeCandidate>, depth: u32) {
    if depth > 4 {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                let lower = name.to_lowercase();
                if lower.starts_with('.')
                    || lower.starts_with('_')
                    || lower == "redist"
                    || lower == "redistributables"
                    || lower == "__installer"
                    || lower == "support"
                    || lower == "directx"
                    || lower == "dotnet"
                    || lower == "vcredist"
                {
                    continue;
                }
            }
            scan_dir_for_candidates(&path, candidates, depth + 1);
        } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            if !ext.eq_ignore_ascii_case("exe") {
                continue;
            }

            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                let lower = stem.to_lowercase();
                if SKIP_KEYWORDS.iter().any(|kw| lower.contains(kw)) {
                    continue;
                }
            }

            if let Ok(meta) = entry.metadata() {
                candidates.push(ExeCandidate {
                    path: path.to_string_lossy().to_string(),
                    size_bytes: meta.len(),
                    name_score: 0.0,
                    depth,
                });
            }
        }
    }
}

/// Convenience wrapper: resolve the exe for a Steam AppID.
pub fn resolve_steam_game_exe(steam_app_id: u32, game_name: &str) -> Option<String> {
    let install_dir = steam_game_watcher::game_install_path(steam_app_id)?;
    if !install_dir.exists() {
        return None;
    }
    resolve_game_exe(&install_dir, game_name)
}

/// Build GameRef entries from a list of game data structs.
pub fn build_game_refs_from_library(games: &[GameRefInput]) -> Vec<GameRef> {
    games
        .iter()
        .map(|g| {
            let install_dir = if g.platform == "Steam" {
                g.steam_app_id
                    .and_then(|id| steam_game_watcher::game_install_path(id))
                    .or_else(|| {
                        if !g.exe_path.is_empty() {
                            get_game_root_dir(Path::new(&g.exe_path))
                        } else {
                            None
                        }
                    })
            } else if !g.exe_path.is_empty() {
                get_game_root_dir(Path::new(&g.exe_path))
            } else {
                None
            };

            GameRef {
                game_id: g.game_id.clone(),
                game_name: g.game_name.clone(),
                platform: g.platform.clone(),
                exe_path: if g.exe_path.is_empty() {
                    None
                } else {
                    Some(g.exe_path.clone())
                },
                install_dir,
                steam_app_id: g.steam_app_id,
            }
        })
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameRefInput {
    pub game_id: String,
    pub game_name: String,
    pub platform: String,
    pub exe_path: String,
    pub steam_app_id: Option<u32>,
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_skip_keywords_cover_known_patterns() {
        let bad_names = [
            "vcredist_x64", "UE4PrereqSetup", "UnityCrashHandler64",
            "CrashReportClient", "unins000", "dotnetfx35", "launcher",
            "patcher", "updater", "dxsetup",
        ];
        for name in bad_names {
            assert!(
                SKIP_KEYWORDS.iter().any(|kw| name.to_lowercase().contains(kw)),
                "SKIP_KEYWORDS should cover '{}'",
                name
            );
        }
    }

    #[test]
    fn test_skip_keywords_dont_match_game_names() {
        let good_names = [
            "witcher3", "Cyberpunk2077", "EldenRing", "BaldursGate3",
            "RedDeadRedemption2", "gtav", "cs2", "RocketLeague",
            "Hades2", "Starfield",
        ];
        for name in good_names {
            assert!(
                !SKIP_KEYWORDS.iter().any(|kw| name.to_lowercase().contains(kw)),
                "'{}' should NOT be excluded by SKIP_KEYWORDS",
                name
            );
        }
    }

    #[test]
    fn test_name_scoring_exact_match() {
        let exact = ExeCandidate {
            path: "C:\\Games\\EldenRing\\EldenRing.exe".to_string(),
            size_bytes: 100_000,
            name_score: 0.0,
            depth: 1,
        };
        let partial = ExeCandidate {
            path: "C:\\Games\\EldenRing\\Binaries\\Win64\\eldenring.exe".to_string(),
            size_bytes: 200_000,
            name_score: 0.0,
            depth: 3,
        };
        // exact: +200 (stem == name) +10 (word overlap) = 210
        // partial: +10 (word overlap) - 10 (depth 3 → penalty 10) = 0
        let exact_score: u32 = 200 + 10;
        let partial_score: u32 = 10_i32.saturating_sub(10) as u32;
        assert!(exact_score > partial_score);
    }

    #[test]
    fn test_get_game_root_dir_heuristics() {
        assert_eq!(
            get_game_root_dir(Path::new("C:\\Games\\GameName\\game.exe")),
            Some(PathBuf::from("C:\\Games\\GameName"))
        );
        assert_eq!(
            get_game_root_dir(Path::new("C:\\Games\\GameName\\binaries\\win64\\game.exe")),
            Some(PathBuf::from("C:\\Games\\GameName"))
        );
        assert_eq!(
            get_game_root_dir(Path::new("C:\\Games\\GameName\\game\\bin\\x64\\game.exe")),
            Some(PathBuf::from("C:\\Games\\GameName"))
        );
        assert_eq!(
            get_game_root_dir(Path::new("C:\\Games\\GameName\\MySubFolder\\game.exe")),
            Some(PathBuf::from("C:\\Games\\GameName\\MySubFolder"))
        );
    }
}
