//! Installed-game detection — Playnite `playnite-gog-oss-plugin` parity.
//!
//! Two complementary paths feed `scan_installed_gog_games`:
//!
//! 1. **Windows registry** (Win32-only). GOG's standalone installer
//!    writes an Uninstall registry entry with `Publisher='GOG.com'`
//!    and a `DisplayName` like `The Witcher 3: Wild Hunt`; the
//!    `KeyName` (= the Registry subkey) matches `^(\d+)_is1`, with
//!    `gameId` as the captured group. `InstallLocation` is the
//!    canonical install dir. This catches installs to *non-default*
//!    paths — the thing pure disk-walks miss.
//!
//! 2. **Disk walk** of the standard install roots
//!    (`C:\Program Files (x86)\GOG Galaxy\Games`, `D:\GOG Games`, etc.).
//!    Each subdir must contain a `goggame-<id>.info` manifest with a
//!    primary play task and `rootGameId == gameId` (filters DLCs).
//!
//! We always parse the manifest when present — the primary play
//! task gives us a real launch exe, which is much better than the
//! "largest .exe" heuristic that mis-targets `7za.exe`,
//! `crashhandler.exe`, etc.
//!
//! ## Non-Windows builds
//!
//! macOS/Linux fall back to the disk walk at the platform-standard
//! paths. Same heuristic — manifest-derived primary exe preferred,
//! "largest .exe" fallback. Registry is silently skipped
//! (`#[cfg(windows)]`).

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use super::types::{GogGameActionInfo, GogGameTask, GogInstalledGame};

// Windows registry path
#[cfg(windows)]
const REG_UNINSTALL_BASE: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";
#[cfg(windows)]
const REG_UNINSTALL_BASE_WOW: &str =
    r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall";

// ── Public entry ────────────────────────────────────────────────────

/// Walk every discovered install root (registry + standard dirs)
/// and emit a dedup'd `Vec<GogInstalledGame>` keyed by game id.
pub fn scan_installed_gog_games() -> Vec<GogInstalledGame> {
    let registry_hits = registry_installed_games();
    let disk_hits = scan_disk_install_roots();

    let mut out: HashMap<String, GogInstalledGame> = HashMap::new();
    // Registry wins because it carries canonical InstallLocation,
    // but disk entries fill in the manifest-derived primary exe
    // when registry didn't already provide one.
    for g in registry_hits {
        out.entry(g.game_id.clone()).or_insert(g);
    }
    for g in disk_hits {
        // Merge so a registry entry that has exe_path=None picks up
        // the manifest-derived exe from the disk scan.
        match out.entry(g.game_id.clone()) {
            std::collections::hash_map::Entry::Occupied(mut e) => {
                if e.get().exe_path.is_empty() && !g.exe_path.is_empty() {
                    e.get_mut().exe_path = g.exe_path;
                }
            }
            std::collections::hash_map::Entry::Vacant(e) => {
                e.insert(g);
            }
        }
    }
    out.into_values().collect()
}

// ── Registry scanner (Windows) ──────────────────────────────────────

