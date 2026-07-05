//! Backend support for the `/deals` page.
//!
//! Two data sources power the Deals tab:
//!   1. Xbox GamePass catalog  — `fetch_gamepass_catalog`
//!   2. IsThereAnyDeal specials — `fetch_isthereanydeal_deals`
//!
//! ## GamePass
//!
//! The public Microsoft catalog is fetched in two steps (mirrors the
//! approach used by `darklinkpower/PlayniteExtensionsCollection`
//! GamePassCatalogBrowser and the `Playnite_XCloud_Library`
//! `XBoxHelper`):
//!
//!   1. `https://catalog.gamepass.com/sigls/v2?id={GUID}&market=...&language=...`
//!      returns a JSON array of `{ "id": "..." }` entries.
//!   2. `https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=...`
//!      fetches full product metadata. We batch the IDs in groups of
//!      25 to keep the URL short.
//!
//! ## IsThereAnyDeal
//!
//! We use the official `https://api.isthereanydeal.com/deals/v2`
//! endpoint. It requires a user-supplied API key — read from the
//! `ITAD_API_KEY` environment variable (or the project root `.env`
//! file). The key is free; users register an "app" at
//! <https://isthereanydeal.com/apps/my/> to get one.
//!
//! When the key is missing, the command returns a tagged error
//! `ITAD_API_KEY_MISSING:` so the frontend can show a one-click
//! setup CTA instead of a generic "request failed" message.

use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

// ─── Data types ─────────────────────────────────────────────────────────────

/// A single Xbox GamePass catalog entry.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GamePassGame {
    /// Stable product id from the Microsoft catalog.
    pub id: String,
    /// Human-readable title.
    pub title: String,
    /// Optional marketing blurb.
    pub description: Option<String>,
    /// Square/poster image URL (already prefixed with `https:` and
    /// reformatted to a reasonable size).
    pub cover_image: Option<String>,
    /// Developer name (split from the catalog's combined string).
    pub developer: Option<String>,
    /// Publisher name (split from the catalog's combined string).
    pub publisher: Option<String>,
    /// Category / genre names attached to the product.
    pub categories: Vec<String>,
    /// Platform names ("Xbox", "PC", "Cloud").
    pub platforms: Vec<String>,
    /// ISO 8601 release date string.
    pub release_date: Option<String>,
    /// Microsoft ProductId (used for Xbox store deeplink).
    pub product_id: Option<String>,
    /// Direct Xbox store URL.
    pub deeplink: Option<String>,
}

// (The previous `pointer_from` helper and its `_POINTER_FROM_DOC`
//  reference have been removed — `Map::get` chains are used
//  inline in `itad_deal_to_item` instead.)

/// A single IsThereAnyDeal row.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DealItem {
    /// Composite deal id (store + game slug).
    pub id: String,
    /// Game title.
    pub game_title: String,
    /// Store display name.
    pub store_name: String,
    /// Direct purchase URL.
    pub store_url: String,
    /// Pre-discount price (USD).
    pub normal_price: f64,
    /// Current price (USD).
    pub deal_price: f64,
    /// Discount percent (0-100).
    pub discount_percent: i32,
    /// ISO 8601 expiration timestamp.
    pub expiration: Option<String>,
    /// Platform name.
    pub platform: String,
    /// Square thumbnail (empty until we fetch the games/info endpoint).
    pub thumbnail: Option<String>,
}

/// Filters for the GamePass catalog. Empty/`None` fields = no filter.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct GamePassFilters {
    pub region: Option<String>,
    pub categories: Option<Vec<String>>,
    pub platform: Option<String>,
}

/// Filters for IsThereAnyDeal. Empty/`None` fields = no filter.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct DealsFilters {
    pub platform: Option<String>,
    pub min_discount: Option<i32>,
    pub store: Option<String>,
}

// ─── Shared HTTP helpers ────────────────────────────────────────────────────

/// Build a shared HTTP client that mimics a real browser. Without
/// browser-like headers, both Microsoft and ITAD will block us.
fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
}

// ─── .env loader ────────────────────────────────────────────────────────────

