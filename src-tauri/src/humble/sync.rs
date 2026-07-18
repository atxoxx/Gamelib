//! Humble library sync — pure-Rust orchestrator (cookie-auth + WebView
//! login). Mirrors `HumbleLibrary.ImportGames`:
//!
//! 1. Load persisted settings; short-circuit when `connectAccount` is off.
//! 2. Build a `HumbleClient` from the captured cookies.
//! 3. Fetch game keys + orders in parallel-ish, then page the Trove
//!    catalog when `importTroveGames` is on.
//! 4. Apply the third-party-store game filter (Playnite parity).
//! 5. Optionally expand non-game extras into their own entries.
//! 6. Scan the Humble App config for installed games and merge.
//! 7. Measure install-dir size when installed.

use std::collections::{HashMap, HashSet};

use tauri::AppHandle;

use super::auth::load_cookies;
use super::client::HumbleClient;
use super::installed::scan_installed_humble_games;
use super::settings::load as load_settings;
use super::types::{
    HumbleOrder, HumbleSettings, HumbleSubProduct, HumbleSyncResult, HumbleSyncedGame,
    HumbleTroveGame,
};
use crate::size;

/// Public Tauri command — orchestrates the full sync and returns the
/// typed result. Pure-Rust; the WebView is only used at login time.
#[tauri::command]
pub async fn humble_sync_library(app: AppHandle) -> Result<HumbleSyncResult, String> {
    let settings = load_settings(&app);
    if !settings.connect_account {
        return Ok(HumbleSyncResult {
            success: true,
            games_imported: 0,
            games_skipped: 0,
            errors: vec!["Humble account connection is disabled in settings".to_string()],
            last_sync: current_unix(),
            synced_games: Vec::new(),
        });
    }

    if load_cookies(&app).is_none() {
        return Err("Not authenticated with Humble — connect your account first".to_string());
    }

    let client = HumbleClient::from_app(&app)?;

    let mut errors: Vec<String> = Vec::new();

    // 1. Game keys + orders.
    let gamekeys = match client.get_gamekeys().await {
        Ok(keys) => keys,
        Err(e) => return Err(e),
    };
    let orders = match client.get_orders(&gamekeys).await {
        Ok(o) => o,
        Err(e) => return Err(e),
    };

    // 2. Trove catalog (subscriber library).
    let trove: Vec<HumbleTroveGame> = if settings.import_trove_games {
        match client.get_trove_games().await {
            Ok(t) => t,
            Err(e) => {
                errors.push(format!("Trove catalog fetch failed: {e}"));
                Vec::new()
            }
        }
    } else {
        Vec::new()
    };

    // 3. Installed scan (Humble App config).
    let installed = scan_installed_humble_games();
    let installed_by_id: HashMap<&str, &super::types::HumbleInstalledGame> =
        installed.iter().map(|i| (i.game_id.as_str(), i)).collect();

    // 4. Build the synced-game list.
    let mut synced: Vec<HumbleSyncedGame> = Vec::new();

    if settings.import_general_library {
        let selected = select_library_subproducts(&orders, &settings);
        for product in selected {
            let game_id = format!("{}_{}", product.machine_name, product.human_name);
            let inst = installed_by_id.get(product.machine_name.as_str()).copied();
            let (is_installed, install_dir, install_path) = match inst {
                Some(i) => (true, Some(i.install_dir.clone()), Some(i.executable.clone())),
                None => (false, None, None),
            };
            let size_info = install_dir
                .as_deref()
                .map(std::path::Path::new)
                .and_then(size::measure_folder_size);
            synced.push(HumbleSyncedGame {
                id: format!("humble-{}", slug(&game_id)),
                title: strip_trademarks(&product.human_name),
                humble_game_id: game_id,
                is_trove: false,
                is_installed,
                install_path,
                install_dir,
                cover_url: product.icon.clone(),
                size_bytes: size_info.as_ref().map(|s| s.size_bytes),
                size_root_path: size_info.as_ref().map(|s| s.root_path.clone()),
                is_extra: false,
            });

            // 5. Extras (soundtracks / artbooks / asm.js / …).
            if settings.import_game_extras {
                for extra in collect_extras(&orders, &product) {
                    synced.push(extra);
                }
            }
        }
    }

    // 6. Trove games.
    for trove_game in &trove {
        let inst = installed_by_id.get(trove_game.machine_name.as_str()).copied();
        let (is_installed, install_dir, install_path) = match inst {
            Some(i) => (true, Some(i.install_dir.clone()), Some(i.executable.clone())),
            None => (false, None, None),
        };
        let size_info = install_dir
            .as_deref()
            .map(std::path::Path::new)
            .and_then(size::measure_folder_size);
        synced.push(HumbleSyncedGame {
            id: format!("humble-{}", slug(&trove_game.machine_name)),
            title: strip_trademarks(&trove_game.human_name),
            humble_game_id: trove_game.machine_name.clone(),
            is_trove: true,
            is_installed,
            install_path,
            install_dir,
            cover_url: None,
            size_bytes: size_info.as_ref().map(|s| s.size_bytes),
            size_root_path: size_info.as_ref().map(|s| s.root_path.clone()),
            is_extra: false,
        });
    }

    if trove.is_empty() && settings.import_trove_games {
        errors.push(
            "Trove returned no games — your account may not have an active Trove subscription"
                .to_string(),
        );
    }

    let games_imported = synced.len();
    Ok(HumbleSyncResult {
        success: true,
        games_imported,
        games_skipped: 0,
        errors,
        last_sync: current_unix(),
        synced_games: synced,
    })
}

