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
//! ITAD's homepage at <https://isthereanydeal.com/> is server-rendered
//! (Svelte SSR), so we can scrape the deal cards directly with
//! `reqwest` + `scraper` — no API key required.
//!
//! Each deal card on the page is an `<a class="deal ..." href="https://itad.link/UUID/">`
//! block. The game title is a sibling `<a class="title ..." href="/game/{slug}/info/">`
//! in the same wrapper. Inside the deal card:
//!   - `<span class="cut">-90%</span>` for the discount percent
//!   - `<span class="price">1,59</span>` for the current price (EU format, EUR)
//!   - `<div class="shop">Steam</div>` for the store display name
//!
//! The `itad.link` URL is a tracking redirect; we follow it in
//! parallel (HEAD, 5 s timeout, 8 concurrent) to resolve the direct
//! store URL (Steam, Epic, etc.). On failure we fall back to the
//! itad.link URL.

use futures::stream::{self, StreamExt};
use scraper::{ElementRef, Html, Selector};
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

/// A single IsThereAnyDeal row scraped from the homepage.
///
/// `deal_price` is the current price in EUR. The original price is
/// not present in the homepage scrape, so we don't expose it.
/// `thumbnail` and `expiration` are likewise unavailable from the
/// homepage; the frontend uses a fallback icon for the former and
/// hides the "ends in" badge when the latter is `None`.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DealItem {
    /// Composite deal id (the ITAD link UUID).
    pub id: String,
    /// Game title.
    pub game_title: String,
    /// Store display name (e.g. "Steam", "Epic Game Store").
    pub store_name: String,
    /// Direct store URL (resolved from the itad.link redirect).
    pub store_url: String,
    /// Current price in EUR.
    pub deal_price: f64,
    /// Discount percent (0-100).
    pub discount_percent: i32,
    /// ISO 8601 expiration timestamp (always `None` from the homepage).
    pub expiration: Option<String>,
    /// Platform name (always "Windows" — the homepage doesn't expose it).
    pub platform: String,
    /// Square thumbnail (always `None` — the homepage has no images).
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
///
/// `platform` is kept for API compatibility with the frontend but is
/// ignored — the ITAD homepage doesn't expose per-deal platform
/// information, so we can't filter on it. Use `store` for
/// storefront-specific filtering.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct DealsFilters {
    pub platform: Option<String>,
    pub min_discount: Option<i32>,
    pub store: Option<String>,
}

/// A single free game from the ITAD giveaways list.
///
/// ITAD's `/giveaways/` page is powered by a JSON API
/// (`/giveaways/api/list/?tab=live`). Each entry in the response is
/// a "giveaway" that bundles one or more free games behind a single
/// claim URL (e.g. "The Life and Suffering of Sir Brante free on
/// Steam"). We flatten every entry's `games` array into one
/// `Giveaway` per individual game so the frontend can show a card
/// per title, with the parent giveaway's title kept for context.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Giveaway {
    /// Composite id (`"{giveawayId}-{gameId}"`) — unique per card.
    pub id: String,
    /// Individual game title (e.g. "The Life and Suffering of Sir Brante").
    pub title: String,
    /// Parent giveaway title (e.g. "...free on Steam") for context.
    pub bundle_title: String,
    /// Storefront display name derived from the claim URL host
    /// (e.g. "Steam", "Humble Bundle", "Epic Game Store").
    pub store_name: String,
    /// Box-art / cover image URL. `None` when ITAD doesn't expose
    /// one — the frontend shows a fallback icon.
    pub image_url: Option<String>,
    /// Direct claim URL (the giveaway's `url`, already the real
    /// store/claim page — no affiliate redirect to resolve).
    pub deal_url: String,
    /// 18+ flag.
    pub is_mature: bool,
    /// ISO 8601 expiration timestamp. `None` when no expiry is set.
    pub expiry: Option<String>,
}

// ─── Shared HTTP helpers ────────────────────────────────────────────────────

/// Build a shared HTTP client that mimics a real browser. Without
/// browser-like headers, both Microsoft and ITAD will block us.
/// The cookie store is enabled so the giveaways API can reuse the
/// `sess2` session cookie set by the `/giveaways/` page.
fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        .timeout(Duration::from_secs(30))
        .cookie_store(true)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
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

