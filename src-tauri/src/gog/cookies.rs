//! GOG cookie capture + persistence (kv_store-backed).
//!
//! After the OAuth login WebView completes, we snapshot the
//! WebView's cookie jar via `WebviewWindow::cookies()`. That
//! gives us HttpOnly session cookies which `embed.gog.com/user/data/games`
//! requires — even with Bearer auth on other endpoints, the
//! owned-library endpoint only accepts cookie-based auth.
//!
//! Persistence: we serialize the cookies to JSON in the SQLite
//! `kv_store` table under key `gog_cookies`. The OS keychain was
//! previously used but the `keyring` crate's Windows backend
//! silently fails writes (see auth.rs for details).

use serde::{Deserialize, Serialize};
use tauri::WebviewWindow;

use crate::db;

/// kv_store key for the persisted cookies blob.
pub const GOG_COOKIES_KV_KEY: &str = "gog_cookies";

/// Browser UA we present to GOG via the `reqwest` default — match
/// a recent Chrome desktop profile so the server doesn't
/// side-grade us to a bot response.
pub const GOG_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/// One persisted cookie record — minimal fields needed to round-
/// trip a `cookie::Cookie<'static>` back into reqwest's jar.
/// `expires_unix` is intentionally omitted; see module docs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GogCookieRecord {
    pub name: String,
    pub value: String,
    /// Domain attribute as captured (host-only cookies have no
    /// leading dot; Domain cookies may or may not). We round-trip
    /// verbatim.
    #[serde(default)]
    pub domain: Option<String>,
    /// Path attribute — defaults to `/` for cookies with no path.
    #[serde(default)]
    pub path: Option<String>,
}

/// Persistable set of captured cookies.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GogCookies {
    /// Unix seconds when capture happened — diagnostic only.
    #[serde(default)]
    pub captured_at: u64,
    pub records: Vec<GogCookieRecord>,
}

// ── Capture from a live WebView ─────────────────────────────────────

/// Snapshot every GOG-domain cookie currently in `window`'s jar.
///
/// Filters to `gog.com` / `gogcdn.com` / `images.gog-static.com`
/// so we don't capture third-party tracking cookies into the
/// keychain blob. The WebView stays open after this call —
/// caller is responsible for closing it.
pub async fn capture_from_webview(
    window: &WebviewWindow,
) -> Result<GogCookies, String> {
    // `WebviewWindow::cookies()` returns
    // `tauri::Result<Vec<tauri::webview::Cookie<'_>>>` synchronously
    // on Tauri 2.x. The cookie type is `tauri::webview::Cookie`
    // (re-export of `http::Cookie`), which has a `.name()/.value()/.domain()/.path()`
    // accessor surface — the same names `reqwest::cookie::Cookie`
    // exposes since reqwest re-exports the same upstream type.
    // **No `.await`** — `cookies()` is sync.
    let raw = window
        .cookies()
        .map_err(|e| format!("GOG cookies(): {e}"))?;

    let records: Vec<GogCookieRecord> = raw
        .iter()
        .filter_map(cookie_to_record)
        .collect();

    Ok(GogCookies {
        captured_at: current_unix(),
        records,
    })
}

fn cookie_to_record(c: &tauri::webview::Cookie<'_>) -> Option<GogCookieRecord> {
    // `tauri::webview::Cookie` re-exports `http::Cookie<'static>`,
    // whose accessors return `Option<&str>` (NOT the typed
    // `cookie::CookieDomain` enum nor plain `&str`). We `.unwrap_or("")`
    // / `.unwrap_or("/")` everywhere and `.to_string()` to coerce
    // into the owned `String` shape the records expect.
    let name = c.name().to_string();
    if name.is_empty() {
        return None;
    }
    // For the gog.com filter we want the canonical hostname form
    // (with or without leading dot — same after .trim_start_matches('.')).
    // We keep the FULL `.domain()` string (with any leading dot)
    // for the record so jar rehydrate preserves the original
    // Domain vs HostOnly distinction.
    let domain_for_filter = c.domain().unwrap_or("").to_string();
    if !is_gog_domain(&domain_for_filter) {
        return None;
    }
    Some(GogCookieRecord {
        name,
        value: opt_to_string(Some(c.value())),
        domain: {
            let d = opt_to_string(c.domain());
            if d.is_empty() { None } else { Some(d) }
        },
        path: opt_to_string(c.path()).pipe(|s| if s.is_empty() { None } else { Some(s) }),
    })
}

/// Helper that accepts an accessor that may return either
/// `Option<&str>` or `&str` depending on the exact tauri version
/// (the re-exported `http::Cookie` API is unstable across minor
/// bumps). Coerces to owned `String`.
fn opt_to_string(s: Option<&str>) -> String {
    s.unwrap_or("").to_string()
}

/// Trait extension to use `pipe` on owned String (mirrors Rust's
/// `Result::pipe` style without bringing in a new dep).
trait Pipe: Sized {
    fn pipe<U, F: FnOnce(Self) -> Option<U>>(self, f: F) -> Option<U> {
        f(self)
    }
}
impl<T> Pipe for T {}

