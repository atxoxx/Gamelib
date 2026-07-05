use std::path::Path;
use std::process::Command;
use std::time::Instant;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

mod game_scraper;
mod gpu_detector;
mod metrics_collector;
mod rtss_reader;
mod mahm_reader;
mod deals;
use game_scraper::{GameMetadataResult, LaunchBoxImageResult, StoreGameSummary, TimeToBeat, SimilarGame, ReleaseDateInfo, IgdbReview, LanguageSupportInfo, ReviewFetchResult};
use gpu_detector::GpuInfo;
use metrics_collector::SessionMetrics;

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
    language_supports: Option<Vec<LanguageSupportInfo>>,
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

/// Search for game metadata across multiple online sources using Spider.
#[tauri::command]
async fn search_game_metadata(game_name: String) -> Vec<GameMetadataResult> {
    game_scraper::search_game_metadata(&game_name).await
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![scan_folder_for_exes, launch_game, save_games, load_games, read_cover_image, search_game_metadata, fetch_game_images, download_image, spider_extract, spider_fetch_page, search_launchbox_images, detect_gpus, save_screenshot, debug_mahm_entries, get_system_ram_gb, save_store_cache, load_store_cache, fetch_store_games, search_store_games, get_store_game_detail, fetch_game_reviews, fetch_external_reviews, save_wishlist, load_wishlist, deals::fetch_gamepass_catalog, deals::fetch_isthereanydeal_deals, deals::fetch_giveaways, deals::open_deal_url])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
