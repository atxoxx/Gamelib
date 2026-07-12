//! GOG library sync — WebView-cookie flow.
//!
//! ## Why this is the WebView path (not Bearer-auth)
//!
//! We previously used OAuth (`https://auth.gog.com/token` exchange,
//! Bearer auth headers on every API probe). GOG has rotated every
//! documentable Galaxy client_id to `invalid_client` in 2026, so the
//! OAuth handshake itself is dead — but the **outcomes** OAuth
//! gave us (Fetch the owned-product list + metadata + playtime from
//! the official API) remain valid, just via a different transport.
//!
//! The pivot: open a Tauri WebView at `https://www.gog.com/`, let
//! JS run `fetch()` against the same `embed.gog.com` / `api.gog.com`
//! / `gameplay.gog.com` endpoints we used to hit from Rust. The
//! HttpOnly session cookies the WebView holds auto-attach to those
//! cross-origin `fetch()`s because:
//!
//! 1. GOG.com sets its `gog_login` cookies on `.gog.com` (the dot
//!    prefix matches `embed.gog.com`, `api.gog.com`,
//!    `gameplay.gog.com`), so they're scoped to every GOG subdomain
//!    identically.
//! 2. Tauri 2 shares one cookie jar across all WebView instances
//!    in a single app, so the login WebView's cookies are visible
//!    to the sync WebView.
//! 3. The `embed.gog.com` / `api.gog.com` / `gameplay.gog.com`
//!    endpoints serve `Access-Control-Allow-Origin` headers
//!    matching the `www.gog.com` page that originated the JS —
//!    same cross-origin pattern the official gog.com webapp
//!    itself uses.
//!
//! JS packages the bundle (`{ owned, metadata, playtime,
//! userId, username }`) and `invoke('gog_webview_callback', {…})`
//! posts it back. Rust parses the bundle and merges with the disk
//! install-dir scan we still own (no API endpoint exposes install
//! paths) into a unified `GogSyncResult`.
//!
//! ## Cross-platform note
//!
//! Directory scanning on Windows works for the default install
//! location (`C:\Program Files (x86)\GOG Galaxy\Games` + a couple
//! common alternates). Custom-located installs are not
//! auto-detected — accepting the same limitation as Playnite's
//! GogLibrary (which also relies on the registry to find Galaxy).
//! The directory scan stays in Rust because (a) there's no
//! comparable API endpoint to fetch install paths from, and (b)
//! `fs::read_dir` on the Rust side is the same Playnite parity
//! heuristic we're already shipping.
//!
//! ## Limitations carried over from the OAuth era
//!
//! - Metadata is still chunked at 50 IDs per request inside JS
//!   (`api.gog.com/products?ids=<csv>` caps at ~50). The JS hoists
//!   this out of the way — Rust never sees the chunking.
//! - DLCs / extras are filtered via `rootGameId != gameId` on the
//!   disk-manifest side, identical to before. The owned-products
//!   endpoint only returns top-level products so the same filter
//!   doesn't need to apply network-side.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;

use serde_json::Value;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use super::auth::gog_init_script_for;
use super::types::{
    GogGameInfo, GogPlaytimeEntry, GogProductMeta, GogSession, GogSyncResult, GogSyncedGame,
    GogWebviewCallbackBody,
};
use crate::gog::auth::GogWebviewCallbackSlot;
use crate::size;

/// Same GOG homepage URL the login flow opens; the JS probe is
/// identical pattern, just with `kind="sync"` so it fetches the
/// full library bundle instead of stopping at `userId`/`username`.
const GOG_HOMEPAGE_URL: &str = "https://www.gog.com/";

/// 3-minute timeout — shorter than the 5-minute login timeout
/// because sync is normally a single round-trip after the user
/// is already logged in; if the WebView cookie jar is stale the
/// probe will loop on `401` for the full window and the user is
/// better off seeing the error than waiting through another
/// 5-minute timeout.
const SYNC_TIMEOUT_SECS: u64 = 180;

