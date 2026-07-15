use reqwest::Client;
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

use super::auth::refresh_tokens_if_needed;
use super::types::{EpicAuthTokens, EpicCatalogItem, EpicFilterOptions, EpicGame, EpicGameAsset, EpicMainGameItem, EpicSyncResult, EpicSyncedGame};
use crate::size;

/// Sync the user's Epic Games library.
///
/// 1. Refreshes tokens if needed
/// 2. Fetches owned game assets via Epic's internal API
/// 3. Filters to games + launchable DLC only (drops plugins, UE tools,
///    non-launchable DLC, and digital extras — Playnite parity)
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

    // 2. Fetch catalog details for each asset (batch)
    let mut catalog_items = fetch_catalog_batch(&client, &tokens, &assets).await.unwrap_or_else(|e| {
        errors.push(format!("Catalog batch fetch failed: {}", e));
        Vec::new()
    });

    // 2b. Per-item fallback for assets missing from the batch response.
    // The batch endpoint can omit items due to chunk-level HTTP errors,
    // rate limiting, or namespace-level issues. Without this fallback,
    // those games would be silently dropped by the filter. We fetch each
    // missing item individually — slower but recovers games that would
    // otherwise be lost. Skipped if the batch fetch failed entirely
    // (handled by the filter's asset-category fallback instead).
    if !catalog_items.is_empty() {
        let catalog_keys: HashSet<(String, String)> = catalog_items
            .iter()
            .map(|ci| (ci.namespace.clone(), ci.catalog_item_id.clone()))
            .collect();
        let missing: Vec<&EpicGameAsset> = assets
            .iter()
            .filter(|a| !catalog_keys.contains(&(a.namespace.clone(), a.catalog_item_id.clone())))
            .collect();

        if !missing.is_empty() {
            for asset in &missing {
                match fetch_catalog_single(&client, &tokens, &asset.namespace, &asset.catalog_item_id).await {
                    Ok(Some(ci)) => catalog_items.push(ci),
                    Ok(None) => {
                        // Item genuinely has no catalog entry (delisted,
                        // region-locked). Not an error — the filter will
                        // fall back to asset categories.
                    }
                    Err(e) => {
                        errors.push(e);
                    }
                }
            }
        }
    }

    // 3. Filter owned, launchable games
    let owned_games = filter_owned_games(&assets, &catalog_items);
    let skipped = assets.len().saturating_sub(owned_games.len());

    // Log diagnostic counts so the user / dev can see if the sync is
    // dropping games. Printed to stderr rather than pushed into the
    // `errors` vec — the errors vec is for actual errors surfaced in
    // the Settings UI, and an informational count is not an error.
    eprintln!(
        "[epic-sync] {} assets fetched, {} catalog items resolved, {} games imported, {} filtered out",
        assets.len(), catalog_items.len(), owned_games.len(), skipped
    );

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
/// Epic's library API returns a `responseMetadata.nextCursor` (lowercase 'd'
/// — matching Legendary and Playnite) when more pages are available. We walk
/// the cursor until it is null/empty — empty `records[]` mid-stream is NOT a
/// terminator because Epic can legitimately serve a transient empty page
/// while still advertising a follow-up cursor (region-filtered items,
/// purchase-migration transitions, etc.). The only true end-of-stream signal
/// is `nextCursor == null/""`. A stale `responseMetaData` (uppercase 'D')
/// fallback is kept for any legacy edge, and top-level `cursor` for older
/// API shapes.
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

        // Epic's library API returns the pagination cursor under
        // `responseMetadata` (lowercase 'd'). The prior code checked
        // `responseMetaData` (uppercase 'D'), which never matched the
        // real API shape — so the cursor was always read as None after
        // page 1, truncating the library to the first page (~50 items).
        // Legendary and Playnite both use `responseMetadata`. We keep
        // the uppercase variant as a fallback for any legacy edge.
        let next_cursor = json["responseMetadata"]["nextCursor"]
            .as_str()
            .or_else(|| json["responseMetaData"]["nextCursor"].as_str())
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
            // `includeDLCDetails=true` is required for DLC catalog
            // entries to return properly (Legendary passes both it and
            // includeMainGameDetails). Without it, some DLC items may
            // be omitted from the batch response.
            let url = format!(
                "https://catalog-public-service-prod06.ol.epicgames.com/catalog/api/shared/namespace/{}/bulk/items?id={}&country=US&locale=en-US&includeDLCDetails=true&includeMainGameDetails=true",
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
                    parse_catalog_item(namespace, catalog_id, item)
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

/// Fetch a single catalog item individually.
///
/// Used as a fallback for assets that were missing from the batch
/// response — a chunk-level HTTP error, rate limit, or a namespace
/// the batch endpoint returned an empty object for. Fetching
/// individually is slower (one request per item) but recovers games
/// that would otherwise be silently dropped.
///
/// Returns `None` if the item genuinely has no catalog entry (it was
/// delisted, region-locked, etc.) — that's not an error, just a gap.
async fn fetch_catalog_single(
    client: &Client,
    tokens: &EpicAuthTokens,
    namespace: &str,
    catalog_item_id: &str,
) -> Result<Option<EpicCatalogItem>, String> {
    let url = format!(
        "https://catalog-public-service-prod06.ol.epicgames.com/catalog/api/shared/namespace/{}/bulk/items?id={}&country=US&locale=en-US&includeDLCDetails=true&includeMainGameDetails=true",
        namespace, catalog_item_id
    );

    let response = client
        .get(&url)
        .bearer_auth(&tokens.access_token)
        .send()
        .await
        .map_err(|e| format!("Single catalog fetch failed for {}/{}: {}", namespace, catalog_item_id, e))?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(format!(
            "Catalog HTTP {} for {}/{}: {}",
            status, namespace, catalog_item_id, body
        ));
    }

    let json: Value = serde_json::from_str(&body)
        .map_err(|e| format!("Catalog JSON parse error for {}/{}: {}", namespace, catalog_item_id, e))?;

    // The bulk endpoint returns a dict keyed by catalog item ID.
    // Even for a single-item request, the shape is the same.
    let item = json
        .as_object()
        .and_then(|obj| obj.get(catalog_item_id))
        .filter(|v| v.is_object());

    let item = match item {
        Some(i) => i,
        None => return Ok(None),
    };

    // Reuse the shared parsing logic — returns `None` if the item is
    // missing required fields (e.g. no title), which means the catalog
    // entry is genuinely unusable.
    Ok(parse_catalog_item(namespace, catalog_item_id, item))
}

