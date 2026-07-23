//! Local (crack / emulator) achievement discovery + parsing.
//!
//! A Windows-only Rust port of Hydra Launcher's
//! `find-achievement-files.ts` + `parse-achievement-file.ts`. Cracked /
//! repacked games ship achievement emulators (Goldberg, CODEX, RUNE,
//! OnlineFix, RLD!, Skidrow, CreamAPI, SmartSteamEmu, EMPRESS,
//! Razor1911, 3DM, …) that write local achievement state files under
//! well-known folders (`%APPDATA%`, `C:\Users\Public\Documents`,
//! `C:\ProgramData`, …), keyed by the game's **Steam appid**
//! (`objectId`).
//!
//! This module locates those files for a given appid and parses them
//! into `UnlockedAchievement { name, unlock_time }`. `unlock_time` is
//! kept in **milliseconds** here (matching Hydra's parsers verbatim);
//! callers convert to seconds when merging into the Steam-shaped
//! `Achievement` model.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde_json::Value;

/// Known achievement emulators / crackers.
// `Flt` / `Steam` are parsed but not folder-scanned yet (Steam userdata
// discovery is intentionally out of scope for the first pass).
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Cracker {
    Codex,
    Rune,
    OnlineFix,
    Goldberg,
    UserStats,
    Rld,
    CreamApi,
    Skidrow,
    SmartSteamEmu,
    Empress,
    Flt,
    Razor1911,
    Rle,
    Threedm,
    Steam,
}

/// A parsed, on-disk achievement record: the internal achievement name
/// (matches Steam's `name` / api_name) and the unlock time in **ms**.
#[derive(Debug, Clone)]
pub struct UnlockedAchievement {
    pub name: String,
    pub unlock_time: u64,
}

/// A located achievement file + which cracker format it uses.
#[derive(Debug, Clone)]
pub struct AchievementFile {
    pub cracker: Cracker,
    pub path: PathBuf,
}

// ── Base directories (Windows only) ─────────────────────────────────────

fn app_data() -> PathBuf {
    std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_default()
}

fn local_app_data() -> PathBuf {
    std::env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_default()
}

fn program_data() -> PathBuf {
    std::env::var("ProgramData")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(r"C:\ProgramData"))
}

fn documents() -> PathBuf {
    std::env::var("USERPROFILE")
        .map(|p| PathBuf::from(p).join("Documents"))
        .unwrap_or_default()
}

fn public_documents() -> PathBuf {
    PathBuf::from(r"C:\Users\Public\Documents")
}

/// The set of crackers we scan for, in priority order.
const CRACKERS: &[Cracker] = &[
    Cracker::Codex,
    Cracker::Goldberg,
    Cracker::Rune,
    Cracker::OnlineFix,
    Cracker::Rld,
    Cracker::CreamApi,
    Cracker::Skidrow,
    Cracker::SmartSteamEmu,
    Cracker::Empress,
    Cracker::Razor1911,
    Cracker::Rle,
];

/// A folder to scan + the file location template inside each
/// `<objectId>` subfolder. `<objectId>` placeholders are substituted
/// with the game's Steam appid.
struct CrackerPath {
    folder: PathBuf,
    file_location: Vec<&'static str>,
}

