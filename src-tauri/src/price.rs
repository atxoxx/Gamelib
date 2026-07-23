//! Per-game price lookup via the CheapShark API.
//!
//! CheapShark (<https://apidocs.cheapshark.com/>) is a free, key-less
//! aggregator of PC game store prices. We use it to surface a "current
//! cheapest price" badge on store cards and to power wishlist price-drop
//! detection — without requiring the user to configure any API key.
//!
//! Results are cached in the SQLite KV store with a 6h TTL keyed by the
//! normalized title, so a grid of cards doesn't hammer the endpoint and a
//! title's price is resolved at most a few times per day.

use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::db::Db;
use tauri::Manager;

/// Resolved price snapshot for a single game.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GamePrice {
    /// Title CheapShark matched (may differ slightly from the query).
    pub title: String,
    /// Current cheapest price in USD (e.g. 14.99). `None` when free/unknown.
    pub sale_price: Option<f64>,
    /// Normal (non-sale) price in USD.
    pub normal_price: Option<f64>,
    /// Discount percent 0-100 (0 when not on sale).
    pub discount_percent: i32,
    /// Whether the title is currently on sale.
    pub is_on_sale: bool,
    /// Deep-link to the cheapest deal on CheapShark's redirector.
    pub deal_url: Option<String>,
    /// Store name for the cheapest deal (e.g. "Steam").
    pub store_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CachedPrice {
    #[serde(flatten)]
    price: GamePrice,
    updated_at: u64,
}

const CACHE_TTL_MS: u64 = 1000 * 60 * 60 * 6; // 6h
const CACHE_KEY_PREFIX: &str = "price:";

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn normalize(title: &str) -> String {
    title
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == ' ')
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Raw CheapShark `/games?title=` search result entry.
#[derive(Debug, Deserialize)]
struct CheapSharkGame {
    #[serde(rename = "external")]
    external: String,
    #[serde(rename = "cheapest")]
    cheapest: Option<String>,
    #[serde(rename = "cheapestDealID")]
    cheapest_deal_id: Option<String>,
}

/// Fetch the cheapest current price for a game by title.
///
/// Returns `None` when CheapShark has no match. Uses a 6h KV cache so the
/// same title isn't re-queried on every render.
#[tauri::command]
pub async fn fetch_game_price(app: tauri::AppHandle, game_name: String) -> Option<GamePrice> {
    let norm = normalize(&game_name);
    if norm.is_empty() {
        return None;
    }
    let key = format!("{}{}", CACHE_KEY_PREFIX, norm);
    let db_state: tauri::State<'_, Db> = app.state();

    // Cache lookup.
    if let Some(raw) = crate::db::kv::get(db_state.inner(), &key).ok().flatten() {
        if let Ok(cached) = serde_json::from_str::<CachedPrice>(&raw) {
            if cached.updated_at + CACHE_TTL_MS > now_ms() {
                return Some(cached.price);
            }
        }
    }

    let price = lookup(&game_name).await;

    if let Some(ref p) = price {
        let envelope = CachedPrice {
            price: p.clone(),
            updated_at: now_ms(),
        };
        if let Ok(json) = serde_json::to_string(&envelope) {
            let _ = crate::db::kv::set(db_state.inner(), &key, &json);
        }
    }

    price
}

