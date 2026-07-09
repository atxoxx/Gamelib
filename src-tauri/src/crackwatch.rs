//! CrackWatch status scraper for gamestatus.info.
//!
//! Fetches crack status, crack date, DRM protection, and scene group
//! information by scraping gamestatus.info game pages. The site is a
//! Nuxt.js SPA with SSR, so game data is embedded in a
//! `<script id="__NUXT_DATA__" type="application/json">` payload.
//!
//! Returns `CrackWatchStatus` with `None` fields when the page can't
//! be fetched, parsed, or doesn't contain game data — the frontend
//! renders nothing in that case.

use std::collections::HashSet;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Parsed CrackWatch status from gamestatus.info.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CrackWatchStatus {
    /// "cracked" | "uncracked" | null — null when the page wasn't found or couldn't be parsed.
    pub status: Option<String>,
    /// Human-readable status label (e.g. "Cracked on release day", "Cracked after 19 days").
    pub status_label: Option<String>,
    /// Not provided by gamestatus.info — always None.
    pub counter: Option<String>,
    /// Release date (YYYY-MM-DD).
    pub release_date: Option<String>,
    /// Crack date (YYYY-MM-DD) or null when uncracked.
    pub crack_date: Option<String>,
    /// DRM protection (e.g. "Denuvo", "STEAM").
    pub drm_protection: Option<String>,
    /// Scene group or bypass method (English).
    pub scene_group: Option<String>,
    /// URL of the gamestatus.info page.
    pub page_url: Option<String>,
}

/// Convert a game name into a URL-friendly slug.
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

/// Resolve a Nuxt payload value (public entry point).
fn resolve_nuxt_ref(val: &Value, arr: &[Value]) -> Value {
    resolve_nuxt_ref_inner(val, arr, &mut HashSet::new())
}

/// Resolve a Nuxt payload value with cycle detection.
///
/// Nuxt's `__NUXT_DATA__` uses a deduplication scheme where numeric
/// values in objects/arrays are indices into the top-level array.
/// This function recursively resolves those references into their
/// actual values, tracking visited indices to prevent infinite loops
/// from circular references.
///
/// Nuxt also wraps data in marker arrays:
/// - `["ShallowReactive", idx]` / `["Reactive", idx]` — follow idx
/// - `["Set"]` — empty set, return empty array
/// - `["EmptyRef", "_"]` — null ref, return null
fn resolve_nuxt_ref_inner(val: &Value, arr: &[Value], visited: &mut HashSet<usize>) -> Value {
    match val {
        Value::Number(n) => {
            if let Some(idx) = n.as_u64() {
                let i = idx as usize;
                if i < arr.len() && visited.insert(i) {
                    return resolve_nuxt_ref_inner(&arr[i], arr, visited);
                }
            }
            val.clone()
        }
        Value::Object(map) => {
            let mut resolved = serde_json::Map::new();
            for (k, v) in map {
                resolved.insert(k.clone(), resolve_nuxt_ref_inner(v, arr, visited));
            }
            Value::Object(resolved)
        }
        Value::Array(items) => {
            // Handle Nuxt wrapper arrays like ["ShallowReactive", idx]
            if let Some(first) = items.first().and_then(|v| v.as_str()) {
                match first {
                    "ShallowReactive" | "Reactive" => {
                        if let Some(second) = items.get(1) {
                            return resolve_nuxt_ref_inner(second, arr, visited);
                        }
                    }
                    "Set" => {
                        return Value::Array(vec![]);
                    }
                    "EmptyRef" => {
                        return Value::Null;
                    }
                    _ => {}
                }
            }
            Value::Array(items.iter().map(|v| resolve_nuxt_ref_inner(v, arr, visited)).collect())
        }
        _ => val.clone(),
    }
}

/// Extract a string field from a resolved game data object.
fn get_str(obj: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    obj.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}

