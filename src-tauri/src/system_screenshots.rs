//! System screenshot folder detection.
//!
//! Scans well-known directories for captures from:
//! - NVIDIA ShadowPlay / GeForce Experience
//! - AMD Radeon ReLive / Adrenalin
//! - OBS Studio
//!
//! Each discovered folder is returned with a `source` label so the
//! frontend can badge groups distinctly.

use serde::{Deserialize, Serialize};

/// One folder group returned by the scanner.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SystemScreenshotFolder {
    /// Source identifier: "nvidia", "amd", or "obs".
    pub source: String,
    /// Human-readable group name (game name, folder name, or source label).
    pub game_name: String,
    /// Absolute path to the folder containing these screenshots.
    pub folder_path: String,
    /// Sorted list of absolute paths to image files in this folder.
    pub screenshots: Vec<String>,
}

/// Non-recursive image-file lister for a single directory.
/// Sorted by modified time, newest first.
fn list_image_files_flat(dir: &std::path::Path) -> Vec<String> {
    let mut paths = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                    let lower = ext.to_lowercase();
                    if lower == "jpg" || lower == "jpeg" || lower == "png"
                        || lower == "gif" || lower == "bmp" || lower == "webp"
                    {
                        paths.push(p.to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    paths.sort_by(|a, b| {
        let ma = std::fs::metadata(a).ok().and_then(|m| m.modified().ok());
        let mb = std::fs::metadata(b).ok().and_then(|m| m.modified().ok());
        mb.cmp(&ma)
    });
    paths
}

/// Auto-detect screenshots from non-Steam capture tools.
///
/// Scans well-known default directories for:
/// - NVIDIA ShadowPlay / GeForce Experience (%USERPROFILE%\Videos, game subfolders)
/// - AMD Radeon ReLive (%USERPROFILE%\Videos\Radeon ReLive)
/// - OBS Studio (%USERPROFILE%\Videos)
///
/// Each source is returned as a separate folder group so the frontend
/// can badge them distinctly (NVIDIA green, AMD red, OBS white).
/// Returns an empty Vec when none of the known folders exist or contain images.
#[tauri::command]
pub fn detect_system_screenshot_folders() -> Vec<SystemScreenshotFolder> {
    let userprofile = match std::env::var("USERPROFILE") {
        Ok(p) => std::path::PathBuf::from(p),
        Err(_) => return Vec::new(),
    };

    let mut results: Vec<SystemScreenshotFolder> = Vec::new();

    // ---- NVIDIA ShadowPlay ----
    // Default: %USERPROFILE%\Videos, organized into per-game subfolders.
    let nv_root = userprofile.join("Videos");
    if nv_root.exists() && nv_root.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&nv_root) {
            for entry in entries.flatten() {
                let p = entry.path();
                if !p.is_dir() {
                    continue;
                }
                let game_name = p
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Unknown")
                    .to_string();
                // Skip known non-game folders
                let lower = game_name.to_lowercase();
                if lower == "desktop" || lower == "captures" || lower == "radeon relive" {
                    continue;
                }
                let images = list_image_files_flat(&p);
                if !images.is_empty() {
                    results.push(SystemScreenshotFolder {
                        source: "nvidia".to_string(),
                        game_name,
                        folder_path: p.to_string_lossy().to_string(),
                        screenshots: images,
                    });
                }
            }
        }
    }

    // ---- AMD Radeon ReLive ----
    let amd_root = userprofile.join("Videos").join("Radeon ReLive");
    if amd_root.exists() && amd_root.is_dir() {
        let mut found_amd = false;
        if let Ok(entries) = std::fs::read_dir(&amd_root) {
            for entry in entries.flatten() {
                let p = entry.path();
                if !p.is_dir() {
                    continue;
                }
                let game_name = p
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Unknown")
                    .to_string();
                let images = list_image_files_flat(&p);
                if !images.is_empty() {
                    found_amd = true;
                    results.push(SystemScreenshotFolder {
                        source: "amd".to_string(),
                        game_name,
                        folder_path: p.to_string_lossy().to_string(),
                        screenshots: images,
                    });
                }
            }
        }
        // If no subfolders had images, scan the root folder itself
        if !found_amd {
            let images = list_image_files_flat(&amd_root);
            if !images.is_empty() {
                results.push(SystemScreenshotFolder {
                    source: "amd".to_string(),
                    game_name: "AMD ReLive".to_string(),
                    folder_path: amd_root.to_string_lossy().to_string(),
                    screenshots: images,
                });
            }
        }
    }

    // ---- OBS Studio ----
    // OBS defaults to %USERPROFILE%\Videos with no subfolder, but scanning
    // the root Videos dir is too broad (would pick up non-OBS content).
    // Only scan the dedicated OBS subfolder if the user configured one.
    let obs_dir = userprofile.join("Videos").join("OBS");
    if obs_dir.exists() && obs_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&obs_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if !p.is_dir() {
                    continue;
                }
                let sub_name = p
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Unknown")
                    .to_string();
                let images = list_image_files_flat(&p);
                if !images.is_empty() {
                    results.push(SystemScreenshotFolder {
                        source: "obs".to_string(),
                        game_name: sub_name,
                        folder_path: p.to_string_lossy().to_string(),
                        screenshots: images,
                    });
                }
            }
        }
        // Also check for loose screenshots in the OBS folder itself
        if results.iter().filter(|r| r.source == "obs").count() == 0 {
            let images = list_image_files_flat(&obs_dir);
            if !images.is_empty() {
                results.push(SystemScreenshotFolder {
                    source: "obs".to_string(),
                    game_name: "OBS Studio".to_string(),
                    folder_path: obs_dir.to_string_lossy().to_string(),
                    screenshots: images,
                });
            }
        }
    }

    results
}
