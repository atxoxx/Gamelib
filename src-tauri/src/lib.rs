use std::path::Path;
use std::sync::Arc;
use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant, SystemTime};
use std::sync::OnceLock;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, WindowEvent};
use tokio::sync::Mutex;

mod config;
mod crackwatch;
mod price;
mod protondb;
mod db;
mod game_scraper;
mod game_watcher;
mod gpu_detector;
mod metrics_collector;
mod rtss_reader;
mod mahm_reader;
mod deals;
mod steam;
mod epic;
#[cfg_attr(not(test), allow(dead_code))] // re-exported only via `inventory`
mod gog;
mod humble;
mod steam_game_watcher;
mod rockstar;
mod uplay;
mod size;
// New modules for the download feature. See each module's
// top-of-file doc comment for the design rationale.
mod source_manager;
mod store_checker;
mod torrent_engine;
mod achievements;
mod local_achievements;
mod achievement_watcher;
mod downloader;
mod tray;
mod system_screenshots;
use game_scraper::{GameMetadataResult, LaunchBoxImageResult, StoreGameSummary, TimeToBeat, SimilarGame, ReleaseDateInfo, IgdbReview, LanguageSupportInfo, ReviewFetchResult, RichAboutPayload, PcRequirementsPayload};
use game_watcher::{GameWatcher, GameRefInput};
use gpu_detector::GpuInfo;
use epic::auth::{epic_start_login, epic_finish_login, epic_login_with_refresh_token, epic_is_authenticated, epic_logout};
use epic::sync::{epic_sync_library, epic_get_filters};
use gog::auth::{gog_is_authenticated, gog_logout, gog_start_login};
use gog::sync::gog_sync_library;
use humble::{
    humble_get_settings, humble_is_authenticated, humble_logout, humble_save_settings,
    humble_start_login, humble_sync_library,
};
use rockstar::sync::{
    rockstar_launch_game, rockstar_open_client, rockstar_sync_library,
    rockstar_uninstall_game,
};
use uplay::{
    uplay_get_settings, uplay_install_game, uplay_launch_game, uplay_open_client,
    uplay_save_settings, uplay_sync_library, uplay_uninstall_game,
};
use steam::auth::{
    steam_connect, steam_is_authenticated, steam_logout, steam_get_session,
};
use steam::sync::steam_sync_games;
use size::{detect_game_size, check_paths_exist, open_folder, disk_usage, move_game_install, uninstall_game};
use system_screenshots::detect_system_screenshot_folders;

/// Serializable game data matching the frontend Game type.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GameData {
    id: String,
    name: String,
    path: String,
    platform: String,
    installed: bool,
    play_time: String,
    added_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    cover_art_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    notes: Option<String>,
    /// Total disk footprint of the game's root folder in bytes (None = not yet measured).
    /// `default` is required so older `games.json` payloads (without these
    /// fields) deserialize cleanly instead of erroring out.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    size_bytes: Option<u64>,
    /// ISO-8601 timestamp of the last successful size detection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    size_detected_at: Option<String>,
    /// Path of the folder the size was measured against. Auditable from the
    /// size-edit modal so users can see (and override) the root we summed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    size_root_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    banner_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    logo_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    developer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    publisher: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    release_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    genres: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    metadata_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    metadata_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    storyline: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    igdb_rating: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    critic_rating: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    themes: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    game_modes: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    player_perspectives: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    screenshots: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    videos: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    websites: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    time_to_beat: Option<TimeToBeat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    similar_games: Option<Vec<SimilarGame>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    releases: Option<Vec<ReleaseDateInfo>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    igdb_reviews: Option<Vec<IgdbReview>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    alternative_names: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    collection: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    franchise: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    game_category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    release_status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    steam_app_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    steam_playtime: Option<u32>,
    // â”€â”€ GOG Galaxy integration fields â”€â”€
    /// GOG numeric product id (e.g. `"1207658925"`). Stored as
    /// `String` because `api.gog.com/products` returns IDs as both
    /// ints and strings depending on the endpoint, and we want
    /// lossless round-trips through serde.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    gog_game_id: Option<String>,
    /// Playtime in minutes, sourced from
    /// `https://gameplay.gog.com/clients/<user_id>/playtime`.
    /// Optional: missing on first sync or when the gameplay endpoint
    /// 403s on a private account.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    gog_playtime: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    steam_achievements: Option<Vec<SteamAchievementSerde>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    language_supports: Option<Vec<LanguageSupportInfo>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    store_source: Option<String>,
    // Epic Games Store integration fields
    #[serde(default, skip_serializing_if = "Option::is_none")]
    epic_namespace: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    epic_catalog_item_id: Option<String>,
    // Humble Bundle integration fields
    #[serde(default, skip_serializing_if = "Option::is_none")]
    humble_game_id: Option<String>,
    /// True when sourced from the Humble Trove catalog (subscriber
    /// streaming library) — drives `humble://launch/` behaviour.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    humble_is_trove: Option<bool>,
    /// True when this entry is a non-game extra (soundtrack/artbook/…).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    humble_is_extra: Option<bool>,
    // Ubisoft Connect integration fields
    #[serde(default, skip_serializing_if = "Option::is_none")]
    uplay_game_id: Option<String>,
    /// `true` when the game was installed/launched via Ubisoft Connect
    /// (drives `uplay://launch/<id>` behaviour).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    uplay_is_connect: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    launch_arguments: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    run_as_admin: Option<bool>,
    /// Unix-millisecond timestamp of when the user most recently exited a
    /// session for this game. `None` until the first session ends. Used by
    /// the Library page's "Continue Playing" rail to surface recently-active
    /// titles. Persisted via the existing `save_games` round-trip â€” no
    /// separate write path needed. `default` keeps older `games.json` files
    /// (which predate this field) deserializing cleanly.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_played: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    play_status: Option<String>,
}

/// Serializable Steam achievement for the GameData struct.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SteamAchievementSerde {
    apiname: String,
    name: String,
    description: String,
    achieved: bool,
    unlocktime: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    icongray: Option<String>,
}

/// Persist the game library.
///
/// Phase 3: writes every row to the `games` SQLite table in a single
/// transaction. `GameRow` mirrors the camelCase `GameData` shape, so
/// we round-trip each entry through compact JSON rather than maintain
/// a hand-rolled field-by-field converter.
#[tauri::command]
fn save_games(app: tauri::AppHandle, games: Vec<GameData>) -> Result<(), String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let mut rows: Vec<db::games::GameRow> = Vec::with_capacity(games.len());
    for g in games {
        let value = serde_json::to_value(&g).map_err(|e| format!("to_value: {e}"))?;
        let row: db::games::GameRow = serde_json::from_value(value)
            .map_err(|e| format!("to GameRow: {e}"))?;
        rows.push(row);
    }
    db::games::upsert_all(db_state.inner(), &rows)
}

/// Load the game library. Returns every row in Continue-Playing order
/// (most recent `last_played` first, then alpha by name).
#[tauri::command]
fn load_games(app: tauri::AppHandle) -> Result<Vec<GameData>, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let rows = db::games::list_all(db_state.inner()).map_err(|e| e.to_string())?;
    let mut out: Vec<GameData> = Vec::with_capacity(rows.len());
    for r in rows {
        let value = serde_json::to_value(&r).map_err(|e| format!("to_value: {e}"))?;
        let g: GameData = serde_json::from_value(value)
            .map_err(|e| format!("to GameData: {e}"))?;
        out.push(g);
    }
    Ok(out)
}

/// Phase-3 hot path: bump one game's `last_played` without rewriting
/// the rest of the row or the whole library. Called by the
/// `game-exited` event path; replaces what used to be a
/// `save_games(round_trip)` on every session-end.
#[tauri::command]
fn update_game_last_played(
    app: tauri::AppHandle,
    game_id: String,
    last_played_ms: u64,
) -> Result<(), String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::games::update_last_played(db_state.inner(), &game_id, last_played_ms)
}

/// Detect GPUs on the system using WMI.
#[tauri::command]
fn detect_gpus() -> Vec<GpuInfo> {
    gpu_detector::detect_gpus()
}

/// Static summary of the host hardware, returned by `get_system_info`.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub cpu_name: String,
    pub ram_gb: u32,
    pub gpus: Vec<GpuInfo>,
}

/// Force-terminate the tracked process for `game_id` and finalize the
/// session. Frontend exposes this as the "Force Close" button on the
/// Game page when a game is in the running state.
///
/// Returns a `ForceCloseResult { pid, killed }` so the frontend can
/// distinguish "we actually terminated the process" (success toast)
/// from "we cleared the session state but the underlying process
/// could not be safely killed" (warning toast) â€” the latter happens
/// when the tracked PID was recycled by the OS to an unrelated
/// process between the last poll and the click, or when the user
/// doesn't have `PROCESS_TERMINATE` rights on it.
///
/// On Windows, terminates via `TerminateProcess` after verifying the
/// PID still belongs to the session's tracked exe (PID-recycling
/// guard; see `kill_pid_if_exe_matches`). On every other target the
/// watcher doesn't track processes at all (the cross-platform
/// `query_running_processes()` returns empty on non-Windows), so
/// there is nothing to terminate â€” but we still run the full
/// `finish_session` cleanup so the running indicator clears and the
/// activity session is recorded.
#[tauri::command]
fn force_close_game(
    app: tauri::AppHandle,
    game_id: String,
) -> Result<game_watcher::ForceCloseResult, String> {
    let watcher: tauri::State<'_, Arc<std::sync::Mutex<GameWatcher>>> = app.state();
    let mut w = watcher.lock().map_err(|e| e.to_string())?;
    let result = w.force_close(&app, &game_id);
    let _ = app.emit(
        "discord-presence-update",
        serde_json::json!({
            "state": "stopped",
            "gameId": game_id,
            "finishedAt": SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
        }),
    );
    result
}

/// Windows error code ERROR_ELEVATION_REQUIRED (740). Returned when a
/// process needs to be launched with administrator privileges.
#[cfg(windows)]
const ERROR_ELEVATION_REQUIRED: i32 = 740;

/// Launch an executable with elevated privileges using the Windows
/// `runas` verb. Returns the PID of the newly created process so the
/// GameWatcher can track it. Returns `Ok(None)` when the process was
/// launched but no process handle could be obtained; the watcher will
/// fall back to passive detection.
///
/// This triggers a UAC prompt. If the user cancels, an error is returned.
#[cfg(windows)]
fn launch_elevated(path: &std::path::Path, cwd: &std::path::Path, args: Option<&str>) -> Result<Option<u32>, String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;
    use windows::Win32::Foundation::{CloseHandle, HWND, ERROR_CANCELLED};
    use windows::core::PCWSTR;
    use windows::Win32::System::Threading::GetProcessId;
    use windows::Win32::UI::Shell::{ShellExecuteExW, SHELLEXECUTEINFOW, SEE_MASK_NOCLOSEPROCESS};
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let file_wide: Vec<u16> = OsStr::new(path)
        .encode_wide()
        .chain(Some(0))
        .collect();
    let cwd_wide: Vec<u16> = OsStr::new(cwd)
        .encode_wide()
        .chain(Some(0))
        .collect();
    let runas_verb: Vec<u16> = OsStr::new("runas")
        .encode_wide()
        .chain(Some(0))
        .collect();
    let args_wide: Option<Vec<u16>> = args.map(|s| {
        OsStr::new(s)
            .encode_wide()
            .chain(Some(0))
            .collect()
    });

    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS,
        hwnd: HWND(ptr::null_mut()),
        lpVerb: PCWSTR::from_raw(runas_verb.as_ptr()),
        lpFile: PCWSTR::from_raw(file_wide.as_ptr()),
        lpParameters: args_wide.as_ref()
            .map(|v| PCWSTR::from_raw(v.as_ptr()))
            .unwrap_or(PCWSTR::null()),
        lpDirectory: PCWSTR::from_raw(cwd_wide.as_ptr()),
        nShow: SW_SHOWNORMAL.0,
        ..Default::default()
    };

    unsafe {
        ShellExecuteExW(&mut info).map_err(|e| {
            // ERROR_CANCELLED (1223) is returned when the user declines the UAC prompt.
            // ShellExecuteExW surfaces it as an HRESULT, so extract the Win32 code.
            let win32_code = (e.code().0 as u32) & 0xFFFF;
            if win32_code == ERROR_CANCELLED.0 {
                format!("Failed to launch game with elevation: The operation was cancelled by the user")
            } else {
                format!("Failed to launch game with elevation: {}", e)
            }
        })?;
    }

    // hProcess may be null if ShellExecuteEx could not obtain a handle.
    // The game may still have launched, so return None to let the watcher
    // detect it passively instead of failing outright.
    if info.hProcess.is_invalid() || info.hProcess.0.is_null() {
        eprintln!("[launch_elevated] no process handle returned; falling back to passive detection");
        return Ok(None);
    }

    let pid = unsafe { GetProcessId(info.hProcess) };

    // Close the handle we received; the process keeps running.
    unsafe {
        let _ = CloseHandle(info.hProcess);
    }

    if pid == 0 {
        return Ok(None);
    }

    Ok(Some(pid))
}

// === Launcher settings (L2/L3/L5) ============================================
//
// State that needs to be read on the hot path (every launch, every
// window-close event) is held in an Arc<Mutex<â€¦>> managed through
// `tauri::State`. Reads are O(1) and take the std sync lock briefly;
// writes go through the kv_store so the values survive restarts. Each
// setter command keeps the in-memory copy and the on-disk copy in sync.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LauncherSettings {
    /// L2: When the user clicks the close button, hide the window
    /// instead of quitting the app. The user reopens via the OS
    /// tray/dock icon.
    close_to_tray_enabled: bool,
    /// L3: When the user clicks Play, the main window hides itself so
    /// the game gets full-screen focus without a competing Gamelib
    /// window in the taskbar.
    minimize_on_launch_enabled: bool,
    /// L5: When true, the launch path REFUSES to silently retry with
    /// ShellExecuteExW(runas) on ERROR_ELEVATION_REQUIRED. The launch
    /// just fails with a clear error message â€” for users who don't
    /// want surprise UAC prompts mid-session.
    disable_elevation_prompts: bool,
}

impl Default for LauncherSettings {
    fn default() -> Self {
        Self {
            close_to_tray_enabled: false,
            minimize_on_launch_enabled: false,
            disable_elevation_prompts: false,
        }
    }
}

