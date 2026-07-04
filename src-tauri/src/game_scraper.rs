use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Data Types ───────────────────────────────────────────────────────────────

/// Represents a collection of game images (URLs) from a metadata source.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GameImages {
    /// Small square icon (e.g., 32x32 or similar)
    pub icon: Option<String>,
    /// Vertical cover art / box art (e.g., 600x900)
    pub cover: Option<String>,
    /// Hero image / header (e.g., 460x215)
    pub hero: Option<String>,
    /// Wide banner (e.g., 1920x620)
    pub banner: Option<String>,
    /// Game logo / title image (transparent PNG)
    pub logo: Option<String>,
}

/// A unified metadata result from a single source.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GameMetadataResult {
    /// Display title of the game
    pub title: String,
    /// Short description or summary
    pub description: Option<String>,
    /// Developer name(s)
    pub developer: Option<String>,
    /// Publisher name(s)
    pub publisher: Option<String>,
    /// Human-readable release date (e.g., "Oct 20, 2020")
    pub release_date: Option<String>,
    /// Genre tags
    pub genres: Vec<String>,
    /// Image URLs discovered for this game
    pub images: GameImages,
    /// URL of the source page
    pub source_url: String,
    /// Human-readable source name (e.g., "Steam", "IGDB")
    pub source_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storyline: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub igdb_rating: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub critic_rating: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub themes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_modes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub player_perspectives: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub screenshots: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub videos: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub websites: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_to_beat: Option<TimeToBeat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub similar_games: Option<Vec<SimilarGame>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub releases: Option<Vec<ReleaseDateInfo>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub igdb_reviews: Option<Vec<IgdbReview>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TimeToBeat {
    pub hastly: Option<u64>,
    pub normally: Option<u64>,
    pub completely: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SimilarGame {
    pub id: u64,
    pub name: String,
    pub cover_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseDateInfo {
    pub platform: String,
    pub date_str: String,
    pub region: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IgdbReview {
    pub title: Option<String>,
    pub content: Option<String>,
    pub rating: Option<u32>,
    pub username: Option<String>,
}

// ─── Store Types (IGDB catalog browsing) ─────────────────────────────────────

/// Lightweight game summary for store listings (cards, grids).
/// Contains only what's needed for display — no full metadata.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoreGameSummary {
    pub id: u64,
    pub name: String,
    pub slug: String,
    pub summary: Option<String>,
    pub rating: Option<f64>,
    pub aggregated_rating: Option<f64>,
    pub cover_url: Option<String>,
    pub genres: Vec<String>,
    pub platforms: Vec<String>,
    pub first_release_date: Option<String>,
    pub total_rating_count: u64,
    pub hypes: u64,
}

/// Internal IGDB deserialization type for store game listings.
#[derive(Debug, Deserialize)]
struct IgdbGameSummary {
    id: u64,
    name: String,
    slug: String,
    summary: Option<String>,
    rating: Option<f64>,
    aggregated_rating: Option<f64>,
    cover: Option<IgdbCover>,
    genres: Option<Vec<IgdbName>>,
    platforms: Option<Vec<IgdbName>>,
    first_release_date: Option<i64>,
    total_rating_count: Option<u64>,
    hypes: Option<u64>,
}

// ─── Steam API Types (internal) ───────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct SteamSearchResponse {
    items: Vec<SteamSearchItem>,
}

#[derive(Debug, Deserialize)]
struct SteamSearchItem {
    id: u64,
    name: String,
    #[serde(default)]
    tiny_image: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SteamAppDetailResponse {
    #[serde(flatten)]
    apps: HashMap<String, SteamAppDetailWrapper>,
}

#[derive(Debug, Deserialize)]
struct SteamAppDetailWrapper {
    success: bool,
    data: Option<SteamAppDetail>,
}

#[derive(Debug, Deserialize)]
struct SteamAppDetail {
    #[allow(dead_code)]
    name: Option<String>,
    short_description: Option<String>,
    #[serde(default)]
    developers: Vec<String>,
    #[serde(default)]
    publishers: Vec<String>,
    release_date: Option<SteamReleaseDate>,
    #[serde(default)]
    genres: Vec<SteamGenre>,
    header_image: Option<String>,
    capsule_image: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SteamReleaseDate {
    date: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SteamGenre {
    description: Option<String>,
}

// ─── Base64 Encoding ─────────────────────────────────────────────────────────

/// Re-export of the base64 encoder shared with lib.rs.
/// This avoids code duplication.
fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(CHARS[((triple >> 18) & 63) as usize] as char);
        out.push(CHARS[((triple >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(CHARS[((triple >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(CHARS[(triple & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

// ─── Public API ───────────────────────────────────────────────────────────────

/// Search for game metadata across multiple sources.
/// Returns results ordered by relevance (best match first).
/// Currently supports Steam and LaunchBox Games Database.
pub async fn search_game_metadata(game_name: &str) -> Vec<GameMetadataResult> {
    let mut results: Vec<GameMetadataResult> = Vec::new();

    // Search Steam, LaunchBox, and IGDB in parallel
    let (steam_result, launchbox_result, igdb_results) = tokio::join!(
        search_steam(game_name),
        search_launchbox(game_name),
        search_igdb(game_name)
    );

    if let Some(r) = steam_result {
        results.push(r);
    }

    if let Some(r) = launchbox_result {
        results.push(r);
    }

    results.extend(igdb_results);

    results
}

/// Download an image from a URL and return it as a base64 data URL.
/// Returns `None` if the download fails.
pub async fn download_image_to_base64(url: &str) -> Option<String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; GameLib/1.0)")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .ok()?;

    let response = client.get(url).send().await.ok()?;
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();

    let bytes = response.bytes().await.ok()?;
    let b64 = base64_encode(&bytes);
    Some(format!("data:{};base64,{}", content_type, b64))
}

/// Batch-download images and return base64 data URLs.
/// This is exposed as a Tauri command.
pub async fn fetch_game_images(urls: Vec<String>) -> Vec<Option<String>> {
    let mut handles = Vec::new();
    for url in urls {
        handles.push(tokio::spawn(async move {
            download_image_to_base64(&url).await
        }));
    }
    let mut results = Vec::new();
    for handle in handles {
        results.push(handle.await.unwrap_or(None));
    }
    results
}

/// Use Spider to crawl a single page and return its full HTML content.
/// Uses Spider v2's Website API for HTTP-only crawling.
pub async fn spider_fetch_page(url: &str) -> Result<String, String> {
    // Spider v2: create Website and crawl the target URL.
    // The Website API handles robots.txt, rate limiting, and user-agent
    // rotation automatically.
    let mut website = spider::website::Website::new(url);
    website.configuration.respect_robots_txt = true;
    website.configuration.delay = 200;

    website.crawl().await;

    // get_pages returns Option<&Vec<Page>>.
    if let Some(page) = website.get_pages().and_then(|pages| pages.first()) {
        Ok(page.get_html())
    } else {
        Err(format!(
            "Spider: no pages scraped for URL: {}",
            url
        ))
    }
}

/// Use Spider to crawl a page and extract data using CSS selectors.
/// Returns a map of field name → extracted text values.
pub async fn spider_extract(
    url: &str,
    selectors: &HashMap<String, String>,
) -> Result<HashMap<String, Vec<String>>, String> {
    let html = spider_fetch_page(url).await?;
    let document = scraper::Html::parse_document(&html);

    let mut results: HashMap<String, Vec<String>> = HashMap::new();
    for (field_name, css_selector) in selectors {
        let selector = scraper::Selector::parse(css_selector)
            .map_err(|e| format!("Invalid CSS selector '{}': {}", css_selector, e))?;
        let values: Vec<String> = document
            .select(&selector)
            .map(|el| {
                el.text()
                    .collect::<Vec<_>>()
                    .join(" ")
                    .trim()
                    .to_string()
            })
            .filter(|s| !s.is_empty())
            .collect();
        results.insert(field_name.clone(), values);
    }

    Ok(results)
}

// ─── Source: Steam ────────────────────────────────────────────────────────────

/// Search Steam's store for a game and return metadata.
async fn search_steam(game_name: &str) -> Option<GameMetadataResult> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; GameLib/1.0)")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .ok()?;

    // Step 1: Search the Steam store
    let search_url = format!(
        "https://store.steampowered.com/api/storesearch/?term={}&l=english&cc=us",
        url_encode(game_name)
    );

    let search_resp = client.get(&search_url).send().await.ok()?;
    let search_data: SteamSearchResponse = search_resp.json().await.ok()?;

    let best_match = search_data.items.into_iter().next()?;
    let app_id = best_match.id;
    let title = best_match.name;

    // Step 2: Get detailed app information
    let detail_url = format!(
        "https://store.steampowered.com/api/appdetails?appids={}",
        app_id
    );

    let detail_resp = client.get(&detail_url).send().await.ok()?;
    let detail_data: SteamAppDetailResponse = detail_resp.json().await.ok()?;

    let wrapper = detail_data.apps.get(&app_id.to_string())?;
    if !wrapper.success {
        return None;
    }
    let data = wrapper.data.as_ref()?;

    // Build images from the API response and CDN patterns
    let images = GameImages {
        icon: best_match.tiny_image.map(|hash| {
            format!(
                "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/{}/{}.jpg",
                app_id, hash
            )
        }),
        cover: Some(format!(
            "https://cdn.cloudflare.steamstatic.com/steam/apps/{}/library_600x900.jpg",
            app_id
        )),
        hero: data
            .capsule_image
            .clone()
            .or_else(|| data.header_image.clone())
            .or_else(|| {
                Some(format!(
                    "https://cdn.cloudflare.steamstatic.com/steam/apps/{}/header.jpg",
                    app_id
                ))
            }),
        banner: Some(format!(
            "https://cdn.cloudflare.steamstatic.com/steam/apps/{}/library_hero.jpg",
            app_id
        )),
        logo: Some(format!(
            "https://cdn.cloudflare.steamstatic.com/steam/apps/{}/logo.png",
            app_id
        )),
    };

    Some(GameMetadataResult {
        title,
        description: data.short_description.clone(),
        developer: data.developers.first().cloned(),
        publisher: data.publishers.first().cloned(),
        release_date: data
            .release_date
            .as_ref()
            .and_then(|rd| rd.date.clone()),
        genres: data
            .genres
            .iter()
            .filter_map(|g| g.description.clone())
            .collect(),
        images,
        source_url: format!("https://store.steampowered.com/app/{}", app_id),
        source_name: "Steam".to_string(),
        storyline: None,
        igdb_rating: None,
        critic_rating: None,
        themes: None,
        game_modes: None,
        player_perspectives: None,
        screenshots: None,
        videos: None,
        websites: None,
        time_to_beat: None,
        similar_games: None,
        releases: None,
        igdb_reviews: None,
    })
}

// ─── Source: LaunchBox Games Database ──────────────────────────────────────────

/// A single image entry from the LaunchBox Games Database detail page.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LaunchBoxImageResult {
    /// Category such as "Box - Front", "Banner", "Fanart - Background", "Clear Logo"
    pub category: String,
    /// Region label if available (e.g., "World", "Europe", "North America")
    pub region: Option<String>,
    /// Resolution string (e.g., "1920x1080")
    pub resolution: String,
    /// Full-resolution image URL
    pub url: String,
}

/// Build a shared reqwest client for LaunchBox requests.
fn launchbox_client() -> Option<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .ok()
}

/// Search the LaunchBox Games Database for a game and return metadata.
async fn search_launchbox(game_name: &str) -> Option<GameMetadataResult> {
    let client = launchbox_client()?;

    // Step 1: Search the LaunchBox Games Database
    let search_url = format!(
        "https://gamesdb.launchbox-app.com/games/results/{}",
        url_encode(game_name)
    );

    let search_resp = client.get(&search_url).send().await.ok()?;
    let search_html = search_resp.text().await.ok()?;

    // Parse HTML synchronously and extract all data (scraper::Html is !Send)
    struct SearchHit {
        href: String,
        title: String,
        _platform: String,
        cover_url: Option<String>,
        description: Option<String>,
        release_date: Option<String>,
    }

    let (hits, detail_url_str) = {
        let document = scraper::Html::parse_document(&search_html);

        let card_selector = scraper::Selector::parse(".games-grid-card").ok()?;
        let link_selector = scraper::Selector::parse("a.list-item").ok()?;
        let title_selector = scraper::Selector::parse(".cardTitle h3").ok()?;
        let platform_selector = scraper::Selector::parse(".cardTitle p").ok()?;
        let img_selector = scraper::Selector::parse(".cardImgPart > img").ok()?;
        let desc_selector = scraper::Selector::parse(".cardContent > p").ok()?;
        let date_selector = scraper::Selector::parse(".releaseDate h5").ok()?;

        let mut hits: Vec<SearchHit> = Vec::new();

        for card in document.select(&card_selector).take(12) {
            let href = card
                .select(&link_selector)
                .next()
                .and_then(|a| a.value().attr("href"))
                .unwrap_or("")
                .to_string();

            if href.is_empty() {
                continue;
            }

            let title = card
                .select(&title_selector)
                .next()
                .map(|el| el.text().collect::<Vec<_>>().join("").trim().to_string())
                .unwrap_or_default();

            let platform = card
                .select(&platform_selector)
                .next()
                .map(|el| el.text().collect::<Vec<_>>().join("").trim().to_string())
                .unwrap_or_default();

            let cover_url = card
                .select(&img_selector)
                .next()
                .and_then(|el| el.value().attr("src"))
                .map(|s| s.to_string());

            let description = card
                .select(&desc_selector)
                .last()
                .map(|el| el.text().collect::<Vec<_>>().join("").trim().to_string())
                .filter(|s| !s.is_empty());

            let release_date = card
                .select(&date_selector)
                .next()
                .map(|el| el.text().collect::<Vec<_>>().join("").trim().to_string())
                .filter(|s| !s.is_empty());

            if !title.is_empty() {
                hits.push(SearchHit {
                    href,
                    title,
                    _platform: platform.clone(),
                    cover_url,
                    description,
                    release_date,
                });
            }
        }

        if hits.is_empty() {
            return None;
        }

        // Prefer Windows platform if available, otherwise take first result
        let best_idx = hits
            .iter()
            .position(|h| h._platform.eq_ignore_ascii_case("Windows"))
            .unwrap_or(0);

        let detail_url = if hits[best_idx].href.starts_with("http") {
            hits[best_idx].href.clone()
        } else {
            format!("https://gamesdb.launchbox-app.com{}", hits[best_idx].href)
        };

        (hits, detail_url)
        // document is dropped here — scraper::Html is no longer alive across .await
    };

    // Prefer Windows platform, fallback to first
    let best_idx = hits
        .iter()
        .position(|h| h._platform.eq_ignore_ascii_case("Windows"))
        .unwrap_or(0);
    let best = &hits[best_idx];

    // Step 2: Fetch the detail page for richer metadata
    let (description, developer, publisher, genres, release_date, images) =
        fetch_launchbox_details(&client, &detail_url_str).await.unwrap_or_else(|| {
            // Fallback: use search result data
            (
                best.description.clone(),
                None,
                None,
                Vec::new(),
                best.release_date.clone(),
                GameImages {
                    icon: None,
                    cover: best.cover_url.clone(),
                    hero: None,
                    banner: None,
                    logo: None,
                },
            )
        });

    Some(GameMetadataResult {
        title: best.title.clone(),
        description,
        developer,
        publisher,
        release_date,
        genres,
        images,
        source_url: detail_url_str,
        source_name: "LaunchBox".to_string(),
        storyline: None,
        igdb_rating: None,
        critic_rating: None,
        themes: None,
        game_modes: None,
        player_perspectives: None,
        screenshots: None,
        videos: None,
        websites: None,
        time_to_beat: None,
        similar_games: None,
        releases: None,
        igdb_reviews: None,
    })
}

/// Fetch a LaunchBox game detail page and extract metadata + best images.
async fn fetch_launchbox_details(
    client: &reqwest::Client,
    detail_url: &str,
) -> Option<(
    Option<String>,       // description
    Option<String>,       // developer
    Option<String>,       // publisher
    Vec<String>,          // genres
    Option<String>,       // release_date
    GameImages,           // images
)> {
    let resp = client.get(detail_url).send().await.ok()?;
    let html = resp.text().await.ok()?;
    let doc = scraper::Html::parse_document(&html);

    // --- Extract description from the meta tag (most reliable for Nuxt SSR pages) ---
    let description = scraper::Selector::parse("meta[name='description']")
        .ok()
        .and_then(|sel| {
            doc.select(&sel)
                .next()
                .and_then(|el| el.value().attr("content"))
                .map(|s| s.trim().to_string())
        })
        .filter(|s| !s.is_empty());

    // --- Extract developer/publisher/genre from the detail page ---
    // The new Nuxt-based detail page uses <dt>/<dd> pairs
    let dt_selector = scraper::Selector::parse("dt").ok()?;
    let dd_selector = scraper::Selector::parse("dd").ok()?;
    let a_selector = scraper::Selector::parse("a").ok()?;
    let time_selector = scraper::Selector::parse("time").ok()?;

    let mut developer: Option<String> = None;
    let mut publisher: Option<String> = None;
    let mut genres: Vec<String> = Vec::new();
    let mut release_date: Option<String> = None;

    // Walk through all <dt> elements and match their text content
    let dts: Vec<_> = doc.select(&dt_selector).collect();
    let dds: Vec<_> = doc.select(&dd_selector).collect();

    for (dt, dd) in dts.iter().zip(dds.iter()) {
        let label = dt
            .text()
            .collect::<Vec<_>>()
            .join("")
            .trim()
            .to_lowercase();

        if label.contains("developer") {
            let devs: Vec<String> = dd
                .select(&a_selector)
                .map(|a| a.text().collect::<Vec<_>>().join("").trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            if !devs.is_empty() {
                developer = Some(devs.join("; "));
            }
        } else if label.contains("publisher") {
            let pubs: Vec<String> = dd
                .select(&a_selector)
                .map(|a| a.text().collect::<Vec<_>>().join("").trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            if !pubs.is_empty() {
                publisher = Some(pubs.join("; "));
            }
        } else if label.contains("genre") {
            genres = dd
                .select(&a_selector)
                .map(|a| a.text().collect::<Vec<_>>().join("").trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
        } else if label.contains("release") {
            release_date = dd
                .select(&time_selector)
                .next()
                .and_then(|t| t.value().attr("datetime"))
                .map(|s| s.trim().to_string())
                .or_else(|| {
                    Some(
                        dd.text()
                            .collect::<Vec<_>>()
                            .join("")
                            .trim()
                            .to_string(),
                    )
                })
                .filter(|s| !s.is_empty());
        }
    }

    // --- Extract images by category ---
    let all_images = extract_launchbox_images(&doc);

    // Map to our GameImages — pick the first image in each relevant category
    let find_image = |categories: &[&str]| -> Option<String> {
        for cat in categories {
            if let Some(img) = all_images.iter().find(|i| {
                i.category.to_lowercase().contains(&cat.to_lowercase())
            }) {
                return Some(img.url.clone());
            }
        }
        None
    };

    let images = GameImages {
        icon: None,
        cover: find_image(&["Box - Front", "Box Front"]),
        hero: find_image(&["Banner"]),
        banner: find_image(&["Fanart - Background", "Fanart", "Screenshot"]),
        logo: find_image(&["Clear Logo"]),
    };

    Some((description, developer, publisher, genres, release_date, images))
}

/// Extract all categorized images from a LaunchBox detail page document.
fn extract_launchbox_images(doc: &scraper::Html) -> Vec<LaunchBoxImageResult> {
    let mut results: Vec<LaunchBoxImageResult> = Vec::new();

    // The detail page groups images under <article> elements with <h3> category headings.
    // Each image is an <img> inside a container with an alt text containing metadata.
    // Alt format: "GAME_TITLE - Category (Region) - WIDTHxHEIGHT"
    let article_selector = match scraper::Selector::parse("article") {
        Ok(s) => s,
        Err(_) => return results,
    };
    let h3_selector = match scraper::Selector::parse("h3") {
        Ok(s) => s,
        Err(_) => return results,
    };
    let img_selector = match scraper::Selector::parse("img[loading='lazy']") {
        Ok(s) => s,
        Err(_) => return results,
    };

    for article in doc.select(&article_selector) {
        // Get the category name from the <h3> element
        let category = match article.select(&h3_selector).next() {
            Some(h3) => h3
                .text()
                .collect::<Vec<_>>()
                .join("")
                .trim()
                .to_string(),
            None => continue,
        };

        if category.is_empty() || category == "Overview" || category == "Media" {
            continue;
        }

        // Extract images within this article
        for img in article.select(&img_selector) {
            let src = match img.value().attr("src") {
                Some(s) if s.contains("launchbox") => s.to_string(),
                _ => continue,
            };

            let alt = img
                .value()
                .attr("alt")
                .unwrap_or("")
                .to_string();

            // Parse alt text: "DOOM - Box - Front (World) - 1440x2160"
            let (region, resolution) = parse_launchbox_image_alt(&alt);

            results.push(LaunchBoxImageResult {
                category: category.clone(),
                region,
                resolution,
                url: src,
            });
        }
    }

    results
}

/// Parse the alt text of a LaunchBox image to extract region and resolution.
/// Expected format: "TITLE - Category (Region) - WIDTHxHEIGHT"
fn parse_launchbox_image_alt(alt: &str) -> (Option<String>, String) {
    let mut region: Option<String> = None;
    let mut resolution = String::new();

    // Extract region from parentheses
    if let Some(start) = alt.rfind('(') {
        if let Some(end) = alt[start..].find(')') {
            let r = alt[start + 1..start + end].trim().to_string();
            if !r.is_empty() && r != "null" {
                region = Some(r);
            }
        }
    }

    // Extract resolution — last segment matching NNNxNNN pattern
    for part in alt.rsplit(" - ") {
        let trimmed = part.trim();
        if trimmed.contains('x') {
            let pieces: Vec<&str> = trimmed.split('x').collect();
            if pieces.len() == 2
                && pieces[0].trim().parse::<u32>().is_ok()
                && pieces[1].trim().parse::<u32>().is_ok()
            {
                resolution = trimmed.to_string();
                break;
            }
        }
    }

    (region, resolution)
}

/// Search LaunchBox for images of a given game name.
/// Returns all categorized images found on the detail page.
pub async fn search_launchbox_images(game_name: &str) -> Result<Vec<LaunchBoxImageResult>, String> {
    let client = launchbox_client().ok_or("Failed to create HTTP client")?;

    // Search LaunchBox
    let search_url = format!(
        "https://gamesdb.launchbox-app.com/games/results/{}",
        url_encode(game_name)
    );

    let search_resp = client
        .get(&search_url)
        .send()
        .await
        .map_err(|e| format!("LaunchBox search failed: {}", e))?;
    let search_html = search_resp
        .text()
        .await
        .map_err(|e| format!("Failed to read search response: {}", e))?;

    let href = {
        let document = scraper::Html::parse_document(&search_html);

        // Find the first game link
        let link_selector = scraper::Selector::parse("a.list-item")
            .map_err(|e| format!("Selector error: {}", e))?;

        // Collect links and try to find a Windows platform match
        let card_selector = scraper::Selector::parse(".games-grid-card")
            .map_err(|e| format!("Selector error: {}", e))?;
        let platform_selector = scraper::Selector::parse(".cardTitle p")
            .map_err(|e| format!("Selector error: {}", e))?;

        let mut best_href: Option<String> = None;
        let mut first_href: Option<String> = None;

        for card in document.select(&card_selector).take(12) {
            let href = card
                .select(&link_selector)
                .next()
                .and_then(|a| a.value().attr("href"))
                .map(|s| s.to_string());

            if let Some(ref h) = href {
                if first_href.is_none() {
                    first_href = Some(h.clone());
                }
                let platform = card
                    .select(&platform_selector)
                    .next()
                    .map(|el| el.text().collect::<Vec<_>>().join("").trim().to_string())
                    .unwrap_or_default();
                if platform.eq_ignore_ascii_case("Windows") {
                    best_href = Some(h.clone());
                    break;
                }
            }
        }

        best_href
            .or(first_href)
            .ok_or("No results found on LaunchBox")?
    };

    let detail_url = if href.starts_with("http") {
        href
    } else {
        format!("https://gamesdb.launchbox-app.com{}", href)
    };

    // Fetch the detail page
    let detail_resp = client
        .get(&detail_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch detail page: {}", e))?;
    let detail_html = detail_resp
        .text()
        .await
        .map_err(|e| format!("Failed to read detail page: {}", e))?;
    let detail_doc = scraper::Html::parse_document(&detail_html);

    Ok(extract_launchbox_images(&detail_doc))
}

// ─── Source: IGDB Twitch API ──────────────────────────────────────────────────

use std::sync::OnceLock;
use std::sync::Mutex;
use std::time::{Instant, Duration};

fn load_env_file() {
    let mut dir = std::env::current_dir().ok();
    while let Some(path) = dir {
        let env_path = path.join(".env");
        if env_path.exists() {
            if let Ok(content) = std::fs::read_to_string(env_path) {
                for line in content.lines() {
                    let line = line.trim();
                    if line.is_empty() || line.starts_with('#') {
                        continue;
                    }
                    if let Some((key, val)) = line.split_once('=') {
                        let key = key.trim();
                        let val = val.trim().trim_matches('"').trim_matches('\'');
                        std::env::set_var(key, val);
                    }
                }
            }
            break;
        }
        dir = path.parent().map(|p| p.to_path_buf());
    }
}

struct TokenCache {
    token: String,
    expires_at: Instant,
}

static TOKEN_CACHE: OnceLock<Mutex<Option<TokenCache>>> = OnceLock::new();

async fn get_twitch_token() -> Result<String, String> {
    load_env_file();
    let client_id = std::env::var("TWITCH_CLIENT_ID")
        .map_err(|_| "Missing TWITCH_CLIENT_ID environment variable. Please define it in your .env file.".to_string())?;
    let client_secret = std::env::var("TWITCH_CLIENT_SECRET")
        .map_err(|_| "Missing TWITCH_CLIENT_SECRET environment variable. Please define it in your .env file.".to_string())?;

    let cache_mutex = TOKEN_CACHE.get_or_init(|| Mutex::new(None));
    {
        let cache = cache_mutex.lock().map_err(|e| e.to_string())?;
        if let Some(ref c) = *cache {
            if Instant::now() < c.expires_at {
                return Ok(c.token.clone());
            }
        }
    }
    
    let client = reqwest::Client::new();
    let url = format!(
        "https://id.twitch.tv/oauth2/token?client_id={}&client_secret={}&grant_type=client_credentials",
        client_id, client_secret
    );
    
    #[derive(Deserialize)]
    struct TokenResponse {
        access_token: String,
        expires_in: u64,
    }
    
    let resp = client.post(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to send token request: {}", e))?;
        
    let data = resp.json::<TokenResponse>()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))?;
        
    let expires_in_secs = if data.expires_in > 60 { data.expires_in - 60 } else { data.expires_in };
    let expires_at = Instant::now() + Duration::from_secs(expires_in_secs);
    
    let token = data.access_token.clone();
    {
        let mut cache = cache_mutex.lock().map_err(|e| e.to_string())?;
        *cache = Some(TokenCache {
            token: token.clone(),
            expires_at,
        });
    }
    
    Ok(token)
}

#[derive(Debug, Deserialize)]
struct IgdbGame {
    id: u64,
    name: String,
    slug: String,
    summary: Option<String>,
    storyline: Option<String>,
    first_release_date: Option<i64>,
    rating: Option<f64>,
    aggregated_rating: Option<f64>,
    cover: Option<IgdbCover>,
    genres: Option<Vec<IgdbName>>,
    themes: Option<Vec<IgdbName>>,
    game_modes: Option<Vec<IgdbName>>,
    player_perspectives: Option<Vec<IgdbName>>,
    involved_companies: Option<Vec<IgdbInvolvedCompany>>,
    screenshots: Option<Vec<IgdbImage>>,
    artworks: Option<Vec<IgdbImage>>,
    videos: Option<Vec<IgdbVideo>>,
    websites: Option<Vec<IgdbWebsite>>,
    similar_games: Option<Vec<IgdbSimilarGameRaw>>,
    release_dates: Option<Vec<IgdbReleaseDateRaw>>,
}

#[derive(Debug, Deserialize)]
struct IgdbTimeToBeatRaw {
    hastly: Option<u64>,
    normally: Option<u64>,
    completely: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct IgdbSimilarGameRaw {
    id: u64,
    name: String,
    cover: Option<IgdbCover>,
}

#[derive(Debug, Deserialize)]
struct IgdbReleaseDateRaw {
    platform: Option<IgdbPlatformRaw>,
    human: Option<String>,
    region: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct IgdbPlatformRaw {
    name: String,
}

#[derive(Debug, Deserialize)]
struct IgdbUserRaw {
    username: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IgdbCover {
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IgdbName {
    name: String,
}

#[derive(Debug, Deserialize)]
struct IgdbInvolvedCompany {
    company: IgdbName,
    developer: bool,
    publisher: bool,
}

#[derive(Debug, Deserialize)]
struct IgdbImage {
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IgdbVideo {
    video_id: Option<String>,
    #[allow(dead_code)]
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IgdbWebsite {
    url: Option<String>,
    #[allow(dead_code)]
    category: Option<i32>,
}

fn format_unix_timestamp(ts: i64) -> String {
    let seconds_in_day = 86400;
    let days = ts / seconds_in_day;
    
    let mut year = 1970;
    let mut day_count = days;
    
    loop {
        let is_leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
        let days_in_year = if is_leap { 366 } else { 365 };
        if day_count < days_in_year {
            break;
        }
        day_count -= days_in_year;
        year += 1;
    }
    
    let is_leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
    let month_lengths = if is_leap {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    
    let mut month = 1;
    for &length in month_lengths.iter() {
        if day_count < length {
            break;
        }
        day_count -= length;
        month += 1;
    }
    
    let day = day_count + 1;
    format!("{:04}-{:02}-{:02}", year, month, day)
}

pub async fn search_igdb(game_name: &str) -> Vec<GameMetadataResult> {
    let token = match get_twitch_token().await {
        Ok(t) => t,
        Err(e) => {
            eprintln!("IGDB token error: {}", e);
            return Vec::new();
        }
    };
    
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
    {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    
    let escaped_name = game_name.replace('"', "\\\"");
    let body = format!(
        r#"search "{}";
fields name, slug, summary, storyline, first_release_date, rating, aggregated_rating,
       cover.url, screenshots.url, artworks.url, videos.video_id, videos.name,
       genres.name, themes.name, game_modes.name, player_perspectives.name,
       involved_companies.developer, involved_companies.publisher, involved_companies.company.name,
       websites.url, websites.category,
       similar_games.name, similar_games.cover.url,
       release_dates.platform.name, release_dates.human, release_dates.region;
limit 8;"#,
        escaped_name
    );
    
    load_env_file();
    let client_id = std::env::var("TWITCH_CLIENT_ID").unwrap_or_default();
    
    let resp = match client.post("https://api.igdb.com/v4/games")
        .header("Client-ID", &client_id)
        .header("Authorization", format!("Bearer {}", token))
        .body(body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("IGDB request error: {}", e);
            return Vec::new();
        }
    };
    
    let status = resp.status();
    if !status.is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        eprintln!("IGDB request failed with status {}: {}", status, err_text);
        return Vec::new();
    }

    let text = match resp.text().await {
        Ok(t) => t,
        Err(e) => {
            eprintln!("Failed to read IGDB response text: {}", e);
            return Vec::new();
        }
    };
    
    let igdb_games: Vec<IgdbGame> = match serde_json::from_str(&text) {
        Ok(games) => games,
        Err(e) => {
            eprintln!("IGDB parse error: {}, body was: {}", e, text);
            return Vec::new();
        }
    };

    let game_ids: Vec<String> = igdb_games.iter().map(|g| g.id.to_string()).collect();
    let mut reviews_by_game: std::collections::HashMap<u64, Vec<IgdbReview>> = std::collections::HashMap::new();
    if !game_ids.is_empty() {
        let review_body = format!(
            "fields game, title, content, review, user_rating, rating, user.username; where game = ({}); limit 50;",
            game_ids.join(",")
        );
        let resp = match client.post("https://api.igdb.com/v4/reviews")
            .header("Client-ID", &client_id)
            .header("Authorization", format!("Bearer {}", token))
            .body(review_body)
            .send()
            .await
        {
            Ok(r) => Some(r),
            Err(e) => {
                eprintln!("IGDB reviews request error: {}", e);
                None
            }
        };
        
        if let Some(r) = resp {
            if r.status().is_success() {
                if let Ok(text) = r.text().await {
                    #[derive(Debug, Deserialize)]
                    struct IgdbReviewInnerRaw {
                        game: u64,
                        title: Option<String>,
                        content: Option<String>,
                        review: Option<String>,
                        user_rating: Option<u32>,
                        rating: Option<u32>,
                        user: Option<IgdbUserRaw>,
                    }
                    if let Ok(raw_reviews) = serde_json::from_str::<Vec<IgdbReviewInnerRaw>>(&text) {
                        for rev in raw_reviews {
                            let content_text = rev.content.or(rev.review);
                            let final_rating = rev.rating.or(rev.user_rating);
                            let username = rev.user.and_then(|u| u.username);
                            
                            let mapped = IgdbReview {
                                title: rev.title,
                                content: content_text,
                                rating: final_rating,
                                username,
                            };
                            reviews_by_game.entry(rev.game).or_default().push(mapped);
                        }
                    }
                }
            }
        }
    }
    
    let mut time_to_beat_by_game: std::collections::HashMap<u64, IgdbTimeToBeatRaw> = std::collections::HashMap::new();
    if !game_ids.is_empty() {
        let ttb_body = format!(
            "fields game, hastly, normally, completely; where game = ({}); limit 50;",
            game_ids.join(",")
        );
        let resp = match client.post("https://api.igdb.com/v4/game_time_to_beats")
            .header("Client-ID", &client_id)
            .header("Authorization", format!("Bearer {}", token))
            .body(ttb_body)
            .send()
            .await
        {
            Ok(r) => Some(r),
            Err(e) => {
                eprintln!("IGDB game_time_to_beats request error: {}", e);
                None
            }
        };

        if let Some(r) = resp {
            if r.status().is_success() {
                if let Ok(text) = r.text().await {
                    #[derive(Debug, Deserialize)]
                    struct IgdbTimeToBeatRawInner {
                        game: u64,
                        hastly: Option<u64>,
                        normally: Option<u64>,
                        completely: Option<u64>,
                    }
                    if let Ok(raw_ttbs) = serde_json::from_str::<Vec<IgdbTimeToBeatRawInner>>(&text) {
                        for ttb in raw_ttbs {
                            let mapped = IgdbTimeToBeatRaw {
                                hastly: ttb.hastly,
                                normally: ttb.normally,
                                completely: ttb.completely,
                            };
                            time_to_beat_by_game.insert(ttb.game, mapped);
                        }
                    }
                }
            }
        }
    }

    let mut results = Vec::new();
    for game in igdb_games {
        let mut developers = Vec::new();
        let mut publishers = Vec::new();
        if let Some(ref companies) = game.involved_companies {
            for comp in companies {
                if comp.developer {
                    developers.push(comp.company.name.clone());
                }
                if comp.publisher {
                    publishers.push(comp.company.name.clone());
                }
            }
        }
        
        let developer = if developers.is_empty() { None } else { Some(developers.join("; ")) };
        let publisher = if publishers.is_empty() { None } else { Some(publishers.join("; ")) };
        
        let release_date = game.first_release_date.map(format_unix_timestamp);
        
        let genres = game.genres
            .unwrap_or_default()
            .into_iter()
            .map(|g| g.name)
            .collect::<Vec<_>>();
            
        let themes = game.themes
            .map(|list| list.into_iter().map(|item| item.name).collect::<Vec<_>>());
            
        let game_modes = game.game_modes
            .map(|list| list.into_iter().map(|item| item.name).collect::<Vec<_>>());
            
        let player_perspectives = game.player_perspectives
            .map(|list| list.into_iter().map(|item| item.name).collect::<Vec<_>>());
            
        let cover_url = game.cover
            .and_then(|c| c.url)
            .map(|url| {
                let clean = if url.starts_with("//") { format!("https:{}", url) } else { url };
                clean.replace("t_thumb", "t_cover_big")
            });
            
        let mut screenshot_urls = Vec::new();
        if let Some(screenshots) = game.screenshots {
            for scr in screenshots {
                if let Some(ref url) = scr.url {
                    let clean = if url.starts_with("//") { format!("https:{}", url) } else { url.clone() };
                    screenshot_urls.push(clean.replace("t_thumb", "t_720p"));
                }
            }
        }
        
        let mut artwork_urls = Vec::new();
        if let Some(artworks) = game.artworks {
            for art in artworks {
                if let Some(ref url) = art.url {
                    let clean = if url.starts_with("//") { format!("https:{}", url) } else { url.clone() };
                    artwork_urls.push(clean.replace("t_thumb", "t_720p"));
                }
            }
        }
        
        let hero = artwork_urls.first()
            .or_else(|| screenshot_urls.first())
            .cloned();
            
        let banner = screenshot_urls.first()
            .or_else(|| artwork_urls.first())
            .cloned();
            
        let images = GameImages {
            icon: None,
            cover: cover_url,
            hero,
            banner,
            logo: None,
        };
        
        let videos = game.videos
            .map(|list| {
                list.into_iter()
                    .filter_map(|v| v.video_id.map(|id| format!("https://www.youtube.com/watch?v={}", id)))
                    .collect::<Vec<_>>()
            });
            
        let websites = game.websites
            .map(|list| {
                let mut unique_urls = Vec::new();
                let mut seen = std::collections::HashSet::new();
                for w in list {
                    if let Some(url) = w.url {
                        if seen.insert(url.clone()) {
                            unique_urls.push(url);
                        }
                    }
                }
                unique_urls
            });

        // Map Time to Beat
        let time_to_beat = time_to_beat_by_game.get(&game.id).map(|t| TimeToBeat {
            hastly: t.hastly,
            normally: t.normally,
            completely: t.completely,
        });

        // Map Similar Games
        let similar_games = game.similar_games.map(|list| {
            list.into_iter()
                .map(|g| {
                    let cover_url = g.cover.and_then(|c| c.url).map(|url| {
                        let clean = if url.starts_with("//") { format!("https:{}", url) } else { url };
                        clean.replace("t_thumb", "t_cover_big")
                    });
                    SimilarGame {
                        id: g.id,
                        name: g.name,
                        cover_url,
                    }
                })
                .collect::<Vec<_>>()
        });

        // Map Releases
        let releases = game.release_dates.map(|list| {
            list.into_iter()
                .map(|r| {
                    let platform = r.platform.map(|p| p.name).unwrap_or_else(|| "Unknown".to_string());
                    let date_str = r.human.unwrap_or_else(|| "Unknown".to_string());
                    let region = match r.region {
                        Some(1) => "Europe",
                        Some(2) => "North America",
                        Some(3) => "Australia",
                        Some(4) => "New Zealand",
                        Some(5) => "Japan",
                        Some(6) => "China",
                        Some(7) => "Asia",
                        Some(8) => "Worldwide",
                        Some(9) => "Korea",
                        Some(10) => "Brazil",
                        _ => "Global",
                    }.to_string();
                    ReleaseDateInfo {
                        platform,
                        date_str,
                        region,
                    }
                })
                .collect::<Vec<_>>()
        });

        let igdb_reviews = reviews_by_game.get(&game.id).cloned();
            
        results.push(GameMetadataResult {
            title: game.name,
            description: game.summary,
            developer,
            publisher,
            release_date,
            genres,
            images,
            source_url: format!("https://www.igdb.com/games/{}", game.slug),
            source_name: "IGDB".to_string(),
            storyline: game.storyline,
            igdb_rating: game.rating,
            critic_rating: game.aggregated_rating,
            themes,
            game_modes,
            player_perspectives,
            screenshots: if screenshot_urls.is_empty() { None } else { Some(screenshot_urls) },
            videos,
            websites,
            time_to_beat,
            similar_games,
            releases,
            igdb_reviews,
        });
    }
    
    results
}

// ─── Store: Browse & Search IGDB Catalog ──────────────────────────────────────

/// Fetch a page of store games by category from IGDB.
///
/// Categories:
/// - "trending"  → sorted by hypes descending (recent buzz)
/// - "popular"   → sorted by total_rating_count descending (most rated)
/// - "top"       → sorted by rating descending (highest rated)
/// - "all"        → sorted by total_rating_count (browse everything)
pub async fn fetch_store_games(
    category: &str,
    offset: u32,
    limit: u32,
) -> Result<Vec<StoreGameSummary>, String> {
    let token = get_twitch_token().await?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    load_env_file();
    let client_id = std::env::var("TWITCH_CLIENT_ID").unwrap_or_default();

    let (sort_clause, where_clause) = match category {
        "trending" => ("sort hypes desc;", "where hypes > 0 & total_rating_count > 5;"),
        "popular" => ("sort total_rating_count desc;", "where total_rating_count > 10;"),
        "top" => ("sort rating desc;", "where rating >= 70 & total_rating_count > 20;"),
        _ => ("sort total_rating_count desc;", "where total_rating_count > 0;"),
    };

    let body = format!(
        "fields name,slug,summary,first_release_date,rating,aggregated_rating,cover.url,genres.name,platforms.name,total_rating_count,hypes,follows; {} {} limit {}; offset {};",
        where_clause, sort_clause, limit.min(50), offset
    );

    let resp = client
        .post("https://api.igdb.com/v4/games")
        .header("Client-ID", &client_id)
        .header("Authorization", format!("Bearer {}", token))
        .body(body)
        .send()
        .await
        .map_err(|e| format!("IGDB store request failed: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        return Err(format!("IGDB store request failed with status {}: {}", status, err_text));
    }

    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read IGDB response: {}", e))?;

    let games: Vec<IgdbGameSummary> =
        serde_json::from_str(&text).map_err(|e| format!("IGDB parse error: {}", e))?;

    let summaries: Vec<StoreGameSummary> = games
        .into_iter()
        .map(|g| {
            let cover_url = g.cover.and_then(|c| c.url).map(|url| {
                let clean = if url.starts_with("//") {
                    format!("https:{}", url)
                } else {
                    url
                };
                clean.replace("t_thumb", "t_cover_big")
            });

            let release_date = g.first_release_date.map(format_unix_timestamp);

            StoreGameSummary {
                id: g.id,
                name: g.name,
                slug: g.slug,
                summary: g.summary,
                rating: g.rating,
                aggregated_rating: g.aggregated_rating,
                cover_url,
                genres: g
                    .genres
                    .unwrap_or_default()
                    .into_iter()
                    .map(|gen| gen.name)
                    .collect(),
                platforms: g
                    .platforms
                    .unwrap_or_default()
                    .into_iter()
                    .map(|p| p.name)
                    .collect(),
                first_release_date: release_date,
                total_rating_count: g.total_rating_count.unwrap_or(0),
                hypes: g.hypes.unwrap_or(0),
            }
        })
        .collect();

    Ok(summaries)
}

/// Search IGDB games by name (live search with debounce expected from frontend).
pub async fn search_store_games(
    query: &str,
    offset: u32,
    limit: u32,
) -> Result<Vec<StoreGameSummary>, String> {
    let token = get_twitch_token().await?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    load_env_file();
    let client_id = std::env::var("TWITCH_CLIENT_ID").unwrap_or_default();

    let escaped = query.replace('"', "\\\"");
    let body = format!(
        r#"search "{}"; fields name,slug,summary,first_release_date,rating,aggregated_rating,cover.url,genres.name,platforms.name,total_rating_count,hypes; limit {}; offset {};"#,
        escaped,
        limit.min(50),
        offset
    );

    let resp = client
        .post("https://api.igdb.com/v4/games")
        .header("Client-ID", &client_id)
        .header("Authorization", format!("Bearer {}", token))
        .body(body)
        .send()
        .await
        .map_err(|e| format!("IGDB search request failed: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        return Err(format!("IGDB search request failed with status {}: {}", status, err_text));
    }

    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read IGDB response: {}", e))?;

    let games: Vec<IgdbGameSummary> =
        serde_json::from_str(&text).map_err(|e| format!("IGDB search parse error: {}", e))?;

    let summaries: Vec<StoreGameSummary> = games
        .into_iter()
        .map(|g| {
            let cover_url = g.cover.and_then(|c| c.url).map(|url| {
                let clean = if url.starts_with("//") {
                    format!("https:{}", url)
                } else {
                    url
                };
                clean.replace("t_thumb", "t_cover_big")
            });

            let release_date = g.first_release_date.map(format_unix_timestamp);

            StoreGameSummary {
                id: g.id,
                name: g.name,
                slug: g.slug,
                summary: g.summary,
                rating: g.rating,
                aggregated_rating: g.aggregated_rating,
                cover_url,
                genres: g
                    .genres
                    .unwrap_or_default()
                    .into_iter()
                    .map(|gen| gen.name)
                    .collect(),
                platforms: g
                    .platforms
                    .unwrap_or_default()
                    .into_iter()
                    .map(|p| p.name)
                    .collect(),
                first_release_date: release_date,
                total_rating_count: g.total_rating_count.unwrap_or(0),
                hypes: g.hypes.unwrap_or(0),
            }
        })
        .collect();

    Ok(summaries)
}

/// Fetch full metadata for a single IGDB game by its slug.
/// Returns the same rich GameMetadataResult used by the library detail page.
pub async fn get_store_game_detail(slug: &str) -> Option<GameMetadataResult> {
    let token = match get_twitch_token().await {
        Ok(t) => t,
        Err(e) => {
            eprintln!("IGDB token error: {}", e);
            return None;
        }
    };

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
    {
        Ok(c) => c,
        Err(_) => return None,
    };

    let escaped_slug = slug.replace('"', "\\\"");
    let body = format!(
        r#"where slug = "{}";
fields name, slug, summary, storyline, first_release_date, rating, aggregated_rating,
       cover.url, screenshots.url, artworks.url, videos.video_id, videos.name,
       genres.name, themes.name, game_modes.name, player_perspectives.name,
       involved_companies.developer, involved_companies.publisher, involved_companies.company.name,
       websites.url, websites.category,
       similar_games.name, similar_games.cover.url,
       release_dates.platform.name, release_dates.human, release_dates.region;
limit 1;"#,
        escaped_slug
    );

    load_env_file();
    let client_id = std::env::var("TWITCH_CLIENT_ID").unwrap_or_default();

    let resp = match client
        .post("https://api.igdb.com/v4/games")
        .header("Client-ID", &client_id)
        .header("Authorization", format!("Bearer {}", token))
        .body(body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("IGDB detail request error: {}", e);
            return None;
        }
    };

    let status = resp.status();
    if !status.is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        eprintln!("IGDB detail request failed with status {}: {}", status, err_text);
        return None;
    }

    let text = match resp.text().await {
        Ok(t) => t,
        Err(e) => {
            eprintln!("Failed to read IGDB detail response: {}", e);
            return None;
        }
    };

    let mut igdb_games: Vec<IgdbGame> = match serde_json::from_str(&text) {
        Ok(games) => games,
        Err(e) => {
            eprintln!("IGDB detail parse error: {}", e);
            return None;
        }
    };

    let game = igdb_games.pop()?;

    // Fetch reviews for this game
    let mut reviews_by_game: std::collections::HashMap<u64, Vec<IgdbReview>> = std::collections::HashMap::new();
    let review_body = format!(
        "fields game, title, content, review, user_rating, rating, user.username; where game = {}; limit 50;",
        game.id
    );
    if let Ok(r) = client
        .post("https://api.igdb.com/v4/reviews")
        .header("Client-ID", &client_id)
        .header("Authorization", format!("Bearer {}", token))
        .body(review_body)
        .send()
        .await
    {
        if r.status().is_success() {
            if let Ok(text) = r.text().await {
                #[derive(Debug, Deserialize)]
                struct IgdbReviewInnerRaw {
                    game: u64,
                    title: Option<String>,
                    content: Option<String>,
                    review: Option<String>,
                    user_rating: Option<u32>,
                    rating: Option<u32>,
                    user: Option<IgdbUserRaw>,
                }
                if let Ok(raw_reviews) = serde_json::from_str::<Vec<IgdbReviewInnerRaw>>(&text) {
                    for rev in raw_reviews {
                        let content_text = rev.content.or(rev.review);
                        let final_rating = rev.rating.or(rev.user_rating);
                        let username = rev.user.and_then(|u| u.username);
                        let mapped = IgdbReview {
                            title: rev.title,
                            content: content_text,
                            rating: final_rating,
                            username,
                        };
                        reviews_by_game.entry(rev.game).or_default().push(mapped);
                    }
                }
            }
        }
    }

    // Fetch time-to-beat for this game
    let mut time_to_beat: Option<IgdbTimeToBeatRaw> = None;
    let ttb_body = format!(
        "fields game, hastly, normally, completely; where game = {}; limit 1;",
        game.id
    );
    if let Ok(r) = client
        .post("https://api.igdb.com/v4/game_time_to_beats")
        .header("Client-ID", &client_id)
        .header("Authorization", format!("Bearer {}", token))
        .body(ttb_body)
        .send()
        .await
    {
        if r.status().is_success() {
            if let Ok(text) = r.text().await {
                #[derive(Debug, Deserialize)]
                #[allow(dead_code)]
                struct IgdbTimeToBeatRawInner {
                    game: u64,
                    hastly: Option<u64>,
                    normally: Option<u64>,
                    completely: Option<u64>,
                }
                if let Ok(raw_ttbs) =
                    serde_json::from_str::<Vec<IgdbTimeToBeatRawInner>>(&text)
                {
                    if let Some(first) = raw_ttbs.into_iter().next() {
                        time_to_beat = Some(IgdbTimeToBeatRaw {
                            hastly: first.hastly,
                            normally: first.normally,
                            completely: first.completely,
                        });
                    }
                }
            }
        }
    }

    // Map the IgdbGame → GameMetadataResult
    let mut developers = Vec::new();
    let mut publishers = Vec::new();
    if let Some(ref companies) = game.involved_companies {
        for comp in companies {
            if comp.developer {
                developers.push(comp.company.name.clone());
            }
            if comp.publisher {
                publishers.push(comp.company.name.clone());
            }
        }
    }

    let developer = if developers.is_empty() {
        None
    } else {
        Some(developers.join("; "))
    };
    let publisher = if publishers.is_empty() {
        None
    } else {
        Some(publishers.join("; "))
    };

    let release_date = game.first_release_date.map(format_unix_timestamp);

    let genres: Vec<String> = game
        .genres
        .unwrap_or_default()
        .into_iter()
        .map(|g| g.name)
        .collect();

    let themes = game
        .themes
        .map(|list| list.into_iter().map(|item| item.name).collect::<Vec<_>>());

    let game_modes = game
        .game_modes
        .map(|list| list.into_iter().map(|item| item.name).collect::<Vec<_>>());

    let player_perspectives = game
        .player_perspectives
        .map(|list| list.into_iter().map(|item| item.name).collect::<Vec<_>>());

    let cover_url = game.cover.and_then(|c| c.url).map(|url| {
        let clean = if url.starts_with("//") {
            format!("https:{}", url)
        } else {
            url
        };
        clean.replace("t_thumb", "t_cover_big")
    });

    let mut screenshot_urls = Vec::new();
    if let Some(screenshots) = game.screenshots {
        for scr in screenshots {
            if let Some(ref url) = scr.url {
                let clean = if url.starts_with("//") {
                    format!("https:{}", url)
                } else {
                    url.clone()
                };
                screenshot_urls.push(clean.replace("t_thumb", "t_720p"));
            }
        }
    }

    let mut artwork_urls = Vec::new();
    if let Some(artworks) = game.artworks {
        for art in artworks {
            if let Some(ref url) = art.url {
                let clean = if url.starts_with("//") {
                    format!("https:{}", url)
                } else {
                    url.clone()
                };
                artwork_urls.push(clean.replace("t_thumb", "t_720p"));
            }
        }
    }

    let hero = artwork_urls
        .first()
        .or_else(|| screenshot_urls.first())
        .cloned();

    let banner = screenshot_urls
        .first()
        .or_else(|| artwork_urls.first())
        .cloned();

    let images = GameImages {
        icon: None,
        cover: cover_url,
        hero,
        banner,
        logo: None,
    };

    let videos = game.videos.map(|list| {
        list.into_iter()
            .filter_map(|v| {
                v.video_id
                    .map(|id| format!("https://www.youtube.com/watch?v={}", id))
            })
            .collect::<Vec<_>>()
    });

    let websites = game.websites.map(|list| {
        let mut unique_urls = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for w in list {
            if let Some(url) = w.url {
                if seen.insert(url.clone()) {
                    unique_urls.push(url);
                }
            }
        }
        unique_urls
    });

    let mapped_time_to_beat = time_to_beat.map(|t| TimeToBeat {
        hastly: t.hastly,
        normally: t.normally,
        completely: t.completely,
    });

    let similar_games = game.similar_games.map(|list| {
        list.into_iter()
            .map(|g| {
                let cover_url = g.cover.and_then(|c| c.url).map(|url| {
                    let clean = if url.starts_with("//") {
                        format!("https:{}", url)
                    } else {
                        url
                    };
                    clean.replace("t_thumb", "t_cover_big")
                });
                SimilarGame {
                    id: g.id,
                    name: g.name,
                    cover_url,
                }
            })
            .collect::<Vec<_>>()
    });

    let releases = game.release_dates.map(|list| {
        list.into_iter()
            .map(|r| {
                let platform = r
                    .platform
                    .map(|p| p.name)
                    .unwrap_or_else(|| "Unknown".to_string());
                let date_str = r
                    .human
                    .unwrap_or_else(|| "Unknown".to_string());
                let region = match r.region {
                    Some(1) => "Europe",
                    Some(2) => "North America",
                    Some(3) => "Australia",
                    Some(4) => "New Zealand",
                    Some(5) => "Japan",
                    Some(6) => "China",
                    Some(7) => "Asia",
                    Some(8) => "Worldwide",
                    Some(9) => "Korea",
                    Some(10) => "Brazil",
                    _ => "Global",
                }
                .to_string();
                ReleaseDateInfo {
                    platform,
                    date_str,
                    region,
                }
            })
            .collect::<Vec<_>>()
    });

    let igdb_reviews = reviews_by_game.get(&game.id).cloned();

    Some(GameMetadataResult {
        title: game.name,
        description: game.summary,
        developer,
        publisher,
        release_date,
        genres,
        images,
        source_url: format!("https://www.igdb.com/games/{}", game.slug),
        source_name: "IGDB".to_string(),
        storyline: game.storyline,
        igdb_rating: game.rating,
        critic_rating: game.aggregated_rating,
        themes,
        game_modes,
        player_perspectives,
        screenshots: if screenshot_urls.is_empty() {
            None
        } else {
            Some(screenshot_urls)
        },
        videos,
        websites,
        time_to_beat: mapped_time_to_beat,
        similar_games,
        releases,
        igdb_reviews,
    })
}

// ─── Utility Functions ────────────────────────────────────────────────────────

/// Simple URL encoding (only safe chars pass through).
fn url_encode(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                result.push(byte as char);
            }
            b' ' => result.push_str("%20"),
            _ => {
                result.push_str(&format!("%{:02X}", byte));
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_url_encode_spaces() {
        assert_eq!(url_encode("hello world"), "hello%20world");
    }

    #[test]
    fn test_url_encode_special_chars() {
        let encoded = url_encode("AC/DC: Back in Black");
        assert!(!encoded.contains(' '));
        assert!(encoded.contains("%2F"));
    }

    #[test]
    fn test_base64_roundtrip() {
        let input = b"Hello, World!";
        let encoded = base64_encode(input);
        // Decode manually to verify
        assert_eq!(encoded, "SGVsbG8sIFdvcmxkIQ==");
    }

    #[tokio::test]
    async fn test_search_igdb() {
        let results = search_igdb("Portal 2").await;
        println!("IGDB results count: {}", results.len());
        assert!(!results.is_empty());
    }
}
