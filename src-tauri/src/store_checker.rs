//! Cross-store ownership verification.
//!
//! The original plan called for `store_checker.rs` to maintain its own
//! list of owned Steam appids / Epic namespaces fed by separate Tauri
//! commands. The user explicitly chose **"Reuse existing syncs"** so
//! ownership data flows through the existing `steam::sync::SteamSyncResult`
//! and `epic::sync::EpicSyncResult` paths instead — when the frontend
//! receives a sync result, it calls the small `set_*_owned` setters
//! here. That keeps ownership state authoritative with the rest of the
//! library (no risk of a user revoking access in one place but not the
//! other) and avoids a second round of HTTP calls.
//!
//! Local-library ownership is computed by name normalization on demand
//! — the library is in-memory in the React tree, so a normalized
//! `HashSet<String>` would be a second copy. Instead we accept a
//! `Vec<String>` snapshot per check and fuzzy-match against the
//! queried game name.
//!
//! ## Performance
//!
//! Ownership checks run inline inside `DownloadModal` while the user
//! is reading. They take a normalized comparison across at most a few
//! thousand library entries; the cost is `O(n × m)` where `n` is
//! library size and `m` is the search string length. For a 5,000-game
//! library this is sub-millisecond on any modern CPU. The fuzzy
//! substring pass short-circuits on the first hit so the worst case
//! is the no-match path.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Per-store ownership row returned to the frontend.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoreOwnership {
    /// "Steam" | "Epic" | "Local"
    pub store: String,
    pub owned: bool,
    /// Store-specific id (Steam appid, Epic namespace:itemId, etc.)
    /// when the match is exact. `None` for fuzzy local matches.
    pub store_game_id: Option<String>,
    /// Free-form detail string for the UI ("In library", "Playtime 42h").
    pub details: Option<String>,
}

/// Top-level ownership query result.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OwnershipResult {
    /// The display name the user was searching for. Echoed back so
    /// the frontend doesn't have to thread its own copy through the
    /// RPC payload.
    pub game_name: String,
    pub owned_stores: Vec<StoreOwnership>,
    pub is_owned_anywhere: bool,
}

/// Internal ownership store. The Steam / Epic `HashSet` fields are
/// owned by `StoreChecker` and updated via `set_*` setters from the
/// frontend after a successful sync. They live behind a `Mutex` so
/// the Tauri command layer can `lock().await` cleanly. We deliberately
/// do NOT wrap the whole struct in `Arc<Mutex<...>>` at the Tauri
/// `manage` call site — the Tauri state itself is `Arc<Mutex<>>` from
/// the `tauri::State` machinery, so an inner `Mutex` is sufficient.
pub struct StoreChecker {
    steam_appids: HashSet<u32>,
    epic_owned_ids: HashSet<String>,
}

impl StoreChecker {
    pub fn new() -> Self {
        Self {
            steam_appids: HashSet::new(),
            epic_owned_ids: HashSet::new(),
        }
    }

    /// Replace the Steam-owned appid set. Called by the frontend after
    /// `steam_sync_games` returns a successful result.
    pub fn set_steam_owned(&mut self, appids: Vec<u32>) {
        self.steam_appids = appids.into_iter().collect();
    }

    /// Replace the Epic-owned id set. Each id is the composite
    /// `"{namespace}:{catalogItemId}"` so the frontend doesn't have to
    /// send two parallel arrays.
    pub fn set_epic_owned(&mut self, ids: Vec<String>) {
        self.epic_owned_ids = ids.into_iter().collect();
    }

    /// Check ownership for a single game name. The `local_library_names`
    /// is a snapshot of the user's current library at the time of the
    /// check (the canonical library lives in the React store; passing
    /// it in keeps this module stateless w.r.t. the library itself).
    ///
    /// Matching strategy:
    ///   1. Normalize the query (`lowercase`, strip non-alphanumeric).
    ///   2. Exact normalized match against every library name.
    ///   3. If no exact match, fall back to a "query is a substring of
    ///      library name" or vice versa. Returns the first hit, capped
    ///      at one local match per query so a fuzzy string can't claim
    ///      ownership across wildly-different titles.
    pub fn check(&self, game_name: &str, local_library_names: &[String]) -> OwnershipResult {
        let normalized_query = normalize(game_name);
        let owned_stores = vec![
            self.local_match(&normalized_query, game_name, local_library_names),
            self.steam_match(&normalized_query),
            self.epic_match(&normalized_query),
        ];
        let is_owned_anywhere = owned_stores.iter().any(|s| s.owned);
        OwnershipResult {
            game_name: game_name.to_string(),
            owned_stores,
            is_owned_anywhere,
        }
    }

    fn local_match(
        &self,
        normalized_query: &str,
        _original: &str,
        local_library_names: &[String],
    ) -> StoreOwnership {
        // Pass 1: exact normalized match. Cheap and unambiguous.
        for name in local_library_names {
            if normalize(name) == normalized_query {
                return StoreOwnership {
                    store: "Local".to_string(),
                    owned: true,
                    store_game_id: None,
                    details: Some("In library".to_string()),
                };
            }
        }
        // Pass 2: substring. We only do this when the normalized
        // query is at least 4 characters long — anything shorter
        // produces too many false positives (e.g. "it" matches
        // "The Witcher 3" but the user probably doesn't mean that).
        if normalized_query.len() >= 4 {
            for name in local_library_names {
                let norm_name = normalize(name);
                if norm_name.contains(normalized_query) || normalized_query.contains(&norm_name) {
                    return StoreOwnership {
                        store: "Local".to_string(),
                        owned: true,
                        store_game_id: None,
                        details: Some(format!("Fuzzy match: \"{}\"", name)),
                    };
                }
            }
        }
        StoreOwnership {
            store: "Local".to_string(),
            owned: false,
            store_game_id: None,
            details: None,
        }
    }

