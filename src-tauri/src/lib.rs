use std::path::Path;
use std::process::Command;
use std::time::Instant;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

/// Serializable game data matching the frontend Game type.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GameData {
    id: String,
    name: String,
    path: String,
    platform: String,
    installed: bool,
    play_time: String,
    added_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    cover_art_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    notes: Option<String>,
}

/// Persist the game library to the app's data directory.
#[tauri::command]
fn save_games(app: tauri::AppHandle, games: Vec<GameData>) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let file_path = data_dir.join("games.json");
    let json = serde_json::to_string_pretty(&games).map_err(|e| e.to_string())?;
    std::fs::write(&file_path, json).map_err(|e| e.to_string())?;
    Ok(())
}

/// Load the game library from the app's data directory.
#[tauri::command]
fn load_games(app: tauri::AppHandle) -> Result<Vec<GameData>, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let file_path = data_dir.join("games.json");
    if !file_path.exists() {
        return Ok(Vec::new());
    }
    let json = std::fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

/// Payload emitted via the "game-exited" event when a launched process terminates.
#[derive(Clone, Serialize)]
struct GameExitPayload {
    #[serde(rename = "gameId")]
    game_id: String,
    #[serde(rename = "elapsedSeconds")]
    elapsed_seconds: u64,
}

/// Launch a game executable. A background thread waits for the process to exit,
/// then emits a "game-exited" event so the frontend can update play time.
#[tauri::command]
fn launch_game(
    app: tauri::AppHandle,
    game_id: String,
    game_path: String,
) -> Result<String, String> {
    let path = Path::new(&game_path);

    if !path.exists() {
        return Err(format!("Game executable not found: {}", game_path));
    }

    let cwd = path
        .parent()
        .unwrap_or_else(|| Path::new("."));

    let child = Command::new(path)
        .current_dir(cwd)
        .spawn()
        .map_err(|e| format!("Failed to launch game: {}", e))?;

    let start = Instant::now();

    // Background thread: wait for the game to exit, then report elapsed time
    std::thread::spawn(move || {
        let mut child = child;
        let _ = child.wait();
        let elapsed = start.elapsed().as_secs();
        let _ = app.emit(
            "game-exited",
            GameExitPayload {
                game_id,
                elapsed_seconds: elapsed,
            },
        );
    });

    Ok(format!("Launched: {}", game_path))
}

/// Read an image file from disk and return it as a base64 data URL.
#[tauri::command]
fn read_cover_image(file_path: String) -> Result<String, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err("File not found".into());
    }
    let data = std::fs::read(path).map_err(|e| format!("Failed to read file: {}", e))?;
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let b64 = base64_encode(&data);
    Ok(format!("data:{};base64,{}", mime, b64))
}

/// Simple base64 encoding (no external crate needed).
fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(CHARS[((triple >> 18) & 63) as usize] as char);
        out.push(CHARS[((triple >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(CHARS[((triple >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(CHARS[(triple & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

/// Serializable struct holding metadata about a scanned executable.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ExeInfo {
    path: String,
    size: u64,
    modified_at: u64,
}

/// Recursively scan a directory for .exe files and return their paths, sizes, and modified dates.
#[tauri::command]
fn scan_folder_for_exes(folder_path: String) -> Vec<ExeInfo> {
    let mut exes = Vec::new();
    let path = Path::new(&folder_path);
    if path.is_dir() {
        scan_dir(path, &mut exes);
    }
    exes
}

/// Non-game executables to skip during folder scanning.
const SKIP_KEYWORDS: &[&str] = &["redist", "autorun", "helper", "unin", "crash", "setup", "install", "plugin", "manual", "readme", "register", "7za"];

fn scan_dir(dir: &Path, exes: &mut Vec<ExeInfo>) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            if entry_path.is_dir() {
                // Skip hidden folders and common non-game directories
                if let Some(name) = entry_path.file_name().and_then(|n| n.to_str()) {
                    if name.starts_with('.') || name.starts_with('_') {
                        continue;
                    }
                }
                scan_dir(&entry_path, exes);
            } else if let Some(ext) = entry_path.extension().and_then(|e| e.to_str()) {
                if ext.eq_ignore_ascii_case("exe") {
                    // Skip non-game executables (installers, helpers, crash reporters, etc.)
                    if let Some(stem) = entry_path.file_stem().and_then(|s| s.to_str()) {
                        if SKIP_KEYWORDS.iter().any(|kw| stem.to_lowercase().contains(kw)) {
                            continue;
                        }
                    }
                    if let Ok(meta) = entry.metadata() {
                        let size = meta.len();
                        let modified_at = meta.modified()
                            .ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs())
                            .unwrap_or(0);
                        exes.push(ExeInfo {
                            path: entry_path.to_string_lossy().to_string(),
                            size,
                            modified_at,
                        });
                    }
                }
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![scan_folder_for_exes, launch_game, save_games, load_games, read_cover_image])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
