use reqwest::Client;
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

use super::auth::refresh_tokens_if_needed;
use super::types::{EpicAuthTokens, EpicCatalogItem, EpicFilterOptions, EpicGame, EpicGameAsset, EpicSyncResult, EpicSyncedGame};
use crate::size;

/// Sync the user's Epic Games library.
///
/// 1. Refreshes tokens if needed
/// 2. Fetches owned game assets via Epic's internal API
/// 3. Filters out DLCs, plugins, UE tools, and non-launchable items
/// 4. Detects locally installed games via launcher manifests
/// 5. Returns cleaned, deduplicated game entries
#[tauri::command]
pub async fn epic_sync_library(app: AppHandle) -> Result<EpicSyncResult, String> {
    let tokens = refresh_tokens_if_needed(&app).await?;
    let client = Client::new();
    let mut errors: Vec<String> = Vec::new();

    // 1. Fetch owned assets
    let assets = match fetch_owned_assets(&client, &tokens).await {
        Ok(a) => a,
        Err(e) => {
            return Ok(EpicSyncResult {
                success: false,
                games_imported: 0,
                games_skipped: 0,
                errors: vec![e],
                last_sync: current_unix(),
                synced_games: vec![],
            });
        }
    };

    // 2. Fetch catalog details for each asset
    let catalog_items = fetch_catalog_batch(&client, &tokens, &assets).await.unwrap_or_else(|e| {
        errors.push(format!("Catalog fetch failed (games may still import): {}", e));
        Vec::new()
    });

    // 3. Filter owned, launchable games
    let owned_games = filter_owned_games(&assets, &catalog_items);
    let skipped = assets.len().saturating_sub(owned_games.len());

    // 4. Detect installed games via launcher manifests
    let installed_games = detect_installed_epic_games();

    // 5. Merge installed data into library entries
    let merged = merge_game_data(owned_games, &installed_games);

    // 6. Convert to synced game entries (cover_url comes from EpicGame now)
    let synced_games: Vec<EpicSyncedGame> = merged
        .iter()
        .map(|g| {
            // Measure the install dir for games Epic reports as installed.
            // We use `g.install_dir` (the canonical InstallLocation from
            // the manifest) — NOT `g.install_path` — because the
            // LaunchExecutable for UE/Unity games points into a bin
            // subfolder, so `parent(install_path)` would under-count
            // engine content. Per-game failure leaves the size fields
            // None; the sync itself is never aborted.
            let size_info = g
                .install_dir
                .as_deref()
                .filter(|_| g.is_installed)
                .map(std::path::Path::new)
                .and_then(size::measure_folder_size);
            EpicSyncedGame {
                id: format!("epic-{}-{}", g.namespace, g.catalog_item_id),
                title: g.title.clone(),
                namespace: g.namespace.clone(),
                catalog_item_id: g.catalog_item_id.clone(),
                is_installed: g.is_installed,
                install_path: g.install_path.clone(),
                playtime_minutes: g.playtime_minutes,
                last_played: g.last_played,
                cover_url: g.cover_url.clone(),
                size_bytes: size_info.as_ref().map(|s| s.size_bytes),
                size_root_path: size_info.as_ref().map(|s| s.root_path.clone()),
            }
        })
        .collect();

    Ok(EpicSyncResult {
        success: true,
        games_imported: merged.len(),
        games_skipped: skipped,
        errors,
        last_sync: current_unix(),
        synced_games,
    })
}

/// Get available filter options for Epic games.
#[tauri::command]
pub fn epic_get_filters() -> EpicFilterOptions {
    EpicFilterOptions {
        statuses: vec![
            "owned".to_string(),
            "installed".to_string(),
            "uninstalled".to_string(),
        ],
        categories: vec![
            "applications".to_string(),
            "addons".to_string(),
            "plugins".to_string(),
        ],
        namespaces: Vec::new(),
    }
}

// ── Internal functions ─────────────────────────────────────────────