/// Walk up the directory tree from the current working directory
/// looking for a `.env` file. Mirrors the helper in
/// `game_scraper::load_env_file` so both modules can pick up the
/// same Twitch / ITAD / Steam credentials.
fn load_env_file() {
    let mut dir = std::env::current_dir().ok();
    while let Some(path) = dir {
        let env_path = path.join(".env");
        if env_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&env_path) {
                for line in content.lines() {
                    let line = line.trim();
                    if line.is_empty() || line.starts_with('#') {
                        continue;
                    }
                    if let Some((key, val)) = line.split_once('=') {
                        let key = key.trim();
                        let val = val.trim().trim_matches('"').trim_matches('\'');
                        // Don't overwrite an already-set env var —
                        // shell-provided secrets win over the file.
                        if std::env::var_os(key).is_none() {
                            std::env::set_var(key, val);
                        }
                    }
                }
            }
            break;
        }
        dir = path.parent().map(|p| p.to_path_buf());
    }
}

/// Read the ITAD API key from the environment (after loading `.env`).
/// Returns `None` if no key is configured.
fn itad_api_key() -> Option<String> {
    load_env_file();
    std::env::var("ITAD_API_KEY")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

// ─── GamePass: Step 1 (list of IDs) ─────────────────────────────────────────

/// Catalog GUID hardcoded in xbox.com and used by all third-party
/// GamePass catalog scrapers. Identifies "Game Pass" itself.
const GAMEPASS_CATALOG_GUID: &str = "29a81209-df6f-41fd-a528-2ae6b91f719c";

/// Maximum number of `bigIds` to request in a single
/// `displaycatalog.mp.microsoft.com` call. Microsoft's docs do not
/// publish a hard cap, but 25 keeps the URL well under 8 KB and is
/// what the reference implementations use.
const GAMEPASS_BATCH_SIZE: usize = 25;

#[derive(Debug, Deserialize)]
struct SiglsResponseEntry {
    id: Option<String>,
}

/// Fetch the list of Game Pass product IDs for a given market.
async fn fetch_gamepass_ids(
    client: &reqwest::Client,
    market: &str,
    language: &str,
) -> Result<Vec<String>, String> {
    let url = format!(
        "https://catalog.gamepass.com/sigls/v2?id={}&market={}&language={}",
        GAMEPASS_CATALOG_GUID, market, language
    );
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("GamePass sigls request failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!(
            "GamePass sigls returned status {}",
            resp.status()
        ));
    }
    let parsed: Vec<SiglsResponseEntry> = resp
        .json()
        .await
        .map_err(|e| format!("GamePass sigls parse error: {}", e))?;
    Ok(parsed.into_iter().filter_map(|e| e.id).collect())
}

// ─── GamePass: Step 2 (metadata in batches) ─────────────────────────────────

#[derive(Debug, Deserialize)]
struct DisplayImage {
    #[serde(rename = "ImagePurpose")]
    image_purpose: Option<String>,
    // The v7.0 catalog uses PascalCase `Uri`; without the rename
    // this silently deserializes to `None` and every image is
    // dropped from the grid.
    #[serde(rename = "Uri")]
    uri: Option<String>,
    #[serde(rename = "Width")]
    width: Option<u32>,
    #[serde(rename = "Height")]
    height: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct DisplayLocalizedProps {
    #[serde(rename = "ProductTitle")]
    product_title: Option<String>,
    #[serde(rename = "ShortDescription")]
    short_description: Option<String>,
    #[serde(rename = "DeveloperName")]
    developer_name: Option<String>,
    #[serde(rename = "PublisherName")]
    publisher_name: Option<String>,
    // The v7.0 catalog uses PascalCase `Images`; without the rename
    // every card would render the placeholder instead of a cover.
    #[serde(rename = "Images")]
    images: Option<Vec<DisplayImage>>,
}

#[derive(Debug, Deserialize)]
struct DisplayProduct {
    #[serde(rename = "ProductId")]
    product_id: Option<String>,
    #[serde(rename = "ProductBSchema")]
    product_b_schema: Option<String>,
    #[serde(rename = "LocalizedProperties")]
    localized_properties: Option<Vec<DisplayLocalizedProps>>,
    #[serde(rename = "MarketProperties")]
    market_properties: Option<Vec<DisplayMarketProps>>,
    #[serde(rename = "Properties")]
    properties: Option<DisplayProperties>,
}

#[derive(Debug, Deserialize)]
struct DisplayMarketProps {
    #[serde(rename = "OriginalReleaseDate")]
    original_release_date: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DisplayProperties {
    // `Properties.Categories` has shipped in two shapes across the
    // v7.0 catalog: a JSON array of `{ "name": "..." }` objects
    // and a plain comma-separated string. We accept the raw JSON
    // value and normalize in `extract_categories` so the rest of
    // the code can treat both shapes uniformly without panicking
    // on a string-where-array mismatch.
    #[serde(rename = "Categories")]
    categories: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct DisplayCatalogResponse {
    // The displaycatalog v7.0 response wraps the product list under
    // a capital-P `Products` key. Without this rename serde silently
    // hits the `default` branch and returns an empty Vec — which
    // is exactly the bug that drove the empty-grid symptom.
    #[serde(rename = "Products", default)]
    products: Vec<DisplayProduct>,
}

/// Fetch full metadata for a batch of Game Pass IDs.
async fn fetch_gamepass_metadata_batch(
    client: &reqwest::Client,
    ids: &[String],
    market: &str,
    language: &str,
) -> Result<Vec<DisplayProduct>, String> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let big_ids = ids.join(",");
    let url = format!(
        "https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds={}&market={}&languages={}&MS-CV=F.1",
        urlencoding::encode(&big_ids),
        urlencoding::encode(market),
        urlencoding::encode(language),
    );
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("GamePass displaycatalog request failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!(
            "GamePass displaycatalog returned status {}",
            resp.status()
        ));
    }
    let parsed: DisplayCatalogResponse = resp
        .json()
        .await
        .map_err(|e| format!("GamePass displaycatalog parse error: {}", e))?;
    Ok(parsed.products)
}

