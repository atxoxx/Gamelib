//! Humble Bundle library integration.
//!
//! Module surface — Playnite `HumbleLibrary` (JosefNemec/PlayniteExtensions)
//! parity, adapted to Gamelib's pure-Rust + Tauri WebView model:
//!
//! - `types`   — wire DTOs + auth/session/settings types (camelCase).
//! - `auth`    — cookie-based Tauri WebView login (navigate to
//!               humblebundle.com/login, watch for the library redirect),
//!               cookie capture into the SQLite kv_store, plus a cheap
//!               `humble_is_authenticated` boolean probe.
//! - `client`  — `reqwest`-backed HTTP client carrying the captured
//!               cookie jar; fetches the user's order keys + orders.
//! - `installed` — reads the Humble App `config.json` to discover
//!               locally-installed Trove games (mirrors
//!               `HumbleLibrary.GetInstalledGames`).
//! - `sync`    — orchestrator. Fetches orders → owned Windows subproducts,
//!               optional Trove catalog + game extras, merges with the
//!               installed scan, and returns a `HumbleSyncResult`.
//! - `settings`— the user-toggleable `HumbleLibrarySettings` blob
//!               (ConnectAccount, ImportGeneralLibrary, ImportTroveGames,
//!               ImportGameExtras, IgnoreThirdPartyStoreGames,
//!               ImportThirdPartyDrmFree, LaunchViaHumbleApp) persisted in
//!               the kv_store and surfaced to the Settings UI.
//!
//! ## Authentication model
//!
//! Humble has no public OAuth client — Playnite authenticates by driving
//! a WebView at humblebundle.com and snapshotting the session cookies,
//! then replaying them against the `api/v1/orders` and library endpoints.
//! We follow the same approach: the `humble_login` WebView captures the
//! `.humblebundle.com` cookies, the `client` rehydrates them into a
//! `reqwest::cookie::Jar`, and every subsequent request rides on that jar.

use serde::{Deserialize, Serialize};

// ── Persisted connection marker ───────────────────────────────────────

/// Persistent Humble login marker — mirrors Playnite's "user is
/// authenticated" state, which is really just "we have session cookies".
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct HumbleSession {
    /// Display name scraped from the library page (best-effort).
    #[serde(default)]
    pub username: String,
    /// Unix seconds at which login completed. Drives the
/// "Connected" subtitle on the Settings tile.
    #[serde(default)]
    pub logged_in_at: u64,
    /// True once we've confirmed at least one successful order fetch.
    #[serde(default)]
    pub has_orders: bool,
}

// ── User-facing settings (Playnite parity) ────────────────────────────

/// Mirrors `HumbleLibrarySettings` in the Playnite plugin. Every field
/// is user-toggleable from the Settings UI; the sync orchestrator reads
/// these to decide what to import.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct HumbleSettings {
    /// Master switch — when false, `ImportGames` returns early and sync
    /// imports nothing (Playnite: `ConnectAccount`).
    pub connect_account: bool,
    /// Skip subproducts whose download list has no `windows` entry.
    pub ignore_third_party_store_games: bool,
    /// When a third-party store game IS detected, still import it if its
    /// `human_name` collides with a TPK (drm-free) product.
    pub import_third_party_drm_free: bool,
    /// Import owned library subproducts (the main "Orders" library).
    pub import_general_library: bool,
    /// Import non-game bonus downloads (soundtracks, artbooks, asm.js
    /// versions, …) as separate library entries.
    pub import_game_extras: bool,
    /// Import the Humble Trove catalog (subscriber-only streaming
    /// library) and merge with installed Trove games.
    pub import_trove_games: bool,
    /// When launching a Trove game, prefer `humble://launch/<machineName>`
    /// (via the Humble App) over the resolved on-disk executable.
    pub launch_via_humble_app: bool,
}

impl Default for HumbleSettings {
    fn default() -> Self {
        Self {
            connect_account: false,
            ignore_third_party_store_games: true,
            import_third_party_drm_free: false,
            import_general_library: true,
            import_game_extras: false,
            import_trove_games: false,
            launch_via_humble_app: true,
        }
    }
}

// ── Wire DTOs: orders + subproducts ───────────────────────────────────

/// Top-level order object from `api/v1/orders?all_tpkds=true`.
#[derive(Debug, Default, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct HumbleOrder {
    pub gamekey: String,
    pub product: HumbleProductSummary,
    #[serde(default)]
    pub subproducts: Vec<HumbleSubProduct>,
    #[serde(default)]
    pub tpkd_dict: Option<HumbleTpkdDict>,
}

