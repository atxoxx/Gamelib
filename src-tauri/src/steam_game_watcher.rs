//! Steam session watcher.
//!
//! When GameContext.launchGame dispatches `steam://run/<appid>` via the
//! opener plugin it loses its handle to the game — there's no PID, no
//! child process, no waitable handle. This module reattaches the same
//! "monitor until exit" pipeline that `launch_game` provides for local
//! executables:
//!
//! 1. Resolve the Steam install root (`<root>\steam.exe`).
//! 2. Parse `steamapps\libraryfolders.vdf` to learn every secondary
//!    library disk (Steam's standard system, since 2014).
//! 3. For each library, attempt to read
//!    `steamapps\appmanifest_<appid>.acf` and lift the `installdir`.
//! 4. Bulk-query `Win32_Process` via WMI on each poll; if any process's
//!    `ExecutablePath` starts with the resolved game install dir, mark
//!    the session alive and use the dominant (highest-memory) matching
//!    process as the metrics target so RTSS hooks the right PID.
//! 5. When the match disappears, return the elapsed time + averaged
//!    metrics to `lib::run` which emits `game-exited`.
//!
//! The frontend's ActivityContext already filters sub-1-minute sessions
//! so we deliberately emit raw seconds and don't filter here — keeps
//! the boundary between detection and presentation clean.

use serde::Serialize;
use std::path::{Path, PathBuf};

/// Lightweight parsed Steam app manifest. Only the fields we care about.
#[derive(Debug, Clone, Serialize)]
pub struct AppManifest {
    pub app_id: u32,
    pub name: String,
    pub install_dir: String,
    /// Library root where this app lives (e.g. `D:\SteamLibrary`).
    pub library_root: PathBuf,
}

/// Find the local Steam install root. Only the two well-known default
/// locations; advanced deployments with a non-default Steam path are
/// uncommon and we surface a clear error from `find_app_install_dir`
/// rather than reaching into the Windows registry from Rust (avoids a
/// new dependency just for a single key read).
pub fn find_steam_install_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        let candidates = [
            r"C:\Program Files (x86)\Steam",
            r"C:\Program Files\Steam",
        ];
        for c in &candidates {
            let p = Path::new(c);
            // The presence of steam.exe is a strong signal; directory
            // existence alone can match a half-installed Steam.
            if p.join("steam.exe").exists() {
                return Some(p.to_path_buf());
            }
        }
        None
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// Read `<root>\steamapps\libraryfolders.vdf` and return every library
/// root it declares. The file is a flat list under "LibraryFolders":
///
/// ```
/// "LibraryFolders"
/// {
///     "TimeNextStatsReport" "..."
///     "ContentStatsID" "..."
///     "1"      "D:\\SteamLibrary"
///     "2"      "E:\\Games\\Steam"
/// }
/// ```
///
/// Older clients use a nested `apps` / `size` format; we handle both by
/// accepting either a numeric top-level key (`"1"`, `"2"`) or a nested
/// `"path"` key — see the parser below for the matching heuristic.
pub fn parse_library_folders(raw: &str) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();

    // `split('"')` over the VDF pattern yields FIVE elements for the
    // four quote markers in `"key" "value"`:
    //
    //     [pre, key, sep(whitespace), value, post]
    //
    // Walk the odd indices (1, 3, 5, ...) — every one of these sits
    // between two quote markers, so a pair at indices (1, 3) catches
    // (key, value). Pairing (1, 2) like the original code did reads
    // (key, separator) instead — caught in review.
    let parts: Vec<&str> = raw.split('"').collect();
    let mut i = 1;
    while i + 2 < parts.len() {
        let key = parts[i];
        let value = parts[i + 2];

        // Modern format:        key = "1",        value = "D:\\SteamLibrary"
        // Legacy nested format: key = "path",     value = "D:\\SteamLibrary"
        // Both keys identify a library root whose path is in `value`.
        if key == "path" || key.chars().all(|c| c.is_ascii_digit()) {
            if is_absolute_path_string(value) {
                roots.push(PathBuf::from(value));
            }
        }
        i += 2;
    }

    // Preserve order but remove duplicates so the manifest search is
    // idempotent.
    let mut seen = std::collections::HashSet::new();
    roots.retain(|p| seen.insert(p.clone()));
    roots
}

