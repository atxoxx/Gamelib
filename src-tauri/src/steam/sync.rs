use reqwest::Client;
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use super::types::{SteamApiConfig, SteamGame, SteamSyncResult, SyncedGameEntry};
use crate::steam_game_watcher;

/// Sync games from Steam using a Web API key.
///
/// The user provides their API key (from https://steamcommunity.com/dev/apikey)
/// and Steam ID. The key is passed as a query parameter to Steam's Web API.
#[tauri::command]
pub async fn steam_sync_games(
    config: SteamApiConfig,
    include_playtime: bool,
    include_achievements: bool,
) -> Result<SteamSyncResult, String> {
    let client = Client::builder()
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let owned_games = fetch_owned_games(&client, &config).await?;

    // Detect which Steam games are installed on disk
    let installed_appids = detect_installed_steam_appids();
    let installed_set: HashSet<u32> = installed_appids.iter().copied().collect();

    let synced = owned_games.len() as u32;
    let mut playtime_updated: u32 = 0;
    let mut achievements_synced: u32 = 0;
    let mut synced_games: Vec<SyncedGameEntry> = Vec::new();

    for steam_game in &owned_games {
        if include_playtime && steam_game.playtime_forever > 0 {
            playtime_updated += 1;
        }
        if include_achievements && steam_game.has_community_visible_stats {
            achievements_synced += 1;
        }

        // Resolve the main game executable for installed games.
        // This lets the frontend launch the exe directly (reliable PID-based
        // metrics) instead of going through the fragile steam:// protocol
        // + WMI polling pipeline.
        let exe_path = if installed_set.contains(&steam_game.appid) {
            resolve_main_exe(steam_game.appid)
        } else {
            None
        };

        synced_games.push(SyncedGameEntry {
            appid: steam_game.appid,
            name: steam_game.name.clone(),
            playtime_forever: steam_game.playtime_forever,
            exe_path,
        });
    }

    Ok(SteamSyncResult {
        success: true,
        games_synced: synced,
        playtime_updated,
        achievements_synced,
        synced_games,
        installed_appids,
        error: None,
    })
}

