//! GOG authentication — OAuth2 WebView login + token exchange.
//!
//! Flow (Comet / Playnite parity):
//! 1. `gog_start_login` opens a Tauri WebView at
//!    `https://login.gog.com/auth?client_id=46899977096215655&layout=galaxy&...`
//!    with an `on_navigation` callback that watches for the
//!    redirect to `embed.gog.com/on_login_success?origin=client&code=...`.
//! 2. The callback extracts the authorization `code` and sends it
//!    through an `mpsc` channel — no JS probe needed (the Epic
//!    auth module uses the exact same pattern).
//! 3. Rust exchanges the code for tokens at `auth.gog.com/token`
//!    (GET with query params — GOG's implementation uses GET,
//!    unlike standard OAuth POST).
//! 4. Tokens are persisted in the SQLite `kv_store` table under
//!    key `gog_tokens`. Sync reads them to build a
//!    Bearer-authenticated `GogClient`. The OS keychain was
//!    previously used but the `keyring` crate's Windows backend
//!    (`CredWriteW`) silently fails to persist credentials when
//!    the service name contains a slash (`gamelib/gamelib-app`).
//! 5. A follow-up probe of `menu.gog.com/v1/account/basic` with
//!    the fresh access token returns the user identity bundle,
//!    which becomes the `GogSession` returned to the frontend.
//!
//! The old cookie-based flow (WebView JS probe + cookie capture +
//! reqwest cookie jar) is removed. The `gog::cookies` and
//! `gog::webview_capture` modules are no longer needed and have
//! been removed from the module tree.

use reqwest::Client;
use serde_json::Value;
use std::sync::mpsc;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use super::cookies::{self, GogCookies};
use super::types::{GogAuthTokens, GogSession};
use crate::db;

// ── OAuth constants (Comet / Playnite parity) ───────────────────────

/// Well-known GOG Galaxy client_id — used by every open-source
/// GOG integration (Comet, Heroic, Lutris, galaxyDL-Python).
const GOG_CLIENT_ID: &str = "46899977096215655";

/// Hardcoded client_secret paired with the Galaxy client_id.
/// Source: Lutris, Heroic gogdl, galaxyDL-Python.
const GOG_CLIENT_SECRET: &str =
    "9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9";

/// OAuth authorization page — `login.gog.com/auth` (NOT
/// `auth.gog.com/auth`). The `layout=galaxy` parameter is
/// required; without it, GOG rejects this client_id with
/// `invalid_client`.
const GOG_AUTH_URL: &str = concat!(
    "https://login.gog.com/auth",
    "?client_id=46899977096215655",
    "&layout=galaxy",
    "&redirect_uri=https%3A%2F%2Fembed.gog.com%2Fon_login_success%3Forigin%3Dclient",
    "&response_type=code",
);

/// Token exchange endpoint — GOG accepts GET with query params
/// (non-standard but consistent across all open-source impls).
const GOG_TOKEN_URL: &str = "https://auth.gog.com/token";

/// Redirect URI we watch for in the `on_navigation` callback.
const GOG_REDIRECT_MARKER: &str = "embed.gog.com/on_login_success";

const GOG_TOKENS_KV_KEY: &str = "gog_tokens";
const GOG_SESSION_KV_KEY: &str = "gog_session";
const LEGACY_GOG_COOKIES_KEYRING_ACCOUNT: &str = "gog_cookies";
const LEGACY_GOG_SESSION_KEYRING_ACCOUNT: &str = "gog_session";
const LEGACY_GOG_TOKENS_KEYRING_ACCOUNT: &str = "gog_tokens";

const LOGIN_TIMEOUT_SECS: u64 = 300;

/// Browser UA for the token-exchange HTTP client — match a
/// recent Chrome desktop profile so the server doesn't
/// side-grade us to a bot response.
const GOG_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

// ── Tauri commands ──────────────────────────────────────────────────