fn is_absolute_path_string(s: &str) -> bool {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return false;
    }
    // Windows: drive-letter paths ("C:\...") or UNC ("\\server\share").
    (trimmed.len() >= 3
        && trimmed.as_bytes()[0].is_ascii_alphabetic()
        && trimmed.as_bytes()[1] == b':'
        && matches!(trimmed.as_bytes()[2], b'\\' | b'/'))
        || trimmed.starts_with("\\\\")
}

/// Read `<root>\steamapps\appmanifest_<appid>.acf` to find where a
/// given AppID is installed. Returns the parsed manifest (with the
/// resolved library root) on success or `None` if the manifest is
/// missing / unparseable. Callers should fall back to a synthetic
/// pseudo-session if this returns `None`.
pub fn find_app_install_dir(app_id: u32) -> Option<AppManifest> {
    let primary_root = find_steam_install_dir()?;

    // Build the search list: primary install first, then every
    // library declared in libraryfolders.vdf under the primary.
    let libraries_vdf = primary_root.join("steamapps").join("libraryfolders.vdf");
    let secondary: Vec<PathBuf> = std::fs::read_to_string(&libraries_vdf)
        .ok()
        .map(|raw| parse_library_folders(&raw))
        .unwrap_or_default();

    let library_roots = std::iter::once(primary_root.clone()).chain(secondary.into_iter());

    for lib_root in library_roots {
        let manifest_path = lib_root
            .join("steamapps")
            .join(format!("appmanifest_{}.acf", app_id));
        if !manifest_path.exists() {
            continue;
        }
        let raw = match std::fs::read_to_string(&manifest_path) {
            Ok(s) => s,
            Err(_) => continue,
        };
        if let Some(parsed) = parse_appmanifest(&raw, app_id) {
            return Some(AppManifest {
                app_id: parsed.app_id,
                name: parsed.name,
                install_dir: parsed.install_dir,
                library_root: lib_root,
            });
        }
    }

    None
}

/// Resolve the absolute install directory for a Steam AppID. Returns
/// `<lib_root>\steamapps\common\<installdir>`.
pub fn game_install_path(app_id: u32) -> Option<PathBuf> {
    let manifest = find_app_install_dir(app_id)?;
    Some(
        manifest
            .library_root
            .join("steamapps")
            .join("common")
            .join(&manifest.install_dir),
    )
}

