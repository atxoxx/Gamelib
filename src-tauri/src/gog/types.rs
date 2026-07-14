//! GOG Galaxy wire DTOs — Playnite `playnite-gog-oss-plugin` parity.
//!
//! ## Model
//!
//! The library endpoint `https://embed.gog.com/user/data/games`
//! returns owned games WITH attached stats in a single round-trip
//! — mirroring Playnite's `GogAccountClient.GetOwnedGames(accountInfo)`.
//! Stats are nested under the user-id key:
//!
//! ```jsonc
//! {
//!   "owned": [
//!     {
//!       "game": { "id": 1207658925, "title": "...", "isHidden": false, "url": "..." },
//!       // stats is EITHER an empty array OR a single object keyed by
//!       // accountId — Playnite's library code carries comment:
//!       //   "This is a hack for inconsistent data model on GOG's
//!       //    side. For some reason game stats are returned as an
//!       //    empty array if no stats exist". We hide that behind a
//!       //    custom `deserialize_with` so the rest of the codebase
//!       //    sees a clean `Option<GogGameStats>`.
//!       "stats": [{/* empty */}]  |  { "<accountId>": { "playtime": 120, "lastSession": 1700000000 } }
//!     }
//!   ]
//! }
//! ```
//!
//! The metadata endpoint `https://api.gog.com/products?ids=<csv>&expand=description,images,releaseDate`
//! is the same one Playnite's `GOGMetadataProvider.GetGameDetails`
//! hits — chunked at 50 ids per request.
//!
//! All wire fields are `#[serde(rename_all = "camelCase")]` so the
//! React frontend can `invoke()` and read directly without
//! camel-conversion.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Session marker (OS keychain + Settings tile) ─────────────────────

/// Persistent GOG login marker.
///
/// Populated after a successful OAuth2 login — the identity fields
/// come from probing `menu.gog.com/v1/account/basic` with the
/// fresh access token. The tokens themselves live in the OS
/// keychain under `gog_tokens` (see `GogAuthTokens` below).
///
/// `galaxy_user_id` mirrors Playnite's `userId` field on
/// `GogAccountClient.GetAccountInfo()` — it's the numeric id that
/// GOG uses as the stats key in the owned-games JSON.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GogSession {
    pub user_id: String,
    pub username: String,
    /// Numeric galaxy user id (from `GetAccountInfo`/`menu.gog.com/v1/account/basic`).
    #[serde(default)]
    pub galaxy_user_id: Option<String>,
    /// Unix seconds at which login completed. Drives the "Last
    /// connected" subtitle on the Settings tile.
    pub logged_in_at: u64,
}

// ── OAuth tokens (OS keychain) ──────────────────────────────────────

/// GOG OAuth2 tokens persisted in the OS keychain under `gog_tokens`.
/// Mirrors the Epic `EpicAuthTokens` round-trip — compact JSON
/// in the keychain, kv-store timestamps for the Settings tile.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GogAuthTokens {
    pub access_token: String,
    pub refresh_token: String,
    /// Unix timestamp (seconds) at which `access_token` expires.
    pub expires_at: u64,
    /// GOG numeric user id from the token response.
    pub user_id: String,
}

// ── Library response — embed.gog.com/user/data/games ─────────────────

/// Stub fields we display per owned library entry.
///
/// `url` is the GOG store vanity URL slug
/// (`https://www.gog.com/game/<slug>`); the frontend can wire it to
/// "Open in GOG Store" later.
/// `cover_url` mirrors Playnite's preference for `boxArtImage`
/// over `backgroundImage` — we resolve it on the JS side during
/// the metadata fetch below.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GogGameStub {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub is_hidden: bool,
    #[serde(default)]
    pub url: Option<String>,
}

/// One entry in the `embed.gog.com/user/data/games` response.
///
/// `stats` is hidden behind `deserialize_with` to absorb GOG's
/// inconsistent type quirk (`[]` vs `{ "<uid>": {...} }`) — the
/// produced type is the clean `Option<GogGameStats>` you'd expect.
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GogLibraryGame {
    pub game: GogGameStub,
    #[serde(default, deserialize_with = "deserialize_gog_stats")]
    pub stats: Option<GogGameStats>,
}