/// Batch price lookup. Returns a `{ name -> GamePrice }` map (only matched
/// entries). Used by the store grid so a page of cards makes far fewer
/// requests, and by the wishlist deals view.
#[tauri::command]
pub async fn fetch_game_prices_batch(
    app: tauri::AppHandle,
    game_names: Vec<String>,
) -> std::collections::HashMap<String, GamePrice> {
    use futures::stream::{self, StreamExt};
    const MAX_CONCURRENT: usize = 4;

    let db_state: tauri::State<'_, Db> = app.state();
    let mut resolved: std::collections::HashMap<String, GamePrice> =
        std::collections::HashMap::new();
    let mut cold: Vec<String> = Vec::new();

    for name in game_names {
        let norm = normalize(&name);
        if norm.is_empty() {
            continue;
        }
        let key = format!("{}{}", CACHE_KEY_PREFIX, norm);
        if let Some(raw) = crate::db::kv::get(db_state.inner(), &key).ok().flatten() {
            if let Ok(cached) = serde_json::from_str::<CachedPrice>(&raw) {
                if cached.updated_at + CACHE_TTL_MS > now_ms() {
                    resolved.insert(name, cached.price);
                    continue;
                }
            }
        }
        cold.push(name);
    }

    let scraped: Vec<(String, Option<GamePrice>)> = stream::iter(cold)
        .map(|name| async move {
            let p = lookup(&name).await;
            (name, p)
        })
        .buffer_unordered(MAX_CONCURRENT)
        .collect()
        .await;

    for (name, price) in scraped {
        if let Some(p) = price {
            let norm = normalize(&name);
            let key = format!("{}{}", CACHE_KEY_PREFIX, norm);
            let envelope = CachedPrice {
                price: p.clone(),
                updated_at: now_ms(),
            };
            if let Ok(json) = serde_json::to_string(&envelope) {
                let _ = crate::db::kv::set(db_state.inner(), &key, &json);
            }
            resolved.insert(name, p);
        }
    }

    resolved
}

/// Perform the actual CheapShark query for a single title.
async fn lookup(title: &str) -> Option<GamePrice> {
    let client = reqwest::Client::builder()
        .user_agent("GameIndex/1.0")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .ok()?;

    let url = format!(
        "https://www.cheapshark.com/api/1.0/games?title={}&limit=1",
        urlencoding::encode(title)
    );
    let resp = client.get(&url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let games: Vec<CheapSharkGame> = resp.json().await.ok()?;
    let first = games.into_iter().next()?;

    let cheapest: Option<f64> = first.cheapest.as_deref().and_then(|s| s.parse().ok());

    // Resolve the deal to get normal price + savings if we have a deal id.
    let (normal_price, discount_percent, store_id) =
        if let Some(deal_id) = first.cheapest_deal_id.as_deref() {
            lookup_deal(&client, deal_id).await.unwrap_or((None, 0, None))
        } else {
            (None, 0, None)
        };

    let deal_url = first
        .cheapest_deal_id
        .as_ref()
        .map(|id| format!("https://www.cheapshark.com/redirect?dealID={}", id));

    Some(GamePrice {
        title: first.external,
        sale_price: cheapest,
        normal_price,
        discount_percent,
        is_on_sale: discount_percent > 0,
        deal_url,
        store_id,
    })
}

#[derive(Debug, Deserialize)]
struct CheapSharkDealWrapper {
    #[serde(rename = "gameInfo")]
    game_info: Option<CheapSharkDealInfo>,
}

#[derive(Debug, Deserialize)]
struct CheapSharkDealInfo {
    #[serde(rename = "retailPrice")]
    retail_price: Option<String>,
    #[serde(rename = "salePrice")]
    _sale_price: Option<String>,
    #[serde(rename = "storeID")]
    store_id: Option<String>,
}

/// Look up a single deal to recover the retail price + discount.
async fn lookup_deal(
    client: &reqwest::Client,
    deal_id: &str,
) -> Option<(Option<f64>, i32, Option<String>)> {
    let url = format!("https://www.cheapshark.com/api/1.0/deals?id={}", deal_id);
    let resp = client.get(&url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let wrapper: CheapSharkDealWrapper = resp.json().await.ok()?;
    let info = wrapper.game_info?;
    let retail: Option<f64> = info.retail_price.as_deref().and_then(|s| s.parse().ok());
    let sale: Option<f64> = info._sale_price.as_deref().and_then(|s| s.parse().ok());
    let discount = match (retail, sale) {
        (Some(r), Some(s)) if r > 0.0 && s < r => (((r - s) / r) * 100.0).round() as i32,
        _ => 0,
    };
    Some((retail, discount, info.store_id))
}