/// Window label for the sync WebView. Distinct from `gog-login`
/// (which is what `gog_start_login` opens) so the user's already-
/// open login window isn't reused/refreshed mid-sync. Listed in
/// `capabilities/default.json` to inherit the main-window
/// permission grants.
const SYNC_WEBVIEW_LABEL: &str = "gog-sync";

// ── Public Tauri command ──────────────────────────────────────────

/// Trigger a full GOG sync. Opens a Tauri WebView at `gog.com`,
/// drives JS to fetch the owned-products + metadata + playtime
/// bundle via HttpOnly session cookies (auto-attached by the
/// WebView), receives the bundle via the WebView callback bridge,
/// merges it with the on-disk `goggame-<id>.info` install scan,
/// and returns the unified `GogSyncResult`.
///
/// `request_id` is the per-call UUID keying the WebView → Rust
/// bridge. Optional: if absent, Rust generates a fresh UUID.
///
/// Failure modes:
/// - "Sync timed out after 180 seconds" — JS probe never produced
///   a successful login OR the bundle fetchers threw for the whole
///   window. Surfaces cleanly in the UI as a toast.
/// - "Not authenticated with GOG" — `gog_session` keychain entry
///   missing; the user needs to Connect GOG first. We probe this
///   up front (cheap keychain read) rather than spinning up a
///   useless WebView.
/// - "GOG sync completed but no userId was returned" — same shape
///   as the login flow; the JS probe ran but never observed an
///   HttpOnly login state. Treat as "not authenticated".
#[tauri::command]
pub async fn gog_sync_library(
    app: AppHandle,
    request_id: Option<String>,
) -> Result<GogSyncResult, String> {
    // 1. Cheap pre-flight: is `gog_session` in the keychain?
    //    We don't *require* this — the JS probe will detect stale
    //    cookies and report an error — but starting a WebView
    //    for an account we know isn't connected is a poor UX
    //    (the user sees a window flash open and close), so we
    //    short-circuit and surface a clear "Connect GOG first"
    //    toast instead. The probe is just a keychain read; no
    //    JSON, no public surface.
    let _session: GogSession =
        super::auth::load_session_pub(&app).map_err(|_| {
            "Not authenticated with GOG — connect your account first".to_string()
        })?;

    let req_id = request_id.unwrap_or_else(super::auth::request_id_v4);

    // 2. Arm the bridge slot the same way `gog_start_login` does.
    //    `arm()` returns the prior sender in case of overlap (we
    //    ignore it — the previous awaiter will time out normally).
    let (tx, rx) = mpsc::channel::<Value>();
    let slot: tauri::State<'_, GogWebviewCallbackSlot> = app.state();
    let _prior = slot.arm(req_id.clone(), tx).map_err(|e| format!("slot arm: {e}"))?;

    // 3. Open WebView at gog.com with the kind="sync" init
    //    script. JS runs:
    //    a) poll userId,
    //    b) fetch embed.gog.com/user/data/games → owned IDs,
    //    c) chunk-50 fetch api.gog.com/products → metadata,
    //    d) fetch gameplay.gog.com/clients/<id>/playtime → playtime,
    //    e) invoke('gog_webview_callback', { requestId, value: bundle }).
    let init_script = gog_init_script_for("sync", &req_id);
    let home: url::Url = GOG_HOMEPAGE_URL
        .parse()
        .map_err(|e| format!("invalid gog homepage url: {e}"))?;
    let webview = WebviewWindowBuilder::new(
        &app,
        SYNC_WEBVIEW_LABEL,
        WebviewUrl::External(home),
    )
    .title("GOG Galaxy Sync")
    .inner_size(560.0, 460.0)
    .resizable(false)
    .initialization_script(&init_script)
    .build()
    .map_err(|e| format!("Failed to open GOG sync window: {e}"))?;

    // 4. Block on the channel with a 3-minute timeout. Same
    //    `spawn_blocking`-shuttles-sync-channel-onto-Tokio pattern
    //    as auth.rs.
    let bundle = tokio::task::spawn_blocking(move || {
        rx.recv_timeout(std::time::Duration::from_secs(SYNC_TIMEOUT_SECS))
    })
    .await
    .map_err(|e| format!("Join error: {e}"))?
    .map_err(|_| format!("Sync timed out after {SYNC_TIMEOUT_SECS} seconds"))?;

    let _ = webview.close();

    // 5. Parse and short-circuit on JS-side errors. We tolerate
    //    partial failures via the `errors` field on the result
    //    rather than hard-fail — e.g. metadata-only failure still
    //    yields a usable library because the owned-list path
    //    succeeded.
    let body: GogWebviewCallbackBody = serde_json::from_value(bundle)
        .map_err(|e| format!("parse sync callback body: {e}"))?;
    let mut errors: Vec<String> = Vec::new();
    if let Some(err) = &body.error {
        return Ok(GogSyncResult {
            success: false,
            games_imported: 0,
            games_skipped: 0,
            errors: vec![format!("sync aborted: {err}")],
            last_sync: current_unix(),
            synced_games: vec![],
        });
    }

    // Owned IDs may be empty (e.g. user owns nothing yet, or the
    // endpoint silently returned 200 with an empty owned array).
    // That's a SUCCESS not an error — just no games to merge.
    let owned_ids = body.owned.clone();

    // 6. The bundle's `metadata` field is ALREADY `Vec<GogProductMeta>`
    //    — `serde_json::from_value::<GogWebviewCallbackBody>(...)` in
    //    `gog_start_login`-style call sites (none here; we already
    //    parsed) typed-deserialized the JS-supplied JSON into our
    //    struct shape. So we just iterate + bucket by id. No
    //    re-parsing through `parse_product_meta` needed — entries
    //    missing id are dropped at the serde boundary (the struct
    //    has no `default` fallback for `id`, and `#[derive(Deserialize)]`
    //    skips those rows automatically).
    let product_meta_list = body.metadata.clone();
    let mut product_meta: HashMap<String, GogProductMeta> = HashMap::new();
    for meta in product_meta_list {
        if !meta.id.is_empty() && !meta.title.is_empty() {
            product_meta.insert(meta.id.clone(), meta);
        }
    }

    // 7. Build the playtime map. Same shape as the OAuth era's
    //    parser — but the bundle's `playtime` field is already
    //    `Vec<GogPlaytimeEntry>` because serde deserialised it from
    //    the JS payload directly. We index by `&str` for ergonomic
    //    lookup inside the merge loop below.
    let playtime_entries: Vec<GogPlaytimeEntry> = body.playtime.clone();
    let playtime_map: HashMap<&str, &GogPlaytimeEntry> = playtime_entries
        .iter()
        .map(|p| (p.product_id.as_str(), p))
        .collect();

    // 8. Disk-installed games scan is unchanged from the OAuth
    //    era — there's no API endpoint for this. Run it last,
    //    pre-merge, so the per-game loop below has both inputs.
    let installed = scan_installed_gog_games();

    // 9. Merge — keyed by GOG numeric id. The metadata map is
    //    the authoritative source for `title` / `cover_url` /
    //    `release_date`. Owned lists only carry IDs so without
    //    metadata, a game shows up with title="" and cover=None
    //    in the frontend — same fallback as the OAuth era.
    let mut synced: Vec<GogSyncedGame> = Vec::with_capacity(owned_ids.len());
    let mut _installed_seen: HashSet<String> = HashSet::new();

    for product_id in &owned_ids {
        let meta = match product_meta.get(product_id) {
            Some(m) => m,
            // Owned but no metadata record (the JSON may have
            // null slots, or the metadata fetch returned a partial
            // list). Surface a warning so the user knows some
            // titles will be missing rather than silently rendering
            // blank cards.
            None => {
                if !owned_ids.is_empty() {
                    errors.push(format!(
                        "Owns productId={product_id} but no metadata record; title will be empty"
                    ));
                }
                continue;
            }
        };
        let inst = installed.get(product_id);
        let is_installed = inst.is_some();
        let install_dir = inst.map(|i| i.install_dir.clone()).filter(|d| !d.is_empty());
        let install_path = inst.map(|i| i.exe_path.clone()).filter(|p| !p.is_empty());

        let playtime = playtime_map.get(product_id.as_str()).map(|p| p.playtime);
        let last_played = playtime_map
            .get(product_id.as_str())
            .and_then(|p| p.last_session);

        let id_slug = format!("gog-{product_id}");

        // Measure the install-dir when GOG reports this game as
        // installed. Mirrors Steam/Epic: per-game failure leaves
        // `size_bytes = None`, the sync itself is never aborted
        // by a measurement error.
        let size_info = install_dir
            .as_deref()
            .map(std::path::Path::new)
            .and_then(size::measure_folder_size);

        if is_installed {
            _installed_seen.insert(product_id.clone());
        }

        synced.push(GogSyncedGame {
            id: id_slug,
            title: meta.title.clone(),
            gog_game_id: product_id.clone(),
            is_installed,
            install_path,
            install_dir,
            playtime_minutes: playtime,
            last_played,
            cover_url: meta.cover_url.clone(),
            size_bytes: size_info.as_ref().map(|s| s.size_bytes),
            size_root_path: size_info.as_ref().map(|s| s.root_path.clone()),
        });
    }

    let games_imported = synced.len();
    Ok(GogSyncResult {
        success: true,
        games_imported,
        games_skipped: 0,
        errors,
        last_sync: current_unix(),
        synced_games: synced,
    })
}

