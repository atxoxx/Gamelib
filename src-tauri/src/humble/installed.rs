//! Installed Humble game detection.
//!
//! Mirrors `HumbleLibrary.GetInstalledGames` — reads the Humble App
//! `config.json` (per-user AppData), iterates `gameCollection4`, keeps
//! entries whose `status` is `downloaded`/`installed`, resolves the
//! primary executable, and returns them keyed by `machineName` so the
//! sync orchestrator can mark Trove/Synced games as installed.

use std::path::PathBuf;

use super::types::{HumbleAppConfig, HumbleAppGameEntry, HumbleInstalledGame};

/// Path to the Humble App config on Windows (Playnite parity).
pub fn humble_config_path() -> PathBuf {
    let appdata = std::env::var("APPDATA").unwrap_or_default();
    PathBuf::from(appdata)
        .join("Humble App")
        .join("config.json")
}

/// Read + parse the installed games from the Humble App config. Returns
/// an empty vec when the app isn't installed or the config is missing
/// (mirrors Playnite throwing — but we degrade to empty so sync still
/// imports the cloud-owned library).
pub fn scan_installed_humble_games() -> Vec<HumbleInstalledGame> {
    let path = humble_config_path();
    if !path.exists() {
        return Vec::new();
    }
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[humble-installed] failed to read config: {e}");
            return Vec::new();
        }
    };
    let config: HumbleAppConfig = match serde_json::from_str(&text) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[humble-installed] failed to parse config: {e}");
            return Vec::new();
        }
    };

    let mut out = Vec::new();
    for entry in config.game_collection4.iter() {
        if entry.status != "downloaded" && entry.status != "installed" {
            continue;
        }
        let exe_path = resolve_exe(entry);
        if exe_path.is_empty() {
            continue;
        }
        let install_dir = PathBuf::from(&exe_path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .filter(|d| !d.is_empty());
        let install_dir = match install_dir {
            Some(d) => d,
            None => continue,
        };
        out.push(HumbleInstalledGame {
            game_id: entry.machine_name.clone(),
            title: entry.game_name.clone(),
            install_dir,
            executable: exe_path,
        });
    }
    out
}

/// Resolve the primary executable path for an installed entry.
/// Newer Humble App versions store `filePath` + `executablePath`; older
/// versions nest under `downloadFilePath/machineName/executablePath`
/// (Playnite handles the same two shapes).
fn resolve_exe(entry: &HumbleAppGameEntry) -> String {
    if !entry.file_path.is_empty() {
        let p = PathBuf::from(&entry.file_path).join(&entry.executable_path);
        if p.exists() {
            return p.to_string_lossy().to_string();
        }
    }
    if !entry.download_file_path.is_empty() {
        let p = PathBuf::from(&entry.download_file_path)
            .join(&entry.machine_name)
            .join(&entry.executable_path);
        if p.exists() {
            return p.to_string_lossy().to_string();
        }
    }
    String::new()
}