/// Fetch owned game assets from Epic's internal library API.
/// Uses cursor-based pagination to fetch ALL owned items (not just the first page).
///
/// Epic's library API returns a `responseMetaData.nextCursor` (most API shapes)
/// or top-level `cursor` (legacy shapes) when more pages are available. We
/// walk the cursor until it is null/empty — empty `records[]` mid-stream is
/// NOT a terminator because Epic can legitimately serve a transient empty
/// page while still advertising a follow-up cursor (region-filtered items,
/// purchase-migration transitions, etc.). The only true end-of-stream signal
/// is `nextCursor == null/""`. Playnite's EpicLibrary uses the same cursor-only
/// termination rule.
async fn fetch_owned_assets(
    client: &Client,
    tokens: &EpicAuthTokens,
) -> Result<Vec<EpicGameAsset>, String> {
    let base_url = "https://library-service.live.use1a.on.epicgames.com/library/api/public/items?includeMetadata=true&platform=Windows";
    let mut all_assets: Vec<EpicGameAsset> = Vec::new();
    let mut cursor: Option<String> = None;
    let mut page_idx: u32 = 0;
    // Hot-loop guard: track cursors we've already consumed. If Epic ever
    // returns the same `nextCursor` value twice in a row (server-side bug,
    // redirect loop, etc.) we'd otherwise loop forever; a one-off duplicate
    // is enough to call it done. Replaces the prior `max_pages = 50` cap
    // with a token-stable termination signal.
    let mut seen_cursors: HashSet<String> = HashSet::new();

    loop {
        page_idx += 1;
        let url = if let Some(ref c) = cursor {
            format!("{}&cursor={}", base_url, urlencoding::encode(c))
        } else {
            base_url.to_string()
        };

        let response = client
            .get(&url)
            .bearer_auth(&tokens.access_token)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch owned assets (page {}): {}", page_idx, e))?;

        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(format!("Epic assets API returned HTTP {} (page {}): {}", status, page_idx, body));
        }

        let json: Value = serde_json::from_str(&body)
            .map_err(|e| format!("Failed to parse assets response (page {}): {}", page_idx, e))?;

        let page_assets: Vec<EpicGameAsset> = json["records"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| {
                        Some(EpicGameAsset {
                            namespace: item["namespace"].as_str()?.to_string(),
                            catalog_item_id: item["catalogItemId"].as_str()?.to_string(),
                            app_name: item["appName"].as_str()?.to_string(),
                            sandbox_type: item["sandboxType"].as_str().map(|s| s.to_string()),
                            build_version: item["buildVersion"].as_str().map(|s| s.to_string()),
                            categories: item["categories"]
                                .as_array()
                                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                                .unwrap_or_default(),
                            item_type: item["itemType"].as_str().map(|s| s.to_string()),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        // Empty `records[]` mid-stream is BENIGN — keep walking the cursor.
        // The old behaviour (`if page_assets.is_empty() { break }`) could
        // truncate a user's library when Epic emitted a transient empty
        // page (region-restricted preview items being moved, etc.).
        all_assets.extend(page_assets);

        // Epic nests pagination under responseMetaData.nextCursor on recent
        // API versions. Fall back to top-level "cursor" for older shapes.
        let next_cursor = json["responseMetaData"]["nextCursor"]
            .as_str()
            .or_else(|| json["cursor"].as_str())
            .map(|s| s.to_string());

        // Only `nextCursor == null/""` terminates; any other value advances,
        // UNLESS we've already seen that exact cursor value (degenerate-loop
        // defence).
        match next_cursor {
            Some(c) if !c.is_empty() => {
                if !seen_cursors.insert(c.clone()) {
                    // Repeated cursor — give up defensively rather than spin.
                    break;
                }
                cursor = Some(c);
            }
            _ => break,
        }
    }

    Ok(all_assets)
}

/// Fetch detailed catalog information for a batch of games.
async fn fetch_catalog_batch(
    client: &Client,
    tokens: &EpicAuthTokens,
    assets: &[EpicGameAsset],
) -> Result<Vec<EpicCatalogItem>, String> {
    if assets.is_empty() {
        return Ok(Vec::new());
    }

    // Build a map of namespace -> [catalog_item_ids]
    let mut ns_map: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    for asset in assets {
        ns_map
            .entry(asset.namespace.clone())
            .or_default()
            .push(asset.catalog_item_id.clone());
    }

    let mut all_items: Vec<EpicCatalogItem> = Vec::new();
    let mut chunk_errors: Vec<String> = Vec::new();

    for (namespace, item_ids) in &ns_map {
        // Epic allows up to ~20 items per request; chunk if needed
        for chunk in item_ids.chunks(20) {
            let ids_param = chunk.join(",");
            let url = format!(
                "https://catalog-public-service-prod06.ol.epicgames.com/catalog/api/shared/namespace/{}/bulk/items?id={}&country=US&locale=en-US&includeMainGameDetails=true",
                namespace, ids_param
            );

            let response = match client
                .get(&url)
                .bearer_auth(&tokens.access_token)
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => {
                    chunk_errors.push(format!("Catalog fetch failed for {}: {}", namespace, e));
                    continue;
                }
            };

            let status = response.status();
            let body = response.text().await.unwrap_or_default();

            if !status.is_success() {
                chunk_errors.push(format!(
                    "Catalog HTTP {} for {}: {}",
                    status, namespace, body
                ));
                continue;
            }

            let json: Value = match serde_json::from_str(&body) {
                Ok(v) => v,
                Err(e) => {
                    chunk_errors.push(format!("Catalog JSON parse error for {}: {}", namespace, e));
                    continue;
                }
            };

            // Epic's bulk/items returns a dictionary where the KEY is the catalog
            // item ID and the value is the item data. The nested item data may not
            // contain a duplicate "id" field, so we use the dict key as the ID.
            let items: Vec<EpicCatalogItem> = json
                .as_object()
                .into_iter()
                .flat_map(|obj| obj.iter())
                .filter_map(|(catalog_id, item)| {
                    Some(EpicCatalogItem {
                        namespace: namespace.clone(),
                        catalog_item_id: catalog_id.clone(),
                        title: item["title"].as_str()?.to_string(),
                        description: item["description"].as_str().map(|s| s.to_string()),
                        categories: item["categories"]
                            .as_array()
                            .map(|arr| arr.iter().filter_map(|v| v["path"].as_str().map(|s| s.to_string())).collect())
                            .unwrap_or_default(),
                        sandbox_type: item["sandboxType"].as_str().map(|s| s.to_string()),
                        developer: item["developer"].as_str().map(|s| s.to_string()),
                        publisher: item["publisherDisplayName"].as_str().map(|s| s.to_string()),
                        release_date: item["releaseDate"].as_str().map(|s| s.to_string()),
                        cover_url: item_key_image(item),
                        custom_attributes: item["customAttributes"]
                            .as_object()
                            .map(|obj| {
                                obj.iter()
                                    .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                                    .collect()
                            }),
                    })
                })
                .collect();
            all_items.extend(items);
        }
    }

    if all_items.is_empty() && !chunk_errors.is_empty() {
        return Err(chunk_errors.join("; "));
    }

    Ok(all_items)
}

fn item_key_image(item: &Value) -> Option<String> {
    // Prioritize tall/portrait images for consistent library presentation.
    // Expanded type list based on Playnite's EpicLibrary extension.
    let valid_types = [
        "OfferImageTall",
        "StorePortrait",
        "DieselStoreFrontTall",
        "Thumbnail",
        "CodeRedemption_340x440",
        "OfferImageWide",
        "DieselStoreFrontWide",
        "StoreLandscape",
    ];

    item["keyImages"]
        .as_array()?
        .iter()
        .filter_map(|img| {
            let img_type = img["type"].as_str()?;
            if valid_types.contains(&img_type) {
                img["url"].as_str().map(|s| s.to_string())
            } else {
                None
            }
        })
        .next()
}

/// Filter out non-owned, non-launchable items.
///
/// Two-stage filter, mirrored from Playnite's EpicLibrary extension:
///   Stage 1: launchability allow-list — the asset's category list MUST
///            contain `applications` exactly (Playnite's categorisation
///            gate). This is the gate that excludes items whose category
///            is `games/editors/base`, `plugins`, `addons`, `bundles/*`,
///            `experiences`, `digitalextras` or an empty list — which is
///            how Unreal Marketplace plugins, Quixel Megascans packs, and
///            Fortnite Creative experiences appear when distributed via
///            a third-party namespace.
///   Stage 2: deny-list defence-in-depth — keep the prior denials so a
///            miscategorised plugin-in-applications item still drops.
fn filter_owned_games(
    assets: &[EpicGameAsset],
    catalog_items: &[EpicCatalogItem],
) -> Vec<EpicGame> {
    let catalog_map: std::collections::HashMap<(&str, &str), &EpicCatalogItem> = catalog_items
        .iter()
        .map(|ci| ((ci.namespace.as_str(), ci.catalog_item_id.as_str()), ci))
        .collect();

    assets
        .iter()
        .filter_map(|asset| {
            // ── Stage 1: structural exclusions ────────────────────────
            // Epic's "Unreal Engine" primary namespace — never a launchable game.
            if asset.namespace.eq_ignore_ascii_case("ue") {
                return None;
            }

            // ── Stage 2: launchability allow-list (Playnite parity) ───
            // Require `applications` (or any `applications/<sub>` subcategory) in
            // the category list. This rejects:
            //   • Unreal Marketplace plugins shipped under 3rd-party namespaces
            //     (category `games/editors/base`, `plugins`, or `[]`).
            //   • Asset/template bundles (category `bundles/*`).
            //   • DLC entries (category `addons/addonFor` without `applications`).
            //   • Fortnite Creative "experiences" (category `experiences/*`).
            // Playnite's EpicLibrary uses strict `==`, but Epic does occasionally
            // serve `applications/<sub>` for hierarchical categories, so we
            // widen slightly with `starts_with("applications/")` to avoid
            // over-filtering legitimate games.
            let is_applications = asset.categories
                .iter()
                .any(|c| c == "applications" || c.starts_with("applications/"));
            let is_bundle = asset.categories.iter().any(|c| c.starts_with("bundles"));
            if !is_applications || is_bundle {
                return None;
            }

            // ── Stage 3: deny-list (defence in depth) ─────────────────
            // Belt-and-suspenders: if Epic ever miscategorises a plugin
            // OR a digital-extra as `applications`, drop it anyway.
            let is_plugin = asset.categories.iter().any(|c| c.contains("plugins"));
            let is_extra = asset.categories.iter().any(|c| c.contains("digitalextras"));
            if is_plugin || is_extra {
                return None;
            }

            // PRIVATE sandbox types are test/dev builds, never launchable.
            if asset.sandbox_type.as_deref() == Some("PRIVATE") {
                return None;
            }

            // Unreal Engine tools (manifest-side identifier, e.g. `UE_*`).
            if asset.app_name.to_uppercase().starts_with("UE_") {
                return None;
            }

            let catalog = catalog_map
                .get(&(asset.namespace.as_str(), asset.catalog_item_id.as_str()))
                .copied();

            // Exclude third-party managed apps (EA, Ubisoft) by default
            if let Some(ci) = catalog {
                if let Some(attrs) = &ci.custom_attributes {
                    if attrs.get("ThirdPartyManagedApp").map(|s| s.as_str()) == Some("the ea app") {
                        return None;
                    }
                    if attrs.get("partnerLinkType").map(|s| s.as_str()) == Some("ubisoft") {
                        return None;
                    }
                }
            }

            let title = catalog.map(|ci| ci.title.clone())
                .unwrap_or_else(|| asset.app_name.clone());
            let cover_url = catalog.and_then(|ci| ci.cover_url.clone());

            Some(EpicGame {
                id: format!("epic-{}-{}", asset.namespace, asset.catalog_item_id),
                app_name: asset.app_name.clone(),
                title,
                namespace: asset.namespace.clone(),
                catalog_item_id: asset.catalog_item_id.clone(),
                build_version: asset.build_version.clone(),
                is_owned: true,
                is_installed: false,
                install_path: None,
                // Library-only entries have no manifest, hence no canonical
                // install dir. The merge step in `merge_game_data` will
                // populate this from the matching installed-manifest entry
                // when one is present.
                install_dir: None,
                launch_url: Some(format!(
                    "com.epicgames.launcher://apps/{}-{}?action=launch&silent=true",
                    asset.namespace, asset.catalog_item_id
                )),
                categories: asset.categories.clone(),
                sandbox_type: asset.sandbox_type.clone(),
                playtime_minutes: None,
                last_played: None,
                cover_url,
            })
        })
        .collect()
}

/// Detect locally installed Epic games by scanning launcher manifest files.
///
/// Epic stores install info in:
/// `%PROGRAMDATA%/Epic/EpicGamesLauncher/Data/Manifests/*.item`
fn detect_installed_epic_games() -> Vec<EpicGame> {
    let program_data = std::env::var("PROGRAMDATA")
        .unwrap_or_else(|_| "C:\\ProgramData".to_string());

    let manifests_dir = PathBuf::from(&program_data)
        .join("Epic")
        .join("EpicGamesLauncher")
        .join("Data")
        .join("Manifests");

    if !manifests_dir.exists() {
        return Vec::new();
    }

    let mut installed = Vec::new();

    if let Ok(entries) = fs::read_dir(&manifests_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("item") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Some(game) = parse_epic_manifest(&content) {
                        installed.push(game);
                    }
                }
            }
        }
    }

    installed
}