/// Open the GOG OAuth WebView, capture the authorization code,
/// exchange it for tokens, persist them, probe account/basic for
/// identity, and return the typed `GogSession`.
///
/// Single-command flow (unlike Epic's two-phase `start_login` +
/// `finish_login`) — the token exchange happens internally so the
/// frontend doesn't need to manage an intermediate auth code.
#[tauri::command]
pub async fn gog_start_login(
    app: AppHandle,
    request_id: Option<String>,
) -> Result<GogSession, String> {
    let _ = request_id;
    eprintln!("[gog-auth] gog_start_login: opening OAuth WebView...");

    // ── 1. Open WebView + capture auth code via on_navigation ──
    let auth_code = open_oauth_webview(&app).await?;
    eprintln!("[gog-auth] got auth code (len={}), exchanging for tokens...", auth_code.len());

    // ── 2. Exchange auth code for tokens ──────────────────────
    let tokens = exchange_code_for_tokens(&auth_code).await?;
    eprintln!("[gog-auth] token exchange OK — user_id={}, expires_at={}", tokens.user_id, tokens.expires_at);

    // ── 3. Persist tokens to SQLite kv_store ─────────────────
    save_tokens(&app, &tokens)?;
    eprintln!("[gog-auth] tokens saved to kv_store under '{}'", GOG_TOKENS_KV_KEY);

    // ── 3b. Capture cookies for embed.gog.com requests ──────
    // embed.gog.com/user/data/games requires cookie-based auth
    // even with OAuth2 — capture session cookies from the
    // WebView (still open) before closing it.
    match capture_cookies_from_auth_webview(&app).await {
        Ok(cookies) => {
            if let Some(db_state) = try_db_state(&app) {
                if let Err(e) = cookies::persist(db_state.inner(), &cookies) {
                    eprintln!("[gog-auth] persist cookies: {e}");
                } else {
                    eprintln!("[gog-auth] {} cookies captured and persisted", cookies.records.len());
                }
            }
        }
        Err(e) => {
            eprintln!("[gog-auth] cookie capture skipped: {e}");
        }
    }
    // Close the WebView now that we've captured cookies.
    if let Some(wv) = app.get_webview_window("gog-login") {
        let _ = wv.close();
    }

    // ── 4. Probe account/basic for user identity ──────────────
    let client = Client::builder()
        .user_agent(GOG_USER_AGENT)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("build HTTP client: {e}"))?;

    let resp = client
        .get("https://menu.gog.com/v1/account/basic")
        .bearer_auth(&tokens.access_token)
        .send()
        .await
        .map_err(|e| format!("account/basic probe: {e}"))?;

    let status = resp.status();
    let body_text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "GOG account probe HTTP {status} — token may be invalid: {body_text}"
        ));
    }
    let body: Value = serde_json::from_str(&body_text)
        .map_err(|e| format!("decode account/basic: {e}"))?;

    let is_logged_in = body["isLoggedIn"].as_bool().unwrap_or(false);
    if !is_logged_in {
        // Shouldn't happen with a fresh access token, but GOG
        // sometimes returns isLoggedIn=false on brand-new accounts
        // or accounts with privacy settings that hide basic info.
        // Use the token's user_id as fallback.
    }
    let user_id = value_to_string(body.get("userId"))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| tokens.user_id.clone());
    let username = value_to_string(body.get("username"))
        .unwrap_or_else(|| format!("GOG User {user_id}"));

    let session = GogSession {
        user_id: user_id.clone(),
        username: username.clone(),
        galaxy_user_id: Some(user_id),
        logged_in_at: current_unix(),
    };
    persist_session(&app, &session)?;
    eprintln!("[gog-auth] login complete — username='{}', user_id={}", session.username, session.user_id);
    Ok(session)
}

/// Cheap boolean probe — checks the kv_store for tokens.
#[tauri::command]
pub fn gog_is_authenticated(app: AppHandle) -> bool {
    load_tokens_inner(&app).is_ok()
}