/// Minimal `product` summary — used for display names in extras.
#[derive(Debug, Default, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct HumbleProductSummary {
    #[serde(default)]
    pub machine_name: String,
    #[serde(default)]
    pub human_name: String,
}

/// `tpkd_dict` — the collection of third-party-key (TPK) products that
/// signal a game was provided via a partner store (Steam, GOG, …)
/// rather than a drm-free download.
#[derive(Debug, Default, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct HumbleTpkdDict {
    #[serde(default)]
    pub all_tpks: Vec<HumbleTpk>,
}

/// One third-party-key entry.
#[allow(dead_code)]
#[derive(Debug, Default, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct HumbleTpk {
    #[serde(default)]
    pub human_name: String,
    #[serde(default)]
    pub key_type: String,
}

/// One owned subproduct within an order.
#[derive(Debug, Default, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct HumbleSubProduct {
    #[serde(default)]
    pub machine_name: String,
    #[serde(default)]
    pub human_name: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub downloads: Vec<HumbleDownload>,
}

/// One download row under a subproduct (a "platform" bucket).
#[derive(Debug, Default, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct HumbleDownload {
    #[serde(default)]
    pub machine_name: String,
    #[serde(default)]
    pub platform: String,
    #[serde(default)]
    pub download_struct: Vec<HumbleDownloadStruct>,
}

/// One concrete download file (used for extras).
#[allow(dead_code)]
#[derive(Debug, Default, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct HumbleDownloadStruct {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub md5: String,
    #[serde(default)]
    pub file_size: Option<u64>,
}

// ── Trove catalog DTOs ────────────────────────────────────────────────

/// One entry in `https://humblebundle.com/client/catalog?index=N`.
#[allow(dead_code)]
#[derive(Debug, Default, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct HumbleTroveGame {
    #[serde(default)]
    pub machine_name: String,
    #[serde(default)]
    pub human_name: String,
    #[serde(default)]
    pub description_text: Option<String>,
    #[serde(default)]
    pub publishers: Vec<HumbleNamed>,
    #[serde(default)]
    pub developers: Vec<HumbleNamed>,
}

/// Generic `{ "publisher_name": … }` shape used by Trove.
#[allow(dead_code)]
#[derive(Debug, Default, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct HumbleNamed {
    #[serde(default)]
    pub publisher_name: String,
    #[serde(default)]
    pub developer_name: String,
}

// ── Installed (Humble App) DTOs ───────────────────────────────────────

/// Parsed `Humble App/config.json` → `gameCollection4[]`.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HumbleAppConfig {
    #[serde(default)]
    pub game_collection4: Vec<HumbleAppGameEntry>,
}

/// One installed-game entry from the Humble App config.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HumbleAppGameEntry {
    #[serde(default)]
    pub machine_name: String,
    #[serde(default)]
    pub game_name: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub file_path: String,
    #[serde(default)]
    pub download_file_path: String,
    #[serde(default)]
    pub executable_path: String,
}

/// One installed game discovered from the Humble App config.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct HumbleInstalledGame {
    pub game_id: String,
    pub title: String,
    pub install_dir: String,
    pub executable: String,
}

// ── Public synced-game shape (mirrors GogSyncedGame) ──────────────────

/// A single synced Humble game — what the React side receives via
/// `invoke("humble_sync_library")` and feeds into `addGames`.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HumbleSyncedGame {
    pub id: String,
    pub title: String,
    /// Stable Humble game id: `<machineName>_<humanName>` for orders,
    /// `<machineName>` for Trove, `<prefix>_…` for extras.
    pub humble_game_id: String,
    /// `true` for Trove-sourced entries (drives launch-via-Humble-App).
    #[serde(default)]
    pub is_trove: bool,
    #[serde(default)]
    pub is_installed: bool,
    /// Absolute path to the launchable executable.
    #[serde(default)]
    pub install_path: Option<String>,
    #[serde(default)]
    pub install_dir: Option<String>,
    /// Cover image URL (order product icon, when present).
    #[serde(default)]
    pub cover_url: Option<String>,
    /// Install-dir size in bytes when measured.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_root_path: Option<String>,
    /// `true` when this entry is a non-game extra (soundtrack/artbook/…).
    #[serde(default)]
    pub is_extra: bool,
}

/// Result of a full Humble sync.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HumbleSyncResult {
    pub success: bool,
    pub games_imported: usize,
    pub games_skipped: usize,
    pub errors: Vec<String>,
    /// Unix seconds when the sync completed.
    pub last_sync: u64,
    pub synced_games: Vec<HumbleSyncedGame>,
}
