use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use std::time::Duration;

use base64::{Engine as _, engine::general_purpose};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use super::types::SteamSession;

/// Steam store login page.  After login Steam redirects to the store
/// home, where the page HTML embeds `steamid` and `webapi_token` — we
/// extract those to authenticate against the Steam Web API.
const STEAM_LOGIN_URL: &str = "https://store.steampowered.com/login/";

/// Chrome-mimicking user-agent.  Without this Steam detects the default
/// WebView2 header and refuses to render the login page (blank window).
pub const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/// ── Tauri commands ──────────────────────────────────────────────────

/// Start the full Steam login flow:
/// 1. Opens an in-app WebView to the Steam login page
/// 2. Waits for the user to log in (including Steam Guard)
/// 3. After the post-login redirect lands on the store page, extracts
///    `steamid` and `webapi_token` from the page HTML (Playnite approach).
/// 4. Returns session + token as JSON
///
/// The `webapi_token` can be passed as `access_token` to official Steam
/// Web API endpoints like `IPlayerService/GetOwnedGames/v1/` — no API
/// key required.
#[tauri::command]
pub async fn steam_start_login(app: AppHandle) -> Result<String, String> {
    // Single channel for navigation callbacks:
    //   "__LOGIN_OK__"  → user completed login
    //   base64 JSON     → data extracted from the page
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    let tx_nav = tx.clone();
    let rx = Arc::new(Mutex::new(rx));

    // Guard to avoid double-signalling login completion.
    let login_sent = Arc::new(AtomicBool::new(false));
    let login_sent_nav = Arc::clone(&login_sent);

    let webview = WebviewWindowBuilder::new(
        &app,
        "steam-login",
        WebviewUrl::External(
            STEAM_LOGIN_URL
                .parse()
                .map_err(|e| format!("Invalid URL: {e}"))?,
        ),
    )
    .title("Steam Login")
    .inner_size(800.0, 700.0)
    .resizable(true)
    .user_agent(USER_AGENT)
    .on_navigation(move |url| {
        let url_str = url.as_str();

        // Intercept data extraction via custom scheme.
        if url_str.starts_with("gamelib-steam://data/") {
            let data = url_str["gamelib-steam://data/".len()..].to_string();
            let _ = tx_nav.send(data);
            return false;
        }

        // Detect successful login: redirected away from /login to a
        // store or community page.
        if !login_sent_nav.load(Ordering::SeqCst)
            && ((url_str.starts_with("https://store.steampowered.com/")
                && !url_str.contains("/login"))
                || (url_str.starts_with("https://steamcommunity.com/")
                    && !url_str.contains("/login")
                    && !url_str.contains("login.steampowered.com")))
        {
            login_sent_nav.store(true, Ordering::SeqCst);
            let _ = tx_nav.send("__LOGIN_OK__".to_string());
        }

        true
    })
    .build()
    .map_err(|e| format!("Failed to create login window: {e}"))?;

    // ── Phase 1 — wait for login (5 minute timeout) ──────────────────
    {
        let rx = Arc::clone(&rx);
        let login_signal = tokio::task::spawn_blocking(move || {
            rx.lock().unwrap().recv_timeout(Duration::from_secs(300))
        })
        .await
        .map_err(|e| format!("Join error: {e}"))?
        .map_err(|_| "Login timed out after 5 minutes".to_string())?;

        if login_signal != "__LOGIN_OK__" {
            let _ = webview.close();
            return Err(format!("Unexpected login signal: {login_signal}"));
        }
    }

    // Give the store page time to fully render — the post-login redirect
    // may be instant if the user was already logged in (WebView2 shares
    // cookies with Edge on Windows).
    tokio::time::sleep(Duration::from_secs(3)).await;

    // ── Phase 2 — extract steamid + webapi_token from page HTML ──────
    //
    // Playnite's approach (SteamStoreService.cs): after the store page
    // loads, `GetPageSourceAsync()` returns HTML containing:
    //   &quot;steamid&quot;:&quot;7656119...&quot;
    //   &quot;webapi_token&quot;:&quot;abc123...&quot;
    //
    // We do the same via JS eval — matching both HTML-encoded quotes
    // (&quot;) and regular quotes in case the page uses either.
    webview
        .eval(
            "(function(){\
             var h=document.documentElement.outerHTML;\
             var sid=(h.match(/(?:&quot;|\")steamid(?:&quot;|\")\\s*:\\s*(?:&quot;|\")(\\d{17})(?:&quot;|\")/)||[])[1]||'';\
             var tok=(h.match(/(?:&quot;|\")webapi_token(?:&quot;|\")\\s*:\\s*(?:&quot;|\")([^&\"]+)(?:&quot;|\")/)||[])[1]||'';\
             var name=((h.match(/(?:&quot;|\")strPersonaName(?:&quot;|\")\\s*:\\s*(?:&quot;|\")([^&\"]+)(?:&quot;|\")/)||[])[1]||'');\
             location.href='gamelib-steam://data/'+btoa(JSON.stringify({steamId:sid,webApiToken:tok,displayName:name}))})()",
        )
        .map_err(|e| format!("eval token extraction failed: {e}"))?;

    let token_b64 = {
        let rx = Arc::clone(&rx);
        tokio::task::spawn_blocking(move || {
            rx.lock().unwrap().recv_timeout(Duration::from_secs(15))
        })
        .await
        .map_err(|e| format!("Join error: {e}"))?
        .map_err(|_| "Token extraction timed out — page may not have loaded".to_string())?
    };

    // Close the WebView — we have the token.
    let _ = webview.close();

    // ── Parse extracted data ─────────────────────────────────────────
    let json_bytes = general_purpose::STANDARD
        .decode(&token_b64)
        .map_err(|e| format!("Base64 decode failed: {e}"))?;
    let json_str = String::from_utf8(json_bytes)
        .map_err(|e| format!("UTF-8 decode failed: {e}"))?;
    let data: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("JSON parse failed: {e}"))?;

    let steam_id = data["steamId"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            format!(
                "Could not find steamid in page HTML. Raw data: {}",
                json_str.chars().take(200).collect::<String>()
            )
        })?
        .to_string();

    let web_api_token = data["webApiToken"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            "Could not find webapi_token in page HTML — are you logged into Steam?".to_string()
        })?
        .to_string();

    let display_name = data["displayName"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    // Validate the steam_id looks like a 64-bit Steam ID.
    if !steam_id.chars().all(|c| c.is_ascii_digit()) || steam_id.len() != 17 {
        return Err(format!("Invalid Steam ID extracted: {steam_id}"));
    }

    let session = SteamSession {
        steam_id: steam_id.clone(),
        web_api_token,
        display_name,
    };

    let result = serde_json::json!({
        "session": session,
    });

    Ok(result.to_string())
}

