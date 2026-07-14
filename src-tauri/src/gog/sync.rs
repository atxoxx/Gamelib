//! GOG library sync — pure-Rust orchestrator (Bearer-token + cookies).
//!
//! Flow:
//! 1. Token pre-flight — load tokens, refresh if expiring.
//! 2. Load session cookies from kv_store — embed.gog.com requires
//!    cookie-based auth even with OAuth2 tokens.
//! 3. Build `GogClient` from access token + cookie jar.
//! 4. Probe `menu.gog.com/v1/account/basic` to verify the token
//!    still works — if !isLoggedIn or HTTP error, surface a clean
//!    "session expired" error.
//! 5. Run owned-games + playtime probe **in parallel** via
//!    `tokio::try_join!`, then bulk-metadata chunked at 50 ids.
//! 6. Local-installed scan via `installed::scan_installed_gog_games`.
//! 7. Merge keyed by `gog_game_id`; measure install dir size when
//!    we have one.
//!
//! Pure-Rust — no WebView.

use std::collections::{HashMap, HashSet};

use tauri::{AppHandle, Manager};

use super::auth::refresh_tokens_if_needed;
use super::client::GogClient;
use super::cookies;
use super::installed::scan_installed_gog_games;
use super::types::{
    GogGameStats, GogInstalledGame, GogPlaytimeMirror, GogSyncResult,
    GogSyncedGame,
};
use crate::db;
use crate::gog::auth::load_session_pub;
use crate::size;

/// Public Tauri command — orchestrates the full sync and returns
/// the typed result. Pure-Rust; no WebView.
#[tauri::command]
pub async fn gog_sync_library(app: AppHandle) -> Result<GogSyncResult, String> {
    // 1. Token pre-flight — refresh if within 5 min of expiry.
    let tokens = refresh_tokens_if_needed(&app).await.map_err(|e| {
        format!(
            "GOG token refresh failed — click 'Connect GOG Account' in Settings to re-authenticate. Detail: {e}"
        )
    })?;

    // 2. Load session for identity fallback.
    let session = load_session_pub(&app).map_err(|_| {
        "Not authenticated with GOG — connect your account first".to_string()
    })?;

    // 2b. Load session cookies for embed.gog.com requests.
    let cookie_jar = load_cookie_jar(&app);

    // 3. Build the HTTP client + verify token still works.
    let client = GogClient::from_token(&tokens.access_token, cookie_jar)
        .map_err(|e| format!("build GOG HTTP client: {e}"))?;
    let probe = client.get_account_basic().await?;
    if !probe.is_logged_in {
        return Err("GOG session expired — reconnect your account".to_string());
    }
    let user_id_for_playtime = if probe.user_id.is_empty() {
        session.galaxy_user_id.clone().unwrap_or_default()
    } else {
        probe.user_id.clone()
    };

    // 4. Fetch owned IDs + playtime in parallel.
    let playtime_fut = async {
        if user_id_for_playtime.is_empty() {
            Ok(Vec::<GogPlaytimeMirror>::new())
        } else {
            client.get_playtime(&user_id_for_playtime).await
        }
    };
    let (owned_ids_raw, playtime_vec): (Vec<String>, Vec<GogPlaytimeMirror>) =
        tokio::try_join!(client.get_owned_ids(), playtime_fut)?;
    let playtime_fallback = build_playtime_fallback(&playtime_vec);

    // 5. Deduplicate + bulk metadata chunked at 50 ids.
    let owned_ids: Vec<String> = {
        let mut seen = HashSet::new();
        owned_ids_raw
            .into_iter()
            .filter(|id| !id.is_empty() && seen.insert(id.clone()))
            .collect()
    };
    let product_meta = client.get_bulk_metadata(&owned_ids).await?;

    // 6. Install-side scan.
    let installed = scan_installed_gog_games();
    let installed_by_id: HashMap<&str, &GogInstalledGame> =
        installed.iter().map(|i| (i.game_id.as_str(), i)).collect();

    // 7. Merge loop — keyed by GOG numeric id.
    // Metadata may be unavailable (api.gog.com rejects non-Galaxy
    // clients) — fall back to minimal entries with product-id titles.
    let mut errors: Vec<String> = Vec::new();
    let mut synced: Vec<GogSyncedGame> = Vec::with_capacity(owned_ids.len());
    let mut meta_missing = 0usize;
    for product_id in &owned_ids {
        if product_id.is_empty() {
            continue;
        }
        let (title, cover_url) = match product_meta.get(product_id) {
            Some(m) => (m.title.clone(), m.cover_url.clone()),
            None => {
                meta_missing += 1;
                (
                    format!("GOG Game {product_id}"),
                    None,
                )
            }
        };
        let inst = installed_by_id.get(product_id.as_str()).copied();
        let is_installed = inst.is_some();
        let install_dir = inst.map(|i| i.install_dir.clone()).filter(|d| !d.is_empty());
        let install_path = inst.map(|i| i.exe_path.clone()).filter(|p| !p.is_empty());

        // Stats come from playtime fallback only — the cookie-auth
        // owned endpoint returns bare IDs, not inline stats objects.
        let (playtime_minutes, last_played) = playtime_fallback
            .get(product_id.as_str())
            .map(|p| (Some(p.playtime), p.last_session))
            .unwrap_or((None, None));

        let size_info = install_dir
            .as_deref()
            .map(std::path::Path::new)
            .and_then(size::measure_folder_size);

        synced.push(GogSyncedGame {
            id: format!("gog-{product_id}"),
            title,
            gog_game_id: product_id.clone(),
            is_installed,
            install_path,
            install_dir,
            playtime_minutes,
            last_played,
            cover_url,
            size_bytes: size_info.as_ref().map(|s| s.size_bytes),
            size_root_path: size_info.as_ref().map(|s| s.root_path.clone()),
        });
    }
    if meta_missing > 0 {
        errors.push(format!(
            "{} of {} owned games have no metadata — using fallback titles (GOG's metadata API is not accessible)",
            meta_missing,
            owned_ids.len()
        ));
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

// ── Helpers ─────────────────────────────────────────────────────────

/// Load persisted GOG session cookies and build a reqwest jar.
/// embed.gog.com/user/data/games requires cookie-based auth —
/// the Bearer token alone is not accepted by this endpoint.
fn load_cookie_jar(app: &AppHandle) -> Option<std::sync::Arc<reqwest::cookie::Jar>> {
    let db_state = app.try_state::<db::Db>()?;
    let cookies = cookies::load(db_state.inner())?;
    match cookies::arc_jar_from(&cookies) {
        Ok(jar) => {
            eprintln!(
                "[gog-sync] built cookie jar from {} records",
                cookies.records.len()
            );
            Some(jar)
        }
        Err(e) => {
            eprintln!("[gog-sync] failed to build cookie jar: {e}");
            None
        }
    }
}

fn build_playtime_fallback(rows: &[GogPlaytimeMirror]) -> HashMap<String, GogGameStats> {
    let mut out: HashMap<String, GogGameStats> = HashMap::new();
    for row in rows {
        if row.product_id.is_empty() {
            continue;
        }
        out.insert(
            row.product_id.clone(),
            GogGameStats {
                playtime: row.playtime,
                last_session: row.last_session,
            },
        );
    }
    out
}

fn current_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
