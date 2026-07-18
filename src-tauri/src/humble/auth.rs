//! Humble authentication — cookie-based Tauri WebView login.
//!
//! Humble has no public OAuth client. Playnite authenticates by opening
//! a WebView at humblebundle.com/login, waiting for the navigation to
//! land on the library page (which only happens once the session cookie
//! is set), then replaying that cookie on the `api/v1/orders` and
//! library endpoints. We do exactly that: the `humble_login` WebView
//! captures the `.humblebundle.com` cookies, we persist them to the
//! kv_store, and `client::HumbleClient` rehydrates them into a
//! `reqwest::cookie::Jar`.
//!
//! The login window is itself the signal — when it reaches the library
//! URL we know auth succeeded and can close it. We then probe the
//! library page for the `#user-home-json-data` block (Playnite's
//! `GetLibraryKeys` does the same) to confirm and grab a display name.

use serde::{Deserialize, Serialize};
use std::sync::mpsc;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use super::types::HumbleSession;
use crate::db;

// ── Constants ─────────────────────────────────────────────────────────

const HUMBLE_LOGIN_URL: &str =
    "https://www.humblebundle.com/login?goto=%2Fhome%2Flibrary&qs=hmb_source%3Dnavbar";
const HUMBLE_LIBRARY_URL: &str = "https://www.humblebundle.com/home/library";
const HUMBLE_COOKIES_KV_KEY: &str = "humble_cookies";
const HUMBLE_SESSION_KV_KEY: &str = "humble_session";

const LOGIN_TIMEOUT_SECS: u64 = 300;

/// Browser UA — match a recent Chrome desktop profile so Humble's
/// anti-bot doesn't side-grade the request.
const HUMBLE_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ── Tauri commands ───────────────────────────────────────────────────

/// Open the Humble login WebView, wait for the library redirect (which
/// only happens once the session cookie is set), capture the cookies,
/// and persist a `HumbleSession`. Returns the typed session to the
/// frontend. No JS probe required — the `on_navigation` callback watches
/// for the library URL and closes the window with the captured cookies.
#[tauri::command]
pub async fn humble_start_login(app: AppHandle) -> Result<HumbleSession, String> {
    eprintln!("[humble-auth] opening Humble login WebView...");

    open_login_webview(&app).await?;
    eprintln!("[humble-auth] reached library page — capturing cookies...");

    let cookies = capture_cookies_from_webview(&app).await?;
    if let Some(db_state) = app.try_state::<db::Db>() {
        let json = serde_json::to_string(&cookies).map_err(|e| format!("serialize cookies: {e}"))?;
        let _ = db::kv::set(db_state.inner(), HUMBLE_COOKIES_KV_KEY, &json);
        eprintln!("[humble-auth] {} cookies persisted", cookies.records.len());
    }

    // Close the WebView now that cookies are captured.
    if let Some(wv) = app.get_webview_window("humble-login") {
        let _ = wv.close();
    }

    // Probe the library page to confirm auth + grab a display name.
    let session = probe_session(&cookies).await;
    persist_session(&app, &session)?;
    eprintln!(
        "[humble-auth] login complete — username='{}'",
        session.username
    );
    Ok(session)
}

/// Cheap boolean probe — true when a cookie blob exists in the kv_store.
#[tauri::command]
pub fn humble_is_authenticated(app: AppHandle) -> bool {
    app.try_state::<db::Db>()
        .and_then(|db_state| db::kv::get(db_state.inner(), HUMBLE_COOKIES_KV_KEY).ok().flatten())
        .is_some()
}

/// Wipe cookies + session from the kv_store.
#[tauri::command]
pub fn humble_logout(app: AppHandle) -> Result<(), String> {
    if let Some(db_state) = app.try_state::<db::Db>() {
        let _ = db::kv::delete(db_state.inner(), HUMBLE_COOKIES_KV_KEY);
        let _ = db::kv::delete(db_state.inner(), HUMBLE_SESSION_KV_KEY);
    }
    Ok(())
}

// ── Cookie capture + rehydration ──────────────────────────────────────

/// One captured cookie record — minimal fields needed to round-trip a
/// `cookie::Cookie` back into reqwest's jar.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HumbleCookieRecord {
    pub name: String,
    pub value: String,
    #[serde(default)]
    pub domain: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
}

/// Persistable set of captured Humble cookies.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HumbleCookies {
    #[serde(default)]
    pub captured_at: u64,
    pub records: Vec<HumbleCookieRecord>,
}

/// Load persisted cookies, if any.
pub(crate) fn load_cookies(app: &AppHandle) -> Option<HumbleCookies> {
    let db_state = app.try_state::<db::Db>()?;
    db::kv::get(db_state.inner(), HUMBLE_COOKIES_KV_KEY)
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str(&raw).ok())
}

/// Build a `reqwest::cookie::Jar` from captured cookies so a fresh
/// `reqwest::Client` carries them on every Humble request.
pub(crate) fn arc_jar_from(cookies: &HumbleCookies) -> Result<std::sync::Arc<reqwest::cookie::Jar>, String> {
    let jar = reqwest::cookie::Jar::default();
    for rec in &cookies.records {
        let mut s = format!("{}={}", rec.name, rec.value);
        if let Some(d) = &rec.domain {
            if !d.is_empty() {
                s.push_str(&format!("; Domain={d}"));
            }
        }
        let path = rec.path.as_deref().unwrap_or("/");
        s.push_str(&format!("; Path={path}"));
        let attach_host = rec
            .domain
            .as_deref()
            .map(|d| d.trim_start_matches('.'))
            .filter(|d| !d.is_empty())
            .unwrap_or("www.humblebundle.com");
        let attach_url: url::Url = format!("https://{attach_host}/")
            .parse()
            .map_err(|e| format!("invalid cookie attach url for {}: {e}", rec.name))?;
        jar.add_cookie_str(&s, &attach_url);
    }
    Ok(std::sync::Arc::new(jar))
}