/// Read the persisted launcher settings on startup so the in-memory
/// mirror matches the kv_store. Each missing key falls back to the
/// struct default â€” a fresh install lands in a fully-default state.
fn load_launcher_settings(db: &db::Db) -> LauncherSettings {
    let get = |key: &str| db::kv::get(db, key).ok().flatten();
    LauncherSettings {
        close_to_tray_enabled: get(KV_CLOSE_TO_TRAY)
            .map(|v| v == "true")
            .unwrap_or(false),
        minimize_on_launch_enabled: get(KV_MINIMIZE_ON_LAUNCH)
            .map(|v| v == "true")
            .unwrap_or(false),
        disable_elevation_prompts: get(KV_DISABLE_ELEVATION_PROMPTS)
            .map(|v| v == "true")
            .unwrap_or(false),
    }
}

const KV_CLOSE_TO_TRAY: &str = "launcher.close_to_tray_enabled";
const KV_MINIMIZE_ON_LAUNCH: &str = "launcher.minimize_on_launch_enabled";
const KV_DISABLE_ELEVATION_PROMPTS: &str = "launcher.disable_elevation_prompts";

/// L2: Get the current launcher settings. Read-only IPC; the frontend
/// hydrates its UI forms from this on mount.
#[tauri::command]
fn get_launcher_settings(state: tauri::State<'_, Arc<std::sync::Mutex<LauncherSettings>>>) -> LauncherSettings {
    state.lock().map(|s| s.clone()).unwrap_or_default()
}

/// L2: Toggle close-to-tray at runtime. Updates both the in-memory
/// state (so the CloseRequested handler picks up the new value without
/// needing a restart) and the kv_store (so it survives restarts).
#[tauri::command]
fn set_close_to_tray_enabled(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<std::sync::Mutex<LauncherSettings>>>,
    enabled: bool,
) -> Result<(), String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::kv::set(db_state.inner(), KV_CLOSE_TO_TRAY, if_enabled(enabled))?;
    state.lock().map(|mut s| s.close_to_tray_enabled = enabled).map_err(|e| e.to_string())?;
    Ok(())
}

/// L3: Toggle minimize-on-launch. Affects the next `launch_game`.
#[tauri::command]
fn set_minimize_on_launch_enabled(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<std::sync::Mutex<LauncherSettings>>>,
    enabled: bool,
) -> Result<(), String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::kv::set(db_state.inner(), KV_MINIMIZE_ON_LAUNCH, if_enabled(enabled))?;
    state.lock().map(|mut s| s.minimize_on_launch_enabled = enabled).map_err(|e| e.to_string())?;
    Ok(())
}

/// L5: Toggle whether strictly-forbidding UAC elevation prompts are
/// allowed during launch. When true,ERROR_ELEVATION_REQUIRED is
/// returned as a clear user-facing error rather than a surprise UAC.
#[tauri::command]
fn set_disable_elevation_prompts(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<std::sync::Mutex<LauncherSettings>>>,
    enabled: bool,
) -> Result<(), String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::kv::set(db_state.inner(), KV_DISABLE_ELEVATION_PROMPTS, if_enabled(enabled))?;
    state.lock().map(|mut s| s.disable_elevation_prompts = enabled).map_err(|e| e.to_string())?;
    Ok(())
}

fn if_enabled(b: bool) -> &'static str {
    if b {
        "true"
    } else {
        "false"
    }
}

/// L4: Toggle the OS-level auto-launch on boot. Wraps the
/// tauri-plugin-autostart calls â€” enabling registers the binary,
/// disabling unregisters it. Errors from the OS layer are surfaced
/// verbatim so the UI can show "permission denied" vs "already
/// registered" cleanly.
#[tauri::command]
fn set_autostart_enabled(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|e| format!("autostart enable: {e}"))?;
    } else {
        manager.disable().map_err(|e| format!("autostart disable: {e}"))?;
    }
    Ok(())
}

/// L4: Probe the OS-level autostart registration state. Mirrors the
/// setting the OS reports (not the user's preference) so the toggle
/// can show what's *actually* registered after a system reset that
/// cleared the registry entry.
#[tauri::command]
fn is_autostart_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().map_err(|e| format!("autostart status: {e}"))
}

/// Launch a game executable with unified process tracking.
///
/// Replaces the old split between `launch_game` (local, child.wait()),
/// `spawn_game_exe` (Steam fire-and-forget), and `watch_steam_game`
/// (Steam WMI polling). Now all platforms use the same GameWatcher
/// poll loop for process lifecycle detection.
///
/// **Steam games with known exe path**: spawns the exe directly,
/// registers with the watcher for WMI-based tracking.
///
/// **Steam games without exe path**: opens `steam://run/<appid>` via
/// the opener plugin, registers a pending session that the watcher
/// activates when a matching process appears.
///
/// **Local games**: spawns the exe directly, registers with the watcher.
///
/// **Elevation**: On Windows, if the executable requires administrator
/// privileges (ERROR_ELEVATION_REQUIRED), the launch is retried with a
/// UAC elevation prompt.
///
/// The watcher's background poll loop handles all session lifecycle:
/// process detection â†’ metrics collection â†’ exit detection â†’ game-exited event.
#[tauri::command]
fn launch_game(
    app: tauri::AppHandle,
    game_id: String,
    game_name: String,
    game_path: String,
    platform: String,
    steam_app_id: Option<u32>,
    gpu_id: Option<String>,
    gpu_name: Option<String>,
    launch_arguments: Option<String>,
    run_as_admin: Option<bool>,
) -> Result<String, String> {
    let watcher: tauri::State<'_, Arc<std::sync::Mutex<GameWatcher>>> = app.state();
    let launcher: tauri::State<'_, Arc<std::sync::Mutex<LauncherSettings>>> = app.state();

    let launcher_settings = launcher
        .lock()
        .map(|s| s.clone())
        .unwrap_or_default();

    // Emit the launch event EARLY so any Discord-rich-presence subscriber
    // can flip its status before the game window steals focus. The event
    // name "discord-presence-update" with state="playing" mirrors the
    // shape the eventual Discord IPC plugin will subscribe to; we ship
    // the stub now so the contract is stable.
    if launcher_settings.disable_elevation_prompts
        && run_as_admin.unwrap_or(false)
    {
        return Err(
            "Launch with admin elevation is blocked by Settings â†’ Disable UAC elevation prompts. Enable the setting or unset \"Run as administrator\" on the game to launch."
                .to_string(),
        );
    }

    let _ = app.emit(
        "discord-presence-update",
        serde_json::json!({
            "state": "playing",
            "gameId": game_id,
            "gameName": game_name,
            "startedAt": SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
        }),
    );

    // Update GPU info on the watcher for metrics collection
    {
        let mut w = watcher.lock().map_err(|e| e.to_string())?;
        w.set_gpu(gpu_id.clone(), gpu_name.clone());
    }

    // L3: Hide the main window when minimize-on-launch is on, BEFORE
    // spawning the game process, so the OS doesn't briefly flash both
    // windows during the launch transition. Failure to hide isn't fatal
    // â€” the launch proceeds anyway.
    if launcher_settings.minimize_on_launch_enabled {
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.hide();
        }
    }

    let mut initial_pid: u32 = 0;
    let exe_path: Option<String>;

    // â”€â”€ Determine launch strategy â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if platform == "Steam" && (game_path.is_empty() || !Path::new(&game_path).exists()) {
        // Steam game without local exe â€” use steam:// protocol
        let sid = steam_app_id.ok_or("Steam games require a steamAppId")?;
        let url = format!("steam://run/{}", sid);
        tauri_plugin_opener::open_url(url, None::<&str>)
            .map_err(|e| format!("Failed to open Steam URL: {}", e))?;

        // No PID â€” the watcher will detect the process when it appears
        initial_pid = 0;
        exe_path = None;
    } else if platform == "Ubisoft" && game_path.is_empty() {
        // Ubisoft Connect game without a local exe path -- launch via
        // the `uplay://launch/<id>` protocol. Mirrors Playnite's
        // `UplayPlayController.Play`. The watcher detects the child
        // process when UbisoftConnect.exe hands off to the game.
        let sid = game_id
            .strip_prefix("uplay-")
            .ok_or("Ubisoft games require a uplay-<id> game id")?;
        let url = format!("uplay://launch/{}", sid);
        tauri_plugin_opener::open_url(url, None::<&str>)
            .map_err(|e| format!("Failed to open Ubisoft URL: {}", e))?;
        initial_pid = 0;
        exe_path = None;
    } else {
        // Known exe path: spawn directly
        let path = Path::new(&game_path);
        if !path.exists() {
            return Err(format!("Game executable not found: {}", game_path));
        }
        let cwd = path.parent().unwrap_or_else(|| Path::new("."));

        // Check if we need to force run as admin
        let child = if run_as_admin.unwrap_or(false) {
            #[cfg(windows)]
            {
                initial_pid = launch_elevated(path, cwd, launch_arguments.as_deref())?.unwrap_or(0);
                None
            }
            #[cfg(not(windows))]
            {
                return Err("Running as administrator is only supported on Windows".to_string());
            }
        } else {
            let mut cmd = std::process::Command::new(path);
            cmd.current_dir(cwd);

            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                if let Some(args) = launch_arguments.as_deref() {
                    if !args.trim().is_empty() {
                        cmd.raw_arg(args);
                    }
                }
            }
            #[cfg(not(windows))]
            {
                if let Some(args) = launch_arguments.as_deref() {
                    if !args.trim().is_empty() {
                        cmd.args(args.split_whitespace());
                    }
                }
            }

            let spawn_res = cmd.spawn();
            match spawn_res {
                Ok(child) => Some(child),
                Err(e) => {
                    #[cfg(windows)]
                    {
                        // L5: Respect the user's no-UAC choice on the
                        // implicit retry path too. ERROR_ELEVATION_REQUIRED
                        // is exactly the kind of "surprise UAC mid-session"
                        // that the toggle is meant to suppress.
                        if e.raw_os_error() == Some(ERROR_ELEVATION_REQUIRED) {
                            if launcher_settings.disable_elevation_prompts {
                                return Err(
                                    "Game requires administrator privileges and Settings â†’ Disable UAC elevation prompts is on. Enable the setting or unset \"Run as administrator\" on the game to launch."
                                        .to_string(),
                                );
                            }
                            initial_pid = launch_elevated(path, cwd, launch_arguments.as_deref())?.unwrap_or(0);
                            None
                        } else {
                            return Err(format!("Failed to launch game: {}", e));
                        }
                    }
                    #[cfg(not(windows))]
                    {
                        return Err(format!("Failed to launch game: {}", e));
                    }
                }
            }
        };

        if let Some(child) = child.as_ref() {
            initial_pid = child.id();
        }
        exe_path = Some(game_path.clone());
        // std::process::Child does not kill on drop, so we can safely
        // discard the handle â€” the watcher's WMI poll will track the
        // real process lifecycle.
    }

    // â”€â”€ Register with watcher â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Lock the watcher once here (std::sync::Mutex is not reentrant) so the
    // same guard can both supply the live telemetry config and register the
    // launched session below without a double-lock deadlock.
    let mut w = watcher.lock().map_err(|e| e.to_string())?;

    // Start metrics collection immediately if we have a valid PID.
    // The stop_tx and metrics_rx are stored in the session so the
    // watcher's finish_session can stop collection and read results.
    let (metrics_stop_tx, metrics_rx) = if initial_pid > 0 {
        let (tx, rx) = metrics_collector::start_metrics_collection(
            w.metrics_config().clone(), initial_pid, gpu_id.clone(), gpu_name.clone(),
        );
        (tx, rx)
    } else {
        // No PID yet (Steam protocol launch) — create dummy channels.
        // Sends will fail silently in finish_session — acceptable
        // because metrics were never started for this session.
        let (dummy_stop_tx, _) = std::sync::mpsc::channel::<()>();
        let (_, dummy_metrics_rx) = std::sync::mpsc::channel::<Option<metrics_collector::SessionMetrics>>();
        (dummy_stop_tx, dummy_metrics_rx)
    };

    {
        w.register_launched_session(
            &app,
            &game_id,
            &game_name,
            &platform,
            steam_app_id,
            exe_path.as_deref(),
            initial_pid,
            metrics_stop_tx,
            metrics_rx,
        );
    }

    let msg = if platform == "Steam" && initial_pid == 0 {
        format!("Launched {} via Steam (tracking via process watcher)", game_name)
    } else {
        format!("Launched: {}", game_path)
    };
    Ok(msg)
}

/// Read an image file from disk and return it as a base64 data URL.
#[tauri::command]
fn read_cover_image(file_path: String) -> Result<String, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err("File not found".into());
    }
    let data = std::fs::read(path).map_err(|e| format!("Failed to read file: {}", e))?;
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let b64 = base64_encode(&data);
    Ok(format!("data:{};base64,{}", mime, b64))
}

