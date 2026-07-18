//! Rockstar Games Launcher integration.
//!
//! Full Playnite `RockstarLibrary` parity (installed-games + launcher
//! client only — there is no Rockstar cloud library API, so this is
//! a pure local scan like Playnite's `GetInstalledGames`).
//!
//! Module surface:
//! - `games` — the curated catalog of known Rockstar titles, each
//!   keyed by the `TitleId` Rockstar's uninstall entries carry
//!   (`uninstall=gta5`, `uninstall=rdr2`, …).
//! - `is_client_installed` / `client_install_path` / `client_exec_path`
//!   — Rockstar Games Launcher detection via the Windows registry.
//! - `scan_installed_rockstar_games` — walks the uninstall registry
//!   for entries whose `UninstallString` matches
//!   `(?:Launcher|uninstall)\.exe.+uninstall=(.+)$`, resolves the
//!   `TitleId`, looks it up in `games`, and emits a typed
//!   `RockstarInstalledGame` (mirrors Playnite's
//!   `RockstarGamesLibrary.GetInstalledGames`).
//! - `sync` — [`sync_library`] orchestrator that returns
//!   [`RockstarSyncResult`] for the frontend's Settings tile.
//!
//! ## Non-Windows builds
//!
//! The Rockstar Games Launcher is Windows-only, so every host probe
//! returns "not installed" off-Windows and `scan_installed_*`
//! returns an empty vec. We don't attempt a disk walk because
//! Rockstar has no stable, documented cross-platform install root.

use serde::{Deserialize, Serialize};

pub mod sync;

/// One curated Rockstar title. Mirrors Playnite's `RockstarGame`
/// (Name / Executable / TitleId). `TitleId` is the token Rockstar's
/// uninstaller embeds in `UninstallString` as `uninstall=<TitleId>`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RockstarGame {
    pub name: &'static str,
    pub executable: &'static str,
    /// Rockstar `uninstall=<titleId>` token. Also used as the stable
    /// game id (`rockstar-<titleId>`).
    pub title_id: &'static str,
}

/// Curated catalog — verbatim from Playnite's
/// `RockstarGames.Games` list (15 titles, including the Definitive
/// Edition Unreal builds that ship under `Gameface/Binaries/Win64/`).
pub const GAMES: &[RockstarGame] = &[
    RockstarGame {
        name: "Grand Theft Auto V",
        executable: "PlayGTAV.exe",
        title_id: "gta5",
    },
    RockstarGame {
        name: "Grand Theft Auto V Enhanced",
        executable: "GTA5_Enhanced_BE.exe",
        title_id: "gta5_gen9",
    },
    RockstarGame {
        name: "Red Dead Redemption",
        executable: "RDR.exe",
        title_id: "rdr",
    },
    RockstarGame {
        name: "Red Dead Redemption 2",
        executable: "RDR2.exe",
        title_id: "rdr2",
    },
    RockstarGame {
        name: "L.A. Noire",
        executable: "LANoire.exe",
        title_id: "lanoire",
    },
    RockstarGame {
        name: "Max Payne 3",
        executable: "MaxPayne3.exe",
        title_id: "mp3",
    },
    RockstarGame {
        name: "L.A. Noire: The VR Case Files",
        executable: "LANoireVR.exe",
        title_id: "lanoirevr",
    },
    RockstarGame {
        name: "Grand Theft Auto: San Andreas",
        executable: "gta_sa.exe",
        title_id: "gtasa",
    },
    RockstarGame {
        name: "Grand Theft Auto III",
        executable: "gta3.exe",
        title_id: "gta3",
    },
    RockstarGame {
        name: "Grand Theft Auto: Vice City",
        executable: "gta-vc.exe",
        title_id: "gtavc",
    },
    RockstarGame {
        name: "Bully: Scholarship Edition",
        executable: "Bully.exe",
        title_id: "bully",
    },
    RockstarGame {
        name: "Grand Theft Auto IV",
        executable: "GTAIV.exe",
        title_id: "gta4",
    },
    RockstarGame {
        name: "Grand Theft Auto III: The Definitive Edition",
        executable: "Gameface/Binaries/Win64/LibertyCity.exe",
        title_id: "gta3unreal",
    },
    RockstarGame {
        name: "Grand Theft Auto: Vice City – The Definitive Edition",
        executable: "Gameface/Binaries/Win64/ViceCity.exe",
        title_id: "gtavcunreal",
    },
    RockstarGame {
        name: "Grand Theft Auto: San Andreas – The Definitive Edition",
        executable: "Gameface/Binaries/Win64/SanAndreas.exe",
        title_id: "gtasaunreal",
    },
];

