//! GOG Galaxy authentication + sync — WebView-cookie flow.
//!
//! ## Why this is the WebView path (not OAuth)
//!
//! Every documented GOG Galaxy client_id has been rejected as
//! `invalid_client — Unknown client` in 2026:
//!
//! | client_id                            | response           |
//! |--------------------------------------|--------------------|
//! | `46899977096215655`                  | `redirect_uri_mismatch` |
//! | `46899972096215655` + `?origin=client` | `invalid_client`  |
//! | `46886977419688439` (gogapidocs "Galaxy Client ID", empty secret) | `invalid_client` |
//!
//! GOG has decided to no longer authenticate third-party launcher
//! clients via OAuth. The credentials that the official Galaxy
//! desktop launcher uses are now app-bound and rotate server-side
//! without a public discoverable schema. We can't pin them and we
//! can't register a partner OAuth app for our domain in a
//! sandbox-of-sandboxes.
//!
//! The pivot is the Playnite `GogLibrary` pattern: open a Tauri
//! WebView at `https://www.gog.com/account/`, let the user log in there//!    (HttpOnly `gog_login` cookies land in the WebView's cookie jar),
//!    then let JavaScript inside the WebView run `fetch()` against
//!    `menu.gog.com` / `api.gog.com` / `gameplay.gog.com` — cookies
//! auto-attach because the WebView and gog.com share the same
//! cookie store by default in Tauri 2. JS posts the resulting JSON
//! bundle back to Rust via Tauri IPC (`gog_webview_callback`).
//!
//! **What this avoids**: OAuth client_id/secret agreement with
//! auth.gog.com, fingerprinting headers, and the entire token
//! refresh dance.
//!
//! ## Flow:
//!
//! 1. `gog_start_login(requestId?)` — Rust-side entry point.
//!    Generates a per-request UUID (or accepts one from the frontend
//!    so external test harnesses can pre-key callbacks), opens a
//!    Tauri WebView labelled `gog-login` at `https://www.gog.com/account/`
//!    with an `initialization_script` injected that:
//!    a) sets `window.__GOG_REQUEST_ID__` and `window.__GOG_KIND__` so
//!       the JS knows where to post back,
//!    b) polls `https://menu.gog.com/v1/account/basic` every 1s
//!       (HttpOnly cookies auto-attach),
//!    c) on `isLoggedIn: true`, fires `invoke('gog_webview_callback', {
//!          requestId: window.__GOG_REQUEST_ID__, value: { userId,
//!          username } })` and returns.
//!
//!    Rust registers a `mpsc::Sender` keyed by `requestId` BEFORE
//!    opening the WebView, then awaits on the matching `recv`
//!    with a 5-minute timeout — identical UX to the Epic flow.
//!
//! 2. `gog_webview_callback(requestId, value)` — JS-side entry
//!    point. Sync `#[tauri::command]` callable from inside the
//!    WebView. Looks up the `mpsc::Sender` slot keyed by
//!    `requestId` and ships the `value` through it. Drops the
//!    slot after the send so a stale callback can't deliver to
//!    a different consumer.
//!
//!    Capability is granted via `capabilities/default.json`'s
//!    `windows` list — `gog-login` and `gog-sync` are both listed
//!    so the two WebViews inherit the same allowlist as `main`.
//!
//! 3. `gog_finish_login` is GONE. Two-phase OAuth (open WebView +
//!    token exchange round-trip) is replaced by a single
//!    `gog_start_login` returning `GogSession { user_id, username,
//!    logged_in_at }` directly. The frontend's `handleGogLogin`
//!    collapses to one `await invoke('gog_start_login')`.
//!
//! ## Persistence
//!
//! Persistent artifacts in the OS keychain (account `gog_session`):
//! - `user_id` (for the "Connected as" subtitle on the integration
//!   tile and the playtime endpoint
//!   `https://gameplay.gog.com/clients/<user_id>/playtime`
//!   the next time we sync — though sync now hits that endpoint
//!   from the WebView directly).
//! - `username` (display only).
//! - `logged_in_at` (unix seconds — drives the "Last connected"
//!   tooltip in Settings).
//!
//! The OAuth bearer tokens are gone entirely. The cookie jar in the
//! WebView's user data dir (which Tauri 2 keeps on every platform —
//! `%APPDATA%/<bundle-id>/EBWebView/` on Windows, the app data dir's
//! Cookies subdir on macOS, etc.) is the actual session. We don't
//! intentionally touch or rotate those cookies — they expire on
//! GOG's schedule.
//!
//! ## Legacy keychain cleanup
//!
//! Previous (OAuth-era) secrets lived under the account `gog_tokens`
//! as a JSON blob with `access_token`, `refresh_token`, etc. After
//! this pivot those values are no longer consulted. `gog_logout`
//! removes `gog_session` AND `gog_tokens` so a user updating from
//! a previous build doesn't carry a now-useless keychain entry
//! around for visual clutter or low-value credential-popup noise.

