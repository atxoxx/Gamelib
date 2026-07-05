use windows::core::PCSTR;
use windows::Win32::System::Memory::{
    MapViewOfFile, OpenFileMappingA, UnmapViewOfFile, FILE_MAP_READ,
};
use windows::Win32::Foundation::{CloseHandle, HANDLE, BOOL};
use std::ffi::CString;
use std::sync::Mutex;

#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct MAHMSharedMemoryHeader {
    pub signature: u32,
    pub version: u32,
    pub header_size: u32,
    pub entry_count: u32,
    pub entry_size: u32,
    pub time: i32,
    pub gpu_count: u32,
    pub gpu_entry_size: u32,
}

#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct MAHMSharedMemoryGpu {
    pub id: [u8; 260],
    pub device: [u8; 260],
    pub driver: [u8; 260],
    pub bios: [u8; 260],
    pub mem_amount: [u8; 260]
}

// The entry struct is large (5 × 260-byte strings + data fields).
// We read fields manually to avoid alignment issues with different MAHM versions.
// Reference (Playnite plugin MsiAfterburnerProvider.cs):
//   offset 0: szSrcName[260]
//   offset 260: szSrcUnits[260]
//   offset 520: szLocSrcName[260]  (modern layout)
//   offset 780: szLocSrcUnits[260]
//   offset 1040: szRecommendedFormat[260]
//   offset 1300: data (float, 4 bytes)
//   offset 1304: minLimit (float, 4 bytes)
//   offset 1308: maxLimit (float, 4 bytes)
//   offset 1312: flags (u32, 4 bytes)
//   offset 1316: dwGpu (u32, 4 bytes) — GPU index for this entry
//   offset 1320: dwSrcId (u32, 4 bytes) — source ID

const ENTRY_NAME_OFFSET: usize = 0;
const ENTRY_NAME_SIZE: usize = 260;
const ENTRY_UNITS_OFFSET: usize = 260;
const ENTRY_UNITS_SIZE: usize = 260;
// Modern layout: data value at 5 × 260 = 1300
const MODERN_DATA_OFFSET: usize = 1300;
// Legacy layout: data value at 544 (pre-v2.0 entries with 268-byte strings)
const LEGACY_DATA_OFFSET: usize = 544;
const LEGACY_ENTRY_SIZE_THRESHOLD: u32 = 640;

#[derive(Debug, Clone)]
pub struct MahmMetrics {
    pub cpu_usage: Option<f32>,
    pub cpu_temp: Option<f32>,
    pub gpu_usage: Option<f32>,
    pub gpu_temp: Option<f32>,
    pub ram_usage: Option<f32>,
    pub ram_units: String,   // e.g. "%", "MB", "GB"
    pub fps: Option<f32>,
}

static CACHED_MAHM_HANDLE: Mutex<Option<isize>> = Mutex::new(None);

unsafe fn try_open_mahm() -> Option<isize> {
    if let Ok(cache) = CACHED_MAHM_HANDLE.lock() {
        if let Some(handle) = *cache {
            return Some(handle);
        }
    }

    let name = CString::new("MAHMSharedMemory").ok()?;

    let h = OpenFileMappingA(
        FILE_MAP_READ.0,
        BOOL::from(false),
        PCSTR(name.as_ptr() as *const u8),
    );

    match h {
        Ok(handle) => {
            let raw = handle.0 as isize;
            let _ = handle;
            if let Ok(mut cache) = CACHED_MAHM_HANDLE.lock() {
                *cache = Some(raw);
            }
            Some(raw)
        }
        Err(_) => None,
    }
}

/// Extract a null-terminated ASCII string from raw memory at `ptr` with max `len` bytes.
unsafe fn read_str_at(ptr: *const u8, len: usize) -> String {
    let slice = std::slice::from_raw_parts(ptr, len);
    let end = slice.iter().position(|&b| b == 0).unwrap_or(len);
    String::from_utf8_lossy(&slice[..end]).trim().to_string()
}

/// Get the offset of the float `data` field within an entry,
/// based on the entry size reported by the header.
fn get_data_offset(entry_size: u32) -> usize {
    if entry_size < LEGACY_ENTRY_SIZE_THRESHOLD {
        LEGACY_DATA_OFFSET
    } else {
        MODERN_DATA_OFFSET
    }
}

