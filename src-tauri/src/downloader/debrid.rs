use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DebridCacheResult {
    pub instant: bool,
    pub provider: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DebridStatusResult {
    pub id: String,
    pub progress: f32,
    pub status: String, // "ready", "downloading", "queued", "error"
    pub links: Vec<String>,
    pub error_message: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DebridUserInfo {
    pub username: String,
    pub premium_until: Option<u64>,
}

// ─── AllDebrid Client ────────────────────────────────────────────────────────

pub struct AllDebridClient;

#[derive(Deserialize, Debug)]
struct AllDebridResponse<T> {
    status: String,
    data: Option<T>,
    error: Option<AllDebridError>,
}

#[derive(Deserialize, Debug)]
struct AllDebridError {
    code: String,
    message: String,
}

#[derive(Deserialize, Debug)]
struct AllDebridUserResponse {
    user: AllDebridUser,
}

#[derive(Deserialize, Debug)]
struct AllDebridUser {
    username: String,
    premiumUntil: u64,
}

#[derive(Deserialize, Debug)]
struct AllDebridInstantResponse {
    magnets: Vec<AllDebridMagnetInstant>,
}

#[derive(Deserialize, Debug)]
struct AllDebridMagnetInstant {
    magnet: String,
    instant: bool,
}

#[derive(Deserialize, Debug)]
struct AllDebridUploadResponse {
    magnets: Vec<AllDebridMagnetUpload>,
}

#[derive(Deserialize, Debug)]
struct AllDebridMagnetUpload {
    id: u64,
    name: String,
    magnet: String,
}

#[derive(Deserialize, Debug)]
struct AllDebridStatusResponse {
    magnets: AllDebridMagnetStatus,
}

#[derive(Deserialize, Debug)]
struct AllDebridMagnetStatus {
    id: u64,
    filename: String,
    size: u64,
    status: String,
    statusCode: u8,
    statusCodeDescription: String,
    downloaded: u64,
    speed: u64,
    seeders: u32,
    links: Vec<AllDebridLink>,
}

#[derive(Deserialize, Debug)]
struct AllDebridLink {
    link: String,
    filename: String,
    size: u64,
}

impl AllDebridClient {
    pub async fn test_key(apikey: &str) -> Result<DebridUserInfo, String> {
        let client = reqwest::Client::new();
        let url = format!(
            "https://api.alldebrid.com/v4/user/infos?agent=gamelib&apikey={}",
            apikey
        );
        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        let body: AllDebridResponse<AllDebridUserResponse> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse user info response: {}", e))?;

        if body.status != "success" {
            let err_msg = body
                .error
                .map(|e| e.message)
                .unwrap_or_else(|| "Unknown error".to_string());
            return Err(err_msg);
        }

        let data = body.data.ok_or("Empty response data")?;
        Ok(DebridUserInfo {
            username: data.user.username,
            premium_until: Some(data.user.premiumUntil),
        })
    }

    pub async fn check_cache(apikey: &str, magnet: &str) -> Result<DebridCacheResult, String> {
        let client = reqwest::Client::new();
        let url = format!(
            "https://api.alldebrid.com/v4/magnet/instant?agent=gamelib&apikey={}&magnets[]={}",
            apikey,
            urlencoding::encode(magnet)
        );
        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        let body: AllDebridResponse<AllDebridInstantResponse> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse instant cache check response: {}", e))?;

        if body.status != "success" {
            return Ok(DebridCacheResult {
                instant: false,
                provider: "alldebrid".to_string(),
            });
        }

        let data = body.data.ok_or("Empty response data")?;
        let instant = data
            .magnets
            .first()
            .map(|m| m.instant)
            .unwrap_or(false);

        Ok(DebridCacheResult {
            instant,
            provider: "alldebrid".to_string(),
        })
    }

    pub async fn upload_magnet(apikey: &str, magnet: &str) -> Result<String, String> {
        let client = reqwest::Client::new();
        let url = format!(
            "https://api.alldebrid.com/v4/magnet/upload?agent=gamelib&apikey={}&magnets[]={}",
            apikey,
            urlencoding::encode(magnet)
        );
        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        let body: AllDebridResponse<AllDebridUploadResponse> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse upload response: {}", e))?;

        if body.status != "success" {
            let err_msg = body
                .error
                .map(|e| e.message)
                .unwrap_or_else(|| "Failed to upload magnet".to_string());
            return Err(err_msg);
        }

        let data = body.data.ok_or("Empty response data")?;
        let mag = data
            .magnets
            .first()
            .ok_or("No upload results returned")?;

        Ok(mag.id.to_string())
    }

    pub async fn get_status(apikey: &str, id: &str) -> Result<DebridStatusResult, String> {
        let client = reqwest::Client::new();
        let url = format!(
            "https://api.alldebrid.com/v4/magnet/status?agent=gamelib&apikey={}&id={}",
            apikey, id
        );
        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        let body: AllDebridResponse<AllDebridStatusResponse> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse status response: {}", e))?;

        if body.status != "success" {
            let err_msg = body
                .error
                .map(|e| e.message)
                .unwrap_or_else(|| "Failed to fetch status".to_string());
            return Err(err_msg);
        }

        let data = body.data.ok_or("Empty response data")?;
        let mag = data.magnets;

        let status = match mag.statusCode {
            4 => "ready".to_string(), // Ready/completed
            0..=3 => "downloading".to_string(), // In queue, processing, downloading
            _ => "error".to_string(),
        };

        let progress = if mag.size > 0 {
            (mag.downloaded as f32 / mag.size as f32) * 100.0
        } else {
            0.0
        };

        let links = mag.links.iter().map(|l| l.link.clone()).collect();

        Ok(DebridStatusResult {
            id: id.to_string(),
            progress,
            status,
            links,
            error_message: if mag.statusCode > 4 {
                Some(mag.statusCodeDescription)
            } else {
                None
            },
        })
    }
}

// ─── TorBox Client ───────────────────────────────────────────────────────────

pub struct TorBoxClient;

#[derive(Deserialize, Debug)]
struct TorBoxResponse<T> {
    success: bool,
    detail: Option<String>,
    data: Option<T>,
}

#[derive(Deserialize, Debug)]
struct TorBoxUserResponse {
    user: TorBoxUser,
}

#[derive(Deserialize, Debug)]
struct TorBoxUser {
    email: String,
    is_premium: bool,
}

#[derive(Deserialize, Debug)]
struct TorBoxUploadResponse {
    torrent_id: Option<u64>,
    hash: Option<String>,
}

#[derive(Deserialize, Debug)]
struct TorBoxInstantResponse {
    cached: bool,
}

#[derive(Deserialize, Debug)]
struct TorBoxTorrentList {
    id: u64,
    name: String,
    progress: f32,
    download_finished: bool,
    download_present: bool,
    active: bool,
    download_speed: u64,
    upload_speed: u64,
    seeds: u32,
    peers: u32,
    files: Vec<TorBoxFile>,
}

#[derive(Deserialize, Debug)]
struct TorBoxFile {
    id: u64,
    name: String,
    short_name: String,
    size: u64,
}

#[derive(Deserialize, Debug)]
struct TorBoxZipResponse {
    zip_link: String,
}

impl TorBoxClient {
    pub async fn test_key(apikey: &str) -> Result<DebridUserInfo, String> {
        let client = reqwest::Client::new();
        let resp = client
            .get("https://api.torbox.app/v1/api/user/me")
            .header("Authorization", format!("Bearer {}", apikey))
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        let body: TorBoxResponse<TorBoxUserResponse> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse TorBox user response: {}", e))?;

        if !body.success {
            return Err(body.detail.unwrap_or_else(|| "Invalid API key".to_string()));
        }

        let data = body.data.ok_or("Empty TorBox response data")?;
        Ok(DebridUserInfo {
            username: data.user.email,
            premium_until: if data.user.is_premium { Some(u64::MAX) } else { None },
        })
    }

    pub async fn check_cache(apikey: &str, magnet: &str) -> Result<DebridCacheResult, String> {
        let client = reqwest::Client::new();
        let url = format!(
            "https://api.torbox.app/v1/api/torrents/checkcached?hash={}",
            Self::extract_hash(magnet)
        );
        let resp = client
            .get(&url)
            .header("Authorization", format!("Bearer {}", apikey))
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        let body: TorBoxResponse<TorBoxInstantResponse> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse checkcached response: {}", e))?;

        let instant = body.data.map(|d| d.cached).unwrap_or(false);
        Ok(DebridCacheResult {
            instant,
            provider: "torbox".to_string(),
        })
    }

    pub async fn upload_magnet(apikey: &str, magnet: &str) -> Result<String, String> {
        let client = reqwest::Client::new();
        let payload = serde_json::json!({
            "magnet": magnet,
            "seed": "false",
            "allow_asymmetric": "true"
        });

        let resp = client
            .post("https://api.torbox.app/v1/api/torrents/createtorrent")
            .header("Authorization", format!("Bearer {}", apikey))
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        let body: TorBoxResponse<TorBoxUploadResponse> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse createtorrent response: {}", e))?;

        if !body.success {
            return Err(body.detail.unwrap_or_else(|| "Failed to upload torrent".to_string()));
        }

        let data = body.data.ok_or("Empty response data")?;
        let id = data
            .torrent_id
            .map(|i| i.to_string())
            .ok_or("No torrent ID returned")?;

        Ok(id)
    }

    pub async fn get_status(apikey: &str, id: &str) -> Result<DebridStatusResult, String> {
        let client = reqwest::Client::new();
        let resp = client
            .get("https://api.torbox.app/v1/api/torrents/mylist?bypass=true")
            .header("Authorization", format!("Bearer {}", apikey))
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        let body: TorBoxResponse<Vec<TorBoxTorrentList>> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse mylist response: {}", e))?;

        if !body.success {
            return Err(body.detail.unwrap_or_else(|| "Failed to fetch status list".to_string()));
        }

        let list = body.data.ok_or("Empty list returned")?;
        let numeric_id = id.parse::<u64>().map_err(|_| "Invalid TorBox ID")?;
        let item = list.iter().find(|t| t.id == numeric_id).ok_or("Torrent not found on TorBox")?;

        let status = if item.download_finished && item.download_present {
            "ready".to_string()
        } else if item.active {
            "downloading".to_string()
        } else {
            "queued".to_string()
        };

        // TorBox download link requires request to /zip
        let mut links = Vec::new();
        if status == "ready" {
            // Request direct zip link or list file links.
            // For simplicity, we can fetch the Zip Download URL:
            let zip_resp = client
                .get(format!("https://api.torbox.app/v1/api/torrents/requestdl?torrent_id={}&zip=true", numeric_id))
                .header("Authorization", format!("Bearer {}", apikey))
                .send()
                .await;
            if let Ok(zr) = zip_resp {
                if let Ok(b) = zr.json::<TorBoxResponse<TorBoxZipResponse>>().await {
                    if let Some(d) = b.data {
                        links.push(d.zip_link);
                    }
                }
            }
        }

        Ok(DebridStatusResult {
            id: id.to_string(),
            progress: item.progress * 100.0,
            status,
            links,
            error_message: None,
        })
    }

    fn extract_hash(magnet: &str) -> String {
        // Find exact topic xt=urn:btih:
        if let Some(pos) = magnet.find("xt=urn:btih:") {
            let start = pos + "xt=urn:btih:".len();
            let end = magnet[start..].find('&').map(|idx| start + idx).unwrap_or(magnet.len());
            return magnet[start..end].to_uppercase();
        }
        "".to_string()
    }
}