/// Iterate HKLM+HKCU uninstall entries where Publisher =
/// `GOG.com` and the registry subkey starts with digits followed by
/// `_is1` (GOG's uninstall convention). Returns one record per
/// match with `exe_path=""` — the disk-walk fix-up pass attaches
/// the manifest-derived primary exe when both surface the same id.
#[cfg(windows)]
fn registry_installed_games() -> Vec<GogInstalledGame> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let mut out: Vec<GogInstalledGame> = Vec::new();
    let subkeys_to_scan = [
        (HKEY_LOCAL_MACHINE, REG_UNINSTALL_BASE),
        (HKEY_LOCAL_MACHINE, REG_UNINSTALL_BASE_WOW),
        (HKEY_CURRENT_USER, REG_UNINSTALL_BASE),
    ];
    for (root_hkey, base_path) in &subkeys_to_scan {
        let root = RegKey::predef(*root_hkey);
        let Ok(uninstall_root) = root.open_subkey(base_path) else {
            continue;
        };
        for sub in uninstall_root.enum_keys().flatten() {
            // Registry subkey must be `<digits>_is1` — captures the
            // GOG gameId. Mirrors Playnite's
            //   `Regex.Match(program.RegistryKeyName, @"^(\d+)_is1")`.
            let Some(caps) = id_from_registry_subkey(&sub) else {
                continue;
            };
            let Ok(entry) = uninstall_root.open_subkey(&sub) else {
                continue;
            };
            // Publisher must be literally "GOG.com" — third-party
            // games (EA, Ubisoft) also create `^(\d+)_is1` entries
            // but with their own publisher, so the filter matters.
            let publisher = entry
                .get_value("Publisher")
                .ok()
                .and_then(|v: String| {
                    if v.trim().eq_ignore_ascii_case("GOG.com") {
                        Some(v)
                    } else {
                        None
                    }
                });
            if publisher.is_none() {
                continue;
            }
            // Skip the "GOGPACK" bundle entries — they're not games.
            if sub.starts_with("GOGPACK") {
                continue;
            }
            let game_id = caps;
            let display_name = entry
                .get_value("DisplayName")
                .ok()
                .unwrap_or_else(|| format!("Unknown Game ({game_id})"));
            let install_location = entry.get_value("InstallLocation").ok();
            // The InstallLocation direct read sometimes fails when
            // a user has uninstalled but kept the registry key —
            // skip those rows so they don't end up synced as
            // phantom installs.
            let Some(install_dir) = install_location else {
                continue;
            };
            if !Path::new(&install_dir).is_dir() {
                continue;
            }
            out.push(GogInstalledGame {
                game_id,
                install_dir,
                exe_path: String::new(), // disk-walk fix-up attaches this
                is_dlc: false,
                title: strip_trademarks(&display_name),
            });
        }
    }
    out
}

#[cfg(not(windows))]
fn registry_installed_games() -> Vec<GogInstalledGame> {
    Vec::new()
}

/// Captures the digits at the start of `<digits>_is1` registry
/// subkeys. Returns `None` for `GOGPACK_*` or any other malformed
/// key — Playnite's `Match.Success` is the equivalent gate.
#[cfg(windows)]
fn id_from_registry_subkey(sub: &str) -> Option<String> {
    let underscore_pos = sub.find('_')?;
    let id_part = &sub[..underscore_pos];
    if !id_part.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let suffix = &sub[underscore_pos + 1..];
    if suffix == "is1" {
        Some(id_part.to_string())
    } else {
        None
    }
}

/// Strip the trailing `(GOG.com)` mark some DisplayNames carry so
/// the library doesn't render them verbatim. Playnite uses
/// `DisplayName.RemoveTrademarks()` — same idea, narrower scope.
fn strip_trademarks(name: &str) -> String {
    name.replace("(GOG.com)", "")
        .replace("[GOG.com]", "")
        .trim()
        .to_string()
}

// ── Disk-walk scanner (cross-platform) ───────────────────────────────

/// Standard GOG install locations per platform. Order doesn't matter
/// (we dedupe by id); we just want to be exhaustive.
fn gog_install_roots() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        vec![
            PathBuf::from(r"C:\Program Files (x86)\GOG Galaxy\Games"),
            PathBuf::from(r"C:\Games\GOG"),
            PathBuf::from(r"D:\GOG Games"),
            PathBuf::from(r"D:\Games\GOG"),
            PathBuf::from(r"C:\GOG Games"),
        ]
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/Users".to_string());
        vec![PathBuf::from(format!(
            "{home}/Library/Application Support/GOG.com/Galaxy/Games/Galaxy Client/Games"
        ))]
    }
    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/home".to_string());
        vec![PathBuf::from(format!("{home}/GOG Games"))]
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        Vec::new()
    }
}

fn scan_disk_install_roots() -> Vec<GogInstalledGame> {
    let mut out: Vec<GogInstalledGame> = Vec::new();
    for root in gog_install_roots() {
        scan_disk_install_root(&root, &mut out);
    }
    out
}