use std::collections::HashMap;
use std::sync::mpsc;

use serde_json::Value;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use super::types::{GogSession, GogWebviewCallbackBody};
use crate::db;

/// Persistent keychain account name for the GOG session marker.
///
/// Distinct from the legacy `gog_tokens` (an OAuth blob) and the
/// per-vendor display strings in the `kv_store` (`gog_username`,
/// `gog_display_name`, `gog_last_login_unix`) which still work as
/// fast probes without keyring I/O.
const GOG_SESSION_KEYRING_ACCOUNT: &str = "gog_session";

/// Legacy `gog_tokens` OAuth blob — kept here ONLY so `gog_logout`
/// can clear it for users upgrading across the OAuth→WebView
/// pivot. Reads from this account are NEVER made.
const LEGACY_GOG_TOKENS_KEYRING_ACCOUNT: &str = "gog_tokens";

/// GOG login / sync entry point. 
///
/// `https://www.gog.com/account/` is the Playnite-proven URL:
/// - If the user isn't logged in, GOG auto-redirects to the login
///   form (no need to hunt for a "Sign In" button on the store
///   homepage).
/// - After successful login, GOG redirects back to `/account/`,
///   giving the JS probe a clean navigation event to latch onto.
/// - The page is same-origin to `menu.gog.com` (both are `.gog.com`
///   subdomains), so cookies auto-attach on cross-origin fetch.
///
/// Both the login and sync WebViews navigate here — the JS probe
/// injected via `initialization_script` drives the rest.
const GOG_HOMEPAGE_URL: &str = "https://www.gog.com/account/";

/// 5-minute timeout on `gog_start_login` — same UX as the Epic and
/// old-GOG-OAuth flows so the user sees consistent toasts.
const LOGIN_TIMEOUT_SECS: u64 = 300;

/// JS-side auto-detection runs for 10 minutes before giving up and
/// posting the "Timed out waiting for GOG login" error. The Rust
/// `LOGIN_TIMEOUT_SECS` timer is the canonical end of the wait —
/// this multiplication is a defensive ceiling in case Rust's
/// `recv_timeout` fires but the JS has already sent a value that
/// was missed by an unlucky race. 600 × 1s = 10 minutes.
const JS_PROBE_MAX_ATTEMPTS: u32 = 600;

/// Window label for the login WebView. Listed in
/// `capabilities/default.json` => inherits the same Tauri
/// permission grants as the main window.
const LOGIN_WEBVIEW_LABEL: &str = "gog-login";

// ── Bridge state — installed by `setup()` ──────────────────────────

/// Bridge between JS-side `gog_webview_callback` invocations and
/// the awaiting Rust async fn it has to unblock. The slot is a map
/// keyed by per-request UUID so overlapping in-flight calls (login
/// + sync simultaneously, or a re-invoked `gog_start_login` while
/// the first is still hanging on the WebView) don't stomp on each
/// other's senders.
///
/// We use `std::sync::Mutex<HashMap<…>>` rather than
/// `tokio::sync::Mutex` because:
///
/// - The critical section is short (HashMap insert / remove + clone
///   of a small `serde_json::Value`).
/// - Neither end of the bridge holds the mutex across an `.await`
///   point — `gog_webview_callback` is a sync command that takes
///   the mutex, copies out the sender, drops the mutex, then sends.
/// - Avoiding `tokio::sync::Mutex`'s async-acquire semantics here
///   saves a `Send` boundary and keeps the dependency graph lighter.
///
/// `pub(crate)` visibility so `gog::sync::gog_sync_library` can arm
/// its sender through `arm()` and look up via `take()` without
/// breaking encapsulation (the `pending` field stays private — only
/// these two accessors escape the module, matching the same
/// pattern `Mutex<HashMap<…, oneshot::Sender<…>>>` uses elsewhere).
pub struct GogWebviewCallbackSlot {
    pending: std::sync::Mutex<HashMap<String, mpsc::Sender<Value>>>,
}

