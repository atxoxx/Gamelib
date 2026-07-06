use windows::core::PCSTR;
use windows::Win32::System::Memory::{
    MapViewOfFile, OpenFileMappingA, UnmapViewOfFile, FILE_MAP_READ,
};
use windows::Win32::Foundation::{CloseHandle, HANDLE, BOOL};
use std::ffi::CString;
use std::sync::Mutex;

/// Real-time metrics read from RTSS shared memory for a specific process.
#[derive(Debug, Clone)]
pub struct RtssMetrics {
    pub fps: f64,
    #[allow(dead_code)]
    pub stat_fps_avg: f64,
    #[allow(dead_code)]
    pub stat_fps_min: f64,
    #[allow(dead_code)]
    pub stat_fps_max: f64,
}

/// Cached handle value stored as an integer to satisfy `Sync` for the static Mutex.
static CACHED_HANDLE: Mutex<Option<isize>> = Mutex::new(None);

unsafe fn try_open() -> Option<isize> {
    if let Ok(cache) = CACHED_HANDLE.lock() {
        if let Some(handle) = *cache {
            return Some(handle);
        }
    }

    let name = CString::new("Local\\RTSSSharedMemoryV2").ok()?;

    let h = OpenFileMappingA(
        FILE_MAP_READ.0,
        BOOL::from(false),
        PCSTR(name.as_ptr() as *const u8),
    );

    match h {
        Ok(handle) => {
            let raw = handle.0 as isize;
            let _ = handle;
            if let Ok(mut cache) = CACHED_HANDLE.lock() {
                *cache = Some(raw);
            }
            Some(raw)
        }
        Err(_) => None,
    }
}

/// Try to read RTSS performance metrics for a given process ID.
///
/// Returns `None` if:
/// - RTSS is not running (shared memory not found)
/// - The specified PID is not in the RTSS app list
/// - The shared memory data is invalid
pub fn read_rtss_metrics(pid: u32) -> Option<RtssMetrics> {
    unsafe {
        let handle_raw = try_open()?;
        let map_handle = HANDLE(handle_raw as *mut std::ffi::c_void);

        let view = MapViewOfFile(map_handle, FILE_MAP_READ, 0, 0, 0);

        let base = view.Value;
        if base.is_null() {
            let _ = UnmapViewOfFile(view);
            return None;
        }

        // Verify magic signature "RTSS" = 0x53535452
        let signature = *(base as *const u32);
        if signature != 0x5353_5452 {
            let _ = UnmapViewOfFile(view);
            return None;
        }

        // Read header to find the app entries array
        let app_arr_offset = *(base.add(0x0008) as *const u32) as usize;
        let app_arr_size = *(base.add(0x000C) as *const u32) as usize;
        let app_entry_size = *(base.add(0x0010) as *const u32) as usize;

        // Sanity checks
        if app_arr_offset == 0
            || app_arr_offset > 0x4000
            || app_arr_size == 0
            || app_arr_size > 256
            || app_entry_size < 0x100
            || app_entry_size > 0x1000
        {
            let _ = UnmapViewOfFile(view);
            return None;
        }

        let entries_ptr = base.add(app_arr_offset);
        let max_entries = app_arr_size.min(64);

        let mut result: Option<RtssMetrics> = None;

        for i in 0..max_entries {
            let entry_offset = app_arr_offset + i * app_entry_size;

            // Bounds check — ensure we don't read past a reasonable shared memory size
            if entry_offset + 0x200 > 0x20000 {
                break;
            }

            let entry = entries_ptr.add(i * app_entry_size);
            let entry_pid = *(entry as *const u32);

            if entry_pid == pid {
                // Try multiple (min, avg, max) offset triplets — RTSS layout
                // shifts across builds (7.3.x vs newer), and corroupt /
                // uninitialised offsets can otherwise return enormous values
                // (e.g. 30,000+ "FPS" caused by reading the wrong field as
                // u32 / 100). The validation below rejects them.
                let offsets: &[(usize, usize, usize)] = &[
                    (0x1BC, 0x1C0, 0x1C4), // RTSS 7.3.x — current primary
                    (0x1C0, 0x1C4, 0x1C8), // adjacent variant
                    (0x1E0, 0x1E4, 0x1E8), // alternative layout
                ];

                for &(off_min, off_avg, off_max) in offsets {
                    // Bounds-check before dereferencing each triplet:
                    // app_arr_offset + i * app_entry_size + off_max must
                    // remain within the shared memory window so we don't
                    // segfault on out-of-range layouts.
                    if entry_offset + off_max + 4 > 0x20000 {
                        continue;
                    }

                    let min_raw = *(entry.add(off_min) as *const u32);
                    let avg_raw = *(entry.add(off_avg) as *const u32);
                    let max_raw = *(entry.add(off_max) as *const u32);

                    let min_fps = min_raw as f64 / 100.0;
                    let avg_fps = avg_raw as f64 / 100.0;
                    let max_fps = max_raw as f64 / 100.0;

                    // Tightened validation:
                    //  - All three values must be > 0 (rejects uninitialised
                    //    / zero-filled entries that would otherwise read as
                    //    "0 FPS but valid" and diverge from WMI MAHM).
                    //  - 500 FPS upper bound on **every** value, including
                    //    max. Without the max bound, a triple like
                    //    (min=1, avg=10, max=u32::MAX/100) passes the
                    //    existing checks (avg <= 500 and min <= avg <= max)
                    //    and let a poisoned max ride through into the
                    //    session metrics. The persisted maxFps = u32::MAX then
                    //    blows up the GameActivity FPS chart's Y-axis (it
                    //    auto-scales to it and renders gridlines like
                    //    858993459, 1717986918, 2576980777, 3435973836,
                    //    4294967262 — the 0x33/0x66/0x99/0xCC/0xFF pattern).
                    //  - min <= avg <= max — preserves the monotonic invariant
                    //    of an FPS min/avg/max trio.
                    if min_fps > 0.0
                        && avg_fps > 0.0
                        && max_fps > 0.0
                        && avg_fps <= 500.0
                        && min_fps <= 500.0
                        && max_fps <= 500.0
                        && min_fps <= avg_fps
                        && avg_fps <= max_fps
                    {
                        result = Some(RtssMetrics {
                            fps: avg_fps,
                            stat_fps_avg: avg_fps,
                            stat_fps_min: min_fps,
                            stat_fps_max: max_fps,
                        });
                        break;
                    }
                }
                break;
            }
        }

        let _ = UnmapViewOfFile(view);
        result
    }
}

/// Release the cached RTSS shared memory handle (call on shutdown).
#[allow(dead_code)]
pub fn release_rtss() {
    if let Ok(mut cache) = CACHED_HANDLE.lock() {
        if let Some(handle) = cache.take() {
            unsafe {
                let _ = CloseHandle(HANDLE(handle as *mut std::ffi::c_void));
            }
        }
    }
}