/// Per-game playtime/last-session from GOG.
///
/// Playtime is reported in MINUTES (matches the Steam
/// `playtime_forever` convention). `last_session` is unix SECONDS —
/// frontend multiplies by 1000 to fit the project-wide millis
/// `lastPlayed` convention.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GogGameStats {
    pub playtime: u32,
    #[serde(default)]
    pub last_session: Option<u64>,
}

// ── Product metadata (api.gog.com) ────────────────────────────────────

/// One element of the bulk `api.gog.com/products?ids=<csv>` response.
///
/// `cover_url` is resolved client-side (Rust or JS) to prefer
/// `images.boxArtImage` then `backgroundImage` — mirrors Playnite's
/// `if (settings.UseVerticalCovers && storeData.StoreDetails.boxArtImage != null)`.
/// We always pick `boxArtImage` here and fallback to `backgroundImage`
/// when no box-art asset exists for the title.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GogProductImages {
    #[serde(default)]
    pub box_art_image: Option<String>,
    #[serde(default)]
    pub background_image: Option<String>,
    #[serde(default)]
    pub logo: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GogProductMeta {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub cover_url: Option<String>,
    #[serde(default)]
    pub images: Option<GogProductImages>,
    /// Install size in MB as reported by the API (Playnite
    /// multiplies by 1024² for bytes).
    #[serde(default)]
    pub size_mb: Option<u64>,
    /// Release date as Unix seconds (Playnite's
    /// `storeData.ReleaseDate`).
    #[serde(default)]
    pub release_date: Option<u64>,
    #[serde(default)]
    pub developer: Option<String>,
    #[serde(default)]
    pub publisher: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub genres: Vec<String>,
    /// GOG store vanity URL.
    #[serde(default)]
    pub store_url: Option<String>,
}

impl GogProductMeta {
    /// Pick the best cover image — mirrors Playnite's
    /// `if (settings.UseVerticalCovers && storeData.StoreDetails.boxArtImage != null)`
    /// fall-through to `backgroundImage` for titles without
    /// dedicated box-art.
    pub fn resolve_cover(&mut self) {
        let url = self
            .images
            .as_ref()
            .and_then(|i| i.box_art_image.clone().or_else(|| i.background_image.clone()))
            .or_else(|| self.store_url.clone());
        if url.is_some() {
            self.cover_url = url;
        }
    }
}

// ── Installed-game detection ─────────────────────────────────────────

/// One element of `https://gameplay.gog.com/clients/<user_id>/playtime`.
///
/// Used as the FALLBACK playtime source when an owned entry's
/// embedded `stats` came back empty. The shape parallels
/// `GogGameStats` plus a `product_id` key.
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GogPlaytimeMirror {
    pub product_id: String,
    pub playtime: u32,
    pub last_session: Option<u64>,
}

/// Parsed contents of a `goggame-<id>.info` manifest on disk.
///
/// Mirror of Playnite's `GogGameActionInfo` parse — we model only the
/// keys we use:
/// - `gameId` — numeric id matching the install dir name.
/// - `rootGameId` — top-level product id; differs from `gameId` for
///   DLCs. DLC filter rule: `skip if rootGameId != gameId`.
/// - `name` — title available even before the metadata round-trip.
/// - `playTasks` / `supportTasks` — array of `GogGameTask`; the
///   primary executable is chosen from the FIRST `playTasks` entry
///   where `isPrimary == true`. No primary task → DLL/soundtrack/etc.
///   → skip (Playnite parity).
/// - `buildId` — version marker; surfaced as the game version.
/// - `version` — human-readable install version.
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GogGameActionInfo {
    #[serde(default)]
    pub game_id: Option<String>,
    #[serde(default)]
    pub root_game_id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub build_id: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub play_tasks: Vec<GogGameTask>,
    #[serde(default)]
    pub support_tasks: Vec<GogGameTask>,
}

