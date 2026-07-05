use tauri::{AppHandle, Manager};

use super::types::SteamApiConfig;

/// Save the Steam API config to disk.
#[tauri::command]
pub fn steam_save_config(
    app: AppHandle,
    config: SteamApiConfig,
) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let config_path = data_dir.join("steam_config.json");
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&config_path, json).map_err(|e| e.to_string())?;
    Ok(())
}

/// Load the saved Steam API config from disk.
/// Returns `None` if no config file exists.
#[tauri::command]
pub fn steam_load_config(app: AppHandle) -> Result<Option<SteamApiConfig>, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let config_path = data_dir.join("steam_config.json");

    if !config_path.exists() {
        return Ok(None);
    }

    let json = std::fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let config: SteamApiConfig = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    Ok(Some(config))
}

/// Clear the saved Steam API config file.
#[tauri::command]
pub fn steam_clear_config(app: AppHandle) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let config_path = data_dir.join("steam_config.json");
    if config_path.exists() {
        std::fs::remove_file(&config_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