/// Parse a single catalog item from Epic's JSON response into an
/// `EpicCatalogItem`.
///
/// Shared between `fetch_catalog_batch` (called in a `filter_map`
/// closure that returns `Option`) and `fetch_catalog_single` (called
/// directly, returning `Result<Option<_>, _>`). Returns `None` when
/// the item is missing required fields (e.g. no `title`).
///
/// Epic wraps each `customAttributes` value in `{ value: "..." }`; we
/// read the inner `value` field so the downstream EA/Ubisoft checks
/// actually work. `mainGameItem` is present only on DLC/add-on entries.
fn parse_catalog_item(namespace: &str, catalog_id: &str, item: &Value) -> Option<EpicCatalogItem> {
    Some(EpicCatalogItem {
        namespace: namespace.to_string(),
        catalog_item_id: catalog_id.to_string(),
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
                    .filter_map(|(k, v)| {
                        v["value"]
                            .as_str()
                            .or_else(|| v.as_str())
                            .map(|s| (k.clone(), s.to_string()))
                    })
                    .collect()
            }),
        main_game_item: item["mainGameItem"].as_object().map(|o| EpicMainGameItem {
            namespace: o.get("namespace").and_then(|n| n.as_str()).map(|s| s.to_string()),
            id: o.get("id").and_then(|i| i.as_str()).map(|s| s.to_string()),
        }),
    })
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

