use serde::{Deserialize, Deserializer, Serialize};
use reqwest::Client;
use serde_json::Value;
use tauri::Manager;

use crate::db;
use crate::local_achievements::{self, UnlockedAchievement};

/// User-agent for Steam API requests.
const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/// Hydra's achievement-schema endpoint (anonymous, no login). Returns
/// display names / icons / descriptions + a `points` rarity score.
const HYDRA_API_BASE: &str = "https://hydra-api-us-east-1.losbroxas.org";

// ── Serializable types ──────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Achievement {
    pub api_name: String,
    pub display_name: String,
    pub description: String,
    pub icon: String,
    pub icon_gray: String,
    pub achieved: bool,
    pub unlock_time: u64,
    pub percent: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GameAchievementData {
    pub steam_app_id: u32,
    pub achievements: Vec<Achievement>,
    pub total: u32,
    pub unlocked: u32,
    pub locked: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_synced: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AchievementsCache {
    pub games: std::collections::HashMap<String, GameAchievementData>,
}

// ── Steam API response types (private, for deserialization only) ─────

#[derive(Debug, Deserialize)]
struct SchemaResponse {
    game: Option<SchemaGame>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SchemaGame {
    #[serde(default, rename = "availableGameStats")]
    available_game_stats: Option<AvailableGameStats>,
}

#[derive(Debug, Deserialize)]
struct AvailableGameStats {
    #[serde(default)]
    achievements: Vec<SchemaAchievement>,
}

#[derive(Debug, Deserialize)]
struct SchemaAchievement {
    name: String,
    #[serde(default, rename = "displayName")]
    display_name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    icon: String,
    #[serde(default)]
    icongray: String,
    #[serde(default)]
    hidden: u8,
}

#[derive(Debug, Deserialize)]
struct PlayerAchievementsResponse {
    playerstats: Option<PlayerStats>,
}

#[derive(Debug, Deserialize)]
struct PlayerStats {
    #[serde(default)]
    achievements: Vec<PlayerAchievement>,
    #[serde(default)]
    #[allow(dead_code)]
    success: bool,
}

#[derive(Debug, Deserialize)]
struct PlayerAchievement {
    apiname: String,
    achieved: u8,
    #[serde(default)]
    unlocktime: u64,
}

#[derive(Debug, Deserialize)]
struct GlobalPercentResponse {
    achievementpercentages: Option<GlobalPercentBody>,
}

#[derive(Debug, Deserialize)]
struct GlobalPercentBody {
    #[serde(default)]
    achievements: Vec<GlobalAchievementPercent>,
}

#[derive(Debug, Deserialize)]
struct GlobalAchievementPercent {
    name: String,
    /// Steam's `GetGlobalAchievementPercentagesForApp/v2` returns the
    /// unlock **percentage** as a JSON **string** (e.g. `"48.234"`),
    /// not a JSON number. `serde_json` will not coerce a string into
    /// `f64` by default, so we use a custom deserializer that accepts
    /// both shapes — Steam has historically returned the string form,
    /// but we keep the numeric path as forward-compat in case they
    /// ever change it. Without this, parse of the whole
    /// `GlobalPercentResponse` fails, the error is swallowed by the
    /// `.unwrap_or(...)` upstream, every achievement's `percent`
    /// defaults to `0.0`, and the achievement tab renders "0.0%" for
    /// every row.
    #[serde(deserialize_with = "deserialize_percent")]
    percent: f64,
}

/// Custom deserializer for `GlobalAchievementPercent.percent`. Accepts
/// either a JSON string (Steam's actual response shape) or a JSON
/// number (defensive — easier than chasing a regression if Valve ever
/// switches the wire format). Returns the value as `f64` 0–100.
fn deserialize_percent<'de, D>(deserializer: D) -> Result<f64, D::Error>
where
    D: Deserializer<'de>,
{
    let v = Value::deserialize(deserializer)?;
    let n = match v {
        Value::Number(n) => n
            .as_f64()
            .ok_or_else(|| serde::de::Error::custom("percent is not a valid f64")),
        Value::String(s) => s
            .trim()
            .parse::<f64>()
            .map_err(serde::de::Error::custom),
        _ => Err(serde::de::Error::custom(
            "percent must be a JSON string or number",
        )),
    }?;
    // Steam doesn't return NaN/Inf, but `parse::<f64>` silently
    // accepts "NaN" / "Infinity" — Rust would serialize those as JSON
    // `null`, which would then crash the frontend's `.toFixed(1)`.
    // Coerce non-finite values to 0.0 so one bad row can't blank
    // the whole rarity distribution.
    Ok(if n.is_finite() { n } else { 0.0 })
}

fn build_client() -> Result<Client, String> {
    Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

// ── Tauri commands ──────────────────────────────────────────────────────

/// Fetch achievements for a single game from Steam. (Unchanged.)
pub async fn fetch_achievements_with_client(
    client: &Client,
    steam_app_id: u32,
    steam_id: &str,
    api_token: &str,
) -> Result<GameAchievementData, String> {
    let schema_url = format!(
        "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/\
         ?key={}&appid={}&l=english&format=json",
        api_token, steam_app_id
    );
    let schema_resp = client
        .get(&schema_url)
        .send()
        .await
        .map_err(|e| format!("Schema request failed: {e}"))?;

    if !schema_resp.status().is_success() {
        return Err(format!(
            "Schema API returned HTTP {}",
            schema_resp.status().as_u16()
        ));
    }

    let schema_body = schema_resp
        .text()
        .await
        .unwrap_or_else(|_| "{}".to_string());
    let schema: SchemaResponse = serde_json::from_str(&schema_body)
        .map_err(|e| format!("Failed to parse schema response: {e}"))?;

    let schema_achievements = schema
        .game
        .and_then(|g| g.available_game_stats)
        .map(|s| s.achievements)
        .unwrap_or_default();

    if schema_achievements.is_empty() {
        return Ok(GameAchievementData {
            steam_app_id,
            achievements: Vec::new(),
            total: 0,
            unlocked: 0,
            locked: 0,
            last_synced: None,
        });
    }

    let player_url = format!(
        "https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/\
         ?key={}&steamid={}&appid={}&format=json",
        api_token, steam_id, steam_app_id
    );
    let player_resp = client
        .get(&player_url)
        .send()
        .await
        .map_err(|e| format!("Player achievements request failed: {e}"))?;

    let player_achievements: Vec<PlayerAchievement> = if player_resp.status().is_success() {
        let body = player_resp
            .text()
            .await
            .unwrap_or_else(|_| "{}".to_string());
        let parsed: PlayerAchievementsResponse =
            serde_json::from_str(&body).unwrap_or(PlayerAchievementsResponse {
                playerstats: None,
            });
        parsed
            .playerstats
            .map(|ps| ps.achievements)
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let global_url = format!(
        "https://api.steampowered.com/ISteamUserStats/\
         GetGlobalAchievementPercentagesForApp/v2/\
         ?gameid={}&format=json",
        steam_app_id
    );
    let global_percents: Vec<GlobalAchievementPercent> =
        match client.get(&global_url).send().await {
            Ok(resp) if resp.status().is_success() => {
                let body = resp.text().await.unwrap_or_else(|_| "{}".to_string());
                match serde_json::from_str::<GlobalPercentResponse>(&body) {
                    Ok(parsed) => parsed
                        .achievementpercentages
                        .map(|ap| ap.achievements)
                        .unwrap_or_default(),
                    Err(e) => {
                        // Log instead of silently swallowing — the
                        // string-as-percent schema mismatch bit us
                        // once already; a future wire-format change
                        // should be loud, not invisible.
                        eprintln!(
                            "[achievements] failed to parse GetGlobalAchievementPercentagesForApp \
                             response for appid {steam_app_id}: {e}"
                        );
                        Vec::new()
                    }
                }
            }
            _ => Vec::new(),
        };

    let player_map: std::collections::HashMap<String, &PlayerAchievement> = player_achievements
        .iter()
        .map(|a| (a.apiname.clone(), a))
        .collect();
    let percent_map: std::collections::HashMap<String, f64> = global_percents
        .iter()
        .map(|a| (a.name.clone(), a.percent))
        .collect();

    let mut achievements: Vec<Achievement> = Vec::with_capacity(schema_achievements.len());
    let mut unlocked_count: u32 = 0;

    for sa in &schema_achievements {
        let player = player_map.get(&sa.name);
        let achieved = player.map(|p| p.achieved == 1).unwrap_or(false);
        let unlock_time = player.map(|p| p.unlocktime).unwrap_or(0);
        let percent = percent_map.get(&sa.name).copied().unwrap_or(0.0);

        if achieved {
            unlocked_count += 1;
        }

        achievements.push(Achievement {
            api_name: sa.name.clone(),
            display_name: sa.display_name.clone(),
            description: if sa.hidden == 1 && !achieved {
                "Hidden achievement".to_string()
            } else {
                sa.description.clone()
            },
            icon: sa.icon.clone(),
            icon_gray: sa.icongray.clone(),
            achieved,
            unlock_time,
            percent,
        });
    }

    achievements.sort_by(|a, b| {
        match (a.achieved, b.achieved) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            (true, true) => b.unlock_time.cmp(&a.unlock_time),
            (false, false) => b.percent.partial_cmp(&a.percent).unwrap_or(std::cmp::Ordering::Equal),
        }
    });

    let total = achievements.len() as u32;
    Ok(GameAchievementData {
        steam_app_id,
        achievements,
        total,
        unlocked: unlocked_count,
        locked: total - unlocked_count,
        last_synced: None,
    })
}

#[tauri::command]
pub async fn fetch_achievements(
    steam_app_id: u32,
    steam_id: String,
    api_token: String,
) -> Result<GameAchievementData, String> {
    let client = build_client()?;
    fetch_achievements_with_client(&client, steam_app_id, &steam_id, &api_token).await
}

/// Save the achievements cache to the `achievements_cache` SQLite
/// table. The frontend still ships a single JSON blob (the
/// `AchievementsCache` shape); we parse it and upsert one row per
/// game inside a transaction.
#[tauri::command]
pub fn save_achievements_cache(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let parsed: Value = serde_json::from_str(&data)
        .map_err(|e| format!("parse: {e}"))?;
    let games = parsed
        .get("games")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::achievements::upsert_many_from_payload(db_state.inner(), &games)
}

/// Load the achievements cache. Returns the same JSON shape the
/// frontend expects: `{ "games": { "<gameId>": <GameAchievementData> } }`.
#[tauri::command]
pub fn load_achievements_cache(app: tauri::AppHandle) -> Result<String, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::achievements::read_all_as_payload_json(db_state.inner())
}

/// Internal helper: read the achievements cache as a Rust struct.
pub fn load_cache_internal(app: &tauri::AppHandle) -> Result<AchievementsCache, String> {
    let payload = load_achievements_cache_inner(app)?;
    serde_json::from_str(&payload).map_err(|e| format!("parse payload: {e}"))
}

/// Internal helper: save the achievements cache from a struct.
pub fn save_cache_internal(
    app: &tauri::AppHandle,
    cache: &AchievementsCache,
) -> Result<(), String> {
    let json = serde_json::to_string(cache).map_err(|e| e.to_string())?;
    save_achievements_cache(app.clone(), json)
}

fn load_achievements_cache_inner(app: &tauri::AppHandle) -> Result<String, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::achievements::read_all_as_payload_json(db_state.inner())
}

// ── Local (crack / emulator) achievements ───────────────────────────────
//
// Ported from Hydra Launcher. The achievement *schema* (display names,
// icons, descriptions, rarity) comes from Hydra's anonymous API; the
// *unlock state* comes from crack/emulator files on disk (see
// `local_achievements`). The two are merged into the same
// `GameAchievementData` shape the Steam path produces, keyed by the
// local library game id.

/// Hydra's achievement-schema row shape.
#[derive(Debug, Deserialize)]
struct HydraSchemaAchievement {
    name: String,
    #[serde(default)]
    hidden: bool,
    #[serde(default)]
    icon: String,
    #[serde(default)]
    icongray: String,
    #[serde(default, rename = "displayName")]
    display_name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    points: Option<f64>,
}

/// Convert Hydra's `points` rarity score into an approximate global
/// unlock percentage (0–100), mirroring Hydra's own inverse formula.
fn points_to_percent(points: Option<f64>) -> f64 {
    match points {
        Some(p) if p.is_finite() && p >= 0.0 => ((50.0 - p.sqrt()) * 2.0).clamp(0.0, 100.0),
        _ => 0.0,
    }
}

/// Fetch the achievement schema for a Steam appid from Hydra's public
/// API. Returns achievements with `achieved=false` / `unlock_time=0`
/// (unlock state is merged in separately from local files).
pub async fn fetch_hydra_schema(
    client: &Client,
    steam_app_id: u32,
    language: &str,
) -> Result<Vec<Achievement>, String> {
    let url = format!(
        "{HYDRA_API_BASE}/games/steam/{steam_app_id}/achievements?language={language}"
    );
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Hydra achievements request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Hydra achievements API returned HTTP {}",
            resp.status().as_u16()
        ));
    }

    let body = resp.text().await.unwrap_or_else(|_| "[]".to_string());
    let schema: Vec<HydraSchemaAchievement> = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse Hydra achievements: {e}"))?;

    Ok(schema
        .into_iter()
        .map(|a| {
            let display_name = if a.display_name.is_empty() {
                a.name.clone()
            } else {
                a.display_name
            };
            let description = if a.hidden && a.description.is_empty() {
                "Hidden achievement".to_string()
            } else {
                a.description
            };
            Achievement {
                api_name: a.name,
                display_name,
                description,
                icon: a.icon,
                icon_gray: a.icongray,
                achieved: false,
                unlock_time: 0,
                percent: points_to_percent(a.points),
            }
        })
        .collect())
}

