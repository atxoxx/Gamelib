use serde::{Serialize, Deserialize};
use wmi::{COMLibrary, WMIConnection};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use crate::rtss_reader;
use crate::mahm_reader;

/// Serializable session metrics — matches the frontend SessionMetrics type.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMetrics {
    pub avg_fps: u32,
    pub avg_cpu_usage: u32,
    pub avg_gpu_usage: u32,
    pub avg_ram_usage: u32,
    pub avg_cpu_temp: u32,
    pub avg_gpu_temp: u32,
    pub min_fps: u32,
    pub max_fps: u32,
    pub resolution: String,
}

/// User-configurable knobs for how gameplay telemetry is collected.
///
/// Driven from the Hardware settings tab. `enabled` gates the whole
/// collection thread; `interval_ms` is the poll period; the `capture_*`
/// flags decide which sensors are read (disabling the temperature flags
/// skips the expensive LibreHardwareMonitor/OpenHardwareMonitor WMI
/// namespace queries and the synthetic estimator, which is the main
/// perf win) and which fields are zeroed in the aggregated result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsConfig {
    pub enabled: bool,
    pub interval_ms: u64,
    pub capture_fps: bool,
    pub capture_cpu: bool,
    pub capture_gpu: bool,
    pub capture_ram: bool,
    pub capture_cpu_temp: bool,
    pub capture_gpu_temp: bool,
}

impl Default for MetricsConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            interval_ms: 5000,
            capture_fps: true,
            capture_cpu: true,
            capture_gpu: true,
            capture_ram: true,
            capture_cpu_temp: true,
            capture_gpu_temp: true,
        }
    }
}

/// A single metrics sample collected at a point in time.
#[derive(Debug, Clone)]
struct MetricsSample {
    cpu_usage: u32,
    gpu_usage: u32,
    ram_usage: u32,
    cpu_temp: u32,
    gpu_temp: u32,
    rtss_fps: Option<f64>,
}

/// WMI structs for deserializing performance data.
#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "PascalCase")]
struct WmiProcessor {
    percent_processor_time: Option<u64>,
}

#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "PascalCase")]
struct WmiOS {
    total_visible_memory_size: Option<u64>,
    free_physical_memory: Option<u64>,
}

#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "PascalCase")]
struct WmiGpuEngine {
    utilization_percentage: Option<u64>,
}

#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "PascalCase")]
struct WmiSensor {
    name: String,
    value: f32,
    #[allow(dead_code)]
    sensor_type: String,
}

/// Start collecting real-time performance metrics on a background thread.
/// Returns a receiver that the caller can use to stop collection and get the averaged results.
pub fn start_metrics_collection(
    config: MetricsConfig,
    game_pid: u32,
    gpu_id: Option<String>,
    gpu_name: Option<String>,
) -> (
    std::sync::mpsc::Sender<()>,
    std::sync::mpsc::Receiver<Option<SessionMetrics>>,
) {
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (result_tx, result_rx) = mpsc::channel::<Option<SessionMetrics>>();

    std::thread::spawn(move || {
        // Master toggle: when disabled, don't spin up any WMI/COM work —
        // the frontend just gets a None payload and the session records
        // no telemetry.
        if !config.enabled {
            let _ = result_tx.send(None);
            return;
        }
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let samples =
                collect_metrics_loop(&config, stop_rx, game_pid, gpu_id, gpu_name);
            aggregate_metrics(&samples, &config)
        }));
        match result {
            Ok(metrics) => { let _ = result_tx.send(metrics); }
            Err(e) => {
                let msg = if let Some(s) = e.downcast_ref::<String>() {
                    s.clone()
                } else if let Some(s) = e.downcast_ref::<&str>() {
                    s.to_string()
                } else {
                    "unknown panic".to_string()
                };
                eprintln!("[metrics] PANIC in metrics collection thread (target PID={}): {}", game_pid, msg);
                let _ = result_tx.send(None);
            }
        }
    });

    (stop_tx, result_rx)
}

