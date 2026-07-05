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

/// A single free-game giveaway (one game inside a bundle).
///
/// ITAD's /giveaways/ page lists bundles (e.g. "Summer Games Done
/// Quick 2026 Bundle" from Humble Bundle). Each bundle contains N
/// individual games. We fetch each bundle's detail page in
/// parallel to extract the per-game data, then flatten to one
/// `Giveaway` per game so the frontend can show a card per title.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Giveaway {
    /// Composite id (`"{bundleId}-{gameId}"`) — unique per card.
    pub id: String,
    /// Individual game title.
    pub title: String,
    /// Parent bundle title (for context, e.g. "Humble Summer Bundle").
    pub bundle_title: String,
    /// Cover image URL (CDN-served, may be relative — we normalize).
    pub image_url: Option<String>,
    /// Storefront display name (e.g. "Humble Bundle", "Fanatical").
    pub store_name: String,
    /// Direct claim URL — the per-game URL when present, otherwise
    /// the parent bundle's URL.
    pub deal_url: String,
    /// 18+ flag inherited from the parent bundle.
    pub is_mature: bool,
    /// ISO 8601 expiration timestamp (the bundle's expiry; games
    /// inside share the bundle's expiry).
    pub expiry: Option<String>,
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

/// Follow each `giveaway.deal_url` in parallel and replace it
/// with the final post-redirect URL. This is the giveaway-side
/// equivalent of `resolve_redirects` (which is used for the
/// homepage deals). Tracking redirects like
/// `humblebundleinc.sjv.io` get resolved to the actual store
/// URL so the "Get it free" button lands directly on the claim
/// page rather than the affiliate/redirect page. Up to
/// `REDIRECT_CONCURRENCY` requests run in parallel.
async fn resolve_giveaway_redirects(client: &reqwest::Client, giveaways: &mut [Giveaway]) {
    // Snapshot indices and URLs to resolve. We mutate the
    // `deal_url` field in place at the end, so the borrow
    // checker wants us to detach the URLs from the slice
    // first.
    let tasks: Vec<(usize, String)> = giveaways
        .iter()
        .enumerate()
        .filter(|(_, g)| !g.deal_url.is_empty())
        .map(|(i, g)| (i, g.deal_url.clone()))
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
        if !final_url.is_empty() && final_url != giveaways[i].deal_url {
            giveaways[i].deal_url = final_url;
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

// ─── Giveaways scraper ────────────────────────────────────────────────

/// ITAD giveaways list page. Server-rendered HTML, but the actual
/// bundle list is embedded as a `var page = [...]` script block
/// (SvelteKit's page-state pattern). We parse the script instead
/// of the DOM because the data is JSON-ish and the DOM is just a
/// hydration shell.
const GIVEAWAYS_LIST_URL: &str = "https://isthereanydeal.com/giveaways/";

/// ITAD homepage — the only place where the individual free-game
/// giveaways (e.g. "Nexus: The Jupiter Incident" from itch.io) are
/// server-rendered. The /giveaways/ page itself loads those
/// client-side, so we pull the list of links from the homepage and
/// fetch each detail page individually.
const HOMEPAGE_URL: &str = "https://isthereanydeal.com/";

/// Per-bundle detail page (e.g. `/giveaways/16359/`). Same pattern
/// as the list page, but with per-game data including images.
const GIVEAWAYS_DETAIL_URL_PREFIX: &str = "https://isthereanydeal.com/giveaways/";

/// Number of bundle detail pages to fetch in parallel. 8 is
/// polite and fast — 15 bundles at 8-way concurrency = ~2 batches.
const GIVEAWAYS_DETAIL_CONCURRENCY: usize = 8;

/// Timeout for the giveaways list page and the homepage. Slightly
/// more generous than per-detail because they're single points of
/// failure.
const GIVEAWAYS_LIST_TIMEOUT_SECS: u64 = 10;

/// Per-bundle detail page timeout.
const GIVEAWAYS_DETAIL_TIMEOUT_SECS: u64 = 5;

/// Fetch the current giveaways from ITAD.
///
/// Algorithm:
///   1. GET the list page and extract bundle metadata from the
///      embedded `var page = [...]` JSON.
///   2. For each bundle, GET its detail page in parallel and
///      extract per-game data (title, image, claim URL).
///   3. Flatten to a single `Vec<Giveaway>` (one entry per game).
///   4. Drop entries that have already expired.
///   5. Sort by expiry ascending (most-soon-to-expire first).
///
/// On any network or parse failure we return a string error so
/// the frontend can display a message. Individual bundle fetch
/// failures are logged and skipped — one bad bundle doesn't
/// fail the whole request.
#[tauri::command]
pub async fn fetch_giveaways() -> Result<Vec<Giveaway>, String> {
    let client = http_client()?;

    // ---- Bundles: from the /giveaways/ list page ----
    // Server-rendered SvelteKit page with the bundle list embedded
    // in a `var page = [...]` script block. Each bundle may
    // contain multiple games.
    let list_html = fetch_giveaways_list(&client).await?;
    let bundles = parse_giveaways_list(&list_html)?;
    let bundle_ids: std::collections::HashSet<u64> =
        bundles.iter().map(|b| b.id).collect();

    // ---- Individual giveaways: from the homepage ----
    // The /giveaways/ page's "Giveaways" section (individual free
    // games from stores like itch.io) is loaded client-side and
    // never appears in the static HTML. The homepage's "Giveaways"
    // section IS server-rendered and contains direct links to
    // each giveaway's detail page. We extract those links, filter
    // out any that are already bundles, and fetch the rest.
    let individual_ids = fetch_individual_giveaway_ids(&client).await?;
    let new_individual_ids: Vec<u64> = individual_ids
        .into_iter()
        .filter(|id| !bundle_ids.contains(id))
        .collect();

    // ---- Fetch all detail pages in parallel ----
    // We process bundles and individual giveaways in two separate
    // `stream::iter` + `buffer_unordered` passes because the two
    // async-block types are distinct (Rust gives every `async {}`
    // block a unique anonymous type, so we can't collect them
    // into a single `Vec` without a `Pin<Box<dyn Future>>`
    // shim). Two passes is simpler and just as fast — the
    // second pass starts as soon as the first finishes its
    // final in-flight request.
    let bundle_futures = bundles.into_iter().map(|bundle| {
        let client = client.clone();
        let url = format!("{}{}/", GIVEAWAYS_DETAIL_URL_PREFIX, bundle.id);
        let bundle_for_task = bundle.clone();
        async move {
            let res = fetch_giveaway_bundle(&client, &url, &bundle_for_task).await;
            // Use the clone's id (not the outer `bundle.id`) so
            // the capture is explicit — `bundle` itself is in
            // scope only for the outer closure's tuple, not for
            // this async block.
            (bundle_for_task.id, res)
        }
    });

    let bundle_results: Vec<(u64, Result<Vec<Giveaway>, String>)> = stream::iter(bundle_futures)
        .buffer_unordered(GIVEAWAYS_DETAIL_CONCURRENCY)
        .collect()
        .await;

    let individual_futures = new_individual_ids.into_iter().map(|id| {
        let client = client.clone();
        let url = format!("{}{}/", GIVEAWAYS_DETAIL_URL_PREFIX, id);
        async move {
            let res = fetch_individual_giveaway(&client, &url, id).await;
            (id, res)
        }
    });

    let individual_results: Vec<(u64, Result<Vec<Giveaway>, String>)> =
        stream::iter(individual_futures)
            .buffer_unordered(GIVEAWAYS_DETAIL_CONCURRENCY)
            .collect()
            .await;

    // Flatten per-detail-page game lists into a single Vec.
    let mut giveaways: Vec<Giveaway> = Vec::new();
    for (id, result) in bundle_results
        .into_iter()
        .chain(individual_results.into_iter())
    {
        match result {
            Ok(mut games) => giveaways.append(&mut games),
            Err(e) => eprintln!("[deals] Giveaway detail {} fetch failed: {}", id, e),
        }
    }

    // Resolve all `deal_url` tracking redirects (e.g.
    // `humblebundleinc.sjv.io` affiliate links) to their final
    // store URLs in parallel. The same `resolve_single_redirect`
    // helper used for ITAD homepage deals is reused here — it
    // works for any URL with a redirect chain.
    resolve_giveaway_redirects(&client, &mut giveaways).await;

    // Deduplicate by claim URL. If the same game surfaces in
    // both a bundle and as an individual giveaway (rare but
    // possible when ITAD reuses IDs), the user only needs one
    // card.
    let mut seen_urls: std::collections::HashSet<String> =
        std::collections::HashSet::new();
    giveaways.retain(|g| seen_urls.insert(g.deal_url.clone()));

    // Drop expired entries. `expiry == None` is treated as
    // "no expiry set, keep it". A parse failure also fails
    // closed (drop) — we'd rather show one fewer card than a
    // stale one the user can't claim.
    let now = chrono::Utc::now().timestamp();
    giveaways.retain(|g| {
        g.expiry
            .as_deref()
            .map(|iso| {
                chrono::DateTime::parse_from_rfc3339(iso)
                    .map(|dt| dt.timestamp() > now)
                    .unwrap_or(false)
            })
            .unwrap_or(true)
    });

    // Soonest-expiring first.
    giveaways.sort_by(|a, b| a.expiry.cmp(&b.expiry));

    Ok(giveaways)
}

/// Internal summary of a single bundle, used to drive the
/// per-bundle detail fetch. Not exposed to the frontend.
#[derive(Debug, Clone)]
struct BundleMeta {
    id: u64,
    title: String,
    store_name: String,
    bundle_url: String,
    is_mature: bool,
    expiry_ts: Option<i64>,
}

/// GET the giveaways list page and return the raw HTML.
async fn fetch_giveaways_list(client: &reqwest::Client) -> Result<String, String> {
    let resp = client
        .get(GIVEAWAYS_LIST_URL)
        .timeout(Duration::from_secs(GIVEAWAYS_LIST_TIMEOUT_SECS))
        .send()
        .await
        .map_err(|e| format!("Giveaways list request failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Giveaways list returned status {}", resp.status()));
    }
    resp.text()
        .await
        .map_err(|e| format!("Giveaways list body read failed: {}", e))
}

/// Fetch the ITAD homepage and extract every `/giveaways/{id}/`
/// link — these are the individual free-game giveaways. The
/// homepage is server-rendered Svelte so the links are in the
/// static HTML (the /giveaways/ page itself loads this section
/// client-side, so we have to source it from elsewhere).
async fn fetch_individual_giveaway_ids(
    client: &reqwest::Client,
) -> Result<Vec<u64>, String> {
    let resp = client
        .get(HOMEPAGE_URL)
        .timeout(Duration::from_secs(GIVEAWAYS_LIST_TIMEOUT_SECS))
        .send()
        .await
        .map_err(|e| format!("Homepage request failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Homepage returned status {}", resp.status()));
    }
    let html = resp
        .text()
        .await
        .map_err(|e| format!("Homepage body read failed: {}", e))?;

    // Use the `scraper` crate to find all `<a href="/giveaways/...">`
    // anchors. The selector is anchored on the href prefix so it
    // survives Svelte's class-hash churn.
    let document = Html::parse_document(&html);
    let link_sel = Selector::parse(r#"a[href^="/giveaways/"]"#)
        .map_err(|e| format!("bad selector a[href^=/giveaways/]: {:?}", e))?;

    let mut ids: Vec<u64> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for link in document.select(&link_sel) {
        let Some(href) = link.value().attr("href") else {
            continue;
        };
        // href is something like "/giveaways/16320/" or
        // "/giveaways/16320". Strip the prefix and the trailing
        // slash, then parse the numeric id.
        let stripped = href
            .trim_start_matches("/giveaways/")
            .trim_end_matches('/');
        let id_str = stripped.split('/').next().unwrap_or("");
        if let Ok(id) = id_str.parse::<u64>() {
            if id > 0 && seen.insert(id) {
                ids.push(id);
            }
        }
    }
    Ok(ids)
}

/// GET a single bundle detail page and parse it into per-game
/// `Giveaway` entries. The page is server-rendered HTML with a
/// `var page = [...]` script containing the data we care about.
async fn fetch_giveaway_bundle(
    client: &reqwest::Client,
    url: &str,
    bundle: &BundleMeta,
) -> Result<Vec<Giveaway>, String> {
    let resp = client
        .get(url)
        .timeout(Duration::from_secs(GIVEAWAYS_DETAIL_TIMEOUT_SECS))
        .send()
        .await
        .map_err(|e| format!("Bundle {} request failed: {}", bundle.id, e))?;
    if !resp.status().is_success() {
        return Err(format!(
            "Bundle {} returned status {}",
            bundle.id,
            resp.status()
        ));
    }
    let html = resp
        .text()
        .await
        .map_err(|e| format!("Bundle {} body read failed: {}", bundle.id, e))?;
    parse_giveaway_bundle(&html, bundle)
}

/// GET a single individual-giveaway detail page and parse it.
/// Unlike bundles, individual giveaways (e.g. "Nexus: The Jupiter
/// Incident" from itch.io) don't appear in the /giveaways/ list
/// page — they live on the homepage and we only know their IDs.
/// We pass a minimal `BundleMeta` with just the id; the rest of
/// the metadata (title, store, url, expiry) is extracted from
/// the detail page itself.
async fn fetch_individual_giveaway(
    client: &reqwest::Client,
    url: &str,
    id: u64,
) -> Result<Vec<Giveaway>, String> {
    let resp = client
        .get(url)
        .timeout(Duration::from_secs(GIVEAWAYS_DETAIL_TIMEOUT_SECS))
        .send()
        .await
        .map_err(|e| format!("Giveaway {} request failed: {}", id, e))?;
    if !resp.status().is_success() {
        return Err(format!(
            "Giveaway {} returned status {}",
            id,
            resp.status()
        ));
    }
    let html = resp
        .text()
        .await
        .map_err(|e| format!("Giveaway {} body read failed: {}", id, e))?;
    parse_individual_giveaway(&html, id)
}

/// Find the byte index of the closing `]` for a JSON array that
/// starts at the first `[` in `text`. Tracks string literals
/// (with escape sequences) and nested `[]` / `{}` so we don't
/// get confused by brackets inside a string or a nested array.
/// Returns `None` if no matching `]` is found.
fn find_json_array_end(text: &str) -> Option<usize> {
    let mut depth: i32 = 0;
    let mut in_string = false;
    let mut escape = false;
    let mut started = false;
    for (i, c) in text.char_indices() {
        if !started {
            if c == '[' {
                started = true;
                depth = 1;
            }
            continue;
        }
        if escape {
            escape = false;
            continue;
        }
        match c {
            '\\' if in_string => escape = true,
            '"' => in_string = !in_string,
            '[' | '{' if !in_string => depth += 1,
            ']' | '}' if !in_string => {
                depth -= 1;
                if c == ']' && depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

/// Extract the embedded `var page = [...]` JSON literal from the
/// HTML and parse it. SvelteKit's page state is a tuple-shaped
/// array: `[component_name, data, refs?]` — we unwrap to the
/// data object (index 1) and resolve any devalue-style reference
/// indices using the lookup table at index 2.
fn extract_page_data(html: &str) -> Result<serde_json::Value, String> {
    let start = html
        .find("var page = ")
        .ok_or_else(|| "No 'var page = ' in HTML".to_string())?;
    let after_start = start + "var page = ".len();
    // Use bracket counting (not `rfind("];")`) so we don't
    // match a closing bracket that's inside a string literal
    // (e.g. a game title with `]` in it). The previous `rfind`
    // approach was one weird game title away from a silent
    // truncated parse.
    let end_idx = find_json_array_end(&html[after_start..])
        .ok_or_else(|| "No matching ']' for var page".to_string())?;
    let json_text = &html[after_start..after_start + end_idx + 1];
    let raw: serde_json::Value = serde_json::from_str(json_text)
        .map_err(|e| format!("JSON parse error for var page: {}", e))?;

    // SvelteKit page state shape: [name, data, refs?]
    let arr = raw
        .as_array()
        .ok_or_else(|| "var page is not a JSON array".to_string())?;
    if arr.len() < 2 {
        return Err("var page array too short".to_string());
    }
    let data = arr[1].clone();
    // If the third element is an array, it's the devalue reference
    // lookup table; resolve any index-based references in the data.
    if let Some(refs) = arr.get(2).and_then(|v| v.as_array()) {
        Ok(resolve_svelte_refs(&data, refs))
    } else {
        Ok(data)
    }
}

/// Recursively walk a SvelteKit `devalue` payload and replace any
/// integer values with the corresponding entry from the reference
/// table. De-value uses bare integers as back-references into the
/// lookup array (e.g. `{ "title": 4 }` means
/// `lookup[4]` is the actual title).
fn resolve_svelte_refs(
    value: &serde_json::Value,
    refs: &[serde_json::Value],
) -> serde_json::Value {
    match value {
        serde_json::Value::Number(n) => {
            if let Some(idx) = n.as_u64() {
                let idx = idx as usize;
                if idx < refs.len() {
                    return resolve_svelte_refs(&refs[idx], refs);
                }
            }
            value.clone()
        }
        serde_json::Value::Array(arr) => serde_json::Value::Array(
            arr.iter()
                .map(|v| resolve_svelte_refs(v, refs))
                .collect(),
        ),
        serde_json::Value::Object(obj) => serde_json::Value::Object(
            obj.iter()
                .map(|(k, v)| (k.clone(), resolve_svelte_refs(v, refs)))
                .collect(),
        ),
        _ => value.clone(),
    }
}

/// Parse the giveaways list page into bundle metadata.
fn parse_giveaways_list(html: &str) -> Result<Vec<BundleMeta>, String> {
    let data = extract_page_data(html)?;
    let bundles = data
        .get("bundles")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "No 'bundles' array in giveaways page".to_string())?;

    let mut result = Vec::new();
    for b in bundles {
        let id = b.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
        let title = b
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let store_name = b
            .get("page")
            .and_then(|p| p.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown Store")
            .to_string();
        let bundle_url = b
            .get("url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let is_mature = b.get("isMature").and_then(|v| v.as_bool()).unwrap_or(false);
        let expiry_ts = b.get("expiry").and_then(|v| v.as_i64());

        if id == 0 || title.is_empty() {
            continue;
        }
        result.push(BundleMeta {
            id,
            title,
            store_name,
            bundle_url,
            is_mature,
            expiry_ts,
        });
    }
    Ok(result)
}

/// Parse a bundle detail page into per-game `Giveaway` entries.
/// Falls back to a single bundle-level entry if the page doesn't
/// expose a per-game array (the older or non-game bundle
/// variants ship without one).
fn parse_giveaway_bundle(html: &str, bundle: &BundleMeta) -> Result<Vec<Giveaway>, String> {
    let data = extract_page_data(html)?;

    // Try the most-likely field names for the per-game list.
    // ITAD has shipped several schemas over time and we want to
    // be tolerant of any future rename.
    let games_opt = ["games", "items", "titles", "products", "tiers"]
        .iter()
        .find_map(|key| data.get(*key).and_then(|v| v.as_array()));

    let expiry_str = ts_to_iso(bundle.expiry_ts);
    let games = match games_opt {
        Some(g) if !g.is_empty() => g,
        _ => {
            // No per-game data — synthesize one card for the
            // bundle itself so the user still sees it.
            return Ok(vec![bundle_to_giveaway(bundle, expiry_str)]);
        }
    };

    let mut result = Vec::new();
    for g in games {
        let game_id = g.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
        let title = g
            .get("title")
            .or_else(|| g.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if title.is_empty() {
            continue;
        }
        let image_url = extract_image_url(g);
        // Per-game URL when present, otherwise inherit the parent
        // bundle's tracking URL so the user can still claim the
        // whole bundle.
        let deal_url = ["url", "claimUrl", "redeemUrl", "link", "href"]
            .iter()
            .find_map(|key| g.get(*key).and_then(|v| v.as_str()))
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| bundle.bundle_url.clone());

        result.push(Giveaway {
            id: format!("{}-{}", bundle.id, game_id),
            title,
            bundle_title: bundle.title.clone(),
            image_url,
            store_name: bundle.store_name.clone(),
            deal_url,
            is_mature: bundle.is_mature,
            expiry: expiry_str.clone(),
        });
    }

    if result.is_empty() {
        result.push(bundle_to_giveaway(bundle, expiry_str));
    }
    Ok(result)
}

/// Synthesize a single `Giveaway` from a bundle (fallback when no
/// per-game data is available).
fn bundle_to_giveaway(bundle: &BundleMeta, expiry: Option<String>) -> Giveaway {
    Giveaway {
        id: bundle.id.to_string(),
        title: bundle.title.clone(),
        bundle_title: bundle.title.clone(),
        image_url: None,
        store_name: bundle.store_name.clone(),
        deal_url: bundle.bundle_url.clone(),
        is_mature: bundle.is_mature,
        expiry,
    }
}

/// Build a `BundleMeta` from a raw `serde_json::Value` of the
/// giveaway/bundle object. Used when we have to extract the
/// parent metadata from a detail page (instead of the list
/// page) — e.g. for individual giveaways sourced from the
/// homepage.
fn meta_from_json(v: &serde_json::Value) -> BundleMeta {
    BundleMeta {
        id: v.get("id").and_then(|x| x.as_u64()).unwrap_or(0),
        title: v
            .get("title")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        store_name: v
            .get("page")
            .and_then(|p| p.get("name"))
            .and_then(|x| x.as_str())
            .unwrap_or("Unknown Store")
            .to_string(),
        bundle_url: v
            .get("url")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        is_mature: v.get("isMature").and_then(|x| x.as_bool()).unwrap_or(false),
        expiry_ts: v.get("expiry").and_then(|x| x.as_i64()),
    }
}

/// Parse an individual-giveaway detail page (e.g.
/// `/giveaways/16320/`) into a single `Giveaway`. The detail
/// page for an individual giveaway has the same `var page = [...]`
/// shape as a bundle, but the parent object lives under a
/// `giveaway` key (vs. `bundle` for bundles) and there's
/// typically no per-game array — the giveaway IS the game.
fn parse_individual_giveaway(
    html: &str,
    fallback_id: u64,
) -> Result<Vec<Giveaway>, String> {
    let data = extract_page_data(html)?;

    // Find the parent object. ITAD has shipped both "bundle" and
    // "giveaway" keys for these pages; we try both.
    let parent = data
        .get("giveaway")
        .or_else(|| data.get("bundle"))
        .or_else(|| data.get("item"))
        .cloned()
        .unwrap_or(serde_json::Value::Null);

    if parent.is_null() {
        return Err(format!(
            "No giveaway/bundle object in detail page for id {}",
            fallback_id
        ));
    }

    let meta = meta_from_json(&parent);
    let expiry_str = ts_to_iso(meta.expiry_ts);

    // Try the per-game array first (rare for individual
    // giveaways, but possible for multi-game "giveaway bundles").
    let games_opt = ["games", "items", "titles", "products", "tiers"]
        .iter()
        .find_map(|key| data.get(*key).and_then(|v| v.as_array()));

    let games = match games_opt {
        Some(g) if !g.is_empty() => g,
        _ => {
            // No per-game array — the parent object IS the single
            // game. Synthesize one Giveaway from the parent's
            // fields directly.
            return Ok(vec![giveaway_from_parent(&parent, &meta, expiry_str)]);
        }
    };

    // Per-game array: build one Giveaway per entry using the
    // parent's metadata as the context.
    let mut result = Vec::new();
    for g in games {
        let game_id = g.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
        let title = g
            .get("title")
            .or_else(|| g.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if title.is_empty() {
            continue;
        }
        let image_url = extract_image_url(g);
        let deal_url = ["url", "claimUrl", "redeemUrl", "link", "href"]
            .iter()
            .find_map(|key| g.get(*key).and_then(|v| v.as_str()))
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| meta.bundle_url.clone());

        result.push(Giveaway {
            id: format!("{}-{}", meta.id, game_id),
            title,
            bundle_title: meta.title.clone(),
            image_url,
            store_name: meta.store_name.clone(),
            deal_url,
            is_mature: meta.is_mature,
            expiry: expiry_str.clone(),
        });
    }

    if result.is_empty() {
        result.push(giveaway_from_parent(&parent, &meta, expiry_str));
    }
    Ok(result)
}

/// Build a `Giveaway` from a giveaway/bundle parent object
/// directly (no per-game array). Used as the fallback when the
/// detail page only has the parent metadata.
fn giveaway_from_parent(
    parent: &serde_json::Value,
    meta: &BundleMeta,
    expiry: Option<String>,
) -> Giveaway {
    let title = parent
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or(&meta.title)
        .to_string();
    let image_url = extract_image_url(parent);
    Giveaway {
        id: meta.id.to_string(),
        title: if title.is_empty() { meta.title.clone() } else { title },
        bundle_title: meta.title.clone(),
        image_url,
        store_name: meta.store_name.clone(),
        deal_url: meta.bundle_url.clone(),
        is_mature: meta.is_mature,
        expiry,
    }
}

/// Normalize an image URL found anywhere in a game object. ITAD
/// CDN URLs may be naked paths (`//cdn.isthereanydeal.com/...`),
/// root-relative (`/foo.jpg`), or already absolute. We resolve
/// to a full https URL; the frontend can append a size hint if
/// it wants a smaller thumbnail.
fn extract_image_url(game: &serde_json::Value) -> Option<String> {
    let raw = ["image", "imageUrl", "thumbnail", "cover", "capsule", "headerImage"]
        .iter()
        .find_map(|key| game.get(*key).and_then(|v| v.as_str()))?;
    if raw.is_empty() {
        return None;
    }
    if raw.starts_with("http://") || raw.starts_with("https://") {
        Some(raw.to_string())
    } else if let Some(stripped) = raw.strip_prefix("//") {
        Some(format!("https://{}", stripped))
    } else if let Some(stripped) = raw.strip_prefix('/') {
        Some(format!("https://isthereanydeal.com/{}", stripped))
    } else {
        Some(format!("https://{}", raw))
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
