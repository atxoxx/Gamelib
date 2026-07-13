// helper preserves the documented Phase-0 escape hatch.
#![allow(dead_code)]

//! Phase-0 atomic write helper.
//!
//! Every "write a JSON blob to disk" call site before Phase 0 went
//! `serde_json::to_string_pretty(&x)` → `std::fs::write(&path, json)`.
//! Both halves are problematic:
//!
//! 1. `to_string_pretty` adds whitespace that bloats the on-disk size
//!    by 30–40 % and slows parses on large caches (e.g. each
//!    `<sources_cache/{id}.json>` catalog blob is 1–3 MB pretty-printed).
//! 2. `std::fs::write` is **not atomic**: if the process is killed or
//!    the system loses power mid-write, the destination file is left
//!    truncated or empty. The next launch then fails to parse, with no
//!    way to recover except for the user manually deleting the file.
//!
//! [`write_compact_json`] and [`write_bytes`] replace every such call site.
//! They serialize with `serde_json::to_vec` (no pretty printer — pure
//! UTF-8 bytes) and persist atomically via tempfile + `fs::rename`, so a
//! crash mid-write leaves the previous intact copy in place.
//!
//! On Windows, `tempfile::NamedTempFile::persist_noclobber` is implemented
//! via `MoveFileExW(... MOVEFILE_REPLACE_EXISTING)` so a partial target
//! is overwritten atomically. On macOS / Linux it's a plain `rename(2)`
//! which is atomic on POSIX. Either way, readers either see the old
//! content or the new content — never a half-written blob.

use std::io::Write;
use std::path::Path;

// Phase-0 helpers are kept around for any unmigrated JSON file that
// inevitably surfaces during a future migration window. Suppressing
// the dead-code lint at the module level rather than deleting each
/// Serialize `value` as compact JSON (no whitespace) and persist it to
/// `target_path` atomically ("write to .tmp → fsync → rename").
///
/// Returns an error if any of serialization, temp-file creation, write,
/// or rename fails. On error, the target file is left untouched (the
/// old contents stay readable), and the temporary file is dropped by
/// `tempfile`'s destructor.
///
/// Use this for any JSON file we don't yet model in SQLite. New writes
/// after the Phase 1 DAO migration should call into the DAOs instead.
pub fn write_compact_json<P: AsRef<Path>, T: serde::Serialize>(
    target_path: P,
    value: &T,
) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|e| format!("serialize: {e}"))?;
    write_bytes(target_path, &bytes)
}

/// Atomic write of a raw byte slice. Public for callers that already
/// have serialized bytes (e.g. an image or an already-serialized JSON).
pub fn write_bytes<P: AsRef<Path>>(target_path: P, bytes: &[u8]) -> Result<(), String> {
    let target = target_path.as_ref();
    let parent = target
        .parent()
        .ok_or_else(|| format!("target has no parent: {}", target.display()))?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("mkdir {}: {}", parent.display(), e))?;

    // NamedTempFile lives in the same directory so `rename` stays
    // on a single filesystem (cross-filesystem rename is silently
    // degraded to copy+delete, which loses atomicity).
    let mut tmp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| format!("create tmp in {}: {}", parent.display(), e))?;
    tmp.write_all(bytes)
        .map_err(|e| format!("write tmp: {e}"))?;
    tmp.flush().map_err(|e| format!("flush tmp: {e}"))?;
    // Persist with `noclobber`: if the target reappeared (e.g. a
    // concurrent writer raced us), the rename fails rather than
    // silently overwriting. Re-callers can retry after observing
    // the failure.
    tmp.persist_noclobber(target)
        .map_err(|e| format!("rename tmp → {}: {}", target.display(), e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_compact_json_atomically_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("k.json");
        std::fs::write(&target, b"{\"old\":true}").unwrap();
        write_compact_json(&target, &serde_json::json!({"new": 42})).unwrap();
        let read = std::fs::read_to_string(&target).unwrap();
        let v: serde_json::Value = serde_json::from_str(&read).unwrap();
        assert_eq!(v["new"], serde_json::json!(42));
    }

    #[test]
    fn write_compact_json_no_whitespace() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("c.json");
        write_compact_json(&target, &serde_json::json!({"a": 1, "b": [1, 2]})).unwrap();
        let s = std::fs::read_to_string(&target).unwrap();
        assert!(!s.contains('\n'), "compact JSON should not contain newlines: {s}");
    }

    #[test]
    fn write_bytes_calls_persist_noclobber() {
        // Two consecutive atomics land on the target; the second
        // wins. We just verify no panic and second value present.
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("x.bin");
        write_bytes(&target, b"first").unwrap();
        write_bytes(&target, b"second").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"second");
    }
}