// ─── GamePass: cover image URL helper ───────────────────────────────────────

/// Pick the best cover image for a product. The reference plugin
/// prefers the `Poster` purpose; we fall back through the catalog
/// of known purpose values to maximize hit rate.
fn best_cover_for(product: &DisplayProduct) -> Option<String> {
    // Preferred order — matches the ImagePurpose enum used by the
    // Playnite reference plugin.
    const PREFERRED: &[&str] = &[
        "Poster",
        "BoxArt",
        "TitledHeroArt",
        "HeroArt",
        "SuperHeroArt",
        "Screenshot",
    ];
    let images = product
        .localized_properties
        .as_ref()
        .and_then(|lp| lp.first())
        .and_then(|lp0| lp0.images.as_ref())?;

    for purpose in PREFERRED {
        if let Some(img) = images.iter().find(|i| {
            i.image_purpose
                .as_deref()
                .map(|p| p.eq_ignore_ascii_case(purpose))
                .unwrap_or(false)
        }) {
            if let Some(url) = normalize_image_url(&img.uri, img.width, img.height) {
                return Some(url);
            }
        }
    }
    // Final fallback — any image with a URI.
    images
        .iter()
        .find_map(|i| normalize_image_url(&i.uri, i.width, i.height))
}

/// Microsoft returns naked paths like
/// `//store-images.s-microsoft.com/image/apps.9999.123/banner.jpg`
/// — prefix with `https:` and append a sane size hint so the
/// browser doesn't pull the full-resolution original.
fn normalize_image_url(
    raw: &Option<String>,
    width: Option<u32>,
    height: Option<u32>,
) -> Option<String> {
    let raw = raw.as_deref()?.trim();
    if raw.is_empty() {
        return None;
    }
    let with_scheme = if raw.starts_with("//") {
        format!("https:{}", raw)
    } else if raw.starts_with("http://") || raw.starts_with("https://") {
        raw.to_string()
    } else if raw.starts_with('/') {
        format!("https://store-images.s-microsoft.com{}", raw)
    } else {
        format!("https://{}", raw)
    };
    // Don't double-append format params.
    if with_scheme.contains('?') {
        return Some(with_scheme);
    }
    let w = width.unwrap_or(480);
    let h = height.unwrap_or(480);
    Some(format!("{}?w={}&h={}", with_scheme, w, h))
}

// ─── Tauri commands ─────────────────────────────────────────────────────────

