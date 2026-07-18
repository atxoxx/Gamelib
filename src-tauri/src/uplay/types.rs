//! Ubisoft Connect library types — wire DTOs + user settings
//! (camelCase), mirroring Playnite's `UplayLibrary` schema.

use serde::{Deserialize, Serialize};

// ── User-toggleable settings (Playnite parity) ────────────────────────

/// Mirrors `UplayLibrarySettings` in the Playnite plugin. Both fields
/// are user-toggleable from the Settings UI; the sync orchestrator
/// reads them to decide what to import.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct UplaySettings {
    /// Import games detected as installed via the registry.
    /// (Playnite: `ImportInstalledGames`.)
    pub import_installed_games: bool,
    /// Import the full owned library (incl. uninstalled) from the local
    /// product cache. (Playnite: `ImportUninstalledGames`.)
    pub import_uninstalled_games: bool,
}

impl Default for UplaySettings {
    fn default() -> Self {
        Self {
            // `ImportInstalledGames` defaults to true in Playnite.
            import_installed_games: true,
            // `ImportUninstalledGames` defaults to `Uplay.IsInstalled`.
            import_uninstalled_games: super::is_client_installed(),
        }
    }
}

// ── Product cache model (mirrors Playnite's `ProductInformation`) ─────

/// A single entry from the local product cache. `uplay_id` is the
/// stable Ubisoft game id used for `uplay://launch/<id>`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductInformation {
    pub root: Product,
    #[serde(default)]
    pub uplay_id: Option<u64>,
    #[serde(default)]
    pub install_id: Option<u64>,
}

/// The `root` product node from a cache `GameInfo` YAML document.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Product {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub background_image: Option<String>,
    #[serde(default)]
    pub thumb_image: Option<String>,
    #[serde(default)]
    pub logo_image: Option<String>,
    #[serde(default)]
    pub dialog_image: Option<String>,
    #[serde(default)]
    pub icon_image: Option<String>,
    /// `true` when the game is a re-skin of a third-party platform
    /// title (Playnite skips these).
    #[serde(default)]
    pub third_party_platform: bool,
    /// `true` for ULC entries (Playnite skips these as DLC).
    #[serde(default)]
    pub is_ulc: bool,
    /// `true` when the product carries a `start_game` block.
    #[serde(default)]
    pub has_start_game: bool,
    /// DLC addon ids attached to this product.
    #[serde(default)]
    pub addon_ids: Vec<u64>,
}

/// Reserved mirror of Playnite's `UplayCacheGame` (protobuf) entry.
/// Unused at runtime today (we parse the YAML directly), kept so the
/// cache shape is documented in one place.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UplayCacheEntry {
    pub uplay_id: u64,
    pub install_id: u64,
    pub game_info: String,
}

// ── Public synced-game shape (mirrors GogSyncedGame) ──────────────────

/// A single synced Ubisoft Connect game — what the React side receives
/// via `invoke("uplay_sync_library")` and feeds into `addGames`.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UplaySyncedGame {
    pub id: String,
    pub title: String,
    /// Ubisoft `uplay_id` (used for `uplay://launch|install|uninstall`).
    pub uplay_id: String,
    #[serde(default)]
    pub is_installed: bool,
    /// Absolute path to the install directory (empty when not
    /// installed on disk).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub install_dir: Option<String>,
    /// Background image URL (from the product cache).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background_image: Option<String>,
    /// Cover image URL (from the product cache).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover_image: Option<String>,
    /// Icon image URL (from the product cache).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_image: Option<String>,
    /// Install-dir size in bytes when measured.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_root_path: Option<String>,
}

/// Result of a full Ubisoft Connect sync. Mirrors `GogSyncResult` /
/// `EpicSyncResult` / `RockstarSyncResult` so the Settings tile
/// renders it uniformly.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UplaySyncResult {
    pub success: bool,
    pub games_imported: usize,
    pub games_skipped: usize,
    pub errors: Vec<String>,
    /// Unix seconds at which the sync completed.
    pub last_sync: u64,
    /// True when Ubisoft Connect is installed at all (gates the
    /// "Sync Library" button on the tile).
    pub client_installed: bool,
    /// Install root of Ubisoft Connect (empty off-Windows or when not
    /// installed).
    pub client_path: String,
    pub synced_games: Vec<UplaySyncedGame>,
}
