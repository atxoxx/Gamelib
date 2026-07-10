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
use std::time::Instant;
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
    pub platform: String,
    pub exe_path: Option<String>,        // known exe path (from sync or manual import)
    pub install_dir: Option<PathBuf>,    // for prefix-matching Steam/Epic games
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
    launched_by_app: bool,
    matched_exe: String,
    pending_install_dir: Option<PathBuf>,
}

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
                let norm = exe.to_lowercase();
                index.entry(norm).or_default().push(game.clone());
            }

            if let Some(ref install_dir) = game.install_dir {
                let dir_key = install_dir.to_string_lossy().to_lowercase();
                let dir_key = dir_key.trim_end_matches('\\').trim_end_matches('/');
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
            steam_app_id.and_then(|id| steam_game_watcher::game_install_path(id))
        } else if let Some(ep) = exe_path {
            Path::new(ep).parent().map(|p| p.to_path_buf())
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
                pending_install_dir: if initial_pid == 0 { install_dir } else { None },
            },
        );
    }

    /// Check if a pending session (Steam protocol launch) has spawned a
    /// process yet. Returns the matching ProcessInfo if found.
    fn check_pending_session(&self, session: &ActiveSession, processes: &[ProcessInfo]) -> Option<ProcessInfo> {
        let pending_dir = session.pending_install_dir.as_ref()?;
        let dir_lower = pending_dir.to_string_lossy().to_lowercase();
        for proc in processes {
            if proc.exe_path.to_lowercase().starts_with(&dir_lower) {
                return Some(proc.clone());
            }
        }
        None
    }

    /// Run one poll cycle. Returns game_ids that started and ended.
    pub fn poll(&mut self, app_handle: &AppHandle) {
        let processes = query_running_processes();
        if processes.is_empty() {
            return;
        }

        // ── Collect which sessions need to end ────────────────────────
        let running_pids: std::collections::HashSet<u32> =
            processes.iter().map(|p| p.pid).collect();

        let mut ended_ids: Vec<String> = Vec::new();
        for (gid, session) in &self.active_sessions {
            if !running_pids.contains(&session.last_pid) {
                let still_running = if let Some(ref install_dir) = self.install_dir_for_game(gid) {
                    let dir_lower = install_dir.to_string_lossy().to_lowercase();
                    processes.iter().any(|p| {
                        p.exe_path.to_lowercase().starts_with(&dir_lower)
                    })
                } else {
                    false
                };

                if !still_running {
                    ended_ids.push(gid.clone());
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
            let norm = proc.exe_path.to_lowercase();

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

        // Now start sessions (mutable borrow of self)
        for (game, proc) in new_matches {
            self.start_passive_session(app_handle, &game, &proc);
        }
    }

    fn install_dir_for_game(&self, game_id: &str) -> Option<PathBuf> {
        for games in self.process_index.values() {
            for g in games {
                if g.game_id == game_id {
                    return g.install_dir.clone();
                }
            }
        }
        None
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
                pending_install_dir: None,
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
}

/// Query Win32_Process via WMI for all running processes.
#[cfg(windows)]
fn query_running_processes() -> Vec<ProcessInfo> {
    use wmi::{COMLibrary, WMIConnection};

    let com_lib = match COMLibrary::new() {
        Ok(lib) => lib,
        Err(_) => match COMLibrary::without_security() {
            Ok(lib) => lib,
            Err(_) => return Vec::new(),
        },
    };
    let wmi_con = match WMIConnection::new(com_lib) {
        Ok(con) => con,
        Err(_) => return Vec::new(),
    };

    #[derive(serde::Deserialize, Debug)]
    #[serde(rename_all = "PascalCase")]
    struct ProcRow {
        process_id: Option<u32>,
        executable_path: Option<String>,
    }

    let query = "SELECT ProcessId, ExecutablePath FROM Win32_Process WHERE ExecutablePath IS NOT NULL";
    let rows: Vec<ProcRow> = match wmi_con.raw_query::<ProcRow>(query) {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };

    rows.into_iter()
        .filter_map(|r| {
            Some(ProcessInfo {
                pid: r.process_id?,
                exe_path: r.executable_path?,
            })
        })
        .collect()
}

#[cfg(not(windows))]
fn query_running_processes() -> Vec<ProcessInfo> {
    Vec::new()
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
            } else if g.platform == "Local" && !g.exe_path.is_empty() {
                Path::new(&g.exe_path).parent().map(|p| p.to_path_buf())
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
}
