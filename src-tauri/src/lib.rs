use std::path::Path;
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tokio::sync::Mutex;

mod config;
mod crackwatch;
mod game_scraper;
mod game_watcher;
mod gpu_detector;
mod metrics_collector;
mod rtss_reader;
mod mahm_reader;
mod deals;
mod steam;
mod epic;
mod steam_game_watcher;
mod size;
// New modules for the download feature. See each module's
// top-of-file doc comment for the design rationale.
mod source_manager;
mod store_checker;
mod torrent_engine;
mod achievements;
mod downloader;
use game_scraper::{GameMetadataResult, LaunchBoxImageResult, StoreGameSummary, TimeToBeat, SimilarGame, ReleaseDateInfo, IgdbReview, LanguageSupportInfo, ReviewFetchResult};
use game_watcher::{GameWatcher, GameRefInput};
use gpu_detector::GpuInfo;
use epic::auth::{epic_start_login, epic_finish_login, epic_is_authenticated, epic_logout};
use epic::sync::{epic_sync_library, epic_get_filters};
use steam::auth::{
    steam_start_login, steam_finish_login, steam_is_authenticated, steam_logout,
    steam_get_session, steam_save_config, steam_load_config, steam_clear_config,
};
use steam::sync::steam_sync_games;
use size::{detect_game_size, check_paths_exist};

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    launch_arguments: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    run_as_admin: Option<bool>,
    /// Unix-millisecond timestamp of when the user most recently exited a
    /// session for this game. `None` until the first session ends. Used by
    /// the Library page's "Continue Playing" rail to surface recently-active
    /// titles. Persisted via the existing `save_games` round-trip — no
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

/// Persist the game library to the app's data directory.
#[tauri::command]
fn save_games(app: tauri::AppHandle, games: Vec<GameData>) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let file_path = data_dir.join("games.json");
    let json = serde_json::to_string_pretty(&games).map_err(|e| e.to_string())?;
    std::fs::write(&file_path, json).map_err(|e| e.to_string())?;
    Ok(())
}

/// Load the game library from the app's data directory.
#[tauri::command]
fn load_games(app: tauri::AppHandle) -> Result<Vec<GameData>, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let file_path = data_dir.join("games.json");
    if !file_path.exists() {
        return Ok(Vec::new());
    }
    let json = std::fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

