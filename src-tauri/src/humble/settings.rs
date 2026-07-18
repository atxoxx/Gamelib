//! Humble settings persistence (kv_store-backed).
//!
//! Mirrors the Playnite `HumbleLibrarySettings` blob so the Settings UI
//! can flip toggles and the sync orchestrator can read them. We keep the
//! same field names and camelCase JSON shape as the C# side for
//! drop-in parity.

use super::types::HumbleSettings;
use crate::db;
use tauri::Manager;

pub const HUMBLE_SETTINGS_KV_KEY: &str = "humble_settings";

/// Load persisted settings, falling back to defaults when none exist.
pub fn load(app: &tauri::AppHandle) -> HumbleSettings {
    let Some(db_state) = app.try_state::<db::Db>() else {
        return HumbleSettings::default();
    };
    match db::kv::get(db_state.inner(), HUMBLE_SETTINGS_KV_KEY) {
        Ok(Some(raw)) => serde_json::from_str(&raw).unwrap_or_default(),
        _ => HumbleSettings::default(),
    }
}

/// Persist the settings blob.
pub fn save(app: &tauri::AppHandle, settings: &HumbleSettings) -> Result<(), String> {
    let db_state = app
        .try_state::<db::Db>()
        .ok_or_else(|| "Database not initialized — cannot persist Humble settings".to_string())?;
    let json = serde_json::to_string(settings).map_err(|e| format!("serialize settings: {e}"))?;
    db::kv::set(db_state.inner(), HUMBLE_SETTINGS_KV_KEY, &json)
}
