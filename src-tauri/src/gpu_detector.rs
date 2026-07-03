use serde::Serialize;
use wmi::{COMLibrary, WMIConnection};

/// Serializable GPU info matching the frontend GpuInfo type.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    pub id: String,
    pub name: String,
    pub vendor: String,
    pub vram_mb: u64,
}

/// WMI video controller struct for deserialization.
/// WMI returns PascalCase properties — serde maps them to snake_case.
#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "PascalCase")]
struct WmiVideoController {
    name: String,
    adapter_compatibility: Option<String>,
    adapter_ram: Option<u64>,
}

/// Detect GPUs on the system using WMI (Windows Management Instrumentation).
/// Spawns a dedicated thread to avoid COM apartment threading conflicts (0x80010106).
/// Falls back to an empty list if WMI is unavailable (e.g., non-Windows platforms).
pub fn detect_gpus() -> Vec<GpuInfo> {
    std::thread::spawn(|| {
        let mut gpus = Vec::new();

        let com_lib = match COMLibrary::new() {
            Ok(lib) => lib,
            Err(e) => {
                eprintln!("COM initialization failed: {}", e);
                return gpus;
            }
        };

        match WMIConnection::new(com_lib) {
            Ok(wmi_con) => {
                let query = "SELECT Name, AdapterCompatibility, AdapterRAM FROM Win32_VideoController";
                match wmi_con.raw_query::<WmiVideoController>(query) {
                    Ok(results) => {
                        for (idx, gpu) in results.into_iter().enumerate() {
                            let name = gpu.name.trim().to_string();
                            if name.is_empty() {
                                continue;
                            }

                            let vendor = gpu
                                .adapter_compatibility
                                .unwrap_or_default()
                                .trim()
                                .to_string();
                            let vendor_display = if vendor.is_empty() {
                                detect_vendor_from_name(&name)
                            } else {
                                vendor
                            };

                            let vram_bytes = gpu.adapter_ram.unwrap_or(0);
                            // WMI AdapterRAM is uint32 — values near 4 GB (4,294,967,295 bytes)
                            // indicate truncation. Use name-based estimation for GPUs with >4 GB.
                            let vram_mb = if vram_bytes > 0 && vram_bytes < 4_200_000_000 {
                                // Value fits in uint32 and is not truncated — use it directly
                                vram_bytes / 1_048_576
                            } else {
                                // Either 0 (not reported) or truncated — estimate from name
                                estimate_vram_from_name(&name)
                            };

                            gpus.push(GpuInfo {
                                id: format!("gpu-{}", idx),
                                name,
                                vendor: vendor_display,
                                vram_mb,
                            });
                        }
                    }
                    Err(e) => {
                        eprintln!("WMI GPU query failed: {}", e);
                    }
                }
            }
            Err(e) => {
                eprintln!("WMI connection failed: {}", e);
            }
        }

        gpus
    })
    .join()
    .unwrap_or_default()
}

/// Try to infer the vendor from the GPU name when WMI doesn't report it.
fn detect_vendor_from_name(name: &str) -> String {
    let lower = name.to_lowercase();
    if lower.contains("nvidia") || lower.contains("geforce") || lower.contains("rtx") || lower.contains("gtx") || lower.contains("quadro") {
        "NVIDIA".to_string()
    } else if lower.contains("amd") || lower.contains("radeon") || lower.contains("rx") {
        "AMD".to_string()
    } else if lower.contains("intel") || lower.contains("arc") || lower.contains("uhd") || lower.contains("iris") {
        "Intel".to_string()
    } else {
        "Unknown".to_string()
    }
}

