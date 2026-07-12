//! GOG Galaxy wire DTOs.
//!
//! All fields are `#[serde(rename_all = "camelCase")]` so the React
//! frontend can `invoke("gog_sync_library")` and read `userId`
//! directly without camel-conversion. UUIDs from GOG are stringified
//! (the underlying API returns numeric ids as strings, e.g. `"1207658925"`)
//! — `gog_game_id` is stored as `String` so serde-json can round-trip
//! any numeric value without overflow checks.

use serde::{Deserialize, Serialize};

/// GOG Galaxy "I'm logged in" marker stored in the OS keychain.
///
/// After the WebView-cookie pivot (dropping OAuth — GOG rotated every
/// documented Galaxy client_id to `invalid_client` in 2026, and
/// OAuth as a third-party launcher integration is dead), the only
/// persistent artifact of a GOG login is *which* user is logged in
/// (`user_id` + `username`). The actual authenticated session lives
/// in the **WebView's HttpOnly cookie jar** (set by gog.com itself
/// during login). When `gog_sync_library` runs it doesn't have to
/// touch this blob — it just opens a fresh WebView at gog.com and
/// asks JS to fetch data using the cookies the WebView attached
/// automatically.
///
/// This struct is therefore just a *display marker*: a cheap boolean
/// probe (`gog_is_authenticated` reads it from keyring in <5ms
/// without spinning up a WebView) and enough identity to render the
/// "Connected as <username>" tile in Settings.
///
/// `logged_in_at` is unix SECONDS — same convention as `last_sync`
/// in `GogSyncResult`. We don't use it for caching (the cookie jar
/// is the source of truth on whether the user is still logged in)
/// but the Settings UI surfaces it as "Last connected: 3 hours ago"
/// alongside the per-vendor `lastSync`.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GogSession {
    /// Numeric GOG userId (used for
    /// `https://gameplay.gog.com/clients/<user_id>/playtime`).
    pub user_id: String,
    /// Friendly username (`http://www.gog.com/u/<username>` is the
    /// canonical GOG vanity URL).
    pub username: String,
    /// Unix seconds at which `gog_start_login` completed. Mirrors
    /// the per-vendor `last_login_unix` kv-store entry that the
    /// Epic / Steam flows set — the frontend's
    /// `useToast`/connection card uses it for a "Last connected"
    /// subtitle on the integration tile.
    pub logged_in_at: u64,
}

/// Bundle the JS-side `initialization_script` posts back into Rust
/// after detecting a successful GOG login. The shape is a superset
/// of `GogSession` (the user-identity fields) plus the data fields
/// the sync flow needs; both flows share the same WebView callback
/// (`gog_webview_callback`) and serialise their payload as a
/// `GogWebviewCallbackBody`. The `sync` flow sends the full bundle
/// and Rust copies `user_id`/`username` into `GogSession` while
/// keeping the rest for the merge; the `login` flow only sets the
/// identity fields and leaves owned/playtime empty.
///
/// Rust side parses via `serde_json::from_value::<GogWebviewCallbackBody>(value)`
/// in `gog_start_login` and `gog_sync_library` and tolerates
/// missing fields (defaults are `None` / empty).
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GogWebviewCallbackBody {
    /// "Timeout waiting for GOG login" / "Network unreachable" /
    /// etc. when the JS-side probe gives up. Rust surfaces this as
    /// the outer `Err(_)` so the frontend renders it on the toast.
    #[serde(default)]
    pub error: Option<String>,

    // ── Identity (always populated when login succeeded) ────────
    #[serde(default)]
    pub user_id: Option<String>,
    #[serde(default)]
    pub username: Option<String>,

    // ── Library-only fields populated by the sync kind ───────────
    /// Top-level product IDs from
    /// `https://embed.gog.com/user/data/games` (`{ owned: [...] }`).
    /// Stored as `String` because GOG sometimes returns numeric IDs
    /// as JSON numbers and sometimes as strings depending on the
    /// endpoint — stringifying both branches here keeps the
    /// downstream HashMap key matching.
    #[serde(default)]
    pub owned: Vec<String>,
    /// Per-product playtime + last session, from
    /// `https://gameplay.gog.com/clients/<user_id>/playtime`.
    /// Each entry is parsed into a `GogPlaytimeEntry`; entries
    /// with missing `productId` are dropped.
    #[serde(default)]
    pub playtime: Vec<GogPlaytimeEntry>,
    /// Product metadata array from
    /// `https://api.gog.com/products?ids=<csv>&expand=description,images,releaseDate`.
    /// The sync flow merges this into the `HashMap<id, GogProductMeta>`
    /// for the final `Vec<GogSyncedGame>` assembly.
    #[serde(default)]
    pub metadata: Vec<GogProductMeta>,
}