    fn steam_match(&self, normalized_query: &str) -> StoreOwnership {
        // TODO: cache (appid, normalized_name) tuples from the last
        // steam_sync_games call so we can fuzzy-match a name against
        // owned Steam games without an extra API call. Until that
        // lands, we always return `owned: false` here and the
        // DownloadModal is expected to use the `check_ownership_for_ids`
        // variant when it has the IGDB-derived Steam appid. The
        // returned `details` string is the user-facing signal that
        // "we know this exists on Steam, but couldn't confirm
        // ownership from name alone" — the modal renders it as
        // a tooltip on the Steam pill.
        StoreOwnership {
            store: "Steam".to_string(),
            owned: false,
            store_game_id: None,
            details: Some(format!(
                "Need Steam appid to confirm ownership of \"{}\"",
                normalized_query
            )),
        }
    }

    fn epic_match(&self, normalized_query: &str) -> StoreOwnership {
        // TODO: same as `steam_match` — cache the
        // (namespace:catalogItemId, title) tuples from the last
        // epic_sync_library call so the name-based fallback works.
        // Until then the frontend must use `check_ownership_for_ids`
        // with the IGDB-derived Epic id for an exact hit.
        StoreOwnership {
            store: "Epic".to_string(),
            owned: false,
            store_game_id: None,
            details: Some(format!(
                "Need Epic catalog id to confirm ownership of \"{}\"",
                normalized_query
            )),
        }
    }
}

/// Normalize a game name for comparison. Same rules as `size::normalize`
/// (lowercase + alphanumeric-only) so "The Witcher 3 — Wild Hunt!",
/// "the_witcher_3", and "The-Witcher-3" all collapse to the same key.
fn normalize(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

// ─── Tauri commands ─────────────────────────────────────────────────────────

/// Check ownership for a single game name. See `StoreChecker::check`
/// for the matching strategy.
///
/// `local_library_names` is a snapshot of the user's library at the
/// time of the check; the frontend reads it from `GameContext` and
/// passes it in. We don't try to read the library from Rust because
/// it's owned by the React tree and re-hydrating it on every call
/// would mean either a separate Tauri command after every game add
/// or duplicating the in-memory store.
#[tauri::command]
pub async fn check_ownership(
    state: tauri::State<'_, Arc<Mutex<StoreChecker>>>,
    game_name: String,
    local_library_names: Vec<String>,
) -> Result<OwnershipResult, String> {
    let checker = state.lock().await;
    Ok(checker.check(&game_name, &local_library_names))
}

/// Exact-id ownership check for games where the frontend knows the
/// Steam appid or Epic namespace:itemId (e.g. for IGDB-sourced store
/// pages). Faster and more reliable than the name-based fallback.
#[tauri::command]
pub async fn check_ownership_for_ids(
    state: tauri::State<'_, Arc<Mutex<StoreChecker>>>,
    game_name: String,
    steam_appid: Option<u32>,
    epic_owned_id: Option<String>,
    local_library_names: Vec<String>,
) -> Result<OwnershipResult, String> {
    let checker = state.lock().await;
    let mut result = checker.check(&game_name, &local_library_names);

    // Patch the Steam / Epic rows with the exact-id results so the
    // UI can show "Owned on Steam" without the name-fuzz caveat.
    if let Some(appid) = steam_appid {
        if let Some(row) = result.owned_stores.iter_mut().find(|s| s.store == "Steam") {
            let owned = checker.steam_appids.contains(&appid);
            row.owned = owned;
            row.store_game_id = Some(appid.to_string());
            row.details = if owned {
                Some("Owned on Steam".to_string())
            } else {
                Some("Not on Steam".to_string())
            };
        }
    }
    if let Some(id) = epic_owned_id {
        if let Some(row) = result.owned_stores.iter_mut().find(|s| s.store == "Epic") {
            let owned = checker.epic_owned_ids.contains(&id);
            row.owned = owned;
            row.store_game_id = Some(id.clone());
            row.details = if owned {
                Some("Owned on Epic".to_string())
            } else {
                Some("Not on Epic".to_string())
            };
        }
    }
    result.is_owned_anywhere = result.owned_stores.iter().any(|s| s.owned);
    Ok(result)
}

/// Update the Steam-owned appid set. Called by the frontend after a
/// successful `steam_sync_games` round-trip. Empty Vec is valid (user
/// disconnected or sync returned zero owned games).
#[tauri::command]
pub async fn set_steam_owned(
    state: tauri::State<'_, Arc<Mutex<StoreChecker>>>,
    appids: Vec<u32>,
) -> Result<(), String> {
    state.lock().await.set_steam_owned(appids);
    Ok(())
}

/// Update the Epic-owned id set. Each id is the composite
/// `"{namespace}:{catalogItemId}"`.
#[tauri::command]
pub async fn set_epic_owned(
    state: tauri::State<'_, Arc<Mutex<StoreChecker>>>,
    ids: Vec<String>,
) -> Result<(), String> {
    state.lock().await.set_epic_owned(ids);
    Ok(())
}
