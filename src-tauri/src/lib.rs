use std::path::Path;
use std::process::Command;
use std::sync::Arc;
use std::time::Instant;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;

mod config;
mod crackwatch;
mod game_scraper;
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
use game_scraper::{GameMetadataResult, LaunchBoxImageResult, StoreGameSummary, TimeToBeat, SimilarGame, ReleaseDateInfo, IgdbReview, LanguageSupportInfo, ReviewFetchResult};
use gpu_detector::GpuInfo;
use metrics_collector::SessionMetrics;
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

/// Payload emitted via the "game-exited" event when a launched process terminates.
/// Now includes real hardware metrics collected during gameplay.
#[derive(Clone, Serialize)]
struct GameExitPayload {
    #[serde(rename = "gameId")]
    game_id: String,
    #[serde(rename = "elapsedSeconds")]
    elapsed_seconds: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    metrics: Option<SessionMetrics>,
}

/// Detect GPUs on the system using WMI.
#[tauri::command]
fn detect_gpus() -> Vec<GpuInfo> {
    gpu_detector::detect_gpus()
}

/// Launch a game executable. A background thread waits for the process to exit,
/// collects real-time performance metrics via WMI, and emits a "game-exited"
/// event with aggregated metrics so the frontend can update play time and activity.
#[tauri::command]
fn launch_game(
    app: tauri::AppHandle,
    game_id: String,
    game_path: String,
    gpu_id: Option<String>,
    gpu_name: Option<String>,
) -> Result<String, String> {
    let path = Path::new(&game_path);

    if !path.exists() {
        return Err(format!("Game executable not found: {}", game_path));
    }

    let cwd = path
        .parent()
        .unwrap_or_else(|| Path::new("."));

    let child = Command::new(path)
        .current_dir(cwd)
        .spawn()
        .map_err(|e| format!("Failed to launch game: {}", e))?;

    let pid = child.id();
    let start = Instant::now();

    // Start metrics collection on a separate thread (polls every 5 seconds).
    // Pass the PID so RTSS can be used for real FPS data when available.
    let (stop_tx, result_rx) = metrics_collector::start_metrics_collection(5, pid, gpu_id, gpu_name);

    // Background thread: wait for the game to exit, stop metrics, report results
    std::thread::spawn(move || {
        let mut child = child;
        let _ = child.wait();

        // Signal the metrics collector to stop
        let _ = stop_tx.send(());

        let elapsed = start.elapsed().as_secs();

        // Collect the aggregated metrics (with a timeout)
        let metrics = result_rx.recv_timeout(std::time::Duration::from_secs(10)).unwrap_or(None);

        let _ = app.emit(
            "game-exited",
            GameExitPayload {
                game_id,
                elapsed_seconds: elapsed,
                metrics,
            },
        );
    });

    Ok(format!("Launched: {}", game_path))
}

