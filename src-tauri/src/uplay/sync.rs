//! Ubisoft Connect sync orchestrator + client actions.
//!
//! Mirrors Playnite's `UplayLibrary.GetGames`:
//! 1. (optional) Scan installed games from the registry
//!    (`SOFTWARE\ubisoft\Launcher\Installs\`).
//! 2. (optional) Read the local product cache for the full owned
//!    library, dropping addons / third-party / ULC entries.
//! 3. Merge: installed games get their metadata (cover/icon/background)
//!    from the library scan; uninstalled library entries are appended.
//! 4. Emit a [`UplaySyncResult`] the frontend Settings tile renders +
//!    the library import path consumes.
//!
//! Client actions mirror `UplayClient` / `UplayGameController`:
//! `uplay://launch`, `uplay://install`, `uplay://uninstall`, and
//! opening the Ubisoft Connect client.

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use super::{
    cache, client_exec_path, client_install_path, is_client_installed,
};
use super::types::{UplaySettings, UplaySyncResult, UplaySyncedGame};
use crate::size;
use crate::uplay::settings::load as load_settings;

/// Public Tauri command — scans installed + owned Ubisoft Connect games
/// per the user's settings toggles and returns a typed result.
#[tauri::command]
pub async fn uplay_sync_library(app: AppHandle) -> Result<UplaySyncResult, String> {
    let settings = load_settings(&app);
    Ok(sync_library_inner(&settings))
}

/// Build the sync result from current on-disk state + the given
/// settings. Pure (no auth) so it's trivially testable.
pub fn sync_library_inner(settings: &UplaySettings) -> UplaySyncResult {
    let client_installed = is_client_installed();
    let client_path = client_install_path();

    let mut errors: Vec<String> = Vec::new();
    let mut synced: Vec<UplaySyncedGame> = Vec::new();
    let mut games_imported = 0usize;

    // ── Installed games (registry) ──
    let mut installed: Vec<UplayInstalledGameLite> = Vec::new();
    if settings.import_installed_games {
        let scanned = cache::scan_installed_uplay_games();
        for g in &scanned {
            if g.is_installed {
                games_imported += 1;
            } else {
                errors.push(format!(
                    "Ubisoft game {} installation directory {} not detected.",
                    g.name, g.install_dir
                ));
            }
            installed.push(UplayInstalledGameLite {
                uplay_id: g.uplay_id.clone(),
                name: g.name.clone(),
                install_dir: g.install_dir.clone(),
                is_installed: g.is_installed,
                cover_image: None,
                background_image: None,
                icon_image: None,
            });
        }
    }

    // ── Library games (cache) ──
    if settings.import_uninstalled_games {
        let products = cache::get_local_product_cache();
        for prod in &products {
            let Some(uplay_id) = prod.uplay_id else { continue };

            // Mirror Playnite's filters:
            // drop addons (DLC), third-party re-skins, ULC entries,
            // and anything without a `start_game` block.
            if !prod.root.addon_ids.is_empty() {
                continue;
            }
            if prod.root.third_party_platform {
                continue;
            }
            if prod.root.is_ulc {
                continue;
            }
            if !prod.root.has_start_game {
                continue;
            }

            let uplay_id_str = uplay_id.to_string();
            let name = prod
                .root
                .name
                .clone()
                .unwrap_or_else(|| format!("Ubisoft Game {uplay_id_str}"));

            // If already installed, enrich the installed entry. Else
            // append as an uninstalled library entry.
            if let Some(inst) = installed.iter_mut().find(|i| i.uplay_id == uplay_id_str) {
                inst.cover_image = prod.root.thumb_image.clone();
                inst.background_image = prod.root.background_image.clone();
                inst.icon_image = prod.root.icon_image.clone();
            } else {
                installed.push(UplayInstalledGameLite {
                    uplay_id: uplay_id_str,
                    name,
                    install_dir: String::new(),
                    is_installed: false,
                    cover_image: None,
                    background_image: None,
                    icon_image: None,
                });
            }
        }
    }

    // ── Materialize DTOs ──
    for g in &installed {
        let install_dir_opt = if g.install_dir.is_empty() {
            None
        } else {
            Some(std::path::Path::new(&g.install_dir))
        };
        let size_info = install_dir_opt.and_then(size::measure_folder_size);

        synced.push(UplaySyncedGame {
            id: format!("uplay-{}", g.uplay_id),
            title: g.name.clone(),
            uplay_id: g.uplay_id.clone(),
            is_installed: g.is_installed,
            install_dir: if g.install_dir.is_empty() {
                None
            } else {
                Some(g.install_dir.clone())
            },
            background_image: g.background_image.clone(),
            cover_image: g.cover_image.clone(),
            icon_image: g.icon_image.clone(),
            size_bytes: size_info.as_ref().map(|s| s.size_bytes),
            size_root_path: size_info.as_ref().map(|s| s.root_path.clone()),
        });
    }

    UplaySyncResult {
        success: true,
        games_imported,
        games_skipped: 0,
        errors,
        last_sync: current_unix(),
        client_installed,
        client_path,
        synced_games: synced,
    }
}

/// Lightweight merge accumulator used during sync.
struct UplayInstalledGameLite {
    uplay_id: String,
    name: String,
    install_dir: String,
    is_installed: bool,
    cover_image: Option<String>,
    background_image: Option<String>,
    icon_image: Option<String>,
}

/// Launch a specific Ubisoft Connect game via the `uplay://launch/<id>`
/// protocol. Returns the spawned PID (`0` when the protocol handler
/// (UbisoftConnect.exe) takes over). Mirrors Playnite's
/// `UplayPlayController.Play` → `Uplay.GetLaunchString`.
#[tauri::command]
pub async fn uplay_launch_game(
    app: AppHandle,
    uplay_id: String,
) -> Result<u32, String> {
    let url = format!("uplay://launch/{}", uplay_id);
    app.opener()
        .open_url(url, None::<&str>)
        .map(|_| 0u32)
        .map_err(|e| format!("Failed to launch Ubisoft game: {e}"))
}

/// Install a specific Ubisoft Connect game via the
/// `uplay://install/<id>` protocol. Mirrors Playnite's
/// `UplayInstallController.Install`.
#[tauri::command]
pub async fn uplay_install_game(
    app: AppHandle,
    uplay_id: String,
) -> Result<(), String> {
    let url = format!("uplay://install/{}", uplay_id);
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("Failed to start Ubisoft install: {e}"))
}

/// Uninstall a specific Ubisoft Connect game via the
/// `uplay://uninstall/<id>` protocol. Mirrors Playnite's
/// `UplayUninstallController.Uninstall`.
#[tauri::command]
pub async fn uplay_uninstall_game(
    app: AppHandle,
    uplay_id: String,
) -> Result<(), String> {
    let url = format!("uplay://uninstall/{}", uplay_id);
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("Failed to start Ubisoft uninstall: {e}"))
}

/// Open the Ubisoft Connect client itself.
#[tauri::command]
pub async fn uplay_open_client() -> Result<(), String> {
    if client_exec_path().is_empty() {
        return Err("Ubisoft Connect is not installed".to_string());
    }
    super::start_client();
    Ok(())
}

fn current_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