/// Wipe tokens and session from the kv_store, plus legacy
/// keychain entries for users upgrading from the old cookie
/// flow or the broken keyring-based OAuth flow.
#[tauri::command]
pub fn gog_logout(app: AppHandle) -> Result<(), String> {
    // Clean up legacy keychain entries (may not exist — delete is idempotent).
    let store = db::secrets::SecretStore::new();
    let _ = store.delete(LEGACY_GOG_TOKENS_KEYRING_ACCOUNT);
    let _ = store.delete(LEGACY_GOG_SESSION_KEYRING_ACCOUNT);
    let _ = store.delete(LEGACY_GOG_COOKIES_KEYRING_ACCOUNT);
    // Clean up kv_store entries (the current persistence layer).
    if let Some(db_state) = try_db_state(&app) {
        let _ = db::kv::delete(db_state.inner(), GOG_TOKENS_KV_KEY);
        let _ = db::kv::delete(db_state.inner(), GOG_SESSION_KV_KEY);
        let _ = db::kv::delete(db_state.inner(), cookies::GOG_COOKIES_KV_KEY);
        let _ = db::kv::delete(db_state.inner(), "gog_last_login_unix");
        let _ = db::kv::delete(db_state.inner(), "gog_username");
        let _ = db::kv::delete(db_state.inner(), "gog_display_name");
        let _ = db::kv::delete(db_state.inner(), "gog_galaxy_user_id");
    }
    Ok(())
}

// ── Token persistence ───────────────────────────────────────────────

fn save_tokens(app: &AppHandle, tokens: &GogAuthTokens) -> Result<(), String> {
    let json = serde_json::to_string(tokens).map_err(|e| format!("serialize tokens: {e}"))?;
    let db_state = try_db_state(app)
        .ok_or_else(|| "Database not initialized — cannot persist GOG tokens".to_string())?;
    eprintln!(
        "[gog-auth] save_tokens: writing {} bytes to kv_store key='{}'",
        json.len(),
        GOG_TOKENS_KV_KEY
    );
    db::kv::set(db_state.inner(), GOG_TOKENS_KV_KEY, &json)?;

    // ── Verify the write actually persisted ──────────────────
    match db::kv::get(db_state.inner(), GOG_TOKENS_KV_KEY) {
        Ok(Some(readback)) if readback == json => {
            eprintln!("[gog-auth] save_tokens: readback verified — {} bytes match", readback.len());
        }
        Ok(Some(readback)) => {
            eprintln!(
                "[gog-auth] save_tokens: WARNING — readback MISMATCH! wrote {} bytes, read {} bytes",
                json.len(), readback.len()
            );
        }
        Ok(None) => {
            eprintln!("[gog-auth] save_tokens: CRITICAL — kv set returned Ok but get returned None!");
        }
        Err(e) => {
            eprintln!("[gog-auth] save_tokens: CRITICAL — kv set returned Ok but get failed: {e}");
        }
    }

    let now = current_unix().to_string();
    let _ = db::kv::set(db_state.inner(), "gog_last_login_unix", &now);
    Ok(())
}

fn persist_session(app: &AppHandle, session: &GogSession) -> Result<(), String> {
    let json = serde_json::to_string(session).map_err(|e| format!("serialize session: {e}"))?;
    let db_state = try_db_state(app)
        .ok_or_else(|| "Database not initialized — cannot persist GOG session".to_string())?;
    db::kv::set(db_state.inner(), GOG_SESSION_KV_KEY, &json)?;
    let login_unix = session.logged_in_at.to_string();
    let _ = db::kv::set(db_state.inner(), "gog_last_login_unix", login_unix.as_str());
    let _ = db::kv::set(db_state.inner(), "gog_username", session.username.as_str());
    let _ = db::kv::set(db_state.inner(), "gog_display_name", session.username.as_str());
    if let Some(uid) = session.galaxy_user_id.as_deref() {
        let _ = db::kv::set(db_state.inner(), "gog_galaxy_user_id", uid);
    }
    Ok(())
}

// ── Public token accessors (used by sync) ──────────────────────────

pub(crate) fn load_session_pub(app: &AppHandle) -> Result<GogSession, String> {
    load_session_inner(app)
}

/// Load tokens from the keychain. Returns error when not
/// authenticated — sync uses this as the short-circuit check.
pub(crate) fn load_tokens(app: &AppHandle) -> Result<GogAuthTokens, String> {
    load_tokens_inner(app)
}

