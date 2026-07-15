//! Epic Games authentication — OAuth WebView login + token exchange.
//!
//! Token persistence: SQLite `kv_store` table under key `epic_tokens`.
//! The OS keychain (`db::secrets::SecretStore`) was previously used but
//! the `keyring` crate's Windows backend (`CredWriteW`) **silently fails
//! to persist credentials when the service name contains a slash**
//! (`gamelib/gamelib-app`). This caused the exact symptom where login
//! appeared to succeed (the HTTP token exchange returned 200 + tokens)
//! but the subsequent sync said "not connected" — `save_tokens` wrote
//! to the keychain, `CredWriteW` silently dropped it, `load_tokens`
//! found nothing, and `epic_is_authenticated` returned false.
//!
//! The GOG integration already migrated to `kv_store` for the same
//! reason; this module now mirrors that pattern. A readback check
//! after every `save_tokens` catches any future silent persistence
//! failure so we never return `Ok(())` without verified storage.
//!
//! Legacy keychain entries (from macOS/Linux where `keyring` works)
//! are auto-migrated to `kv_store` on first `load_tokens` call.

use std::sync::mpsc;

use reqwest::Client;
use serde_json::Value;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use super::types::EpicAuthTokens;
use crate::db;

// ── Epic Launcher OAuth constants (from Playnite's EpicLibrary) ─────
const EPIC_AUTH_ENCODED: &str =
    "MzRhMDJjZjhmNDQxNGUyOWIxNTkyMTg3NmRhMzZmOWE6ZGFhZmJjY2M3Mzc3NDUwMzlkZmZlNTNkOTRmYzc2Y2Y=";

const EPIC_TOKEN_URL: &str =
    "https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token";

const EPIC_LOGIN_URL: &str =
    "https://www.epicgames.com/id/login?responseType=code";

const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) EpicGamesLauncher";

// ── Persistence keys ────────────────────────────────────────────────
/// SQLite `kv_store` key for the Epic OAuth tokens blob (compact JSON).
const EPIC_TOKENS_KV_KEY: &str = "epic_tokens";
/// Legacy OS-keychain account name. Used for one-time migration
/// (macOS/Linux where `keyring` actually works) and for cleanup in
/// `epic_logout`.
const LEGACY_EPIC_TOKENS_KEYRING_ACCOUNT: &str = "epic_tokens";

// ── Tauri commands ──────────────────────────────────────────────────

#[tauri::command]
pub async fn epic_start_login(app: AppHandle) -> Result<String, String> {
    let (tx, rx) = mpsc::channel();

    let webview = WebviewWindowBuilder::new(
        &app,
        "epic-login",
        WebviewUrl::External(
            EPIC_LOGIN_URL
                .parse()
                .map_err(|e| format!("Invalid URL: {e}"))?,
        ),
    )
    .title("Epic Games Login")
    .inner_size(580.0, 700.0)
    .resizable(false)
    .user_agent(USER_AGENT)
    .on_navigation(move |url| {
        let url_str = url.as_str();
        if url_str.contains("localhost/launcher/authorized") {
            if let Some(code) = extract_code_from_url(url_str) {
                let _ = tx.send(Some(code));
                return false;
            }
        }
        true
    })
    .build()
    .map_err(|e| format!("Failed to create login window: {e}"))?;

    let code = tokio::task::spawn_blocking(move || {
        match rx.recv_timeout(std::time::Duration::from_secs(300)) {
            Ok(Some(code)) => Ok(code),
            Ok(None) => Err("Login failed — no authorization code received".to_string()),
            Err(_) => Err("Login timed out after 5 minutes".to_string()),
        }
    })
    .await
    .map_err(|e| format!("Join error: {e}"))??;

    let _ = webview.close();
    Ok(code)
}