fn is_gog_domain(domain: &str) -> bool {
    let d = domain.trim_start_matches('.').to_ascii_lowercase();
    d == "gog.com"
        || d.ends_with(".gog.com")
        || d == "gogcdn.com"
        || d.ends_with(".gogcdn.com")
        || d == "gog-static.com"
        || d.ends_with(".gog-static.com")
}

// ── Persistence (SQLite kv_store) ───────────────────────────────────

/// Save `cookies` to the kv_store. Overwrites any prior entry.
pub fn persist(db: &crate::db::pool::Db, cookies: &GogCookies) -> Result<(), String> {
    let json = serde_json::to_string(cookies)
        .map_err(|e| format!("serialize cookies: {e}"))?;
    db::kv::set(db, GOG_COOKIES_KV_KEY, &json)
}

/// Load previously saved cookies, if any.
pub fn load(db: &crate::db::pool::Db) -> Option<GogCookies> {
    db::kv::get(db, GOG_COOKIES_KV_KEY)
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str(&raw).ok())
}

/// Delete the persisted cookie set. Idempotent.
pub fn delete_from_kv(db: &crate::db::pool::Db) -> Result<(), String> {
    db::kv::delete(db, GOG_COOKIES_KV_KEY)
}

// ── Rehydration for reqwest Jar ─────────────────────────────────────

/// Build a `reqwest::cookie::Jar` populated from `cookies` so a
/// fresh `reqwest::Client` carries them on every request.
///
/// We round-trip via Set-Cookie strings to keep the call surface
/// minimal — `jar.add_cookie_str("name=value; Domain=.gog.com;
/// Path=/")` parses the string and inserts. The `HttpOnly` and
/// `Secure` flags are intentionally NOT serialized; reqwest
/// treats them as informational hints and the values get sent on
/// same-origin HTTPS requests regardless. We DO preserve
/// Domain/Path because send-side matching depends on them.
pub fn jar_from(cookies: &GogCookies) -> Result<reqwest::cookie::Jar, String> {
    let jar = reqwest::cookie::Jar::default();
    for rec in &cookies.records {
        let set_cookie_string = build_set_cookie_string(rec);
        // Attach each cookie at the URL whose hostname matches
        // its Domain attribute. Attachment at the wrong URL
        // can leave the cookie unregistered for sibling hosts
        // like api.gog.com — reqwest's match-on-source-URL rule
        // would then NOT send it. Use the cookie's domain or
        // fall back to `www.gog.com`.
        let attach_host = rec
            .domain
            .as_deref()
            .map(|d| d.trim_start_matches('.'))
            .filter(|d| !d.is_empty())
            .unwrap_or("www.gog.com");
        let attach_url: url::Url = format!("https://{attach_host}/")
            .parse()
            .map_err(|e| format!("invalid cookie attach url for {}: {e}", rec.name))?;
        jar.add_cookie_str(&set_cookie_string, &attach_url);
    }
    Ok(jar)
}

fn build_set_cookie_string(rec: &GogCookieRecord) -> String {
    let mut s = format!("{}={}", rec.name, rec.value);
    if let Some(domain) = &rec.domain {
        if !domain.is_empty() {
            s.push_str(&format!("; Domain={domain}"));
        }
    }
    let path = rec.path.as_deref().unwrap_or("/");
    s.push_str(&format!("; Path={path}"));
    s
}

/// Helper variant — callers typically need `Arc<Jar>` (the
/// `cookie_provider` builder requires one).
pub fn arc_jar_from(
    cookies: &GogCookies,
) -> Result<std::sync::Arc<reqwest::cookie::Jar>, String> {
    Ok(std::sync::Arc::new(jar_from(cookies)?))
}

// ── Helpers ─────────────────────────────────────────────────────────

fn current_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gog_domain_filter_accepts_subdomains() {
        assert!(is_gog_domain("gog.com"));
        assert!(is_gog_domain(".gog.com"));
        assert!(is_gog_domain("embed.gog.com"));
        assert!(is_gog_domain("www.gog.com"));
        assert!(is_gog_domain("gogcdn.com"));
        assert!(is_gog_domain("images.gog-static.com"));
    }

    #[test]
    fn gog_domain_filter_rejects_third_parties() {
        assert!(!is_gog_domain("google-analytics.com"));
        assert!(!is_gog_domain("facebook.com"));
        assert!(!is_gog_domain(""));
    }

    #[test]
    fn rehydrate_jar_carries_persisted_cookie() {
        let cookies = GogCookies {
            captured_at: 0,
            records: vec![GogCookieRecord {
                name: "gogus".into(),
                value: "abc123".into(),
                domain: Some(".www.gog.com".into()),
                path: Some("/".into()),
            }],
        };
        let jar = jar_from(&cookies).expect("jar build ok");
        let test_url: url::Url = "https://www.gog.com/".parse().unwrap();
        let header_bytes = jar.cookies(test_url).expect("cookie header");
        let header = header_bytes.value();
        assert!(header.contains("gogus=abc123"), "got: {header}");
    }
}
