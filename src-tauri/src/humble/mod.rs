//! Humble Bundle library integration.
//!
//! Module surface (Playnite `HumbleLibrary` parity, adapted to
//! Gamelib's pure-Rust + Tauri WebView model):
//! - `types`   — wire DTOs + auth/session/settings types (camelCase).
//! - `auth`    — cookie-based WebView login, auth probe, logout,
//!   cookie capture/rehydration.
//! - `client`  — `reqwest` client carrying the cookie jar; fetches
//!   game keys + orders + Trove catalog.
//! - `installed` — Humble App `config.json` parse + primary-exe
//!   resolution.
//! - `sync`    — orchestrator that merges orders/Trove/installed into
//!   a `HumbleSyncResult`.
//! - `settings`— the user-toggleable settings blob (kv_store-backed).

pub mod auth;
pub mod client;
pub mod installed;
pub mod settings;
pub mod sync;
pub mod types;

// Re-export the Tauri commands so `lib.rs` can register them via
// `use humble::{...}`.
pub use auth::{humble_is_authenticated, humble_logout, humble_start_login};
pub use sync::humble_sync_library;

use tauri::AppHandle;

use crate::humble::settings::load as load_settings;
use crate::humble::settings::save as save_settings;
use crate::humble::types::HumbleSettings;

/// Load the current Humble settings for the Settings UI.
#[tauri::command]
pub fn humble_get_settings(app: AppHandle) -> HumbleSettings {
    load_settings(&app)
}

/// Persist updated Humble settings from the Settings UI.
#[tauri::command]
pub fn humble_save_settings(app: AppHandle, settings: HumbleSettings) -> Result<(), String> {
    save_settings(&app, &settings)
}
