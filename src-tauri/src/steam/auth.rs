//! Steam authentication.
//!
//! Phase 5 model: paste-in Steam Web API key + SteamID64.
//!
//! The user obtains the API key from
//! <https://steamcommunity.com/dev/apikey> (linked from the Settings
//! UI), copies their SteamID64 from their Steam profile, and pastes
//! both into the Settings UI. `steam_connect` validates the pair
//! against `ISteamUser/GetPlayerSummaries/v2/` — HTTP 403 marks the
//! key as invalid, HTTP 200 + an empty `players` array marks the
//! key as valid against a fully private profile. The verified
//! `SteamSession` (SteamSession type from `super::types`) is stored
//! in the OS keychain under `steam_session`.
//!
//! There is intentionally no in-app Webview against Steam anymore.
//! Steam Guard 2FA, mobile authenticator prompts, and the password
//! round-trip are all sidestepped because the user logs in to Steam
//! directly on their browser to obtain the key, and we never see
//! their password.
//!
//! Phase 4 keeps the `SteamSession` blob inside the OS keychain
//! under `service=gamelib/gamelib-app, accounts steam_session`. The
//! non-sensitive `kv_store` SQLite entry `steam_last_login_unix`
//! gets stamped on success.

use tauri::{AppHandle, Manager};
use serde_json::Value;

use crate::db;

// `SteamSession` is defined in `super::types` (single source of
// truth for the wire shape consumed by both `steam_sync_games`
// and the React frontend's `SteamSession` interface).
// Re-exporting unifies the JSON keys that flow through the IPC.
pub use super::types::SteamSession;

/// User-agent for outbound HTTP to Steam. A standard Chrome UA is
/// accepted by both `api.steampowered.com` and `store.steampowered.com`.
pub(crate) const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
     (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/// URL for the `GetPlayerSummaries/v2` endpoint — used to validate
/// the user-supplied API key + SteamID64 pair at connect time.
const STEAM_PLAYER_SUMMARIES_URL: &str =
    "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/";

// ── Tauri commands ──────────────────────────────────────────────

/// Validate the user-supplied Steam API key + SteamID64 pair,
/// persist the resulting `SteamSession` to the OS keychain, and
/// return the freshly-saved session object to the frontend.
///
/// Validation URL:
/// `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/
///  ?key=<api_key>&steamids=<steam_id>`
///
/// Decision matrix:
///   * HTTP 403 Forbidden \u2192 key is invalid / revoked.
///   * HTTP 200 with empty `players` array \u2192 key is valid but the
///     SteamID doesn't correspond to a public profile (private
///     account, which Steam still treats as "valid API call").
///   * HTTP 200 with non-empty `players` array \u2192 key valid and the
///     SteamID resolves to a public profile. We surface the
///     `personaname` from the first entry as the display name,
///     which is the same name the Steam community shows.
#[tauri::command]
pub async fn steam_connect(
    app: AppHandle,
    api_key: String,
    steam_id: String,
) -> Result<SteamSession, String> {
    // ── Pre-flight validation ─────────────────────────────────────
    // Trim once and use the trimmed values for both the gate and the
    // outbound URL. Without this, a pasted `"  ABC...XYZ  "` would
    // pass the empty gate but be sent to Steam unsanitized — Steam
    // would reject it with HTTP 403 and the user would see "Invalid
    // Steam API key" without realising the culprit is stray
    // whitespace from a copy-paste.
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("Steam API key is required".to_string());
    }
    // SteamID64 is a 17-digit decimal integer. Reject anything else
    // before sending the round-trip — saves a probe call for obvious
    // typos like a pasted vanity URL ("https://steamcommunity.com/id/foo").
    if steam_id.len() != 17 || !steam_id.chars().all(|c| c.is_ascii_digit()) {
        return Err(
            "Steam ID must be a 17-digit number (SteamID64).\n\
             Find yours at https://steamcommunity.com/my"
                .to_string(),
        );
    }

    // ── Probe call ────────────────────────────────────────────────
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let url = format!(
        "{}?key={}&steamids={}",
        STEAM_PLAYER_SUMMARIES_URL, api_key, steam_id
    );

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Steam API request failed: {e}"))?;

    let status = resp.status();
    if status.as_u16() == 403 {
        return Err(
            "Steam rejected the API key (HTTP 403).\n\
             Get a new key from https://steamcommunity.com/dev/apikey"
                .to_string(),
        );
    }
    if !status.is_success() {
        return Err(format!(
            "Steam API returned HTTP {}",
            status.as_u16()
        ));
    }

    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Steam API response: {e}"))?;

    // The response shape is
    //   { "response": { "players": [ { "steamid": "...", "personaname":
    //                                  "...", ... }, ... ] } }
    // An empty `players` array means the API key works but the SteamID
    // isn't a public profile (private, banned, or just doesn't
    // exist). We accept that as a *valid* pair so the user can still
    // sync their owned games — only `GetPlayerSummaries` is muted.
    let players = body
        .get("response")
        .and_then(|r| r.get("players"))
        .and_then(|p| p.as_array());
    let players = match players {
        Some(arr) => arr,
        None => {
            return Err(
                "Steam API returned an unexpected response shape (no `response.players` array)"
                    .to_string(),
            );
        }
    };

    let display_name = players
        .first()
        .and_then(|p| p.get("personaname"))
        .and_then(|v| v.as_str())
        .map(str::to_string);

    let session = SteamSession {
        // Both values moved — neither is used after this constructor.
        steam_id,
        api_key: api_key.to_string(),
        display_name: display_name.clone(),
    };

    // ── Persist to the OS keychain ─────────────────────────────
    let store = db::secrets::SecretStore::new();
    store.set(
        "steam_session",
        &serde_json::to_string(&session).map_err(|e| e.to_string())?,
    )?;
    // Also clean up any stale `steam_config` blob from the prior
    // OpenID+RSA auth flow so the keychain doesn't accumulate dead
    // state.
    let _ = store.delete("steam_config");
    if let Some(db_state) = try_db_state(&app) {
        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = db::kv::set(
            db_state.inner(),
            "steam_last_login_unix",
            &now_secs.to_string(),
        );
        if let Some(name) = display_name {
            let _ = db::kv::set(db_state.inner(), "steam_display_name", &name);
        }
    }

    Ok(session)
}