/// Simple base64 encoding (no external crate needed).
fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(CHARS[((triple >> 18) & 63) as usize] as char);
        out.push(CHARS[((triple >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(CHARS[((triple >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(CHARS[(triple & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

/// Serializable struct holding metadata about a scanned executable.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ExeInfo {
    path: String,
    size: u64,
    modified_at: u64,
}

/// Recursively scan a directory for .exe files and return their paths, sizes, and modified dates.
#[tauri::command]
fn scan_folder_for_exes(folder_path: String) -> Vec<ExeInfo> {
    let mut exes = Vec::new();
    let path = Path::new(&folder_path);
    if path.is_dir() {
        scan_dir(path, &mut exes);
    }
    exes
}

/// Non-game executables to skip during folder scanning.
const SKIP_KEYWORDS: &[&str] = &["redist", "autorun", "helper", "unin", "crash", "setup", "install", "plugin", "manual", "readme", "register", "7za"];

/// Download a single image URL and return it as a base64 data URL.
#[tauri::command]
async fn download_image(url: String) -> Result<Option<String>, String> {
    Ok(game_scraper::download_image_to_base64(&url).await)
}

/// Search for game metadata across multiple online sources.
/// When `skip_launchbox` is true (Steam-synced games), LaunchBox is
/// skipped â€” IGDB and Steam provide better metadata for known titles.
#[tauri::command]
async fn search_game_metadata(game_name: String, skip_launchbox: Option<bool>) -> Vec<GameMetadataResult> {
    game_scraper::search_game_metadata(&game_name, skip_launchbox.unwrap_or(false)).await
}

/// Download images from URLs and return them as base64 data URLs.
#[tauri::command]
async fn fetch_game_images(urls: Vec<String>) -> Vec<Option<String>> {
    game_scraper::fetch_game_images(urls).await
}

/// Use Spider to crawl a URL and extract data using CSS selectors.
#[tauri::command]
async fn spider_extract(url: String, selectors: std::collections::HashMap<String, String>) -> Result<std::collections::HashMap<String, Vec<String>>, String> {
    game_scraper::spider_extract(&url, &selectors).await
}

/// Use Spider to fetch the raw HTML of a single page.
#[tauri::command]
async fn spider_fetch_page(url: String) -> Result<String, String> {
    game_scraper::spider_fetch_page(&url).await
}

/// Search the LaunchBox Games Database for images of a game.
#[tauri::command]
async fn search_launchbox_images(game_name: String) -> Result<Vec<LaunchBoxImageResult>, String> {
    game_scraper::search_launchbox_images(&game_name).await
}

/// Phase-1 wrapper around the store_cache DAO. The frontend used to
/// ship a single JSON blob under `<app_data_dir>/store_cache.json`
/// for the IGDB catalog cache; that data now lives in the
/// `store_cache` + `store_detail` SQLite tables. To preserve the
/// existing Tauri command shape (the React hook invokes
/// `save_store_cache` with a pre-serialized payload), we round-trip
/// the JSON into rows here.
#[tauri::command]
fn save_store_cache(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let parsed: serde_json::Value =
        serde_json::from_str(&data).map_err(|e| format!("parse: {e}"))?;
    // Old shape: `{ "categories": { "<category>": <obj> },
    //   "detailCache": { "<slug>": <obj> } }`.
    if let Some(cats) = parsed.get("categories").and_then(|v| v.as_object()) {
        for (category, payload) in cats {
            let wrapped =
                serde_json::to_string(payload).map_err(|e| format!("wrap category: {e}"))?;
            db::store_cache::upsert_category_page(
                db_state.inner(),
                category,
                0,
                &wrapped,
            )?;
        }
    }
    if let Some(detail) = parsed.get("detailCache").and_then(|v| v.as_object()) {
        for (slug, payload) in detail {
            let wrapped =
                serde_json::to_string(payload).map_err(|e| format!("wrap detail: {e}"))?;
            db::store_cache::upsert_detail(db_state.inner(), slug, &wrapped)?;
        }
    }
    Ok(())
}

/// Read the most recent store cache blob. Combines all known
/// `(category, page=0)` rows plus every `store_detail` row into the
/// same JSON shape the React frontend already understands.
#[tauri::command]
fn load_store_cache(app: tauri::AppHandle) -> Result<String, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let mut out = serde_json::Map::new();
    out.insert(
        "categories".to_string(),
        serde_json::Value::Object(serde_json::Map::new()),
    );
    out.insert(
        "detailCache".to_string(),
        serde_json::Value::Object(serde_json::Map::new()),
    );

    // Categories â€” list every (category, page=0) row. We don't currently
    // paginate beyond 0; if future code adds higher pages this JSON
    // shape will need a `pages` sub-object.
    let conn = db_state.conn().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT category, payload_json FROM store_cache WHERE page = 0")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let cats = out
        .get_mut("categories")
        .and_then(|v| v.as_object_mut())
        .unwrap();
    for row in rows {
        let (cat, payload) = row.map_err(|e| e.to_string())?;
        let value: serde_json::Value =
            serde_json::from_str(&payload).unwrap_or(serde_json::Value::Null);
        cats.insert(cat, value);
    }
    let mut stmt = conn
        .prepare("SELECT slug, payload_json FROM store_detail")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let details = out
        .get_mut("detailCache")
        .and_then(|v| v.as_object_mut())
        .unwrap();
    for row in rows {
        let (slug, payload) = row.map_err(|e| e.to_string())?;
        let value: serde_json::Value =
            serde_json::from_str(&payload).unwrap_or(serde_json::Value::Null);
        details.insert(slug, value);
    }

    serde_json::to_string(&out).map_err(|e| e.to_string())
}

/// Phase-1 wrapper around the wishlist DAO. The frontend sends a
/// serialised `{entries: {<slug>: <entry>}}` blob; we split it into
/// one row per slug.
#[tauri::command]
fn save_wishlist(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let parsed: serde_json::Value = serde_json::from_str(&data)
        .map_err(|e| format!("parse wishlist: {e}"))?;
    let entries = parsed
        .get("entries")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    for (slug, entry) in &entries {
        let payload =
            serde_json::to_string(entry).map_err(|e| format!("serialize entry: {e}"))?;
        let added_at = entry
            .get("addedAt")
            .and_then(|v| v.as_u64())
            .unwrap_or(now_ms);
        db::wishlist::upsert(db_state.inner(), slug, &payload, added_at)?;
    }
    Ok(())
}

/// Read the wishlist back as the same `{entries: {<slug>: <entry>}}`
/// shape the frontend expects.
#[tauri::command]
fn load_wishlist(app: tauri::AppHandle) -> Result<String, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let rows = db::wishlist::list(db_state.inner()).map_err(|e| e.to_string())?;
    let mut entries = serde_json::Map::new();
    for (slug, payload, _added_at) in rows {
        let value: serde_json::Value =
            serde_json::from_str(&payload).unwrap_or(serde_json::Value::Null);
        entries.insert(slug, value);
    }
    Ok(serde_json::json!({ "entries": entries }).to_string())
}

/// Phase-3 sessions: read recent finished sessions for the
/// Activity dashboard. The frontend still maintains its own
/// `localStorage`-backed session list (Phase 5 will switch that
/// over); this is the backend's mirror for stats / future exports.
#[tauri::command]
fn list_recent_sessions(
    app: tauri::AppHandle,
    limit: u32,
) -> Result<Vec<db::sessions::SessionRecord>, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::sessions::list_recent(db_state.inner(), limit)
}

/// Return the most recent finished session for a single game (newest
/// first, limited to 1). Used by the launch splash to show accurate
/// "Last Played" info from the canonical SQLite session history.
#[tauri::command]
fn get_last_session_for_game(
    app: tauri::AppHandle,
    game_id: String,
) -> Result<Vec<db::sessions::SessionRecord>, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let sessions = db::sessions::list_for_game(db_state.inner(), &game_id)?;
    Ok(sessions.into_iter().take(1).collect())
}

/// Fetch a page of store games from IGDB, optionally narrowed by genre /
/// platform / release-year / rating filters. All filter facets are optional
/// and combine onto the IGDB `where` clause with AND semantics inside
/// `fetch_store_games`. An empty `Vec` is treated the same as `None`.
#[tauri::command]
async fn fetch_store_games(
    category: String,
    offset: u32,
    limit: u32,
    genres: Option<Vec<String>>,
    platforms: Option<Vec<String>>,
    year_min: Option<i32>,
    year_max: Option<i32>,
    rating_min: Option<f64>,
    sort: Option<String>,
) -> Result<Vec<StoreGameSummary>, String> {
    game_scraper::fetch_store_games(
        &category,
        offset,
        limit,
        genres,
        platforms,
        year_min,
        year_max,
        rating_min,
        sort,
    )
    .await
}

/// Search IGDB games live by name query.
#[tauri::command]
async fn search_store_games(
    query: String,
    offset: u32,
    limit: u32,
) -> Result<Vec<StoreGameSummary>, String> {
    game_scraper::search_store_games(&query, offset, limit).await
}

/// Fetch full metadata for a single IGDB game by its slug.
#[tauri::command]
async fn get_store_game_detail(slug: String) -> Option<GameMetadataResult> {
    game_scraper::get_store_game_detail(&slug).await
}

/// Fetch every game that belongs to a given IGDB collection, sorted
/// by release date ascending. Used by the frontend Game Relations
/// card to populate the "Other in Collection" group on the Store
/// game detail page. `limit` is clamped to 50 internally (IGDB's
/// per-request max) so callers can pass a higher ceiling without
/// worrying about silent truncation.
#[tauri::command]
async fn get_collection_games(
    collection_id: u64,
    limit: Option<u32>,
) -> Result<Vec<StoreGameSummary>, String> {
    game_scraper::get_collection_games(collection_id, limit.unwrap_or(50)).await
}

/// Fetch reviews for a game from the best available source (Steam first, IGDB fallback).
/// Returns the reviews and a `source` string ("steam" | "igdb" | "none") so the UI
/// can label them correctly.
///
/// New (post-ReviewViewer-parity) optional filter args, all `None` for "no filter":
///   - `filter_type`        â€” "all" (default) | "recent" | "funny"
///   - `purchase_type`      â€” "all" (default) | "steam" | "other"
///   - `playtime_min_hours` â€” minimum author playtime (client-side filter)
///   - `playtime_max_hours` â€” maximum author playtime (client-side filter)
#[tauri::command]
async fn fetch_game_reviews(
    game_name: String,
    steam_app_id: Option<u64>,
    cursor: Option<String>,
    language: Option<String>,
    filter_type: Option<String>,
    purchase_type: Option<String>,
    playtime_min_hours: Option<u32>,
    playtime_max_hours: Option<u32>,
) -> ReviewFetchResult {
    game_scraper::fetch_game_reviews(
        &game_name,
        steam_app_id,
        cursor,
        language,
        filter_type,
        purchase_type,
        playtime_min_hours,
        playtime_max_hours,
    )
    .await
}

/// Fetch reviews from an external source (metacritic, opencritic, or rawg).
/// Uses web scraping with DDG HTML search fallback for URL resolution.
#[tauri::command]
async fn fetch_external_reviews(
    game_name: String,
    source: String,
) -> Result<Vec<IgdbReview>, String> {
    game_scraper::fetch_external_reviews(&game_name, &source).await
}

/// Fetch the rich "About" payload for a game. Prefers Steam's
/// `about_the_game` (HTML with embedded GIFs/images) + `movies[]`
/// (Steam CDN .webm/.mp4 trailers); falls back to IGDB's
/// `summary` / `storyline` when Steam is unavailable (no appid,
/// transient Steam failure, or empty Steam response).
///
/// Returns `None` when both sources come back empty, so the
/// frontend can hide the section entirely. The payload is
/// cached in-process for 6h per Steam appid — a Steam store page
/// edit cycle is well under that window.
#[tauri::command]
async fn get_about_section(
    steam_app_id: Option<u32>,
    game_name: Option<String>,
) -> Option<RichAboutPayload> {
    game_scraper::fetch_rich_about(steam_app_id, game_name.as_deref()).await
}

/// Fetch Steam's `pc_requirements` (minimum + recommended) for a
/// game. The backend hits Steam's `appdetails` endpoint, parses
/// the variable HTML into a structured `RequirementsSpec` per
/// tier, and caches the parsed result for 24h per appid. Returns
/// `None` when the game has no Steam appid (the frontend hides
/// the section entirely in that case); returns
/// `Some(PcRequirementsPayload { source: "steam", minimum: None,
/// recommended: None })` when Steam is reachable but hasn't
/// published requirements for the title — the frontend renders a
/// friendly empty state in that branch.
#[tauri::command]
async fn get_recommended_config(steam_app_id: Option<u32>) -> Option<PcRequirementsPayload> {
    game_scraper::fetch_system_requirements(steam_app_id).await
}

/// Recursively scan a folder for image files (jpg, jpeg, png, gif, bmp, webp)
/// and return their paths. Used by the Community â†’ Screenshots tab to let
/// users browse their screenshot folders.
#[tauri::command]
fn list_image_files(folder_path: String) -> Vec<String> {
    let mut paths = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&folder_path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                paths.extend(list_image_files(p.to_string_lossy().to_string()));
            } else if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                let lower = ext.to_lowercase();
                if lower == "jpg" || lower == "jpeg" || lower == "png" || lower == "gif" || lower == "bmp" || lower == "webp" {
                    paths.push(p.to_string_lossy().to_string());
                }
            }
        }
    }
    paths.sort();
    paths
}

/// Like `list_image_files` but also returns common video clip formats
/// (.mp4, .webm, .mov, .mkv) so the Community → Screenshots tab can show
/// gameplay recordings alongside still captures. Recurses into subfolders.
#[tauri::command]
fn list_media_files(folder_path: String) -> Vec<String> {
    fn list_media_files_flat(dir: &std::path::Path) -> Vec<String> {
        let mut paths = Vec::new();
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    paths.extend(list_media_files_flat(&p));
                } else if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                    let lower = ext.to_lowercase();
                    if matches!(
                        lower.as_str(),
                        "jpg" | "jpeg" | "png" | "gif" | "bmp" | "webp"
                            | "mp4" | "webm" | "mov" | "mkv"
                    ) {
                        paths.push(p.to_string_lossy().to_string());
                    }
                }
            }
        }
        paths
    }
    let mut paths = list_media_files_flat(std::path::Path::new(&folder_path));
    paths.sort();
    paths
}

/// Serializable result for auto-detecting Steam screenshot folders.
/// Maps to the frontend's per-game screenshot grouping UI on the
/// Community â†’ Screenshots tab.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SteamScreenshotFolder {
    /// Steam AppID that owns these screenshots.
    app_id: u32,
    /// Display name resolved from the user's library, or a fallback
    /// like "Unknown Game (730)" when no library entry has this appid.
    game_name: String,
    /// The absolute filesystem path to the screenshots folder.
    folder_path: String,
    /// Sorted list of absolute paths to image files in this folder.
    screenshots: Vec<String>,
}

/// Auto-detect Steam screenshot folders by scanning ALL userdata
/// directories under `<steam_root>\userdata\*\760\remote\<appId>\screenshots`.
///
/// No Steam login required â€” this scans the filesystem directly,
/// finding screenshots from every Steam account that has ever signed
/// in on this machine. Duplicate appIds (same game played by multiple
/// accounts) are deduplicated: the first account's folder wins.
///
/// The frontend cross-references each discovered appid against the
/// user's library for game names, cover art, and platform badges.
/// Returns an empty Vec when Steam isn't installed or no screenshot
/// folders exist yet.
#[tauri::command]
fn detect_steam_screenshot_folders() -> Vec<SteamScreenshotFolder> {
    let steam_root = match steam_game_watcher::find_steam_install_dir() {
        Some(r) => r,
        None => return Vec::new(),
    };

    let userdata_root = steam_root.join("userdata");
    if !userdata_root.exists() || !userdata_root.is_dir() {
        return Vec::new();
    }

    let mut results: Vec<SteamScreenshotFolder> = Vec::new();

    // Walk every <userdata>/<steamId>/760/remote/ for screenshot folders.
    if let Ok(user_entries) = std::fs::read_dir(&userdata_root) {
        for user_entry in user_entries.flatten() {
            let user_dir = user_entry.path();
            if !user_dir.is_dir() {
                continue;
            }

            let remote_root = user_dir.join("760").join("remote");
            if !remote_root.exists() || !remote_root.is_dir() {
                continue;
            }

            if let Ok(app_entries) = std::fs::read_dir(&remote_root) {
                for app_entry in app_entries.flatten() {
                    let p = app_entry.path();
                    if !p.is_dir() {
                        continue;
                    }

                    let dir_name = match p.file_name().and_then(|n| n.to_str()) {
                        Some(n) => n.to_string(),
                        None => continue,
                    };

                    let app_id: u32 = match dir_name.parse() {
                        Ok(id) => id,
                        Err(_) => continue,
                    };

                    // Deduplicate: same game played by multiple accounts.
                    if results.iter().any(|r| r.app_id == app_id) {
                        continue;
                    }

                    let screenshots_dir = p.join("screenshots");
                    if !screenshots_dir.exists() || !screenshots_dir.is_dir() {
                        let loose: Vec<String> = list_image_files_flat(&p);
                        if loose.is_empty() {
                            continue;
                        }
                        results.push(SteamScreenshotFolder {
                            app_id,
                            game_name: format!("Unknown Game ({})", app_id),
                            folder_path: p.to_string_lossy().to_string(),
                            screenshots: loose,
                        });
                        continue;
                    }

                    let images: Vec<String> = list_image_files_flat(&screenshots_dir);
                    if images.is_empty() {
                        continue;
                    }

                    results.push(SteamScreenshotFolder {
                        app_id,
                        game_name: format!("Unknown Game ({})", app_id),
                        folder_path: screenshots_dir.to_string_lossy().to_string(),
                        screenshots: images,
                    });
                }
            }
        }
    }

    results.sort_by_key(|r| r.app_id);
    results
}