/// Dump all MAHM entries for diagnostic purposes.
pub fn dump_mahm_entries() -> Option<Vec<(String, String, f32)>> {
    unsafe {
        let handle_raw = try_open_mahm()?;
        let map_handle = HANDLE(handle_raw as *mut std::ffi::c_void);
        let view = MapViewOfFile(map_handle, FILE_MAP_READ, 0, 0, 0);
        let base = view.Value;
        if base.is_null() {
            let _ = UnmapViewOfFile(view);
            return None;
        }

        let header = *(base as *const MAHMSharedMemoryHeader);
        if header.signature != 0x4D41484D {
            let _ = UnmapViewOfFile(view);
            return None;
        }

        let data_offset = get_data_offset(header.entry_size);
        let mut entries = Vec::new();
        let entries_base = (base as *const u8).add(header.header_size as usize);

        for i in 0..header.entry_count {
            let entry = entries_base.add((i * header.entry_size) as usize);
            let name = read_str_at(entry.add(ENTRY_NAME_OFFSET), ENTRY_NAME_SIZE);
            let units = read_str_at(entry.add(ENTRY_UNITS_OFFSET), ENTRY_UNITS_SIZE);
            let data = *(entry.add(data_offset) as *const f32);
            if !name.is_empty() {
                entries.push((name, units, data));
            }
        }

        let _ = UnmapViewOfFile(view);
        Some(entries)
    }
}

/// Determine whether an MAHM shared-memory entry represents the system RAM
/// sensor (as opposed to GPU memory, pagefile, swap, or commit charge).
///
/// Afterburner's shared memory exposes several memory-related entries
/// — both from its native sensors and from HWiNFO / third-party plugins
/// that Afterburner imports. The Playnite GameActivity reference
/// (Lacro59/playnite-gameactivity-plugin) uses a similar broad match to
/// pull the right entry across locales and imports.
///
// Excluded phrases: substring match (case-insensitive). An entry that
// contains any of these is *not* considered system RAM.
//
// NOTE: "shared memory" is intentionally broad. In MAHM context this almost
// always refers to GPU AWE (Address Windowing Extensions) shared memory,
// not OS-level shared memory. This matches the Playnite plugin's policy;
// if a future MAHM revision exposes genuine system shared memory under this
// exact name, narrow the exclusion to a more specific phrase (e.g.
// "shared gpu memory") rather than relaxing it globally.
const NON_SYSTEM_RAM_HINTS: &[&str] = &[
    "vram",
    "video memory",
    "gpu memory",
    "dedicated memory",
    "shared memory",
    "virtual memory",
    "pagefile",
    "page file",
    "swap usage",
    "swap used",
    "committed memory",
    "commit charge",
];

/// Exact-name matches (case-insensitive) for system RAM entries.
const SYSTEM_RAM_NAMES: &[&str] = &[
    "ram usage",
    "memory usage",
    "memory used",
    "used memory",
    "used ram",
    "physical memory used",
    "physical memory",
    "physical ram",
    "system memory",
    "system memory used",
    "system ram",
    "ram",
    "memory",
    "ram load",
    "memory load",
];

/// True iff `name` (an MAHM sensor display name) corresponds to system RAM.
fn matches_system_ram(name: &str) -> bool {
    let name_lower = name.to_lowercase();
    if name_lower.is_empty() {
        return false;
    }
    if NON_SYSTEM_RAM_HINTS.iter().any(|hint| name_lower.contains(hint)) {
        return false;
    }
    SYSTEM_RAM_NAMES.contains(&name_lower.as_str())
}

