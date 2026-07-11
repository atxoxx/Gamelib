use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::path::Path;
use tokio::fs::OpenOptions;
use tokio::io::AsyncWriteExt;
use reqwest::header::RANGE;
use crate::torrent_engine::{TorrentEngine, DownloadStatus};

fn try_next_mirror_or_fail(
    engine_weak: std::sync::Weak<tokio::sync::RwLock<TorrentEngine>>,
    id: String,
    err_msg: String,
) -> bool {
    if let Some(engine) = engine_weak.upgrade() {
        let mut guard = match engine.try_write() {
            Ok(g) => g,
            Err(_) => engine.blocking_write(),
        };
        let mut transition_info = None;
        if let Some(item) = guard.downloads_mut().get_mut(&id) {
            if let Some(uris) = &item.uris {
                if uris.len() > 1 {
                    if let Some(current_idx) = uris.iter().position(|u| u == &item.source_uri) {
                        let next_idx = current_idx + 1;
                        if next_idx < uris.len() {
                            let next_url = uris[next_idx].clone();
                            println!(
                                "[DirectDownloader] Download failed on mirror {} ({}). Trying next mirror {} ({})...",
                                current_idx + 1,
                                item.source_uri,
                                next_idx + 1,
                                next_url
                            );
                            item.source_uri = next_url.clone();
                            transition_info = Some((next_url, item.save_path.clone()));
                        }
                    }
                }
            }
        }

        if let Some((next_url, save_path)) = transition_info {
            let bytes_counter = Arc::new(AtomicU64::new(0));
            guard.direct_counters.insert(id.clone(), Arc::clone(&bytes_counter));
            guard.mark_dirty();
            guard.emit_progress_force();
            
            let engine_weak_clone = engine_weak.clone();
            let id_clone = id.clone();
            tokio::spawn(async move {
                run_direct_download(
                    id_clone,
                    next_url,
                    save_path,
                    bytes_counter,
                    engine_weak_clone,
                ).await;
            });
            return true;
        }

        if let Some(item) = guard.downloads_mut().get_mut(&id) {
            item.status = DownloadStatus::Error(err_msg);
        }
        guard.mark_dirty();
        guard.emit_progress_force();
    }
    false
}

