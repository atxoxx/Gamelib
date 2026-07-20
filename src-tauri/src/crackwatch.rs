//! CrackWatch status service for gamestatus.info.
//!
//! Fetches crack status, crack date, DRM protection, and scene group
//! information by scraping gamestatus.info game pages. The site is a
//! Nuxt.js SPA with SSR, so game data is embedded in a
//! `<script id="__NUXT_DATA__" type="application/json">` payload.
//!
//! The service mirrors Hydra's `CrackWatchService` (commit 0954a5b):
//! - A dedicated `CrackWatchService` struct owns the HTTP client.
//! - `get_status_by_title_and_app_id(title, app_id)` is the entry point.
//! - Results are cached in the SQLite KV store with a 24h TTL, keyed by
//!   slug (+ app id when available), so the same game isn't re-scraped
//!   on every render.
//! - The returned `CrackWatchStatus` uses an `is_cracked` boolean rather
//!   than a string status, matching the frontend contract.

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::db::Db;
use tauri::Manager;

/// Parsed CrackWatch status from gamestatus.info.
///
/// Mirrors Hydra's `CrackWatchStatus` type (commit 0954a5b): an
/// `is_cracked` boolean plus the supporting detail fields. `null` detail
/// fields mean "unknown" (the field simply isn't shown on the card).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CrackWatchStatus {
    /// Whether the game has been cracked. Drives the CRACKED/UNCRACKED badge.
    pub is_cracked: bool,
    /// Crack date (YYYY-MM-DD) or null when uncracked / unknown.
    pub crack_date: Option<String>,
    /// Scene group or bypass method (e.g. "RUNE", "EMPRESS") or null.
    pub crack_group: Option<String>,
    /// DRM protection (e.g. "Denuvo", "STEAM") or null.
    pub protection: Option<String>,
}

/// Cache envelope stored in the KV store: the status plus a freshness stamp.
#[derive(Debug, Serialize, Deserialize, Clone)]
struct CachedCrackWatchStatus {
    #[serde(flatten)]
    status: CrackWatchStatus,
    /// Unix-millisecond timestamp of the cache write. Used for TTL checks.
    updated_at: u64,
}

/// 24-hour cache TTL, mirroring Hydra's `LOCAL_CACHE_EXPIRATION`.
const CACHE_TTL_MS: u64 = 1000 * 60 * 60 * 24;

/// KV key prefix for cached CrackWatch status.
const CACHE_KEY_PREFIX: &str = "crackwatch:";