#[tauri::command]
pub async fn epic_finish_login(app: AppHandle, auth_code: String) -> Result<EpicAuthTokens, String> {
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let response = client
        .post(EPIC_TOKEN_URL)
        .header("Authorization", format!("basic {EPIC_AUTH_ENCODED}"))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(format!(
            "grant_type=authorization_code&code={auth_code}&token_type=eg1"
        ))
        .send()
        .await
        .map_err(|e| format!("Token request failed: {e}"))?;

    let status = response.status();
    let body_text = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(format!(
            "Token exchange failed (HTTP {status}): {body_text}"
        ));
    }

    let json: Value = serde_json::from_str(&body_text)
        .map_err(|e| format!("Failed to parse token response: {e}"))?;

    let access_token = json["access_token"]
        .as_str()
        .ok_or_else(|| "Missing access_token in response".to_string())?
        .to_string();
    let refresh_token = json["refresh_token"]
        .as_str()
        .ok_or_else(|| "Missing refresh_token in response".to_string())?
        .to_string();
    let expires_in = json["expires_in"].as_u64().unwrap_or(3600);
    let account_id = json["account_id"].as_str().unwrap_or("unknown").to_string();
    let display_name = json["displayName"].as_str().map(|s| s.to_string());

    let tokens = EpicAuthTokens {
        access_token,
        refresh_token,
        expires_at: current_unix() + expires_in,
        account_id,
        display_name,
    };

    save_tokens(&app, &tokens)?;
    Ok(tokens)
}

/// Recover a lost Epic session by exchanging a previously-saved
/// `refreshToken` (from localStorage legacy state before the
/// security fix) for fresh tokens.
///
/// This is the one-click recovery path for users whose OS
/// keychain entry was wiped (Credential Manager rebuild, secret-service
/// daemon restart with a stale collection, etc.) but who still have
/// a valid `refreshToken` lingering in `gamelib-epic-sync-info` from
/// a prior login. The frontend's recovery banner surfaces this
/// command automatically when the mount probe detects
/// `isAuthenticated == false` AND localStorage has a parseable
/// `refreshToken`.
///
/// On success: writes the resulting fresh tokens to the SQLite `kv_store`
/// via `save_tokens` (with readback verification) AND returns the same
/// `EpicAuthTokens` struct to
/// the frontend (which is expected to overwrite its localStorage
/// copy with the safe metadata-only shape immediately afterward —
/// see `handleEpicRecoverSession` in `SettingsPage.tsx`).
///
/// On Epic revocation (`HTTP 400 invalid_grant`): the caller bubbles
/// the error verbatim, the frontend clears the stale banner, and the
/// user falls back to a normal `Connect Epic Account` WebView flow.
#[tauri::command]
pub async fn epic_login_with_refresh_token(
    app: AppHandle,
    refresh_token: String,
    account_id: String,
    display_name: Option<String>,
) -> Result<EpicAuthTokens, String> {
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let response = client
        .post(EPIC_TOKEN_URL)
        .header("Authorization", format!("basic {EPIC_AUTH_ENCODED}"))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(format!(
            "grant_type=refresh_token&refresh_token={refresh_token}&token_type=eg1"
        ))
        .send()
        .await
        .map_err(|e| format!("Token refresh request failed: {e}"))?;

    let status = response.status();
    let body_text = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(format!(
            "Token refresh failed (HTTP {status}): {body_text}"
        ));
    }

    let json: Value = serde_json::from_str(&body_text)
        .map_err(|e| format!("Failed to parse refresh response: {e}"))?;

    let access_token = json["access_token"]
        .as_str()
        .ok_or_else(|| "Missing access_token in response".to_string())?
        .to_string();
    let new_refresh_token = json["refresh_token"]
        .as_str()
        .ok_or_else(|| "Missing refresh_token in response".to_string())?
        .to_string();
    let expires_in = json["expires_in"].as_u64().unwrap_or(3600);

    // Prefer the supplied account_id/display_name so the recovered
    // session stays attributed to the user the frontend cached. Only
    // fall back to whatever Epic returns if the caller genuinely
    // doesn't have one (legacy localStorage entries predate this
    // expectation).
    let resolved_account_id = if account_id.is_empty() || account_id == "unknown" {
        json["account_id"].as_str().unwrap_or("unknown").to_string()
    } else {
        account_id
    };
    let resolved_display_name = display_name.or_else(|| {
        json["displayName"].as_str().map(|s| s.to_string())
    });

    let tokens = EpicAuthTokens {
        access_token,
        refresh_token: new_refresh_token,
        expires_at: current_unix() + expires_in,
        account_id: resolved_account_id,
        display_name: resolved_display_name,
    };

    save_tokens(&app, &tokens)?;
    Ok(tokens)
}

#[tauri::command]
pub fn epic_is_authenticated(app: AppHandle) -> bool {
    load_tokens(&app).is_ok()
}