/// Non-recursive image-file lister for a single directory.
fn list_image_files_flat(dir: &std::path::Path) -> Vec<String> {
    let mut paths = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                    let lower = ext.to_lowercase();
                    if lower == "jpg" || lower == "jpeg" || lower == "png" || lower == "gif" || lower == "bmp" || lower == "webp" {
                        paths.push(p.to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    // Sort by modified time, newest first (better for screenshot browsing)
    paths.sort_by(|a, b| {
        let ma = std::fs::metadata(a).ok().and_then(|m| m.modified().ok());
        let mb = std::fs::metadata(b).ok().and_then(|m| m.modified().ok());
        mb.cmp(&ma)
    });
    paths
}

/// Save screenshot image base64 data to the specified path.
#[tauri::command]
fn save_screenshot(file_path: String, base64_data: String) -> Result<(), String> {
     use base64::{Engine as _, engine::general_purpose};

     let clean_data = if base64_data.contains(",") {
         base64_data.split(',').nth(1).unwrap_or(&base64_data)
     } else {
         &base64_data
     };

     let bytes = general_purpose::STANDARD
         .decode(clean_data)
         .map_err(|e| format!("Failed to decode base64: {}", e))?;

     std::fs::write(&file_path, bytes)
         .map_err(|e| format!("Failed to write file: {}", e))?;

     Ok(())
}

/// Write an arbitrary text payload (CSV / JSON export) to the specified
/// path. Kept separate from `save_screenshot` because that command only
/// accepts base64 image payloads; exports are plain UTF-8 text.
#[tauri::command]
fn save_text_file(file_path: String, contents: String) -> Result<(), String> {
     std::fs::write(&file_path, contents)
         .map_err(|e| format!("Failed to write file: {}", e))
}

/// Migration helper: read the legacy `<app_data_dir>/sessions.json`
/// blob (the pre-SQLite session store). Returns "[]" when the file does
/// not exist. The frontend imports any rows found here into the
/// `sessions` table on first launch after the migration, then stops
/// touching the file.
#[tauri::command]
fn load_sessions(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = dir.join("sessions.json");
    if !path.exists() {
        return Ok("[]".to_string());
    }
    std::fs::read_to_string(&path).map_err(|e| format!("load_sessions: {e}"))
}

/// Return every finished session from the SQLite `sessions` table
/// (newest first). This is the canonical session history the Activity
/// dashboard reads — no JSON file, crash-safe, append-only.
#[tauri::command]
fn get_sessions(app: tauri::AppHandle) -> Result<Vec<db::sessions::SessionRecord>, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::sessions::list_all(db_state.inner())
}

/// Delete a single session row by id (Activity dashboard "remove").
#[tauri::command]
fn delete_session(app: tauri::AppHandle, id: i64) -> Result<u64, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::sessions::delete(db_state.inner(), id)
}

/// Insert one session row. Used by the one-time migration that imports
/// the legacy `sessions.json` history into SQLite; not called during
/// normal play (the watcher's `finish_session` is the live writer).
#[tauri::command]
fn insert_session(
    app: tauri::AppHandle,
    game_id: String,
    game_name: String,
    started_at_ms: u64,
    elapsed_seconds: u64,
    avg_fps: Option<f32>,
    avg_cpu: Option<f32>,
    avg_gpu: Option<f32>,
    avg_ram: Option<f32>,
    metrics_json: Option<String>,
) -> Result<i64, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let ended_at_ms = started_at_ms.saturating_add(elapsed_seconds.saturating_mul(1000));
    db::sessions::insert(
        db_state.inner(),
        &game_id,
        &game_name,
        started_at_ms,
        ended_at_ms,
        elapsed_seconds,
        avg_fps,
        avg_cpu,
        avg_gpu,
        avg_ram,
        metrics_json.as_deref(),
    )
}

fn scan_dir(dir: &Path, exes: &mut Vec<ExeInfo>) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            if entry_path.is_dir() {
                if let Some(name) = entry_path.file_name().and_then(|n| n.to_str()) {
                    if name.starts_with('.') || name.starts_with('_') {
                        continue;
                    }
                }
                scan_dir(&entry_path, exes);
            } else if let Some(ext) = entry_path.extension().and_then(|e| e.to_str()) {
                if ext.eq_ignore_ascii_case("exe") {
                    if let Some(stem) = entry_path.file_stem().and_then(|s| s.to_str()) {
                        if SKIP_KEYWORDS.iter().any(|kw| stem.to_lowercase().contains(kw)) {
                            continue;
                        }
                    }
                    if let Ok(meta) = entry.metadata() {
                        let size = meta.len();
                        let modified_at = meta.modified()
                            .ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs())
                            .unwrap_or(0);
                        exes.push(ExeInfo {
                            path: entry_path.to_string_lossy().to_string(),
                            size,
                            modified_at,
                        });
                    }
                }
            }
        }
    }
}

/// Get total system RAM in GB.
#[tauri::command]
fn get_system_ram_gb() -> u32 {
    metrics_collector::get_system_ram_gb()
}

/// Summary of the host system's hardware, used by the Settings → Hardware
/// tab's "System summary" card. Returns the CPU model name, total RAM (GB),
/// and the full list of detected GPUs (not just the one chosen for monitoring).
#[tauri::command]
fn get_system_info() -> SystemInfo {
    SystemInfo {
        cpu_name: metrics_collector::get_cpu_name(),
        ram_gb: metrics_collector::get_system_ram_gb(),
        gpus: gpu_detector::detect_gpus(),
    }
}

/// Persist the user's telemetry configuration (master toggle, sampling
/// interval, per-metric capture flags) so the game watcher applies it to
/// the next collection thread.
#[tauri::command]
fn set_metrics_config(
    state: tauri::State<Arc<std::sync::Mutex<GameWatcher>>>,
    config: metrics_collector::MetricsConfig,
) -> Result<(), String> {
    let mut w = state.lock().map_err(|e| e.to_string())?;
    w.set_metrics_config(config);
    Ok(())
}

/// Read the current telemetry configuration (seeds the Settings UI on load).
#[tauri::command]
fn get_metrics_config(
    state: tauri::State<Arc<std::sync::Mutex<GameWatcher>>>,
) -> metrics_collector::MetricsConfig {
    state
        .lock()
        .map(|w| w.metrics_config())
        .unwrap_or_default()
}

/// Debug command: dump all MSI Afterburner shared memory entries for diagnostics.
#[tauri::command]
fn debug_mahm_entries() -> Vec<(String, String, f32)> {
    mahm_reader::dump_mahm_entries().unwrap_or_default()
}

// === Steam Player Count ======================================================
//
// In-memory cache for live concurrent-player counts. Multiple banners
// (Store hero, Store detail, Library detail) may all want the same appid
// in the same render frame; without a cache, each would round-trip to
// Steam's API and we'd burn through Valve's voluntary rate limit.
//
// We deliberately cache per-appid rather than globally:
//  - Different games have wildly different popularity, so a short global
//    TTL would either over-fetch for niche titles or under-fetch for
//    popular ones.
//  - A badge on a single rendered page is a single user looking at a
//    single game, so a 60s per-appid cooldown is plenty.
//
// `CacheEntry` stores `(instant_frozen, count)`. `Instant::elapsed()`
// returns zero on platforms where the system clock jumps backwards
// (rare, but it can cause `elapsed >= TTL` to spuriously fail), so
// reads use saturating semantics.
struct PlayerCountCache {
    cache: std::sync::Mutex<HashMap<u32, (u32, Instant)>>,
}

impl Default for PlayerCountCache {
    fn default() -> Self {
        Self {
            cache: std::sync::Mutex::new(HashMap::new()),
        }
    }
}

const PLAYER_COUNT_CACHE_TTL: Duration = Duration::from_secs(60);

/// Fetch the number of players currently in-game on Steam for `app_id`.
///
/// Source: Steam Web API `ISteamUserStats/GetNumberOfCurrentPlayers/v1/`.
/// Verified reliable & free â€” no API key required for this endpoint.
///
/// Returns:
///   - `Ok(Some(count))` on success
///   - `Ok(None)` when the API responded but reported no current players
///     (e.g. extremely niche titles with a `result != 1`, which the
///     Steam API uses to signal "no data") â€” we map that to a clean
///     "no players right now" so the badge hides silently rather than
///   - `Err` on transport / parse failures (e.g. offline, timeout)
///     surfacing an error.
#[tauri::command]
async fn get_steam_player_count(
    app: tauri::AppHandle,
    app_id: u32,
) -> Result<Option<u32>, String> {
    let state: tauri::State<'_, PlayerCountCache> = app.state();

    // â”€â”€ 1. Return cached value if still fresh â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {
        let cache = state.cache.lock().map_err(|e| e.to_string())?;
        if let Some((count, fetched_at)) = cache.get(&app_id) {
            // `Instant::elapsed` is monotonic, so a backward clock jump
            // won't make this negative; the `>=` check is safe on all
            // platforms Rust supports.
            if fetched_at.elapsed() < PLAYER_COUNT_CACHE_TTL {
                return Ok(Some(*count));
            }
        }
    }

    // â”€â”€ 2. Hit the Steam Web API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Endpoint: ISteamUserStats/GetNumberOfCurrentPlayers/v1/
    // Format:
    //   { "response": { "player_count": <int>, "result": <int> } }
    //
    // `result == 1` â‡’ success
    // `result == 8` â‡’ Steam is returning "no data" for this appid (very
    //   rare; usually means an appid Steam never tracked). We map that
    //   to `Ok(None)` so the badge cleanly hides.
    let url = format!(
        "https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid={}",
        app_id
    );

    let client = shared_steam_client();

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Steam player count request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Steam Web API returned HTTP {} for appid {}",
            resp.status(),
            app_id
        ));
    }

    #[derive(Deserialize)]
    struct SteamResponseInner {
        #[serde(default)]
        player_count: Option<u32>,
        #[serde(default)]
        result: u32,
    }
    #[derive(Deserialize)]
    struct SteamResponse {
        response: SteamResponseInner,
    }

    let payload: SteamResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Steam player count JSON: {}", e))?;

    // Cache + return â€” even on `result != 1` we want to avoid hitting
    // the API again within the TTL window, so we store `None` to mean
    // "not currently tracked" (the frontend hides the badge either way).
    let result_ok = payload.response.result == 1;
    let player_count = payload.response.player_count;

    {
        let mut cache = state.cache.lock().map_err(|e| e.to_string())?;
        // Only cache positive results so a transient Steam hiccup
        // doesn't poison the TTL with a zero count.
        if let Some(count) = player_count {
            if result_ok {
                cache.insert(app_id, (count, Instant::now()));
            }
        }
    }

    // Record the fresh fetch to the history ring buffer. Only valid
    // (`result == 1`, `count > 0`) readings are recorded: a
    // "no players right now" response (count = 0) would just clutter
    // the chart with a flat zero line on every poll, and a "Steam
    // doesn't track this appid" response is a permanent state we
    // don't want to re-record forever.
    //
    // The history cache is a separate `tauri::State` from the live
    // count cache (split to avoid lock contention: the activity-tab
    // sparkline polls every 60s even when the badge isn't visible,
    // so the history read path is hotter than the live cache). Two
    // independent `app.state()` calls return independent references
    // â€” both shared (immutable) borrows of the AppHandle, so the
    // borrow checker is happy.
    if result_ok {
        if let Some(count) = player_count {
            if count > 0 {
                let history: tauri::State<'_, PlayerCountHistoryCache> = app.state();
                record_player_count_sample(&history, app_id, count);
            }
        }
    }

    if result_ok {
        Ok(player_count)
    } else {
        Ok(None)
    }
}

/// Look up the Steam app id for a game by name (best-effort).
///
/// Drives the `useSteamAppId` frontend hook, which auto-resolves the
/// Steam appid for non-Steam library rows (manual imports, Epic, GOG)
/// so the live concurrent-player badge works on the Game page hero
/// AND the activity dashboard / sessions lists, not just Steam-
/// synced titles. Same token-match rule as `fetch_game_reviews`:
/// every whitespace-separated word in `game_name` must appear in the
/// Steam candidate's display name. So "Halo" matches "Halo Infinite"
/// but "The Witcher" doesn't silently grab "The Witcher 3".
///
/// **Confidence gate** for the persistence boundary. The underlying
/// per-token rule is loose for SINGLE-token short queries like
/// "Halo", "Steam", or "CSGO" â€” many Steam candidates contain the
/// word, and we'd risk persisting "Halo Infinite" (1240440) onto a
/// manual "Halo: Reach" library row, locking in a WRONG appid
/// forever (the live player-count badge would then forever display
/// the count for the wrong game). To avoid that we refuse to even
/// run the lookup for queries that are too short to be unambiguous:
///
///   - trimmed length < 3 chars   â†’  return `None`
///   - 1 token AND length < 6     â†’  return `None`
///   - 2+ tokens                  â†’  proceed to the token-match lookup
///
/// This gate lives at the Tauri boundary (not in
/// `game_scraper::lookup_steam_app_id` itself) because that function
/// is ALSO called by `fetch_game_reviews`, where a permissive match
/// is the right behavior â€” Steam reviews are a much better signal
/// than "we guessed wrong on the appid". The player-count path gets
/// the stricter gate because the cost of being wrong is much higher
/// (a permanently persisted wrong appid on the user's library row).
/// Empty queries return None without burning a Steam call.
#[tauri::command]
async fn lookup_steam_app_id_for_game(game_name: String) -> Result<Option<u32>, String> {
    let trimmed = game_name.trim();
    if trimmed.is_empty() || trimmed.len() < 3 {
        return Ok(None);
    }
    let token_count = trimmed.split_whitespace().count();
    if token_count < 2 && trimmed.len() < 6 {
        return Ok(None);
    }
    Ok(
        game_scraper::lookup_steam_app_id(&game_name)
            .await
            .map(|v| v as u32),
    )
}