/// One entry from `goggame-<id>.info` `playTasks[]`.
///
/// A `type=FILE` task with `isPrimary=true` is the canonical launch
/// target; Playnite picks `playTasks.Where(a => a.isPrimary).First()`.
/// We do the same. Standalone installers (no primary) are skipped.
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GogGameTask {
    #[serde(default)]
    pub is_primary: bool,
    #[serde(default)]
    pub is_hidden: bool,
    /// `FILE` for executable-on-disk; `URL` for browser-launched.
    #[serde(rename = "type", default)]
    pub task_type: Option<String>,
    /// Path relative to the install dir (for FILE) or a URL (URL).
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub working_dir: Option<String>,
    #[serde(default)]
    pub args: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
}

/// One installed game record discovered either through Windows
/// registry or directly through `goggame-<id>.info` parsing.
///
/// `exe_path` is the resolved primary executable (from playTasks)
/// when the manifest supports it; otherwise it's the path to the
/// largest .exe in the install dir (last-resort Playnite parity).
#[derive(Debug, Clone)]
pub struct GogInstalledGame {
    pub game_id: String,
    pub install_dir: String,
    pub exe_path: String,
    pub is_dlc: bool,
    /// Display name resolved from either the manifest or the
    /// Windows uninstall entry — never empty.
    pub title: String,
}

/// Public synced-game shape (mirrors `EpicSyncedGame` for
/// frontend uniformity).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GogSyncedGame {
    pub id: String,
    pub title: String,
    /// GOG numeric product id (e.g. `"1207658925"`).
    pub gog_game_id: String,
    pub is_installed: bool,
    /// Absolute path to the launchable executable.
    #[serde(default)]
    pub install_path: Option<String>,
    #[serde(default)]
    pub install_dir: Option<String>,
    /// Playtime in MINUTES.
    #[serde(default)]
    pub playtime_minutes: Option<u32>,
    /// Unix SECONDS — frontend converts to ms.
    #[serde(default)]
    pub last_played: Option<u64>,
    /// Cover image URL on GOG's CDN (`images.gog-static.com`).
    #[serde(default)]
    pub cover_url: Option<String>,
    /// Install size in bytes when measured.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_root_path: Option<String>,
}

/// Result of a full GOG sync. Mirrors `EpicSyncResult`.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GogSyncResult {
    pub success: bool,
    pub games_imported: usize,
    pub games_skipped: usize,
    pub errors: Vec<String>,
    /// Unix seconds when the sync completed.
    pub last_sync: u64,
    pub synced_games: Vec<GogSyncedGame>,
}

// ── Deserializer for GOG's stats type-quirk ──────────────────────────

/// Deserialize `stats` from the `embed.gog.com` response, hiding the
/// inconsistency GOG has between an empty-array (no stats) and a
/// single-object (with stats keyed by account id).
///
/// Json shape:
/// - `"stats": []`  → `Ok(None)`
/// - `"stats": { "<accountId>": { "playtime": ..., "lastSession": ... } }` → `Ok(Some(stats))`
/// - `"stats": null` → `Ok(None)`
///
/// `Option<T>` at the field level catches explicit nulls — `serde`
/// doesn't pass null to the inner deserializer.
fn deserialize_gog_stats<'de, D>(deserializer: D) -> Result<Option<GogGameStats>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum GogStatsHelper {
        // Order MATTERS: serde tries EmptyArray first so `[]` matches
        // a value (empty Vec) — never the Map branch.
        EmptyArray(Vec<()>),
        Map(HashMap<String, GogGameStats>),
    }

    let helper = match Option::<GogStatsHelper>::deserialize(deserializer) {
        Ok(Some(h)) => h,
        // Explicit `null` or helper-deserializable as null → no stats
        Ok(None) => return Ok(None),
        // Surface unexpected shape changes via stderr rather than
        // silently swallowing (which would hide a future API drift).
        Err(e) => {
            eprintln!("[gog] stats deserialize fallback to None: {e}");
            return Ok(None);
        }
    };
    match helper {
        GogStatsHelper::EmptyArray(_) => Ok(None),
        GogStatsHelper::Map(mut m) => {
            // GOG keys stats by user-id and there's only one per
            // account — Playnite grabs `.Keys.First()`. We do the
            // same.
            Ok(m.values_mut().next().cloned())
        }
    }
}