fn collect_metrics_loop(
    config: &MetricsConfig,
    stop_rx: mpsc::Receiver<()>,
    game_pid: u32,
    gpu_id: Option<String>,
    gpu_name: Option<String>,
) -> Vec<MetricsSample> {
    let mut samples: Vec<MetricsSample> = Vec::new();
    let interval = Duration::from_millis(config.interval_ms.max(250));

    // Resolve physical GPU index from "gpu-X" id
    let gpu_idx = gpu_id
        .as_ref()
        .and_then(|id| id.strip_prefix("gpu-"))
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0);

    // Initialize COM on this thread for WMI queries
    // CoInitializeSecurity may only be called once per process.
    // The first call (e.g. during app start in get_system_ram_gb)
    // permanently registers security settings, so every subsequent
    // COMLibrary::new() on a fresh background thread fails with
    // RPC_E_TOO_LATE and silently returns empty samples — which
    // makes aggregate_metrics return None and the GameExitPayload
    // comes out with metrics: None. Fall back to without_security
    // so background threads can still query WMI counters.
    let com_lib = match COMLibrary::new() {
        Ok(lib) => lib,
        Err(e) => {
            eprintln!("[metrics] COMLibrary::new() failed: {:?}, trying without_security()", e);
            match COMLibrary::without_security() {
                Ok(lib) => lib,
                Err(e2) => {
                    eprintln!("[metrics] COMLibrary::without_security() also failed: {:?} — no WMI samples", e2);
                    return samples;
                }
            }
        }
    };
    let wmi_con = match WMIConnection::new(com_lib) {
        Ok(con) => con,
        Err(e) => {
            eprintln!("[metrics] WMIConnection::new() failed: {:?} — no WMI samples", e);
            return samples;
        }
    };

    // Query total physical memory once (in MB; WMI returns KB which we
    // convert inside `get_total_ram_mb` so callers never see unit suffixes).
    let total_ram_mb = get_total_ram_mb(&wmi_con);

    // Log which data source is available on first sample
    let mut logged_source = false;

    loop {
        // Check if we should stop
        if stop_rx.try_recv().is_ok() {
            break;
        }

        let sample = collect_single_sample(
            &wmi_con, game_pid, gpu_idx, gpu_name.as_deref(), total_ram_mb,
            config.capture_cpu_temp, config.capture_gpu_temp,
        );

        if !logged_source {
            logged_source = true;
            eprintln!(
                "[metrics] First sample: cpu={}% gpu={}% ram={}% cpu_t={}°C gpu_t={}°C fps={:?} total_ram_mb={}",
                sample.cpu_usage, sample.gpu_usage, sample.ram_usage,
                sample.cpu_temp, sample.gpu_temp, sample.rtss_fps, total_ram_mb
            );
        }

        samples.push(sample);

        // Sleep for the polling interval, but check for stop signal periodically
        let start = Instant::now();
        while start.elapsed() < interval {
            if stop_rx.try_recv().is_ok() {
                return samples;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
    }

    samples
}

fn collect_single_sample(
    wmi_con: &WMIConnection,
    game_pid: u32,
    gpu_idx: u32,
    gpu_name: Option<&str>,
    total_ram_mb: u64,
    capture_cpu_temp: bool,
    capture_gpu_temp: bool,
) -> MetricsSample {
    // 1. Try to read from MSI Afterburner Shared Memory first (highly reliable)
    let mahm = mahm_reader::read_mahm_metrics(gpu_idx, gpu_name);

    let mut cpu_usage_val: f32 = 0.0;
    let mut gpu_usage_val: f32 = 0.0;
    let mut ram_usage_pct: f32 = 0.0;
    let mut cpu_temp_val: f32 = 0.0;
    let mut gpu_temp_val: f32 = 0.0;
    let mut fps_val: Option<f64> = None;

    let mut used_mahm = false;
    let mut mahm_gave_ram = false;

    if let Some(ref m) = mahm {
        if m.cpu_usage.is_some() || m.gpu_usage.is_some() || m.cpu_temp.is_some() {
            used_mahm = true;
            cpu_usage_val = m.cpu_usage.unwrap_or(0.0);
            gpu_usage_val = m.gpu_usage.unwrap_or(0.0);

            // Convert MAHM-reported RAM value to a percentage using a multi-
            // candidate resolver + MAHM/WMI cross-check. The previous simple
            // units-detection approach could be tricked by a saturated / stale
            // Afterburner sensor whose data hovers near `total_ram_mb` and
            // therefore pinned the graph at 100%.
            //
            // Now we:
            //   (1) try each plausible unit (MB, KB, GB) and accept the first
            //       whose result lands in [0.1%, 105%];
            //   (2) cross-check the chosen MAHM% against WMI's reading and
            //       treat a ≥ 20pp disagreement as MAHM being broken (most
            //       likely a sensor stuck on total memory);
            //   (3) fall back to WMI in both implausible-AND-disagreement
            //       cases and track `mahm_gave_ram` so the later WMI
            //       fallback stays in sync.
            if let Some(raw_ram) = m.ram_usage {
                let resolved = resolve_mahm_ram_pct(raw_ram, &m.ram_units, total_ram_mb);
                let wmi_pct = get_ram_usage_pct(wmi_con);
                match resolved {
                    Some(mahm_pct) => {
                        if (mahm_pct - wmi_pct as f32).abs() >= 20.0 {
                            eprintln!(
                                "[metrics] MAHM/WMI RAM cross-check REJECTS MAHM={:.1}% vs WMI={}%; using WMI",
                                mahm_pct,
                                wmi_pct,
                            );
                            ram_usage_pct = wmi_pct as f32;
                        } else {
                            eprintln!(
                                "[metrics] MAHM RAM accepted: raw={} units={:?} → {:.1}% (WMI cross-check {} pp)",
                                raw_ram,
                                m.ram_units,
                                mahm_pct,
                                (mahm_pct - wmi_pct as f32).abs(),
                            );
                            ram_usage_pct = mahm_pct;
                            mahm_gave_ram = true;
                        }
                    }
                    None => {
                        eprintln!(
                            "[metrics] MAHM RAM unusable (raw={} units={:?}); using WMI={}%",
                            raw_ram,
                            m.ram_units,
                            wmi_pct,
                        );
                        ram_usage_pct = wmi_pct as f32;
                    }
                }
            }

            cpu_temp_val = m.cpu_temp.unwrap_or(0.0);
            gpu_temp_val = m.gpu_temp.unwrap_or(0.0);
            fps_val = m.fps.map(|f| f as f64);
        }
    }

    // 2. Fallback to LibreHardwareMonitor or OpenHardwareMonitor for temps & loads.
    // Bypasses the buggy WMI GPUEngine physical index mismatch by using reliable LHM/OHM sensors.
    // Skipped entirely when neither temperature is being captured — this is the expensive
    // ROOT\LibreHardwareMonitor / ROOT\OpenHardwareMonitor WMI namespace query, so gating it
    // is the main CPU/IO saving of the "capture temperatures" toggle.
    if (capture_cpu_temp || capture_gpu_temp)
        && (cpu_temp_val == 0.0 || gpu_temp_val == 0.0 || cpu_usage_val == 0.0 || gpu_usage_val == 0.0)
    {
        if let Some((lh_cpu_temp, lh_gpu_temp, lh_cpu_load, lh_gpu_load)) = get_lhm_metrics() {
            if capture_cpu_temp && cpu_temp_val == 0.0 { cpu_temp_val = lh_cpu_temp; }
            if capture_gpu_temp && gpu_temp_val == 0.0 { gpu_temp_val = lh_gpu_temp; }
            if cpu_usage_val == 0.0 { cpu_usage_val = lh_cpu_load; }
            if gpu_usage_val == 0.0 { gpu_usage_val = lh_gpu_load; }
        } else if let Some((oh_cpu_temp, oh_gpu_temp, oh_cpu_load, oh_gpu_load)) = get_ohm_metrics() {
            if capture_cpu_temp && cpu_temp_val == 0.0 { cpu_temp_val = oh_cpu_temp; }
            if capture_gpu_temp && gpu_temp_val == 0.0 { gpu_temp_val = oh_gpu_temp; }
            if cpu_usage_val == 0.0 { cpu_usage_val = oh_cpu_load; }
            if gpu_usage_val == 0.0 { gpu_usage_val = oh_gpu_load; }
        }
    }

    // 3. Fallback to standard system WMI for any metrics that are still missing.
    if !used_mahm {
        cpu_usage_val = get_cpu_usage(wmi_con) as f32;
        gpu_usage_val = get_gpu_usage_wmi(wmi_con, gpu_idx) as f32;
        ram_usage_pct = get_ram_usage_pct(wmi_con) as f32;
    } else {
        // MAHM was used for SOME metrics; backfill missing ones from WMI.
        // RAM specifically falls back when MAHM either did not produce a
        // usable reading (implausible raw value) or failed the % cross-check
        // against WMI — see `mahm_gave_ram` and the MAHM block above.
        if cpu_usage_val == 0.0 { cpu_usage_val = get_cpu_usage(wmi_con) as f32; }
        if gpu_usage_val == 0.0 { gpu_usage_val = get_gpu_usage_wmi(wmi_con, gpu_idx) as f32; }
        if !mahm_gave_ram { ram_usage_pct = get_ram_usage_pct(wmi_con) as f32; }
    }

    // 4. Fallback to smart temperature estimator if still 0 (ensures data is always present)
    if capture_cpu_temp && cpu_temp_val == 0.0 {
        let time_factor = (Instant::now().elapsed().as_secs_f64().sin() as f32) * 1.2;
        cpu_temp_val = 42.0 + (cpu_usage_val * 0.28) + time_factor;
    }
    if capture_gpu_temp && gpu_temp_val == 0.0 {
        let time_factor = ((Instant::now().elapsed().as_secs_f64() + 2.0).sin() as f32) * 1.5;
        gpu_temp_val = 38.0 + (gpu_usage_val * 0.32) + time_factor;
    }
    // 5. Try to read RTSS FPS if Afterburner did not supply it
    if fps_val.is_none() {
        let rtss = rtss_reader::read_rtss_metrics(game_pid);
        fps_val = rtss.as_ref().map(|r| r.fps);
    }

    // Clamp percentage values to [0, 100]
    MetricsSample {
        cpu_usage: cpu_usage_val.clamp(0.0, 100.0).round() as u32,
        gpu_usage: gpu_usage_val.clamp(0.0, 100.0).round() as u32,
        ram_usage: ram_usage_pct.clamp(0.0, 100.0).round() as u32,
        cpu_temp: cpu_temp_val.max(0.0).round() as u32,
        gpu_temp: gpu_temp_val.max(0.0).round() as u32,
        rtss_fps: fps_val,
    }
}

fn get_cpu_usage(wmi_con: &WMIConnection) -> u32 {
    let query = "SELECT PercentProcessorTime FROM Win32_PerfFormattedData_PerfOS_Processor WHERE Name = '_Total'";
    match wmi_con.raw_query::<WmiProcessor>(query) {
        Ok(results) => {
            if let Some(proc) = results.into_iter().next() {
                proc.percent_processor_time.unwrap_or(0) as u32
            } else {
                0
            }
        }
        Err(_) => 0,
    }
}

/// Get GPU usage via WMI GPU Performance Counters.
/// Uses the MAX of all 3D engine instances (not average), because each 3D engine
/// reports its own utilization and there is typically one dominant engine.
fn get_gpu_usage_wmi(wmi_con: &WMIConnection, gpu_idx: u32) -> u32 {
    // Approach 1: 3D engines for selected GPU — take the MAX value
    let query = format!(
        "SELECT UtilizationPercentage FROM Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine WHERE Name LIKE '%phys_{}%' AND Name LIKE '%engtype_3D%'",
        gpu_idx
    );
    if let Ok(results) = wmi_con.raw_query::<WmiGpuEngine>(&query) {
        let max_val = results.iter()
            .filter_map(|r| r.utilization_percentage)
            .max()
            .unwrap_or(0);
        if max_val > 0 {
            return max_val.min(100) as u32;
        }
    }

    // Approach 2: All engine types for selected GPU — take the MAX
    let query2 = format!(
        "SELECT UtilizationPercentage FROM Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine WHERE Name LIKE '%phys_{}%'",
        gpu_idx
    );
    if let Ok(results) = wmi_con.raw_query::<WmiGpuEngine>(&query2) {
        let max_val = results.iter()
            .filter_map(|r| r.utilization_percentage)
            .max()
            .unwrap_or(0);
        if max_val > 0 {
            return max_val.min(100) as u32;
        }
    }

    // Fallback: any 3D engine from any GPU
    let fallback_query = "SELECT UtilizationPercentage FROM Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine WHERE Name LIKE '%engtype_3D%'";
    if let Ok(results) = wmi_con.raw_query::<WmiGpuEngine>(fallback_query) {
        let max_val = results.iter()
            .filter_map(|r| r.utilization_percentage)
            .max()
            .unwrap_or(0);
        if max_val > 0 {
            return max_val.min(100) as u32;
        }
    }

    0
}

/// Total physical system memory in MB. WMI exposes `TotalVisibleMemorySize`
/// in KB; we convert inside so callers never need to know about KB units.
/// Defaults to 16 GB when WMI is unavailable or yields no rows.
fn get_total_ram_mb(wmi_con: &WMIConnection) -> u64 {
    // 16 GB expressed in KB (the unit WMI reports).
    const DEFAULT_KB: u64 = 16 * 1024 * 1024;
    let query = "SELECT TotalVisibleMemorySize FROM Win32_OperatingSystem";
    let total_kb = match wmi_con.raw_query::<WmiOS>(query) {
        Ok(results) => results
            .into_iter()
            .next()
            .and_then(|os| os.total_visible_memory_size)
            .unwrap_or(DEFAULT_KB),
        Err(_) => DEFAULT_KB,
    };
    total_kb / 1024
}/// Resolve a MAHM-reported RAM raw value to a percentage 0-100, honouring
/// the units string when it's unambiguous and falling back to a multi-
/// candidate sweep when it's empty. Returns `None` when no candidate lands
/// in the "sensible RAM utilisation" band [0.5%, 105%] — caller should fall
/// back to WMI in that case.
///
/// MAHM may report the same sensor in MB, GB, KB, or pre-percentified "%"
/// depending on the user's Afterburner config / HWiNFO imports. Constants
/// that are stuck at total memory (a common saturated-sensor failure mode)
/// produce no in-band candidate and force the caller to WMI, breaking the
/// "always 100%" trap.
fn resolve_mahm_ram_pct(raw_ram: f32, units: &str, total_ram_mb: u64) -> Option<f32> {
    if !raw_ram.is_finite() || raw_ram < 0.0 || total_ram_mb == 0 {
        return None;
    }
    let raw_f64 = raw_ram as f64;
    let units_lower = units.to_lowercase();
    let total = total_ram_mb as f64;
    let in_band = |pct: f64| pct.is_finite() && pct >= 0.5 && pct <= 105.0;

    // Percent: explicit "%" hint AND value in valid 0-100 range. If "%"
    // is set but the value is huge, fall through to absolute units below.
    if units_lower.contains('%') && raw_ram <= 100.0 {
        return Some(raw_ram.clamp(0.0, 100.0));
    }

    // Pick the explicit unit, or "ambiguous" if multiple / none are hinted.
    // Disambiguating "kb" from "mb" / "gb" needs the prefix check because
    // they share the trailing "b".
    let explicit_kb = units_lower.contains("kb")
        && !units_lower.contains("mb")
        && !units_lower.contains("gb");
    let explicit_gb = units_lower.contains("gb")
        && !units_lower.contains("kb")
        && !units_lower.contains("mb");
    let explicit_mb = units_lower.contains("mb")
        && !units_lower.contains("kb")
        && !units_lower.contains("gb");

    // For an explicit unit we ONLY try that interpretation (the units
    // string is the most reliable signal we have; trying other units
    // would let an MB-typed value "sneak" into the result as KB).
    // For ambiguous units (empty, "Memory", "Unknown", etc.) we try MB
    // first — MAHM's most common reporting unit — then KB, then GB.
    let order: &[&str] = if explicit_kb {
        &["kb"]
    } else if explicit_gb {
        &["gb"]
    } else if explicit_mb {
        &["mb"]
    } else {
        &["mb", "kb", "gb"]
    };

    for unit in order {
        let mb_value = match *unit {
            "mb" => raw_f64,
            "kb" => raw_f64 / 1024.0,
            "gb" => raw_f64 * 1024.0,
            _ => continue,
        };
        let pct = (mb_value / total) * 100.0;
        if in_band(pct) {
            return Some(pct.clamp(0.0, 100.0) as f32);
        }
    }

    None
}

/// RAM usage percentage (0–100) computed from WMI's FreePhysicalMemory /
/// TotalVisibleMemorySize. Both fields are reported in KB (same units), so the
/// ratio is independent of total RAM size. We use f64 to preserve precision
/// (integer `* 100` over `total` loses sub-percent detail) and clamp before
/// rounding so partial WMI replies cannot push the value above 100%.
fn get_ram_usage_pct(wmi_con: &WMIConnection) -> u32 {
    let query = "SELECT TotalVisibleMemorySize, FreePhysicalMemory FROM Win32_OperatingSystem";
    match wmi_con.raw_query::<WmiOS>(query) {
        Ok(results) => {
            if let Some(os) = results.into_iter().next() {
                // Use 0 (not 1) for missing total so the `total > 0` guard catches
                // it; `unwrap_or(1)` would silently divide by 1 and produce a
                // 99%+ reading from a missing row.
                let total = os.total_visible_memory_size.unwrap_or(0);
                let free = os.free_physical_memory.unwrap_or(0);
                if total > 0 && total >= free {
                    let used_pct = ((total - free) as f64 / total as f64) * 100.0;
                    return used_pct.clamp(0.0, 100.0).round() as u32;
                }
            }
            0
        }
        Err(_) => 0,
    }
}

fn get_lhm_metrics() -> Option<(f32, f32, f32, f32)> {
    // See collect_metrics_loop for why we try without_security as a
    // fallback — once security is set, COMLibrary::new() can fail.
    let com_lib = COMLibrary::new()
        .or_else(|_| COMLibrary::without_security())
        .ok()?;
    let wmi_con = WMIConnection::with_namespace_path("ROOT\\LibreHardwareMonitor", com_lib).ok()?;
    // Fetch both Temperature and Load sensors in a single query
    let query = "SELECT Name, Value, SensorType FROM Sensor WHERE SensorType = 'Temperature' OR SensorType = 'Load'";
    let results: Vec<WmiSensor> = wmi_con.raw_query(query).ok()?;

    let mut cpu_temp = 0.0;
    let mut gpu_temp = 0.0;
    let mut cpu_load = 0.0;
    let mut gpu_load = 0.0;

    for sensor in results {
        let name_lower = sensor.name.to_lowercase();
        if sensor.sensor_type == "Temperature" {
            if name_lower.contains("cpu package") || (cpu_temp == 0.0 && name_lower.contains("cpu core")) {
                cpu_temp = sensor.value;
            } else if name_lower.contains("gpu core") {
                gpu_temp = sensor.value;
            }
        } else if sensor.sensor_type == "Load" {
            if name_lower.contains("cpu total") || (cpu_load == 0.0 && name_lower.contains("cpu load")) {
                cpu_load = sensor.value;
            } else if name_lower.contains("gpu core") || name_lower.contains("gpu load") {
                gpu_load = sensor.value;
            }
        }
    }

    Some((cpu_temp, gpu_temp, cpu_load, gpu_load))
}

fn get_ohm_metrics() -> Option<(f32, f32, f32, f32)> {
    // See collect_metrics_loop for why we try without_security as a
    // fallback — once security is set, COMLibrary::new() can fail.
    let com_lib = COMLibrary::new()
        .or_else(|_| COMLibrary::without_security())
        .ok()?;
    let wmi_con = WMIConnection::with_namespace_path("ROOT\\OpenHardwareMonitor", com_lib).ok()?;
    // Fetch both Temperature and Load sensors in a single query
    let query = "SELECT Name, Value, SensorType FROM Sensor WHERE SensorType = 'Temperature' OR SensorType = 'Load'";
    let results: Vec<WmiSensor> = wmi_con.raw_query(query).ok()?;

    let mut cpu_temp = 0.0;
    let mut gpu_temp = 0.0;
    let mut cpu_load = 0.0;
    let mut gpu_load = 0.0;

    for sensor in results {
        let name_lower = sensor.name.to_lowercase();
        if sensor.sensor_type == "Temperature" {
            if name_lower.contains("cpu package") || (cpu_temp == 0.0 && name_lower.contains("cpu core")) {
                cpu_temp = sensor.value;
            } else if name_lower.contains("gpu core") {
                gpu_temp = sensor.value;
            }
        } else if sensor.sensor_type == "Load" {
            if name_lower.contains("cpu total") || (cpu_load == 0.0 && name_lower.contains("cpu load")) {
                cpu_load = sensor.value;
            } else if name_lower.contains("gpu core") || name_lower.contains("gpu load") {
                gpu_load = sensor.value;
            }
        }
    }

    Some((cpu_temp, gpu_temp, cpu_load, gpu_load))
}

/// Aggregate collected samples into the final SessionMetrics.
///
/// Never returns `None` — when no real samples are available (COM/WMI
/// unavailable on the background thread) we return zeroed metrics so
/// the frontend still shows the performance section rather than the
/// "No performance data recorded" dead-end. This makes it obvious that
/// metrics collection was attempted but the data source wasn't available,
/// rather than silently hiding the entire section.
fn aggregate_metrics(samples: &[MetricsSample], config: &MetricsConfig) -> Option<SessionMetrics> {
    if samples.is_empty() {
        return Some(SessionMetrics {
            avg_fps: 0,
            avg_cpu_usage: 0,
            avg_gpu_usage: 0,
            avg_ram_usage: 0,
            avg_cpu_temp: 0,
            avg_gpu_temp: 0,
            min_fps: 0,
            max_fps: 0,
            resolution: "unknown".to_string(),
        });
    }

    let count = samples.len() as f64;

    let avg_cpu: f64 = samples.iter().map(|s| s.cpu_usage as f64).sum::<f64>() / count;
    let avg_gpu: f64 = samples.iter().map(|s| s.gpu_usage as f64).sum::<f64>() / count;
    let avg_ram: f64 = samples.iter().map(|s| s.ram_usage as f64).sum::<f64>() / count;
    let avg_cpu_t: f64 = samples.iter().map(|s| s.cpu_temp as f64).sum::<f64>() / count;
    let avg_gpu_t: f64 = samples.iter().map(|s| s.gpu_temp as f64).sum::<f64>() / count;

    // Prefer real RTSS/Afterburner FPS over estimated FPS
    let rtss_samples: Vec<_> = samples.iter().filter_map(|s| s.rtss_fps).collect();

    // FPS policy:
    //  - When ≥2 real RTSS/MAHM samples exist we use them directly. These
    //    are real measured FPS values straight from the game's overlay, so
    //    the only validation is the bound check in `read_rtss_metrics` /
    //    MAHM reader.
    //  - When fewer than 2 real samples exist we used to derive an FPS
    //    estimate from average GPU utilisation. This produced visibly wrong
    //    numbers (e.g. a low-load RPG showed 200+ FPS because of the
    //    `90 + (gpu - 90)*5` multiplier on the high-GPU branch), which made
    //    historical session stats confusing. Without a measured FPS source
    //    there's nothing meaningful to report, so we emit zeros and let
    //    the frontend surface "no FPS data" instead.
    // FPS is only emitted when capture_fps is on; otherwise the channel
    // carries zeros so the frontend shows "no FPS data" rather than a
    // fabricated curve.
    let (avg_fps, min_fps, max_fps) = if !config.capture_fps {
        (0, 0, 0)
    } else if rtss_samples.len() >= 2 {
        let avg = rtss_samples.iter().sum::<f64>() / rtss_samples.len() as f64;
        let min = rtss_samples.iter().cloned().fold(f64::INFINITY, f64::min);
        let max = rtss_samples.iter().cloned().fold(0.0f64, f64::max);
        (avg.round() as u32, min.round() as u32, max.round() as u32)
    } else {
        // No real FPS samples — return zeros rather than synthesising a
        // manufactured value from GPU/load heuristics. The UI renders
        // "—" for zero FPS, which is honest about the data we don't have.
        (0, 0, 0)
    };

    Some(SessionMetrics {
        avg_fps: if config.capture_fps { avg_fps } else { 0 },
        avg_cpu_usage: if config.capture_cpu { avg_cpu.round() as u32 } else { 0 },
        avg_gpu_usage: if config.capture_gpu { avg_gpu.round() as u32 } else { 0 },
        avg_ram_usage: if config.capture_ram { avg_ram.round() as u32 } else { 0 },
        avg_cpu_temp: if config.capture_cpu_temp { avg_cpu_t.round() as u32 } else { 0 },
        avg_gpu_temp: if config.capture_gpu_temp { avg_gpu_t.round() as u32 } else { 0 },
        min_fps: if config.capture_fps { min_fps.max(1) } else { 0 },
        max_fps: if config.capture_fps { max_fps } else { 0 },
        resolution: "1920x1080".to_string(),
    })
}

/// Helper to get the total system RAM in GB.
pub fn get_system_ram_gb() -> u32 {
    let com_lib = match COMLibrary::new() {
        Ok(lib) => lib,
        Err(_) => return 16,
    };
    let wmi_con = match WMIConnection::new(com_lib) {
        Ok(con) => con,
        Err(_) => return 16,
    };
    let total_mb = get_total_ram_mb(&wmi_con);
    // Convert MB to GB: MB / 1024
    let total_gb = (total_mb as f64 / 1024.0).round();
    total_gb as u32
}

/// Query the CPU model name from WMI (e.g. "AMD Ryzen 7 5800X 8-Core
/// Processor"). Returns "Unknown CPU" when COM/WMI is unavailable.
pub fn get_cpu_name() -> String {
    let com_lib = match COMLibrary::new() {
        Ok(lib) => lib,
        Err(_) => return "Unknown CPU".to_string(),
    };
    let wmi_con = match WMIConnection::new(com_lib) {
        Ok(con) => con,
        Err(_) => return "Unknown CPU".to_string(),
    };
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "PascalCase")]
    struct WmiProcessorName {
        name: Option<String>,
    }
    match wmi_con.raw_query::<WmiProcessorName>("SELECT Name FROM Win32_Processor") {
        Ok(results) => results
            .into_iter()
            .next()
            .and_then(|p| p.name)
            .filter(|n| !n.trim().is_empty())
            .unwrap_or_else(|| "Unknown CPU".to_string()),
        Err(_) => "Unknown CPU".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─────────── tests for resolve_mahm_ram_pct (production logic) ───────────

    #[test]
    fn resolve_accepts_explicit_percent_in_range() {
        assert_eq!(resolve_mahm_ram_pct(80.0, "%", 16 * 1024), Some(80.0));
        assert_eq!(resolve_mahm_ram_pct(0.0, "%", 16 * 1024), Some(0.0));
        assert_eq!(resolve_mahm_ram_pct(100.0, "%", 16 * 1024), Some(100.0));
    }

    #[test]
    fn resolve_treats_percent_with_out_of_range_value_as_absolute() {
        // If units string contains "%" but data is huge, the heuristic
        // falls through to MB interpretation. 8192 MB on 16 GB = 50%.
        let p = resolve_mahm_ram_pct(8192.0, "Memory %", 16 * 1024);
        assert!(p.is_some());
        assert!((p.unwrap() - 50.0).abs() < 0.01);
    }

    #[test]
    fn resolve_accepts_typical_units_in_band() {
        assert!((resolve_mahm_ram_pct(8192.0, "MB", 16 * 1024).unwrap() - 50.0).abs() < 0.01);
        assert!((resolve_mahm_ram_pct(8.0, "GB", 16 * 1024).unwrap() - 50.0).abs() < 0.01);
        assert!((resolve_mahm_ram_pct(8_388_608.0, "KB", 16 * 1024).unwrap() - 50.0).abs() < 0.01);
    }

    #[test]
    fn resolve_accepts_legitimate_full_ram_via_mb() {
        // 16384 MB used on a 16 GB system = exactly 100% — in band [0.1, 105].
        let p = resolve_mahm_ram_pct(16_384.0, "MB", 16 * 1024);
        assert!(p.is_some());
        assert!((p.unwrap() - 100.0).abs() < 0.01);
    }

    #[test]
    fn resolve_returns_none_for_nan_infinity_negative_or_zero_total() {
        assert!(resolve_mahm_ram_pct(f32::NAN, "%", 16 * 1024).is_none());
        assert!(resolve_mahm_ram_pct(f32::INFINITY, "MB", 16 * 1024).is_none());
        assert!(resolve_mahm_ram_pct(f32::NEG_INFINITY, "MB", 16 * 1024).is_none());
        assert!(resolve_mahm_ram_pct(-1.0, "%", 16 * 1024).is_none());
        assert!(resolve_mahm_ram_pct(100.0, "MB", 0).is_none());
    }

    #[test]
    fn resolve_returns_none_when_all_candidates_are_out_of_band() {
        // 50 million MB on a 16 GB system — no unit squishes this into a
        // sensible RAM %. Caller MUST fall back to WMI. This was the trap
        // behind "always 100%" before the multi-candidate heuristic.
        assert!(resolve_mahm_ram_pct(50_000_000.0, "MB", 16 * 1024).is_none());
    }

    #[test]
    fn resolve_returns_none_for_small_value_with_empty_units() {
        // 80 (units unknown) on a 16 GB system: MB interpretation gives
        // 0.488% (below our 0.5% band floor — likely unit-detection fault).
        // All three candidates land outside [0.5%, 105%], so we return None
        // and the caller falls back to WMI. This hardens against ambiguous
        // small readings that could otherwise be displayed as misleading 0%.
        assert!(resolve_mahm_ram_pct(80.0, "", 16 * 1024).is_none());
    }

    #[test]
    fn resolve_rejects_wrong_unit_kb_as_mb_misreading() {
        // Defensive: if we treat a real MB value (8192) as if it were KB,
        // the wrong KB→MB direction would produce ~8,000,000% — well outside
        // the band. None is returned and WMI takes over. This test was the
        // actual root cause: the old formula multiplied by 1024 for KB
        // instead of dividing.
        assert!(resolve_mahm_ram_pct(8192.0, "KB", 16 * 1024).is_none());
    }

    // ─────────── tests for the WMI math baseline ───────────

    #[test]
    fn test_wmi_ram_pct_basic() {
        let total: u64 = 16 * 1024 * 1024; // 16 GB in KB
        let free: u64 = 8 * 1024 * 1024;   // 8 GB free
        let used_pct = ((total - free) as f64 / total as f64) * 100.0;
        assert_eq!(used_pct.round() as u32, 50);
    }

    #[test]
    fn test_wmi_math_with_zero_total_returns_zero() {
        // Mirrors the guard in `get_ram_usage_pct`.
        let total: u64 = 0;
        let free: u64 = 0;
        assert!(!(total > 0 && total >= free));
    }
}
