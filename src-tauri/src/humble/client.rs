//! Humble HTTP client — pure-Rust `reqwest` backed by the captured
//! cookie jar. Fetches the user's game keys + orders, and (optionally)
//! pages through the Trove catalog. Mirrors Playnite's
//! `HumbleAccountClient` + `GetLibraryGames`/`GetTroveGames`.

use std::sync::Arc;

use super::auth::{arc_jar_from, HumbleCookies};
use super::types::{
    HumbleOrder, HumbleTroveGame,
};

const HUMBLE_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const ORDERS_URL_ROOT: &str = "https://www.humblebundle.com/api/v1/orders?all_tpkds=true";
const TROVE_CATALOG_ROOT: &str = "https://www.humblebundle.com/client/catalog?index=";

pub struct HumbleClient {
    client: reqwest::Client,
}

impl HumbleClient {
    /// Build a client from the persisted cookies. Returns an error when
    /// the user is not authenticated (no cookie blob).
    pub fn from_app(app: &tauri::AppHandle) -> Result<Self, String> {
        let cookies: HumbleCookies =
            super::auth::load_cookies(app).ok_or_else(|| {
                "Not authenticated with Humble — connect your account first".to_string()
            })?;
        let jar = arc_jar_from(&cookies).unwrap_or_else(|e| {
            eprintln!("[humble-client] cookie jar build failed: {e}");
            Arc::new(reqwest::cookie::Jar::default())
        });
        let client = reqwest::Client::builder()
            .user_agent(HUMBLE_USER_AGENT)
            .cookie_provider(jar)
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| format!("build HTTP client: {e}"))?;
        Ok(Self { client })
    }

    /// Fetch all orders in chunks of 40 game keys per request (Playnite
    /// uses 40 too). Returns the concatenated order list. HTTP/parse
    /// failures are surfaced as an `Err` so the caller can show a clean
    /// "session expired" message.
    pub async fn get_orders(&self, gamekeys: &[String]) -> Result<Vec<HumbleOrder>, String> {
        let per_page = 40usize;
        let mut orders: Vec<HumbleOrder> = Vec::new();
        let mut errors = 0usize;
        for chunk in gamekeys.chunks(per_page) {
            let mut bulk = String::new();
            for key in chunk {
                bulk.push_str(&format!("&gamekeys={}", urlencoding::encode(key)));
            }
            let url = format!("{ORDERS_URL_ROOT}{bulk}");
            match self.client.get(&url).send().await {
                Ok(resp) => {
                    let status = resp.status();
                    let text = resp.text().await.unwrap_or_default();
                    if !status.is_success() {
                        errors += 1;
                        eprintln!("[humble-client] orders HTTP {status} for chunk");
                        continue;
                    }
                    match serde_json::from_str::<std::collections::HashMap<String, HumbleOrder>>(&text) {
                        Ok(page) => orders.extend(page.into_values()),
                        Err(e) => {
                            errors += 1;
                            eprintln!("[humble-client] failed to parse orders page: {e}");
                        }
                    }
                }
                Err(e) => {
                    errors += 1;
                    eprintln!("[humble-client] orders request failed: {e}");
                }
            }
        }
        if orders.is_empty() && errors > 0 {
            return Err("Failed to fetch Humble orders — session may have expired".to_string());
        }
        Ok(orders)
    }

    /// Fetch the user's game keys from the library page JSON blob.
    /// Mirrors `HumbleAccountClient.GetLibraryKeys` (reads
    /// `#user-home-json-data` → `gamekeys`).
    pub async fn get_gamekeys(&self) -> Result<Vec<String>, String> {
        let resp = self
            .client
            .get("https://www.humblebundle.com/home/library")
            .send()
            .await
            .map_err(|e| format!("library page request: {e}"))?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(format!("Humble library page HTTP {status} — session may have expired"));
        }
        let marker = "\"gamekeys\"";
        let start = text
            .find(marker)
            .ok_or_else(|| "Not authenticated with Humble — no game keys found".to_string())?;
        // Locate the JSON array that follows `"gamekeys":[`.
        let after = &text[start + marker.len()..];
        let colon = after.find(':').unwrap_or(0);
        let arr_start = after[colon..]
            .find('[')
            .map(|i| colon + i)
            .ok_or_else(|| "Malformed game keys payload".to_string())?;
        // Find the matching closing bracket, accounting for nesting.
        let mut depth = 0i32;
        let mut end = arr_start;
        for (i, ch) in after[arr_start..].char_indices() {
            match ch {
                '[' => depth += 1,
                ']' => {
                    depth -= 1;
                    if depth == 0 {
                        end = arr_start + i;
                        break;
                    }
                }
                _ => {}
            }
        }
        let arr_str = &after[arr_start..=end];
        serde_json::from_str::<Vec<String>>(arr_str)
            .map_err(|e| format!("parse game keys: {e}"))
    }

    /// Page through the Trove catalog (`index=0,1,2,…`) until an empty
    /// page. Returns every Trove game entry.
    pub async fn get_trove_games(&self) -> Result<Vec<HumbleTroveGame>, String> {
        let mut out: Vec<HumbleTroveGame> = Vec::new();
        let mut index: u32 = 0;
        loop {
            let url = format!("{TROVE_CATALOG_ROOT}{index}");
            let resp = self
                .client
                .get(&url)
                .send()
                .await
                .map_err(|e| format!("trove catalog request: {e}"))?;
            if !resp.status().is_success() {
                break;
            }
            let text = resp.text().await.unwrap_or_default();
            if text.trim().is_empty() {
                break;
            }
            match serde_json::from_str::<Vec<HumbleTroveGame>>(&text) {
                Ok(page) => {
                    if page.is_empty() {
                        break;
                    }
                    out.extend(page);
                }
                Err(e) => {
                    eprintln!("[humble-client] trove page {index} parse failed: {e}");
                    break;
                }
            }
            index += 1;
            if index > 200 {
                // Safety cap — a catalog this large is unexpected.
                break;
            }
        }
        Ok(out)
    }
}
