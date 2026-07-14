//! Pure-Rust HTTP client for GOG API endpoints — Bearer-token
//! authenticated (OAuth2). Replaces the old cookie-jar approach.
//!
//! Built on `reqwest::Client` with `Authorization: Bearer <token>`
//! on every request. No cookies, no WebView, no Tauri — just
//! HTTPS GET with a typed token header.
//!
//! Endpoints (Playnite / Comet parity):
//!
//! | Probe / data                | URL                                                 |
//! |-----------------------------|-----------------------------------------------------|
//! | Account basic / token check | `https://menu.gog.com/v1/account/basic`            |
//! | Owned library + embedded stats | `https://embed.gog.com/user/data/games`          |
//! | Bulk product metadata       | `https://api.gog.com/products?ids=<csv>&expand=...` |
//! | Playtime mirror             | `https://gameplay.gog.com/clients/<uid>/playtime`   |
//!
//! All four accept `Authorization: Bearer <access_token>`. The
//! `menu.gog.com/v1/account/basic` endpoint also works with
//! cookies (the old flow probed it that way), but Bearer is the
//! canonical Galaxy-client auth path.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use futures::stream::{self, StreamExt};

use super::types::{GogPlaytimeMirror, GogProductMeta};

/// Browser UA for the HTTP client — match a recent Chrome
/// desktop profile so the server doesn't side-grade us.
pub const GOG_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/// Subset of `menu.gog.com/v1/account/basic`'s response that we
/// care about.
#[derive(Debug, Deserialize, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GogAccountBasic {
    #[serde(default)]
    pub is_logged_in: bool,
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub galaxy_user_id: Option<String>,
}

/// Bearer-authenticated closure over GOG's HTTP endpoints.
/// Optionally carries a cookie jar for endpoints that require
/// session cookies (notably `embed.gog.com/user/data/games`).
pub struct GogClient {
    http: reqwest::Client,
}

impl GogClient {
    /// Build a client from an access token + optional session cookies.
    /// Every request carries `Authorization: Bearer <token>`.
    /// If a cookie jar is provided, it's attached at the Client
    /// level so all requests to gog.com domains carry the cookies.
    pub fn from_token(
        access_token: &str,
        cookie_jar: Option<std::sync::Arc<reqwest::cookie::Jar>>,
    ) -> Result<Self, String> {
        let mut headers = reqwest::header::HeaderMap::new();
        let bearer = format!("Bearer {access_token}");
        let mut auth_value = reqwest::header::HeaderValue::from_str(&bearer)
            .map_err(|e| format!("invalid bearer token: {e}"))?;
        auth_value.set_sensitive(true);
        headers.insert(reqwest::header::AUTHORIZATION, auth_value);

        let mut builder = reqwest::Client::builder()
            .user_agent(GOG_USER_AGENT)
            .default_headers(headers)
            .timeout(std::time::Duration::from_secs(15));
        if let Some(jar) = cookie_jar {
            builder = builder.cookie_provider(jar);
        }
        let http = builder
            .build()
            .map_err(|e| format!("build GOG reqwest client: {e}"))?;
        Ok(Self { http })
    }

    /// Probe `menu.gog.com/v1/account/basic` to verify the access
    /// token is still live and return identity.
    pub async fn get_account_basic(&self) -> Result<GogAccountBasic, String> {
        let url = "https://menu.gog.com/v1/account/basic";
        match self.http.get(url).send().await {
            Ok(resp) => {
                let status = resp.status();
                if !status.is_success() {
                    return Err(format!(
                        "GOG account probe HTTP {} — session expired",
                        status.as_u16()
                    ));
                }
                let body: GogAccountBasic = resp
                    .json()
                    .await
                    .map_err(|e| format!("decode account/basic: {e}"))?;
                if !body.is_logged_in {
                    return Err(
                        "GOG account probe returned isLoggedIn=false — session expired"
                            .to_string(),
                    );
                }
                Ok(body)
            }
            Err(e) => Err(format!("GOG account probe transport error: {e}")),
        }
    }