/// Runs a direct HTTP download in a background task.
/// Updates the atomic bytes counter, and respects the status changes (pause/cancel).
pub async fn run_direct_download(
    id: String,
    url: String,
    save_path: String,
    bytes_counter: Arc<AtomicU64>,
    engine_weak: std::sync::Weak<tokio::sync::RwLock<TorrentEngine>>,
) {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .unwrap_or_default();
    
    // We download to a temporary file, then rename it upon completion.
    let path = Path::new(&save_path);
    let filename = path.file_name().and_then(|s| s.to_str()).unwrap_or("direct_download").to_string();
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let temp_path = parent.join(format!("{}.gamelib_tmp", filename));

    // Get current size to support resume.
    let mut current_size = 0;
    if temp_path.exists() {
        if let Ok(metadata) = std::fs::metadata(&temp_path) {
            current_size = metadata.len();
        }
    }
    bytes_counter.store(current_size, Ordering::SeqCst);

    println!("[DirectDownloader] Starting download for {} from byte {}", filename, current_size);

    // Build the request.
    let mut req = client.get(&url);
    if current_size > 0 {
        req = req.header(RANGE, format!("bytes={}-", current_size));
    }

    let resp_res = req.send().await;
    let mut resp = match resp_res {
        Ok(r) => {
            if !r.status().is_success() && r.status() != reqwest::StatusCode::PARTIAL_CONTENT {
                let err = format!("HTTP Error: {}", r.status());
                try_next_mirror_or_fail(engine_weak.clone(), id.clone(), err);
                return;
            }
            r
        }
        Err(e) => {
            let err = format!("Connection failed: {}", e);
            try_next_mirror_or_fail(engine_weak.clone(), id.clone(), err);
            return;
        }
    };

    if let Some(content_length) = resp.content_length() {
        let total = if resp.status() == reqwest::StatusCode::PARTIAL_CONTENT {
            current_size + content_length
        } else {
            content_length
        };
        set_total_size(&engine_weak, &id, total).await;
    }

    // Ensure parent directories exist
    if let Some(parent_dir) = temp_path.parent() {
        if !parent_dir.exists() {
            if let Err(e) = tokio::fs::create_dir_all(parent_dir).await {
                set_status_error(&engine_weak, &id, format!("Failed to create parent directories: {}", e)).await;
                return;
            }
        }
    }

    let file_res = OpenOptions::new()
        .create(true)
        .write(true)
        .append(true)
        .open(&temp_path)
        .await;

    let mut file = match file_res {
        Ok(f) => f,
        Err(e) => {
            set_status_error(&engine_weak, &id, format!("Failed to create file: {}", e)).await;
            return;
        }
    };

    let mut buffer_size = current_size;
    
    loop {
        // Check if download was paused, removed, or errored from the engine side.
        if let Some(engine) = engine_weak.upgrade() {
            let guard = engine.read().await;
            if let Some(item) = guard.downloads_map().get(&id) {
                if matches!(item.status, DownloadStatus::Paused) {
                    println!("[DirectDownloader] Download paused for {}", filename);
                    return;
                }
            } else {
                // Download was removed. Clean up temp file.
                drop(file);
                let _ = tokio::fs::remove_file(&temp_path).await;
                return;
            }
        } else {
            return;
        }

        // Fetch next chunk.
        let chunk_res = resp.chunk().await;
        let chunk = match chunk_res {
            Ok(Some(c)) => c,
            Ok(None) => break, // Download complete!
            Err(e) => {
                let err = format!("Download interrupted: {}", e);
                try_next_mirror_or_fail(engine_weak.clone(), id.clone(), err);
                return;
            }
        };

        if let Err(e) = file.write_all(&chunk).await {
            set_status_error(&engine_weak, &id, format!("Disk write failed: {}", e)).await;
            return;
        }

        buffer_size += chunk.len() as u64;
        bytes_counter.store(buffer_size, Ordering::SeqCst);
    }

    // Flush and close the file.
    let _ = file.flush().await;
    drop(file);

    // Rename to final path.
    if let Err(e) = tokio::fs::rename(&temp_path, &path).await {
        set_status_error(&engine_weak, &id, format!("Failed to finalize file: {}", e)).await;
        return;
    }

    // Mark as completed.
    if let Some(engine) = engine_weak.upgrade() {
        let mut guard = engine.write().await;
        let mut auto_extract = false;
        let mut files_clone = Vec::new();
        if let Some(item) = guard.downloads_mut().get_mut(&id) {
            item.status = DownloadStatus::Completed;
            item.progress = Some(1.0);
            item.downloaded = item.total_size.unwrap_or(buffer_size);
            auto_extract = item.auto_extract.unwrap_or(false);
            files_clone = item.files.clone();
        }
        guard.mark_dirty();
        guard.emit_progress_force();

        // Trigger extraction if requested.
        if auto_extract {
            let id_clone = id.clone();
            let id_clone_for_extract = id.clone();
            let save_path_clone = save_path.clone();
            let engine_clone = Arc::clone(&engine);
            tokio::spawn(async move {
                println!("[DirectDownloader] Starting auto-extraction for {}", filename);
                let success = tokio::task::spawn_blocking(move || {
                    crate::torrent_engine::extract_archives_for_torrent(&id_clone_for_extract, &save_path_clone, &files_clone)
                })
                .await
                .map(|r| r.is_ok())
                .unwrap_or(false);

                if success {
                    if let Some(mut guard) = engine_clone.try_write().ok() {
                        if let Some(d) = guard.downloads_mut().get_mut(&id_clone) {
                            d.extracted = Some(true);
                            guard.mark_dirty();
                            guard.emit_progress_force();
                        }
                    }
                }
            });
        }
    }
}

async fn set_status_error(
    engine_weak: &std::sync::Weak<tokio::sync::RwLock<TorrentEngine>>,
    id: &str,
    err: String,
) {
    if let Some(engine) = engine_weak.upgrade() {
        let mut guard = engine.write().await;
        if let Some(item) = guard.downloads_mut().get_mut(id) {
            item.status = DownloadStatus::Error(err);
            guard.mark_dirty();
            guard.emit_progress_force();
        }
    }
}

async fn set_total_size(
    engine_weak: &std::sync::Weak<tokio::sync::RwLock<TorrentEngine>>,
    id: &str,
    size: u64,
) {
    if let Some(engine) = engine_weak.upgrade() {
        let mut guard = engine.write().await;
        if let Some(item) = guard.downloads_mut().get_mut(id) {
            item.total_size = Some(size);
            guard.mark_dirty();
            guard.emit_progress_force();
        }
    }
}