/// Filter owned assets to games + launchable DLC only.
///
/// Mirrors Playnite's EpicLibrary `GetLibraryGames()` filter chain:
///
///   1.  Structural exclusions (asset-level): drop the `ue` namespace,
///       `PRIVATE` sandboxes, empty `appName`s, and `UE_*` app names.
///   2.  Category allow-list: the catalog item's `categories[].path` MUST
///       contain `"applications"` exactly. This is the authoritative gate
///       — the **catalog** API (not the library/entitlements API) is where
///       Epic stores reliable category data. The prior implementation
///       checked `asset.categories` from the library API, which is
///       frequently empty or inconsistently populated, causing every
///       asset to be rejected and **zero games to sync**.
///   3.  DLC filter: if `mainGameItem` is present (the item is a DLC),
///       require `"addons/launchable"` in the category paths. This keeps
///       launchable DLC (expansions, content packs the user can play)
///       and drops non-launchable DLC (cosmetic bundles, soundtracks,
///       digital extras that aren't independently playable).
///   4.  Deny-list: drop `"plugins"`, `"plugins/engine"`, and
///       `"digitalextras"` even if they somehow have `"applications"`.
///   5.  Third-party managed apps: exclude EA App and Ubisoft titles by
///       default (they require their own launcher and don't launch via
///       the Epic protocol).
///
/// If an asset has no catalog entry (delisted, region-locked, or the
/// catalog fetch failed), we fall back to the asset's own `categories`
/// field so games can still import with degraded metadata. This mirrors
/// Playnite's resilience — a missing catalog item should never cause a
/// legitimately owned game to be dropped from the library.
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
            // ── Stage 1: structural exclusions (asset-level) ──────────
            // Mirrors Playnite's `assets.Where(a => a.@namespace != "ue"
            // && a.sandboxType != "PRIVATE" && !a.appName.IsNullOrEmpty())`.
            if asset.namespace.eq_ignore_ascii_case("ue") {
                return None;
            }
            if asset.sandbox_type.as_deref() == Some("PRIVATE") {
                return None;
            }
            if asset.app_name.is_empty() {
                return None;
            }
            if asset.app_name.to_uppercase().starts_with("UE_") {
                return None;
            }

            let catalog = catalog_map
                .get(&(asset.namespace.as_str(), asset.catalog_item_id.as_str()))
                .copied();

            // ── Stage 2: resolve category paths ───────────────────────
            // The catalog API's `categories[].path` is the authoritative
            // source. If the catalog fetch succeeded but this specific
            // asset has no catalog entry (even after the per-item
            // fallback), fall back to the asset's own categories rather
            // than dropping it — some games (delisted, region-locked) have
            // no catalog data but are still legitimately owned and
            // launchable. This is the Playnite-parity "don't lose games"
            // approach. If the entire catalog fetch failed, the same
            // fallback applies.
            let cat_paths: &[String] = if let Some(ci) = catalog {
                &ci.categories
            } else {
                &asset.categories
            };

            // Require `"applications"` exactly (Playnite: `a.path == "applications"`).
            if !cat_paths.iter().any(|c| c == "applications") {
                return None;
            }

            // ── Stage 3: DLC filter (Playnite parity) ─────────────────
            // If `mainGameItem` is present and has an `id`, this is a DLC.
            // Keep it only if it has `addons/launchable` (launchable DLC).
            // Drop non-launchable DLC (cosmetics, soundtracks, etc.).
            if let Some(ci) = catalog {
                if let Some(mgi) = &ci.main_game_item {
                    if mgi.id.as_deref().is_some() {
                        if !cat_paths.iter().any(|c| c == "addons/launchable") {
                            return None;
                        }
                    }
                }
            }

            // ── Stage 4: deny-list (Playnite parity) ──────────────────
            // Exclude plugins, engine plugins, and digital extras even
            // if they have `applications` (defence-in-depth).
            if cat_paths.iter().any(|c| {
                c == "plugins" || c == "plugins/engine" || c == "digitalextras"
            }) {
                return None;
            }

            // ── Stage 5: third-party managed apps ─────────────────────
            // Exclude EA App and Ubisoft managed games — they require
            // their own launchers and don't launch via the Epic protocol.
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

            // ── Build the EpicGame entry ──────────────────────────────
            let title = catalog
                .map(|ci| ci.title.clone())
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
                categories: cat_paths.to_vec(),
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