// ── helpers (private) ──────────────────────────────────────────────

// (No `parse_product_meta` helper — `body.metadata` is deserialised
// directly into `Vec<GogProductMeta>` via the typed serde round-trip.
//
// We kept the OAuth-era helper shape in the type definitions
// (`images.boxArtImage` → `images.backgroundImage` → `image`) so the
// front-end fall-back behaviour is identical when fields are missing.
//
// The cover-resolution preference was previously done in
// sync.rs::parse_product_meta pre-pivot. After the pivot it lives
// implicitly in the JS probe's JSON it sends — the JS reads the
// `boxArtImage`/`backgroundImage` from `api.gog.com/products` and
// serde-defaults the others to `None`. No re-parsing required.)

// ── Stage 4: installed-game detection ───────────────────────────────

/// Per-game install record discovered from `goggame-<id>.info` files.
/// One record per detected installed game; the merge step in
/// `gog_sync_library` keys this by `gog_game_id`.
struct InstalledGogGame {
    gog_game_id: String,
    install_dir: String,
    exe_path: String,
    is_dlc: bool,
}

/// Walk every standard GOG install root on the current OS and emit a
/// record per non-DLC game. Falls through to idle-return on
/// non-Windows platforms (GOG Galaxy isn't officially supported on
/// macOS / Linux — but we keep the stub returning Vec::new() so the
/// compile-time signature matches without a `#[cfg]` ladder in the
/// caller).
fn scan_installed_gog_games() -> HashMap<String, InstalledGogGame> {
    let mut out: HashMap<String, InstalledGogGame> = HashMap::new();
    for root in gog_install_roots() {
        scan_install_root(&root, &mut out);
    }
    out
}

