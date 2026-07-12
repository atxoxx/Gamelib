use serde::{Deserialize, Deserializer, Serialize};
use reqwest::Client;
use serde_json::Value;
use tauri::Manager;

use crate::db;

/// User-agent for Steam API requests.
const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

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