/// Sort achievements: unlocked first (newest unlock first), then locked
/// by rarity (rarest first). Shared by the Steam + local paths.
fn sort_achievements(achievements: &mut [Achievement]) {
    achievements.sort_by(|a, b| match (a.achieved, b.achieved) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        (true, true) => b.unlock_time.cmp(&a.unlock_time),
        (false, false) => b
            .percent
            .partial_cmp(&a.percent)
            .unwrap_or(std::cmp::Ordering::Equal),
    });
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Merge locally-unlocked achievements into the cache for one game.
///
/// Reads the existing cached row (if any), overlays the freshly-fetched
/// `schema` (falling back to the cached achievements when no schema is
/// available, e.g. offline), applies the on-disk unlock state, and
/// persists the result. Never relocks a previously-unlocked
/// achievement — Steam and local unlocks are unioned. Returns the merged
/// data and the count of *newly* unlocked achievements.
pub fn merge_into_cache(
    app: &tauri::AppHandle,
    game_id: &str,
    steam_app_id: u32,
    schema: Option<Vec<Achievement>>,
    unlocked: &[UnlockedAchievement],
) -> Result<(GameAchievementData, usize), String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let db = db_state.inner();

    // Existing cached data (from a prior Steam sync or local scan).
    let existing: Option<GameAchievementData> = db::achievements::get(db, game_id)?
        .and_then(|(_, payload, _)| serde_json::from_str(&payload).ok());

    // Previously-achieved lookup (uppercased api name -> unlock secs).
    let prev_achieved: std::collections::HashMap<String, u64> = existing
        .as_ref()
        .map(|d| {
            d.achievements
                .iter()
                .filter(|a| a.achieved)
                .map(|a| (a.api_name.to_uppercase(), a.unlock_time))
                .collect()
        })
        .unwrap_or_default();

    // Base achievement list: prefer the fresh schema, else the cached
    // list, else nothing (nothing to merge against).
    let mut base: Vec<Achievement> = match schema {
        Some(s) if !s.is_empty() => s,
        _ => existing.as_ref().map(|d| d.achievements.clone()).unwrap_or_default(),
    };

    if base.is_empty() {
        return Ok((
            existing.unwrap_or(GameAchievementData {
                steam_app_id,
                achievements: Vec::new(),
                total: 0,
                unlocked: 0,
                locked: 0,
                last_synced: Some(now_secs()),
            }),
            0,
        ));
    }

    // Local unlock map: uppercased api name -> unlock secs (ms/1000).
    let local_unlocked: std::collections::HashMap<String, u64> = unlocked
        .iter()
        .map(|u| (u.name.to_uppercase(), u.unlock_time / 1000))
        .collect();

    let mut new_count = 0usize;
    let mut unlocked_count = 0u32;

    for ach in base.iter_mut() {
        let key = ach.api_name.to_uppercase();
        let was_achieved = prev_achieved.contains_key(&key);
        let now_local = local_unlocked.contains_key(&key);
        let achieved = was_achieved || now_local;

        if achieved {
            unlocked_count += 1;
            // Preserve the earliest known unlock time.
            let prev_time = prev_achieved.get(&key).copied().unwrap_or(0);
            let local_time = local_unlocked.get(&key).copied().unwrap_or(0);
            ach.unlock_time = match (prev_time, local_time) {
                (0, t) | (t, 0) => t,
                (a, b) => a.min(b),
            };
            if !was_achieved {
                new_count += 1;
            }
        }
        ach.achieved = achieved;
    }

    sort_achievements(&mut base);

    let total = base.len() as u32;
    let data = GameAchievementData {
        steam_app_id,
        achievements: base,
        total,
        unlocked: unlocked_count,
        locked: total - unlocked_count,
        last_synced: Some(now_secs()),
    };

    let payload = serde_json::to_string(&data).map_err(|e| e.to_string())?;
    db::achievements::upsert(db, game_id, steam_app_id, &payload, now_secs())?;

    Ok((data, new_count))
}