// === Player Count History (ring buffer for activity-tab sparkline) =========
//
// Per-appid ring buffer of successful player-count fetches. Powers the
// activity-tab sparkline showing the last 24h of concurrent players.
//
// Each successful `get_steam_player_count` (post-cache-miss fetch) records
// a sample. Dedupe is by 5s: if the latest entry is within 5s of now, we
// OVERWRITE its count rather than appending. This handles the multi-banner
// case where the Store hero, Store detail, and Library detail all fire
// `get_steam_player_count` within milliseconds of each other â€” without
// dedupe, three identical samples would land in the buffer per poll.
//
// Cap: 1440 entries/appid (24h Ãâ€” 60s polling). Eviction is FIFO via
// VecDeque::push_back + pop_front when the cap is hit. We deliberately
// trust the cap and don't run a separate age-based eviction pass: if the
// user has been away long enough that 1440 entries have rotated through,
// the oldest are stale and dropping them silently is the right behavior.
//
// All in-memory. No disk persistence â€” the history is ephemeral by
// design (a fresh install starts a new history; the OS restart is the
// cleanest reset point for a UI like this).
//
// Storage: `VecDeque<(SystemTime, u32)>`. `SystemTime` gives us the
// wall-clock timestamp directly, which the frontend renders against
// the user's clock. We don't use `Instant` here because the response
// to the frontend wants wall-clock time (ms-since-epoch) and `Instant`
// has no defined epoch.

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct PlayerCountPoint {
    /// Unix-millisecond timestamp of the sample. Sourced from
    /// `SystemTime::UNIX_EPOCH + duration` so the value is directly
    /// renderable in the frontend without conversion.
    timestamp: u64,
    count: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct PlayerCountHistory {
    app_id: u32,
    /// Time-series points within the requested window, oldest first.
    /// Backend filters to `max_age_ms` before returning so the
    /// frontend never has to do its own age check.
    points: Vec<PlayerCountPoint>,
    /// Most recent reading, or `None` if the buffer is empty.
    current: Option<u32>,
    /// Maximum count observed within the window, or `None` if empty.
    peak: Option<u32>,
    /// Arithmetic mean of the window, or `None` if empty.
    average: Option<f64>,
    /// Number of points in the returned window. Lets the frontend
    /// distinguish "no data ever" from "very few samples" without
    /// re-counting the array.
    sample_count: u32,
    /// Wall-clock start of the returned window (ms). 0 when empty.
    window_start_ms: u64,
    /// Wall-clock end of the returned window (ms). 0 when empty.
    window_end_ms: u64,
}

struct PlayerCountHistoryCache {
    /// appid -> ring buffer of (timestamp, count) samples.
    /// Bounded at `PLAYER_COUNT_HISTORY_CAP` per appid via FIFO eviction
    /// inside `record_player_count_sample`. The map itself is
    /// unbounded in `len()` but bounded by how many distinct Steam
    /// appids the user actually opens (single-digit hundreds at worst).
    buffers: std::sync::Mutex<HashMap<u32, VecDeque<(SystemTime, u32)>>>,
}

impl Default for PlayerCountHistoryCache {
    fn default() -> Self {
        Self {
            buffers: std::sync::Mutex::new(HashMap::new()),
        }
    }
}

const PLAYER_COUNT_HISTORY_CAP: usize = 1_440; // 24h Ãâ€” 60s polling
const PLAYER_COUNT_HISTORY_DEDUPE_MS: u64 = 5_000;

/// Append (or overwrite) one sample to a per-appid ring buffer.
///
/// Fire-and-forget: the caller never sees the result. We swallow
/// mutex-poisoning errors so a poisoned lock can't crash the badge
/// fetch path â€” a missed sample is harmless (the next 60s tick will
/// record a fresh one).
///
/// Dedupe rule: if the latest existing entry is within
/// `PLAYER_COUNT_HISTORY_DEDUPE_MS` of `now`, we OVERWRITE that entry's
/// count in place (pop_back + push_back) rather than appending. This
/// collapses the multi-banner case (3 banners firing within
/// milliseconds) to a single sample, keeping the chart's x-axis
/// resolution at ~1 sample per polling tick rather than 3Ãâ€” that.
fn record_player_count_sample(
    cache: &PlayerCountHistoryCache,
    app_id: u32,
    count: u32,
) {
    let now = SystemTime::now();
    let mut buffers = match cache.buffers.lock() {
        Ok(b) => b,
        Err(_) => return, // poisoned; the next tick will recover
    };
    let buffer = buffers
        .entry(app_id)
        .or_insert_with(|| VecDeque::with_capacity(PLAYER_COUNT_HISTORY_CAP));

    // Dedupe check: if the last sample landed within the dedupe window,
    // replace it rather than appending. Crucial for the multi-banner
    // case where the Store hero, Store detail, and Library detail all
    // share a single 60s polling tick.
    if let Some((last_t, _last_count)) = buffer.back() {
        if let Ok(elapsed) = now.duration_since(*last_t) {
            if (elapsed.as_millis() as u64) <= PLAYER_COUNT_HISTORY_DEDUPE_MS {
                buffer.pop_back();
                buffer.push_back((now, count));
                return;
            }
        }
    }

    // Cap-based eviction: when the buffer is at its limit, drop the
    // oldest entry to make room. Trusting the cap means we don't need
    // a separate age-based eviction pass â€” a steady 60s polling rate
    // keeps the buffer at exactly 1440 entries, and any gap in polling
    // (user away, network down) just means the oldest entry is older
    // than 24h, which the frontend can't render anyway.
    if buffer.len() >= PLAYER_COUNT_HISTORY_CAP {
        buffer.pop_front();
    }
    buffer.push_back((now, count));
}

/// Read the per-appid history ring buffer and return a windowed slice
/// plus server-computed aggregates.
///
/// `max_age_ms` defaults to 24h. The backend filters points to the
/// window and computes `current` / `peak` / `average` so the frontend
/// can render a complete summary card in one IPC round-trip. The
/// points array is always oldest-first so the sparkline renders in
/// chronological order without re-sorting.
#[tauri::command]
async fn get_player_count_history(
    app: tauri::AppHandle,
    app_id: u32,
    max_age_ms: Option<u64>,
) -> Result<PlayerCountHistory, String> {
    // Default 24h. We accept any positive value; the cap is the
    // ring buffer itself (1440 entries â‰ˆ 24h at 60s polling), so
    // asking for more than that is harmless â€” we'll just return
    // everything we have.
    let max_age = Duration::from_millis(max_age_ms.unwrap_or(24 * 60 * 60 * 1_000));
    let cache: tauri::State<'_, PlayerCountHistoryCache> = app.state();

    let buffers = cache.buffers.lock().map_err(|e| e.to_string())?;
    let buffer = match buffers.get(&app_id) {
        Some(b) if !b.is_empty() => b,
        _ => {
            return Ok(PlayerCountHistory {
                app_id,
                points: Vec::new(),
                current: None,
                peak: None,
                average: None,
                sample_count: 0,
                window_start_ms: 0,
                window_end_ms: 0,
            });
        }
    };

    let now = SystemTime::now();
    // `checked_sub` returns `None` if `max_age` would push us before
    // the UNIX_EPOCH (i.e. the caller asked for an absurdly large
    // window). Fall back to EPOCH so we return everything rather than
    // failing the command.
    let cutoff = now
        .checked_sub(max_age)
        .unwrap_or(SystemTime::UNIX_EPOCH);

    // Single pass over the (already-evicted) buffer: filter to the
    // window, convert SystemTime -> unix-ms, and accumulate peak/total
    // for the average. Done in one loop so we don't pay three O(N)
    // passes.
    let mut points: Vec<PlayerCountPoint> = Vec::new();
    let mut peak: u32 = 0;
    let mut total: u64 = 0;
    for (t, count) in buffer.iter() {
        if *t < cutoff {
            continue;
        }
        // `duration_since(UNIX_EPOCH)` is non-negative by definition
        // for `SystemTime` values that came from our own `now()` calls,
        // so this `unwrap_or(0)` only fires on the (impossible) case
        // where a sample was timestamped before 1970.
        let ms = t
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        points.push(PlayerCountPoint {
            timestamp: ms,
            count: *count,
        });
        if *count > peak {
            peak = *count;
        }
        total += *count as u64;
    }

    let sample_count = points.len() as u32;
    if sample_count == 0 {
        return Ok(PlayerCountHistory {
            app_id,
            points: Vec::new(),
            current: None,
            peak: None,
            average: None,
            sample_count: 0,
            window_start_ms: 0,
            window_end_ms: 0,
        });
    }

    let first = points.first().unwrap();
    let last = points.last().unwrap();
    Ok(PlayerCountHistory {
        app_id,
        sample_count,
        peak: Some(peak),
        average: Some(total as f64 / sample_count as f64),
        current: Some(last.count),
        window_start_ms: first.timestamp,
        window_end_ms: last.timestamp,
        points,
    })
}

// === Steam Game Stats (popover payload) =====================================
//
// The player-count popover (click the badge to expand) needs a small bundle
// of related stats: developer, publisher, release date, price, and recent
// review breakdown. We expose all of them as a single Tauri command so the
// frontend pays one IPC round-trip per open and we can fan out the two HTTP
// fetches (`appdetails` + `appreviews`) in parallel from Rust.
//
// Caching strategy
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Each section has its own TTL keyed by appid. Static-looking fields
// (dev / publisher / release date / genres) almost never change, so we
// cache appdetails for 24h. Reviews change slowly, so 1h. Errors get a
// short negative cache (5 min) to stop a flapping endpoint from
// hammering Steam while a transient issue resolves itself.
//
// All caches are `std::sync::Mutex<HashMap<â€¦>>` â€” the critical sections
// are short (HashMap reads/writes + cloning a small payload) and never
// held across an `.await`, so we don't need the async-aware mutex.

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct SteamGameDetails {
    name: String,
    developer: Option<String>,
    publisher: Option<String>,
    release_date: Option<String>,
    is_free: bool,
    price_cents: Option<u32>,
    currency: Option<String>,
    genres: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct SteamGameReviews {
    total_positive: u32,
    total_negative: u32,
    total_reviews: u32,
    score: Option<u8>,
    score_desc: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct SteamGameStats {
    app_id: u32,
    details: Option<SteamGameDetails>,
    reviews: Option<SteamGameReviews>,
    /// Per-section error message so the frontend can render a clean
    /// "â€”" in place of the failed field rather than blanking the whole
    /// popover. The field is `None` on success or when the request
    /// returned `success: false` (which we treat as "no data", not as
    /// an error worth surfacing).
    details_error: Option<String>,
    reviews_error: Option<String>,
}

struct SteamGameStatsCache {
    details: std::sync::Mutex<HashMap<u32, (Option<SteamGameDetails>, Instant)>>,
    reviews: std::sync::Mutex<HashMap<u32, (Option<SteamGameReviews>, Instant)>>,
    details_neg: std::sync::Mutex<HashMap<u32, Instant>>,
    reviews_neg: std::sync::Mutex<HashMap<u32, Instant>>,
}

impl Default for SteamGameStatsCache {
    fn default() -> Self {
        Self {
            details: std::sync::Mutex::new(HashMap::new()),
            reviews: std::sync::Mutex::new(HashMap::new()),
            details_neg: std::sync::Mutex::new(HashMap::new()),
            reviews_neg: std::sync::Mutex::new(HashMap::new()),
        }
    }
}

const STEAM_DETAILS_TTL: Duration = Duration::from_secs(86_400); // 24h
const STEAM_REVIEWS_TTL: Duration = Duration::from_secs(3_600); //  1h
const STEAM_NEG_TTL: Duration = Duration::from_secs(300); //  5 min

/// Shared HTTP client for every Steam API call (`get_steam_player_count`,
/// the appdetails/reviews stats helpers, and any future endpoint).
///
/// Building a `reqwest::Client` is expensive â€” TLS config + connection
/// pool init runs every time and adds 50â€“200ms cold. The pre-existing
/// `get_steam_player_count` and the new stats helpers were each
/// rebuilding a fresh client per call (and `get_steam_game_stats` did
/// it twice via `tokio::join!`), so a single popover open could
/// rebuild up to 3 clients in a frame. `OnceLock` gives us zero-cost
/// lazy init: the client is built on the first call, then every
/// subsequent caller gets the same pooled client for free.
///
/// `OnceLock::get_or_init` takes a closure that must be infallible
/// on retry; the only realistic failure for `Client::builder().timeout
/// (...).user_agent(...).build()` is "the system is so broken we
/// can't even configure TLS", in which case panicking is correct
/// (the rest of the app can't function either).
fn shared_steam_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .user_agent("GameLib/0.1 (steam-api)")
            .build()
            .expect("steam HTTP client builder is infallible with these options")
    })
}