fn cache_key(slug: &str, app_id: Option<&str>) -> String {
    match app_id {
        Some(id) => format!("{}{}:{}", CACHE_KEY_PREFIX, slug, id),
        None => format!("{}{}", CACHE_KEY_PREFIX, slug),
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Convert a game name into a URL-friendly slug matching gamestatus.info's patterns.
///
/// Handles common special cases:
/// - Apostrophes are removed (not replaced with hyphens)
/// - Trademark/copyright symbols are transliterated: ™ → tm, ® → r, © → c
/// - All other non-alphanumeric characters become hyphens
/// - Consecutive hyphens are collapsed
fn slugify(name: &str) -> String {
    let normalized = name
        .to_lowercase()
        .replace('\'', "")
        .replace('\u{2019}', "") // right single quotation mark (smart quote)
        .replace('™', "tm")
        .replace('®', "r")
        .replace('©', "c");

    normalized
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

/// Resolve a Nuxt payload value (public entry point).
fn resolve_nuxt_ref(val: &Value, arr: &[Value]) -> Value {
    resolve_nuxt_ref_inner(val, arr, &mut HashMap::new())
}

/// Resolve a Nuxt payload value with a resolution cache.
///
/// Nuxt's `__NUXT_DATA__` uses a deduplication scheme where numeric
/// values in objects/arrays are indices into the top-level array.
/// This function recursively resolves those references into their
/// actual values.
///
/// Uses a `HashMap<usize, Value>` cache so that:
/// - Shared references (multiple fields pointing to the same index)
///   are resolved once and cached, allowing all fields to receive
///   the resolved value.
/// - Circular references are detected when an index appears in the
///   cache before its value has been fully resolved (a placeholder
///   `Value::Null` is inserted before recursing).
///
/// Nuxt also wraps data in marker arrays:
/// - `["ShallowReactive", idx]` / `["Reactive", idx]` — follow idx
/// - `["Set"]` — empty set, return empty array
/// - `["EmptyRef", "_"]` — null ref, return null
fn resolve_nuxt_ref_inner(val: &Value, arr: &[Value], cache: &mut HashMap<usize, Value>) -> Value {
    match val {
        Value::Number(n) => {
            if let Some(idx) = n.as_u64() {
                let i = idx as usize;
                if i < arr.len() {
                    // Already cached - return clone
                    if let Some(cached) = cache.get(&i) {
                        return cached.clone();
                    }
                    // Insert placeholder before recursing to detect cycles
                    cache.insert(i, Value::Null);
                    let resolved = resolve_nuxt_ref_inner(&arr[i], arr, cache);
                    cache.insert(i, resolved.clone());
                    return resolved;
                }
            }
            val.clone()
        }
        Value::Object(map) => {
            let mut resolved = serde_json::Map::new();
            for (k, v) in map {
                resolved.insert(k.clone(), resolve_nuxt_ref_inner(v, arr, cache));
            }
            Value::Object(resolved)
        }
        Value::Array(items) => {
            // Handle Nuxt wrapper arrays like ["ShallowReactive", idx]
            if let Some(first) = items.first().and_then(|v| v.as_str()) {
                match first {
                    "ShallowReactive" | "Reactive" => {
                        if let Some(second) = items.get(1) {
                            return resolve_nuxt_ref_inner(second, arr, cache);
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
            Value::Array(
                items
                    .iter()
                    .map(|v| resolve_nuxt_ref_inner(v, arr, cache))
                    .collect(),
            )
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

/// Dedicated CrackWatch service, mirroring Hydra's `CrackWatchServiceClass`.
struct CrackWatchServiceClass {
    client: reqwest::Client,
}

impl CrackWatchServiceClass {
    fn new() -> Self {
        // A cookie jar is required: gamestatus.info sits behind the "Anubis"
        // proof-of-work anti-bot gate. Solving the challenge yields a session
        // cookie that must be presented on the follow-up page fetch.
        let jar = std::sync::Arc::new(reqwest::cookie::Jar::default());
        let client = reqwest::Client::builder()
            .user_agent(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            )
            .timeout(std::time::Duration::from_secs(20))
            .cookie_provider(jar)
            .build()
            .expect("failed to build CrackWatch HTTP client");
        Self { client }
    }

    /// Look up crack status for a game by title (and optionally Steam app id).
    ///
    /// Returns `None` when the page can't be fetched/parsed or no entry
    /// matches the title — the caller treats `None` as "no data".
    async fn get_status_by_title_and_app_id(
        &self,
        title: &str,
        _app_id: Option<&str>,
    ) -> Option<CrackWatchStatus> {
        let slug = slugify(title);
        if slug.is_empty() {
            return None;
        }

        let page_url = format!("https://gamestatus.info/{}/en", slug);

        // Fetch the page, transparently solving the Anubis proof-of-work
        // gate if the site presents one. Returns the SSR HTML containing
        // the `__NUXT_DATA__` payload.
        let html = self.fetch_page_html(&page_url).await?;

        let json_str = extract_nuxt_data(&html)?;
        let arr: Vec<Value> = serde_json::from_str(&json_str).ok()?;
        if arr.len() < 2 {
            return None;
        }

        // arr[1] is the main payload object with a "data" key
        let payload = arr[1].as_object()?;
        let data_ref = payload.get("data")?;
        let data_obj = resolve_nuxt_ref(data_ref, &arr);
        let data_map = data_obj.as_object()?;

        // Find the first key matching "game-*-en"
        let game_key = data_map
            .keys()
            .find(|k| k.starts_with("game-") && k.ends_with("-en"));
        let game_val = game_key.and_then(|k| data_map.get(k))?;

        let game_obj = resolve_nuxt_ref(game_val, &arr);
        let game = game_obj.as_object()?;

        // NOTE: gamestatus.info's Nuxt schema encodes `steam_prod_id` only as
        // a column name in the shared schema object, not as a resolvable field
        // on the per-game row, so matching by Steam app id isn't possible with
        // this data shape. Identity is the slug, which the caller already
        // supplies. The `app_id` argument is retained for API compatibility
        // (cache keying) but is not used for filtering here.

        let crack_date = get_str(game, "crack_date");
        let protections = get_str(game, "protections");
        let _readable_status = translate_status(get_str(game, "readable_status"));
        let scene_group = get_str(game, "hacked_groups_en").map(|s| {
            s.split(" — ")
                .next()
                .unwrap_or(&s)
                .trim()
                .to_string()
        });

        let is_cracked = crack_date.is_some();

        Some(CrackWatchStatus {
            is_cracked,
            crack_date,
            crack_group: scene_group,
            protection: protections,
        })
    }

    /// Fetch a gamestatus.info page, transparently solving the "Anubis"
    /// proof-of-work anti-bot gate if it's presented.
    ///
    /// Returns the SSR HTML (which embeds the `__NUXT_DATA__` payload).
    /// Returns `None` on network/parse failure or if the challenge can't
    /// be solved.
    async fn fetch_page_html(&self, page_url: &str) -> Option<String> {
        let resp = self.client.get(page_url).send().await.ok()?;
        let html = resp.text().await.ok()?;

        // Not gated — return the real page directly.
        if !html.contains("anubis_challenge") {
            return Some(html);
        }

        // Gated: solve the PoW, redeem the session cookie, retry.
        let solved = self.solve_anubis(&html, page_url).await?;
        if !solved {
            return None;
        }

        let resp2 = self.client.get(page_url).send().await.ok()?;
        resp2.text().await.ok()
    }

    /// Parse the Anubis challenge embedded in a bot-check page, brute-force
    /// a valid proof-of-work nonce, and submit it to the `pass-challenge`
    /// endpoint (which sets the session cookie in the shared jar).
    ///
    /// Returns `Some(true)` on success, `Some(false)` if the challenge
    /// couldn't be parsed/solved, `None` on submission failure.
    async fn solve_anubis(&self, html: &str, page_url: &str) -> Option<bool> {
        let marker = "id=\"anubis_challenge\" type=\"application/json\">";
        let start = html.find(marker)?;
        let content_start = start + marker.len();
        let end = html[content_start..].find("</script>")?;
        let json = &html[content_start..content_start + end];

        let v: Value = serde_json::from_str(json).ok()?;
        let id = v.get("challenge")?.get("id")?.as_str()?;
        let random_data = v
            .get("challenge")?
            .get("randomData")?
            .as_str()?
            .to_string();
        let difficulty = v.get("rules")?.get("difficulty")?.as_u64()? as usize;

        let (nonce, hash) = solve_pow(&random_data, difficulty)?;

        let pass_url = format!(
            "https://gamestatus.info/.within.website/x/cmd/anubis/api/pass-challenge?id={}&response={}&nonce={}&redir={}&elapsedTime=1234",
            id, hash, nonce, page_url
        );

        let resp = self.client.get(&pass_url).send().await.ok()?;
        // 200 (cookie set, no redirect) or a redirect both count as success.
        Some(resp.status().is_success() || resp.status().is_redirection())
    }
}

/// Solve an Anubis "fast" proof-of-work challenge.
///
/// The worker hashes `random_data + nonce` (as UTF-8 bytes) with SHA-256.
/// The digest is valid when its leading `difficulty / 2` bytes are zero, and
/// — when `difficulty` is odd — the high nibble of the next byte is also zero.
/// `difficulty` is small (typically 2–4), so brute force is trivial.
fn solve_pow(random_data: &str, difficulty: usize) -> Option<(u64, String)> {
    let zero_bytes = difficulty / 2;
    let odd = difficulty % 2 != 0;

    for nonce in 0u64..50_000_000 {
        let input = format!("{}{}", random_data, nonce);
        let digest = Sha256::digest(input.as_bytes());
        let mut ok = digest[..zero_bytes].iter().all(|b| *b == 0);
        if ok && odd && (digest[zero_bytes] & 0xF0) != 0 {
            ok = false;
        }
        if ok {
            let hash = digest.iter().map(|b| format!("{:02x}", b)).collect();
            return Some((nonce, hash));
        }
    }
    None
}

/// Process-wide singleton, mirroring Hydra's `export const CrackWatchService`.
static CRACKWATCH_SERVICE: std::sync::OnceLock<CrackWatchServiceClass> = std::sync::OnceLock::new();

fn service() -> &'static CrackWatchServiceClass {
    CRACKWATCH_SERVICE.get_or_init(CrackWatchServiceClass::new)
}

/// Fetch CrackWatch status for a game from gamestatus.info.
///
/// Mirrors Hydra's `getCrackWatchStatus` event (commit 0954a5b): the
/// status is cached in the KV store keyed by slug (and app id when
/// available) with a 24h TTL, so the same game isn't re-scraped on every
/// page render. A fresh cache hit returns immediately; a miss (or expired
/// entry) triggers a scrape and writes the result back. `None` is returned
/// when the title couldn't be resolved, signalling the frontend to hide
/// the card.
#[tauri::command]
pub async fn fetch_crackwatch_status(
    app: tauri::AppHandle,
    game_name: String,
    app_id: Option<String>,
) -> Option<CrackWatchStatus> {
    let slug = slugify(&game_name);
    if slug.is_empty() {
        return None;
    }

    let app_id_str = app_id.as_deref();
    let key = cache_key(&slug, app_id_str);

    let db_state: tauri::State<'_, Db> = app.state();

    // ── Cache lookup ──────────────────────────────────────────────
    if let Some(raw) = crate::db::kv::get(db_state.inner(), &key).ok().flatten() {
        if let Ok(cached) = serde_json::from_str::<CachedCrackWatchStatus>(&raw) {
            if cached.updated_at + CACHE_TTL_MS > now_ms() {
                return Some(cached.status);
            }
        }
    }

    // ── Cache miss / expired → scrape ────────────────────────────
    let status = service()
        .get_status_by_title_and_app_id(&game_name, app_id_str)
        .await;

    // Persist a real result so subsequent calls hit the cache.
    if let Some(ref s) = status {
        let envelope = CachedCrackWatchStatus {
            status: s.clone(),
            updated_at: now_ms(),
        };
        if let Ok(json) = serde_json::to_string(&envelope) {
            let _ = crate::db::kv::set(db_state.inner(), &key, &json);
        }
    }

    status
}

/// Batch variant of [`fetch_crackwatch_status`]. Accepts a list of game
/// names and returns a `{ name -> status }` map (only entries with a
/// resolved status are included). This exists so a store grid of 20 cards
/// makes a single Tauri round-trip instead of 20 concurrent invokes — the
/// per-card self-fetch pattern was a real rate-limit / connection-pool
/// risk against gamestatus.info's anti-bot gate.
///
/// Cache lookups happen per-name (same 24h TTL and KV keys as the single
/// command), so warm names return instantly. Cold names are scraped
/// sequentially with a small concurrency cap to stay polite.
#[tauri::command]
pub async fn fetch_crackwatch_status_batch(
    app: tauri::AppHandle,
    game_names: Vec<String>,
) -> HashMap<String, CrackWatchStatus> {
    use futures::stream::{self, StreamExt};

    // Cap concurrency so we never fan out 20 PoW-gated scrapes at once.
    const MAX_CONCURRENT: usize = 3;

    let db_state: tauri::State<'_, Db> = app.state();

    // Split into cache hits (resolved synchronously) and cold names.
    let mut resolved: HashMap<String, CrackWatchStatus> = HashMap::new();
    let mut cold: Vec<String> = Vec::new();

    for name in game_names {
        let slug = slugify(&name);
        if slug.is_empty() {
            continue;
        }
        let key = cache_key(&slug, None);
        if let Some(raw) = crate::db::kv::get(db_state.inner(), &key).ok().flatten() {
            if let Ok(cached) = serde_json::from_str::<CachedCrackWatchStatus>(&raw) {
                if cached.updated_at + CACHE_TTL_MS > now_ms() {
                    resolved.insert(name, cached.status);
                    continue;
                }
            }
        }
        cold.push(name);
    }

    // Scrape cold names with bounded concurrency, then persist each result.
    let scraped: Vec<(String, Option<CrackWatchStatus>)> = stream::iter(cold)
        .map(|name| async move {
            let status = service()
                .get_status_by_title_and_app_id(&name, None)
                .await;
            (name, status)
        })
        .buffer_unordered(MAX_CONCURRENT)
        .collect()
        .await;

    for (name, status) in scraped {
        if let Some(s) = status {
            let slug = slugify(&name);
            let key = cache_key(&slug, None);
            let envelope = CachedCrackWatchStatus {
                status: s.clone(),
                updated_at: now_ms(),
            };
            if let Ok(json) = serde_json::to_string(&envelope) {
                let _ = crate::db::kv::set(db_state.inner(), &key, &json);
            }
            resolved.insert(name, s);
        }
    }

    resolved
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Test slug generation for known gamestatus.info game slugs.
    #[test]
    fn test_slugify_accuracy() {
        let cases = vec![
            ("Cyberpunk 2077", "cyberpunk-2077"),
            (
                "Assassin's Creed Black Flag Resynced",
                "assassins-creed-black-flag-resynced",
            ),
            (
                "EA SPORTS™ College Football 27",
                "ea-sportstm-college-football-27",
            ),
            (
                "Monopoly: Star Wars™ Heroes vs. Villains",
                "monopoly-star-warstm-heroes-vs-villains",
            ),
            ("007 First Light", "007-first-light"),
            ("Forza Horizon 6", "forza-horizon-6"),
        ];
        for (input, expected) in cases {
            let got = slugify(input);
            assert_eq!(
                got, expected,
                "slugify(\"{}\") = \"{}\", expected \"{}\"",
                input, got, expected
            );
        }
    }

    /// Test a well-known cracked game to verify scrape + parse.
    #[tokio::test]
    async fn test_cyberpunk_2077_crackwatch() {
        let result = service()
            .get_status_by_title_and_app_id("Cyberpunk 2077", None)
            .await;
        println!("Cyberpunk 2077 => {:?}", result);
        assert!(result.is_some(), "Expected a crack status for Cyberpunk 2077");
        assert!(
            result.unwrap().is_cracked,
            "Expected Cyberpunk 2077 to be cracked"
        );
    }

    /// Test a Denuvo-protected game to verify scene group extraction.
    #[tokio::test]
    async fn test_denuvo_game() {
        let result = service()
            .get_status_by_title_and_app_id("Assassin's Creed Black Flag Resynced", None)
            .await;
        println!("Assassin's Creed => {:?}", result);
        assert!(
            result.is_some(),
            "Expected crack status for Assassin's Creed"
        );
        let r = result.unwrap();
        assert!(
            r.crack_group.is_some(),
            "Expected scene group for a Denuvo game"
        );
    }
}
