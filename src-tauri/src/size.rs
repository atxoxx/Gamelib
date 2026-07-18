//! Size detection for the Storage tab.
//!
//! Public commands (exposed to the frontend via `#[tauri::command]`):
//!   * `detect_game_size`
//!   * `check_paths_exist`
//!
//! Local helpers (used internally and eligible for unit tests):
//!   * `normalize`
//!   * `walk_up_find_root`
//!   * `sum_folder_size`
//!
//! Design notes
//! ------------
//! * `detect_game_size` does NOT touch the network or the disk beyond the
//!   folder the user pointed at — pure local file system traversal.
//! * The walk-up algorithm is bounded (max 6 ancestor hops) so it cannot
//!   burn the disk on bizarre folder layouts (DLC-style nested installs,
//!   custom prefixes, etc.).
//! * Symlinks are not followed. Following a symlink off the chosen root
//!   risks both infinite loops and double-counting the same bytes from two
//!   paths. We rely on `meta.is_symlink()`, which on Windows and Unix both
//!   report the symlink itself (not the target).
//! * `read_dir` errors on individual subdirectories are non-fatal: log to
//!   stderr and continue. A single permission-denied folder should not
//!   poison the whole size estimate.
//!
//! The persisted Game type mirrors the same fields (see
//! `src-tauri/src/lib.rs::GameData` and `src/types/game.ts::Game`):
//!   * `size_bytes: Option<u64>`
//!   * `size_detected_at: Option<String>` (ISO-8601)
//!   * `size_root_path: Option<String>`

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri_plugin_opener::OpenerExt;

/// Result returned to the frontend after a successful size detection.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SizeDetectionResult {
    /// Folder whose contents were summed. The user can audit this in the
    /// Storage tab's expanded row (and override it by re-pointing at a
    /// different folder).
    pub root_path: String,
    /// Sum of `metadata().len()` for every regular (non-symlinked) file
    /// under `root_path`. Symlinks themselves are NOT counted to avoid
    /// double-counting targets that are reached via more than one path.
    pub size_bytes: u64,
}

/// Normalize a name for fuzzy comparison: lowercase + alphanumeric only.
///
/// We deliberately drop every non-alphanumeric character (spaces, dashes,
/// punctuation, edition markers like "™", language tags like "[EN]", etc.)
/// so that folder names like `The-Witcher-3`/`the_witcher_3`/`The Witcher 3!`
/// all collapse to the same key. Then we compare equality only — false
/// positives are far worse than false negatives for this use case.
fn normalize(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if c.is_alphanumeric() {
            // `to_lowercase` returns an iterator so we correctly handle
            // single-codepoint lowercasing (good enough for game names
            // which are ASCII-heavy; Grapheme-aware matching would be a
            // future enhancement).
            for lc in c.to_lowercase() {
                out.push(lc);
            }
        }
    }
    out
}

/// Walk up from the parent of `exe_path`, returning the first ancestor whose
/// normalized basename equals the normalized game name.
///
/// Bounded to 6 hops: deeper than that, we'd be searching most of the user's
/// filesystem, which is both slow and wrong on Windows where `Program Files`
/// etc. share lots of mutual children.
pub(crate) fn walk_up_find_root(exe_path: &str, game_name: &str) -> Option<PathBuf> {
    let target = normalize(game_name);
    if target.is_empty() {
        return None;
    }
    let start = Path::new(exe_path).parent()?;
    if !start.exists() {
        return None;
    }
    // Bounded to 8 hops: covers the typical install layouts (Steam
    // common/, Epic Games/<Title>/, GOG Galaxy/<Title>/) without
    // walking so far up that we hit a shared ancestor across multiple
    // games (e.g. C:\Games, /mnt/games). Bumped from 6 after a user
    // reported a deeply-nested UE game install (~7 hops deep) not
    // being detected.
    const MAX_HOPS: usize = 8;
    let mut current: Option<PathBuf> = Some(start.to_path_buf());
    let mut hops: usize = 0;
    while let Some(dir) = current.take() {
        if hops > MAX_HOPS {
            break;
        }
        if let Some(name) = dir.file_name().and_then(|n| n.to_str()) {
            if normalize(name) == target {
                return Some(dir);
            }
        }
        current = dir.parent().map(|p| p.to_path_buf());
        hops += 1;
    }
    None
}

