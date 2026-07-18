//! Rockstar sync orchestrator — pure-Rust, no auth (installed-only).
//!
//! Mirrors Playnite's `RockstarGamesLibrary.GetGames`:
//! 1. Scan installed Rockstar titles from the uninstall registry.
//! 2. Measure each install dir's on-disk size (when present).
//! 3. Emit a [`RockstarSyncResult`] the frontend Settings tile
//!    renders + the library import path consumes.

use tauri::AppHandle;

use super::{
    client_exec_path, client_install_path, is_client_installed, scan_installed_rockstar_games,
    RockstarSyncResult, RockstarSyncedGame,
};
use crate::size;

/// Public Tauri command — scans installed Rockstar games and returns
/// the typed result. No network, no account; safe to call whether
/// or not the Rockstar Games Launcher is installed.
#[tauri::command]
pub async fn rockstar_sync_library(_app: AppHandle) -> Result<RockstarSyncResult, String> {
    let client_installed = is_client_installed();
    let client_path = client_install_path();

    let installed = scan_installed_rockstar_games();
    let mut errors: Vec<String> = Vec::new();
    let mut synced: Vec<RockstarSyncedGame> = Vec::with_capacity(installed.len());
    let mut games_imported = 0usize;

    for g in &installed {
        let install_dir_opt = if g.install_dir.is_empty() {
            None
        } else {
            Some(std::path::Path::new(&g.install_dir))
        };
        let size_info = install_dir_opt.and_then(size::measure_folder_size);

        if g.is_installed {
            games_imported += 1;
        } else {
            errors.push(format!(
                "Rockstar game {} installation directory {} not detected.",
                g.name, g.install_dir
            ));
        }

        synced.push(RockstarSyncedGame {
            id: format!("rockstar-{}", g.title_id),
            title: g.name.clone(),
            title_id: g.title_id.clone(),
            is_installed: g.is_installed,
            install_path: if g.path.is_empty() {
                None
            } else {
                Some(g.path.clone())
            },
            install_dir: if g.install_dir.is_empty() {
                None
            } else {
                Some(g.install_dir.clone())
            },
            icon_path: g.icon_path.clone(),
            size_bytes: size_info.as_ref().map(|s| s.size_bytes),
            size_root_path: size_info.as_ref().map(|s| s.root_path.clone()),
        });
    }

    Ok(RockstarSyncResult {
        success: true,
        games_imported,
        games_skipped: 0,
        errors,
        last_sync: current_unix(),
        client_installed,
        client_path,
        synced_games: synced,
    })
}

/// Launch a specific installed Rockstar title via the launcher.
///
/// Returns the spawned PID (`0` when the launcher handles it without
/// a directly-tracked child, e.g. when only the Social Club helper
/// shows up). Mirrors Playnite's `RockstarPlayController.Play`.
#[tauri::command]
pub async fn rockstar_launch_game(title_id: String) -> Result<u32, String> {
    super::launch_title(&title_id)
}

/// Start (open) the Rockstar Games Launcher client itself.
#[tauri::command]
pub async fn rockstar_open_client() -> Result<(), String> {
    if client_exec_path().is_empty() {
        return Err("Rockstar Games Launcher is not installed".to_string());
    }
    super::start_client();
    Ok(())
}

/// Uninstall a specific installed Rockstar title via the launcher.
#[tauri::command]
pub async fn rockstar_uninstall_game(title_id: String) -> Result<(), String> {
    super::uninstall_title(&title_id)
}

fn current_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
