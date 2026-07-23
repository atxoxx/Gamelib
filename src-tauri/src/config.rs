//! Centralized credential management for GameIndex.
//!
//! # Strategy
//!
//! Production builds embed secrets at compile time via `option_env!()`. The
//! developer sets environment variables before running `npm run tauri build`:
//!
//! ```powershell
//! $env:TWITCH_CLIENT_ID="your_id"
//! $env:TWITCH_CLIENT_SECRET="your_secret"
//! $env:OPENCRITIC_RAPIDAPI_KEY="your_key"
//! npm run tauri build
//! ```
//!
//! During development (`npm run tauri dev`), the `.env` file is loaded once
//! at startup by `load_env_file()` and the runtime `std::env::var()` fallback
//! picks the values up — no workflow change required.
//!
//! Each accessor tries compile-time first, then the runtime environment.
//! Returns an empty string when neither source is available (callers handle
//! missing credentials with appropriate error messages).

/// Load the `.env` file from the current or any parent directory into the
/// process environment. Called once during startup so every IGDB / OpenCritic
/// caller doesn't duplicate the walk.
///
/// Skips comments and empty lines. Only sets variables that don't already
/// have a value (compile-time baked-in values always win).
pub fn load_env_file() {
    let mut dir = std::env::current_dir().ok();
    while let Some(path) = dir {
        let env_path = path.join(".env");
        if env_path.exists() {
            if let Ok(content) = std::fs::read_to_string(env_path) {
                for line in content.lines() {
                    let line = line.trim();
                    if line.is_empty() || line.starts_with('#') {
                        continue;
                    }
                    if let Some((key, val)) = line.split_once('=') {
                        let key = key.trim();
                        let val = val.trim().trim_matches('"').trim_matches('\'');
                        // Don't overwrite already-set runtime env vars (earlier
                        // .env loads, system env, etc.). Compile-time values
                        // are baked into the binary and take priority in the
                        // accessor functions themselves.
                        if std::env::var(key).is_err() {
                            std::env::set_var(key, val);
                        }
                    }
                }
            }
            break;
        }
        dir = path.parent().map(|p| p.to_path_buf());
    }
}

// ── Credential accessors ────────────────────────────────────────────────────

/// Returns the Twitch Client ID for IGDB API calls.
///
/// Priority: compile-time `TWITCH_CLIENT_ID` env var → runtime env var →
/// empty string.
pub fn get_twitch_client_id() -> String {
    option_env!("TWITCH_CLIENT_ID")
        .map(|s| s.to_string())
        .or_else(|| std::env::var("TWITCH_CLIENT_ID").ok())
        .unwrap_or_default()
}

/// Returns the Twitch Client Secret for IGDB API calls.
///
/// Priority: compile-time `TWITCH_CLIENT_SECRET` env var → runtime env var →
/// empty string.
pub fn get_twitch_client_secret() -> String {
    option_env!("TWITCH_CLIENT_SECRET")
        .map(|s| s.to_string())
        .or_else(|| std::env::var("TWITCH_CLIENT_SECRET").ok())
        .unwrap_or_default()
}

/// Returns the OpenCritic RapidAPI key for review scraping.
///
/// Priority: compile-time `OPENCRITIC_RAPIDAPI_KEY` env var → runtime env
/// var → empty string.
pub fn get_opencritic_rapidapi_key() -> String {
    option_env!("OPENCRITIC_RAPIDAPI_KEY")
        .map(|s| s.to_string())
        .or_else(|| std::env::var("OPENCRITIC_RAPIDAPI_KEY").ok())
        .unwrap_or_default()
}
