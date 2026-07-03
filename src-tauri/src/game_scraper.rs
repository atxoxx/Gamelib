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

    // Search Steam and LaunchBox in parallel
    let (steam_result, launchbox_result) = tokio::join!(
        search_steam(game_name),
        search_launchbox(game_name)
    );

    if let Some(r) = steam_result {
        results.push(r);
    }

    if let Some(r) = launchbox_result {
        results.push(r);
    }

    // FUTURE: Add IGDB, PCGamingWiki, and other sources here.

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

// ─── Source: IGDB (Web Scraping) ──────────────────────────────────────────────

/// Search IGDB via their public search page and attempt to extract metadata.
/// NOTE: IGDB is JavaScript-heavy. This HTTP-only scraper may fail to extract
/// meaningful data. For full IGDB support, enable Spider's `chrome` feature
/// for headless browser rendering, or use IGDB's Twitch API directly.
#[allow(unused)]
async fn search_igdb_web(game_name: &str) -> Option<GameMetadataResult> {
    let search_url = format!(
        "https://www.igdb.com/search?type=1&q={}",
        url_encode(game_name)
    );

    // Use Spider to scrape the IGDB search results page
    let html = spider_fetch_page(&search_url).await.ok()?;
    let document = scraper::Html::parse_document(&html);

    // Try to extract search results — IGDB uses dynamic rendering,
    // so this may need a headless browser. For now, attempt basic extraction.
    let link_selector =
        scraper::Selector::parse("a[href*='/games/']").ok()?;
    let title_selector = scraper::Selector::parse("h3, .game-title").ok()?;

    // Find the first game link
    let first_link = document.select(&link_selector).next()?;
    let game_path = first_link.value().attr("href")?;

    // Try to get the title from the search result
    let title = first_link
        .text()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();

    if title.is_empty() {
        return None;
    }

    // Construct the full game page URL and scrape it
    let game_url = if game_path.starts_with("http") {
        game_path.to_string()
    } else {
        format!("https://www.igdb.com{}", game_path)
    };

    // Use Spider to extract metadata from the game page
    let mut selectors = HashMap::new();
    selectors.insert(
        "description".to_string(),
        ".game-description, [data-testid='description']".to_string(),
    );
    selectors.insert(
        "developer".to_string(),
        ".game-developer a, [data-testid='developer']".to_string(),
    );
    selectors.insert(
        "publisher".to_string(),
        ".game-publisher a, [data-testid='publisher']".to_string(),
    );
    selectors.insert(
        "release_date".to_string(),
        ".game-release-date, [data-testid='release-date']".to_string(),
    );

    let extracted = spider_extract(&game_url, &selectors).await.ok()?;

    // Build the result from extracted data
    let description = extracted
        .get("description")
        .and_then(|v| v.first().cloned());
    let developer = extracted
        .get("developer")
        .and_then(|v| v.first().cloned());
    let publisher = extracted
        .get("publisher")
        .and_then(|v| v.first().cloned());
    let release_date = extracted
        .get("release_date")
        .and_then(|v| v.first().cloned());

    // IGDB images are harder to extract; leave empty for now
    let images = GameImages {
        icon: None,
        cover: None,
        hero: None,
        banner: None,
        logo: None,
    };

    Some(GameMetadataResult {
        title: title.trim().to_string(),
        description,
        developer,
        publisher,
        release_date,
        genres: Vec::new(),
        images,
        source_url: game_url,
        source_name: "IGDB".to_string(),
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
}
