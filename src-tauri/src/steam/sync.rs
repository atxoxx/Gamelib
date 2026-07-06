use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use reqwest::Client;
use serde::Deserialize;

use super::types::{SteamSession, SteamSyncResult, SyncedGameEntry};
use crate::steam_game_watcher;

/// Response from `IPlayerService/GetOwnedGames/v1/`.
#[derive(Debug, Deserialize)]
struct GetOwnedGamesResponse {
    response: OwnedGamesBody,
}

#[derive(Debug, Deserialize)]
struct OwnedGamesBody {
    #[serde(default)]
    games: Vec<OwnedGame>,
}

#[derive(Debug, Deserialize)]
struct OwnedGame {
    appid: u32,
    name: String,
    /// Playtime in minutes (API returns minutes, not hours)
    playtime_forever: u32,
    #[serde(default)]
    rtime_last_played: u64,
}

/// Sync games from a Steam WebView session using the official Steam Web API.
///
/// `session.web_api_token` is passed as `access_token` to
/// `IPlayerService/GetOwnedGames/v1/` — the same approach Playnite's
/// `SteamStoreService` uses.  No API key needed.
///
/// The token is tied to the user's Steam session and may expire; if the
/// API call fails with 401/403, the user should re-login via
/// `steam_start_login`.
#[tauri::command]
pub async fn steam_sync_games(
    session: SteamSession,
    include_playtime: bool,
    #[allow(unused)] include_achievements: bool,
) -> Result<SteamSyncResult, String> {
    // Steam ID validation guard.
    if !session.steam_id.chars().all(|c| c.is_ascii_digit())
        || session.steam_id.len() != 17
    {
        return Err(format!(
            "Invalid Steam ID in session: {}",
            session.steam_id
        ));
    }

    // ── Call the Steam Web API ─────────────────────────────────────
    let client = Client::builder()
        .user_agent(super::auth::USER_AGENT)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let url = format!(
        "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/\
         ?access_token={}&steamid={}&include_appinfo=true\
         &include_played_free_games=true&format=json",
        session.web_api_token, session.steam_id
    );

    // Retry on 429 (rate limit) — Steam API is notorious for returning
    // 429 even after long idle periods.  Playnite retries up to 5 times.
    let mut retries = 3u32;
    let (status, body) = loop {
        let response = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Steam API request failed: {e}"))?;

        let s = response.status();
        if s.as_u16() == 429 && retries > 0 {
            retries -= 1;
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            continue;
        }

        let b = response
            .text()
            .await
            .unwrap_or_else(|_| "<empty>".to_string());

        break (s, b);
    };

    if !status.is_success() {
        return Err(format!(
            "Steam API returned HTTP {}: {}",
            status.as_u16(),
            &body[..body.len().min(500)]
        ));
    }

    let parsed: GetOwnedGamesResponse = serde_json::from_str(&body)
        .map_err(|e| {
            format!(
                "Failed to parse Steam API response (HTTP {}): {e}",
                status.as_u16()
            )
        })?;

    let owned_games = parsed.response.games;

    // ── Detect installed games on disk ──────────────────────────────
    let installed_appids = detect_installed_steam_appids();
    let installed_set: HashSet<u32> = installed_appids.iter().copied().collect();

    let synced = owned_games.len() as u32;
    let mut playtime_updated: u32 = 0;
    let mut synced_games: Vec<SyncedGameEntry> = Vec::new();

    for game in &owned_games {
        if include_playtime && game.playtime_forever > 0 {
            playtime_updated += 1;
        }

        let exe_path = if installed_set.contains(&game.appid) {
            resolve_main_exe(game.appid)
        } else {
            None
        };

        synced_games.push(SyncedGameEntry {
            appid: game.appid,
            name: game.name.clone(),
            playtime_forever: game.playtime_forever,
            exe_path,
        });
    }

    Ok(SteamSyncResult {
        success: true,
        games_synced: synced,
        playtime_updated,
        achievements_synced: 0,
        synced_games,
        installed_appids,
        error: None,
    })
}

// ── installed-game detection ────────────────────────────────────────

fn detect_installed_steam_appids() -> Vec<u32> {
    let library_folders = find_steam_library_folders();
    let mut installed = Vec::new();

    for folder in &library_folders {
        if let Ok(entries) = fs::read_dir(folder) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if name_str.starts_with("appmanifest_") && name_str.ends_with(".acf") {
                    let id_str =
                        &name_str["appmanifest_".len()..name_str.len() - ".acf".len()];
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

fn find_steam_library_folders() -> Vec<PathBuf> {
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

    let vdf_path = steam_root.join("steamapps").join("libraryfolders.vdf");
    if let Ok(content) = fs::read_to_string(&vdf_path) {
        for line in content.lines() {
            let trimmed = line.trim();
            if let Some(path_start) = trimmed.find("\"path\"") {
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

/// Resolve the main game executable for a Steam AppID.
pub fn resolve_main_exe(app_id: u32) -> Option<String> {
    let install_dir = steam_game_watcher::game_install_path(app_id)?;
    if !install_dir.exists() {
        return None;
    }
    scan_for_largest_exe(&install_dir)
}

const SKIP_KEYWORDS: &[&str] = &[
    "redist", "autorun", "helper", "unin", "crash", "setup", "install",
    "plugin", "manual", "readme", "register", "7za", "dotnet", "vcredist",
    "dxsetup", "directx", "ue4prereq", "ue4-prereq", "launcher",
];

fn scan_for_largest_exe(dir: &Path) -> Option<String> {
    let mut best_path: Option<PathBuf> = None;
    let mut best_size: u64 = 0;
    scan_exe_dir(dir, &mut best_path, &mut best_size, 0);
    best_path.map(|p| p.to_string_lossy().to_string())
}

fn scan_exe_dir(
    dir: &Path,
    best: &mut Option<PathBuf>,
    best_size: &mut u64,
    depth: u32,
) {
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
                if name.starts_with('.')
                    || name.starts_with('_')
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