/// Internal: appdetails fetch + cache + parse. Stays private to this
/// module â€” the public surface is `get_steam_game_stats`, which
/// orchestrates the parallel fetch.
async fn fetch_steam_game_details_impl(
    cache: &SteamGameStatsCache,
    app_id: u32,
) -> Result<Option<SteamGameDetails>, String> {
    // â”€â”€ 1. Positive cache â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {
        let map = cache.details.lock().map_err(|e| e.to_string())?;
        if let Some((payload, fetched_at)) = map.get(&app_id) {
            if fetched_at.elapsed() < STEAM_DETAILS_TTL {
                return Ok(payload.clone());
            }
        }
    }

    // â”€â”€ 2. Negative cache (recent transport error â†’ bail early) â”€â”€â”€â”€â”€
    {
        let neg = cache.details_neg.lock().map_err(|e| e.to_string())?;
        if let Some(ts) = neg.get(&app_id) {
            if ts.elapsed() < STEAM_NEG_TTL {
                return Err("Recent appdetails fetch failed; backed off".to_string());
            }
        }
    }

    // â”€â”€ 3. Fetch from store.steampowered.com/api/appdetails â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Response shape: `{ "<appid>": { "success": bool, "data": {...} } }`.
    // On `success: false` we treat it as "Steam has no data for this
    // appid" and surface a clean error (no negative cache, since
    // success:false for an untracked appid is permanent).
    let url = format!(
        "https://store.steampowered.com/api/appdetails?appids={}&cc=us&l=en",
        app_id
    );
    let client = shared_steam_client();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("appdetails request failed: {}", e))?;

    if !resp.status().is_success() {
        let err = format!("appdetails returned HTTP {}", resp.status());
        let mut neg = cache.details_neg.lock().map_err(|e| e.to_string())?;
        neg.insert(app_id, Instant::now());
        return Err(err);
    }

    // Steam returns the appid as a string key (e.g. "730" not 730).
    // Pull the entry out by its stringified id, since we can't index
    // the HashMap with a numeric key.
    #[derive(Deserialize)]
    struct AppDetailsWrapper {
        success: bool,
        #[serde(default)]
        data: Option<AppDetailsData>,
    }
    #[derive(Deserialize, Default)]
    #[serde(default)]
    struct AppDetailsData {
        name: String,
        developers: Vec<String>,
        publishers: Vec<String>,
        release_date: Option<AppReleaseDate>,
        is_free: bool,
        price_overview: Option<AppPrice>,
        genres: Vec<AppGenre>,
    }
    #[derive(Deserialize)]
    struct AppReleaseDate {
        date: String,
        /// Reserved â€” surfaced as the StoreGameCard "Coming soon" badge.
        /// StoreContext renders the badge from a sibling IGDB payload
        /// today, so no Rust call site reads this yet.
        #[serde(default)]
        #[allow(dead_code)]
        coming_soon: bool,
    }
    #[derive(Deserialize)]
    struct AppPrice {
        currency: String,
        /// `final` is a Rust reserved keyword; rename it on the way in.
        #[serde(default, rename = "final")]
        final_cents: u32,
    }
    #[derive(Deserialize)]
    struct AppGenre {
        description: String,
    }

    let mut map: HashMap<String, AppDetailsWrapper> = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse appdetails JSON: {}", e))?;

    let wrapper = map
        .remove(&app_id.to_string())
        .ok_or_else(|| format!("appdetails missing key for appid {}", app_id))?;

    if !wrapper.success {
        // `success: false` means Steam has no store page for this
        // appid (unlisted tools, demos, soundtracks, removed games,
        // unreleased test apps). This is a legitimate "no metadata"
        // answer, not a transport failure â€” surface it as `Ok(None)`
        // so the popover renders the empty-state message instead of
        // flagging the title as broken. We also do NOT write a
        // negative-cache entry, since the answer is permanent for
        // this appid.
        return Ok(None);
    }

    let data = wrapper.data.ok_or_else(|| {
        // success=true but no data block â€” treat as no data.
        "appdetails returned no data block".to_string()
    })?;

    // Skip "coming soon" entries with no fixed date so the popover
    // doesn't display an empty `Release date: ""` row.
    let release_date = data
        .release_date
        .as_ref()
        .filter(|r| !r.date.trim().is_empty())
        .map(|r| r.date.clone());

    let price_cents = data
        .price_overview
        .as_ref()
        .map(|p| p.final_cents)
        .filter(|c| *c > 0);
    let currency = data
        .price_overview
        .as_ref()
        .map(|p| p.currency.clone());

    let details = SteamGameDetails {
        name: data.name,
        developer: data.developers.into_iter().next(),
        publisher: data.publishers.into_iter().next(),
        release_date,
        is_free: data.is_free,
        price_cents,
        currency,
        genres: data.genres.into_iter().map(|g| g.description).collect(),
    };

    // â”€â”€ 4. Cache positive â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {
        let mut map = cache.details.lock().map_err(|e| e.to_string())?;
        map.insert(app_id, (Some(details.clone()), Instant::now()));
    }

    Ok(Some(details))
}

async fn fetch_steam_game_reviews_impl(
    cache: &SteamGameStatsCache,
    app_id: u32,
) -> Result<Option<SteamGameReviews>, String> {
    // â”€â”€ 1. Positive cache â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {
        let map = cache.reviews.lock().map_err(|e| e.to_string())?;
        if let Some((payload, fetched_at)) = map.get(&app_id) {
            if fetched_at.elapsed() < STEAM_REVIEWS_TTL {
                return Ok(payload.clone());
            }
        }
    }

    // â”€â”€ 2. Negative cache â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {
        let neg = cache.reviews_neg.lock().map_err(|e| e.to_string())?;
        if let Some(ts) = neg.get(&app_id) {
            if ts.elapsed() < STEAM_NEG_TTL {
                return Err("Recent appreviews fetch failed; backed off".to_string());
            }
        }
    }

    // â”€â”€ 3. Fetch from store.steampowered.com/appreviews â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // `num_per_page=0` skips the heavy `reviews[]` array â€” we only
    // want the aggregate counts in `query_summary`. This makes the
    // response dramatically smaller for popular games (e.g. CS2 has
    // 1M+ reviews; the per-review list would be a multi-MB payload
    // for nothing).
    let url = format!(
        "https://store.steampowered.com/appreviews/{}?json=1&filter=all&language=all&num_per_page=0",
        app_id
    );
    let client = shared_steam_client();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("appreviews request failed: {}", e))?;

    if !resp.status().is_success() {
        let err = format!("appreviews returned HTTP {}", resp.status());
        let mut neg = cache.reviews_neg.lock().map_err(|e| e.to_string())?;
        neg.insert(app_id, Instant::now());
        return Err(err);
    }

    #[derive(Deserialize, Default)]
    #[serde(default)]
    struct ReviewsQuerySummary {
        num_reviews: u32,
        review_score: u8,
        review_score_desc: String,
        total_positive: u32,
        total_negative: u32,
        total_reviews: u32,
    }
    #[derive(Deserialize, Default)]
    #[serde(default)]
    struct ReviewsResponse {
        success: u8,
        query_summary: Option<ReviewsQuerySummary>,
    }

    let payload: ReviewsResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse appreviews JSON: {}", e))?;

    if payload.success != 1 {
        // Steam returns `success: 2` (or higher) when the appid has
        // no reviews page â€” same "legitimate no data" case as
        // appdetails' `success: false`. Map it to `Ok(None)` so the
        // popover renders the empty-state message instead of
        // flagging the title as broken. No negative-cache write:
        // the answer is permanent for this appid.
        return Ok(None);
    }

    let summary = payload
        .query_summary
        .ok_or_else(|| "appreviews returned no query_summary".to_string())?;

    // An empty `total_reviews` means Steam has no reviews at all for
    // this title â€” represent that as `Some(empty)` so the popover
    // shows "No reviews" rather than the generic "â€”".
    let score_desc = if summary.review_score_desc.trim().is_empty() {
        None
    } else {
        Some(summary.review_score_desc)
    };

    let reviews = SteamGameReviews {
        total_positive: summary.total_positive,
        total_negative: summary.total_negative,
        total_reviews: summary.total_reviews,
        score: Some(summary.review_score),
        score_desc,
    };

    // â”€â”€ 4. Cache positive â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {
        let mut map = cache.reviews.lock().map_err(|e| e.to_string())?;
        map.insert(app_id, (Some(reviews.clone()), Instant::now()));
    }

    Ok(Some(reviews))
}

/// Aggregate all per-game Steam stats the popover renders in one IPC
/// call. Internally fans out the two HTTP fetches via `tokio::join!`
/// so the popover opens in roughly the time of the slowest endpoint
/// (typically ~400ms cold, ~30ms warm from the backend cache) rather
/// than the sum.
///
/// The `current_players` field is sourced from the existing
/// `get_steam_player_count` command rather than fetched again, so
/// the badge count and the popover header count are guaranteed to
/// agree at the moment of click. The badge still keeps its own 60s
/// polling loop, so by the time the user reopens the popover the
/// number may have ticked up â€” that's expected.
///
/// Each section is returned independently with its own `*_error`
/// field, so a Steam hiccup on `appdetails` doesn't blank the
/// popover if reviews came back fine.
#[tauri::command]
async fn get_steam_game_stats(
    app: tauri::AppHandle,
    app_id: u32,
) -> Result<SteamGameStats, String> {
    // Details + reviews in parallel. The State guard is local to this
    // function and the references handed to `tokio::join!` are tied to
    // its lifetime â€” the await points are inside the helper functions,
    // never in the outer scope, so the borrow checker is happy.
    //
    // The current concurrent-player count is intentionally NOT fetched
    // here: the frontend's `<SteamPlayerCount>` already polls it on a
    // 60s loop and passes the latest value down to the popover as a
    // prop. Re-fetching it from the backend would (a) burn a Steam API
    // call we just made, and (b) introduce a small window where the
    // badge and the popover header disagree (the badge polled at T=0,
    // the popover opens at T=2s, the backend returns the count from
    // T=0 + a fresh round-trip = T=0.1 â€” a different snapshot than
    // what's painted on the badge).
    let cache: tauri::State<'_, SteamGameStatsCache> = app.state();
    let (details_res, reviews_res) = tokio::join!(
        fetch_steam_game_details_impl(&cache, app_id),
        fetch_steam_game_reviews_impl(&cache, app_id),
    );

    Ok(SteamGameStats {
        app_id,
        details: details_res.as_ref().ok().and_then(|r| r.clone()),
        reviews: reviews_res.as_ref().ok().and_then(|r| r.clone()),
        details_error: details_res.err(),
        reviews_error: reviews_res.err(),
    })
}

/// Resolve the main game executable for a Steam AppID.
/// Uses the smart resolver in `game_watcher` (PE header analysis,
/// name scoring, depth heuristics) instead of the old
/// "largest .exe" heuristic.
#[tauri::command]
fn resolve_steam_exe(steam_app_id: u32) -> Option<String> {
    // Try to get the game name from the manifest for scoring
    let manifest = steam_game_watcher::find_app_install_dir(steam_app_id);
    let game_name = manifest.as_ref().map(|m| m.name.as_str()).unwrap_or("");
    game_watcher::resolve_steam_game_exe(steam_app_id, game_name)
}

/// Rebuild the game watcher's process index from the current library.
/// Called by the frontend after loading games and after Steam/Epic syncs.
/// This enables passive detection â€” the background poll loop can match
/// running processes to known games even when launched outside Gamelib.
#[tauri::command]
fn rebuild_watcher_index(
    app: tauri::AppHandle,
    games: Vec<GameRefInput>,
) -> Result<(), String> {
    let watcher: tauri::State<'_, Arc<std::sync::Mutex<GameWatcher>>> = app.state();
    let refs = game_watcher::build_game_refs_from_library(&games);
    let mut w = watcher.lock().map_err(|e| e.to_string())?;
    w.rebuild_index(refs);
    Ok(())
}

