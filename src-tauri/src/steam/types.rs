use serde::{Deserialize, Serialize};

/// Steam API configuration stored locally.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SteamApiConfig {
    /// Steam Web API key from https://steamcommunity.com/dev/apikey
    pub api_key: String,
    /// 64-bit Steam ID
    pub steam_id: String,
}

/// A single game from Steam's GetOwnedGames response.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SteamGame {
    pub appid: u32,
    pub name: String,
    pub playtime_forever: u32,
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
    /// Detected by scanning the Steam install directory for the largest
    /// non-utility .exe file.
    pub exe_path: Option<String>,
}