/// One GOG-API product entry — metadata for a single owned game.
///
/// `gog_api::products?ids=…&expand=…` returns an array of these;
/// we extract the cover URL ourselves (`images.boxArtImage`, falling
/// back to `backgroundImage` since not every GOG product has a
/// dedicated box-art asset).
///
/// `url` is the GOG store slug (e.g. `https://www.gog.com/game/...`),
/// useful for "Open in GOG Store" links later.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GogProductMeta {
    pub id: String,
    pub title: String,
    /// Cover image, GOG-relative or absolute URL. Resolved from
    /// `images.boxArtImage` or `images.backgroundImage`.
    #[serde(default)]
    pub cover_url: Option<String>,
    /// Install size in bytes as reported by the API.
    #[serde(default)]
    pub size_bytes: Option<u64>,
    /// Steam-style release date string (e.g. "Apr 25, 2014").
    #[serde(default)]
    pub release_date: Option<String>,
    /// GOG store vanity URL.
    #[serde(default)]
    pub store_url: Option<String>,
}

/// One element of `https://gameplay.gog.com/clients/{user_id}/playtime`.
///
/// Playtime is reported in MINUTES, matching the Steam convention
/// (`playtime_forever` from `IPlayerService/GetOwnedGames`). The
/// `lastSession` field is a unix SECOND timestamp of the user's
/// last played session; we multiply by 1000 on the frontend to fit
/// the project-wide `last_played` millisecond convention.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GogPlaytimeEntry {
    pub product_id: String,
    pub playtime: u32,
    /// Unix seconds.
    #[serde(default)]
    pub last_session: Option<u64>,
}

/// A single GOG game fully reshaped for the frontend library.
///
/// This is the row that gets passed to `addGames(...)` on the React
/// side and subsequently upserted into the `games` SQLite table
/// (after the GameRow mapping in `lib.rs`).
///
/// `id` format: `gog-<game_id>` (e.g. `gog-1207658925`). The prefix
/// matches Epic's `epic-<namespace>-<item>` and Steam's `steam-<appid>`
/// so the Library / Store floats the "platform" column correctly
/// without needing a separate platform indicator.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GogSyncedGame {
    pub id: String,
    pub title: String,
    pub gog_game_id: String,
    pub is_installed: bool,
    /// Absolute path to the launchable executable, derived from the
    /// registry-detected `exe` value or the largest .exe inside the
    /// install dir. `None` when `is_installed` is false.
    #[serde(default)]
    pub install_path: Option<String>,
    #[serde(default)]
    pub install_dir: Option<String>,
    /// Playtime in MINUTES from GOG's gameplay endpoint.
    #[serde(default)]
    pub playtime_minutes: Option<u32>,
    /// Unix SECONDS — front-end converts to ms.
    #[serde(default)]
    pub last_played: Option<u64>,
    /// Cover image URL — GOG CDN host (`images.gog-static.com`).
    #[serde(default)]
    pub cover_url: Option<String>,
    /// Total install footprint in bytes when we could measure the
    /// install dir. Mirrors the Epic/Steam pattern: `None` when
    /// uninstalled or the disk walk errored.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    /// Folder the size was measured against — auditable from the
    /// Storage tab.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_root_path: Option<String>,
}

/// Result of a full GOG sync. Mirrors the Epic result shape so the
/// frontend can handle both integrations with similar logic.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GogSyncResult {
    pub success: bool,
    pub games_imported: usize,
    pub games_skipped: usize,
    pub errors: Vec<String>,
    pub last_sync: u64,
    pub synced_games: Vec<GogSyncedGame>,
}

/// Parsed contents of a `goggame-<id>.info` manifest on disk.
///
/// These files sit next to the executable inside every GOG install
/// dir (next to the `gameId` numeric directory). The file is INI-ish
/// KeyValues, but Playnite and Playwright-based harvesters parse a
/// subset that doesn't carry over quotation marks. We model only the
/// keys we care about:
/// - `gameId` — numeric id matching the install dir name.
/// - `rootGameId` — top-level product id, MAY differ from `gameId`
///   for DLCs (DLCs are tagged with the parent rootGameId). The
///   Playnite parity rule is `skip if rootGameId != gameId`.
/// - `name` — Human-readable title, available even before the
///   network round-trip.
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GogGameInfo {
    #[serde(default)]
    pub game_id: Option<String>,
    #[serde(default)]
    pub root_game_id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub install_dir: Option<String>,
}