fn paths_for_cracker(cracker: Cracker) -> Vec<CrackerPath> {
    match cracker {
        Cracker::Codex => vec![
            CrackerPath {
                folder: public_documents().join("Steam").join("CODEX"),
                file_location: vec!["<objectId>", "achievements.ini"],
            },
            CrackerPath {
                folder: app_data().join("Steam").join("CODEX"),
                file_location: vec!["<objectId>", "achievements.ini"],
            },
        ],
        Cracker::Rune => vec![CrackerPath {
            folder: public_documents().join("Steam").join("RUNE"),
            file_location: vec!["<objectId>", "achievements.ini"],
        }],
        Cracker::OnlineFix => vec![
            CrackerPath {
                folder: public_documents().join("OnlineFix"),
                file_location: vec!["<objectId>", "Stats", "Achievements.ini"],
            },
            CrackerPath {
                folder: public_documents().join("OnlineFix"),
                file_location: vec!["<objectId>", "Achievements.ini"],
            },
        ],
        Cracker::Goldberg => vec![
            CrackerPath {
                folder: app_data().join("Goldberg SteamEmu Saves"),
                file_location: vec!["<objectId>", "achievements.json"],
            },
            CrackerPath {
                folder: app_data().join("GSE Saves"),
                file_location: vec!["<objectId>", "achievements.json"],
            },
        ],
        Cracker::Rld => vec![
            CrackerPath {
                folder: program_data().join("RLD!"),
                file_location: vec!["<objectId>", "achievements.ini"],
            },
            CrackerPath {
                folder: program_data().join("Steam").join("Player"),
                file_location: vec!["<objectId>", "stats", "achievements.ini"],
            },
            CrackerPath {
                folder: program_data().join("Steam").join("RLD!"),
                file_location: vec!["<objectId>", "stats", "achievements.ini"],
            },
            CrackerPath {
                folder: program_data().join("Steam").join("dodi"),
                file_location: vec!["<objectId>", "stats", "achievements.ini"],
            },
        ],
        Cracker::Empress => vec![
            CrackerPath {
                folder: app_data().join("EMPRESS").join("remote"),
                file_location: vec!["<objectId>", "achievements.json"],
            },
            CrackerPath {
                folder: public_documents().join("EMPRESS"),
                file_location: vec![
                    "<objectId>",
                    "remote",
                    "<objectId>",
                    "achievements.json",
                ],
            },
        ],
        Cracker::Skidrow => vec![
            CrackerPath {
                folder: documents().join("SKIDROW"),
                file_location: vec!["<objectId>", "SteamEmu", "UserStats", "achiev.ini"],
            },
            CrackerPath {
                folder: documents().join("Player"),
                file_location: vec!["<objectId>", "SteamEmu", "UserStats", "achiev.ini"],
            },
            CrackerPath {
                folder: local_app_data().join("SKIDROW"),
                file_location: vec!["<objectId>", "SteamEmu", "UserStats", "achiev.ini"],
            },
        ],
        Cracker::CreamApi => vec![CrackerPath {
            folder: app_data().join("CreamAPI"),
            file_location: vec!["<objectId>", "stats", "CreamAPI.Achievements.cfg"],
        }],
        Cracker::SmartSteamEmu => vec![CrackerPath {
            folder: app_data().join("SmartSteamEmu"),
            file_location: vec!["<objectId>", "User", "Achievements.ini"],
        }],
        Cracker::Rle => vec![
            CrackerPath {
                folder: app_data().join("RLE"),
                file_location: vec!["<objectId>", "achievements.ini"],
            },
            CrackerPath {
                folder: app_data().join("RLE"),
                file_location: vec!["<objectId>", "Achievements.ini"],
            },
        ],
        Cracker::Razor1911 => vec![CrackerPath {
            folder: app_data().join(".1911"),
            file_location: vec!["<objectId>", "achievement"],
        }],
        // No folder-based discovery: located via the executable dir
        // (UserStats / 3DM) or unsupported (FLT / Steam-cache handled
        // through dedicated helpers).
        Cracker::UserStats | Cracker::Flt | Cracker::Threedm | Cracker::Steam => vec![],
    }
}

/// Dishonored ships achievements under sibling appids.
pub fn get_alternative_object_ids(object_id: &str) -> Vec<String> {
    if object_id == "205100" {
        return vec!["205100".into(), "217980".into(), "31292".into()];
    }
    vec![object_id.to_string()]
}

fn map_file_location(file_location: &[&str], object_id: &str) -> Vec<String> {
    file_location
        .iter()
        .map(|seg| seg.replace("<objectId>", object_id))
        .collect()
}

/// Find crack achievement files for a single game (by Steam appid),
/// plus any files sitting next to the game executable.
pub fn find_achievement_files(steam_app_id: u32, exe_path: Option<&str>) -> Vec<AchievementFile> {
    let mut out = Vec::new();

    for &cracker in CRACKERS {
        for cp in paths_for_cracker(cracker) {
            for object_id in get_alternative_object_ids(&steam_app_id.to_string()) {
                let mut file_path = cp.folder.clone();
                for seg in map_file_location(&cp.file_location, &object_id) {
                    file_path.push(seg);
                }
                if file_path.exists() {
                    out.push(AchievementFile {
                        cracker,
                        path: file_path,
                    });
                }
            }
        }
    }

    out.extend(find_achievement_file_in_executable_directory(exe_path));
    out
}

/// Achievement files that live inside the game's install directory
/// (relative to the executable): UserStats + 3DM.
pub fn find_achievement_file_in_executable_directory(
    exe_path: Option<&str>,
) -> Vec<AchievementFile> {
    let Some(exe) = exe_path else {
        return Vec::new();
    };
    let Some(dir) = Path::new(exe).parent() else {
        return Vec::new();
    };

    let candidates = [
        (
            Cracker::UserStats,
            dir.join("SteamData").join("user_stats.ini"),
        ),
        (
            Cracker::Threedm,
            dir.join("3DMGAME")
                .join("Player")
                .join("stats")
                .join("achievements.ini"),
        ),
    ];

    candidates
        .into_iter()
        .filter(|(_, p)| p.exists())
        .map(|(cracker, path)| AchievementFile { cracker, path })
        .collect()
}