/// Apply Playnite's third-party-store-game filter to the owned
/// subproducts. Keeps a product when it has a `windows` download and,
/// when `ignoreThirdPartyStoreGames` is on, is NOT a third-party key
/// (unless `importThirdPartyDrmFree` allows the drm-free collision).
fn select_library_subproducts(
    orders: &[HumbleOrder],
    settings: &HumbleSettings,
) -> Vec<HumbleSubProduct> {
    let mut selected: Vec<HumbleSubProduct> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    let all_tpks: Vec<String> = orders
        .iter()
        .filter_map(|o| o.tpkd_dict.as_ref())
        .flat_map(|d| d.all_tpks.iter().map(|t| t.human_name.clone()))
        .collect();

    for order in orders {
        if order.subproducts.is_empty() {
            continue;
        }
        for product in &order.subproducts {
            if product.human_name.is_empty() {
                continue;
            }
            if seen.contains(&product.human_name) {
                continue;
            }
            let has_windows = product
                .downloads
                .iter()
                .any(|d| d.platform.eq_ignore_ascii_case("windows"));
            if !has_windows {
                continue;
            }
            if settings.ignore_third_party_store_games {
                let is_tpk = all_tpks.iter().any(|tpk| {
                    tpk.eq_ignore_ascii_case(&product.human_name)
                        || regex_steam_collision(tpk, &product.human_name)
                });
                if is_tpk && !settings.import_third_party_drm_free {
                    continue;
                }
            }
            seen.insert(product.human_name.clone());
            selected.push(product.clone());
        }
    }
    selected
}

/// Mirrors Playnite's regex TPK-collision checks:
/// `<name> Key$`, `<name> (Steam)$`, `<name> *$`.
fn regex_steam_collision(tpk: &str, human_name: &str) -> bool {
    let tpk_l = tpk.to_ascii_lowercase();
    let hn_l = human_name.to_ascii_lowercase();
    if tpk_l == hn_l {
        return true;
    }
    if tpk_l.starts_with(&format!("{hn_l} ")) {
        return true;
    }
    if tpk_l.contains("key") && tpk_l.trim_end_matches(char::is_whitespace).ends_with("key") {
        return tpk_l.starts_with(&hn_l);
    }
    false
}

/// Expand a subproduct's non-game downloads into separate synced-game
/// extras (mirrors `HumbleLibrary.GetLibraryExtras`). We keep the
/// simple, broadly-useful extras: anything that isn't a windows/mac/linux
/// installer (soundtracks, artbooks, asm.js) and the named
/// `download_struct` entries.
fn collect_extras(
    orders: &[HumbleOrder],
    product: &HumbleSubProduct,
) -> Vec<HumbleSyncedGame> {
    let mut extras: Vec<HumbleSyncedGame> = Vec::new();
    for order in orders {
        if order.subproducts.is_empty() {
            continue;
        }
        let matches = order
            .subproducts
            .iter()
            .any(|p| p.machine_name == product.machine_name && p.human_name == product.human_name);
        if !matches {
            continue;
        }
        for download in &order
            .subproducts
            .iter()
            .find(|p| p.machine_name == product.machine_name)
            .map(|p| p.downloads.clone())
            .unwrap_or_default()
        {
            let platform = download.platform.to_ascii_lowercase();
            if platform == "windows" || platform == "mac" || platform == "linux" {
                continue;
            }
            let base_id = format!(
                "humble_extras_{}_{}_{}",
                order.product.machine_name, product.machine_name, download.machine_name
            );
            if platform == "asmjs" {
                extras.push(HumbleSyncedGame {
                    id: format!("humble-{}", slug(&base_id)),
                    title: format!(
                        "{} asm.js version ({})",
                        strip_trademarks(&product.human_name),
                        order.product.human_name
                    ),
                    humble_game_id: base_id,
                    is_trove: false,
                    is_installed: false,
                    install_path: None,
                    install_dir: None,
                    cover_url: product.icon.clone(),
                    size_bytes: None,
                    size_root_path: None,
                    is_extra: true,
                });
                continue;
            }
            for ds in &download.download_struct {
                let extra_id = format!("{}_{}", base_id, ds.name);
                extras.push(HumbleSyncedGame {
                    id: format!("humble-{}", slug(&extra_id)),
                    title: format!(
                        "{} {} {} ({})",
                        strip_trademarks(&product.human_name),
                        download.platform,
                        ds.name,
                        order.product.human_name
                    ),
                    humble_game_id: extra_id,
                    is_trove: false,
                    is_installed: false,
                    install_path: None,
                    install_dir: None,
                    cover_url: product.icon.clone(),
                    size_bytes: ds.file_size,
                    size_root_path: None,
                    is_extra: true,
                });
            }
        }
    }
    extras
}

// ── Helpers ─────────────────────────────────────────────────────────

fn strip_trademarks(name: &str) -> String {
    name.replace('™', "").replace('®', "").replace('©', "").trim().to_string()
}

/// Build a URL/path-safe slug for `id` generation.
fn slug(s: &str) -> String {
    s.to_ascii_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn current_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