/// Fetch the contents of a URL and return it as text.
/// Used by the News page to fetch RSS feeds without browser CORS restrictions.
#[tauri::command]
async fn fetch_url(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("Gamelib/0.1 (RSS Reader)")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch URL: {}", e))?;

    resp.text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // L4: autostart-on-boot. Pass an empty args vec â€” we don't
        // currently ship a `--minimized` flag, so the binary just
        // launches into the regular window. The plugin also writes
        // the right per-OS artifact (LaunchAgent on macOS,
        // `HKCU\â€¦\Run` regkey on Windows, .desktop autostart on
        // Linux) so calling `enable()` is the only API surface the
        // frontend needs.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .invoke_handler(tauri::generate_handler![scan_folder_for_exes, launch_game, force_close_game, save_games, load_games, update_game_last_played, read_cover_image, search_game_metadata, fetch_game_images, download_image, spider_extract, spider_fetch_page, search_launchbox_images, detect_gpus, list_image_files, list_media_files, save_screenshot, save_text_file, load_sessions, get_sessions, delete_session, insert_session, debug_mahm_entries, get_system_ram_gb, get_system_info, get_metrics_config, set_metrics_config, resolve_steam_exe, detect_game_size, check_paths_exist, open_folder, disk_usage, move_game_install, uninstall_game, detect_steam_screenshot_folders, detect_system_screenshot_folders, save_store_cache, load_store_cache, fetch_store_games, search_store_games,            get_store_game_detail, get_collection_games,            fetch_game_reviews, fetch_external_reviews, get_about_section, get_recommended_config, save_wishlist, load_wishlist, list_recent_sessions, get_last_session_for_game, deals::fetch_gamepass_catalog, deals::fetch_isthereanydeal_deals, deals::fetch_giveaways, deals::open_deal_url,            steam_sync_games,
            steam_connect, steam_is_authenticated, steam_logout, steam_get_session,
            epic_start_login, epic_finish_login, epic_login_with_refresh_token, epic_sync_library, epic_get_filters, epic_is_authenticated, epic_logout,
            gog_start_login, gog_sync_library, gog_is_authenticated, gog_logout,
            humble_start_login, humble_sync_library, humble_is_authenticated, humble_logout,
            humble_get_settings, humble_save_settings,
            // Rockstar Games Launcher integration — installed-games scan
            // + launcher client actions (no cloud auth).
            rockstar_sync_library, rockstar_launch_game, rockstar_open_client,
            rockstar_uninstall_game,
            // Ubisoft Connect (Uplay) integration — installed + library
            // scan + client actions (uplay:// protocol).
            uplay_sync_library, uplay_launch_game, uplay_install_game,
            uplay_uninstall_game, uplay_open_client, uplay_get_settings,
            uplay_save_settings,
            // Download-feature commands. The torrent engine manages
            // its own global session; the source manager and store
            // checker are passed through `tauri::State`.
            source_manager::sources_add,
            source_manager::sources_add_bulk,
            source_manager::sources_remove,
            source_manager::sources_toggle,
            source_manager::sources_list,
            source_manager::sources_refresh,
            source_manager::sources_refresh_all,
            source_manager::sources_search_game,
            store_checker::check_ownership,
            store_checker::check_ownership_for_ids,
            store_checker::set_steam_owned,
            store_checker::set_epic_owned,
            torrent_engine::torrent_add,
            torrent_engine::torrent_pause,
            torrent_engine::torrent_resume,
            torrent_engine::torrent_remove,
            torrent_engine::torrent_get_all,
            torrent_engine::torrent_select_save_path,
            torrent_engine::torrent_pause_all,
            torrent_engine::torrent_resume_all,
            torrent_engine::torrent_update_only_files,
            torrent_engine::torrent_start_selected,
            torrent_engine::torrent_set_speed_limits,
            torrent_engine::torrent_open_folder,
            crackwatch::fetch_crackwatch_status,
            crackwatch::fetch_crackwatch_status_batch,
            price::fetch_game_price,
            price::fetch_game_prices_batch,
            protondb::fetch_protondb_status,
            fetch_url,
            rebuild_watcher_index,
            achievements::fetch_achievements,
            achievements::save_achievements_cache,
            achievements::load_achievements_cache,
            achievements::sync_local_achievements,
            achievement_watcher::scan_all_local_achievements,
            achievement_watcher::get_local_achievements_enabled,
            achievement_watcher::set_local_achievements_enabled,
            downloader::test_debrid_key,
            downloader::check_debrid_cache,
            downloader::direct_download_start,
            downloader::debrid_download_start,
            downloader::direct_download_update_url,
            downloader::debrid_unrestrict_link,
            // Live Steam concurrent-player count. Powers the player
            // badges on the store hero, store detail, and game detail
            // banners â€” see PlayerCountCache above for caching policy.
            get_steam_player_count,
            lookup_steam_app_id_for_game,
            // Popover payload: developer/publisher/release/price + reviews.
            // See SteamGameStatsCache above for per-section caching policy.
            get_steam_game_stats,
            // Per-appid history ring buffer of concurrent-player
            // counts, with server-computed peak/average. Powers the
            // activity-tab sparkline â€” see PlayerCountHistoryCache
            // above for the 24h cap + 5s dedupe policy.
            get_player_count_history,
            // New launcher settings â€” close-to-tray (L2), minimize
            // on launch (L3), disable UAC elevation prompts (L5),
            // and OS auto-launch on boot (L4 via tauri-plugin-autostart).
            get_launcher_settings,
            set_close_to_tray_enabled,
            set_minimize_on_launch_enabled,
            set_autostart_enabled,
            is_autostart_enabled,
            write_sync_file,
            read_sync_file,
            get_friends_sync_dir,
            get_friends_device_id,
            list_friend_outboxes,
            load_friends_db,
            save_friends_db,
            get_local_ip,
            host_p2p_sync,
            client_p2p_sync,
            get_internet_sync_status,
            trigger_internet_sync])
        .on_window_event(|window, event| {
            // L2: intercept the user clicking the OS-level close
            // button (or the in-app WindowControls close button, since
            // both end up at the same CloseRequested event). When
            // close_to_tray is on, hide the window instead of letting
            // it close â€” the app keeps running with no visible chrome
            // and the user reopens it from the taskbar. The lock is
            // held briefly (one bool read) and never across an
            // .await, so the std sync Mutex is the simplest correct
            // primitive here.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let settings = window
                        .app_handle()
                        .state::<Arc<std::sync::Mutex<LauncherSettings>>>();
                    let close_to_tray = settings
                        .lock()
                        .map(|s| s.close_to_tray_enabled)
                        .unwrap_or(false);
                    if close_to_tray {
                        api.prevent_close();
                        let _ = window.hide();
                        return;
                    }
                }
            }
            // Unpause / unhide from taskbar click â€” when the window
            // is hidden and the user clicks the dock/taskbar icon,
            // tauri emits a Focused event. Re-show + unminimize so
            // the user sees the app without manual intervention.
            if let WindowEvent::Focused(true) = event {
                if window.label() == "main" {
                    if let Some(win) = window.app_handle().get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.unminimize();
                    }
                }
            }
        })
        .setup(|app| {
            // Load .env file for development (production builds have
            // credentials baked in at compile time via option_env!()).
            config::load_env_file();

            // â”€â”€ Initialize the SQLite database â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            // Phase 1â€“4 storage layer. opened & migrated before
            // every other state so commands can take a `Db` via
            // `tauri::State`. We register `Db` directly (NOT wrapped
            // in an `Arc`) because the inner `r2d2::Pool` is already
            // `Arc`-backed internally; `Db: Clone` because the pool
            // field is Clone. The previous `Arc::new(db)` wrapping
            // registered a TypeId of `Arc<Db>` while the commands
            // declared `state::<db::Db>()` (different TypeIds),
            // causing "state() called before manage()" panics on
            // every command invocation.
            let app_data_dir = app.path().app_data_dir()?;
            let db = match db::init(&app_data_dir) {
                Ok(db) => db,
                Err(e) => {
                    eprintln!("[gamelib] db::init failed: {e}");
                    return Err(Box::new(std::io::Error::new(
                        std::io::ErrorKind::Other,
                        format!("db::init: {e}"),
                    )) as Box<dyn std::error::Error>);
                }
            };
            app.manage(db.clone());

            // â”€â”€ Initialize the launcher settings (L2/L3/L5) â”€â”€â”€â”€â”€â”€â”€â”€
            // Read the persisted close-to-tray/minimize/disable-UAC
            // toggles from kv, then manage the in-memory mirror so
            // `launch_game`, `force_close_game`, and the
            // CloseRequested event handler can all read it on the
            // hot path without an extra DB round-trip. The setters
            // update both the mirror and the kv_store.
            let db_state: tauri::State<'_, db::Db> = app.state();
            let launcher_settings = Arc::new(std::sync::Mutex::new(
                load_launcher_settings(db_state.inner()),
            ));
            app.manage(launcher_settings);

            // â”€â”€ Initialize the GameWatcher â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            // Long-lived background service that polls WMI for running
            // game processes. Handles both app-launched sessions and
            // passive detection (games launched outside Gamelib).
            //
            // Phase 3: the watcher now holds an Arc<Db> so its
            // background poller thread can write session rows to the
            // `sessions` table on every session-end before emitting
            // the `game-exited` event.
            let game_watcher = Arc::new(std::sync::Mutex::new(GameWatcher::new(db.clone())));
            app.manage(game_watcher.clone());

            // Start the background poll loop (every 5s, picks up
            // running processes and tracks sessions).
            game_watcher::start_background_poll(
                game_watcher,
                app.handle().clone(),
            );

            // ── Local (crack / emulator) achievement watcher ──────────
            // Ports Hydra's achievement watcher: pre-scans on startup to
            // pick up offline unlocks, then polls crack/emulator files
            // for changes and merges them into the achievements cache
            // (schema fetched anonymously from the Hydra API). Emits
            // `achievements-updated` / `achievement-unlocked` events.
            achievement_watcher::start(app.handle().clone());

            // â”€â”€ Source manager â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            // Phase 2: the in-memory state maps are gone. All reads
            // and writes go through the SQLite pool. The
            // `Arc<SourceManager>` (no Mutex) is shared across
            // commands; concurrency is provided by SQLite WAL.
            let source_manager = Arc::new(source_manager::SourceManager::new(db.clone()));
            app.manage(source_manager);

            let store_checker = Arc::new(Mutex::new(store_checker::StoreChecker::new()));
            app.manage(store_checker);

            // Live Steam concurrent-player count cache. Sized at 0
            // entries on startup â€” grows on first miss per-appid and
            // is bounded by how many distinct Steam appids the user
            // actually opens (single-digit hundreds at worst for a
            // large library). We never expire old entries: a long-lived
            // map with O(N) work per banner refresh is fine for N â‰¤ a
            // few hundred, and skipping the cleanup avoids dropping
            // a user's just-fetched count behind their back.
            app.manage(PlayerCountCache::default());

            // Steam game-stats cache (appdetails + appreviews, used by
            // the player-count popover). Same growth model as
            // PlayerCountCache: 0 entries on startup, bounded by the
            // number of distinct Steam appids the user actually opens.
            app.manage(SteamGameStatsCache::default());

            // Player-count history ring buffer (per-appid, 1440
            // samples cap = 24h at 60s polling). Powers the
            // activity-tab sparkline. Same growth model as the
            // sibling caches: 0 entries on startup, grows on first
            // successful fetch per appid.
            app.manage(PlayerCountHistoryCache::default());


            // Spin the torrent engine up on the async runtime.
            // We use `spawn` (fire-and-forget) rather than
            // `block_on` so the `setup` closure returns
            // immediately and the app window can appear without
            // waiting for the torrent session to open + walk
            // existing torrents from disk. Init failures are
            // logged but don't block startup â€” the rest of the
            // app works without the engine, and the user can
            // retry by restarting.
            let app_handle = app.handle().clone();
            let app_data_dir_for_engine = app_data_dir.clone();
            let _ = tauri::async_runtime::spawn(async move {
                if let Err(e) = torrent_engine::initialize_engine(
                    app_handle,
                    app_data_dir_for_engine,
                )
                .await
                {
                    eprintln!("[gamelib] torrent_engine::initialize_engine failed: {}", e);
                }
            });

            tray::build_tray(app).unwrap_or_else(|e| eprintln!("[gamelib] tray setup failed: {e}"));

            let app_handle = app.handle().clone();
            let (tx, rx) = tokio::sync::mpsc::channel(10);
            init_internet_sync(tx);
            tauri::async_runtime::spawn(async move {
                start_internet_sync_loop(app_handle, rx).await;
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                torrent_engine::cleanup_extractions();
                std::process::exit(0);
            }
        });
}

// ── Friends Sync (local shared-file P2P) ─────────────────────────────

const FRIENDS_SYNC_FILE_NAME: &str = "gamelib-friends.json";

fn sanitize_segment(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
        .collect()
}

fn ensure_device_id(app: &tauri::AppHandle) -> Result<String, String> {
    let db = app.state::<db::Db>();
    if let Ok(Some(id)) = db::kv::get(&db, "friends_device_id") {
        return Ok(id);
    }
    let random_id = format!("device_{}_{:04x}", 
        SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs(),
        rand::random::<u16>()
    );
    if let Err(e) = db::kv::set(&db, "friends_device_id", &random_id) {
        return Err(e);
    }
    Ok(random_id)
}

#[tauri::command]
fn get_friends_device_id(app: tauri::AppHandle) -> Result<String, String> {
    ensure_device_id(&app)
}

/// The sync root is always `<app_data_dir>/sync`, right beside the DB.
fn friends_sync_root(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(app_data.join("sync"))
}

#[tauri::command]
fn get_friends_sync_dir(app: tauri::AppHandle) -> Result<String, String> {
    friends_sync_root(&app).map(|p| p.to_string_lossy().to_string())
}

/// List peer device ids discovered in the shared sync directory
/// (every subfolder that contains our outbox file, excluding our own).
#[tauri::command]
fn list_friend_outboxes(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let root = friends_sync_root(&app)?;
    let my_id = ensure_device_id(&app).ok();
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&root) {
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_dir() {
                continue;
            }
            let candidate = p.join(FRIENDS_SYNC_FILE_NAME);
            if !candidate.exists() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if Some(&name) == my_id.as_ref() {
                continue;
            }
            out.push(name);
        }
    }
    Ok(out)
}

/// Publish our outbox into `<syncRoot>/<deviceId>/gamelib-friends.json`.
/// Creates the subfolder if needed. Writes atomically (tmp + rename).
#[tauri::command]
fn write_sync_file(app: tauri::AppHandle, content: String) -> Result<(), String> {
    let root = friends_sync_root(&app)?;
    let device_id = ensure_device_id(&app)?;
    let folder = root.join(sanitize_segment(&device_id));
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let file_path = folder.join(FRIENDS_SYNC_FILE_NAME);
    let tmp_path = folder.join(format!("{}.tmp", FRIENDS_SYNC_FILE_NAME));
    std::fs::write(&tmp_path, content.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp_path, &file_path).map_err(|e| e.to_string())
}

/// Read a peer's outbox from `<syncRoot>/<peerId>/gamelib-friends.json`.
#[tauri::command]
fn read_sync_file(app: tauri::AppHandle, peer_id: String) -> Result<Option<String>, String> {
    let root = friends_sync_root(&app)?;
    let folder = root.join(sanitize_segment(&peer_id));
    let file_path = folder.join(FRIENDS_SYNC_FILE_NAME);
    if !file_path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(file_path).map_err(|e| e.to_string())?;
    Ok(Some(content))
}

// ── P2P Friends Sync Commands ────────────────────────────────────────

fn load_friends_db_internal(app: &tauri::AppHandle) -> Result<String, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_dir = app_data.join("friends_db");
    let db_path = db_dir.join("database.json");
    if !db_path.exists() {
        return Ok("{\"profile\":null,\"friends\":[],\"sessions\":[],\"recommendations\":[]}".to_string());
    }
    std::fs::read_to_string(db_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_friends_db(app: tauri::AppHandle) -> Result<String, String> {
    load_friends_db_internal(&app)
}

#[tauri::command]
fn save_friends_db(app: tauri::AppHandle, content: String) -> Result<(), String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_dir = app_data.join("friends_db");
    std::fs::create_dir_all(&db_dir).map_err(|e| e.to_string())?;
    let file_path = db_dir.join("database.json");
    let tmp_path = db_dir.join("database.json.tmp");
    std::fs::write(&tmp_path, content.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp_path, &file_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_local_ip() -> Result<String, String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0")
        .map_err(|e| format!("Failed to bind UDP: {}", e))?;
    socket.connect("8.8.8.8:80")
        .map_err(|e| format!("Failed to connect to routing IP: {}", e))?;
    let local_addr = socket.local_addr()
        .map_err(|e| format!("Failed to resolve local address: {}", e))?;
    Ok(local_addr.ip().to_string())
}

async fn write_framed_string<S: tokio::io::AsyncWrite + Unpin>(stream: &mut S, data: &str) -> std::io::Result<()> {
    use tokio::io::AsyncWriteExt;
    let bytes = data.as_bytes();
    let len = bytes.len() as u32;
    stream.write_all(&len.to_be_bytes()).await?;
    stream.write_all(bytes).await?;
    stream.flush().await?;
    Ok(())
}

async fn read_framed_string<S: tokio::io::AsyncRead + Unpin>(stream: &mut S) -> std::io::Result<String> {
    use tokio::io::AsyncReadExt;
    let mut len_bytes = [0u8; 4];
    stream.read_exact(&mut len_bytes).await?;
    let len = u32::from_be_bytes(len_bytes) as usize;
    if len > 50 * 1024 * 1024 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Incoming P2P sync payload exceeds 50MB limit",
        ));
    }
    let mut buf = vec![0u8; len];
    stream.read_exact(&mut buf).await?;
    let s = String::from_utf8(buf).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    Ok(s)
}

#[tauri::command]
async fn host_p2p_sync(app: tauri::AppHandle, port: u16, timeout_secs: u64) -> Result<String, String> {
    use tokio::net::TcpListener;
    use tokio::time::{timeout, Duration};

    let addr = format!("0.0.0.0:{}", port);
    let listener = TcpListener::bind(&addr).await
        .map_err(|e| format!("Failed to bind host port {}: {}", port, e))?;

    let (mut socket, _) = match timeout(Duration::from_secs(timeout_secs), listener.accept()).await {
        Ok(Ok(conn)) => conn,
        Ok(Err(e)) => return Err(format!("Socket connection accept error: {}", e)),
        Err(_) => return Err(format!("No connection received within {} seconds.", timeout_secs)),
    };

    let client_db = read_framed_string(&mut socket).await
        .map_err(|e| format!("Failed to read client data: {}", e))?;

    let host_db = load_friends_db_internal(&app)?;

    write_framed_string(&mut socket, &host_db).await
        .map_err(|e| format!("Failed to send host data: {}", e))?;

    Ok(client_db)
}