/// Scan every cracker folder once and build a map of
/// `appid -> [AchievementFile]`. Used by the watcher's bulk passes so
/// we don't stat one path per game per cracker on every poll.
pub fn find_all_achievement_files() -> HashMap<String, Vec<AchievementFile>> {
    let mut map: HashMap<String, Vec<AchievementFile>> = HashMap::new();

    for &cracker in CRACKERS {
        for cp in paths_for_cracker(cracker) {
            let Ok(entries) = std::fs::read_dir(&cp.folder) else {
                continue;
            };
            for entry in entries.flatten() {
                let object_id = entry.file_name().to_string_lossy().to_string();
                let mut file_path = cp.folder.clone();
                for seg in map_file_location(&cp.file_location, &object_id) {
                    file_path.push(seg);
                }
                if !file_path.exists() {
                    continue;
                }
                map.entry(object_id).or_default().push(AchievementFile {
                    cracker,
                    path: file_path,
                });
            }
        }
    }

    map
}

// ── Parsing ─────────────────────────────────────────────────────────────

/// Parse one achievement file into its unlocked achievements.
pub fn parse_achievement_file(file: &AchievementFile) -> Vec<UnlockedAchievement> {
    if !file.path.exists() {
        return Vec::new();
    }

    let result = match file.cracker {
        Cracker::Codex | Cracker::Rune => ini_parse(&file.path).map(|o| process_default(&o)),
        Cracker::OnlineFix => ini_parse(&file.path).map(|o| process_online_fix(&o)),
        Cracker::Goldberg | Cracker::Empress => {
            json_parse(&file.path).map(|v| process_goldberg(&v))
        }
        Cracker::UserStats => ini_parse(&file.path).map(|o| process_user_stats(&o)),
        Cracker::Rld => ini_parse(&file.path).map(|o| process_rld(&o)),
        Cracker::Skidrow => ini_parse(&file.path).map(|o| process_skidrow(&o)),
        Cracker::SmartSteamEmu | Cracker::Rle => {
            ini_parse(&file.path).map(|o| process_default(&o))
        }
        Cracker::Threedm => ini_parse(&file.path).map(|o| process_3dm(&o)),
        Cracker::CreamApi => ini_parse(&file.path).map(|o| process_cream_api(&o)),
        Cracker::Razor1911 => Ok(process_razor1911(&file.path)),
        Cracker::Flt => Ok(process_flt(&file.path)),
        Cracker::Steam => json_parse(&file.path).map(|v| process_steam_cache(&v)),
    };

    match result {
        Ok(list) => list,
        Err(e) => {
            eprintln!(
                "[local_achievements] error parsing {:?} ({:?}): {e}",
                file.path, file.cracker
            );
            Vec::new()
        }
    }
}

type IniObject = HashMap<String, Vec<(String, String)>>;

/// INI parser matching Hydra's behaviour: strips a leading BOM, skips
/// blank / `###` lines, tracks `[section]` headers, and splits each
/// `k=v` on the first `=`. Section entries preserve order so index-based
/// lookups (Skidrow) stay stable.
fn ini_parse(path: &Path) -> Result<IniObject, String> {
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let content = content.strip_prefix('\u{feff}').unwrap_or(&content);

    let mut object: IniObject = HashMap::new();
    let mut section = String::new();
    object.insert(section.clone(), Vec::new());

    for raw in content.split(['\r', '\n']) {
        let line = raw;
        if line.starts_with("###") || line.is_empty() {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            section = line[1..line.len() - 1].to_string();
            object.entry(section.clone()).or_default();
        } else if let Some(idx) = line.find('=') {
            let name = line[..idx].trim().to_string();
            let value = line[idx + 1..].trim().to_string();
            object.entry(section.clone()).or_default().push((name, value));
        }
    }

    Ok(object)
}

fn json_parse(path: &Path) -> Result<Value, String> {
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

fn section<'a>(obj: &'a IniObject, name: &str) -> Option<&'a Vec<(String, String)>> {
    obj.get(name)
}