// ── Internal helpers ──────────────────────────────────────────────────

async fn capture_cookies_from_webview(app: &AppHandle) -> Result<HumbleCookies, String> {
    let webview = app
        .get_webview_window("humble-login")
        .ok_or_else(|| "humble-login WebView not found — may have closed early".to_string())?;
    let raw = webview
        .cookies()
        .map_err(|e| format!("Humble cookies(): {e}"))?;
    let records: Vec<HumbleCookieRecord> = raw
        .iter()
        .filter_map(|c| {
            let name = c.name().to_string();
            if name.is_empty() || !is_humble_domain(&c.domain().unwrap_or("").to_string()) {
                return None;
            }
            Some(HumbleCookieRecord {
                name,
                value: c.value().to_string(),
                domain: opt_str(c.domain()),
                path: opt_str(c.path()),
            })
        })
        .collect();
    Ok(HumbleCookies {
        captured_at: current_unix(),
        records,
    })
}

fn opt_str(s: Option<&str>) -> Option<String> {
    let v = s.unwrap_or("").to_string();
    if v.is_empty() { None } else { Some(v) }
}

fn is_humble_domain(domain: &str) -> bool {
    let d = domain.trim_start_matches('.').to_ascii_lowercase();
    d == "humblebundle.com" || d.ends_with(".humblebundle.com")
}

async fn open_login_webview(app: &AppHandle) -> Result<(), String> {
    let (tx, rx) = mpsc::channel::<bool>();
    let webview = WebviewWindowBuilder::new(
        app,
        "humble-login",
        WebviewUrl::External(
            HUMBLE_LOGIN_URL
                .parse()
                .map_err(|e| format!("invalid Humble login URL: {e}"))?,
        ),
    )
    .title("Humble Bundle Login")
    .inner_size(520.0, 680.0)
    .resizable(false)
    .on_navigation(move |url| {
        let url_str = url.as_str();
        // The library page is only reachable once authenticated — treat
        // arrival as the success signal and stop navigation.
        if url_str.starts_with(HUMBLE_LIBRARY_URL) {
            eprintln!("[humble-auth] on_navigation reached library: {url_str}");
            let _ = tx.send(true);
            return false;
        }
        true
    })
    .build()
    .map_err(|e| format!("Failed to create Humble login window: {e}"))?;

    match tokio::task::spawn_blocking(move || rx.recv_timeout(std::time::Duration::from_secs(LOGIN_TIMEOUT_SECS)))
        .await
        .map_err(|e| format!("join error: {e}"))?
    {
        Ok(true) => Ok(()),
        Ok(false) => {
            let _ = webview.close();
            Err("Humble login failed — did not reach the library page".to_string())
        }
        Err(_) => {
            let _ = webview.close();
            Err(format!("Humble login timed out after {LOGIN_TIMEOUT_SECS} seconds"))
        }
    }
}

/// Confirm auth by fetching the library page with the captured cookies
/// and parsing the `#user-home-json-data` block (Playnite's
/// `GetLibraryKeys` does the identical thing). Returns a session with
/// whatever display name we can scrape.
async fn probe_session(cookies: &HumbleCookies) -> HumbleSession {
    let client = reqwest::Client::builder()
        .user_agent(HUMBLE_USER_AGENT)
        .cookie_provider(arc_jar_from(cookies).unwrap_or_default())
        .timeout(std::time::Duration::from_secs(20))
        .build();

    let mut session = HumbleSession {
        username: String::new(),
        logged_in_at: current_unix(),
        has_orders: false,
    };

    if let Some(client) = client.ok() {
        if let Ok(resp) = client.get(HUMBLE_LIBRARY_URL).send().await {
            if let Ok(text) = resp.text().await {
                session.username = scrape_username(&text);
                session.has_orders = text.contains("\"gamekeys\"") || text.contains("gamekeys");
            }
        }
    }
    session
}

/// Best-effort username scrape from the library page's JSON blob.
fn scrape_username(html: &str) -> String {
    // Playnite reads `#user-home-json-data` → `userDisplayName`.
    if let Some(start) = html.find("\"userDisplayName\"") {
        let rest = &html[start..];
        if let Some(colon) = rest.find(':') {
            let val = &rest[colon + 1..];
            let v = val.trim_start();
            if v.starts_with('"') {
                if let Some(end) = v[1..].find('"') {
                    return v[1..=end].to_string();
                }
            }
        }
    }
    String::new()
}

fn persist_session(app: &AppHandle, session: &HumbleSession) -> Result<(), String> {
    let db_state = app
        .try_state::<db::Db>()
        .ok_or_else(|| "Database not initialized".to_string())?;
    let json = serde_json::to_string(session).map_err(|e| format!("serialize session: {e}"))?;
    db::kv::set(db_state.inner(), HUMBLE_SESSION_KV_KEY, &json)
}

/// Load the persisted `HumbleSession` for the Settings tile.
pub(crate) fn load_session(app: &AppHandle) -> Option<HumbleSession> {
    let db_state = app.try_state::<db::Db>()?;
    db::kv::get(db_state.inner(), HUMBLE_SESSION_KV_KEY)
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str(&raw).ok())
}

fn current_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