#[tauri::command]
async fn client_p2p_sync(app: tauri::AppHandle, host_addr: String) -> Result<String, String> {
    use tokio::net::TcpStream;
    use tokio::time::{timeout, Duration};

    let mut socket = match timeout(Duration::from_secs(15), TcpStream::connect(&host_addr)).await {
        Ok(Ok(stream)) => stream,
        Ok(Err(e)) => return Err(format!("Failed to connect to host {}: {}", host_addr, e)),
        Err(_) => return Err(format!("Connection to host {} timed out after 15 seconds.", host_addr)),
    };

    let client_db = load_friends_db_internal(&app)?;

    write_framed_string(&mut socket, &client_db).await
        .map_err(|e| format!("Failed to send client data: {}", e))?;

    let host_db = read_framed_string(&mut socket).await
        .map_err(|e| format!("Failed to read host data: {}", e))?;

    Ok(host_db)
}

// ── Internet Sync (Automatic P2P sync via KV discovery) ──────────────

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InternetSyncStatus {
    pub enabled: bool,
    pub bound_port: Option<u16>,
    pub external_ip: Option<String>,
    pub upnp_mapped: bool,
    pub last_synced_times: HashMap<String, u64>,
    pub error_message: Option<String>,
}

pub struct InternetSyncState {
    pub bound_port: std::sync::Mutex<Option<u16>>,
    pub external_ip: std::sync::Mutex<Option<String>>,
    pub upnp_mapped: std::sync::Mutex<bool>,
    pub last_synced_times: std::sync::Mutex<HashMap<String, u64>>,
    pub error_message: std::sync::Mutex<Option<String>>,
    pub trigger_tx: tokio::sync::mpsc::Sender<()>,
}

impl InternetSyncState {
    pub fn get_status(&self) -> InternetSyncStatus {
        InternetSyncStatus {
            enabled: true,
            bound_port: *self.bound_port.lock().unwrap(),
            external_ip: self.external_ip.lock().unwrap().clone(),
            upnp_mapped: *self.upnp_mapped.lock().unwrap(),
            last_synced_times: self.last_synced_times.lock().unwrap().clone(),
            error_message: self.error_message.lock().unwrap().clone(),
        }
    }
}

static INTERNET_SYNC_STATE: OnceLock<Arc<InternetSyncState>> = OnceLock::new();

fn init_internet_sync(trigger_tx: tokio::sync::mpsc::Sender<()>) -> Arc<InternetSyncState> {
    let state = Arc::new(InternetSyncState {
        bound_port: std::sync::Mutex::new(None),
        external_ip: std::sync::Mutex::new(None),
        upnp_mapped: std::sync::Mutex::new(false),
        last_synced_times: std::sync::Mutex::new(HashMap::new()),
        error_message: std::sync::Mutex::new(None),
        trigger_tx,
    });
    let _ = INTERNET_SYNC_STATE.set(state.clone());
    state
}

async fn fetch_external_ip() -> Option<String> {
    use std::str::FromStr;
    let urls = vec![
        "https://api.ipify.org",
        "https://icanhazip.com",
        "https://ident.me",
    ];
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .ok()?;

    for url in urls {
        if let Ok(resp) = client.get(url).send().await {
            if let Ok(text) = resp.text().await {
                let cleaned = text.trim().to_string();
                if std::net::IpAddr::from_str(&cleaned).is_ok() {
                    return Some(cleaned);
                }
            }
        }
    }
    None
}

async fn map_port_upnp(local_ip: std::net::IpAddr, port: u16) -> bool {
    let local_addr = std::net::SocketAddr::new(local_ip, port);
    
    let res = tokio::task::spawn_blocking(move || {
        let opts = igd_next::SearchOptions {
            bind_addr: std::net::SocketAddr::new(local_ip, 0),
            timeout: Some(std::time::Duration::from_secs(5)),
            ..Default::default()
        };
        match igd_next::search_gateway(opts) {
            Ok(gateway) => {
                match gateway.add_port(
                    igd_next::PortMappingProtocol::TCP,
                    port,
                    local_addr,
                    0,
                    "GameLib Internet Sync",
                ) {
                    Ok(_) => {
                        println!("[gamelib] UPnP: successfully mapped port {} to {}", port, local_addr);
                        true
                    }
                    Err(e) => {
                        eprintln!("[gamelib] UPnP: failed to map port: {}", e);
                        false
                    }
                }
            }
            Err(e) => {
                eprintln!("[gamelib] UPnP: gateway search failed: {}", e);
                false
            }
        }
    }).await;
    
    res.unwrap_or(false)
}

fn get_local_ip_internal() -> Option<std::net::IpAddr> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let local_addr = socket.local_addr().ok()?;
    Some(local_addr.ip())
}

const KV_APP_KEY: &str = "gamelib_v1_p2p_sync";

async fn publish_address_to_kv(sync_id: &str, address: &str) -> Result<(), String> {
    let sanitized_address = address.replace('.', "_").replace(':', "-");
    let url = format!(
        "https://keyvalue.immanuel.co/api/KeyVal/UpdateValue/{}/{}/{}",
        KV_APP_KEY,
        urlencoding::encode(sync_id),
        urlencoding::encode(&sanitized_address)
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client.post(&url)
        .header("Content-Length", "0")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        Ok(())
    } else {
        Err(format!("HTTP status {}", resp.status()))
    }
}

async fn fetch_address_from_kv(sync_id: &str) -> Option<String> {
    let url = format!(
        "https://keyvalue.immanuel.co/api/KeyVal/GetValue/{}/{}",
        KV_APP_KEY,
        urlencoding::encode(sync_id)
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .ok()?;

    let resp = client.get(&url).send().await.ok()?;
    if resp.status().is_success() {
        if let Ok(text) = resp.text().await {
            let val = text.trim();
            if val.is_empty() || val == "null" || val == "\"null\"" {
                return None;
            }
            let cleaned = val.strip_prefix('"').unwrap_or(val).strip_suffix('"').unwrap_or(val);
            if cleaned.contains('_') || cleaned.contains('-') {
                return Some(cleaned.replace('_', ".").replace('-', ":"));
            }
            if cleaned.contains(':') {
                return Some(cleaned.to_string());
            }
        }
    }
    None
}

#[derive(serde::Deserialize)]
struct ProfilePayloadShort {
    #[serde(rename = "syncId")]
    sync_id: String,
}

#[derive(serde::Deserialize)]
struct FriendPayloadShort {
    #[serde(rename = "syncId")]
    sync_id: String,
}

#[derive(serde::Deserialize)]
struct DbPayloadShort {
    profile: Option<ProfilePayloadShort>,
    friends: Option<Vec<FriendPayloadShort>>,
}

fn load_friends_db_payload(app: &tauri::AppHandle) -> Option<DbPayloadShort> {
    if let Ok(raw) = load_friends_db_internal(app) {
        if let Ok(payload) = serde_json::from_str::<DbPayloadShort>(&raw) {
            return Some(payload);
        }
    }
    None
}

async fn run_tcp_host(app: tauri::AppHandle, state: Arc<InternetSyncState>, listener: tokio::net::TcpListener) {
    loop {
        match listener.accept().await {
            Ok((mut socket, peer_addr)) => {
                println!("[gamelib] Accepted internet sync connection from {}", peer_addr);
                let app_clone = app.clone();
                let state_clone = state.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_inbound_connection(&app_clone, &state_clone, &mut socket).await {
                        eprintln!("[gamelib] Error handling inbound connection: {}", e);
                    }
                });
            }
            Err(e) => {
                eprintln!("[gamelib] TCP listener accept error: {}", e);
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            }
        }
    }
}

async fn handle_inbound_connection(
    app: &tauri::AppHandle,
    state: &Arc<InternetSyncState>,
    socket: &mut tokio::net::TcpStream,
) -> Result<(), String> {
    let client_db = read_framed_string(socket).await
        .map_err(|e| format!("Failed to read client data: {}", e))?;

    let client_sync_id = if let Ok(payload) = serde_json::from_str::<DbPayloadShort>(&client_db) {
        payload.profile.map(|p| p.sync_id)
    } else {
        None
    };

    let host_db = load_friends_db_internal(app)?;
    write_framed_string(socket, &host_db).await
        .map_err(|e| format!("Failed to send host data: {}", e))?;

    if let Some(ref sync_id) = client_sync_id {
        let now = SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
        state.last_synced_times.lock().unwrap().insert(sync_id.clone(), now);
    }
    
    app.emit("internet-sync-received", client_db).map_err(|e| e.to_string())?;

    Ok(())
}

async fn sync_with_friend(
    app: &tauri::AppHandle,
    state: &Arc<InternetSyncState>,
    friend_sync_id: &str,
    friend_addr: &str,
) -> Result<(), String> {
    use tokio::time::timeout;
    use std::time::Duration;

    println!("[gamelib] Connecting to friend {} at {}", friend_sync_id, friend_addr);
    let mut socket = match timeout(Duration::from_secs(8), tokio::net::TcpStream::connect(friend_addr)).await {
        Ok(Ok(stream)) => stream,
        Ok(Err(e)) => return Err(format!("TCP connect error: {}", e)),
        Err(_) => return Err("Connection timed out".to_string()),
    };

    let our_db = load_friends_db_internal(app)?;
    write_framed_string(&mut socket, &our_db).await
        .map_err(|e| format!("Failed to send our database: {}", e))?;

    let remote_db = read_framed_string(&mut socket).await
        .map_err(|e| format!("Failed to read remote database: {}", e))?;

    let now = SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
    state.last_synced_times.lock().unwrap().insert(friend_sync_id.to_string(), now);

    app.emit("internet-sync-received", remote_db).map_err(|e| e.to_string())?;

    Ok(())
}

pub async fn start_internet_sync_loop(app: tauri::AppHandle, mut trigger_rx: tokio::sync::mpsc::Receiver<()>) {
    let state = match INTERNET_SYNC_STATE.get() {
        Some(s) => s.clone(),
        None => return,
    };
    
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
    let mut active_listener: Option<u16> = None;
    
    loop {
        tokio::select! {
            _ = interval.tick() => {},
            _ = trigger_rx.recv() => {
                println!("[gamelib] Internet sync manually triggered");
            }
        }

        let db_payload = match load_friends_db_payload(&app) {
            Some(p) => p,
            None => continue,
        };

        let profile = match db_payload.profile {
            Some(p) => p,
            None => continue,
        };

        if profile.sync_id.is_empty() {
            continue;
        }

        if active_listener.is_none() {
            let bind_res = match tokio::net::TcpListener::bind("0.0.0.0:54321").await {
                Ok(l) => Ok(l),
                Err(_) => tokio::net::TcpListener::bind("0.0.0.0:0").await,
            };

            match bind_res {
                Ok(listener) => {
                    if let Ok(local_addr) = listener.local_addr() {
                        let port = local_addr.port();
                        active_listener = Some(port);
                        *state.bound_port.lock().unwrap() = Some(port);
                        println!("[gamelib] Internet sync host listening on port {}", port);

                        let app_clone = app.clone();
                        let state_clone = state.clone();
                        tokio::spawn(async move {
                            run_tcp_host(app_clone, state_clone, listener).await;
                        });
                    }
                }
                Err(e) => {
                    let err_msg = format!("Failed to start TCP listener: {}", e);
                    eprintln!("[gamelib] {}", err_msg);
                    *state.error_message.lock().unwrap() = Some(err_msg);
                }
            }
        }

        if let Some(port) = active_listener {
            if let Some(ext_ip) = fetch_external_ip().await {
                let current_addr = format!("{}:{}", ext_ip, port);
                let (has_changed, needs_upnp) = {
                    let last_published = state.external_ip.lock().unwrap();
                    let changed = last_published.as_ref() != Some(&ext_ip);
                    let upnp_needed = !*state.upnp_mapped.lock().unwrap();
                    (changed, upnp_needed)
                };

                if has_changed || needs_upnp {
                    {
                        *state.external_ip.lock().unwrap() = Some(ext_ip.clone());
                    }
                    
                    if let Some(local_ip) = get_local_ip_internal() {
                        let upnp_ok = map_port_upnp(local_ip, port).await;
                        *state.upnp_mapped.lock().unwrap() = upnp_ok;
                    }
                    
                    if let Err(e) = publish_address_to_kv(&profile.sync_id, &current_addr).await {
                        eprintln!("[gamelib] Failed to publish sync address to KV: {}", e);
                        *state.error_message.lock().unwrap() = Some(format!("KV publish failed: {}", e));
                    } else {
                        println!("[gamelib] Published sync address {} to KV", current_addr);
                        *state.error_message.lock().unwrap() = None;
                    }
                }
            } else {
                eprintln!("[gamelib] Failed to fetch external IP");
                *state.error_message.lock().unwrap() = Some("Could not resolve external IP".to_string());
            }
        }

        if let Some(friends) = db_payload.friends {
            let now = SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
            for friend in friends {
                if friend.sync_id.is_empty() || friend.sync_id == profile.sync_id {
                    continue;
                }

                let last_sync = {
                    let map = state.last_synced_times.lock().unwrap();
                    map.get(&friend.sync_id).copied().unwrap_or(0)
                };

                // Sync if never synced, or synced > 5 minutes ago (300 secs)
                if now - last_sync > 300 {
                    if let Some(friend_addr) = fetch_address_from_kv(&friend.sync_id).await {
                        let app_clone = app.clone();
                        let state_clone = state.clone();
                        let f_sync_id = friend.sync_id.clone();
                        tokio::spawn(async move {
                            if let Err(e) = sync_with_friend(&app_clone, &state_clone, &f_sync_id, &friend_addr).await {
                                println!("[gamelib] Passive sync with {} failed: {}", f_sync_id, e);
                            } else {
                                println!("[gamelib] Passive sync with {} succeeded", f_sync_id);
                            }
                        });
                    }
                }
            }
        }
    }
}

#[tauri::command]
fn get_internet_sync_status() -> Result<InternetSyncStatus, String> {
    if let Some(state) = INTERNET_SYNC_STATE.get() {
        Ok(state.get_status())
    } else {
        Ok(InternetSyncStatus {
            enabled: false,
            bound_port: None,
            external_ip: None,
            upnp_mapped: false,
            last_synced_times: HashMap::new(),
            error_message: Some("Internet sync loop not running".to_string()),
        })
    }
}

#[tauri::command]
async fn trigger_internet_sync() -> Result<(), String> {
    if let Some(state) = INTERNET_SYNC_STATE.get() {
        state.trigger_tx.send(()).await.map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Internet sync loop not running".to_string())
    }
}