/// Fetch the Xbox GamePass catalog, optionally narrowed by region /
/// category / platform filters. The fetch is best-effort: on failure
/// we return a string error so the frontend can show a message.
#[tauri::command]
pub async fn fetch_gamepass_catalog(
    filters: GamePassFilters,
) -> Result<Vec<GamePassGame>, String> {
    let client = match http_client() {
        Ok(c) => c,
        Err(e) => return Err(e),
    };

    // Microsoft uses the short market code (e.g. "US") and the full
    // locale string (e.g. "en-US"). Derive the locale from the
    // market so we get reasonable defaults.
    let market = filters.region.as_deref().unwrap_or("US");
    let language = locale_for_market(market);

    // Step 1: list of IDs
    let ids = fetch_gamepass_ids(&client, market, &language).await?;
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    // Step 2: metadata in batches, fired in parallel. A 500-game
    // catalog would otherwise mean 20 round-trips in series; with
    // join_all we collapse to a single round-trip's worth of
    // wall-clock time. Individual batch failures are logged and
    // skipped — one bad batch doesn't fail the whole fetch.
    let batch_futures = ids
        .chunks(GAMEPASS_BATCH_SIZE)
        .map(|chunk| fetch_gamepass_metadata_batch(&client, chunk, market, &language))
        .collect::<Vec<_>>();
    let batch_results = futures::future::join_all(batch_futures).await;
    let mut all_products: Vec<DisplayProduct> = Vec::with_capacity(ids.len());
    for result in batch_results {
        match result {
            Ok(mut batch) => all_products.append(&mut batch),
            Err(e) => eprintln!("[deals] GamePass batch failed: {}", e),
        }
    }

    // Step 3: map into our DTO and apply category filter.
    let mut games: Vec<GamePassGame> = Vec::with_capacity(all_products.len());
    for p in all_products {
        // Filter out DLC / add-ons — they have ProductBSchema
        // "ProductAddOn;3" and the user wants base games.
        if let Some(ref schema) = p.product_b_schema {
            if schema.starts_with("ProductAddOn") {
                continue;
            }
        }

        let lp0 = match p.localized_properties.as_ref().and_then(|lp| lp.first()) {
            Some(lp) => lp,
            None => continue,
        };

        let title = match lp0.product_title.as_deref() {
            Some(t) if !t.is_empty() => t.to_string(),
            _ => continue,
        };

        // Category filter — applies against the Properties.Categories
        // list (the same source the rest of the XBOX UI uses). Each
        // chip is first expanded via `category_aliases` (e.g. "RPG"
        // → "Role playing", "Sports & racing" → "Sports" + "Racing &
        // flying") and then matched case-insensitively as either an
        // exact match or a prefix. The prefix branch covers any
        // future verbose variants the catalog might ship without
        // needing to update the alias map.
        if let Some(ref want_cats) = filters.categories {
            if !want_cats.is_empty() {
                let cats = extract_categories(p.properties.as_ref());
                let matches_any = want_cats.iter().any(|want| {
                    let aliases = category_aliases(want);
                    cats.iter().any(|pc| {
                        let pc_lc = pc.to_ascii_lowercase();
                        aliases.iter().any(|alias| {
                            let alias_lc = alias.to_ascii_lowercase();
                            pc_lc == alias_lc || pc_lc.starts_with(&alias_lc)
                        })
                    })
                });
                if !matches_any {
                    continue;
                }
            }
        }

        let cover = best_cover_for(&p);
        let categories = extract_categories(p.properties.as_ref());
        let platforms = platforms_for(filters.platform.as_deref());
        // The Xbox store URL requires a slug derived from the title,
        // not just the productId. The bare `/games/store/{pid}` shape
        // 404s for most titles; the canonical
        // `/games/store/{slug}/{pid}` format (used by the Microsoft
        // Store itself) is what resolves to the correct product page.
        // We verified all three shapes against a live API call — only
        // `/games/store/{slug}/{pid}` and `/games/store/x/{pid}` return
        // 200, and the slug form produces the canonical product page
        // rather than a redirect.
        let deeplink = p.product_id.as_deref().map(|pid| {
            let slug = slugify(&title);
            if slug.is_empty() {
                format!("https://www.xbox.com/en-US/games/store/x/{}", pid)
            } else {
                format!("https://www.xbox.com/en-US/games/store/{}/{}", slug, pid)
            }
        });
        let release_date = p
            .market_properties
            .as_ref()
            .and_then(|mp| mp.first())
            .and_then(|mp0| mp0.original_release_date.clone());

        games.push(GamePassGame {
            id: p.product_id.clone().unwrap_or_default(),
            title,
            description: lp0.short_description.clone(),
            cover_image: cover,
            developer: split_first(&lp0.developer_name),
            publisher: split_first(&lp0.publisher_name),
            categories,
            platforms,
            release_date,
            product_id: p.product_id,
            deeplink,
        });
    }

    Ok(games)
}