impl Default for GogWebviewCallbackSlot {
    fn default() -> Self {
        Self {
            pending: std::sync::Mutex::new(HashMap::new()),
        }
    }
}

impl GogWebviewCallbackSlot {
    /// Arm a sender under `request_id`. Returns the previous sender
    /// (if any) so the caller can choose to log a warning when
    /// overlap occurs.
    pub(crate) fn arm(
        &self,
        request_id: String,
        sender: mpsc::Sender<Value>,
    ) -> Result<Option<mpsc::Sender<Value>>, String> {
        let mut map = self.pending.lock().map_err(|e| format!("slot mutex: {e}"))?;
        Ok(map.insert(request_id, sender))
    }

    /// Drain the sender for `request_id`. Returns None if no slot
    /// is found — the typical cause is a Rust-side timeout/drop
    /// happened first and the receiver is gone.
    pub(crate) fn take(&self, request_id: &str) -> Result<Option<mpsc::Sender<Value>>, String> {
        let mut map = self.pending.lock().map_err(|e| format!("slot mutex: {e}"))?;
        Ok(map.remove(request_id))
    }
}

/// Generate a stable per-call UUID-shaped string. We don't pull in
/// the `uuid` crate because the value never leaves the in-process
/// bridge — it just has to be unique within the HashMap during the
/// call's lifetime. 16 random bytes (RFC 4122 v4 bit pattern) is
/// more than enough for collision avoidance at the rate GOG logins
/// happen.
///
/// Format: `xxxxxxxx-xxxx-Mxxx-Nxxx-xxxxxxxxxxxx` with `M` indicating
/// the version (4) and the top two bits of `N` indicating the variant
/// (10x), per RFC 4122 §4.4. JS-side `crypto.randomUUID()` produces
/// the same shape, so the values are visually consistent if the
/// frontend ever logs them.
///
/// Sibling module `sync.rs` calls this through `super::auth::request_id_v4`
/// to arm the same bridge the login flow uses; exposing as
/// `pub(crate)` keeps the API surface narrow.
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

// ── Public Tauri commands ──────────────────────────────────────────

/// Open a Tauri WebView at gog.com, wait for the user to log in,
/// resolve the GOG session marker, return it. This is the new
/// `gog_start_login` — replaces both the old two-phase OAuth
/// handshake (start_login + finish_login) AND the now-dead OAuth
/// client_id/secret dance.
///
/// `request_id` is the per-call UUID keying the WebView → Rust
/// callback bridge. Optional: if absent (frontend didn't pass one
/// — the default `gog_start_login` invocation does NOT pass it),
/// Rust generates a fresh UUID internally. Passing it externally
/// is useful for tests / logging.
//
// The function name mirrors the old OAuth `gog_start_login` for
// frontend-compat — SettingsPage still calls `invoke('gog_start_login')`
// and gets back a session-shaped object.
#[tauri::command]
pub async fn gog_start_login(
    app: AppHandle,
    request_id: Option<String>,
) -> Result<GogSession, String> {
    let req_id = request_id.unwrap_or_else(request_id_v4);

    // 1. Arm the slot BEFORE opening the WebView so the
    //    JS-side callback (which can fire in milliseconds if the
    //    user is already logged in from a prior session in the
    //    same WebView user-data dir) has somewhere to land.
    //    `arm()` returns the displaced sender on overlap; we drop
    //    it intentionally because the previous awaiter will surface
    //    a timeout to the user on its own and we don't care about
    //    recovery — overlap is the rare race, not the steady state.
    let (tx, rx) = mpsc::channel::<Value>();
    let slot: tauri::State<'_, GogWebviewCallbackSlot> = app.state();
    let _prior = slot.arm(req_id.clone(), tx).map_err(|e| format!("slot arm: {e}"))?;

    // 2. Open the WebView at gog.com with the JS auto-detector
    //    script injected. The script fires immediately on page
    //    load and posts back the { userId, username } bundle
    //    via `gog_webview_callback`.
    let init_script = gog_init_script_for("login", &req_id);
    let home: url::Url = GOG_HOMEPAGE_URL
        .parse()
        .map_err(|e| format!("invalid gog homepage url: {e}"))?;
    let webview = WebviewWindowBuilder::new(
        &app,
        LOGIN_WEBVIEW_LABEL,
        WebviewUrl::External(home),
    )
    .title("GOG Galaxy Login")
    .inner_size(580.0, 700.0)
    .resizable(false)
    .initialization_script(&init_script)
    .build()
    .map_err(|e| format!("Failed to create GOG login window: {e}"))?;

    // 3. Block on the channel. The closure-style `spawn_blocking`
    //    shuttles the sync `mpsc::Receiver` (which doesn't have
    //    a `.recv_timeout().await`) onto Tokio's executor; the
    //    outer `.await` then unblocks the async command. Same
    //    pattern the old OAuth flow used.
    let bundle = tokio::task::spawn_blocking(move || {
        rx.recv_timeout(std::time::Duration::from_secs(LOGIN_TIMEOUT_SECS))
    })
    .await
    .map_err(|e| format!("Join error: {e}"))?
    .map_err(|_| format!("Login timed out after {LOGIN_TIMEOUT_SECS} seconds"))?;

    // 4. Tear down the WebView regardless of outcome. The user
    //    saw a successful login OR an error toast — either way
    //    the window is no longer needed.
    let _ = webview.close();

    // Parse the body and short-circuit on JS-side errors.
    let body: GogWebviewCallbackBody =
        serde_json::from_value(bundle).map_err(|e| format!("parse callback body: {e}"))?;
    if let Some(err) = body.error {
        return Err(format!("GOG login failed: {err}"));
    }
    let user_id = body
        .user_id
        .filter(|id| !id.is_empty())
        .ok_or_else(|| "GOG login completed but no userId was returned".to_string())?;
    let username = body
        .username
        .ok_or_else(|| "GOG login completed but no username was returned".to_string())?;
    let session = GogSession {
        user_id,
        username,
        logged_in_at: current_unix(),
    };
    save_session(&app, &session)?;
    Ok(session)
}