/// Parse MSI Afterburner Shared Memory metrics.
///
/// Uses **exact sensor name matching** following the reference Playnite GameActivity plugin:
/// - `"CPU usage"` / `"CPU temperature"` for CPU
/// - `"GPU usage"` / `"GPU temperature"` for GPU  
/// - `"RAM usage"` for RAM
/// - `"Framerate"` for FPS
///
/// These are the standard English names that MSI Afterburner uses in its shared memory.
/// The matching is case-insensitive.
pub fn read_mahm_metrics(gpu_idx: u32, gpu_name: Option<&str>) -> Option<MahmMetrics> {
    unsafe {
        let handle_raw = try_open_mahm()?;
        let map_handle = HANDLE(handle_raw as *mut std::ffi::c_void);

        let view = MapViewOfFile(map_handle, FILE_MAP_READ, 0, 0, 0);

        let base = view.Value;
        if base.is_null() {
            let _ = UnmapViewOfFile(view);
            return None;
        }

        let header = *(base as *const MAHMSharedMemoryHeader);

        // Check signature: MAHM = 0x4D41484D
        if header.signature != 0x4D41484D {
            let _ = UnmapViewOfFile(view);
            return None;
        }

        // Sanity checks
        if header.entry_count > 1000 || header.entry_size < 32 {
            let _ = UnmapViewOfFile(view);
            return None;
        }

        let data_offset = get_data_offset(header.entry_size);

        // Resolve which GPU index to use in Afterburner by looking up GPU list in shared memory.
        let mut resolved_gpu_idx = gpu_idx;
        if let Some(name_filter) = gpu_name {
            let gpus_offset = header.header_size + header.entry_count * header.entry_size;
            let gpu_base = base.add(gpus_offset as usize);
            
            for i in 0..header.gpu_count {
                if gpus_offset + (i + 1) * header.gpu_entry_size > 0x40000 {
                    break;
                }
                let gpu_ptr = gpu_base.add((i * header.gpu_entry_size) as usize) as *const MAHMSharedMemoryGpu;
                let gpu_device_bytes = (*gpu_ptr).device;
                if let Ok(device_str) = std::str::from_utf8(&gpu_device_bytes) {
                    let cleaned_device = device_str.split('\0').next().unwrap_or("").trim().to_lowercase();
                    let filter_lower = name_filter.to_lowercase();
                    if !cleaned_device.is_empty() && (cleaned_device.contains(&filter_lower) || filter_lower.contains(&cleaned_device)) {
                        resolved_gpu_idx = i;
                        break;
                    }
                }
            }
        }

        let target_gpu_num = resolved_gpu_idx + 1;
        let expected_gpu_usage_1 = format!("gpu{} usage", target_gpu_num);
        let expected_gpu_usage_2 = format!("gpu{} load", target_gpu_num);
        let expected_gpu_temp_1 = format!("gpu{} temperature", target_gpu_num);
        let expected_gpu_temp_2 = format!("gpu{} temp", target_gpu_num);

        let mut cpu_usage: Option<f32> = None;
        let mut cpu_temp: Option<f32> = None;
        let mut gpu_usage: Option<f32> = None;
        let mut gpu_temp: Option<f32> = None;
        let mut ram_usage: Option<f32> = None;
        let mut ram_units = String::new();
        let mut fps: Option<f32> = None;

        let entries_base = (base as *const u8).add(header.header_size as usize);

        for i in 0..header.entry_count {
            let entry = entries_base.add((i * header.entry_size) as usize);
            let name = read_str_at(entry.add(ENTRY_NAME_OFFSET), ENTRY_NAME_SIZE);
            if name.is_empty() {
                continue;
            }
            
            let data = *(entry.add(data_offset) as *const f32);
            let name_lower = name.to_lowercase();

            let expected_gpu_usage_1_space = format!("gpu {} usage", target_gpu_num);
            let expected_gpu_usage_2_space = format!("gpu {} load", target_gpu_num);
            let expected_gpu_temp_1_space = format!("gpu {} temperature", target_gpu_num);
            let expected_gpu_temp_2_space = format!("gpu {} temp", target_gpu_num);

            let is_match_gpu_usage = name_lower == expected_gpu_usage_1
                || name_lower == expected_gpu_usage_1_space
                || name_lower == expected_gpu_usage_2
                || name_lower == expected_gpu_usage_2_space
                || (resolved_gpu_idx == 0 && (name_lower == "gpu usage" || name_lower == "gpu load" || name_lower == "gpu"));

            let is_match_gpu_temp = name_lower == expected_gpu_temp_1
                || name_lower == expected_gpu_temp_1_space
                || name_lower == expected_gpu_temp_2
                || name_lower == expected_gpu_temp_2_space
                || (resolved_gpu_idx == 0 && (name_lower == "gpu temperature" || name_lower == "gpu temp"));

            let is_ram = matches_system_ram(&name);

            // Match using exact standard sensor names from MSI Afterburner,
            // same as the Playnite GameActivity reference plugin.
            if name_lower == "cpu usage" || name_lower == "cpu load" {
                cpu_usage = Some(data);
            } else if name_lower == "cpu temperature" || name_lower == "cpu temp" || name_lower == "cpu1 temperature" {
                cpu_temp = Some(data);
            } else if is_match_gpu_usage {
                if gpu_usage.is_none() {
                    gpu_usage = Some(data);
                }
            } else if is_match_gpu_temp {
                if gpu_temp.is_none() {
                    gpu_temp = Some(data);
                }
            } else if is_ram {
                // First matching entry wins: native Afterburner entries
                // tend to be iterated before HWiNFO imports, so they take
                // precedence over the noisier imported reading. Both produce
                // valid percentages — reordering in future MAHM versions
                // won't degrade correctness, only which source we pick.
                if ram_usage.is_none() {
                    ram_usage = Some(data);
                    let units = read_str_at(entry.add(ENTRY_UNITS_OFFSET), ENTRY_UNITS_SIZE);
                    ram_units = units;
                }
            } else if name_lower == "framerate" || name_lower == "fps" {
                fps = Some(data);
            }
        }

        let _ = UnmapViewOfFile(view);

        Some(MahmMetrics {
            cpu_usage,
            cpu_temp,
            gpu_usage,
            gpu_temp,
            ram_usage,
            ram_units,
            fps,
        })
    }
}

