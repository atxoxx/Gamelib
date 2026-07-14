//! Tauri-WebView capture bridge used by the **login** flow.
//!
//! After the prior rework that opened a *second* sync WebView,
//! this module is now strictly login-only: the sync flow runs in
//! pure-Rust reqwest via `gog::client`, fed by cookies persisted
//! through `gog::cookies`. This module's only job is to:
//!
//! 1. Open a Tauri WebView at gog.com.
//! 2. Inject a JS init script that polls `menu.gog.com/v1/account/basic`
//!    until `isLoggedIn: true`.
//! 3. Forward identity back to Rust via the `gog_callback` Tauri
//!    command, which routes through a per-call mpsc slot keyed by
//!    a UUID-shaped request id.
//!
//! The login caller (`gog::auth::gog_start_login`) is now
//! **responsible** for capturing cookies from the still-open
//! WebView before closing it — that's why `capture_via_webview`
//! returns `(Value, WebviewWindow)` and does **not** call `webview.close()`
//! internally.
//!
//! We keep the `mpsc slot` shape so the JS-side callback contract
//! is identical to the old sync flow (lower friction to revert
//! later if needed).

use std::collections::HashMap;
use std::sync::mpsc;

use serde_json::Value;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::db;

/// Per-call bridge key (UUID-shaped string). See module doc for why
/// we don't share this with a single global slot.
type SlotKey = String;

/// State installed by `setup()` and consumed by the `gog_callback`
/// command + `capture_via_webview`.
pub struct GogCallbackSlot {
    pending: std::sync::Mutex<HashMap<SlotKey, mpsc::Sender<Value>>>,
}

impl Default for GogCallbackSlot {
    fn default() -> Self {
        Self {
            pending: std::sync::Mutex::new(HashMap::new()),
        }
    }
}

impl GogCallbackSlot {
    pub(crate) fn arm(
        &self,
        request_id: SlotKey,
        sender: mpsc::Sender<Value>,
    ) -> Result<Option<mpsc::Sender<Value>>, String> {
        let mut map = self.pending.lock().map_err(|e| format!("slot mutex: {e}"))?;
        Ok(map.insert(request_id, sender))
    }

    pub(crate) fn take(&self, request_id: &str) -> Result<Option<mpsc::Sender<Value>>, String> {
        let mut map = self.pending.lock().map_err(|e| format!("slot mutex: {e}"))?;
        Ok(map.remove(request_id))
    }
}

// ── Constants ───────────────────────────────────────────────────────

/// GOG login landing page — Playnite's proven URL. If the user
/// isn't logged in, this auto-redirects to the login form.
pub(crate) const GOG_LOGIN_URL: &str = "https://www.gog.com/account/";

/// Login timeout — same shape as Epic / Steam approaches.
pub(crate) const LOGIN_TIMEOUT_SECS: u64 = 300;

/// JS-side max attempts (overrides Rust timeout if a JS callback
/// arrives after Rust bailed — defensive belt+suspenders).
const JS_PROBE_MAX_ATTEMPTS: u32 = 600;

/// Window label for the login WebView. Listed in
/// `capabilities/default.json` so the window inherits the same
/// Tauri permission grants as the main window.
pub(crate) const LOGIN_WEBVIEW_LABEL: &str = "gog-login";

// ── UUID generation (in-process uniqueness only) ────────────────────

/// Generate a stable per-call UUID-shaped string. We don't pull in
/// the `uuid` crate because the value never leaves the in-process
/// bridge — it just has to be unique within the HashMap during the
/// call's lifetime. RFC 4122 v4 layout (16 random bytes with the
/// version/variant bits set) so it visually matches JS-side
/// `crypto.randomUUID()` if the frontend ever logs it.
pub(crate) fn request_id_v4() -> String {
    let mut bytes = [0u8; 16];
    rand::Rng::fill(&mut rand::thread_rng(), &mut bytes[..]);
    bytes[6] = (bytes[6] & 0x0F) | 0x40;
    bytes[8] = (bytes[8] & 0x3F) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5],
        bytes[6], bytes[7],
        bytes[8], bytes[9],
        bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15],
    )
}

// ── WebView open + await callback ───────────────────────────────────

