use serde::{Deserialize, Serialize};

/// Steam API configuration stored locally.
#[deprecated(since = "0.2.0", note = "Use SteamSession instead — web-token-based auth via WebView login")]
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SteamApiConfig {
    /// Steam Web API key from https://steamcommunity.com/dev/apikey
    pub api_key: String,
    /// 64-bit Steam ID
    pub steam_id: String,
}

/// Steam session data extracted from WebView login.
///
/// Contains the `web_api_token` that Playnite's approach extracts from
/// the store page HTML — this token can be passed as `access_token` to
/// the official Steam Web API (`IPlayerService/GetOwnedGames/v1/` etc.)
/// instead of requiring an API key.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SteamSession {
    /// 64-bit Steam ID extracted from the store page HTML
    pub steam_id: String,
    /// Web API access token extracted from the store page HTML.
    /// Passed as `access_token` parameter to Steam Web API calls.
    pub web_api_token: String,
    /// Display name from the profile (if available)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

/// A single game from Steam's GetOwnedGames API response.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SteamGame {
    pub appid: u32,
    pub name: String,
    /// Total playtime in minutes (from playtime_forever)
    pub playtime_forever: u32,
    /// Windows-specific playtime in minutes
    pub playtime_windows_forever: u32,
    pub has_community_visible_stats: bool,
    pub rtime_last_played: Option<u64>,
}

/// Result of a Steam library sync operation.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamSyncResult {
    pub success: bool,
    pub games_synced: u32,
    pub playtime_updated: u32,
    pub achievements_synced: u32,
    pub error: Option<String>,
    /// Mapped game entries ready to be added to the library.
    pub synced_games: Vec<SyncedGameEntry>,
    /// Steam AppIDs that are currently installed on disk.
    pub installed_appids: Vec<u32>,
}

/// A single game entry from a Steam sync, ready to be mapped to GameData.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SyncedGameEntry {
    pub appid: u32,
    pub name: String,
    pub playtime_forever: u32,
    /// Resolved path to the main game executable (if installed locally).
    pub exe_path: Option<String>,
    /// Total disk footprint of the install dir, measured by
    /// `size::measure_install_size` after `resolve_main_exe` returns.
    /// `None` when the game is uninstalled, exe resolution failed, or
    /// the disk walk errored out (folder gone, permission denied, etc.).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    /// Folder the size was measured against (= parent of `exe_path`).
    /// Auditable from the Storage tab so users can see and re-link the
    /// root we summed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_root_path: Option<String>,
}