/// Refresh the access token if it's within 5 minutes of expiry.
/// Returns the (possibly refreshed) tokens. Used by sync before
/// making any API calls.
pub(crate) async fn refresh_tokens_if_needed(
    app: &AppHandle,
) -> Result<GogAuthTokens, String> {
    let tokens = load_tokens_inner(app)?;
    if tokens.expires_at > current_unix() + 300 {
        return Ok(tokens);
    }
    let client = Client::builder()
        .user_agent(GOG_USER_AGENT)
        .build()
        .map_err(|e| format!("build HTTP client: {e}"))?;
    let refresh_url = format!(
        "{}?client_id={}&client_secret={}&grant_type=refresh_token&refresh_token={}",
        GOG_TOKEN_URL,
        urlencoding::encode(GOG_CLIENT_ID),
        urlencoding::encode(GOG_CLIENT_SECRET),
        urlencoding::encode(&tokens.refresh_token),
    );
    let resp = client
        .get(&refresh_url)
        .send()
        .await
        .map_err(|e| format!("token refresh: {e}"))?;
    let status = resp.status();
    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("decode refresh response: {e}"))?;
    if !status.is_success() {
        let err_msg = body["error"].as_str().unwrap_or("unknown");
        return Err(format!("Token refresh failed (HTTP {status}): {err_msg}"));
    }
    let access_token = body["access_token"]
        .as_str()
        .ok_or("missing access_token in refresh response")?
        .to_string();
    let refresh_token = body["refresh_token"]
        .as_str()
        .unwrap_or(&tokens.refresh_token)
        .to_string();
    let expires_in = body["expires_in"].as_u64().unwrap_or(3600);
    let new_tokens = GogAuthTokens {
        access_token,
        refresh_token,
        expires_at: current_unix() + expires_in,
        user_id: tokens.user_id.clone(),
    };
    save_tokens(app, &new_tokens)?;
    Ok(new_tokens)
}

// ── Cookie capture from OAuth WebView ────────────────────────────

/// Capture session cookies from the still-open `gog-login`
/// WebView. embed.gog.com/user/data/games requires cookie-based
/// auth even with OAuth2 — this bridges the gap.
///
/// Must be called BEFORE the WebView is closed (WebView2 purges
/// cookies on window destruction).
async fn capture_cookies_from_auth_webview(
    app: &AppHandle,
) -> Result<GogCookies, String> {
    // The gog-login WebView should still be open at this point —
    // `gog_start_login` calls us after token exchange but before
    // `open_oauth_webview` closes the window.
    let webview = app
        .get_webview_window("gog-login")
        .ok_or_else(|| "gog-login WebView not found — may have been closed early".to_string())?;
    cookies::capture_from_webview(&webview).await
}

// ── WebView + on_navigation code capture ───────────────────────────