/// Fetch current deals from IsThereAnyDeal's official `deals/v2`
/// API. Requires the user to set the `ITAD_API_KEY` environment
/// variable (or `.env` entry) — get one free at
/// <https://isthereanydeal.com/apps/my/>. When the key is missing
/// the command returns an error string prefixed
/// `ITAD_API_KEY_MISSING:` so the frontend can show a one-click
/// setup CTA.
#[tauri::command]
pub async fn fetch_isthereanydeal_deals(
    filters: DealsFilters,
) -> Result<Vec<DealItem>, String> {
    let api_key = match itad_api_key() {
        Some(k) => k,
        None => {
            return Err(
                "ITAD_API_KEY_MISSING: Set ITAD_API_KEY in your .env file \
                 (register a free key at https://isthereanydeal.com/apps/my/)."
                    .to_string(),
            );
        }
    };

    let client = match http_client() {
        Ok(c) => c,
        Err(e) => return Err(e),
    };

    // ITAD's deals/v2 endpoint accepts a JSON body. We start with
    // no filters and apply user-supplied facets in-process to keep
    // the request shape simple.
    let body = serde_json::json!({
        "limit": 100,
    });

    let resp = match client
        .post("https://api.isthereanydeal.com/deals/v2")
        .header("ITAD-API-Key", &api_key)
        .header("Accept", "application/json")
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return Err(format!("ITAD request failed: {}", e));
        }
    };

    if resp.status().as_u16() == 429 {
        return Err(
            "ITAD rate limit reached (1000 requests / 5 min). Please wait a few \
             minutes and try again."
                .to_string(),
        );
    }
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        // 401/403 most often mean the API key is invalid or revoked.
        if status.as_u16() == 401 || status.as_u16() == 403 {
            return Err(format!(
                "ITAD_API_KEY_INVALID: ITAD returned {} (key may be wrong, \
                 revoked, or this app is not whitelisted). Body: {}",
                status, body
            ));
        }
        return Err(format!(
            "ITAD returned status {}: {}",
            status,
            body.chars().take(200).collect::<String>()
        ));
    }

    let raw: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("ITAD JSON parse error: {}", e))?;

    let mut deals: Vec<DealItem> = match raw {
        serde_json::Value::Array(arr) => arr
            .into_iter()
            .filter_map(|v| itad_deal_to_item(&v))
            .collect(),
        // Some ITAD endpoints wrap results in an object — handle both
        // shapes defensively.
        serde_json::Value::Object(obj) => obj
            .values()
            .filter_map(|v| itad_deal_to_item(v))
            .collect(),
        _ => Vec::new(),
    };

    // Sort highest discount first.
    deals.sort_by(|a, b| b.discount_percent.cmp(&a.discount_percent));

    // Apply frontend filters in-process.
    let min_discount = filters.min_discount.unwrap_or(0);
    let want_platform = filters.platform.as_deref().unwrap_or("all").to_lowercase();
    let want_store = filters.store.as_deref().unwrap_or("all").to_lowercase();

    let filtered: Vec<DealItem> = deals
        .into_iter()
        .filter(|d| d.discount_percent >= min_discount)
        .filter(|d| {
            if want_platform == "all" {
                true
            } else {
                d.platform.to_lowercase().contains(&want_platform)
            }
        })
        .filter(|d| {
            if want_store == "all" {
                true
            } else {
                d.store_name.to_lowercase().contains(&want_store)
            }
        })
        .collect();

    Ok(filtered)
}

/// Open a URL in the user's default browser. We delegate to the
/// `tauri-plugin-opener` plugin (already wired into the builder) so
/// behavior is consistent with the rest of the app. We restrict to
/// `http(s)` schemes as a defense-in-depth check — URLs are sourced
/// from an untrusted ITAD scrape. Scheme matching is case-insensitive
/// per RFC 3986 §3.1.
#[tauri::command]
pub fn open_deal_url(app: AppHandle, url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("Cannot open an empty URL".to_string());
    }
    let scheme = trimmed
        .split_once(':')
        .map(|(s, _)| s.to_ascii_lowercase());
    if !matches!(scheme.as_deref(), Some("http") | Some("https")) {
        return Err(format!(
            "Refusing to open URL with disallowed scheme: {}",
            trimmed
        ));
    }
    app.opener()
        .open_url(trimmed, None::<&str>)
        .map_err(|e| format!("Failed to open URL: {}", e))
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Map a frontend platform filter to the platform strings we attach
/// to each GamePass card. The Microsoft catalog doesn't expose a
/// per-product platform list on the public surface, so we infer
/// from the user-selected filter to keep the UI accurate.
fn platforms_for(filter: Option<&str>) -> Vec<String> {
    match filter.unwrap_or("all") {
        "xbox" => vec!["Xbox".to_string()],
        "pc" => vec!["PC".to_string()],
        "cloud" => vec!["Cloud".to_string()],
        _ => vec!["Xbox".to_string(), "PC".to_string(), "Cloud".to_string()],
    }
}

