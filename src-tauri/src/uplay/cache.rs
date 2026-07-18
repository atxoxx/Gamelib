//! Parser for Ubisoft Connect's local product cache (`configurations`).
//!
//! Playnite reads this file as a protobuf-net blob
//! (`UplayCacheGameCollection` → `List<UplayCacheGame>` where each entry
//! carries a `UplayId`, `InstallId`, and a `GameInfo` YAML string) and
//! then deserializes each `GameInfo` as a `ProductInformation` via
//! `Serialization.FromYaml`. We can't link protobuf-net, but the YAML
//! `GameInfo` documents are embedded as plain UTF-8 inside the binary
//! protobuf envelope, so we:
//!
//! 1. Slurp the raw file bytes.
//! 2. Split on the `product_info:` YAML anchor (each cache entry
//!    begins its YAML document with `product_info:`), yielding one raw
//!    slice per game.
//! 3. Parse each slice as `RawProductInfo` via `serde_yaml`, which
//!    tolerates the trailing protobuf bytes (unknown keys + the
//!    length-prefix cruft after the YAML document) because we only map
//!    the fields we care about and `serde_yaml` stops at the first
//!    document boundary.
//! 4. Resolve localized asset URLs against the Ubisoft CDN base,
//!    mirroring Playnite's `Uplay.GetLocalProductCache` localization
//!    stitching.

use serde::Deserialize;
use std::path::Path;

use super::types::{Product, ProductInformation};

/// Ubisoft CDN base for asset image URLs, mirrored from
/// `Uplay.AssertUrlBase`.
pub const ASSET_URL_BASE: &str = "https://ubistatic3-a.akamaihd.net/orbit/uplay_launcher_3_0/assets/";

/// Raw YAML shape of a single cache entry's `GameInfo`. Only the
/// fields Playnite actually reads are mapped; everything else is
/// ignored by serde. `uplay_id` / `install_id` ride alongside the
/// `product_info` document in the protobuf envelope.
#[derive(Debug, Default, Deserialize)]
struct RawProductInfo {
    #[serde(default)]
    product_info: Option<ProductWrapper>,
}

#[derive(Debug, Default, Deserialize)]
struct ProductWrapper {
    #[serde(default)]
    root: Option<GameProduct>,
    #[serde(default)]
    localizations: Option<Localizations>,
    #[serde(default)]
    uplay_id: Option<u64>,
    #[serde(default)]
    install_id: Option<u64>,
}

#[derive(Debug, Default, Deserialize)]
struct GameProduct {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    background_image: Option<String>,
    #[serde(default)]
    thumb_image: Option<String>,
    #[serde(default)]
    logo_image: Option<String>,
    #[serde(default)]
    dialog_image: Option<String>,
    #[serde(default)]
    icon_image: Option<String>,
    #[serde(default)]
    third_party_platform: Option<serde_yaml::Value>,
    #[serde(default)]
    is_ulc: Option<bool>,
    #[serde(default)]
    start_game: Option<serde_yaml::Value>,
    #[serde(default)]
    addons: Option<Vec<Addon>>,
}

#[derive(Debug, Default, Deserialize)]
struct Addon {
    #[serde(default)]
    id: Option<u64>,
}

#[derive(Debug, Default, Deserialize)]
struct Localizations {
    #[serde(default)]
    #[serde(rename = "default")]
    default: Option<std::collections::HashMap<String, String>>,
}

/// Parse the Ubisoft Connect `configurations` cache into product
/// records. Returns an empty vec (never errors) when the cache is
/// missing or unreadable, mirroring Playnite's "client not
/// initialized" path — but we surface `None` via `Ok(Vec::new())` so
/// the sync orchestrator can decide whether to warn.
pub fn get_local_product_cache() -> Vec<ProductInformation> {
    let path = super::configurations_cache_path();
    if path.is_empty() || !Path::new(&path).is_file() {
        return Vec::new();
    }
    match std::fs::read(&path) {
        Ok(bytes) => parse_cache_bytes(&bytes),
        Err(_) => Vec::new(),
    }
}

/// Split raw cache bytes on the `product_info:` YAML boundary and parse
/// each slice. Exposed for unit-testing without touching the
/// filesystem.
pub fn parse_cache_bytes(bytes: &[u8]) -> Vec<ProductInformation> {
    let Ok(text) = std::str::from_utf8(bytes) else {
        return Vec::new();
    };

    let mut products = Vec::new();
    // Each embedded YAML document starts with `product_info:`.
    let marker = "product_info:";
    let mut start = 0usize;
    while let Some(idx) = text[start..].find(marker) {
        let doc_start = start + idx;
        let doc_end = match text[doc_start + marker.len()..].find(marker) {
            Some(rel) => doc_start + marker.len() + rel,
            None => text.len(),
        };
        let slice = &text[doc_start..doc_end];
        start = doc_end;

        if let Some(prod) = parse_one(slice) {
            products.push(prod);
        }
    }
    products
}