/// Whether a `gog_session` blob exists in the OS keychain.
///
/// Cheap boolean probe — no WebView, no network, no JWT decode.
/// Callers that need to know whether the cookie jar is *still*
/// valid (cookies expire server-side independent of our keychain)
/// should open the WebView once and probe `menu.gog.com/v1/account/basic`
/// — see `gog_sync_library` for the pattern.
#[tauri::command]
pub fn gog_is_authenticated(app: AppHandle) -> bool {
    load_session_inner(&app).is_ok()
}

/// Wipe the `gog_session` keychain entry AND, defensively, the
/// legacy `gog_tokens` blob from the OAuth era so users upgrading
/// across the pivot don't carry around now-useless credentials.
/// Also clears the per-vendor kv-store display strings so the
/// integration tile renders "Not connected" cleanly on the next
/// paint.
#[tauri::command]
pub fn gog_logout(app: AppHandle) -> Result<(), String> {
    let store = db::secrets::SecretStore::new();
    // `delete` on a missing account returns Ok(()) on every
    // platform we support — we don't care if either entry was
    // never present.
    store.delete(GOG_SESSION_KEYRING_ACCOUNT)?;
    store.delete(LEGACY_GOG_TOKENS_KEYRING_ACCOUNT)?;
    if let Some(db_state) = try_db_state(&app) {
        let _ = db::kv::delete(db_state.inner(), "gog_last_login_unix");
        let _ = db::kv::delete(db_state.inner(), "gog_username");
        let _ = db::kv::delete(db_state.inner(), "gog_display_name");
    }
    Ok(())
}

/// JS-side callback installed as a Tauri command. Fires when the
/// `initialization_script` running inside a `gog-*` labelled
/// WebView posts its detected-login / sync-result bundle back to
/// Rust. Looks up the sender keyed by `request_id` (so overlapping
/// login + sync requests don't stomp each other) and ships the
/// value through. Returns an error if no slot is found —
/// ordinarily that means the Rust-side `gog_start_login` /
/// `gog_sync_library` already timed out and dropped the receiver,
/// so the JS gets a soft-failure response it can ignore.
///
/// Sync command — Tauri will not place it on the async runtime.
/// Capability to invoke this from inside the WebView is granted
/// via `capabilities/default.json` `windows: ["gog-login", "gog-sync"]`.
#[tauri::command]
pub fn gog_webview_callback(
    slot: tauri::State<'_, GogWebviewCallbackSlot>,
    request_id: String,
    value: Value,
) -> Result<(), String> {
    let tx = slot
        .take(&request_id)
        .map_err(|e| format!("slot mutex: {e}"))?;
    match tx {
        Some(tx) => {
            // `send` only fails if the receiver was dropped (Rust
            // async fn bailed). That's an OK outcome — we'd surface
            // the underlying timeout error to the user, not this
            // "receiver dropped" string.
            tx.send(value).map_err(|_| "receiver already dropped".to_string())
        }
        None => Err(format!(
            "no pending GOG callback for requestId={request_id} (already resolved or timed out)"
        )),
    }
}