/// Fetch current deals from IsThereAnyDeal by scraping the homepage
/// HTML directly. No API key required.
///
/// Implementation:
///   1. GET `https://isthereanydeal.com/` (server-rendered Svelte).
///   2. Parse the deal cards (`a.deal`) with the `scraper` crate.
///   3. Apply the user's `min_discount` and `store` filters.
///   4. Follow each `itad.link` redirect in parallel (HEAD, 5 s
///      timeout, 8 concurrent) to get the direct store URL.
///
/// On any network or parse failure we return a string error so the
/// frontend can display a message. Empty results are not errors.
#[tauri::command]
pub async fn fetch_isthereanydeal_deals(
    filters: DealsFilters,
) -> Result<Vec<DealItem>, String> {
    let client = http_client()?;

    // Step 1: fetch the homepage.
    let html = fetch_itad_homepage(&client).await?;

    // Step 2: parse the deal cards out of the HTML.
    let mut deals = parse_itad_deals(&html)?;

    // Step 3: apply user filters BEFORE resolving redirects so we
    // don't waste HTTP round-trips on deals we're going to drop.
    let min_discount = filters.min_discount.unwrap_or(0);
    let want_store = filters
        .store
        .as_deref()
        .unwrap_or("all")
        .trim()
        .to_ascii_lowercase();
    deals.retain(|d| d.discount_percent >= min_discount);
    if !want_store.is_empty() && want_store != "all" {
        deals.retain(|d| d.store_name.to_ascii_lowercase().contains(&want_store));
    }
    // `filters.platform` is intentionally ignored — see `DealsFilters`.

    // Sort highest discount first (matches the previous behavior).
    deals.sort_by(|a, b| b.discount_percent.cmp(&a.discount_percent));

    // Step 4: resolve `itad.link` redirects in parallel.
    resolve_redirects(&client, &mut deals).await;

    Ok(deals)
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

// ─── ITAD scraper ───────────────────────────────────────────────────────────

/// ITAD homepage URL. Server-rendered (Svelte SSR) so a plain GET
/// returns all the deal cards in the HTML — no JavaScript execution
/// required.
const ITAD_HOMEPAGE: &str = "https://isthereanydeal.com/";

/// Maximum number of concurrent `itad.link` redirect resolutions.
/// 8 strikes a balance between wall-clock latency and not hammering
/// the ITAD redirector (which ultimately points at Steam / Epic /
/// GOG / etc., so we want to be polite).
const REDIRECT_CONCURRENCY: usize = 8;

/// Per-request timeout for resolving a single `itad.link` redirect.
/// Short enough that a slow upstream doesn't stall the whole fetch.
const REDIRECT_TIMEOUT_SECS: u64 = 5;

/// Fetch the raw HTML of the ITAD homepage.
async fn fetch_itad_homepage(client: &reqwest::Client) -> Result<String, String> {
    let resp = client
        .get(ITAD_HOMEPAGE)
        .send()
        .await
        .map_err(|e| format!("ITAD request failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("ITAD returned status {}", resp.status()));
    }
    resp.text()
        .await
        .map_err(|e| format!("ITAD body read failed: {}", e))
}

/// Parse the ITAD homepage HTML into a list of `DealItem`s.
///
/// Selectors are anchored on the stable class names ITAD uses
/// (Svelte adds a scope hash like `svelte-1lrr027`, but the base
/// `deal`, `title`, `cut`, `price`, `shop` class names are part of
/// the component contract and survive every rebuild).
///
/// Returns an empty Vec when the page is empty or the structure
/// changes; the caller treats that as "no current deals" rather
/// than an error. A genuine parse error (e.g. malformed HTML) is
/// caught by the scraper crate and yields an empty Vec — ITAD
/// redesigns would show up as "no deals" rather than a hard crash.
fn parse_itad_deals(html: &str) -> Result<Vec<DealItem>, String> {
    // The function body is wrapped in an inner block so we can
    // short-circuit on the "0 deals parsed" case and emit a
    // diagnostic log without duplicating the empty-return
    // statement. The scraper crate never returns an `Err` for a
    // missing selector match — it just yields an empty iterator
    // — so the only way to detect an ITAD redesign from here is
    // to count what we actually found.
    let document = Html::parse_document(html);
    let deal_sel = Selector::parse("a.deal").map_err(|e| format!("bad selector a.deal: {:?}", e))?;
    let title_sel = Selector::parse("a.title").map_err(|e| format!("bad selector a.title: {:?}", e))?;
    let cut_sel = Selector::parse("span.cut").map_err(|e| format!("bad selector span.cut: {:?}", e))?;
    let price_sel = Selector::parse("span.price").map_err(|e| format!("bad selector span.price: {:?}", e))?;
    let shop_sel = Selector::parse("div.shop").map_err(|e| format!("bad selector div.shop: {:?}", e))?;

    let mut deals = Vec::new();
    // We track whether we ever saw an `a.deal` element at all
    // so we can distinguish "ITAD has no current deals" (legit
    // empty) from "our scraper broke because ITAD redesigned"
    // (silent regression). The frontend treats both as "no
    // deals", but the latter is debuggable from stderr.
    let mut raw_deal_count = 0usize;
    for deal_a in document.select(&deal_sel) {
        raw_deal_count += 1;
        // Game title — sibling `a.title` inside the same parent.
        // HTML forbids `<a>` inside `<a>`, so the title MUST be
        // outside the deal `<a>`; the parent is a wrapper `<div>`
        // containing both. `ElementRef::parent()` returns a
        // `NodeRef<Node>` (from the `ego_tree` crate), and the
        // `select` method only exists on `ElementRef` — so we
        // wrap the node first. `ElementRef::wrap` yields `None`
        // if the parent happens to be a non-element node (text,
        // comment, etc.), which is the correct signal to skip
        // this card.
        let game_title = deal_a
            .parent()
            .and_then(ElementRef::wrap)
            .and_then(|p| p.select(&title_sel).next())
            .map(|t| t.text().collect::<String>())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let game_title = match game_title {
            Some(t) => t,
            None => continue,
        };

        // Discount % — `<span class="cut">-90%</span>`.
        let discount_percent: i32 = deal_a
            .select(&cut_sel)
            .next()
            .and_then(|e| {
                let s: String = e.text().collect();
                parse_discount_percent(&s)
            })
            .unwrap_or(0);
        if discount_percent <= 0 {
            // A 0% deal isn't really a deal — skip it.
            continue;
        }

        // Current price — `<span class="price">1,59</span>` (EU
        // number format with a comma decimal separator).
        let deal_price: f64 = deal_a
            .select(&price_sel)
            .next()
            .and_then(|e| {
                let s: String = e.text().collect();
                parse_price_eur(&s)
            })
            .unwrap_or(0.0);

        // Store name — `<div class="shop"><span>Steam</span></div>`.
        // We read the whole text content of the wrapper so we get
        // just the store name (the wrapper also contains an inline
        // color swatch `<span class="mark">` with no text).
        let store_name: String = deal_a
            .select(&shop_sel)
            .next()
            .map(|e| e.text().collect::<String>())
            .map(|s| s.trim().to_string())
            .filter(|s: &String| !s.is_empty())
            .unwrap_or_else(|| "Unknown Store".to_string());

        // Deal URL and id — pulled from the `href` of the deal `<a>`.
        let raw_url = deal_a
            .value()
            .attr("href")
            .unwrap_or("")
            .trim()
            .to_string();
        if raw_url.is_empty() {
            continue;
        }
        // The id is the trailing UUID in the itad.link URL.
        let id = raw_url
            .rsplit('/')
            .find(|s| !s.is_empty())
            .unwrap_or(&raw_url)
            .to_string();

        deals.push(DealItem {
            id,
            game_title,
            store_name,
            store_url: raw_url,
            deal_price,
            discount_percent,
            expiration: None,
            // ITAD's homepage doesn't expose a per-deal platform
            // list. All deals are Windows PC unless the user
            // follows the link and inspects the destination store.
            platform: "Windows".to_string(),
            thumbnail: None,
        });
    }
    // Sanity check: if we saw deal `<a>` elements but parsed zero
    // of them into a DealItem, the page structure has almost
    // certainly changed (every deal was dropped by one of the
    // `continue` guards above). Log enough of the page to make
    // the next redesign debuggable from stderr.
    if raw_deal_count > 0 && deals.is_empty() {
        let snippet: String = html
            .chars()
            .filter(|c| !c.is_control())
            .take(800)
            .collect();
        eprintln!(
            "[deals] Saw {} deal <a> elements but parsed 0 — ITAD page structure may have changed. First 800 chars: {}",
            raw_deal_count, snippet
        );
    }
    Ok(deals)
}

/// Parse an ITAD discount string like `"-90%"` or `"-51 %"` into
/// an integer percent. Returns `None` for any input that doesn't
/// contain at least one digit — the caller treats that as "no
/// discount" and drops the deal.
fn parse_discount_percent(raw: &str) -> Option<i32> {
    let digits: String = raw
        .chars()
        .filter(|c| c.is_ascii_digit())
        .collect();
    if digits.is_empty() {
        None
    } else {
        digits.parse().ok()
    }
}

/// Parse an ITAD price string into an `f64`. Accepts both EU format
/// (`"1,59"`, comma decimal) and US format (`"1.59"`, dot decimal) —
/// the first separator wins. Strips currency glyphs, whitespace,
/// and any other non-numeric noise. Returns `None` if no digits
/// are present.
///
/// ITAD's homepage ships EU-format prices like `"1,59"` and
/// `"0,00"`; the US-format tolerance is a safety net for any
/// future ITAD locale change.
fn parse_price_eur(raw: &str) -> Option<f64> {
    // Keep only digits, one decimal point, and a leading minus.
    let mut cleaned = String::with_capacity(raw.len());
    let mut seen_dot = false;
    for c in raw.chars() {
        if c.is_ascii_digit() {
            cleaned.push(c);
        } else if (c == ',' || c == '.') && !seen_dot {
            // Treat the FIRST separator as the decimal point,
            // whether it's a comma (EU) or a dot (US). This makes
            // the parser tolerant of ITAD formatting changes.
            cleaned.push('.');
            seen_dot = true;
        } else if c == '-' && cleaned.is_empty() {
            cleaned.push('-');
        }
    }
    cleaned.parse().ok()
}

/// Follow each `itad.link` URL in `deals` and replace it with the
/// final store URL (the redirect target). Runs up to
/// `REDIRECT_CONCURRENCY` requests in parallel. Failures fall back
/// to the original `itad.link` URL and log a warning.
async fn resolve_redirects(client: &reqwest::Client, deals: &mut [DealItem]) {
    // Snapshot the indices and URLs we need to resolve so the
    // borrow checker is happy (we mutate `deals` at the end).
    let tasks: Vec<(usize, String)> = deals
        .iter()
        .enumerate()
        .map(|(i, d)| (i, d.store_url.clone()))
        .collect();

    let resolved: Vec<(usize, String)> = stream::iter(tasks)
        .map(|(i, url)| async move {
            let final_url = resolve_single_redirect(client, &url).await;
            (i, final_url)
        })
        .buffer_unordered(REDIRECT_CONCURRENCY)
        .collect()
        .await;

    for (i, final_url) in resolved {
        if !final_url.is_empty() {
            deals[i].store_url = final_url;
        }
    }
}

/// Follow the redirect for a single URL. Returns the final URL
/// (post-redirect) on success; returns the original URL on any
/// failure (timeout, non-2xx, network error).
///
/// We try HEAD first (cheaper — no body download). Some redirect
/// servers return 405 for HEAD, in which case we fall back to a
/// GET and ignore the body. This is the only practical way to
/// resolve a tracking redirect without downloading the target
/// page's full HTML.
///
/// Unlike the previous version, this does NOT short-circuit on
/// `itad.link/` — it transparently follows redirects for any
/// URL (itad.link, humblebundleinc.sjv.io, awin1.com, etc.). For
/// URLs that don't redirect, reqwest returns the same URL back
/// from `response.url()`, so the call is always safe to make.
async fn resolve_single_redirect(client: &reqwest::Client, url: &str) -> String {
    // Attempt 1: HEAD. Cheap, no body. ITAD's link shortener
    // sometimes rejects HEAD with 405 — in that case reqwest
    // surfaces an error and we move to the GET fallback.
    let head_result = client
        .head(url)
        .timeout(Duration::from_secs(REDIRECT_TIMEOUT_SECS))
        .send()
        .await;
    if let Ok(resp) = head_result {
        if resp.status().is_success() || resp.status().is_redirection() {
            return resp.url().as_str().to_string();
        }
    }
    // Attempt 2: GET fallback. Downloads the body but we discard
    // it — reqwest follows redirects by default, so `resp.url()`
    // already reflects the final destination. The body is closed
    // when `resp` drops at the end of this block.
    let get_result = client
        .get(url)
        .timeout(Duration::from_secs(REDIRECT_TIMEOUT_SECS))
        .send()
        .await;
    match get_result {
        Ok(resp) => resp.url().as_str().to_string(),
        Err(e) => {
            eprintln!("[deals] Failed to resolve {}: {}", url, e);
            url.to_string()
        }
    }
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

// ─── Giveaways (free games) ───────────────────────────────────────────

/// ITAD's giveaways are served by a JSON endpoint behind the
/// `/giveaways/` page. We first GET the page to obtain a session
/// cookie (`sess2`) and the anonymous `g.user.token`, then POST to
/// the list API. The API session cookie is captured automatically
/// by the shared client's cookie store.
const GIVEAWAYS_PAGE_URL: &str = "https://isthereanydeal.com/giveaways/";

/// The list endpoint used by ITAD's own giveaways page. Mirrors the
/// request the Lacro59 playnite-isthereanydeal-plugin makes.
const GIVEAWAYS_API_URL: &str =
    "https://isthereanydeal.com/giveaways/api/list/?tab=live";

/// Body sent to the list endpoint. `offset` pages results; `sort`
/// and `filter` are `null` for the default (newest) live view.
const GIVEAWAYS_API_BODY: &str = r#"{"offset":0,"sort":null,"filter":null}"#;

/// How many pages of results to pull. Each page returns up to ~20
/// giveaways; 3 pages comfortably covers everything currently live.
const GIVEAWAYS_MAX_PAGES: u32 = 3;

/// Fetch the current free games from ITAD.
///
/// Algorithm:
///   1. GET `/giveaways/` to seed the `sess2` cookie + grab the
///      anonymous `g.user.token`.
///   2. POST `/giveaways/api/list/?tab=live` (with the token header
///      and the captured cookie) — paginating until `done`.
///   3. Flatten every giveaway's `games` array into one `Giveaway`
///      per individual game (the user wants the actual games, not
///      the parent bundle).
///   4. Drop entries that have already expired.
///   5. Sort by expiry ascending (soonest-to-expire first).
///
/// On any network or parse failure we return a string error so the
/// frontend can show a message. One malformed giveaway is logged
/// and skipped — it doesn't fail the whole request.
#[tauri::command]
pub async fn fetch_giveaways() -> Result<Vec<Giveaway>, String> {
    let client = http_client()?;

    // Step 1 — seed the session cookie and read the anonymous token.
    let page_resp = client
        .get(GIVEAWAYS_PAGE_URL)
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("Giveaways page request failed: {}", e))?;
    let page_html = page_resp
        .text()
        .await
        .map_err(|e| format!("Giveaways page body read failed: {}", e))?;
    let token = extract_session_token(&page_html);

    // Step 2 — paginate the list API.
    let mut all_giveaways: Vec<Giveaway> = Vec::new();
    let mut offset: u32 = 0;
    for _ in 0..GIVEAWAYS_MAX_PAGES {
        let mut api_req = client
            .post(GIVEAWAYS_API_URL)
            .timeout(Duration::from_secs(15))
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .body(GIVEAWAYS_API_BODY.replace("\"offset\":0", &format!("\"offset\":{}", offset)));
        if let Some(t) = &token {
            api_req = api_req.header("ITAD-SessionToken", t.clone());
        }
        let resp = api_req
            .send()
            .await
            .map_err(|e| format!("Giveaways API request failed: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("Giveaways API returned status {}", resp.status()));
        }
        let payload: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Giveaways API JSON parse failed: {}", e))?;

        let data = payload
            .get("data")
            .and_then(|v| v.as_array())
            .ok_or_else(|| "No 'data' array in giveaways API response".to_string())?;

        for datum in data {
            match parse_giveaway_datum(datum) {
                Ok(mut games) => all_giveaways.append(&mut games),
                Err(e) => eprintln!("[deals] Skipping giveaway: {}", e),
            }
        }

        let done = payload.get("done").and_then(|v| v.as_bool()).unwrap_or(true);
        if done {
            break;
        }
        offset += data.len() as u32;
    }

    // Step 3 — drop expired entries. `expiry == None` is treated as
    // "no expiry set, keep it". A parse failure fails closed (drop).
    let now = chrono::Utc::now().timestamp();
    all_giveaways.retain(|g| {
        g.expiry
            .as_deref()
            .map(|iso| {
                chrono::DateTime::parse_from_rfc3339(iso)
                    .map(|dt| dt.timestamp() > now)
                    .unwrap_or(false)
            })
            .unwrap_or(true)
    });

    // Step 4 — soonest-expiring first.
    all_giveaways.sort_by(|a, b| a.expiry.cmp(&b.expiry));

    Ok(all_giveaways)
}

/// Extract the anonymous session token from the `/giveaways/` page's
/// inline `var g = {...}` config. The token lives at `g.user.token`
/// and is sent as the `ITAD-SessionToken` header on the API call.
fn extract_session_token(html: &str) -> Option<String> {
    let start = html.find("var g = ")?;
    let after = start + "var g = ".len();
    // The object ends at the first `;` that closes the statement.
    let end = html[after..].find(';')? + after;
    let obj: serde_json::Value = serde_json::from_str(&html[after..end]).ok()?;
    obj.get("user")
        .and_then(|u| u.get("token"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
}

/// Parse one giveaway datum from the list API into one `Giveaway`
/// per individual game inside its `games` array. The parent
/// giveaway's `title` is kept as `bundle_title` for context, and
/// its `url` is the claim link for every game it contains.
fn parse_giveaway_datum(datum: &serde_json::Value) -> Result<Vec<Giveaway>, String> {
    let giveaway_id = datum
        .get("id")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| "giveaway missing id".to_string())?;
    let bundle_title = datum
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let deal_url = datum
        .get("url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let is_mature = datum
        .get("isMature")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let expiry = ts_to_iso(datum.get("expiry").and_then(|v| v.as_i64()));
    let store_name = store_name_from_url(&deal_url);

    let games = datum
        .get("games")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "giveaway missing games array".to_string())?;

    let mut result = Vec::new();
    for g in games {
        let game_id = g
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let title = g
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if title.is_empty() {
            continue;
        }
        let image_url = g
            .get("assets")
            .and_then(|a| a.get("boxart"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        result.push(Giveaway {
            id: format!("{}-{}", giveaway_id, game_id),
            title,
            bundle_title: bundle_title.clone(),
            store_name: store_name.clone(),
            image_url,
            deal_url: deal_url.clone(),
            is_mature,
            expiry: expiry.clone(),
        });
    }

    if result.is_empty() {
        return Err("giveaway had no usable games".to_string());
    }
    Ok(result)
}

/// Derive a friendly storefront name from a claim URL's host.
fn store_name_from_url(url: &str) -> String {
    let host = url
        .split("://")
        .nth(1)
        .map(|s| s.split('/').next().unwrap_or(""))
        .unwrap_or("")
        .to_lowercase();
    if host.contains("steampowered") || host.contains("steamcommunity") {
        "Steam".to_string()
    } else if host.contains("gog.com") {
        "GOG".to_string()
    } else if host.contains("epicgames") {
        "Epic Games".to_string()
    } else if host.contains("humble") {
        "Humble Bundle".to_string()
    } else if host.contains("fanatical") {
        "Fanatical".to_string()
    } else if host.contains("itch.io") {
        "itch.io".to_string()
    } else if host.contains("ubisoft") {
        "Ubisoft".to_string()
    } else if host.contains("ea.com") {
        "EA App".to_string()
    } else if host.contains("microsoft") || host.contains("xbox") {
        "Microsoft Store".to_string()
    } else if host.is_empty() {
        "Unknown Store".to_string()
    } else {
        // Title-case the bare host (drop the TLD) as a fallback.
        let bare = host
            .split('.')
            .nth_back(1)
            .unwrap_or(&host)
            .to_string();
        let mut c = bare.chars();
        match c.next() {
            Some(first) => first.to_uppercase().collect::<String>() + c.as_str(),
            None => bare,
        }
    }
}

/// Convert a Unix timestamp (seconds) to an ISO 8601 string.
/// Returns `None` for 0 or invalid timestamps.
fn ts_to_iso(ts: Option<i64>) -> Option<String> {
    let ts = ts?;
    if ts <= 0 {
        return None;
    }
    chrono::DateTime::from_timestamp(ts, 0).map(|dt| dt.to_rfc3339())
}
