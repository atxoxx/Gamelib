use serde::{Deserialize, Serialize};

/// Epic authentication tokens stored locally.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EpicAuthTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: u64, // Unix timestamp in seconds
    pub account_id: String,
    pub display_name: Option<String>,
}

/// A single catalog item from Epic's asset API.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EpicGameAsset {
    pub namespace: String,
    pub catalog_item_id: String,
    pub app_name: String,
    pub sandbox_type: Option<String>,
    pub build_version: Option<String>,
    pub categories: Vec<String>,
    pub item_type: Option<String>,
}

/// Detailed catalog metadata for a game.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EpicCatalogItem {
    pub namespace: String,
    pub catalog_item_id: String,
    pub title: String,
    pub description: Option<String>,
    pub categories: Vec<String>,
    pub sandbox_type: Option<String>,
    pub developer: Option<String>,
    pub publisher: Option<String>,
    pub release_date: Option<String>,
    pub cover_url: Option<String>,
    pub custom_attributes: Option<std::collections::HashMap<String, String>>,
}

/// A processed Epic game ready for the library.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EpicGame {
    pub id: String,
    pub app_name: String,
    pub title: String,
    pub namespace: String,
    pub catalog_item_id: String,
    pub build_version: Option<String>,
    pub is_owned: bool,
    pub is_installed: bool,
    pub install_path: Option<String>,
    pub launch_url: Option<String>,
    pub categories: Vec<String>,
    pub sandbox_type: Option<String>,
    pub playtime_minutes: Option<u64>,
    pub last_played: Option<u64>,
    /// Cover art URL from Epic's catalog CDN (keyImages).
    pub cover_url: Option<String>,
}

/// Result of an Epic library sync operation.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpicSyncResult {
    pub success: bool,
    pub games_imported: usize,
    pub games_skipped: usize,
    pub errors: Vec<String>,
    pub last_sync: u64,
    /// Mapped game entries ready to be added to the library.
    pub synced_games: Vec<EpicSyncedGame>,
}

/// A single synced game entry for the frontend.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EpicSyncedGame {
    pub id: String,
    pub title: String,
    pub namespace: String,
    pub catalog_item_id: String,
    pub is_installed: bool,
    pub install_path: Option<String>,
    pub playtime_minutes: Option<u64>,
    pub last_played: Option<u64>,
    /// Cover art URL from Epic's catalog CDN (keyImages).
    pub cover_url: Option<String>,
}

/// Filter options for Epic games.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EpicFilterOptions {
    pub statuses: Vec<String>,
    pub categories: Vec<String>,
    pub namespaces: Vec<String>,
}
