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

/// Steam session: a Steam Web API key + the 64-bit SteamID of the
/// account it belongs to, plus an optional display name pulled from
/// `ISteamUser/GetPlayerSummaries/v2/` at connect time.
///
/// The API key is obtained by the user from
/// https://steamcommunity.com/dev/apikey and paste-pasted into the
/// Settings UI. It's then passed as the `key=` query parameter on
/// every subsequent Steam Web API call (`IPlayerService/GetOwnedGames`,
/// `ISteamUserStats/GetPlayerAchievements`, etc.).
///
/// `#[serde(alias = "webApiToken")]` preserves backward-compat
/// reads of stale keychain blobs from before the Phase-5 refactor —
/// pre-existing `{ steamId, webApiToken }` JSON decodes cleanly into
/// `{ steamId, apiKey }`. Outbound serialisation still emits
/// `apiKey` so newly written blobs stay canonical.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SteamSession {
    /// 64-bit SteamID the API key was registered against.
    pub steam_id: String,
    /// Steam Web API key. Sent as `key=` to every Steam Web API.
    #[serde(alias = "webApiToken")]
    pub api_key: String,
    /// Display name from `GetPlayerSummaries/v2`. Optional: missing
    /// `displayName` JSON key deserialises to `None` so a stub or
    /// older session blob round-trips through the keychain without
    /// throwing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
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
    /// `size::measure_folder_size` after the smart exe resolver returns.
    /// `None` when the game is uninstalled, exe resolution failed, or
    /// the disk walk errored out (folder gone, permission denied, etc.).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    /// Folder the size was measured against (= parent of `exe_path`).
    /// Auditable from the Storage tab so users can see and re-link the
    /// root we summed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_root_path: Option<String>,
    /// Unix timestamp (seconds) of the last time the user played this
    /// game on Steam. Passed through to the frontend so the Library
    /// page's "Continue Playing" rail can surface recently-active titles.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rtime_last_played: Option<u64>,
}
