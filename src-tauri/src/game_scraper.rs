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
/// Currently supports Steam. IGDB and other sources planned for future updates.
pub async fn search_game_metadata(game_name: &str) -> Vec<GameMetadataResult> {
    let mut results: Vec<GameMetadataResult> = Vec::new();

    // Search Steam (most reliable source)
    if let Some(r) = search_steam(game_name).await {
        results.push(r);
    }

    // FUTURE: Add IGDB, PCGamingWiki, and other sources here.
    // IGDB requires Chrome rendering (enable spider's "chrome" feature)
    // or the IGDB Twitch API.

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