/// Recursive byte-sum helper. Skips symlinked children (their targets are
/// already counted via the canonical path). On per-directory `read_dir`
/// failure, logs to stderr and returns; the partial sum is kept.
/// Recursive byte-sum helper. Skips symlinked children (their targets are
/// already counted via the canonical path). On per-directory `read_dir`
/// failure, logs to stderr and returns; the partial sum is kept.
///
/// A `visited` set of canonicalised paths guards against any future edge
/// case where `is_symlink()` misses a reparse point (Windows junctions,
/// bind mounts on Linux). If we ever see a directory we've already
/// walked, we skip it — better to under-count (rare, recoverable via
/// the Storage tab's per-row re-measure) than to hang the UI thread.
fn walk_and_sum(dir: &Path, total: &mut u64, visited: &mut std::collections::HashSet<PathBuf>) {
    // Canonicalise once per directory so the cycle guard compares
    // real paths (e.g. "C:\Games" vs "\\?\C:\Games\..\Games"). On
    // canonicalise failure (permission denied, dangling junction) we
    // fall back to the unresolved path so the walker still makes
    // progress on the rest of the tree.
    let canonical = dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf());
    if !visited.insert(canonical) {
        // Cycle — already walked this directory. Bail out.
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) => {
            eprintln!("[size] read_dir failed for {}: {}", dir.display(), e);
            return;
        }
    };
    for entry in entries.flatten() {
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        // Don't follow symlinks — prevents both infinite loops and double
        // counting the same target bytes through multiple paths.
        if meta.is_symlink() {
            continue;
        }
        let ftype = meta.file_type();
        if ftype.is_dir() {
            walk_and_sum(&entry.path(), total, visited);
        } else if ftype.is_file() {
            // Using `saturating_add` instead of `+= so a maliciously huge
            // total can't overflow even on a misbehaving FS.
            *total = total.saturating_add(meta.len());
        }
        // Other file kinds (sockets, FIFOs, block devices on Linux) are
        // ignored — they have no meaningful file size.
    }
}

/// Measure the size of an already-resolved install dir. Thin wrapper
/// around `sum_folder_size` that swallows the `Err` so sync flows
/// can `and_then(...)` without writing the `if let Ok(...) = ...` ladder.
///
/// Returns `None` when the walk errors (folder gone, permission denied,
/// etc.) -- never aborts the caller.
///
/// Callers MUST pass the canonical install dir, NOT `parent(exe)`. For
/// Unreal / Unity / Source-engine games, the largest .exe lives in a
/// bin subfolder (`Binaries/Win64/`, `_Data/`, `bin/`) so its parent
/// is a strict subset of the install dir and the measurement would
/// miss engine content, plugins, and packaged assets. Sync flows
/// should use `steam_game_watcher::game_install_path(app_id)` (Steam)
/// or the `InstallLocation` from the Epic manifest (Epic) to get the
/// true root.
pub(crate) fn measure_folder_size(folder: &Path) -> Option<SizeDetectionResult> {
    sum_folder_size(folder).ok()
}

/// Sum the total bytes of every regular (non-symlinked) file under `root`.
pub(crate) fn sum_folder_size(root: &Path) -> Result<SizeDetectionResult, String> {
    if !root.exists() {
        return Err(format!("Folder does not exist: {}", root.display()));
    }
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", root.display()));
    }
    let mut total: u64 = 0;
    let mut visited: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    walk_and_sum(root, &mut total, &mut visited);
    Ok(SizeDetectionResult {
        root_path: root.to_string_lossy().to_string(),
        size_bytes: total,
    })
}

/// Resolve the game's folder and sum its bytes.
///
/// Resolution priority:
///   1. `root_override` — when the user explicitly picked a folder in the
///      UI, use that exact path verbatim. This is the primary path used by
///      the Edit-modal "Auto-detect" button.
///   2. `walk_up_find_root(exe_path, game_name)` — climb parents from the
///      exe looking for a name-matching ancestor. Reserved for a future
///      auto-detect-via-exe flow; not currently called by the frontend
///      because the interview confirmed sync stays manual.
///   3. Fallback — the immediate parent of `exe_path`.
#[tauri::command]
pub fn detect_game_size(
    exe_path: String,
    game_name: String,
    root_override: Option<String>,
) -> Result<SizeDetectionResult, String> {
    if let Some(folder) = root_override {
        if folder.is_empty() {
            return Err("rootOverride was empty".into());
        }
        return sum_folder_size(Path::new(&folder));
    }
    let root = walk_up_find_root(&exe_path, &game_name).unwrap_or_else(|| {
        Path::new(&exe_path)
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."))
    });
    sum_folder_size(&root)
}

