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
/// On success: writes the resulting fresh tokens to the keychain via
/// `save_tokens` AND returns the same `EpicAuthTokens` struct to
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

#[tauri::command]
pub fn epic_logout(_app: AppHandle) -> Result<(), String> {
    // Phase 4: tokens live in the OS keychain under
    // `service=gamelib/gamelib-app, account=epic_tokens`. We also
    // drop the kv-stored Epic-side sync timestamp so the next login
    // triggers a fresh library fetch.
    let store = db::secrets::SecretStore::new();
    store.delete("epic_tokens")?;
    if let Some(db_state) = try_db_state(&_app) {
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

/// Phase 4: persist Epic OAuth tokens in the OS keychain. The
/// keyring serialises our store as a `String`; we use compact JSON
/// (no pretty) to keep the blob tiny. Non-sensitive metadata
/// (login timestamps) goes into the `kv_store` SQLite table when
/// the DB has been initialised.
fn save_tokens(app: &AppHandle, tokens: &EpicAuthTokens) -> Result<(), String> {
    let json = serde_json::to_string(tokens).map_err(|e| e.to_string())?;
    let store = db::secrets::SecretStore::new();
    store.set("epic_tokens", &json)?;
    if let Some(db_state) = try_db_state(app) {
        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = db::kv::set(db_state.inner(), "epic_last_login_unix", &now_secs.to_string());
    }
    Ok(())
}

fn load_tokens(_app: &AppHandle) -> Result<EpicAuthTokens, String> {
    let store = db::secrets::SecretStore::new();
    let secret = store
        .get("epic_tokens")?
        .ok_or_else(|| {
            r#"Not logged in to Epic Games. Open Settings → Integrations → Epic Games and click "Connect Epic Account" to authenticate before syncing."#
                .to_string()
        })?;
    serde_json::from_str(&secret).map_err(|e| format!("Failed to parse tokens: {e}"))
}

/// Returns the live `Arc<Db>` if it has been registered with
/// Tauri's `State` container. Earlier than `db::init` completing
/// during setup, it's not present yet; callers fall through to the
/// no-db path.
fn try_db_state(app: &AppHandle) -> Option<tauri::State<'_, db::Db>> {
    app.try_state::<db::Db>()
}