/// Detect GPUs on the system using WMI.
#[tauri::command]
fn detect_gpus() -> Vec<GpuInfo> {
    gpu_detector::detect_gpus()
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
/// process detection → metrics collection → exit detection → game-exited event.
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

    // Update GPU info on the watcher for metrics collection
    {
        let mut w = watcher.lock().map_err(|e| e.to_string())?;
        w.set_gpu(gpu_id.clone(), gpu_name.clone());
    }

    let mut initial_pid: u32 = 0;
    let exe_path: Option<String>;

    // ── Determine launch strategy ──────────────────────────────────────
    if platform == "Steam" && (game_path.is_empty() || !Path::new(&game_path).exists()) {
        // Steam game without local exe — use steam:// protocol
        let sid = steam_app_id.ok_or("Steam games require a steamAppId")?;
        let url = format!("steam://run/{}", sid);
        tauri_plugin_opener::open_url(url, None::<&str>)
            .map_err(|e| format!("Failed to open Steam URL: {}", e))?;

        // No PID — the watcher will detect the process when it appears
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
                        if e.raw_os_error() == Some(ERROR_ELEVATION_REQUIRED) {
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
        // discard the handle — the watcher's WMI poll will track the
        // real process lifecycle.
    }

    // ── Register with watcher ──────────────────────────────────────────
    // Start metrics collection immediately if we have a valid PID.
    // The stop_tx and metrics_rx are stored in the session so the
    // watcher's finish_session can stop collection and read results.
    let (metrics_stop_tx, metrics_rx) = if initial_pid > 0 {
        let (tx, rx) = metrics_collector::start_metrics_collection(
            5, initial_pid, gpu_id.clone(), gpu_name.clone(),
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
        let mut w = watcher.lock().map_err(|e| e.to_string())?;
        w.register_launched_session(
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
/// skipped — IGDB and Steam provide better metadata for known titles.
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

/// Save the store browser cache to disk (6-hour TTL for IGDB catalog data).
#[tauri::command]
fn save_store_cache(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let file_path = data_dir.join("store_cache.json");
    std::fs::write(&file_path, data).map_err(|e| e.to_string())?;
    Ok(())
}

/// Load the store browser cache from disk. Returns empty string if no cache or expired.
#[tauri::command]
fn load_store_cache(app: tauri::AppHandle) -> Result<String, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let file_path = data_dir.join("store_cache.json");
    if !file_path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&file_path).map_err(|e| e.to_string())
}

/// Save the wishlist cache to disk as JSON. Mirrors `save_store_cache`.
/// Reads/writes `<app_data_dir>/wishlist_cache.json`; the React frontend
/// owns the canonical state (see `src/hooks/useWishlist.ts`) and debounces
/// writes here to coalesce rapid toggles.
#[tauri::command]
fn save_wishlist(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let file_path = data_dir.join("wishlist_cache.json");
    std::fs::write(&file_path, data).map_err(|e| e.to_string())?;
    Ok(())
}

/// Load the wishlist cache from disk. Returns empty string when no
/// wishlist has been saved yet — the frontend treats that as an
/// empty wishlist and proceeds to write one when the user toggles a heart.
#[tauri::command]
fn load_wishlist(app: tauri::AppHandle) -> Result<String, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let file_path = data_dir.join("wishlist_cache.json");
    if !file_path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&file_path).map_err(|e| e.to_string())
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

/// Fetch reviews for a game from the best available source (Steam first, IGDB fallback).
/// Returns the reviews and a `source` string ("steam" | "igdb" | "none") so the UI
/// can label them correctly.
#[tauri::command]
async fn fetch_game_reviews(
    game_name: String,
    steam_app_id: Option<u64>,
    cursor: Option<String>,
    language: Option<String>,
) -> ReviewFetchResult {
    game_scraper::fetch_game_reviews(&game_name, steam_app_id, cursor, language).await
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

/// Debug command: dump all MSI Afterburner shared memory entries for diagnostics.
#[tauri::command]
fn debug_mahm_entries() -> Vec<(String, String, f32)> {
    mahm_reader::dump_mahm_entries().unwrap_or_default()
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
/// This enables passive detection — the background poll loop can match
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
        .invoke_handler(tauri::generate_handler![scan_folder_for_exes, launch_game, save_games, load_games, read_cover_image, search_game_metadata, fetch_game_images, download_image, spider_extract, spider_fetch_page, search_launchbox_images, detect_gpus, save_screenshot, debug_mahm_entries, get_system_ram_gb, resolve_steam_exe, detect_game_size, check_paths_exist, save_store_cache, load_store_cache, fetch_store_games, search_store_games, get_store_game_detail, fetch_game_reviews, fetch_external_reviews, save_wishlist, load_wishlist, deals::fetch_gamepass_catalog, deals::fetch_isthereanydeal_deals, deals::fetch_giveaways, deals::open_deal_url, steam_save_config, steam_load_config, steam_clear_config, steam_sync_games,
            steam_start_login, steam_finish_login, steam_is_authenticated, steam_logout, steam_get_session,
            epic_start_login, epic_finish_login, epic_sync_library, epic_get_filters, epic_is_authenticated, epic_logout,
            // Download-feature commands. The torrent engine manages
            // its own global session; the source manager and store
            // checker are passed through `tauri::State`.
            source_manager::sources_add,
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
            crackwatch::fetch_crackwatch_status,
            fetch_url,
            rebuild_watcher_index,
            achievements::fetch_achievements,
            achievements::save_achievements_cache,
            achievements::load_achievements_cache,
            downloader::test_debrid_key,
            downloader::check_debrid_cache,
            downloader::direct_download_start,
            downloader::debrid_download_start])
        .setup(|app| {
            // Load .env file for development (production builds have
            // credentials baked in at compile time via option_env!()).
            config::load_env_file();

            // ── Initialize the GameWatcher ──────────────────────────
            // Long-lived background service that polls WMI for running
            // game processes. Handles both app-launched sessions and
            // passive detection (games launched outside Gamelib).
            let game_watcher = Arc::new(std::sync::Mutex::new(GameWatcher::new()));
            app.manage(game_watcher.clone());

            // Start the background poll loop (every 5s, picks up
            // running processes and tracks sessions)
            game_watcher::start_background_poll(
                game_watcher,
                app.handle().clone(),
            );

            // Initialize the source manager + store checker state.
            //
            // The source manager uses `std::sync::Mutex` (NOT
            // `tokio::sync::Mutex`) so the sync `setup` closure
            // can `lock().unwrap()` it without blocking on a
            // runtime worker. The async Tauri commands also take
            // this type; they hold the guard across the await,
            // which ties up one runtime worker per concurrent
            // command — acceptable because source operations are
            // user-driven and infrequent.
            //
            // The store checker keeps `tokio::sync::Mutex` since
            // its Tauri commands are all short critical sections
            // that benefit from the async-aware lock.
            let app_data_dir = app.path().app_data_dir()?;
            let source_manager = Arc::new(tokio::sync::Mutex::new(
                source_manager::SourceManager::new(app_data_dir.clone()),
            ));
            {
                // `blocking_lock` is the sync-context entry point for
                // a tokio mutex. Setup runs before the async runtime
                // is fully active so we can't `lock().await` here.
                let mut mgr = source_manager.blocking_lock();
                if let Err(e) = mgr.load_sources() {
                    eprintln!("[gamelib] source_manager::load_sources failed: {}", e);
                }
            }
            app.manage(source_manager);

            let store_checker = Arc::new(Mutex::new(store_checker::StoreChecker::new()));
            app.manage(store_checker);

            // Spin the torrent engine up on the async runtime.
            // We use `spawn` (fire-and-forget) rather than
            // `block_on` so the `setup` closure returns
            // immediately and the app window can appear without
            // waiting for the torrent session to open + walk
            // existing torrents from disk. Init failures are
            // logged but don't block startup — the rest of the
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