/// Watch a Steam-launched game for its actual lifetime.
///
/// `openUrl("steam://run/<appid>")` returns as soon as Steam dispatches
/// the protocol — there's no child handle, no PID, no waitable
/// notification. This command reattaches the same monitoring pipeline
/// that `launch_game` uses for local executables:
///
/// 1. Resolve the game's install dir via `libraryfolders.vdf` +
///    `appmanifest_<appid>.acf` (see `steam_game_watcher`).
/// 2. Phase 1: poll `Win32_Process` every 2 s for up to 60 s, waiting
///    for the game's executable to spawn. If it never appears
///    (Steam launch failed, user cancelled, etc.) we emit a fallback
///    `game-exited` so the frontend updates playTime / activity
///    consistently with how Local games behave on a no-op launch.
/// 3. Phase 2: poll every 5 s waiting for the process to disappear.
///    When it does, stop metrics and emit `game-exited` with real
///    elapsed seconds + aggregated SessionMetrics — same payload
///    shape as `launch_game`, so both listeners (GameContext and
///    ActivityContext) react without code changes.
///
/// `game_pid` is recomputed on every poll: we hand RTSS the dominant
/// (highest-memory) PID matching the install dir so FPS hooks line up
/// with the actual game render thread once it's running.
#[tauri::command]
fn watch_steam_game(
    app: tauri::AppHandle,
    game_id: String,
    steam_app_id: u32,
    gpu_id: Option<String>,
    gpu_name: Option<String>,
) -> Result<(), String> {
    let install_dir = steam_game_watcher::game_install_path(steam_app_id).ok_or_else(|| {
        format!(
            "Steam app manifest not found for appid {} — is the game installed locally?",
            steam_app_id
        )
    })?;

    let start = Instant::now();
    let app_handle_for_thread = app.clone();
    let install_path = install_dir.clone();

    std::thread::spawn(move || {
        // Phase 1 — wait for the game process to appear (≤ 60 s).
        //
        // Steam's protocol handler hands off to steam.exe, which then
        // launches the game; 60 s comfortably covers installations on
        // slow disks or games that show a splash first.
        const STARTUP_GRACE_SECS: u64 = 60;
        const STARTUP_POLL_SECS: u64 = 2;
        let mut elapsed_secs: u64 = 0;
        let mut saw_process = false;
        let mut last_pid: Option<u32> = None;

        while elapsed_secs < STARTUP_GRACE_SECS {
            let matched = steam_game_watcher::is_game_process_running(&install_path);
            if matched.running {
                saw_process = true;
                last_pid = matched.dominant_pid;
                break;
            }
            std::thread::sleep(std::time::Duration::from_secs(STARTUP_POLL_SECS));
            elapsed_secs += STARTUP_POLL_SECS;
        }

        // If the game process never spawned, exit with a short fallback
        // session (≥ 60 s raw → still filtered by ActivityContext since
        // `durationMin = Math.round(60/60) = 1`, but provides a real
        // playTime delta of 1 minute on the Game record). We deliberately
        // avoid hardcoding 300 s here like the previous hack — the
        // recorded time should reflect what actually happened.
        if !saw_process {
            let elapsed = start.elapsed().as_secs();
            let _ = app_handle_for_thread.emit(
                "game-exited",
                GameExitPayload {
                    game_id,
                    elapsed_seconds: elapsed,
                    metrics: None,
                },
            );
            return;
        }

        // Start metrics collection once the game is up, using the
        // dominant PID we discovered — matches what `launch_game` does
        // and lets RTSS read FPS for the actual game process.
        let pid = last_pid.unwrap_or(0);
        let (stop_tx, result_rx) = metrics_collector::start_metrics_collection(
            5, pid, gpu_id, gpu_name,
        );

        // Phase 2 — wait for the game to exit.
        //
        // Poll every 5 s (matches the metrics interval so each poll =
        // one new sample). No max time bound — some users idle games
        // for days and we don't want to silently cut activity off.
        // (The `metrics_collector` captures the PID once at start, so
        //  RTSS FPS hooks stick to the original process even if an
        //  anti-cheat layer relaunches the EXE — acceptable since
        //  RTSS survives across the same Steam big-picture session.)
        loop {
            std::thread::sleep(std::time::Duration::from_secs(5));
            let matched = steam_game_watcher::is_game_process_running(&install_path);
            if !matched.running {
                break;
            }
        }

        let _ = stop_tx.send(());
        let elapsed = start.elapsed().as_secs();
        let metrics = match result_rx.recv_timeout(std::time::Duration::from_secs(10)) {
            Ok(m) => {
                if m.is_none() {
                    eprintln!(
                        "[watch_steam_game] metrics thread returned None for game {} (appid={}, elapsed={}s)",
                        game_id, steam_app_id, elapsed
                    );
                }
                m
            }
            Err(_) => {
                eprintln!(
                    "[watch_steam_game] timeout (10s) waiting for metrics thread for game {} (appid={}, elapsed={}s)",
                    game_id, steam_app_id, elapsed
                );
                None
            }
        };

        let _ = app_handle_for_thread.emit(
            "game-exited",
            GameExitPayload {
                game_id,
                elapsed_seconds: elapsed,
                metrics,
            },
        );
    });

    Ok(())
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
///
/// Uses the appmanifest to find the install directory, then scans for the
/// largest non-utility .exe file. Returns `None` if the game isn't installed
/// locally or no suitable executable is found.
///
/// Callable on-demand from the frontend (e.g., GamePage "Detect EXE" button)
/// in addition to the bulk resolution that happens during `steam_sync_games`.
#[tauri::command]
fn resolve_steam_exe(steam_app_id: u32) -> Option<String> {
    steam::sync::resolve_main_exe(steam_app_id)
}

/// Spawn a game executable and return immediately (fire-and-forget).
///
/// Unlike `launch_game`, this does NOT wait for the child process or
/// collect metrics — it simply starts the process and returns its PID.
/// Designed for Steam games where `watch_steam_game` handles the full
/// lifecycle via WMI polling (process detection → metrics → exit).
///
/// `std::process::Child` does not kill on drop, so the spawned process
/// outlives this function regardless of whether the handle is stored.
#[tauri::command]
fn spawn_game_exe(game_path: String) -> Result<u32, String> {
    let path = Path::new(&game_path);
    if !path.exists() {
        return Err(format!("Game executable not found: {}", game_path));
    }
    let cwd = path.parent().unwrap_or_else(|| Path::new("."));
    let child = Command::new(path)
        .current_dir(cwd)
        .spawn()
        .map_err(|e| format!("Failed to launch game: {}", e))?;
    let pid = child.id();
    // Fire-and-forget: the child lives independently. Rust's Child
    // does NOT kill on drop (unlike e.g. Python's Popen), so we can
    // safely discard the handle here.
    Ok(pid)
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
        .invoke_handler(tauri::generate_handler![scan_folder_for_exes, launch_game, spawn_game_exe, watch_steam_game, save_games, load_games, read_cover_image, search_game_metadata, fetch_game_images, download_image, spider_extract, spider_fetch_page, search_launchbox_images, detect_gpus, save_screenshot, debug_mahm_entries, get_system_ram_gb, resolve_steam_exe, detect_game_size, check_paths_exist, save_store_cache, load_store_cache, fetch_store_games, search_store_games, get_store_game_detail, fetch_game_reviews, fetch_external_reviews, save_wishlist, load_wishlist, deals::fetch_gamepass_catalog, deals::fetch_isthereanydeal_deals, deals::fetch_giveaways, deals::open_deal_url, steam_save_config, steam_load_config, steam_clear_config, steam_sync_games,
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
            crackwatch::fetch_crackwatch_status,
            fetch_url])
        .setup(|app| {
            // Load .env file for development (production builds have
            // credentials baked in at compile time via option_env!()).
            config::load_env_file();

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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