fn parse_one(slice: &str) -> Option<ProductInformation> {
    let raw: RawProductInfo = serde_yaml::from_str(slice).ok()?;
    let wrapper = raw.product_info?;
    let root = wrapper.root?;

    let loc = wrapper
        .localizations
        .and_then(|l| l.default)
        .unwrap_or_default();

    let resolve = |key: &Option<String>| -> Option<String> {
        let k = key.as_ref()?;
        if k.is_empty() {
            return None;
        }
        // Localized override (e.g. the value is a localization key).
        if let Some(v) = loc.get(k) {
            return Some(v.clone());
        }
        Some(k.clone())
    };

    let name = resolve(&root.name);
    let background_image = resolve(&root.background_image).map(|s| format!("{ASSET_URL_BASE}{s}"));
    let thumb_image = resolve(&root.thumb_image).map(|s| format!("{ASSET_URL_BASE}{s}"));
    let logo_image = resolve(&root.logo_image).map(|s| format!("{ASSET_URL_BASE}{s}"));
    let dialog_image = resolve(&root.dialog_image).map(|s| format!("{ASSET_URL_BASE}{s}"));
    let icon_image = resolve(&root.icon_image).map(|s| format!("{ASSET_URL_BASE}{s}"));

    let product = Product {
        name,
        background_image,
        thumb_image,
        logo_image,
        dialog_image,
        icon_image,
        third_party_platform: root.third_party_platform.is_some(),
        is_ulc: root.is_ulc.unwrap_or(false),
        has_start_game: root.start_game.is_some(),
        addon_ids: root.addons.unwrap_or_default().into_iter().filter_map(|a| a.id).collect(),
    };

    Some(ProductInformation {
        root: product,
        uplay_id: wrapper.uplay_id,
        install_id: wrapper.install_id,
    })
}

/// One discovered installed Ubisoft game from the registry
/// `SOFTWARE\ubisoft\Launcher\Installs\<uplayId>` key. Mirrors
/// Playnite's `UplayLibrary.GetInstalledGames` output.
#[derive(Debug, Clone)]
pub struct UplayInstalledGame {
    pub uplay_id: String,
    pub name: String,
    pub install_dir: String,
    pub is_installed: bool,
}

/// Scan the registry `SOFTWARE\ubisoft\Launcher\Installs\` keys for
/// installed Ubisoft Connect games. Mirrors Playnite's
/// `UplayLibrary.GetInstalledGames`.
pub fn scan_installed_uplay_games() -> Vec<UplayInstalledGame> {
    scan_installed_uplay_games_inner()
}

#[cfg(windows)]
fn scan_installed_uplay_games_inner() -> Vec<UplayInstalledGame> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    let mut out = Vec::new();
    let root = RegKey::predef(HKEY_LOCAL_MACHINE);

    for view in [
        ("SOFTWARE\\ubisoft\\Launcher\\Installs\\", true),
        ("SOFTWARE\\WOW6432Node\\ubisoft\\Launcher\\Installs\\", true),
    ] {
        let Ok(installs_key) = root.open_subkey(view.0) else {
            continue;
        };
        for sub in installs_key.enum_keys().flatten() {
            let Ok(game_data) = installs_key.open_subkey(&sub) else {
                continue;
            };
            let install_dir: Option<String> = game_data.get_value("InstallDir").ok();
            let Some(dir) = install_dir else {
                continue;
            };
            let dir = dir.replace('/', std::path::MAIN_SEPARATOR_STR);
            let is_installed = !dir.is_empty() && Path::new(&dir).is_dir();
            // Mirror Playnite: name = the install dir's folder name.
            let name = if !dir.is_empty() {
                Path::new(&dir)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| sub.clone())
            } else {
                sub.clone()
            };
            out.push(UplayInstalledGame {
                uplay_id: sub.clone(),
                name,
                install_dir: if is_installed { dir } else { String::new() },
                is_installed,
            });
        }
    }
    out
}

#[cfg(not(windows))]
fn scan_installed_uplay_games_inner() -> Vec<UplayInstalledGame> {
    Vec::new()
}
