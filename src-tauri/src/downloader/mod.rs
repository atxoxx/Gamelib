pub mod debrid;
pub mod direct;

use std::sync::Arc;
use std::sync::atomic::AtomicU64;
use crate::torrent_engine::{TorrentEngine, TorrentDownload, DownloadStatus, TorrentFile};
use crate::downloader::debrid::{AllDebridClient, TorBoxClient};

#[tauri::command]
pub async fn test_debrid_key(provider: String, apikey: String) -> Result<debrid::DebridUserInfo, String> {
    if provider == "alldebrid" {
        AllDebridClient::test_key(&apikey).await
    } else if provider == "torbox" {
        TorBoxClient::test_key(&apikey).await
    } else {
        Err("Unsupported debrid provider".to_string())
    }
}

#[tauri::command]
pub async fn check_debrid_cache(provider: String, apikey: String, magnet: String) -> Result<debrid::DebridCacheResult, String> {
    if provider == "alldebrid" {
        AllDebridClient::check_cache(&apikey, &magnet).await
    } else if provider == "torbox" {
        TorBoxClient::check_cache(&apikey, &magnet).await
    } else {
        Err("Unsupported debrid provider".to_string())
    }
}

#[tauri::command]
pub async fn direct_download_start(
    id: String,
    url: String,
    save_path: String,
    game_id: Option<String>,
    source_name: String,
    auto_extract: Option<bool>,
    uris: Option<Vec<String>>,
) -> Result<TorrentDownload, String> {
    let engine = crate::torrent_engine::engine().await
        .ok_or_else(|| "Torrent engine not initialized".to_string())?;

    let filename = std::path::Path::new(&save_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("direct_download")
        .to_string();

    let bytes_counter = Arc::new(AtomicU64::new(0));

    let download = TorrentDownload {
        id: id.clone(),
        name: filename,
        source_uri: url.clone(),
        save_path: save_path.clone(),
        downloaded: 0,
        total_size: None,
        progress: Some(0.0),
        download_speed: 0,
        upload_speed: 0,
        seeds: 0,
        peers: 0,
        status: DownloadStatus::Downloading,
        game_id,
        source_name,
        added_at: crate::torrent_engine::unix_now(),
        files: vec![TorrentFile {
            name: std::path::Path::new(&save_path).file_name().unwrap_or_default().to_string_lossy().into_owned(),
            size: 0,
            downloaded: 0,
            progress: 0.0,
            selected: true,
        }],
        auto_extract: Some(auto_extract.unwrap_or(false)),
        extracted: Some(false),
        uris,
    };

    {
        let mut guard = engine.write().await;
        // Insert atomic counter into the engine downloads mapping if needed
        guard.downloads_mut().insert(id.clone(), download.clone());
        guard.direct_counters.insert(id.clone(), Arc::clone(&bytes_counter));
        guard.mark_dirty();
        guard.emit_progress_force();
    }

    let engine_weak = Arc::downgrade(&engine);
    tokio::spawn(async move {
        direct::run_direct_download(
            id,
            url,
            save_path,
            bytes_counter,
            engine_weak,
        ).await;
    });

    Ok(download)
}

#[tauri::command]
pub async fn debrid_download_start(
    id: String,
    magnet: String,
    save_path: String,
    game_id: Option<String>,
    source_name: String,
    provider: String,
    apikey: String,
    auto_extract: Option<bool>,
) -> Result<TorrentDownload, String> {
    let engine = crate::torrent_engine::engine().await
        .ok_or_else(|| "Torrent engine not initialized".to_string())?;

    let filename = format!("Debrid: {}", id);

    let download = TorrentDownload {
        id: id.clone(),
        name: filename,
        source_uri: magnet.clone(),
        save_path: save_path.clone(),
        downloaded: 0,
        total_size: None,
        progress: Some(0.0),
        download_speed: 0,
        upload_speed: 0,
        seeds: 0,
        peers: 0,
        status: DownloadStatus::FetchingMetadata,
        game_id: game_id.clone(),
        source_name: format!("{} (Debrid)", source_name),
        added_at: crate::torrent_engine::unix_now(),
        files: Vec::new(),
        auto_extract: Some(auto_extract.unwrap_or(false)),
        extracted: Some(false),
        uris: None,
    };

    {
        let mut guard = engine.write().await;
        guard.downloads_mut().insert(id.clone(), download.clone());
        guard.mark_dirty();
        guard.emit_progress_force();
    }

    let engine_weak = Arc::downgrade(&engine);
    
    tokio::spawn(async move {
        println!("[DebridDownloader] Uploading magnet to debrid ({})", provider);
        let upload_res = if provider == "alldebrid" {
            AllDebridClient::upload_magnet(&apikey, &magnet).await
        } else if provider == "torbox" {
            TorBoxClient::upload_magnet(&apikey, &magnet).await
        } else {
            Err("Unsupported provider".to_string())
        };

        let transfer_id = match upload_res {
            Ok(tid) => tid,
            Err(e) => {
                set_status_error(&engine_weak, &id, format!("Debrid upload failed: {}", e)).await;
                return;
            }
        };

        // Poll debrid status
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(3));
        loop {
            interval.tick().await;

            // Check if paused or canceled from engine
            if let Some(engine) = engine_weak.upgrade() {
                let guard = engine.read().await;
                if let Some(item) = guard.downloads_map().get(&id) {
                    if matches!(item.status, DownloadStatus::Paused) {
                        return; // Exit polling loop
                    }
                } else {
                    return; // Removed
                }
            } else {
                return;
            }

            let status_res = if provider == "alldebrid" {
                AllDebridClient::get_status(&apikey, &transfer_id).await
            } else {
                TorBoxClient::get_status(&apikey, &transfer_id).await
            };

            let status = match status_res {
                Ok(s) => s,
                Err(e) => {
                    set_status_error(&engine_weak, &id, format!("Failed to poll debrid: {}", e)).await;
                    return;
                }
            };

            if status.status == "ready" {
                if status.links.is_empty() {
                    set_status_error(&engine_weak, &id, "No download links returned by debrid".to_string()).await;
                    return;
                }

                println!("[DebridDownloader] Debrid completed. Links: {:?}", status.links);
                // Start direct downloads for the links. For simplicity, download the first link or
                // if there are multiple links, spawn direct downloads.
                // We will take the first link and name it with the correct file extension or suffix.
                let first_link = status.links[0].clone();

                // Remove debrid entry and convert it to a direct download
                if let Some(engine) = engine_weak.upgrade() {
                    let mut guard = engine.write().await;
                    guard.downloads_mut().remove(&id);
                }

                let _ = direct_download_start(
                    id.clone(),
                    first_link,
                    save_path.clone(),
                    game_id.clone(),
                    source_name.clone(),
                    auto_extract,
                    Some(status.links),
                ).await;

                return;
            } else if status.status == "error" {
                let err_msg = status.error_message.unwrap_or_else(|| "Debrid download error".to_string());
                set_status_error(&engine_weak, &id, err_msg).await;
                return;
            } else {
                // Update progress in engine
                if let Some(engine) = engine_weak.upgrade() {
                    let mut guard = engine.write().await;
                    if let Some(item) = guard.downloads_mut().get_mut(&id) {
                        item.progress = Some(status.progress / 100.0);
                        item.status = DownloadStatus::Downloading; // Show as downloading on debrid
                        guard.mark_dirty();
                        guard.emit_progress_force();
                    }
                }
            }
        }
    });

    Ok(download)
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

#[tauri::command]
pub async fn direct_download_update_url(id: String, new_url: String) -> Result<(), String> {
    let engine = crate::torrent_engine::engine().await
        .ok_or_else(|| "Torrent engine not initialized".to_string())?;

    let mut guard = engine.write().await;
    
    let (was_downloading, was_error, save_path, _game_id, _source_name, _auto_extract) = {
        let item = guard.downloads_mut().get(&id).ok_or_else(|| "Download not found".to_string())?;
        let was_dl = matches!(item.status, DownloadStatus::Downloading);
        let was_err = matches!(item.status, DownloadStatus::Error(_));
        (
            was_dl, 
            was_err,
            item.save_path.clone(), 
            item.game_id.clone(), 
            item.source_name.clone(), 
            item.auto_extract.unwrap_or(false)
        )
    };

    if was_downloading {
        if let Some(item) = guard.downloads_mut().get_mut(&id) {
            item.status = DownloadStatus::Paused;
        }
        guard.mark_dirty();
        guard.emit_progress_force();
        
        drop(guard);
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        guard = engine.write().await;
    }

    if let Some(item) = guard.downloads_mut().get_mut(&id) {
        item.source_uri = new_url.clone();
        if was_downloading || was_error {
            item.status = DownloadStatus::Downloading;
        }
    }
    guard.mark_dirty();
    guard.emit_progress_force();

    if was_downloading || was_error {
        let bytes_counter = Arc::new(AtomicU64::new(0));
        guard.direct_counters.insert(id.clone(), Arc::clone(&bytes_counter));
        let engine_weak = Arc::downgrade(&engine);
        tokio::spawn(async move {
            direct::run_direct_download(
                id,
                new_url,
                save_path,
                bytes_counter,
                engine_weak,
            ).await;
        });
    }

    Ok(())
}

#[tauri::command]
pub async fn debrid_unrestrict_link(
    provider: String,
    apikey: String,
    url: String,
) -> Result<String, String> {
    if provider == "alldebrid" {
        AllDebridClient::unrestrict_link(&apikey, &url).await
    } else if provider == "torbox" {
        TorBoxClient::unrestrict_link(&apikey, &url).await
    } else {
        Err("Unsupported provider".to_string())
    }
}