/// Map a market code (e.g. "US", "UK") to a best-guess locale
/// string (e.g. "en-US", "en-GB"). Falls back to `en-US`.
fn locale_for_market(market: &str) -> String {
    match market.to_ascii_uppercase().as_str() {
        "US" => "en-US",
        "UK" | "GB" => "en-GB",
        "CA" => "en-CA",
        "AU" | "NZ" => "en-AU",
        "DE" | "AT" | "CH" => "de-DE",
        "FR" | "BE" | "LU" => "fr-FR",
        "JP" => "ja-JP",
        "BR" => "pt-BR",
        "MX" => "es-MX",
        "ES" => "es-ES",
        "IT" => "it-IT",
        _ => "en-US",
    }
    .to_string()
}

/// Split a combined developer / publisher string ("Studio A and Studio
/// B") and return the first entry. The Microsoft catalog often
/// concatenates multiple companies with ` and `, `,`, `/`, `+`, or
/// `&` — we only want the first one for the card display.
fn split_first(raw: &Option<String>) -> Option<String> {
    let s = raw.as_deref()?.trim();
    if s.is_empty() {
        return None;
    }
    // Try common delimiters in order; pick the first chunk.
    for delim in [" and ", " / ", " + ", " & ", ","] {
        if let Some(idx) = s.find(delim) {
            let head = s[..idx].trim();
            if !head.is_empty() {
                return Some(head.to_string());
            }
        }
    }
    Some(s.to_string())
}

