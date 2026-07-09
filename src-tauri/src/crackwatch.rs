//! CrackWatch status scraper for crackrelease.com.
//!
//! Fetches crack status, crack date, DRM protection, and scene group
//! information by scraping the game's page on crackrelease.com. The
//! game name is slugified and appended to the base URL.
//!
//! Returns `CrackWatchStatus` with `None` fields when the page can't
//! be fetched or parsed — the frontend renders nothing in that case.

use serde::{Deserialize, Serialize};
use scraper;

/// Parsed CrackWatch status from crackrelease.com.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CrackWatchStatus {
    /// "cracked" | "uncracked" | null — null when the page wasn't found or couldn't be parsed.
    pub status: Option<String>,
    /// Human-readable status label (e.g. "CRACKED", "UNCRACKED").
    pub status_label: Option<String>,
    /// e.g. "0 DAYS AND COUNTING" or "X DAYS AFTER RELEASE".
    pub counter: Option<String>,
    /// Human-readable release date.
    pub release_date: Option<String>,
    /// Crack date (e.g. "Jul 9, 2026" or "TBD"). "TBD" when not yet cracked.
    pub crack_date: Option<String>,
    /// DRM protection (e.g. "Denuvo", "Steam", "Arxan").
    pub drm_protection: Option<String>,
    /// Scene group name (e.g. "CODEX", "CPY", "EMPRESS" or "TBD").
    pub scene_group: Option<String>,
    /// URL of the crackrelease page.
    pub page_url: Option<String>,
}

/// Convert a game name into a URL-friendly slug matching crackrelease.com's patterns.
fn slugify(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

/// Extract text from a `.cw-meta-item` whose key (`.k`) matches the given label.
fn cw_meta_value(doc: &scraper::Html, label: &str) -> Option<String> {
    let item_sel = scraper::Selector::parse(".cw-meta-item").ok()?;
    let k_sel = scraper::Selector::parse(".k").ok()?;
    let v_sel = scraper::Selector::parse(".v").ok()?;
    for item in doc.select(&item_sel) {
        let key_text: String = item
            .select(&k_sel)
            .flat_map(|el| el.text())
            .collect();
        if key_text.trim().eq_ignore_ascii_case(label) {
            let val: String = item
                .select(&v_sel)
                .flat_map(|el| el.text())
                .collect();
            let trimmed = val.trim().to_string();
            if !trimmed.is_empty() {
                return Some(trimmed);
            }
        }
    }
    None
}

/// Returns a status filled with all None values — used for early returns.
fn empty_status() -> CrackWatchStatus {
    CrackWatchStatus {
        status: None,
        status_label: None,
        counter: None,
        release_date: None,
        crack_date: None,
        drm_protection: None,
        scene_group: None,
        page_url: None,
    }
}

/// Fetch CrackWatch status for a game from crackrelease.com.
///
/// The game name is slugified and appended to the base URL
/// (`https://crackrelease.com/{slug}/`). Uses a dedicated HTTP client
/// with a 15-second timeout so the UI isn't blocked on slow responses.
#[tauri::command]
pub async fn fetch_crackwatch_status(game_name: String) -> CrackWatchStatus {
    let slug = slugify(&game_name);
    if slug.is_empty() {
        return empty_status();
    }
    let page_url = format!("https://crackrelease.com/{}/", slug);

    // Use reqwest directly with a reasonable timeout so we don't
    // block the UI while the page loads. The shared `http_client()`
    // from `game_scraper` is not public, so we create a one-shot
    // client here. The overhead is negligible for this infrequent,
    // user-driven fetch (not a bulk sync).
    let client = match reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; GameLib/1.0)")
        .timeout(std::time::Duration::from_secs(15))
        .build()
    {
        Ok(c) => c,
        Err(_) => return empty_status(),
    };

    let resp = match client.get(&page_url).send().await {
        Ok(r) => r,
        Err(_) => return empty_status(),
    };

    if !resp.status().is_success() {
        return empty_status();
    }

    let html = match resp.text().await {
        Ok(h) => h,
        Err(_) => return empty_status(),
    };

    let doc = scraper::Html::parse_document(&html);

    // Find the .cw-panel element
    let panel_sel = match scraper::Selector::parse(".cw-panel") {
        Ok(s) => s,
        Err(_) => return empty_status(),
    };
    let panel = match doc.select(&panel_sel).next() {
        Some(p) => p,
        None => return empty_status(),
    };

    // Determine status from panel class (cracked vs uncracked)
    let class_list: Vec<&str> = panel.value().classes().collect();
    let is_cracked = class_list.iter().any(|c| *c == "cracked");
    let is_uncracked = class_list.iter().any(|c| *c == "uncracked");

    let (status, default_label) = if is_cracked {
        (Some("cracked".to_string()), Some("CRACKED".to_string()))
    } else if is_uncracked {
        (Some("uncracked".to_string()), Some("UNCRACKED".to_string()))
    } else {
        (None, None)
    };

    // Parse title
    let title_sel = scraper::Selector::parse(".cw-panel__title").ok();
    let status_label = title_sel
        .and_then(|sel| doc.select(&sel).next())
        .map(|el| el.text().collect::<Vec<_>>().join("").trim().to_string())
        .or(default_label);

    // Parse counter
    let counter_sel = scraper::Selector::parse(".cw-panel__counter").ok();
    let counter = counter_sel
        .and_then(|sel| doc.select(&sel).next())
        .map(|el| el.text().collect::<Vec<_>>().join("").trim().to_string());

    // Parse meta grid items
    let release_date = cw_meta_value(&doc, "RELEASE DATE");
    let crack_date = cw_meta_value(&doc, "CRACK DATE");
    let drm_protection = cw_meta_value(&doc, "DRM PROTECTION");
    let scene_group = cw_meta_value(&doc, "SCENE GROUP");

    CrackWatchStatus {
        status,
        status_label,
        counter,
        release_date,
        crack_date,
        drm_protection,
        scene_group,
        page_url: Some(page_url),
    }
}
