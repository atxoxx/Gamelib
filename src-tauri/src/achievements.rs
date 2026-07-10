use serde::{Deserialize, Serialize};
use reqwest::Client;
use tauri::Manager;

/// User-agent for Steam API requests.
const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// ── Serializable types ──────────────────────────────────────────────────

/// A single achievement definition + user progress.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Achievement {
    pub api_name: String,
    pub display_name: String,
    pub description: String,
    /// Icon URL when unlocked.
    pub icon: String,
    /// Icon URL when locked.
    pub icon_gray: String,
    pub achieved: bool,
    /// Unix timestamp of unlock (0 if locked).
    pub unlock_time: u64,
    /// Global unlock percentage (0.0–100.0). Populated by
    /// `fetch_global_achievement_percentages`.
    #[serde(default)]
    pub percent: f64,
}

/// Per-game achievement data returned to the frontend.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GameAchievementData {
    pub steam_app_id: u32,
    pub achievements: Vec<Achievement>,
    pub total: u32,
    pub unlocked: u32,
    pub locked: u32,
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
    percent: f64,
}

// ── Helper: build HTTP client ───────────────────────────────────────────

fn build_client() -> Result<Client, String> {
    Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

// ── Tauri commands ──────────────────────────────────────────────────────

/// Fetch achievements for a single game from Steam.
///
/// Calls three endpoints:
/// 1. `GetSchemaForGame/v2/` — achievement definitions (names, descriptions, icons)
/// 2. `GetPlayerAchievements/v1/` — user's unlock status & timestamps
/// 3. `GetGlobalAchievementPercentagesForApp/v2/` — global rarity percentages
///
/// `api_token` is the Steam `web_api_token` extracted during login — it works
/// as the `key` parameter for these `ISteamUserStats` endpoints.
#[tauri::command]
pub async fn fetch_achievements(
    steam_app_id: u32,
    steam_id: String,
    api_token: String,
) -> Result<GameAchievementData, String> {
    let client = build_client()?;

    // ── 1. Get achievement schema (definitions) ────────────────────
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
        // Game has no achievements defined
        return Ok(GameAchievementData {
            steam_app_id,
            achievements: Vec::new(),
            total: 0,
            unlocked: 0,
            locked: 0,
        });
    }

    // ── 2. Get player achievements (unlock status) ─────────────────
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
        // Profile may be private — proceed with schema only, all locked
        Vec::new()
    };

    // ── 3. Get global percentages ──────────────────────────────────
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
                let parsed: GlobalPercentResponse =
                    serde_json::from_str(&body).unwrap_or(GlobalPercentResponse {
                        achievementpercentages: None,
                    });
                parsed
                    .achievementpercentages
                    .map(|ap| ap.achievements)
                    .unwrap_or_default()
            }
            _ => Vec::new(),
        };

    // Build lookup maps
    let player_map: std::collections::HashMap<String, &PlayerAchievement> = player_achievements
        .iter()
        .map(|a| (a.apiname.clone(), a))
        .collect();
    let percent_map: std::collections::HashMap<String, f64> = global_percents
        .iter()
        .map(|a| (a.name.clone(), a.percent))
        .collect();

    // ── Merge into final Achievement list ──────────────────────────
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

    // Sort: unlocked first (by unlock_time desc), then locked (by percent desc = easiest first)
    achievements.sort_by(|a, b| {
        match (a.achieved, b.achieved) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            (true, true) => b.unlock_time.cmp(&a.unlock_time), // most recent first
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
    })
}

/// Save the achievements cache to disk as JSON.
#[tauri::command]
pub fn save_achievements_cache(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let file_path = data_dir.join("achievements_cache.json");
    std::fs::write(&file_path, data).map_err(|e| e.to_string())?;
    Ok(())
}

/// Load the achievements cache from disk.
#[tauri::command]
pub fn load_achievements_cache(app: tauri::AppHandle) -> Result<String, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let file_path = data_dir.join("achievements_cache.json");
    if !file_path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&file_path).map_err(|e| e.to_string())
}