/// Read the persisted `SteamSession` from the keychain. Returns
/// `None` if the entry is missing, the JSON is malformed, or the
/// entry doesn't match the current `SteamSession` schema.
///
/// Note: the prior `steam_get_session` self-healed malformed blobs
/// by deleting them. `#[serde(alias = "webApiToken")]` on the
/// `api_key` field means a pre-Phase-5 4-field blob decodes
/// cleanly without the self-heal path firing, so the migration is
/// friendly to existing users.
#[tauri::command]
pub fn steam_get_session(_app: AppHandle) -> Option<SteamSession> {
    let store = db::secrets::SecretStore::new();
    let secret = store.get("steam_session").ok().flatten()?;
    match serde_json::from_str::<SteamSession>(&secret) {
        Ok(s) if !s.api_key.is_empty() && !s.steam_id.is_empty() => Some(s),
        _ => {
            // Schema-evolved blob, or a stub session from an
            // earlier process that wrote zeros. Drop it so the UI
            // flips to \"Connect Steam Account\" rather than showing
            // a phantom \"Connected\" badge.
            let _ = store.delete("steam_session");
            None
        }
    }
}

#[tauri::command]
pub fn steam_is_authenticated(app: AppHandle) -> bool {
    steam_get_session(app).is_some()
}

#[tauri::command]
pub fn steam_logout(_app: AppHandle) -> Result<(), String> {
    let store = db::secrets::SecretStore::new();
    store.delete("steam_session")?;
    let _ = store.delete("steam_config");
    if let Some(db_state) = try_db_state(&_app) {
        let _ = db::kv::delete(db_state.inner(), "steam_last_login_unix");
        let _ = db::kv::delete(db_state.inner(), "steam_display_name");
    }
    Ok(())
}

// ── helpers ─────────────────────────────────────────────────────────

/// Returns the live `Arc<Db>` if it has been registered with
/// Tauri's `State` container. Earlier than `db::init` completing
/// during setup, it's not present yet; callers fall through to
/// the no-db path.
fn try_db_state(app: &AppHandle) -> Option<tauri::State<'_, db::Db>> {
    app.try_state::<db::Db>()
}