async fn open_oauth_webview(app: &AppHandle) -> Result<String, String> {
    eprintln!("[gog-auth] opening OAuth WebView at login.gog.com/auth...");
    let (tx, rx) = mpsc::channel::<Option<String>>();

    let webview = WebviewWindowBuilder::new(
        app,
        "gog-login",
        WebviewUrl::External(
            GOG_AUTH_URL
                .parse()
                .map_err(|e| format!("invalid GOG auth URL: {e}"))?,
        ),
    )
    .title("GOG Galaxy Login")
    .inner_size(580.0, 700.0)
    .resizable(false)
    .on_navigation(move |url| {
        let url_str = url.as_str();
        if url_str.contains(GOG_REDIRECT_MARKER) {
            eprintln!("[gog-auth] on_navigation hit redirect: {url_str}");
            let code = extract_code_from_url(url_str);
            eprintln!("[gog-auth] extracted code: {}", code.as_deref().unwrap_or("<none>"));
            let _ = tx.send(Some(code.unwrap_or_default()));
            return false; // stop navigation — we got what we need
        }
        true // allow navigation
    })
    .build()
    .map_err(|e| format!("Failed to create GOG login window: {e}"))?;

    let auth_code = match tokio::task::spawn_blocking(move || {
        rx.recv_timeout(std::time::Duration::from_secs(LOGIN_TIMEOUT_SECS))
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
    {
        Ok(Some(code)) if !code.is_empty() => code,
        Ok(_) => {
            let _ = webview.close();
            return Err(
                "GOG login failed — no authorization code received. The redirect may have been blocked.".to_string(),
            );
        }
        Err(_) => {
            let _ = webview.close();
            return Err(format!(
                "GOG login timed out after {LOGIN_TIMEOUT_SECS} seconds"
            ));
        }
    };

    // WebView stays open — caller MUST close it after cookie capture.
    Ok(auth_code)
}

// ── Token exchange ──────────────────────────────────────────────────

async fn exchange_code_for_tokens(auth_code: &str) -> Result<GogAuthTokens, String> {
    eprintln!("[gog-auth] exchanging auth code for tokens (code len={})...", auth_code.len());
    let client = Client::builder()
        .user_agent(GOG_USER_AGENT)
        .build()
        .map_err(|e| format!("build HTTP client: {e}"))?;

    let token_url = format!(
        "{}?client_id={}&client_secret={}&grant_type=authorization_code&code={}&redirect_uri={}",
        GOG_TOKEN_URL,
        urlencoding::encode(GOG_CLIENT_ID),
        urlencoding::encode(GOG_CLIENT_SECRET),
        urlencoding::encode(auth_code),
        urlencoding::encode("https://embed.gog.com/on_login_success?origin=client"),
    );

    let resp = client
        .get(&token_url)
        .send()
        .await
        .map_err(|e| format!("token exchange request: {e}"))?;

    let status = resp.status();
    let body_text = resp.text().await.unwrap_or_default();
    eprintln!("[gog-auth] token exchange HTTP {status}");
    let body: Value = serde_json::from_str(&body_text)
        .map_err(|e| format!("decode token response: {e} (body: {})", &body_text[..body_text.len().min(500)]))?;

    if !status.is_success() {
        let err = body["error"].as_str().unwrap_or("unknown");
        let desc = body["error_description"]
            .as_str()
            .unwrap_or("no description");
        return Err(format!(
            "GOG token exchange failed (HTTP {status}): {err} — {desc}"
        ));
    }

    let access_token = body["access_token"]
        .as_str()
        .ok_or("missing access_token in token response")?
        .to_string();
    let refresh_token = body["refresh_token"]
        .as_str()
        .ok_or("missing refresh_token in token response")?
        .to_string();
    let expires_in = body["expires_in"].as_u64().unwrap_or(3600);
    let user_id = value_to_string(body.get("user_id"))
        .unwrap_or_else(|| "unknown".to_string());

    Ok(GogAuthTokens {
        access_token,
        refresh_token,
        expires_at: current_unix() + expires_in,
        user_id,
    })
}

// ── Internal helpers ───────────────────────────────────────────────

fn load_session_inner(app: &AppHandle) -> Result<GogSession, String> {
    let db_state = try_db_state(app)
        .ok_or_else(|| "Database not initialized".to_string())?;
    let secret = db::kv::get(db_state.inner(), GOG_SESSION_KV_KEY)?
        .ok_or_else(|| "No GOG session stored".to_string())?;
    serde_json::from_str(&secret).map_err(|e| format!("Failed to parse session: {e}"))
}

fn load_tokens_inner(app: &AppHandle) -> Result<GogAuthTokens, String> {
    let db_state = try_db_state(app)
        .ok_or_else(|| "Database not initialized".to_string())?;
    eprintln!(
        "[gog-auth] load_tokens_inner: reading from kv_store key='{}'",
        GOG_TOKENS_KV_KEY
    );
    let raw = db::kv::get(db_state.inner(), GOG_TOKENS_KV_KEY)?;
    match &raw {
        Some(s) => eprintln!("[gog-auth] load_tokens_inner: found {} bytes", s.len()),
        None => eprintln!("[gog-auth] load_tokens_inner: kv_store returned None — entry does NOT exist"),
    }
    let secret = raw.ok_or_else(|| {
        "No GOG tokens stored — you may need to reconnect your account. Click 'Connect GOG Account' in Settings to re-authenticate.".to_string()
    })?;
    serde_json::from_str(&secret).map_err(|e| format!("Failed to parse tokens: {e}"))
}

fn current_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

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

fn try_db_state(app: &AppHandle) -> Option<tauri::State<'_, db::Db>> {
    app.try_state::<db::Db>()
}

fn value_to_string(v: Option<&Value>) -> Option<String> {
    match v? {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}