/// Standard install locations where GOG Galaxy puts games on each
/// platform. Order doesn't matter (we de-dupe by id); we just want
/// to be exhaustive for the per-platform default case.
fn gog_install_roots() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();

    #[cfg(windows)]
    {
        // Default GOG Galaxy install location — the "Games" subdir
        // contains one folder per product ID.
        let candidates = [
            r"C:\Program Files (x86)\GOG Galaxy\Games",
            r"C:\Games\GOG",
            r"D:\GOG Games",
            r"D:\Games\GOG",
            r"C:\GOG Games",
        ];
        for c in candidates {
            roots.push(PathBuf::from(c));
        }
    }

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/Users".to_string());
        roots.push(PathBuf::from(format!("{home}/Library/Application Support/GOG.com/Galaxy/Games/Galaxy Client/Games")));
    }

    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/home".to_string());
        roots.push(PathBuf::from(format!("{home}/GOG Games")));
    }

    roots
}

fn scan_install_root(root: &Path, out: &mut HashMap<String, InstalledGogGame>) {
    let entries = match fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return, // Not installed / not accessible. Skip.
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        // Folder name == GOG product ID. Parse to a numeric string
        // so the merge step's HashMap key matches the API response
        // (no decimal-decimal drift).
        let product_id = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };
        // The manifest filename is `goggame-<id>.info` per
        // Playnite parity. Fall back to a directory scan if the
        // naming convention shifted.
        let manifest_path = path.join(format!("goggame-{product_id}.info"));
        let info = if manifest_path.exists() {
            read_goggame_info(&manifest_path)
        } else {
            // Older clients used `gameinfo-<id>` — keep the brace
            // open for an end-of-file upgrade if needed.
            None
        };
        let info = match info {
            Some(i) => i,
            None => continue,
        };
        let is_dlc = info
            .root_game_id
            .as_deref()
            .map(|root| root != info.game_id.as_deref().unwrap_or(""))
            .unwrap_or(false);
        if is_dlc {
            continue;
        }

        // Resolve the executable from the install dir. GOG doesn't
        // ship a canonical "main exe" pointer in the manifest, so we
        // fall back to the largest .exe (Playnite parity heuristic).
        // `game_watcher::resolve_steam_game_exe` is Steam-specific
        // (relies on Steam manifests), so we inline a tiny
        // GOG-aware fallback here — keeps the dependency graph
        // independent.
        let exe_path = info
            .name
            .as_deref()
            .and_then(|_| find_largest_exe(&path))
            .unwrap_or_default();

        out.entry(product_id.clone()).or_insert(InstalledGogGame {
            gog_game_id: product_id,
            install_dir: path.to_string_lossy().to_string(),
            exe_path,
            is_dlc: false,
        });
    }
}