// ── Unit tests ─────────────────────────────────────────────────────
// Tests focus on `filter_owned_games` — the function that decides which
// owned assets become library entries. These cover the regression that
// motivated this fix (catalog categories vs asset categories) plus the
// Playnite-parity filter chain (DLC, plugins, third-party apps).
#[cfg(test)]
mod tests {
    use super::*;
    use crate::epic::types::{EpicCatalogItem, EpicGameAsset, EpicMainGameItem};
    use std::collections::HashMap;

    fn asset(ns: &str, id: &str, app: &str) -> EpicGameAsset {
        EpicGameAsset {
            namespace: ns.to_string(),
            catalog_item_id: id.to_string(),
            app_name: app.to_string(),
            sandbox_type: None,
            build_version: None,
            categories: Vec::new(),
            item_type: None,
        }
    }

    fn catalog(ns: &str, id: &str, title: &str, cats: &[&str]) -> EpicCatalogItem {
        EpicCatalogItem {
            namespace: ns.to_string(),
            catalog_item_id: id.to_string(),
            title: title.to_string(),
            description: None,
            categories: cats.iter().map(|s| s.to_string()).collect(),
            sandbox_type: None,
            developer: None,
            publisher: None,
            release_date: None,
            cover_url: None,
            custom_attributes: None,
            main_game_item: None,
        }
    }