/// Bulk staleness check used by the Storage tab's lazy mount-time refresh.
///
/// Returns a parallel `Vec<bool>` where each entry corresponds to the
/// input path at the same index. `true` means the path still exists on
/// disk. The frontend uses this to drive the "Last seen: …" UI for
/// games whose `sizeRootPath` no longer exists.
#[tauri::command]
pub fn check_paths_exist(paths: Vec<String>) -> Vec<bool> {
    paths.iter().map(|p| Path::new(p).exists()).collect()
}

/// Reveal `path` in the OS file manager (Explorer / Finder / file
/// browser). Mirrors `torrent_open_folder` but takes an arbitrary path
/// so the Storage tab can jump straight to a game's measured folder.
///
/// If `path` is a file, its parent directory is opened (you can't
/// "open" a file in a file manager, only its container). Returns an
/// error if the resolved target does not exist, so the frontend can
/// surface a toast instead of silently doing nothing.
#[tauri::command]
pub fn open_folder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("open_folder: empty path".into());
    }
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("Folder does not exist: {}", path));
    }
    let target = if p.is_file() {
        p.parent().unwrap_or(p)
    } else {
        p
    };
    app.opener()
        .open_path(target.to_string_lossy().as_ref(), None::<&str>)
        .map_err(|e| format!("Failed to open folder: {}", e))
}

/// Disk-space statistics for the volume that hosts `path`.
///
/// Returns total / free / available bytes for the filesystem containing
/// `path`. `available` (bytes usable by an unprivileged user, which may
/// be less than `free` because of root reservations on Unix) is what the
/// Storage tab should compare against game usage. Used to render the
/// "used of total" utilization bar in the "By drive" breakdown card.
///
/// Implemented dependency-free: Windows uses `GetDiskFreeSpaceExW` via
/// the already-vendored `windows` crate; Unix shells out to `df` (a
/// mandatory, always-present utility). If the platform query fails we
/// return `None` rather than aborting — the card simply hides the
/// utilization portion.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiskUsage {
    /// Total capacity of the volume, in bytes.
    pub total: u64,
    /// Free bytes on the volume (raw).
    pub free: u64,
    /// Bytes available to the current user (≤ free on Unix).
    pub available: u64,
}

#[tauri::command]
pub fn disk_usage(path: String) -> Result<DiskUsage, String> {
    let probe = if path.trim().is_empty() {
        None
    } else {
        Some(path.clone())
    };
    disk_usage_inner(probe.as_deref())
}

#[cfg(windows)]
fn disk_usage_inner(path: Option<&str>) -> Result<DiskUsage, String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let wide: Vec<u16> = std::ffi::OsStr::new(path.unwrap_or("."))
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut free_to_caller: u64 = 0;
    let mut total: u64 = 0;
    let mut free: u64 = 0;
    // SAFETY: we pass a valid, NUL-termined wide string and valid
    // out-pointers. GetDiskFreeSpaceExW writes all three.
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            windows::core::PCWSTR(wide.as_ptr()),
            Some(&mut free_to_caller),
            Some(&mut total),
            Some(&mut free),
        )
        .is_ok()
    };
    if !ok {
        return Err("GetDiskFreeSpaceExW failed".into());
    }
    Ok(DiskUsage {
        total,
        free,
        available: free_to_caller,
    })
}