/// Parse a hex string as a little-endian u32 (matches Hydra's
/// `DataView(...).getUint32(0, true)` over `Buffer.from(hex, "hex")`).
fn hex_le_u32(s: &str) -> u32 {
    let bytes: Vec<u8> = (0..s.len())
        .step_by(2)
        .filter_map(|i| s.get(i..i + 2).and_then(|b| u8::from_str_radix(b, 16).ok()))
        .collect();
    let mut buf = [0u8; 4];
    for (i, b) in bytes.iter().take(4).enumerate() {
        buf[i] = *b;
    }
    u32::from_le_bytes(buf)
}

fn parse_num(s: &str) -> Option<u64> {
    s.trim().parse::<u64>().ok()
}

/// CODEX / RUNE / RLE: `Achieved=1` + `UnlockTime=<secs>` per section.
fn process_default(obj: &IniObject) -> Vec<UnlockedAchievement> {
    let mut out = Vec::new();
    for (name, entries) in obj {
        if name.is_empty() {
            continue;
        }
        let map: HashMap<&str, &str> =
            entries.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        if map.get("Achieved").copied() == Some("1") {
            let ut = map.get("UnlockTime").and_then(|v| parse_num(v)).unwrap_or(0);
            out.push(UnlockedAchievement {
                name: name.clone(),
                unlock_time: ut * 1000,
            });
        }
    }
    out
}

/// OnlineFix: `achieved=true`/`Achieved=true` variants.
fn process_online_fix(obj: &IniObject) -> Vec<UnlockedAchievement> {
    let mut out = Vec::new();
    for (name, entries) in obj {
        if name.is_empty() {
            continue;
        }
        let map: HashMap<&str, &str> =
            entries.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        if map.get("achieved").copied() == Some("true") {
            let ts = map.get("timestamp").and_then(|v| parse_num(v)).unwrap_or(0);
            out.push(UnlockedAchievement {
                name: name.clone(),
                unlock_time: ts * 1000,
            });
        } else if map.get("Achieved").copied() == Some("true") {
            let raw = map.get("TimeUnlocked").copied().unwrap_or("0");
            let n = parse_num(raw).unwrap_or(0);
            let unlock_time = if raw.trim().len() == 7 {
                n * 1000 * 1000
            } else {
                n * 1000
            };
            out.push(UnlockedAchievement {
                name: name.clone(),
                unlock_time,
            });
        }
    }
    out
}

/// CreamAPI: `achieved=true` + `unlocktime`.
fn process_cream_api(obj: &IniObject) -> Vec<UnlockedAchievement> {
    let mut out = Vec::new();
    for (name, entries) in obj {
        if name.is_empty() {
            continue;
        }
        let map: HashMap<&str, &str> =
            entries.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        if map.get("achieved").copied() == Some("true") {
            let raw = map.get("unlocktime").copied().unwrap_or("0");
            let n = parse_num(raw).unwrap_or(0);
            let unlock_time = if raw.trim().len() == 7 {
                n * 1000 * 1000
            } else {
                n * 1000
            };
            out.push(UnlockedAchievement {
                name: name.clone(),
                unlock_time,
            });
        }
    }
    out
}

/// Skidrow: `[Achievements]` section, values `"1@...@<secs>"`.
fn process_skidrow(obj: &IniObject) -> Vec<UnlockedAchievement> {
    let mut out = Vec::new();
    let Some(entries) = section(obj, "Achievements") else {
        return out;
    };
    for (name, value) in entries {
        let parts: Vec<&str> = value.split('@').collect();
        if parts.first().copied() == Some("1") {
            let last = parts.last().and_then(|v| parse_num(v)).unwrap_or(0);
            out.push(UnlockedAchievement {
                name: name.clone(),
                unlock_time: last * 1000,
            });
        }
    }
    out
}

/// Goldberg / EMPRESS: JSON array or object of `{ earned, earned_time }`.
fn process_goldberg(value: &Value) -> Vec<UnlockedAchievement> {
    let mut out = Vec::new();

    if let Some(arr) = value.as_array() {
        for a in arr {
            if a.get("earned").and_then(|v| v.as_bool()).unwrap_or(false) {
                let name = a.get("name").and_then(|v| v.as_str()).unwrap_or_default();
                let earned = a.get("earned_time").and_then(|v| v.as_u64()).unwrap_or(0);
                out.push(UnlockedAchievement {
                    name: name.to_string(),
                    unlock_time: earned * 1000,
                });
            }
        }
        return out;
    }

    if let Some(obj) = value.as_object() {
        for (name, a) in obj {
            if a.get("earned").and_then(|v| v.as_bool()).unwrap_or(false) {
                let earned = a.get("earned_time").and_then(|v| v.as_u64()).unwrap_or(0);
                out.push(UnlockedAchievement {
                    name: name.clone(),
                    unlock_time: earned * 1000,
                });
            }
        }
    }

    out
}