/// Fetch CrackWatch status for a game from gamestatus.info.
///
/// The game name is slugified and used to construct the URL
/// (`https://gamestatus.info/{slug}/en`). The page's `__NUXT_DATA__`
/// JSON payload is extracted and parsed to retrieve crack status,
/// DRM, scene group, and dates.
#[tauri::command]
pub async fn fetch_crackwatch_status(game_name: String) -> CrackWatchStatus {
    let slug = slugify(&game_name);
    if slug.is_empty() {
        return empty_status();
    }
    let page_url = format!("https://gamestatus.info/{}/en", slug);

    let client = match reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
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

    // Extract the __NUXT_DATA__ JSON payload
    let json_str = match extract_nuxt_data(&html) {
        Some(s) => s,
        None => return empty_status(),
    };

    // Parse the Nuxt payload array
    let arr: Vec<Value> = match serde_json::from_str(&json_str) {
        Ok(a) => a,
        Err(_) => return empty_status(),
    };

    if arr.len() < 2 {
        return empty_status();
    }

    // arr[1] is the main payload object with a "data" key
    let payload = match arr[1].as_object() {
        Some(obj) => obj,
        None => return empty_status(),
    };

    let data_ref = match payload.get("data") {
        Some(v) => v,
        None => return empty_status(),
    };

    let data_obj = resolve_nuxt_ref(data_ref, &arr);
    let data_map = match data_obj.as_object() {
        Some(m) => m,
        None => return empty_status(),
    };

    // Find the first key matching "game-*-en"
    let game_key = data_map.keys().find(|k| k.starts_with("game-") && k.ends_with("-en"));
    let game_val = match game_key.and_then(|k| data_map.get(k)) {
        Some(v) => v,
        None => return empty_status(),
    };

    let game_obj = resolve_nuxt_ref(game_val, &arr);
    let game = match game_obj.as_object() {
        Some(m) => m,
        None => return empty_status(),
    };

    // Extract fields
    let release_date = get_str(game, "release_date");
    let crack_date = get_str(game, "crack_date");
    let protections = get_str(game, "protections");
    let readable_status = get_str(game, "readable_status");
    let scene_group = get_str(game, "hacked_groups_en");

    // Translate Russian readable_status to English
    let status_label = translate_status(readable_status);

    // Determine status: cracked if crack_date is present
    let status = crack_date.as_ref().map(|_| "cracked".to_string());

    CrackWatchStatus {
        status,
        status_label,
        counter: None,
        release_date,
        crack_date,
        drm_protection: protections,
        scene_group,
        page_url: Some(page_url),
    }
}

/// Translate Russian "readable_status" strings to English.
///
/// gamestatus.info stores status labels in Russian (e.g. "Взломана в день релиза").
/// This function maps known patterns to English equivalents so the frontend
/// always displays readable labels.
fn translate_status(ru: Option<String>) -> Option<String> {
    let s = ru?;
    // "Взломана в день релиза" → "Cracked on release day"
    if s.contains("в день релиза") || s.contains("В день релиза") {
        return Some("Cracked on release day".to_string());
    }
    // "Взломана через X дн" → "Cracked after X day(s)"
    if let Some(rest) = s.strip_prefix("Взломана через ") {
        let days: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        if !days.is_empty() {
            let n: u32 = days.parse().unwrap_or(0);
            let label = if n == 1 {
                "Cracked after 1 day".to_string()
            } else {
                format!("Cracked after {} days", n)
            };
            return Some(label);
        }
    }
    // Fallback: return the original Russian text as-is
    Some(s)
}

/// Extract the content of `<script id="__NUXT_DATA__" type="application/json">`.
fn extract_nuxt_data(html: &str) -> Option<String> {
    let start_marker = "id=\"__NUXT_DATA__\"";
    let start = html.find(start_marker)?;
    // Find the closing `>` of the script tag after the id attribute
    let tag_end = html[start..].find('>')?;
    let content_start = start + tag_end + 1;

    let end = html[content_start..].find("</script>")?;
    Some(html[content_start..content_start + end].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_cyberpunk_2077_crackwatch() {
        let slug = slugify("Cyberpunk 2077");
        let page_url = format!("https://gamestatus.info/{}/en", slug);
        println!("\n=== Gamestatus.info diagnostics for Cyberpunk 2077 ===");
        println!("Slug:       {}", slug);
        println!("URL:        {}", page_url);

        // Raw HTTP check
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .unwrap();

        match client.get(&page_url).send().await {
            Ok(resp) => {
                println!("HTTP:       {}", resp.status());
                if resp.status().is_success() {
                    let html = resp.text().await.unwrap_or_default();
                    let has_data = html.contains("__NUXT_DATA__");
                    println!("HTML len:   {} chars", html.len());
                    println!("Has NUXT:   {}", has_data);
                }
            }
            Err(e) => println!("HTTP error: {}", e),
        }

        // Full scraper result
        let result = fetch_crackwatch_status("Cyberpunk 2077".into()).await;
        println!("--- Scraper result ---");
        println!("Page URL:   {:?}", result.page_url);
        println!("Status:     {:?}", result.status);
        println!("Label:      {:?}", result.status_label);
        println!("Release:    {:?}", result.release_date);
        println!("Crack Date: {:?}", result.crack_date);
        println!("DRM:        {:?}", result.drm_protection);
        println!("Scene:      {:?}", result.scene_group);
        println!("============================================\n");

        assert!(result.status.is_some(), "Expected a crack status for Cyberpunk 2077");
    }
}