/// Open the login WebView, inject the JS probe, and wait for the
/// user to log in (or for the timeout).
///
/// **Returns the bundle AND the still-open `WebviewWindow`** — the
/// caller is responsible for:
/// 1. Inspecting `bundle.error` (string when JS probe timed out).
/// 2. Capturing cookies off the live window via
///    `gog::cookies::capture_from_webview(&window)` (HttpOnly
///    cookies only survive via this path).
/// 3. Closing the WebView (`webview.close()`).
///
/// We deliberately do not close it inside this fn so the cookie
/// capture can run on a still-hot cookie jar — `WebView2` rotates
/// the in-memory jar when the window is destroyed.
pub(crate) async fn capture_via_webview(
    app: &AppHandle,
    home_url: &str,
    webview_label: &str,
    title: &str,
    width: f64,
    height: f64,
    timeout_secs: u64,
) -> Result<(Value, WebviewWindow), String> {
    let req_id = request_id_v4();
    let (tx, rx) = mpsc::channel::<Value>();
    let slot: tauri::State<'_, GogCallbackSlot> = app.state();
    let _prior = slot
        .arm(req_id.clone(), tx)
        .map_err(|e| format!("slot arm: {e}"))?;

    let init_script = init_script_for(&req_id);
    let url: url::Url = home_url
        .parse()
        .map_err(|e| format!("invalid webview url: {e}"))?;
    let webview = WebviewWindowBuilder::new(app, webview_label, WebviewUrl::External(url))
        .title(title)
        .inner_size(width, height)
        .resizable(false)
        .initialization_script(&init_script)
        .build()
        .map_err(|e| format!("Failed to open GOG login window: {e}"))?;

    // mpsc::Receiver → tokio await via spawn_blocking.
    let bundle = match tokio::task::spawn_blocking(move || {
        rx.recv_timeout(std::time::Duration::from_secs(timeout_secs))
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
    {
        Ok(b) => b,
        Err(_) => {
            // Best-effort close on timeout so we don't leak the
            // WebView surface.
            let _ = webview.close();
            return Err(format!(
                "GOG login timed out after {timeout_secs} seconds"
            ));
        }
    };

    Ok((bundle, webview))
}

// ── JS init script ──────────────────────────────────────────────────

/// Build the `initialization_script` string for the login WebView.
///
/// Three responsibilities:
/// 1. Pin `window.__GOG_REQUEST_ID__` so the callback knows WHERE
///    to route the result.
/// 2. Pin `window.__GOG_KIND__ = "login"` (kept for parity with
///    the previous dual-mode script; harmless if a future kind
///    reuses the script).
/// 3. Run the probe loop. Polls `menu.gog.com/v1/account/basic`
///    until `isLoggedIn: true`, then posts the identity bundle
///    (`{ userId, username }`) via `gog_callback`.
///
/// The `__GOG_PROBE_RAN__` guard makes re-navigation a no-op so
/// we don't double-callback.
pub(crate) fn init_script_for(request_id: &str) -> String {
    let request_id_json = serde_json::to_string(request_id).expect("static literal");
    let max_attempts_json =
        serde_json::to_string(&JS_PROBE_MAX_ATTEMPTS).expect("static literal");
    let kind_json =
        serde_json::to_string("login").expect("static literal");

    format!(
        r#"
(function () {{
    if (window.__GOG_PROBE_RAN__) return;
    window.__GOG_PROBE_RAN__ = true;
    window.__GOG_REQUEST_ID__ = {request_id_json};
    window.__GOG_KIND__ = {kind_json};

    async function safe_invoke(cmd, args) {{
        try {{
            if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {{
                return await window.__TAURI__.core.invoke(cmd, args);
            }}
            return await window.__TAURI_INTERNALS__.invoke(cmd, args);
        }} catch (e) {{
            return null;
        }}
    }}

    (async function probe() {{
        var MAX_ATTEMPTS = {max_attempts_json};

        async function j(url) {{
            var r = await fetch(url, {{ credentials: 'include' }});
            if (r.status !== 200) throw new Error('HTTP ' + r.status);
            return await r.json();
        }}

        for (var attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {{
            try {{
                var me = await j('https://menu.gog.com/v1/account/basic');
                if (!me || !me.isLoggedIn) throw new Error('not logged in (isLoggedIn=' + (me && me.isLoggedIn) + ')');

                var userId = String(me.userId || me.id || me.galaxyUserId || me.user_id || '');
                var payload = {{
                    userId: userId,
                    username: me.username || ''
                }};

                await safe_invoke('gog_callback', {{
                    requestId: window.__GOG_REQUEST_ID__,
                    value: payload
                }});
                return;
            }} catch (e) {{
                if (attempt % 10 === 0) {{
                    safe_invoke('gog_debug_log', {{
                        message: '[GOG] login attempt ' + attempt + ': ' + (e && e.message || String(e))
                    }});
                }}
                await new Promise(function (r) {{ setTimeout(r, 1000); }});
            }}
        }}

        await safe_invoke('gog_callback', {{
            requestId: window.__GOG_REQUEST_ID__,
            value: {{ error: 'Timed out waiting for GOG session' }}
        }});
    }})();
}})();
"#,
    )
}

// ── JS-side callback command ────────────────────────────────────────

/// Tauri command invoked by the WebView's JS detector when the
/// probe completes (success or timeout). Looks up the mpsc slot
/// keyed by `request_id` and forwards the payload. Returns an
/// error if no slot is found — ordinarily that means the Rust
/// async fn already timed out (the slot was taken on the bail
/// path).
#[tauri::command]
pub fn gog_callback(
    slot: tauri::State<'_, GogCallbackSlot>,
    request_id: String,
    value: Value,
) -> Result<(), String> {
    let tx = slot
        .take(&request_id)
        .map_err(|e| format!("slot mutex: {e}"))?;
    match tx {
        Some(tx) => tx.send(value).map_err(|_| "receiver already dropped".to_string()),
        None => Err(format!(
            "no pending GOG callback for requestId={request_id} (already resolved or timed out)"
        )),
    }
}

/// Diagnostic passthrough fired from inside the WebView.
#[tauri::command]
pub fn gog_debug_log(message: String) {
    eprintln!("[gog-webview] {message}");
}

// ── Helpers ─────────────────────────────────────────────────────────

/// Cheap lookup of the registered `db::Db` state. Mirrors
/// `epic::auth::try_db_state` so `gog_logout` can drop the legacy
/// kv keys without re-implementing the AppHandle probe.
pub(crate) fn try_db_state(app: &AppHandle) -> Option<tauri::State<'_, db::Db>> {
    app.try_state::<db::Db>()
}

pub(crate) fn current_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
