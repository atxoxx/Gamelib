use std::sync::mpsc;

use reqwest::Client;
use serde_json::Value;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use super::types::EpicAuthTokens;

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

/// Start the full Epic OAuth flow:
/// 1. Opens an in-app WebView to the Epic login page
/// 2. Waits for Epic to redirect to `localhost/launcher/authorized?code=XXXX`
/// 3. Intercepts the redirect URL via `on_navigation` BEFORE the page loads
/// 4. Extracts the auth code, closes the WebView, and returns the code
///
/// No TCP server needed — Playnite's approach: watch the navigation URL.
#[tauri::command]
pub async fn epic_start_login(app: AppHandle) -> Result<String, String> {
    let (tx, rx) = mpsc::channel();

    // Create the WebView.  The `on_navigation` callback fires for every
    // navigation (including JS-initiated redirects).  When Epic tries to
    // send us to `localhost/launcher/authorized?code=XXXX` we grab the
    // code and close the window before the navigation completes.
    let webview = WebviewWindowBuilder::new(
        &app,
        "epic-login",
        WebviewUrl::External(
            EPIC_LOGIN_URL
                .parse()
                .map_err(|e| format!("Invalid URL: {}", e))?,
        ),
    )
    .title("Epic Games Login")
    .inner_size(580.0, 700.0)
    .resizable(false)
    .user_agent(USER_AGENT)
    .on_navigation(move |url| {
        let url_str = url.as_str();
        if url_str.contains("localhost/launcher/authorized") {
            // Extract the code before the browser tries to load localhost
            if let Some(code) = extract_code_from_url(url_str) {
                let _ = tx.send(Some(code));
                return false; // block navigation to localhost
            }
        }
        true
    })
    .build()
    .map_err(|e| format!("Failed to create login window: {}", e))?;

    // Wait for the auth code (up to 5 minutes), then close the window
    let code = tokio::task::spawn_blocking(move || {
        match rx.recv_timeout(std::time::Duration::from_secs(300)) {
            Ok(Some(code)) => Ok(code),
            Ok(None) => Err("Login failed — no authorization code received".to_string()),
            Err(_) => Err("Login timed out after 5 minutes".to_string()),
        }
    })
    .await
    .map_err(|e| format!("Join error: {}", e))??;

    let _ = webview.close();
    Ok(code)
}

/// Exchange an authorization code for access & refresh tokens.
#[tauri::command]
pub async fn epic_finish_login(app: AppHandle, auth_code: String) -> Result<EpicAuthTokens, String> {
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let response = client
        .post(EPIC_TOKEN_URL)
        .header("Authorization", format!("basic {}", EPIC_AUTH_ENCODED))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(format!(
            "grant_type=authorization_code&code={}&token_type=eg1",
            auth_code
        ))
        .send()
        .await
        .map_err(|e| format!("Token request failed: {}", e))?;

    let status = response.status();
    let body_text = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(format!(
            "Token exchange failed (HTTP {}): {}",
            status, body_text
        ));
    }

    let json: Value = serde_json::from_str(&body_text)
        .map_err(|e| format!("Failed to parse token response: {}", e))?;

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

#[tauri::command]
pub fn epic_is_authenticated(app: AppHandle) -> bool {
    load_tokens(&app).is_ok()
}

#[tauri::command]
pub fn epic_logout(app: AppHandle) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let tokens_path = data_dir.join("epic_tokens.json");
    if tokens_path.exists() {
        std::fs::remove_file(&tokens_path).map_err(|e| e.to_string())?;
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
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let response = client
        .post(EPIC_TOKEN_URL)
        .header("Authorization", format!("basic {}", EPIC_AUTH_ENCODED))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(format!(
            "grant_type=refresh_token&refresh_token={}&token_type=eg1",
            tokens.refresh_token
        ))
        .send()
        .await
        .map_err(|e| format!("Token refresh failed: {}", e))?;

    let status = response.status();
    let body_text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "Token refresh failed (HTTP {}): {}",
            status, body_text
        ));
    }

    let json: Value = serde_json::from_str(&body_text)
        .map_err(|e| format!("Failed to parse refresh response: {}", e))?;

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

fn save_tokens(app: &AppHandle, tokens: &EpicAuthTokens) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let tokens_path = data_dir.join("epic_tokens.json");
    let json = serde_json::to_string_pretty(tokens).map_err(|e| e.to_string())?;
    std::fs::write(&tokens_path, json).map_err(|e| e.to_string())?;
    Ok(())
}

fn load_tokens(app: &AppHandle) -> Result<EpicAuthTokens, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let tokens_path = data_dir.join("epic_tokens.json");
    if !tokens_path.exists() {
        return Err("No Epic tokens stored".to_string());
    }
    let json = std::fs::read_to_string(&tokens_path).map_err(|e| e.to_string())?;
    serde_json::from_str(&json).map_err(|e| format!("Failed to parse tokens: {}", e))
}