/// Test-only public wrapper — parses the contents of an AppState
/// block (Valve KeyValues) and lifts the keys we need. Public so we
/// can unit-test without touching the filesystem.
pub fn parse_appmanifest(raw: &str, fallback_app_id: u32) -> Option<AppManifestFields> {
    // Strip BOM if present (Steam sometimes writes UTF-8 BOM).
    let raw = raw.trim_start_matches('\u{feff}');

    let mut app_id: Option<u32> = None;
    let mut name: Option<String> = None;
    let mut installdir: Option<String> = None;

    // Walk odd indices (1, 3, 5, …) and look two slots ahead for the
    // value. `split('"')` on `"appid" "440"` yields `["", "appid",
    // " ", "440", ""]` — so to pair (key, value) we need
    // `(parts[i], parts[i+2])`, not the off-by-one `(parts[i],
    // parts[i+1])` that pairs (key, whitespace-separator).
    let parts: Vec<&str> = raw.split('"').collect();
    let mut i = 1;
    while i + 2 < parts.len() {
        let key = parts[i];
        let value = parts[i + 2];
        match key {
            "appid" => app_id = value.trim().parse::<u32>().ok().or(Some(fallback_app_id)),
            "name" => name = Some(value.to_string()),
            "installdir" => installdir = Some(value.to_string()),
            _ => {}
        }
        i += 2;
    }

    Some(AppManifestFields {
        // If the manifest omitted appid (extremely rare) fall back to
        // the caller's AppID; that case still resolves the install dir
        // correctly because we already located the file by AppID.
        app_id: app_id.unwrap_or(fallback_app_id),
        name: name.unwrap_or_default(),
        install_dir: installdir?,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppManifestFields {
    pub app_id: u32,
    pub name: String,
    pub install_dir: String,
}

/// Result of a single `is_game_process_running` poll.
#[derive(Debug, Clone, Default)]
pub struct ProcessMatch {
    /// Is at least one process running whose executable lives under
    /// the game's install directory?
    pub running: bool,
    /// PID of the dominant matching process (highest WorkingSetSize).
    /// `None` if no process matched — ActivityContext doesn't care
    /// about this, only `metrics_collector::start_metrics_collection`
    /// does, for RTSS hooking.
    pub dominant_pid: Option<u32>,
}

/// Windows-only: enumerate Win32_Process once and filter in Rust. We
/// pull every process in one WMI query — the WMI server caches the
/// underlying snapshot and a single round-trip is much cheaper than
/// running one query per execution path.
#[cfg(windows)]
pub fn is_game_process_running(install_dir: &Path) -> ProcessMatch {
    use wmi::{COMLibrary, WMIConnection};

    // Case-insensitive path comparison: Windows paths are
    // case-insensitive but WMI preserves whatever case the EXE was
    // registered with, which is not always our normalised form.
    let needle = install_dir.to_string_lossy().to_lowercase();
    // Trim trailing separator for prefix matching.
    let needle = needle.trim_end_matches('\\').trim_end_matches('/').to_string();

    // See metrics_collector::collect_metrics_loop: CoInitializeSecurity
    // is process-wide, so once it has been claimed (e.g. by
    // get_system_ram_gb during app start) every subsequent
    // COMLibrary::new() on a different thread fails. We poll WMI
    // from a background thread inside watch_steam_game, so without
    // the without_security() fallback every poll returns
    // ProcessMatch::default() { running: false } and Phase 1
    // times out, even for a real running game. Fall back so the
    // detection actually works.
    let com_lib = match COMLibrary::new() {
        Ok(lib) => lib,
        Err(_) => match COMLibrary::without_security() {
            Ok(lib) => lib,
            Err(_) => return ProcessMatch::default(),
        },
    };
    let wmi_con = match WMIConnection::new(com_lib) {
        Ok(con) => con,
        Err(_) => return ProcessMatch::default(),
    };

    #[derive(serde::Deserialize, Debug)]
    #[serde(rename_all = "PascalCase")]
    struct ProcRow {
        process_id: Option<u32>,
        executable_path: Option<String>,
        working_set_size: Option<u64>,
    }

    let query = "SELECT ProcessId, ExecutablePath, WorkingSetSize FROM Win32_Process WHERE ExecutablePath IS NOT NULL";
    let rows: Vec<ProcRow> = match wmi_con.raw_query::<ProcRow>(query) {
        Ok(r) => r,
        Err(_) => return ProcessMatch::default(),
    };

    // Pick the matching process with the largest working set. Steam
    // launches the primary game EXE large (hundreds of MB) and any
    // helper launchers are typically tens of MB. Memory is a
    // reliable distinguishing signal without needing to enumerate the
    // install dir's EXE files up front.
    let mut best_pid: Option<u32> = None;
    let mut best_size: u64 = 0;
    for row in rows {
        let Some(path) = row.executable_path else { continue };
        let path_lc = path.to_lowercase();
        if !path_lc.starts_with(&needle) {
            continue;
        }
        let size = row.working_set_size.unwrap_or(0);
        if size >= best_size {
            best_size = size;
            best_pid = row.process_id;
        }
    }

    ProcessMatch {
        running: best_pid.is_some(),
        dominant_pid: best_pid,
    }
}

#[cfg(not(windows))]
pub fn is_game_process_running(_install_dir: &Path) -> ProcessMatch {
    ProcessMatch::default()
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── VDF / KeyValues parsing ─────────────────────────────────────

    #[test]
    fn parse_minimal_appmanifest() {
        let raw = r#""AppState"
{
    "appid"  "440"
    "name"  "Team Fortress 2"
    "installdir"  "Team Fortress 2"
}
"#;
        let m = parse_appmanifest(raw, 440).unwrap();
        assert_eq!(m.app_id, 440);
        assert_eq!(m.name, "Team Fortress 2");
        assert_eq!(m.install_dir, "Team Fortress 2");
    }

    #[test]
    fn parse_appmanifest_with_extra_keys() {
        let raw = r#""AppState"
{
    "appid"  "570"
    "name"  "Dota 2"
    "installdir"  "dota 2 beta"
    "StateFlags"  "4"
    "LastUpdated"  "1700000000"
    "UpdateScheduled"  "0"
    "SizeOnDisk"  "12345678"
}
"#;
        let m = parse_appmanifest(raw, 570).unwrap();
        assert_eq!(m.app_id, 570);
        assert_eq!(m.install_dir, "dota 2 beta");
        assert_eq!(m.name, "Dota 2");
    }

    #[test]
    fn parse_handles_utf8_bom() {
        // Some Steam clients prepend a BOM to appmanifest files.
        let raw = "\u{feff}\"AppState\"\n{\n    \"appid\"  \"440\"\n    \"name\"  \"Team Fortress 2\"\n    \"installdir\"  \"tf\"\n}\n";
        let m = parse_appmanifest(raw, 440).unwrap();
        assert_eq!(m.install_dir, "tf");
    }

    #[test]
    fn parse_returns_none_when_installdir_missing() {
        let raw = r#""AppState"
{
    "appid"  "440"
    "name"  "Team Fortress 2"
}
"#;
        let m = parse_appmanifest(raw, 440);
        assert!(m.is_none(), "installdir is required");
    }

    #[test]
    fn parse_fallback_appid_when_omitted() {
        let raw = r#""AppState"
{
    "name"  "Test"
    "installdir"  "Test"
}
"#;
        let m = parse_appmanifest(raw, 7777).unwrap();
        assert_eq!(m.app_id, 7777);
    }

    // ── libraryfolders.vdf parsing ──────────────────────────────────

    #[test]
    fn parse_library_folders_modern_format() {
        let raw = r#""LibraryFolders"
{
    "TimeNextStatsReport" "1234567890"
    "ContentStatsID" "-12345"
    "1"      "D:\\SteamLibrary"
    "2"      "E:\\Games\\Steam"
}
"#;
        let libs = parse_library_folders(raw);
        assert_eq!(
            libs,
            vec![PathBuf::from("D:\\SteamLibrary"), PathBuf::from("E:\\Games\\Steam")]
        );
    }

    #[test]
    fn parse_library_folders_ignores_non_paths() {
        let raw = r#""LibraryFolders"
{
    "TimeNextStatsReport" "1234567890"
    "1"      "D:\\SteamLibrary"
}
"#;
        let libs = parse_library_folders(raw);
        assert_eq!(libs, vec![PathBuf::from("D:\\SteamLibrary")]);
    }

    #[test]
    fn parse_library_folders_dedupes() {
        let raw = r#""LibraryFolders"
{
    "1"      "D:\\SteamLibrary"
    "2"      "D:\\SteamLibrary"
}
"#;
        let libs = parse_library_folders(raw);
        assert_eq!(libs, vec![PathBuf::from("D:\\SteamLibrary")]);
    }

    // ── Path-string detection ──────────────────────────────────────

    #[test]
    fn is_absolute_windows_drive_letter() {
        assert!(is_absolute_path_string("C:\\Games"));
        assert!(is_absolute_path_string("d:/steam"));
        assert!(!is_absolute_path_string(""));
        assert!(!is_absolute_path_string("relative/path"));
        assert!(!is_absolute_path_string("123"));
    }

    #[test]
    fn is_absolute_unc() {
        assert!(is_absolute_path_string("\\\\server\\share"));
    }
}