/// Resolve the UI language stored in the kv table (defaults to "en").
fn resolve_language(app: &tauri::AppHandle) -> String {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::kv::get(db_state.inner(), "language")
        .ok()
        .flatten()
        .map(|s| s.trim_matches('"').to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "en".to_string())
}

/// Shared worker: fetch the Hydra schema, scan + parse local crack
/// files, and merge into the cache. Used by both the manual command and
/// the background watcher. Returns the merged data and new-unlock count.
pub async fn sync_local_for_game(
    app: &tauri::AppHandle,
    client: &Client,
    game_id: &str,
    steam_app_id: u32,
    exe_path: Option<String>,
    language: &str,
) -> Result<(GameAchievementData, usize), String> {
    // Fetch the schema (best-effort — merge can fall back to cache).
    let schema = fetch_hydra_schema(client, steam_app_id, language).await.ok();

    // Find + parse all local crack/emulator files for this appid.
    let files = local_achievements::find_achievement_files(steam_app_id, exe_path.as_deref());
    let mut unlocked: Vec<UnlockedAchievement> = Vec::new();
    for file in &files {
        unlocked.extend(local_achievements::parse_achievement_file(file));
    }

    merge_into_cache(app, game_id, steam_app_id, schema, &unlocked)
}

/// Manual per-game local achievement sync (frontend "Sync" button for
/// non-Steam / cracked games). Fetches schema from Hydra + reads local
/// crack files, merges, and returns the updated data.
#[tauri::command]
pub async fn sync_local_achievements(
    app: tauri::AppHandle,
    game_id: String,
    steam_app_id: Option<u32>,
) -> Result<GameAchievementData, String> {
    let (steam_app_id, exe_path) = {
        let db_state: tauri::State<'_, db::Db> = app.state();
        let game = db::games::get(db_state.inner(), &game_id)?;
        let exe_path = game.as_ref().map(|g| g.path.clone());
        // Prefer an explicit appid override (e.g. one the frontend just
        // resolved), then the persisted game row's appid.
        let appid = steam_app_id
            .or_else(|| game.and_then(|g| g.steam_app_id))
            .ok_or_else(|| "Game has no Steam AppID — cannot locate achievements".to_string())?;
        (appid, exe_path)
    };

    let language = resolve_language(&app);
    let client = build_client()?;
    let (data, _new) =
        sync_local_for_game(&app, &client, &game_id, steam_app_id, exe_path, &language).await?;
    Ok(data)
}