/// Diagnostic passthrough fired from inside the WebView. The JS
/// detector logs every transition here so the user can see the live
/// state of the probe by watching the terminal that ran
/// `npm run tauri dev` — no DevTools required. The `eprintln!` shows
/// up in the native stderr stream that Tauri forwards in dev mode.
///
/// This pattern (rather than a `WebviewWindowBuilder::on_console_message`
/// Rust-side listener) is the canonical Tauri 2 path: app-defined
/// commands are exposed to every WebView window the moment they're
/// registered in `tauri::generate_handler!`, and the JS side just
/// does `invoke('gog_debug_log', { message: '...' })`.
///
/// No `Result` return — a logging call can't fail in any meaningful
/// way. If the WebView never invokes us, we just see fewer log
/// lines. If it invokes us 10×/sec, native stderr is plenty fast.
#[tauri::command]
pub fn gog_debug_log(message: String) {
    eprintln!("[gog-webview] {}", message);
}

// ── JS auto-detection script (one true string) ─────────────────────

/// Build the `initialization_script` payload that runs on every
/// page navigation inside a GOG WebView. Two responsibilities:
///
/// 1. Pin `window.__GOG_REQUEST_ID__` and `window.__GOG_KIND__` so
///    the rest of the script knows WHERE to send its result. These
///    globals are set BEFORE the probe loop starts, so any
///    navigation that happens DURING the loop won't lose them.
///    (Tauri 2's `initialization_script` runs on every page load —
//    see https://v2.tauri.app/reference/javascript/api/namespacewebview/
///    — so we re-set them on each load as a defensive measure.)
///
/// 2. Run the probe loop. `kind="login"` ends as soon as
///    `menu.gog.com/v1/account/basic` returns `isLoggedIn: true`; `kind="sync"` additionally fetches
///    the full library bundle (owned + metadata + playtime) before
///    posting back. The success and failure paths both call
///    `gog_webview_callback` so the Rust side always gets a
///    terminator event within `LOGIN_TIMEOUT_SECS` plus a small
///    grace window — the timeouts are belt-and-suspenders, the
///    REAL end-of-await is the callback firing.
///
/// The guard on `window.__GOG_PROBE_RAN__` is present so a navigation
/// that re-injects the script doesn't fire the probe a second
/// time. If the user is mid-login when the page navigates, the
/// original probe keeps running (its `request_id` keys are still
/// valid in Rust); the new injection is a silent no-op so we don't
/// double-callback.
///
/// `pub(crate)` so `sync.rs::gog_sync_library` can build its own
/// `kind="sync"` variant using the same probe template.
pub(crate) fn gog_init_script_for(kind: &str, request_id: &str) -> String {
    // Sub-second escapes: the format!() injects two untrusted
    // strings (kind + request_id). They're constrained to:
    //   - kind: a Rust literal ("login" / "sync") — no user input.
    //   - request_id: a `[0-9a-f-]{36}` UUID, never contains
    //     characters that would break JSON parsing, but we still
    //     JSON-encode to be safe against future request_id formats.
    let kind_json = serde_json::to_string(kind)
        .expect("kind is always a fixed string literal");
    let request_id_json = serde_json::to_string(request_id)
        .expect("request_id is always ASCII-safe from format! macros");
    // Hard upper bound identical to LOGIN_TIMEOUT_SECS for Rust,
    // expressed as `MAX_ATTEMPTS × 1s`. Counts down from this cap
    // on each probe attempt.
    let max_attempts_json = serde_json::to_string(&JS_PROBE_MAX_ATTEMPTS)
        .expect("static literal");
    format!(
        r#"
(function () {{
    if (window.__GOG_PROBE_RAN__) return;
    window.__GOG_PROBE_RAN__ = true;
    window.__GOG_REQUEST_ID__ = {request_id_json};
    window.__GOG_KIND__ = {kind_json};

    // safe_invoke: every Rust-side call goes through this helper so
    // a single failing invoke (Tauri not yet initialized, bad arg
    // shape, missing __TAURI__ global on this Tauri build) cannot
    // abort the probe — we stay best-effort throughout. Returns
    // `null` on failure; callers should treat null as "no answer
    // from Rust right now" and keep going.
    //
    // DO NOT extract `window.__TAURI__.core.invoke` to a local — the
    // `this` binding would be lost on call and Tauri 2 throws
    // `TypeError: Illegal invocation`. Always invoke through the
    // full member chain so `this === window.__TAURI__.core`.
    async function safe_invoke(cmd, args) {{
        try {{
            if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {{
                return await window.__TAURI__.core.invoke(cmd, args);
            }}
            return await window.__TAURI_INTERNALS__.invoke(cmd, args);
        }} catch (e) {{
            try {{ console.error('[GOG] invoke(' + cmd + ') failed:', e); }} catch (_) {{}}
            return null;
        }}
    }}

    // banner_inject: drop a fixed red banner at the very top of the
    // page when probing has stalled long enough that the user
    // probably hasn't signed in to GOG yet. Updating the same
    // banner across attempts keeps page noise low.
    function banner_inject(text) {{
        try {{
            var existing = document.getElementById('__GOG_BANNER__');
            if (existing) {{ existing.textContent = text; return; }}
            var b = document.createElement('div');
            b.id = '__GOG_BANNER__';
            b.textContent = text;
            b.style.cssText = 'color:#fff;background:#c33;padding:14px 16px;text-align:center;position:fixed;top:0;left:0;width:100%;z-index:2147483647;font:600 14px system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.4);';
            (document.body || document.documentElement).appendChild(b);
        }} catch (_) {{}}
    }}

    // Tell Rust we're alive. Reaches native stderr via gog_debug_log
    // so the user can `tail` the terminal they launched `npm run
    // tauri dev` in and watch the probe live.
    safe_invoke('gog_debug_log', {{
        message: '[GOG] init running on ' + location.href + ' (kind=' + window.__GOG_KIND__ + ', requestId=' + window.__GOG_REQUEST_ID__ + ')'
    }});

    (async function probe() {{
        var MAX_ATTEMPTS = {max_attempts_json};
        var KIND = window.__GOG_KIND__;
        var start_ms = Date.now();

        async function j(url) {{
            var r = await fetch(url, {{ credentials: 'include' }});
            if (r.status !== 200) throw new Error('HTTP ' + r.status);
            return await r.json();
        }}

        for (var attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {{
            try {{
                var me = await j('https://menu.gog.com/v1/account/basic');
                if (!me || !me.isLoggedIn) throw new Error('not logged in (isLoggedIn=' + (me && me.isLoggedIn) + ')');
                safe_invoke('gog_debug_log', {{
                    message: '[GOG] account/basic OK: userId=' + (me.userId || '') + ' username=' + (me.username || '')
                }});
                // menu.gog.com/v1/account/basic MAY not include userId —
                // Playnite only reads isLoggedIn + username from it.
                // Fall-back through common alternative keys so the Rust
                // handler receives a non-empty value.
                var resolvedUserId = me.userId || me.id || me.galaxyUserId || me.user_id || '';
                var payload = {{
                    userId: String(resolvedUserId),
                    username: me.username || ''
                }};
                if (KIND === 'sync') {{
                    var owned = await j('https://embed.gog.com/user/data/games');
                    var ids = (owned && owned.owned) || [];
                    payload.owned = ids;
                    if (ids.length > 0) {{
                        var csv = ids.slice(0, 50).join(',');
                        try {{
                            var meta = await j('https://api.gog.com/products?ids=' + encodeURIComponent(csv) + '&expand=description,images,releaseDate');
                            payload.metadata = Array.isArray(meta) ? meta : [];
                        }} catch (e) {{ payload.metadata = []; }}
                        try {{
                            var pt = await j('https://gameplay.gog.com/clients/' + encodeURIComponent(String(me.userId)) + '/playtime');
                            payload.playtime = Array.isArray(pt) ? pt : [];
                        }} catch (e) {{ payload.playtime = []; }}
                    }} else {{
                        payload.metadata = [];
                        payload.playtime = [];
                    }}
                }} else {{
                    payload.owned = [];
                    payload.metadata = [];
                    payload.playtime = [];
                }}
                var cb = await safe_invoke('gog_webview_callback', {{
                    requestId: window.__GOG_REQUEST_ID__,
                    value: payload
                }});
                safe_invoke('gog_debug_log', {{
                    message: '[GOG] callback fired; Rust returned: ' + JSON.stringify(cb) + ' (' + (Date.now() - start_ms) + 'ms total)'
                }});
                return;
            }} catch (e) {{
                if (attempt % 5 === 0) {{
                    var secs = Math.round((Date.now() - start_ms)/1000);
                    var hint = (attempt === 5) ? ' — if you see a "Sign In" button on this page, click it!' : ' — still waiting';
                    safe_invoke('gog_debug_log', {{
                        message: '[GOG] attempt ' + attempt + ' failed: ' + (e && e.message || String(e)) + ' (' + secs + 's elapsed)' + hint
                    }});
                    if (attempt === 5 || attempt === 30 || attempt === 60) {{
                        banner_inject('Not signed in to GOG yet — click the "Sign In" button to log in.');
                    }}
                }}
                await new Promise(function (r) {{ setTimeout(r, 1000); }});
            }}
        }}
        safe_invoke('gog_debug_log', {{
            message: '[GOG] timed out after ' + MAX_ATTEMPTS + ' attempts (' + Math.round((Date.now() - start_ms)/1000) + 's elapsed)'
        }});
        banner_inject('GOG login timed out. Close this window and retry from Gamelib Settings.');
        await safe_invoke('gog_webview_callback', {{
            requestId: window.__GOG_REQUEST_ID__,
            value: {{ error: 'Timed out waiting for GOG session' }}
        }});
    }})();
}})();
"#,
        kind_json = kind_json,
        request_id_json = request_id_json,
        max_attempts_json = max_attempts_json,
    )
}

// ── helpers (private) ──────────────────────────────────────────────

fn current_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn save_session(app: &AppHandle, session: &GogSession) -> Result<(), String> {
    let json = serde_json::to_string(session).map_err(|e| format!("serialize session: {e}"))?;
    let store = db::secrets::SecretStore::new();
    store.set(GOG_SESSION_KEYRING_ACCOUNT, &json)?;
    // Per-vendor display strings for the Settings tile ("Connected as"
    // subtitle + "Last connected" tooltip). `db::kv::set` accepts
    // `&str` for the value; we bind explicit `String`s and pass
    // `.as_str()` so the compiler never has to infer a `&String` →
    // `&str` coercion (which depending on the rustc version + lints
    // can produce E0308 "expected reference, found u32" when a
    // coerce-then-asm-block intermediate gets re-mapped). Matching
    // pattern used by `gog_logout` above.
    if let Some(db_state) = try_db_state(app) {
        let login_unix = current_unix().to_string();
        let username_str = session.username.as_str();
        let _ = db::kv::set(
            db_state.inner(),
            "gog_last_login_unix",
            login_unix.as_str(),
        );
        let _ = db::kv::set(db_state.inner(), "gog_username", username_str);
        let _ = db::kv::set(db_state.inner(), "gog_display_name", username_str);
    }
    Ok(())
}

/// Public load_session entry point for sibling modules.
/// `sync.rs` calls this before opening the sync WebView so a
/// missing `gog_session` keychain entry can short-circuit into a
/// "Connect GOG first" toast instead of spinning up a useless
/// WebView that flashes open and closes.
pub(crate) fn load_session_pub(_app: &AppHandle) -> Result<GogSession, String> { load_session_inner(_app) }

fn load_session_inner(_app: &AppHandle) -> Result<GogSession, String> {
    let store = db::secrets::SecretStore::new();
    let secret = store
        .get(GOG_SESSION_KEYRING_ACCOUNT)?
        .ok_or_else(|| "No GOG session stored".to_string())?;
    serde_json::from_str(&secret).map_err(|e| format!("Failed to parse session: {e}"))
}

/// Mirror of `epic::auth::try_db_state` — the runner registers `db::Db`
/// during `setup()`, which completes before any command runs, so the
/// `try_state` lookup is the safe pattern.
fn try_db_state(app: &AppHandle) -> Option<tauri::State<'_, db::Db>> {
    app.try_state::<db::Db>()
}