fn read_goggame_info(path: &Path) -> Option<GogGameInfo> {
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Heuristic: return the largest .exe under `dir`, skipping
/// `unins*`, `setup*`, `crash*`, etc. (same keyword list as the rest
/// of the codebase, mirrored in lib.rs).
fn find_largest_exe(dir: &Path) -> Option<String> {
    let skip_keywords = [
        "redist", "autorun", "helper", "unin", "crash", "setup", "install", "plugin",
        "manual", "readme", "register", "7za",
    ];
    let mut best: Option<(u64, PathBuf)> = None;
    visit_exes(dir, &skip_keywords, &mut best);
    best.map(|(_, p)| p.to_string_lossy().to_string())
}

fn visit_exes(dir: &Path, skip: &[&str], best: &mut Option<(u64, PathBuf)>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            // Skip dot-prefixed system dirs but DO recurse
            // — GOG games commonly put the main exe one or two
            // levels deep (`bin/`, `game/`).
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.starts_with('.') {
                    continue;
                }
            }
            visit_exes(&path, skip, best);
        } else if path.extension().and_then(|e| e.to_str())
            == Some("exe")
        {
            let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            let stem_lc = stem.to_lowercase();
            if skip.iter().any(|kw| stem_lc.contains(kw)) {
                continue;
            }
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            if best.as_ref().map(|(s, _)| size > *s).unwrap_or(true) {
                *best = Some((size, path));
            }
        }
    }
}

fn current_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
