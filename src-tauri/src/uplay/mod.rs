//! Ubisoft Connect (Uplay) library integration.
//!
//! Module surface — Playnite `UplayLibrary` parity (JosefNemec/
//! PlayniteExtensions), adapted to GameIndex's pure-Rust + Tauri WebView
//! model:
//! - `cache`   — parse the proprietary protobuf `configurations` cache
//!               (`%LOCALAPPDATA%\Ubisoft Game Launcher\cache\configuration
//!               \configurations`) into `ProductInformation` records.
//!               This is a hand-rolled, no-dependency approximation of
//!               Playnite's `Uplay.GetLocalProductCache` (which uses
//!               protobuf-net + a YAML `GameInfo` payload).
//! - `types`   — wire DTOs + user-toggleable settings (camelCase).
//! - `sync`    — orchestrator that merges installed (registry) + library
//!               (cache) games into a `UplaySyncResult`. Mirrors
//!               Playnite's `UplayLibrary.GetGames`.
//! - `settings`— the `UplayLibrarySettings` blob (ImportInstalledGames,
//!               ImportUninstalledGames), kv_store-backed.
//!
//! ## Feature parity with Playnite's UplayLibrary
//!
//! * Installed-games scan off the registry key
//!   `SOFTWARE\ubisoft\Launcher\Installs\` — `GetInstalledGames`.
//! * Library scan of the local product cache — `GetLibraryGames`.
//!   We drop addons (DLC), third-party-platform re-skins, and
//!   `is_ulc` entries, exactly like Playnite.
//! * Client detection (`Ubisoft Connect` uninstall entry) + launch
//!   via `uplay://launch/<id>`, install/uninstall via
//!   `uplay://install|uninstall/<id>` — `UplayClient` /
//!   `UplayGameController`.
//! * The two user toggles `ImportInstalledGames` /
//!   `ImportUninstalledGames`.

pub mod cache;
pub mod settings;
pub mod sync;
pub mod types;

// Re-export Tauri commands so `lib.rs` can register them via
// `use uplay::{...}`.
pub use sync::{
    uplay_install_game, uplay_launch_game, uplay_open_client, uplay_sync_library,
    uplay_uninstall_game,
};
pub use types::UplaySettings;

use tauri::AppHandle;

use crate::uplay::settings::load as load_settings;
use crate::uplay::settings::save as save_settings;

/// Client display name in the Windows uninstall registry.
#[cfg(windows)]
pub const UBISOFT_CONNECT_DISPLAY_NAME: &str = "Ubisoft Connect";

/// Local Application Data relative path to the product-cache file
/// Playnite reads. `%LOCALAPPDATA%\Ubisoft Game Launcher\cache\
/// configuration\configurations`.
pub fn configurations_cache_path() -> String {
    let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
    if local.is_empty() {
        return String::new();
    }
    std::path::Path::new(&local)
        .join("Ubisoft Game Launcher")
        .join("cache")
        .join("configuration")
        .join("configurations")
        .to_string_lossy()
        .to_string()
}

/// Install root of Ubisoft Connect, or `""` when absent.
///
/// Mirrors Playnite's `Uplay.InstallationPath` — locates the uninstall
/// entry whose `DisplayName == "Ubisoft Connect"` and returns its
/// `InstallLocation`.
pub fn client_install_path() -> String {
    client_install_path_inner().unwrap_or_default()
}

/// Absolute path to `UbisoftConnect.exe` inside the install root, or
/// `""`. Mirrors `Uplay.ClientExecPath`.
pub fn client_exec_path() -> String {
    let path = client_install_path();
    if path.is_empty() {
        return String::new();
    }
    std::path::Path::new(&path)
        .join("UbisoftConnect.exe")
        .to_string_lossy()
        .to_string()
}

/// True when Ubisoft Connect is installed. Mirrors `Uplay.IsInstalled`.
pub fn is_client_installed() -> bool {
    let exe = client_exec_path();
    !exe.is_empty() && std::path::Path::new(&exe).is_file()
}

#[cfg(windows)]
const REG_UNINSTALL_BASE: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";
#[cfg(windows)]
const REG_UNINSTALL_BASE_WOW: &str =
    r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall";

#[cfg(windows)]
fn client_install_path_inner() -> Option<String> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let roots = [
        (HKEY_LOCAL_MACHINE, REG_UNINSTALL_BASE),
        (HKEY_LOCAL_MACHINE, REG_UNINSTALL_BASE_WOW),
        (HKEY_CURRENT_USER, REG_UNINSTALL_BASE),
    ];
    for (hkey, base) in &roots {
        let root = RegKey::predef(*hkey);
        let Ok(uninstall_root) = root.open_subkey(base) else {
            continue;
        };
        for sub in uninstall_root.enum_keys().flatten() {
            let Ok(entry) = uninstall_root.open_subkey(&sub) else {
                continue;
            };
            let display_name: Option<String> = entry.get_value("DisplayName").ok();
            if display_name.as_deref() != Some(UBISOFT_CONNECT_DISPLAY_NAME) {
                continue;
            }
            let install_location: Option<String> = entry.get_value("InstallLocation").ok();
            if let Some(loc) = install_location {
                let trimmed = loc.trim_matches('"').to_string();
                if !trimmed.is_empty() && std::path::Path::new(&trimmed).is_dir() {
                    return Some(trimmed);
                }
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn client_install_path_inner() -> Option<String> {
    None
}

/// Launch the Ubisoft Connect client itself (background process).
/// Mirrors `UplayClient.Open` → `ProcessStarter.StartProcess(...)`.
pub fn start_client() {
    let exe = client_exec_path();
    if exe.is_empty() {
        eprintln!("[uplay] UbisoftConnect.exe not found — cannot start client");
        return;
    }
    if let Err(e) = std::process::Command::new(&exe).spawn() {
        eprintln!("[uplay] Failed to start client: {e}");
    }
}

/// Load the current Uplay settings for the Settings UI.
#[tauri::command]
pub fn uplay_get_settings(app: AppHandle) -> UplaySettings {
    load_settings(&app)
}

/// Persist updated Uplay settings from the Settings UI.
#[tauri::command]
pub fn uplay_save_settings(app: AppHandle, settings: UplaySettings) -> Result<(), String> {
    save_settings(&app, &settings)
}