/// Estimate VRAM from the GPU name when WMI reports 0 or is truncated (uint32 overflow).
fn estimate_vram_from_name(name: &str) -> u64 {
    let lower = name.to_lowercase();

    // Intel integrated GPUs typically have shared memory — report 0
    if lower.contains("intel") && (lower.contains("uhd") || lower.contains("iris") || lower.contains("hd graphics")) {
        return 0;
    }

    // ─── NVIDIA RTX 50-series (Blackwell) ───
    if lower.contains("5090") { return 32768; }   // 32 GB
    if lower.contains("5080") { return 16384; }   // 16 GB
    if lower.contains("5070 ti") || lower.contains("5070ti") { return 16384; } // 16 GB
    if lower.contains("5070") { return 12288; }   // 12 GB
    if lower.contains("5060 ti") || lower.contains("5060ti") { return 16384; } // 16 GB
    if lower.contains("5060") { return 8192; }    // 8 GB

    // ─── NVIDIA RTX 40-series (Ada Lovelace) ───
    if lower.contains("4090") { return 24576; }
    if lower.contains("4080 super") { return 16384; }
    if lower.contains("4080") { return 16384; }
    if lower.contains("4070 ti super") { return 16384; }
    if lower.contains("4070 ti") || lower.contains("4070ti") { return 12288; }
    if lower.contains("4070 super") { return 12288; }
    if lower.contains("4070") { return 12288; }
    if lower.contains("4060 ti") || lower.contains("4060ti") { return 8192; }
    if lower.contains("4060") { return 8192; }

    // ─── NVIDIA RTX 30-series ───
    if lower.contains("3090 ti") || lower.contains("3090ti") { return 24576; }
    if lower.contains("3090") { return 24576; }
    if lower.contains("3080 ti") || lower.contains("3080ti") { return 12288; }
    if lower.contains("3080") { return 10240; }
    if lower.contains("3070 ti") || lower.contains("3070ti") { return 8192; }
    if lower.contains("3070") { return 8192; }
    if lower.contains("3060 ti") || lower.contains("3060ti") { return 8192; }
    if lower.contains("3060") { return 12288; }
    if lower.contains("3050") { return 8192; }

    // ─── AMD RX 9000-series (RDNA 4) ───
    if lower.contains("9070 xt") { return 16384; }  // 16 GB
    if lower.contains("9070") { return 16384; }     // 16 GB
    if lower.contains("9060 xt") { return 16384; }  // 16 GB
    if lower.contains("9060") { return 8192; }      // 8 GB

    // ─── AMD RX 7000-series (RDNA 3) ───
    if lower.contains("7900 xtx") { return 24576; }
    if lower.contains("7900 xt") { return 20480; }
    if lower.contains("7900 gre") { return 16384; }
    if lower.contains("7900") { return 16384; }
    if lower.contains("7800 xt") { return 16384; }
    if lower.contains("7700 xt") { return 12288; }
    if lower.contains("7600 xt") { return 16384; }
    if lower.contains("7600") { return 8192; }

    // ─── AMD RX 6000-series (RDNA 2) ───
    if lower.contains("6950 xt") { return 16384; }
    if lower.contains("6900 xt") { return 16384; }
    if lower.contains("6800 xt") { return 16384; }
    if lower.contains("6800") { return 16384; }
    if lower.contains("6750 xt") { return 12288; }
    if lower.contains("6700 xt") { return 12288; }
    if lower.contains("6600 xt") { return 8192; }
    if lower.contains("6600") { return 8192; }

    // ─── Intel Arc ───
    if lower.contains("arc b580") { return 12288; }  // Battlemage
    if lower.contains("arc b570") { return 10240; }  // Battlemage
    if lower.contains("arc a770") { return 16384; }
    if lower.contains("arc a750") { return 8192; }
    if lower.contains("arc a580") { return 8192; }
    if lower.contains("arc a380") { return 6144; }

    // ─── Generic NVIDIA pattern matching (catch older cards) ───
    if lower.contains("nvidia") || lower.contains("geforce") {
        // Older naming: GTX 1080 Ti, etc. — default to 8 GB
        return 8192;
    }

    // Default fallback for unknown modern GPUs
    8192
}