/// Parse the session data returned by `steam_start_login` and persist
/// the session to disk.  Returns the parsed `SteamSession`.
#[tauri::command]
pub fn steam_finish_login(
    app: AppHandle,
    session_data: String,
) -> Result<SteamSession, String> {
    let parsed: serde_json::Value =
        serde_json::from_str(&session_data).map_err(|e| format!("Parse failed: {e}"))?;

    let session: SteamSession = serde_json::from_value(parsed["session"].clone())
        .map_err(|e| format!("Session parse failed: {e}"))?;

    save_session(&app, &session)?;
    Ok(session)
}

/// Check whether a saved Steam session exists.
#[tauri::command]
pub fn steam_is_authenticated(app: AppHandle) -> bool {
    get_session_path(&app).exists()
}

/// Delete the saved Steam session.
#[tauri::command]
pub fn steam_logout(app: AppHandle) -> Result<(), String> {
    let path = get_session_path(&app);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Load the saved Steam session from disk.  Returns `None` if none exists.
#[tauri::command]
pub fn steam_get_session(app: AppHandle) -> Result<Option<SteamSession>, String> {
    let path = get_session_path(&app);
    if !path.exists() {
        return Ok(None);
    }
    let json = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let session: SteamSession =
        serde_json::from_str(&json).map_err(|e| format!("Parse session: {e}"))?;
    Ok(Some(session))
}

// ── Deprecated (kept for backward compat) ────────────────────────────

#[allow(deprecated)]
#[tauri::command]
pub fn steam_save_config(
    app: AppHandle,
    config: super::types::SteamApiConfig,
) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let config_path = data_dir.join("steam_config.json");
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&config_path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[allow(deprecated)]
#[tauri::command]
pub fn steam_load_config(
    app: AppHandle,
) -> Result<Option<super::types::SteamApiConfig>, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let config_path = data_dir.join("steam_config.json");
    if !config_path.exists() {
        return Ok(None);
    }
    let json = std::fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let config: super::types::SteamApiConfig =
        serde_json::from_str(&json).map_err(|e| e.to_string())?;
    Ok(Some(config))
}

#[tauri::command]
pub fn steam_clear_config(app: AppHandle) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let config_path = data_dir.join("steam_config.json");
    if config_path.exists() {
        std::fs::remove_file(&config_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── utilities ──────────────────────────────────────────────────────

fn get_session_path(app: &AppHandle) -> std::path::PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_default()
        .join("steam_session.json")
}

fn save_session(app: &AppHandle, session: &SteamSession) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let path = data_dir.join("steam_session.json");
    let json = serde_json::to_string_pretty(session).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}