    /// Fetch the owned library — returns numeric product IDs.
    ///
    /// With cookie auth, `embed.gog.com/user/data/games` returns
    /// `{"owned": [1090734724, 1111421371, ...]}` — an array of
    /// bare integer product IDs, not the rich `{game:..., stats:...}`
    /// objects we get with Bearer auth. Metadata and stats are
    /// fetched separately via `get_bulk_metadata` and `get_playtime`.
    pub async fn get_owned_ids(&self) -> Result<Vec<String>, String> {
        let url = "https://embed.gog.com/user/data/games";
        let resp = self
            .http
            .get(url)
            .send()
            .await
            .map_err(|e| format!("GET {url}: {e}"))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(format!(
                "GET {url} HTTP {} — library fetch failed",
                status.as_u16()
            ));
        }
        #[derive(Deserialize)]
        struct Wrap {
            #[serde(default)]
            owned: Vec<serde_json::Value>,
        }
        let body_text = resp.text().await.unwrap_or_default();
        let wrap: Wrap = serde_json::from_str(&body_text).map_err(|e| {
            let preview = &body_text[..body_text.len().min(2000)];
            format!("decode owned: {e} — raw body preview: {preview}")
        })?;
        // Accept both integer and string product IDs — GOG returns
        // bare integers with cookie auth, but may return objects or
        // strings with other auth methods.
        let ids: Vec<String> = wrap
            .owned
            .into_iter()
            .map(|v| match v {
                serde_json::Value::Number(n) => n.to_string(),
                serde_json::Value::String(s) => s,
                _ => String::new(),
            })
            .filter(|s| !s.is_empty())
            .collect();
        eprintln!("[gog-client] owned IDs: {} product ids", ids.len());
        Ok(ids)
    }

    /// Per-product metadata via embed.gog.com (cookie auth).
    ///
    /// `api.gog.com/products/*` rejects non-Galaxy clients with
    /// HTTP 400. The `embed.gog.com/account/gameDetails/{id}.json`
    /// endpoint is the cookie-auth metadata source used by Playnite
    /// and web-based GOG account pages. We fetch concurrently with
    /// up to 10 parallel requests.
    pub async fn get_bulk_metadata(
        &self,
        ids: &[String],
    ) -> Result<HashMap<String, GogProductMeta>, String> {
        let mut out: HashMap<String, GogProductMeta> = HashMap::new();
        if ids.is_empty() {
            return Ok(out);
        }

        let results: Vec<(String, Result<GogProductMeta, String>)> = stream::iter(ids.iter().cloned())
            .map(|id| {
                let http = self.http.clone();
                async move {
                    let url = format!(
                        "https://embed.gog.com/account/gameDetails/{}.json",
                        id,
                    );
                    let resp = match http.get(&url).send().await {
                        Ok(r) => r,
                        Err(e) => return (id, Err(format!("GET {url}: {e}"))),
                    };
                    let status = resp.status();
                    if !status.is_success() {
                        let body = resp.text().await.unwrap_or_default();
                        return (id, Err(format!(
                            "HTTP {} — {}",
                            status.as_u16(),
                            &body[..body.len().min(200)]
                        )));
                    }
                    let meta = match resp.json::<GogProductMeta>().await {
                        Ok(m) => m,
                        Err(e) => {
                            let msg = format!("decode product {id}: {e}");
                            return (id, Err(msg));
                        }
                    };
                    (id, Ok(meta))
                }
            })
            .buffer_unordered(10)
            .collect()
            .await;

        let mut errors = 0usize;
        for (product_id, result) in results {
            match result {
                Ok(mut meta) => {
                    if meta.id.is_empty() {
                        meta.id = product_id;
                    }
                    meta.resolve_cover();
                    if !meta.title.is_empty() {
                        out.insert(meta.id.clone(), meta);
                    }
                }
                Err(e) => {
                    errors += 1;
                    if errors <= 5 {
                        eprintln!("[gog-client] metadata fetch error (id={}): {e}", product_id);
                    }
                }
            }
        }
        eprintln!(
            "[gog-client] metadata: {}/{} products fetched ({} errors)",
            out.len(),
            ids.len(),
            errors
        );
        Ok(out)
    }

    /// Fallback playtime source: maps game id → total playtime +
    /// last_session.
    pub async fn get_playtime(
        &self,
        user_id: &str,
    ) -> Result<Vec<GogPlaytimeMirror>, String> {
        if user_id.is_empty() {
            return Ok(Vec::new());
        }
        let url = format!(
            "https://gameplay.gog.com/clients/{}/playtime",
            urlencoding::encode(user_id),
        );
        let resp = match self.http.get(&url).send().await {
            Ok(r) => r,
            Err(e) => return Err(format!("GET {url}: {e}")),
        };
        let status = resp.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Ok(Vec::new());
        }
        if !status.is_success() {
            return Err(format!(
                "GET {url} HTTP {} — playtime fetch failed",
                status.as_u16()
            ));
        }
        let rows: Vec<GogPlaytimeMirror> = resp
            .json()
            .await
            .map_err(|e| format!("decode playtime: {e}"))?;
        Ok(rows)
    }
}