/// Look up a catalog entry by `title_id`.
pub fn game_by_title_id(title_id: &str) -> Option<&'static RockstarGame> {
    GAMES.iter().find(|g| g.title_id == title_id)
}

// ── Launcher (Rockstar Games Launcher) detection ───────────────────────────

/// Windows registry base for the Uninstall key.
#[cfg(windows)]
const REG_UNINSTALL_BASE: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";
#[cfg(windows)]
const REG_UNINSTALL_BASE_WOW: &str =
    r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall";

/// Registry display-name Rockstar's launcher registers under.
#[cfg(windows)]
const ROCKSTAR_LAUNCHER_DISPLAY_NAME: &str = "Rockstar Games Launcher";

/// True when the Rockstar Games Launcher is installed. Mirrors
/// Playnite's `RockstarGames.IsInstalled` (which checks for
/// `Launcher.exe` inside the resolved install path).
pub fn is_client_installed() -> bool {
    let exe = client_exec_path();
    !exe.is_empty() && std::path::Path::new(&exe).is_file()
}

/// Install root of the Rockstar Games Launcher, or `""` when absent.
///
/// Mirrors Playnite's `RockstarGames.InstallationPath` — finds the
/// uninstall entry whose `DisplayName == "Rockstar Games Launcher"`
/// and returns its `InstallLocation`.
pub fn client_install_path() -> String {
    client_install_path_inner().unwrap_or_default()
}

/// Absolute path to `Launcher.exe` inside the install root, or `""`.
pub fn client_exec_path() -> String {
    let path = client_install_path();
    if path.is_empty() {
        return String::new();
    }
    let joined = std::path::Path::new(&path).join("Launcher.exe");
    joined.to_string_lossy().to_string()
}