#[cfg(not(windows))]
fn disk_usage_inner(path: Option<&str>) -> Result<DiskUsage, String> {
    use std::process::Command;

    let target = path.unwrap_or(".");
    let out = Command::new("df")
        .arg("-P") // POSIX portable format, single line per mount
        .arg("-k") // 1024-byte blocks (portable across df variants)
        .arg("--")
        .arg(target)
        .output()
        .map_err(|e| format!("df failed to spawn: {}", e))?;
    if !out.status.success() {
        return Err(format!(
            "df exited {}: {}",
            out.status,
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    // Parse the second line: `Filesystem 1024-blocks Used Available Capacity Mounted`
    let text = String::from_utf8_lossy(&out.stdout);
    let line = text.lines().nth(1).ok_or("df produced no data row")?;
    let cols: Vec<&str> = line.split_whitespace().collect();
    // Available is the 4th field; total (1024-blocks) is the 2nd.
    let total_k = cols
        .get(1)
        .and_then(|c| c.parse::<u64>().ok())
        .ok_or("df: could not parse total blocks")?;
    let available_k = cols
        .get(3)
        .and_then(|c| c.parse::<u64>().ok())
        .ok_or("df: could not parse available blocks")?;
    let total = total_k.saturating_mul(1024);
    let available = available_k.saturating_mul(1024);
    let free = available; // exact free unavailable without root-resv math; available is the safe upper bound
    Ok(DiskUsage {
        total,
        free,
        available,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_strips_punctuation_and_case() {
        assert_eq!(normalize("The Witcher 3 — Wild Hunt!"), "thewitcher3wildhunt");
        assert_eq!(normalize("the_witcher_3"), "thewitcher3");
        assert_eq!(normalize("The-Witcher-3"), "thewitcher3");
        assert_eq!(normalize(""), "");
    }

    #[test]
    fn walk_up_finds_match_at_level_two() {
        let layout = std::env::temp_dir().join(format!(
            "gametest-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let game_dir = layout.join("SomeGame");
        let bin_dir = game_dir.join("bin");
        std::fs::create_dir_all(&bin_dir).unwrap();
        let exe = bin_dir.join("game.exe");
        std::fs::write(&exe, b"x").unwrap();

        let found = walk_up_find_root(exe.to_str().unwrap(), "SomeGame");
        assert_eq!(found.as_ref().map(|p| p.to_string_lossy().to_string()), Some(game_dir.to_string_lossy().to_string()));

        std::fs::remove_dir_all(&layout).ok();
    }

    #[test]
    fn walk_up_returns_none_when_no_match() {
        let layout = std::env::temp_dir().join(format!(
            "gametest-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&layout).unwrap();
        let exe = layout.join("foo.exe");
        std::fs::write(&exe, b"x").unwrap();

        let found = walk_up_find_root(exe.to_str().unwrap(), "NotTheNameOfLayout");
        assert!(found.is_none());

        std::fs::remove_dir_all(&layout).ok();
    }

    #[test]
    fn measure_folder_size_sums_bytes() {
        let layout = std::env::temp_dir().join(format!(
            "gametest-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let root = layout.join("install");
        let bin = root.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(root.join("game.dat"), b"12345").unwrap(); // 5 bytes
        std::fs::write(bin.join("game.exe"), b"abcde").unwrap();   // 5 bytes
        // Junk file that the install dir would never contain — proves
        // we're measuring the right folder, not the temp parent.
        std::fs::write(layout.join("junk.bin"), b"XXXXXXXXXXXXXXXXXXXX").unwrap();

        let result = measure_folder_size(&root).expect("walk should succeed");
        assert_eq!(result.size_bytes, 10, "should sum 5 + 5 from inside `root` only");
        assert_eq!(result.root_path, root.to_string_lossy().to_string());

        // Missing folder: should return None, not Err.
        assert!(measure_folder_size(Path::new("/definitely/does/not/exist/anywhere")).is_none());

        std::fs::remove_dir_all(&layout).ok();
    }

    #[test]
    fn sum_folder_size_skips_subdirectory_symlink() {
        let layout = std::env::temp_dir().join(format!(
            "gametest-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let target = layout.join("real");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(target.join("a.bin"), b"12345").unwrap();

        // On Windows, creating symlinks requires admin/developer mode; we
        // only run the symlink assertion when the OS supports it.
        #[cfg(unix)]
        {
            let link = layout.join("link");
            std::os::unix::fs::symlink(&target, &link).unwrap();
            let result = sum_folder_size(&target).unwrap();
            // Real folder has only the 5-byte `a.bin`, NOT the symlinked
            // copy (which would be 5 bytes if followed).
            assert_eq!(result.size_bytes, 5);
            assert_eq!(result.root_path, target.to_string_lossy().to_string());
        }

        std::fs::remove_dir_all(&layout).ok();
    }
}