    /// A base game with `applications` in the catalog categories should
    /// pass the filter — this is the happy path that was broken before.
    #[test]
    fn base_game_with_applications_syncs() {
        let assets = vec![asset("ns1", "id1", "GameApp")];
        let catalogs = vec![catalog("ns1", "id1", "My Game", &["applications"])];
        let result = filter_owned_games(&assets, &catalogs);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].title, "My Game");
    }

    /// A DLC with `addons/launchable` should sync (user wants DLC).
    #[test]
    fn launchable_dlc_syncs() {
        let assets = vec![asset("ns1", "dlc1", "DLCApp")];
        let mut ci = catalog("ns1", "dlc1", "My DLC", &["applications", "addons/launchable"]);
        ci.main_game_item = Some(EpicMainGameItem {
            namespace: Some("ns1".to_string()),
            id: Some("base_id".to_string()),
        });
        let catalogs = vec![ci];
        let result = filter_owned_games(&assets, &catalogs);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].title, "My DLC");
    }

    /// A DLC without `addons/launchable` (e.g. cosmetic bundle) should be
    /// dropped — it's not independently playable.
    #[test]
    fn non_launchable_dlc_filtered() {
        let assets = vec![asset("ns1", "dlc2", "CosmeticApp")];
        let mut ci = catalog("ns1", "dlc2", "Cosmetics Pack", &["applications"]);
        ci.main_game_item = Some(EpicMainGameItem {
            namespace: Some("ns1".to_string()),
            id: Some("base_id".to_string()),
        });
        let catalogs = vec![ci];
        let result = filter_owned_games(&assets, &catalogs);
        assert_eq!(result.len(), 0, "non-launchable DLC should be filtered out");
    }

    /// An Unreal Engine plugin should be dropped by the deny-list.
    #[test]
    fn plugin_filtered() {
        let assets = vec![asset("ns2", "id2", "PluginApp")];
        let catalogs = vec![catalog("ns2", "id2", "UE Plugin", &["applications", "plugins"])];
        let result = filter_owned_games(&assets, &catalogs);
        assert_eq!(result.len(), 0, "plugins should be filtered out");
    }

    /// The `ue` namespace should be dropped (Unreal Engine tools).
    #[test]
    fn ue_namespace_filtered() {
        let assets = vec![asset("ue", "id3", "UETarget")];
        let catalogs = vec![catalog("ue", "id3", "UE Tool", &["applications"])];
        let result = filter_owned_games(&assets, &catalogs);
        assert_eq!(result.len(), 0, "ue namespace should be filtered out");
    }

    /// A catalog item without `applications` should be dropped.
    #[test]
    fn non_applications_filtered() {
        let assets = vec![asset("ns3", "id4", "EditorApp")];
        let catalogs = vec![catalog("ns3", "id4", "Editor", &["games/editors/base"])];
        let result = filter_owned_games(&assets, &catalogs);
        assert_eq!(result.len(), 0, "non-applications items should be filtered");
    }

    /// An asset with no catalog entry should fall back to the asset's
    /// own categories rather than being dropped — this is the
    /// "don't lose games" resilience that prevents incomplete syncs.
    /// Even when catalog data IS available for other assets, a missing
    /// catalog entry (delisted, region-locked) shouldn't lose the game.
    #[test]
    fn missing_catalog_falls_back_to_asset_categories() {
        let mut a = asset("ns4", "id5", "OrphanGame");
        a.categories = vec!["applications".to_string()];
        let assets = vec![a];
        // Catalog data exists for a DIFFERENT asset — proves the
        // fallback isn't gated on "catalog fetch failed entirely".
        let catalogs = vec![catalog("other", "other", "Other", &["applications"])];
        let result = filter_owned_games(&assets, &catalogs);
        assert_eq!(result.len(), 1, "orphan asset should fall back to its own categories");
        assert_eq!(result[0].title, "OrphanGame");
    }

    /// When the catalog fetch failed entirely (empty catalog list),
    /// all assets fall back to their own categories.
    #[test]
    fn catalog_failure_falls_back_to_asset_categories() {
        let mut a = asset("ns5", "id6", "FallbackGame");
        a.categories = vec!["applications".to_string()];
        let assets = vec![a];
        let catalogs: Vec<EpicCatalogItem> = Vec::new();
        let result = filter_owned_games(&assets, &catalogs);
        assert_eq!(result.len(), 1, "should fall back to asset categories on catalog failure");
        assert_eq!(result[0].title, "FallbackGame");
    }

    /// An asset with no catalog entry AND no asset categories should
    /// be dropped — we have no way to classify it at all.
    #[test]
    fn no_catalog_and_no_asset_categories_filtered() {
        let assets = vec![asset("ns6", "id7", "MysteryApp")];
        let catalogs = vec![catalog("other", "other", "Other", &["applications"])];
        let result = filter_owned_games(&assets, &catalogs);
        assert_eq!(result.len(), 0, "assets with no categories anywhere should be filtered");
    }

    /// EA-managed games should be filtered out by default.
    #[test]
    fn ea_managed_app_filtered() {
        let assets = vec![asset("ns6", "id7", "EAGame")];
        let mut ci = catalog("ns6", "id7", "EA Game", &["applications"]);
        let mut attrs = HashMap::new();
        attrs.insert("ThirdPartyManagedApp".to_string(), "the ea app".to_string());
        ci.custom_attributes = Some(attrs);
        let catalogs = vec![ci];
        let result = filter_owned_games(&assets, &catalogs);
        assert_eq!(result.len(), 0, "EA-managed apps should be filtered");
    }

    /// Digital extras should be filtered by the deny-list.
    #[test]
    fn digital_extras_filtered() {
        let assets = vec![asset("ns7", "id8", "ExtraApp")];
        let catalogs = vec![catalog("ns7", "id8", "Digital Extra", &["applications", "digitalextras"])];
        let result = filter_owned_games(&assets, &catalogs);
        assert_eq!(result.len(), 0, "digital extras should be filtered");
    }
}