#[cfg(windows)]
fn client_install_path_inner() -> Option<String> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let roots = [
        (HKEY_LOCAL_MACHINE, REG_UNINSTALL_BASE),
        (HKEY_LOCAL_MACHINE, REG_UNINSTALL_BASE_WOW),
        (HKEY_CURRENT_USER, REG_UNINSTALL_BASE),
    ];
    for (hkey, base) in &roots {
        let root = RegKey::predef(*hkey);
        let Ok(uninstall_root) = root.open_subkey(base) else {
            continue;
        };
        for sub in uninstall_root.enum_keys().flatten() {
            let Ok(entry) = uninstall_root.open_subkey(&sub) else {
                continue;
            };
            let display_name: Option<String> = entry.get_value("DisplayName").ok();
            if display_name.as_deref() != Some(ROCKSTAR_LAUNCHER_DISPLAY_NAME) {
                continue;
            }
            let install_location: Option<String> = entry.get_value("InstallLocation").ok();
            if let Some(loc) = install_location {
                let trimmed = loc.trim_matches('"').to_string();
                if !trimmed.is_empty() && std::path::Path::new(&trimmed).is_dir() {
                    return Some(trimmed);
                }
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn client_install_path_inner() -> Option<String> {
    None
}

// ── Installed-game scan ────────────────────────────────────────────────────

/// One Rockstar game discovered as installed via the uninstall
/// registry. `path` is the absolute path to the game's primary
/// executable (resolved by joining `install_dir` + the catalog's
/// `executable`); `icon_path` carries the registry `DisplayIcon`
/// when it points at a real file (Playnite attaches it as the game
/// icon).
#[derive(Debug, Clone)]
pub struct RockstarInstalledGame {
    pub title_id: String,
    pub name: String,
    pub install_dir: String,
    pub path: String,
    pub icon_path: Option<String>,
    /// True when `install_dir` exists on disk (Playnite marks
    /// `IsInstalled=false` + blanks the dir when it doesn't).
    pub is_installed: bool,
}

/// Walk the uninstall registry for Rockstar titles. Mirrors Playnite's
/// `RockstarGamesLibrary.GetInstalledGames`:
///
/// 1. Enumerate every uninstall entry.
/// 2. `Regex.Match(UninstallString,
///    @"(?:Launcher|uninstall)\.exe.+uninstall=(.+)$")` — captures
///    the `TitleId`.
/// 3. Look the `TitleId` up in [`GAMES`]; unknown ids are skipped
///    with a warning (just like Playnite's `logger.Warn`).
/// 4. Validate `InstallLocation` exists on disk; mark
///    `is_installed=false` (and blank the dir) when it doesn't — we
///    still surface the entry so the user sees it, but the frontend
///    knows not to offer launch.
///
/// Returns every match, installed or not.
pub fn scan_installed_rockstar_games() -> Vec<RockstarInstalledGame> {
    scan_installed_rockstar_games_inner()
}

#[cfg(windows)]
fn scan_installed_rockstar_games_inner() -> Vec<RockstarInstalledGame> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let re = regex::Regex::new(r"(?i)(?:Launcher|uninstall)\.exe.+uninstall=(.+)$")
        .expect("Rockstar uninstall regex is valid");

    let roots = [
        (HKEY_LOCAL_MACHINE, REG_UNINSTALL_BASE),
        (HKEY_LOCAL_MACHINE, REG_UNINSTALL_BASE_WOW),
        (HKEY_CURRENT_USER, REG_UNINSTALL_BASE),
    ];

    let mut out: Vec<RockstarInstalledGame> = Vec::new();
    for (hkey, base) in &roots {
        let root = RegKey::predef(*hkey);
        let Ok(uninstall_root) = root.open_subkey(base) else {
            continue;
        };
        for sub in uninstall_root.enum_keys().flatten() {
            let Ok(entry) = uninstall_root.open_subkey(&sub) else {
                continue;
            };
            let uninstall_string: String = match entry.get_value("UninstallString") {
                Ok(s) => s,
                Err(_) => continue,
            };
            if uninstall_string.is_empty() {
                continue;
            }
            let caps = match re.captures(&uninstall_string) {
                Some(c) => c,
                None => continue,
            };
            let title_id = caps.get(1).unwrap().as_str().to_string();
            let Some(rs_game) = game_by_title_id(&title_id) else {
                eprintln!("[rockstar] Unknown Rockstar game with titleid {title_id}");
                continue;
            };

            // `InstallLocation` may be empty (some entries only carry
            // `UninstallString`). Default to empty + treat as not
            // installed.
            let install_location: String = entry
                .get_value("InstallLocation")
                .ok()
                .unwrap_or_default();
            let install_dir = install_location.trim_matches('"').to_string();

            let is_installed = !install_dir.is_empty()
                && std::path::Path::new(&install_dir).is_dir();

            let path = if is_installed {
                std::path::Path::new(&install_dir)
                    .join(rs_game.executable)
                    .to_string_lossy()
                    .to_string()
            } else {
                String::new()
            };

            // DisplayIcon: sometimes a `.ico`/`.exe` path (possibly
            // quoted). Attach only when the file actually exists.
            let icon_path: Option<String> = entry
                .get_value::<String, _>("DisplayIcon")
                .ok()
                .map(|p| p.trim_matches('"').to_string())
                .filter(|p| !p.is_empty() && std::path::Path::new(p).is_file());

            out.push(RockstarInstalledGame {
                title_id: rs_game.title_id.to_string(),
                name: rs_game.name.to_string(),
                install_dir: if is_installed { install_dir } else { String::new() },
                path,
                icon_path,
                is_installed,
            });
        }
    }
    out
}

#[cfg(not(windows))]
fn scan_installed_rockstar_games_inner() -> Vec<RockstarInstalledGame> {
    Vec::new()
}

// ── Launcher client actions ────────────────────────────────────────────────

/// Launch the Rockstar Games Launcher (background client). Mirrors
/// Playnite's `RockstarGamesLibraryClient.Open` →
/// `RockstarGames.StartClient()`.
pub fn start_client() {
    let exe = client_exec_path();
    if exe.is_empty() {
        eprintln!("[rockstar] Launcher.exe not found — cannot start client");
        return;
    }
    if let Err(e) = std::process::Command::new(&exe).spawn() {
        eprintln!("[rockstar] Failed to start client: {e}");
    }
}

/// Launch a specific installed title *in-place* via the launcher.
///
/// Mirrors Playnite's `RockstarPlayController.Play`, which runs
/// `Launcher.exe -launchTitleInFolder "<installDir>"`. We hand the
/// folder to the launcher rather than spawning the game exe directly
/// so Rockstar's own DRM/social-club bootstrap runs. Returns the
/// spawned child's PID, or `Err` when the launcher isn't installed
/// or the install dir is missing.
pub fn launch_title(title_id: &str) -> Result<u32, String> {
    let exe = client_exec_path();
    if exe.is_empty() {
        return Err("Rockstar Games Launcher is not installed".to_string());
    }
    let installed = scan_installed_rockstar_games();
    let Some(game) = installed.into_iter().find(|g| g.title_id == title_id) else {
        return Err(format!("Rockstar title '{title_id}' is not installed"));
    };
    if game.install_dir.is_empty() {
        return Err(format!("Install directory for '{title_id}' not detected"));
    }
    let mut cmd = std::process::Command::new(&exe);
    cmd.arg("-launchTitleInFolder").arg(&game.install_dir);
    match cmd.spawn() {
        Ok(child) => Ok(child.id()),
        Err(e) => Err(format!("Failed to launch Rockstar title: {e}")),
    }
}

/// Uninstall a specific installed title via the launcher. Mirrors
/// Playnite's `RockstarUninstallController.Uninstall`, which runs
/// `Launcher.exe -enableFullMode -uninstall=<titleId>`.
pub fn uninstall_title(title_id: &str) -> Result<(), String> {
    let exe = client_exec_path();
    if exe.is_empty() {
        return Err("Rockstar Games Launcher is not installed".to_string());
    }
    let mut cmd = std::process::Command::new(&exe);
    cmd.arg("-enableFullMode").arg(format!("-uninstall={title_id}"));
    match cmd.spawn() {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("Failed to start Rockstar uninstall: {e}")),
    }
}

// ── Frontend DTOs ──────────────────────────────────────────────────────────

/// One synced Rockstar title (installed scan result). Mirrors the
/// shape of `GogSyncedGame` / `EpicSyncedGame` for frontend
/// uniformity — camelCase so React can read it directly.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RockstarSyncedGame {
    pub id: String,
    pub title: String,
    /// Rockstar `TitleId` (e.g. `"gta5"`).
    pub title_id: String,
    pub is_installed: bool,
    /// Absolute path to the primary executable (empty when not
    /// installed).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub install_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub install_dir: Option<String>,
    /// Absolute path to the registry `DisplayIcon`, when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_path: Option<String>,
    /// Install size in bytes when measured.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_root_path: Option<String>,
}

/// Result of a full Rockstar scan. Mirrors `GogSyncResult` /
/// `EpicSyncResult` so the Settings tile can render it uniformly.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RockstarSyncResult {
    pub success: bool,
    pub games_imported: usize,
    pub games_skipped: usize,
    pub errors: Vec<String>,
    /// Unix seconds at which the scan completed.
    pub last_sync: u64,
    /// True when the Rockstar Games Launcher is installed at all
    /// (gates the "Sync Library" button on the tile).
    pub client_installed: bool,
    /// Install root of the Rockstar Games Launcher (empty off-Windows
    /// or when not installed).
    pub client_path: String,
    pub synced_games: Vec<RockstarSyncedGame>,
}