/// Release cached handle
#[allow(dead_code)]
pub fn release_mahm() {
    if let Ok(mut cache) = CACHED_MAHM_HANDLE.lock() {
        if let Some(handle) = cache.take() {
            unsafe {
                let _ = CloseHandle(HANDLE(handle as *mut std::ffi::c_void));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ram_matcher_matches_afterburner_native_names() {
        assert!(matches_system_ram("RAM usage"));
        assert!(matches_system_ram("Memory usage"));
        assert!(matches_system_ram("Memory"));
        assert!(matches_system_ram("Ram load"));
    }

    #[test]
    fn ram_matcher_matches_hwinfo_imports() {
        // HWiNFO-imported sensors that afterburner surfaces with localized
        // names — these were the root cause of "RAM still not detected".
        assert!(matches_system_ram("Physical Memory Used"));
        assert!(matches_system_ram("Used memory"));
        assert!(matches_system_ram("Memory used"));
        assert!(matches_system_ram("System memory"));
        assert!(matches_system_ram("System memory used"));
        assert!(matches_system_ram("System ram"));
        assert!(matches_system_ram("Physical memory"));
        assert!(matches_system_ram("Physical ram"));
    }

    #[test]
    fn ram_matcher_excludes_vram_and_gpu_memory() {
        assert!(!matches_system_ram("GPU memory usage"));
        assert!(!matches_system_ram("Dedicated memory used"));
        assert!(!matches_system_ram("VRAM usage"));
        assert!(!matches_system_ram("Video memory"));
        assert!(!matches_system_ram("Shared memory"));
    }

    #[test]
    fn ram_matcher_excludes_pagefile_swap_and_commit() {
        assert!(!matches_system_ram("Pagefile usage"));
        assert!(!matches_system_ram("Page file usage"));
        assert!(!matches_system_ram("Virtual memory used"));
        assert!(!matches_system_ram("Commit charge"));
        assert!(!matches_system_ram("Committed memory"));
        assert!(!matches_system_ram("Swap usage"));
    }

    #[test]
    fn ram_matcher_is_case_insensitive() {
        assert!(matches_system_ram("ram USAGE"));
        assert!(matches_system_ram("MEMORY usage"));
        assert!(matches_system_ram("PhYsIcAl mEmOrY UsEd"));
    }

    #[test]
    fn ram_matcher_empty_or_unrelated_names_return_false() {
        assert!(!matches_system_ram(""));
        assert!(!matches_system_ram("CPU usage"));
        assert!(!matches_system_ram("Framerate"));
        assert!(!matches_system_ram("GPU temperature"));
    }

    #[test]
    fn ram_matcher_substring_exclusion_takes_precedence() {
        // Locks in the exclusion-first contract so a future refactor that
        // flips the order (checks SYSTEM_RAM_NAMES before NON_SYSTEM_RAM_HINTS)
        // is caught by CI rather than silently re-accepting VRAM / pagefile.
        assert!(!matches_system_ram("System dedicated memory used"));
        assert!(!matches_system_ram("Physical GPU memory"));
        assert!(!matches_system_ram("Virtual memory usage"));
        assert!(!matches_system_ram("RAM pagefile usage"));
        assert!(!matches_system_ram("Committed memory"));
    }
}