/// Wipe Epic tokens from both the current kv_store layer and the
/// legacy OS-keychain entry (for users upgrading from the
/// keychain-based persistence that silently failed on Windows).
///
/// Also drops the `epic_last_login_unix` kv entry so the next
/// login triggers a fresh library fetch.
#[tauri::command]
pub fn epic_logout(app: AppHandle) -> Result<(), String> {
    // Clean up legacy keychain entry (may not exist — delete is idempotent).
    let store = db::secrets::SecretStore::new();
    let _ = store.delete(LEGACY_EPIC_TOKENS_KEYRING_ACCOUNT);
    // Clean up the current kv_store entry.
    if let Some(db_state) = try_db_state(&app) {
        let _ = db::kv::delete(db_state.inner(), EPIC_TOKENS_KV_KEY);
        let _ = db::kv::delete(db_state.inner(), "epic_last_login_unix");
    }
    Ok(())
}

pub async fn refresh_tokens_if_needed(app: &AppHandle) -> Result<EpicAuthTokens, String> {
    let tokens = load_tokens(app)?;
    if tokens.expires_at > current_unix() + 300 {
        return Ok(tokens);
    }

    let client = Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let response = client
        .post(EPIC_TOKEN_URL)
        .header("Authorization", format!("basic {EPIC_AUTH_ENCODED}"))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(format!(
            "grant_type=refresh_token&refresh_token={}&token_type=eg1",
            tokens.refresh_token
        ))
        .send()
        .await
        .map_err(|e| format!("Token refresh failed: {e}"))?;

    let status = response.status();
    let body_text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "Token refresh failed (HTTP {status}): {body_text}"
        ));
    }

    let json: Value = serde_json::from_str(&body_text)
        .map_err(|e| format!("Failed to parse refresh response: {e}"))?;

    let access_token = json["access_token"]
        .as_str()
        .ok_or_else(|| "Missing access_token".to_string())?
        .to_string();
    let refresh_token = json["refresh_token"]
        .as_str()
        .unwrap_or(&tokens.refresh_token)
        .to_string();
    let expires_in = json["expires_in"].as_u64().unwrap_or(3600);

    let new_tokens = EpicAuthTokens {
        access_token,
        refresh_token,
        expires_at: current_unix() + expires_in,
        account_id: tokens.account_id,
        display_name: tokens.display_name,
    };

    save_tokens(app, &new_tokens)?;
    Ok(new_tokens)
}

// ── utilities ──────────────────────────────────────────────────────

/// Extract the `code` param from a URL like
/// `http://localhost/launcher/authorized?code=abc123`.
fn extract_code_from_url(url: &str) -> Option<String> {
    let query = url.find('?').map(|i| &url[i + 1..])?;
    for param in query.split('&') {
        let mut kv = param.splitn(2, '=');
        if kv.next()? == "code" {
            let val = kv.next()?;
            return Some(
                urlencoding::decode(val)
                    .unwrap_or_else(|_| val.into())
                    .into_owned(),
            );
        }
    }
    None
}

fn current_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Persist Epic OAuth tokens to the SQLite `kv_store` table.
///
/// This replaces the previous OS-keychain storage, which silently
/// failed on Windows because the `keyring` crate's `CredWriteW`
/// backend drops credentials when the service name contains a
/// slash (`gamelib/gamelib-app`). That caused login to appear to
/// succeed (the HTTP exchange returned tokens) but sync to report
/// "not connected" because `load_tokens` found nothing.
///
/// A readback check catches any future silent persistence failure
/// so we never return `Ok(())` without verified storage — mirrors
/// the GOG integration's defensive pattern.
fn save_tokens(app: &AppHandle, tokens: &EpicAuthTokens) -> Result<(), String> {
    let json = serde_json::to_string(tokens).map_err(|e| format!("serialize tokens: {e}"))?;
    let db_state = try_db_state(app)
        .ok_or_else(|| "Database not initialized — cannot persist Epic tokens".to_string())?;
    eprintln!(
        "[epic-auth] save_tokens: writing {} bytes to kv_store key='{}'",
        json.len(),
        EPIC_TOKENS_KV_KEY
    );
    db::kv::set(db_state.inner(), EPIC_TOKENS_KV_KEY, &json)?;

    // ── Verify the write actually persisted ──────────────────
    // Without this, a silent persistence failure (like the
    // keychain `CredWriteW` bug) would make login appear to
    // succeed while sync later reports "not connected".
    match db::kv::get(db_state.inner(), EPIC_TOKENS_KV_KEY) {
        Ok(Some(readback)) if readback == json => {
            eprintln!(
                "[epic-auth] save_tokens: readback verified — {} bytes match",
                readback.len()
            );
        }
        Ok(Some(readback)) => {
            eprintln!(
                "[epic-auth] save_tokens: WARNING — readback MISMATCH! wrote {} bytes, read {} bytes",
                json.len(),
                readback.len()
            );
            return Err("Epic token persistence failed — readback mismatch. The database may be read-only or corrupted.".to_string());
        }
        Ok(None) => {
            eprintln!("[epic-auth] save_tokens: CRITICAL — kv set returned Ok but get returned None!");
            return Err("Epic token persistence failed — write succeeded but readback returned nothing.".to_string());
        }
        Err(e) => {
            eprintln!("[epic-auth] save_tokens: CRITICAL — kv set returned Ok but get failed: {e}");
            return Err(format!("Epic token persistence failed — readback error: {e}"));
        }
    }

    // Stash the login timestamp as non-sensitive metadata.
    let now_secs = current_unix().to_string();
    let _ = db::kv::set(db_state.inner(), "epic_last_login_unix", &now_secs);
    Ok(())
}