/// Fetch owned games via Steam Web API key.
async fn fetch_owned_games(
    client: &Client,
    config: &SteamApiConfig,
) -> Result<Vec<SteamGame>, String> {
    let url = format!(
        "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key={}&steamid={}&include_appinfo=1&include_played_free_games=1&format=json",
        config.api_key, config.steam_id
    );

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch owned games: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Steam API returned HTTP {} — check your API key and Steam ID. {}",
            status, body
        ));
    }

    let json: Value = response.json().await.map_err(|e| format!("Failed to parse response: {}", e))?;

    let games = json["response"]["games"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|g| {
                    Some(SteamGame {
                        appid: g["appid"].as_u64()? as u32,
                        name: g["name"].as_str()?.to_string(),
                        playtime_forever: g["playtime_forever"].as_u64().unwrap_or(0) as u32,
                        playtime_windows_forever: g["playtime_windows_forever"].as_u64().unwrap_or(0) as u32,
                        has_community_visible_stats: g["has_community_visible_stats"].as_bool().unwrap_or(false),
                        rtime_last_played: g["rtime_last_played"].as_u64(),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(games)
}

/// Detect installed Steam games by scanning libraryfolders.vdf and
/// appmanifest_*.acf files. An appmanifest file is the authoritative
/// signal that a game is installed — no additional directory checks needed.
fn detect_installed_steam_appids() -> Vec<u32> {
    let library_folders = find_steam_library_folders();
    let mut installed = Vec::new();

    for folder in &library_folders {
        if let Ok(entries) = fs::read_dir(folder) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if name_str.starts_with("appmanifest_") && name_str.ends_with(".acf") {
                    // Extract the AppID: "appmanifest_12345.acf" → 12345
                    let id_str = &name_str["appmanifest_".len()..name_str.len() - ".acf".len()];
                    if let Ok(appid) = id_str.parse::<u32>() {
                        installed.push(appid);
                    }
                }
            }
        }
    }

    installed.sort();
    installed.dedup();
    installed
}

/// Find all Steam library folders by parsing libraryfolders.vdf.
fn find_steam_library_folders() -> Vec<PathBuf> {
    // Common Steam installation paths on Windows
    let candidate_paths = [
        PathBuf::from(r"C:\Program Files (x86)\Steam"),
        PathBuf::from(r"C:\Program Files\Steam"),
        PathBuf::from(r"D:\Steam"),
        PathBuf::from(r"E:\Steam"),
    ];

    let mut steam_root: Option<PathBuf> = None;
    for p in &candidate_paths {
        if p.join("steamapps").exists() {
            steam_root = Some(p.clone());
            break;
        }
    }

    let steam_root = match steam_root {
        Some(r) => r,
        None => return Vec::new(),
    };

    let mut folders = vec![steam_root.join("steamapps")];

    // Parse libraryfolders.vdf for additional library folders
    let vdf_path = steam_root.join("steamapps").join("libraryfolders.vdf");
    if let Ok(content) = fs::read_to_string(&vdf_path) {
        // VDF format: lines like "path" "D:\\SteamLibrary"
        // or newer format: "path" "D:\\SteamLibrary" inside numbered blocks
        for line in content.lines() {
            let trimmed = line.trim();
            if let Some(path_start) = trimmed.find("\"path\"") {
                // Extract the path value between the next pair of quotes
                let after_key = &trimmed[path_start + "\"path\"".len()..];
                if let Some(val_start) = after_key.find('"') {
                    let val = &after_key[val_start + 1..];
                    if let Some(val_end) = val.find('"') {
                        let path_str = &val[..val_end];
                        let lib_path = PathBuf::from(path_str.replace("\\\\", "\\"));
                        let steamapps = lib_path.join("steamapps");
                        if steamapps.exists() && !folders.contains(&steamapps) {
                            folders.push(steamapps);
                        }
                    }
                }
            }
        }
    }

    folders
}

/// Format minutes into a human-readable playtime string (e.g. "2h 30m").
#[allow(dead_code)]
pub fn format_playtime_minutes(minutes: u32) -> String {
    let hours = minutes / 60;
    let mins = minutes % 60;
    if hours > 0 {
        format!("{}h {}m", hours, mins)
    } else {
        format!("{}m", mins)
    }
}

/// Resolve the main game executable for a Steam AppID.
///
/// Uses `steam_game_watcher::game_install_path` to find the install
/// directory, then scans it for .exe files and picks the largest one
/// (by file size) that isn't a known utility/helper. This is the same
/// heuristic `scan_folder_for_exes` uses in `lib.rs`.
///
/// Exposed as a public function so `lib.rs` can also wrap it as a
/// standalone Tauri command for on-demand resolution.
pub fn resolve_main_exe(app_id: u32) -> Option<String> {
    let install_dir = steam_game_watcher::game_install_path(app_id)?;
    if !install_dir.exists() {
        return None;
    }
    scan_for_largest_exe(&install_dir)
}

/// Non-game executables to skip during scanning.
const SKIP_KEYWORDS: &[&str] = &[
    "redist", "autorun", "helper", "unin", "crash", "setup", "install",
    "plugin", "manual", "readme", "register", "7za", "dotnet", "vcredist",
    "dxsetup", "directx", "ue4prereq", "ue4-prereq",
    "launcher", // Steam games often have a tiny launcher.exe alongside the real game exe
];

/// Scan a directory recursively for .exe files and return the path of the
/// largest one that isn't a known utility. The largest exe in a game's
/// install dir is almost always the main game binary — launchers, helpers,
/// and redistributables are orders of magnitude smaller.
fn scan_for_largest_exe(dir: &Path) -> Option<String> {
    let mut best_path: Option<PathBuf> = None;
    let mut best_size: u64 = 0;
    scan_exe_dir(dir, &mut best_path, &mut best_size, 0);
    best_path.map(|p| p.to_string_lossy().to_string())
}

/// Recursive helper — walks at most 4 levels deep (Steam games rarely nest
/// deeper; avoids traversing enormous mod directories).
fn scan_exe_dir(dir: &Path, best: &mut Option<PathBuf>, best_size: &mut u64, depth: u32) {
    if depth > 4 {
        return;
    }
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                // Skip hidden dirs, underscored dirs, and common non-game subdirs
                if name.starts_with('.') || name.starts_with('_')
                    || name.eq_ignore_ascii_case("redist")
                    || name.eq_ignore_ascii_case("redistributables")
                    || name.eq_ignore_ascii_case("__installer")
                    || name.eq_ignore_ascii_case("support")
                {
                    continue;
                }
            }
            scan_exe_dir(&path, best, best_size, depth + 1);
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
                let size = meta.len();
                if size > *best_size {
                    *best_size = size;
                    *best = Some(path);
                }
            }
        }
    }
}