/// Parse an Epic launcher .item manifest file (JSON format).
fn parse_epic_manifest(content: &str) -> Option<EpicGame> {
    let json: Value = serde_json::from_str(content).ok()?;

    let namespace = json["CatalogNamespace"].as_str()?.to_string();
    let catalog_item_id = json["CatalogItemId"].as_str()?.to_string();
    let app_name = json["AppName"].as_str()?.to_string();
    let title = json["DisplayName"].as_str()?.to_string();

    let install_path = json["InstallLocation"].as_str().map(|s| s.to_string());
    let launch_executable = json["LaunchExecutable"].as_str().map(|s| s.to_string());

    // Build full install path if we have both
    let full_install_path = match (&install_path, &launch_executable) {
        (Some(dir), Some(exe)) => {
            let p = PathBuf::from(dir).join(exe);
            Some(p.to_string_lossy().to_string())
        }
        (Some(dir), None) => Some(dir.clone()),
        _ => None,
    };

    Some(EpicGame {
        id: format!("epic-{}-{}", namespace, catalog_item_id),
        app_name,
        title,
        namespace: namespace.clone(),
        catalog_item_id: catalog_item_id.clone(),
        build_version: json["AppVersionString"].as_str().map(|s| s.to_string()),
        is_owned: true,
        is_installed: true,
        install_path: full_install_path,
        // `install_path` (local var above) is the raw `InstallLocation`
        // from the manifest, i.e. the canonical install dir. We keep it
        // alongside the full exe path so the size-measurement step
        // can walk the whole install dir instead of the bin subfolder.
        install_dir: install_path,
        launch_url: Some(format!(
            "com.epicgames.launcher://apps/{}-{}?action=launch&silent=true",
            namespace, catalog_item_id
        )),
        categories: vec!["applications".to_string()],
        sandbox_type: None,
        playtime_minutes: json["PlaytimeMinutes"].as_u64(),
        last_played: json["LastPlayedDate"].as_u64(),
        cover_url: None,
    })
}

/// Merge library data with installed game data.
fn merge_game_data(library: Vec<EpicGame>, installed: &[EpicGame]) -> Vec<EpicGame> {
    library
        .into_iter()
        .map(|mut game| {
            if let Some(inst) = installed.iter().find(|i| i.id == game.id) {
                game.is_installed = true;
                game.install_path = inst.install_path.clone();
                game.playtime_minutes = inst.playtime_minutes.or(game.playtime_minutes);
                game.last_played = inst.last_played.or(game.last_played);
                // `install_dir` is only populated from the manifest (library
                // entries never set it). Use the manifest's value when present
                // so the size-measurement step has a root to walk.
                game.install_dir = inst.install_dir.clone().or(game.install_dir);
            }
            game
        })
        .collect()
}

fn current_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