/// Load Epic OAuth tokens from the SQLite `kv_store` table.
///
/// Falls back to the legacy OS-keychain entry (if present) for
/// one-time migration on macOS/Linux where `keyring` actually
/// works. On Windows the keychain entry was never written
/// (silent `CredWriteW` failure), so this fallback is a no-op
/// there — the user simply re-logs in once.
fn load_tokens(app: &AppHandle) -> Result<EpicAuthTokens, String> {
    let db_state = try_db_state(app)
        .ok_or_else(|| "Database not initialized".to_string())?;

    // ── Primary: SQLite kv_store ────────────────────────────
    match db::kv::get(db_state.inner(), EPIC_TOKENS_KV_KEY) {
        Ok(Some(raw)) => {
            eprintln!("[epic-auth] load_tokens: found {} bytes in kv_store", raw.len());
            return serde_json::from_str(&raw)
                .map_err(|e| format!("Failed to parse Epic tokens: {e}"));
        }
        Ok(None) => {
            eprintln!("[epic-auth] load_tokens: kv_store returned None — checking legacy keychain");
        }
        Err(e) => {
            eprintln!("[epic-auth] load_tokens: kv_store get failed: {e} — checking legacy keychain");
        }
    }

    // ── Fallback: legacy OS-keychain (one-time migration) ───
    // On macOS/Linux the keychain works, so a user who logged in
    // before the kv_store migration still has a valid entry here.
    // We pull it, persist it to kv_store (so future loads skip
    // the keychain), and return it. On Windows the keychain
    // entry was never written, so this returns None and the user
    // falls through to the "not logged in" error.
    let store = db::secrets::SecretStore::new();
    if let Ok(Some(legacy_raw)) = store.get(LEGACY_EPIC_TOKENS_KEYRING_ACCOUNT) {
        eprintln!(
            "[epic-auth] load_tokens: found {} bytes in legacy keychain, migrating to kv_store",
            legacy_raw.len()
        );
        if let Ok(tokens) = serde_json::from_str::<EpicAuthTokens>(&legacy_raw) {
            // Best-effort migration — don't fail the load if the
            // write errors (the user still has the tokens in
            // memory for this session).
            let json = serde_json::to_string(&tokens).unwrap_or_default();
            if !json.is_empty() {
                let _ = db::kv::set(db_state.inner(), EPIC_TOKENS_KV_KEY, &json);
            }
            // Clean up the legacy keychain entry so we don't
            // migrate again next time.
            let _ = store.delete(LEGACY_EPIC_TOKENS_KEYRING_ACCOUNT);
            return Ok(tokens);
        }
    }

    Err(
        r#"Not logged in to Epic Games. Open Settings → Integrations → Epic Games and click "Connect Epic Account" to authenticate before syncing."#
            .to_string(),
    )
}

/// Returns the live `Arc<Db>` if it has been registered with
/// Tauri's `State` container. Earlier than `db::init` completing
/// during setup, it's not present yet; callers fall through to the
/// no-db path.
fn try_db_state(app: &AppHandle) -> Option<tauri::State<'_, db::Db>> {
    app.try_state::<db::Db>()
}
