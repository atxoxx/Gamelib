use serde::Serialize;
use wmi::{COMLibrary, WMIConnection};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use crate::rtss_reader;

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

/// A single metrics sample collected at a point in time.
#[derive(Debug, Clone)]
struct MetricsSample {
    cpu_usage: u32,
    gpu_usage: u32,
    ram_usage: u32,
    cpu_temp: u32,
    gpu_temp: u32,
    rtss_fps: Option<f64>,
    rtss_fps_min: Option<f64>,
    rtss_fps_max: Option<f64>,
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

/// Start collecting real-time performance metrics on a background thread.
/// Returns a receiver that the caller can use to stop collection and get the averaged results.
/// Polls every `interval_secs` seconds while the game is running.
/// `game_pid` is used to look up real FPS from RTSS shared memory when available.
pub fn start_metrics_collection(
    interval_secs: u64,
    game_pid: u32,
) -> (
    std::sync::mpsc::Sender<()>,
    std::sync::mpsc::Receiver<Option<SessionMetrics>>,
) {
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (result_tx, result_rx) = mpsc::channel::<Option<SessionMetrics>>();

    std::thread::spawn(move || {
        let samples = collect_metrics_loop(interval_secs, stop_rx, game_pid);
        let metrics = aggregate_metrics(&samples);
        let _ = result_tx.send(metrics);
    });

    (stop_tx, result_rx)
}

fn collect_metrics_loop(interval_secs: u64, stop_rx: mpsc::Receiver<()>, game_pid: u32) -> Vec<MetricsSample> {
    let mut samples: Vec<MetricsSample> = Vec::new();
    let interval = Duration::from_secs(interval_secs);

    // Initialize COM on this thread for WMI queries
    let com_lib = match COMLibrary::new() {
        Ok(lib) => lib,
        Err(_) => return samples,
    };
    let wmi_con = match WMIConnection::new(com_lib) {
        Ok(con) => con,
        Err(_) => return samples,
    };

    loop {
        // Check if we should stop
        if stop_rx.try_recv().is_ok() {
            break;
        }

        let sample = collect_single_sample(&wmi_con, game_pid);
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

fn collect_single_sample(wmi_con: &WMIConnection, game_pid: u32) -> MetricsSample {
    let cpu = get_cpu_usage(wmi_con);
    let gpu = get_gpu_usage(wmi_con);
    let ram = get_ram_usage(wmi_con);

    // Try to read real FPS from RTSS shared memory
    let rtss = rtss_reader::read_rtss_metrics(game_pid);

    MetricsSample {
        cpu_usage: cpu,
        gpu_usage: gpu,
        ram_usage: ram,
        cpu_temp: 0, // WMI thermal zones are unreliable — skip
        gpu_temp: 0,
        rtss_fps: rtss.as_ref().map(|r| r.fps),
        rtss_fps_min: rtss.as_ref().map(|r| r.stat_fps_min),
        rtss_fps_max: rtss.as_ref().map(|r| r.stat_fps_max),
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

fn get_gpu_usage(wmi_con: &WMIConnection) -> u32 {
    // GPU usage via WMI is complex — try multiple approaches
    // Approach 1: Try GPU Engine performance counters (best effort)
    let query = "SELECT UtilizationPercentage FROM Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine WHERE Name LIKE '%engtype_3D%'";
    if let Ok(results) = wmi_con.raw_query::<WmiGpuEngine>(query) {
        let total: u64 = results.iter().filter_map(|r| r.utilization_percentage).sum();
        let count = results.len() as u64;
        if count > 0 {
            return (total / count) as u32;
        }
    }

    // Approach 2: Try without the WHERE filter (broader match)
    let query2 = "SELECT UtilizationPercentage FROM Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine";
    if let Ok(results) = wmi_con.raw_query::<WmiGpuEngine>(query2) {
        let total: u64 = results.iter().filter_map(|r| r.utilization_percentage).sum();
        let count = results.len() as u64;
        if count > 0 {
            return (total / count) as u32;
        }
    }

    0
}

#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "PascalCase")]
struct WmiGpuEngine {
    utilization_percentage: Option<u64>,
}

fn get_ram_usage(wmi_con: &WMIConnection) -> u32 {
    let query = "SELECT TotalVisibleMemorySize, FreePhysicalMemory FROM Win32_OperatingSystem";
    match wmi_con.raw_query::<WmiOS>(query) {
        Ok(results) => {
            if let Some(os) = results.into_iter().next() {
                let total = os.total_visible_memory_size.unwrap_or(1);
                let free = os.free_physical_memory.unwrap_or(0);
                if total > 0 {
                    let used_pct = ((total - free) * 100) / total;
                    return used_pct as u32;
                }
            }
            0
        }
        Err(_) => 0,
    }
}

/// Aggregate collected samples into the final SessionMetrics.
fn aggregate_metrics(samples: &[MetricsSample]) -> Option<SessionMetrics> {
    if samples.is_empty() {
        return None;
    }

    let count = samples.len() as f64;

    let avg_cpu: f64 = samples.iter().map(|s| s.cpu_usage as f64).sum::<f64>() / count;
    let avg_gpu: f64 = samples.iter().map(|s| s.gpu_usage as f64).sum::<f64>() / count;
    let avg_ram: f64 = samples.iter().map(|s| s.ram_usage as f64).sum::<f64>() / count;

    // Prefer real RTSS FPS over estimated FPS
    let rtss_samples: Vec<_> = samples.iter().filter_map(|s| s.rtss_fps).collect();

    let (avg_fps, min_fps, max_fps) = if rtss_samples.len() >= 2 {
        // Use real RTSS data
        let avg = rtss_samples.iter().sum::<f64>() / rtss_samples.len() as f64;
        let min = rtss_samples.iter().cloned().fold(f64::INFINITY, f64::min);
        let max = rtss_samples.iter().cloned().fold(0.0f64, f64::max);
        (avg.round() as u32, min.round() as u32, max.round() as u32)
    } else {
        // Fall back to GPU-utilization-based FPS estimation
        let estimated_fps = if avg_gpu > 90.0 {
            90 + ((avg_gpu - 90.0) * 5.0) as u32
        } else if avg_gpu > 50.0 {
            40 + ((avg_gpu - 50.0) * 1.25) as u32
        } else {
            20 + (avg_gpu * 0.6) as u32
        };
        let min = (estimated_fps as f64 * 0.6) as u32;
        let max = (estimated_fps as f64 * 1.5) as u32;
        (estimated_fps, min.max(1), max)
    };

    Some(SessionMetrics {
        avg_fps,
        avg_cpu_usage: avg_cpu.round() as u32,
        avg_gpu_usage: avg_gpu.round() as u32,
        avg_ram_usage: avg_ram.round() as u32,
        avg_cpu_temp: 0,
        avg_gpu_temp: 0,
        min_fps: min_fps.max(1),
        max_fps,
        resolution: "1920x1080".to_string(),
    })
}