/// Steam library-cache JSON (`<appid>.json` under userdata).
fn process_steam_cache(value: &Value) -> Vec<UnlockedAchievement> {
    let mut out = Vec::new();
    let Some(arr) = value.as_array() else {
        return out;
    };

    let entry = arr.iter().find(|e| {
        e.as_array()
            .and_then(|inner| inner.first())
            .and_then(|v| v.as_str())
            == Some("achievements")
    });

    let Some(highlights) = entry
        .and_then(|e| e.as_array())
        .and_then(|inner| inner.get(1))
        .and_then(|v| v.get("data"))
        .and_then(|v| v.get("vecHighlight"))
        .and_then(|v| v.as_array())
    else {
        return out;
    };

    for a in highlights {
        if a.get("bAchieved").and_then(|v| v.as_bool()).unwrap_or(false) {
            let name = a.get("strID").and_then(|v| v.as_str()).unwrap_or_default();
            let unlocked = a.get("rtUnlocked").and_then(|v| v.as_u64()).unwrap_or(0);
            out.push(UnlockedAchievement {
                name: name.to_string(),
                unlock_time: unlocked * 1000,
            });
        }
    }
    out
}

/// 3DM: `[State]` = "0101" unlocked, `[Time]` hex-LE u32 seconds.
fn process_3dm(obj: &IniObject) -> Vec<UnlockedAchievement> {
    let mut out = Vec::new();
    let (Some(states), Some(times)) = (section(obj, "State"), section(obj, "Time")) else {
        return out;
    };
    let times_map: HashMap<&str, &str> =
        times.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();

    for (name, state) in states {
        if state == "0101" {
            let secs = times_map.get(name.as_str()).map(|t| hex_le_u32(t)).unwrap_or(0);
            out.push(UnlockedAchievement {
                name: name.clone(),
                unlock_time: secs as u64 * 1000,
            });
        }
    }
    out
}

/// RLD!: per-section `State` (hex-LE u32 == 1) + `Time` (hex-LE u32).
fn process_rld(obj: &IniObject) -> Vec<UnlockedAchievement> {
    let mut out = Vec::new();
    for (name, entries) in obj {
        if name.is_empty() || name == "Steam" {
            continue;
        }
        let map: HashMap<&str, &str> =
            entries.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        let Some(state) = map.get("State") else {
            continue;
        };
        if hex_le_u32(state) == 1 {
            let secs = map.get("Time").map(|t| hex_le_u32(t)).unwrap_or(0);
            out.push(UnlockedAchievement {
                name: name.clone(),
                unlock_time: secs as u64 * 1000,
            });
        }
    }
    out
}

/// SmartSteamEmu / UserStats: `[ACHIEVEMENTS]` with values like
/// `(unlocked = true, time = <secs>)`.
fn process_user_stats(obj: &IniObject) -> Vec<UnlockedAchievement> {
    let mut out = Vec::new();
    let Some(entries) = section(obj, "ACHIEVEMENTS") else {
        return out;
    };
    for (name, value) in entries {
        // Strip surrounding parens, then the leading label.
        let inner = value
            .strip_prefix('(')
            .and_then(|s| s.strip_suffix(')'))
            .unwrap_or(value);
        let num = inner.replace("unlocked = true, time = ", "");
        if let Ok(secs) = num.trim().parse::<u64>() {
            out.push(UnlockedAchievement {
                name: name.replace('"', ""),
                unlock_time: secs * 1000,
            });
        }
    }
    out
}

/// Razor1911: whitespace-delimited `name unlocked unlockTime` lines.
fn process_razor1911(path: &Path) -> Vec<UnlockedAchievement> {
    let Ok(content) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let content = content.strip_prefix('\u{feff}').unwrap_or(&content);
    let mut out = Vec::new();
    for line in content.split(['\r', '\n']) {
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split(' ').collect();
        if parts.len() >= 3 && parts[1] == "1" {
            let secs = parse_num(parts[2]).unwrap_or(0);
            out.push(UnlockedAchievement {
                name: parts[0].to_string(),
                unlock_time: secs * 1000,
            });
        }
    }
    out
}

/// FLT: a directory whose entries are unlocked achievement names.
fn process_flt(path: &Path) -> Vec<UnlockedAchievement> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let Ok(entries) = std::fs::read_dir(path) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|e| UnlockedAchievement {
            name: e.file_name().to_string_lossy().to_string(),
            unlock_time: now,
        })
        .collect()
}