/// Slugify a product title for use in the Xbox store web URL. The
/// store's URL format is `https://www.xbox.com/en-US/games/store/{slug}/{productId}`
/// and the slug must be ASCII-only (the server 404s on paths that
/// contain spaces or non-ASCII letters).
///
/// Examples:
///   "1000xRESIST"                       -> "1000xresist"
///   "33 Immortals"                      -> "33-immortals"
///   "A Game About Digging A Hole"       -> "a-game-about-digging-a-hole"
fn slugify(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

/// Map a user-facing category chip to the actual category strings
/// the Microsoft catalog ships. The catalog uses verbose names like
/// "Role playing" (not "RPG") and splits "Sports & racing" into
/// separate "Sports" and "Racing & flying" buckets — neither of
/// which match the familiar short names users expect in the UI.
/// This map keeps the chip labels user-friendly while still
/// matching the real catalog strings.
///
/// Chips not listed here pass through unchanged and are matched
/// via prefix against the catalog (so e.g. "Music" still hits
/// "Music" exactly, and any future verbose variant like "Music &
/// audio" would also match via prefix).
///
/// Source: a live sample of 200 catalog entries (US, en-US). If
/// Microsoft renames a category, update this map.
fn category_aliases(chip: &str) -> Vec<String> {
    match chip {
        "RPG" => vec!["Role playing".to_string()],
        "Sports & racing" => vec![
            "Sports".to_string(),
            "Racing & flying".to_string(),
        ],
        _ => vec![chip.to_string()],
    }
}

// ─── ITAD JSON → DealItem mapping ───────────────────────────────────────────

// No helper needed here — we use chained `Map::get` lookups (which
// return `Option<&Value>`) throughout `itad_deal_to_item`. `Map`
// doesn't expose a `pointer` method directly, but since the ITAD
// schema is shallow, `get().get()` is just as clear.

/// Normalize `Properties.Categories` to a flat list of category
/// names. The v7.0 catalog has shipped three shapes — an array of
/// plain strings (current, e.g. `["Action & adventure"]`), an
/// array of `{ "name": "..." }` objects (older), and a
/// comma-separated string (rare). We accept all three; anything
/// else yields an empty list rather than panicking.
fn extract_categories(props: Option<&DisplayProperties>) -> Vec<String> {
    let Some(props) = props else {
        return Vec::new();
    };
    let Some(value) = props.categories.as_ref() else {
        return Vec::new();
    };
    match value {
        // Array of plain strings (current v7.0 shape).
        serde_json::Value::Array(arr) => arr
            .iter()
            .filter_map(|v| match v {
                // Plain string in the array.
                serde_json::Value::String(s) => Some(s.clone()),
                // Object with a name field (older shape, e.g. {"name": "Action"}).
                serde_json::Value::Object(obj) => {
                    obj.get("name").and_then(|n| n.as_str()).map(String::from)
                }
                _ => None,
            })
            .collect(),
        // Comma-separated string (rare fallback).
        serde_json::Value::String(s) => s
            .split(',')
            .map(|c| c.trim().to_string())
            .filter(|c| !c.is_empty())
            .collect(),
        _ => Vec::new(),
    }
}
// return `Option<&Value>`) throughout `itad_deal_to_item`. `Map`
// doesn't expose a `pointer` method directly, but since the ITAD
// schema is shallow, `get().get()` is just as clear.

/// Convert a single ITAD `deals/v2` row into our `DealItem` shape.
/// Returns `None` if the row is missing the fields we need to
/// render a usable card.
fn itad_deal_to_item(v: &serde_json::Value) -> Option<DealItem> {
    let obj = v.as_object()?;

    // Title — `title` (top-level in deals/v2).
    let game_title = obj
        .get("title")
        .or_else(|| obj.get("name"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?
        .to_string();

    // Shop / store — nested under `deal.shop.name`.
    let shop = obj.get("deal").and_then(|d| d.get("shop"));
    let store_name = shop
        .and_then(|s| s.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown Store")
        .to_string();

    // URLs — `urls.buy` is the direct store link. Fall back to
    // the ITAD deal page if missing.
    let store_url = obj
        .get("urls")
        .and_then(|u| u.get("buy"))
        .or_else(|| obj.get("urls").and_then(|u| u.get("game")))
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| {
            obj.get("slug")
                .and_then(|v| v.as_str())
                .map(|slug| format!("https://isthereanydeal.com/game/{}/", slug))
                .unwrap_or_default()
        });

    // Prices — nested under `deal.price.amount` and
    // `deal.regular.amount` (both numbers, USD).
    let deal = obj.get("deal");
    let deal_price = deal
        .and_then(|d| d.get("price"))
        .and_then(|p| p.get("amount"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let normal_price = deal
        .and_then(|d| d.get("regular"))
        .and_then(|p| p.get("amount"))
        .and_then(|v| v.as_f64())
        .unwrap_or(deal_price);

    let discount_percent = deal
        .and_then(|d| d.get("cut"))
        .and_then(|v| v.as_i64())
        .map(|v| v as i32)
        .unwrap_or_else(|| {
            if normal_price > 0.0 && deal_price > 0.0 && normal_price > deal_price {
                (((normal_price - deal_price) / normal_price) * 100.0).round() as i32
            } else {
                0
            }
        });

    // A deal with 0% discount isn't worth showing as a deal.
    if discount_percent <= 0 {
        return None;
    }

    // Platforms — `deal.platforms` is an array of strings like
    // ["windows", "mac"]. We collapse to the first one for display.
    let platform = deal
        .and_then(|d| d.get("platforms"))
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|v| v.as_str())
        .map(|s| match s {
            "windows" => "Windows".to_string(),
            "mac" => "Mac".to_string(),
            "linux" => "Linux".to_string(),
            other => other.to_string(),
        })
        .unwrap_or_else(|| "Windows".to_string());

    // Expiration — `deal.expiry` is an ISO 8601 string.
    let expiration = deal
        .and_then(|d| d.get("expiry"))
        .and_then(|v| v.as_str())
        .map(str::to_string);

    // Thumbnail — deals/v2 doesn't return one. The frontend has a
    // fallback icon for missing thumbnails.
    let thumbnail = None;

    // ID — `id` is the deal id (composite of game + shop).
    let id = obj
        .get("id")
        .or_else(|| obj.get("slug"))
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| format!("{}::{}", game_title, store_name));

    Some(DealItem {
        id,
        game_title,
        store_name,
        store_url,
        normal_price,
        deal_price,
        discount_percent,
        expiration,
        platform,
        thumbnail,
    })
}
