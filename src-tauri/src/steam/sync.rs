use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

use reqwest::Client;
use serde::Deserialize;

use super::types::{SteamSession, SteamSyncResult, SyncedGameEntry};
use crate::game_watcher;
use crate::size;
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

/// Sync games from a Steam account using the official Steam Web API.
///
/// `session.api_key` is passed as the `key=` query parameter on
/// `IPlayerService/GetOwnedGames/v1/`. The API key is a long-lived
/// registration token from <https://steamcommunity.com/dev/apikey>,
/// tied to the Steam account but valid for all Steam Web API calls
/// that the API-key owner can access (their own profile, owned
/// games, achievements, etc.).
///
/// Achievements (`ISteamUserStats/GetPlayerAchievements/v1/`) also
/// accepts `key=` — `fetch_achievements_with_client` builds its URLs
/// with `&key=<token>` already, so we pass `session.api_key` through
/// unchanged.
#[tauri::command]
pub async fn steam_sync_games(
    app: tauri::AppHandle,
    session: SteamSession,
    include_playtime: bool,
    include_achievements: bool,
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
         ?key={}&steamid={}&include_appinfo=true\
         &include_played_free_games=true&format=json",
        session.api_key, session.steam_id
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

    // ── Disk work (exe resolution + folder size) ─────────────────────
    // These are blocking filesystem walks. Running them sequentially for
    // every installed game is the dominant cost of a sync on large
    // libraries, so we fan them out across a bounded pool of blocking
    // tasks (cap ~8 concurrent) and map the results back by appid.
    let disk_sem = std::sync::Arc::new(tokio::sync::Semaphore::new(8));
    let mut disk_handles: Vec<
        tokio::task::JoinHandle<(u32, Option<String>, Option<u64>, Option<String>)>,
    > = Vec::new();
    for game in &owned_games {
        if !installed_set.contains(&game.appid) {
            continue;
        }
        let appid = game.appid;
        let name = game.name.clone();
        let permit = disk_sem
            .clone()
            .acquire_owned()
            .await
            .map_err(|e| format!("disk semaphore: {e}"))?;
        let handle = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            // Resolve the install dir from the Steam appmanifest (canonical,
            // NOT derived from the exe's parent — that would under-count
            // UE/Unity/Source games where the largest .exe lives in a bin
            // subfolder). exe_path is then derived from the install dir
            // via `game_watcher::resolve_steam_game_exe` (PE header +
            // name scoring + depth), and the size is measured on the
            // install dir directly.
            let install_dir = steam_game_watcher::game_install_path(appid);
            // Use the smart resolver (PE header + name scoring + depth)
            // instead of the old "largest exe" heuristic.
            let exe_path = if install_dir.is_some() {
                game_watcher::resolve_steam_game_exe(appid, &name)
            } else {
                None
            };
            // Measure the install dir if we have one. Per-game failure
            // (folder gone, permission denied) just leaves the size
            // fields None; the sync itself is never aborted.
            let size_info = install_dir.as_deref().and_then(size::measure_folder_size);
            (
                appid,
                exe_path,
                size_info.as_ref().map(|s| s.size_bytes),
                size_info.as_ref().map(|s| s.root_path.clone()),
            )
        });
        disk_handles.push(handle);
    }

    let mut disk_map: std::collections::HashMap<u32, (Option<String>, Option<u64>, Option<String>)> =
        std::collections::HashMap::new();
    for h in disk_handles {
        if let Ok(res) = h.await {
            disk_map.insert(res.0, (res.1, res.2, res.3));
        }
    }

    // ── Build the synced game list ───────────────────────────────────
    let mut synced_games: Vec<SyncedGameEntry> = Vec::with_capacity(owned_games.len());
    for game in &owned_games {
        if include_playtime && game.playtime_forever > 0 {
            playtime_updated += 1;
        }
        let (exe_path, size_bytes, size_root_path) = disk_map
            .get(&game.appid)
            .map(|(e, b, r)| (e.clone(), *b, r.clone()))
            .unwrap_or((None, None, None));
        synced_games.push(SyncedGameEntry {
            appid: game.appid,
            name: game.name.clone(),
            playtime_forever: game.playtime_forever,
            exe_path,
            size_bytes,
            size_root_path,
            rtime_last_played: if game.rtime_last_played > 0 {
                Some(game.rtime_last_played)
            } else {
                None
            },
        });
    }

    // ── Sync achievements if requested ──────────────────────────────
    let mut achievements_synced: u32 = 0;
    if include_achievements {
        if let Ok(mut cache) = crate::achievements::load_cache_internal(&app) {
            // Decide which games actually need a (re)fetch, then run those
            // fetches concurrently (bounded to ~8 in flight) instead of
            // one-at-a-time with a 150ms sleep between each. Overlapping the
            // network latency gives a large speed-up on big libraries while
            // staying gentle enough not to trip Steam's rate limits.
            let mut to_fetch: Vec<(String, u32)> = Vec::new();
            for game in &owned_games {
                let game_key = format!("steam-{}", game.appid);
                let needs_sync = match cache.games.get(&game_key) {
                    None => true, // Not in cache
                    Some(entry) => {
                        let is_installed = installed_set.contains(&game.appid);
                        if is_installed {
                            true
                        } else if game.playtime_forever > 0 {
                            match entry.last_synced {
                                None => true,
                                Some(last_synced_ms) => {
                                    let last_played_ms = game.rtime_last_played * 1000;
                                    last_played_ms > last_synced_ms
                                }
                            }
                        } else {
                            false
                        }
                    }
                };
                if needs_sync {
                    to_fetch.push((game_key, game.appid));
                }
            }

            if !to_fetch.is_empty() {
                let ach_sem = std::sync::Arc::new(tokio::sync::Semaphore::new(8));
                let mut handles = Vec::with_capacity(to_fetch.len());
                for (game_key, appid) in to_fetch {
                    let permit = ach_sem
                        .clone()
                        .acquire_owned()
                        .await
                        .map_err(|e| format!("achievement semaphore: {e}"))?;
                    let client = client.clone();
                    let steam_id = session.steam_id.clone();
                    let api_key = session.api_key.clone();
                    let handle = tokio::spawn(async move {
                        let _permit = permit;
                        let res = crate::achievements::fetch_achievements_with_client(
                            &client,
                            appid,
                            &steam_id,
                            &api_key,
                        )
                        .await;
                        (game_key, res)
                    });
                    handles.push(handle);
                }

                for h in handles {
                    match h.await {
                        Ok((game_key, Ok(mut data))) => {
                            let now_ms = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_millis() as u64;
                            data.last_synced = Some(now_ms);
                            cache.games.insert(game_key, data);
                            achievements_synced += 1;
                        }
                        Ok((game_key, Err(e))) => {
                            eprintln!(
                                "[steam_sync] Failed to fetch achievements for {}: {}",
                                game_key, e
                            );
                        }
                        Err(e) => {
                            eprintln!("[steam_sync] achievement task panicked: {}", e);
                        }
                    }
                }

                if achievements_synced > 0 {
                    if let Err(e) = crate::achievements::save_cache_internal(&app, &cache) {
                        eprintln!("[steam_sync] Failed to save achievements cache: {}", e);
                    }
                }
            }
        }
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