fn scan_disk_install_root(root: &Path, out: &mut Vec<GogInstalledGame>) {
    let entries = match fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(dir_name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let game_id = dir_name.to_string();
        let manifest_path = path.join(format!("goggame-{game_id}.info"));
        let Some(info) =
            read_goggame_info(&manifest_path) else { continue };
        if is_dlc_manifest(&info) {
            continue;
        }
        let title = info.name.clone().unwrap_or_else(|| {
            // Fallback: take the dir name itself as a readable title.
            game_id.clone()
        });
        let exe_path = resolve_primary_exe(&info, &path)
            .unwrap_or_else(|| find_largest_exe(&path).unwrap_or_default());
        out.push(GogInstalledGame {
            game_id,
            install_dir: path.to_string_lossy().to_string(),
            exe_path,
            is_dlc: false,
            title,
        });
    }
}

fn read_goggame_info(path: &Path) -> Option<GogGameActionInfo> {
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Mirrors Playnite's
///   `skip if infoManifest.rootGameId != gameId` rule — DLCs are
///   shipped as siblings with the parent rootGameId so they always
///   fail this check.
fn is_dlc_manifest(info: &GogGameActionInfo) -> bool {
    match (
        info.root_game_id.as_deref(),
        info.game_id.as_deref(),
    ) {
        (Some(root), Some(id)) => root != id,
        _ => false,
    }
}

// ── Primary exe resolution ──────────────────────────────────────────

/// Resolve the launchable .exe from `goggame-<id>.info`.
///
/// Priority:
/// 1. First primary play task (`isPrimary=true`, type="FILE") →
///    `<install_dir>/<task.path>`. This is THE correct launch
///    target — better than "largest .exe" because GOG bundles
///    plenty of large-but-irrelevant binaries (`7za.exe`,
///    redist installers, etc.).
/// 2. Falls back to the largest non-redist .exe in the install dir.
///
/// Returns `None` when no play tasks AND no .exe candidates —
/// caller should skip the row (mirrors Playnite's
/// `if (!GetPlayTasks(...).HasItems()) continue`).
fn resolve_primary_exe(info: &GogGameActionInfo, install_dir: &Path) -> Option<String> {
    pick_primary_task(&info.play_tasks).and_then(|task| {
        let path = task.path.as_deref()?.trim_start_matches('/');
        if path.is_empty() {
            return None;
        }
        let resolved = install_dir.join(path);
        // Trust the manifest; if the file doesn't actually exist
        // (rare, but happens with some GoG Galaxy upgrades that
        // mutate `playTasks[]`), fall through to the .exe hunt.
        if resolved.is_file() {
            Some(resolved.to_string_lossy().to_string())
        } else {
            None
        }
    })
}

fn pick_primary_task(tasks: &[GogGameTask]) -> Option<&GogGameTask> {
    tasks
        .iter()
        .find(|t| t.is_primary && t.task_type.as_deref() == Some("FILE"))
}

/// Largest non-redist `.exe` under `dir` — last-resort fallback used
/// when the manifest doesn't list a primary play task (older
/// installers) or the primary's path can't be resolved (rare
/// corruption cases). Mirrors the heuristic our old sync.rs used.
fn find_largest_exe(dir: &Path) -> Option<String> {
    let skip_keywords = [
        "redist", "autorun", "helper", "unin", "crash", "setup", "install",
        "plugin", "manual", "readme", "register", "7za",
    ];
    let mut candidates: Vec<(u64, PathBuf)> = Vec::new();
    visit_exes(dir, &skip_keywords, &mut candidates);
    candidates.into_iter().max_by_key(|(s, _)| *s).map(|(_, p)| {
        p.to_string_lossy().to_string()
    })
}

fn visit_exes(dir: &Path, skip: &[&str], out: &mut Vec<(u64, PathBuf)>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            // Skip dot-prefixed / underscore-prefixed system dirs.
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.starts_with('.') || name.starts_with('_') {
                    continue;
                }
            }
            visit_exes(&path, skip, out);
        } else if path.extension().and_then(|e| e.to_str()) == Some("exe") {
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            if skip.iter().any(|kw| stem.contains(kw)) {
                continue;
            }
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            out.push((size, path));
        }
    }
}

// (Helpers intentionally omitted — `scan_installed_gog_games`
// returns the typed `Vec<GogInstalledGame>` directly; no flat
// tuple accessor is needed by the orchestrator.)
