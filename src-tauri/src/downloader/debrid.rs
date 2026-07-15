use reqwest::Method;
use serde::{Deserialize, Serialize};

// ─── Shared response types (consumed by mod.rs) ──────────────────────────────

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
//
// AllDebrid migrated to `Authorization: Bearer <apikey>` headers and POST-form
// requests in late 2024 / early 2025 (the old `?agent=gamelib&apikey=…` query
// approach now returns `404 Endpoint doesn't exist`). Endpoints used here:
// - GET  /v4/user                 → user info
// - POST /v4/magnet/upload        → upload & instant-cache check (instant flag)
// - POST /v4/magnet/delete        → cleanup when an instant check isn't cached
// - POST /v4.1/magnet/status      → progress / ready status
// - POST /v4/magnet/files         → per-file download links (moved out of status)
//
// Live docs: https://docs.alldebrid.com/

pub struct AllDebridClient;

#[derive(Deserialize, Debug)]
struct AllDebridResponse<T> {
    status: String,
    data: Option<T>,
    error: Option<AllDebridError>,
}

#[derive(Deserialize, Debug)]
struct AllDebridError {
    /// AllDebrid error code (e.g. `"AUTH_BAD_API_KEY"`). Reserved in
    /// the deserialised struct so future structured handling in
    /// `ad_err` keeps the discriminator around. Today only `message`
    /// is read.
    #[allow(dead_code)]
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
    #[serde(default, rename = "isPremium")]
    is_premium: bool,
    #[serde(default, rename = "premiumUntil")]
    premium_until: u64,
}

#[derive(Deserialize, Debug)]
struct AllDebridUploadResponse {
    magnets: Vec<AllDebridMagnetUpload>,
}

#[derive(Deserialize, Debug)]
struct AllDebridMagnetUpload {
    id: u64,
    /// `instant` is true when the magnet can be served immediately from the
    /// AllDebrid cache; false means it has to be downloaded by their servers.
    #[serde(default)]
    instant: bool,
}

#[derive(Deserialize, Debug)]
struct AllDebridStatusResponse {
    magnets: Vec<AllDebridMagnetStatus>,
}

#[derive(Deserialize, Debug)]
struct AllDebridMagnetStatus {
    #[serde(default)]
    size: u64,
    #[serde(default, rename = "statusCode")]
    status_code: u8,
    #[serde(default, rename = "statusCodeDescription")]
    status_code_description: String,
    #[serde(default)]
    downloaded: u64,
    /// `links` may be empty (or missing) under /v4.1/magnet/status — the API
    /// moved file-level information to the dedicated /v4/magnet/files endpoint.
    #[serde(default)]
    links: Vec<AllDebridLink>,
}

#[derive(Deserialize, Debug)]
struct AllDebridFilesResponse {
    magnets: Vec<AllDebridFilesEntry>,
}

#[derive(Deserialize, Debug)]
struct AllDebridFilesEntry {
    #[serde(default)]
    links: Vec<AllDebridLink>,
}

#[derive(Deserialize, Debug)]
struct AllDebridLink {
    link: String,
}

/// Send a request to api.alldebrid.com with the standard Bearer auth header.
/// `form` selects POST form-encoded parameters (used by every magnet endpoint).
async fn ad_request(
    client: &reqwest::Client,
    method: Method,
    path: &str,
    apikey: &str,
    form: Option<&[(&str, &str)]>,
) -> Result<reqwest::Response, String> {
    let url = format!("https://api.alldebrid.com{}", path);
    let mut req = client
        .request(method, &url)
        .header("Authorization", format!("Bearer {}", apikey));
    if let Some(params) = form {
        req = req.form(params);
    }
    req.send()
        .await
        .map_err(|e| format!("Request failed: {}", e))
}

fn ad_err<T>(body: AllDebridResponse<T>) -> String {
    body.error
        .map(|e| e.message)
        .unwrap_or_else(|| "Unknown AllDebrid error".to_string())
}

impl AllDebridClient {
    pub async fn test_key(apikey: &str) -> Result<DebridUserInfo, String> {
        let client = reqwest::Client::new();
        let resp = ad_request(&client, Method::GET, "/v4/user", apikey, None).await?;
        let status = resp.status();
        let body: AllDebridResponse<AllDebridUserResponse> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse user info response: {}", e))?;

        if !status.is_success() || body.status != "success" {
            return Err(ad_err(body));
        }

        let data = body.data.ok_or_else(|| "Empty response data".to_string())?;
        // premiumUntil is documented as 0 for non-premium accounts. Treat 0 as
        // "no expiry" so the UI doesn't surface a meaningless epoch timestamp.
        let premium_until = if data.user.is_premium && data.user.premium_until > 0 {
            Some(data.user.premium_until)
        } else {
            None
        };
        Ok(DebridUserInfo {
            username: data.user.username,
            premium_until,
        })
    }

    pub async fn check_cache(apikey: &str, magnet: &str) -> Result<DebridCacheResult, String> {
        // AllDebrid doesn't expose a dedicated cache-check endpoint. The cleanest
        // approach is to upload the magnet and inspect the returned `instant`
        // flag. We then delete the magnet on AllDebrid's side when it isn't
        // cached so we don't leave behind a stranded, queued download.
        let client = reqwest::Client::new();
        let resp = ad_request(
            &client,
            Method::POST,
            "/v4/magnet/upload",
            apikey,
            Some(&[("magnets[]", magnet)]),
        )
        .await?;
        let status = resp.status();
        let body: AllDebridResponse<AllDebridUploadResponse> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse magnet upload response: {}", e))?;

        if !status.is_success() || body.status != "success" {
            return Err(ad_err(body));
        }

        let data = body.data.ok_or_else(|| "Empty response data".to_string())?;
        let mag = data
            .magnets
            .first()
            .ok_or_else(|| "No magnet entry returned by AllDebrid".to_string())?;
        let instant = mag.instant;

        // Best-effort cleanup. `check_cache` is a query — we don't want to
        // leave the magnet registered on the user's AllDebrid account, whether
        // or not it ended up being cached. Errors here don't affect the cache
        // verdict we return to the caller.
        let id_str = mag.id.to_string();
        let _ = ad_request(
            &client,
            Method::POST,
            "/v4/magnet/delete",
            apikey,
            Some(&[("id[]", id_str.as_str())]),
        )
        .await;

        Ok(DebridCacheResult {
            instant,
            provider: "alldebrid".to_string(),
        })
    }

    pub async fn upload_magnet(apikey: &str, magnet: &str) -> Result<String, String> {
        let client = reqwest::Client::new();
        let resp = ad_request(
            &client,
            Method::POST,
            "/v4/magnet/upload",
            apikey,
            Some(&[("magnets[]", magnet)]),
        )
        .await?;
        let status = resp.status();
        let body: AllDebridResponse<AllDebridUploadResponse> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse upload response: {}", e))?;

        if !status.is_success() || body.status != "success" {
            return Err(ad_err(body));
        }

        let data = body.data.ok_or_else(|| "Empty response data".to_string())?;
        let mag = data
            .magnets
            .first()
            .ok_or_else(|| "No magnet entry returned by AllDebrid".to_string())?;
        Ok(mag.id.to_string())
    }

    pub async fn get_status(apikey: &str, id: &str) -> Result<DebridStatusResult, String> {
        let client = reqwest::Client::new();
        let id_str = id.to_string();
        let resp = ad_request(
            &client,
            Method::POST,
            "/v4.1/magnet/status",
            apikey,
            Some(&[("id[]", id_str.as_str())]),
        )
        .await?;
        let status = resp.status();
        let body: AllDebridResponse<AllDebridStatusResponse> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse status response: {}", e))?;

        if !status.is_success() || body.status != "success" {
            return Err(ad_err(body));
        }

        let data = body.data.ok_or_else(|| "Empty response data".to_string())?;
        let mag = data
            .magnets
            .into_iter()
            .next()
            .ok_or_else(|| "Magnet not found in status response".to_string())?;

        let normalized_status = match mag.status_code {
            4 => "ready".to_string(),       // Ready/cache complete
            0..=3 => "downloading".to_string(), // Queued → downloading
            _ => "error".to_string(),
        };

        let progress = if mag.size > 0 {
            (mag.downloaded as f32 / mag.size as f32) * 100.0
        } else {
            0.0
        };

        let mut links: Vec<String> = mag.links.into_iter().map(|l| l.link).collect();

        // /v4.1/magnet/status no longer embeds the file list inline; fetch it
        // from the dedicated files endpoint once the transfer is ready.
        if normalized_status == "ready" && links.is_empty() {
            if let Ok(files_resp) = ad_request(
                &client,
                Method::POST,
                "/v4/magnet/files",
                apikey,
                Some(&[("id[]", id_str.as_str())]),
            )
            .await
            {
                if let Ok(parsed) = files_resp
                    .json::<AllDebridResponse<AllDebridFilesResponse>>()
                    .await
                {
                    if let Some(payload) = parsed.data {
                        for entry in payload.magnets {
                            for link in entry.links {
                                links.push(link.link);
                            }
                        }
                    }
                }
            }
        }

        let error_message = if mag.status_code > 4 {
            Some(if mag.status_code_description.is_empty() {
                format!("AllDebrid error code {}", mag.status_code)
            } else {
                mag.status_code_description
            })
        } else {
            None
        };

        Ok(DebridStatusResult {
            id: id.to_string(),
            progress,
            status: normalized_status,
            links,
            error_message,
        })
    }

    pub async fn unrestrict_link(apikey: &str, url: &str) -> Result<String, String> {
        let client = reqwest::Client::new();
        let resp = ad_request(
            &client,
            Method::POST,
            "/v4/link/unlock",
            apikey,
            Some(&[("link", url)]),
        )
        .await?;
        
        let status = resp.status();
        let body: AllDebridResponse<AllDebridUnlockData> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse AllDebrid unlock response: {}", e))?;

        if !status.is_success() || body.status != "success" {
            return Err(ad_err(body));
        }

        let data = body.data.ok_or_else(|| "Empty response data".to_string())?;
        Ok(data.link)
    }
}

#[derive(Deserialize, Debug)]
struct AllDebridUnlockData {
    link: String,
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
}

#[derive(Deserialize, Debug)]
struct TorBoxInstantResponse {
    cached: bool,
}

#[derive(Deserialize, Debug)]
struct TorBoxTorrentList {
    id: u64,
    progress: f32,
    download_finished: bool,
    download_present: bool,
    active: bool,
}

/// Per-file detail for a TorBox torrent. Documented by the API
/// but unused today: `get_status` collapses downloads to the
/// `/zip` aggregate link, so neither the struct nor any of its
/// fields are read. Kept on stand-by for the per-file unlock
/// path that would supersede the zip fallback.
#[derive(Deserialize, Debug)]
#[allow(dead_code)]
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

    /// "Unrestrict" a web download link via TorBox.
    ///
    /// TorBox does not have an `/unrestrict/link` endpoint (that was a
    /// wrong assumption from the AllDebrid API shape). The correct flow
    /// for turning a hoster URL into a TorBox direct-download URL is:
    ///
    ///   1. `POST /v1/api/webdl/createwebdownload` — submit the link.
    ///      Returns a `webdl_id` (the TorBox-internal download job).
    ///   2. `GET  /v1/api/webdl/mylist` — poll until the job is ready.
    ///   3. `GET  /v1/api/webdl/requestdl?webid={id}` — get the direct
    ///      download URL.
    ///
    /// For the unrestrict use case (the frontend calls this right before
    /// handing the URL to the direct downloader), we need the *final*
    /// direct link. We create the web download, poll until it's ready,
    /// then request the direct link. This can take a few seconds if
    /// TorBox's servers need to fetch the file from the hoster.
    pub async fn unrestrict_link(apikey: &str, url: &str) -> Result<String, String> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

        // 1. Create the web download.
        let create_payload = serde_json::json!({
            "link": url,
        });
        let create_resp = client
            .post("https://api.torbox.app/v1/api/webdl/createwebdownload")
            .header("Authorization", format!("Bearer {}", apikey))
            .json(&create_payload)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?
            .json::<TorBoxResponse<TorBoxWebDlCreateData>>()
            .await
            .map_err(|e| format!("Failed to parse createwebdownload response: {}", e))?;
        if !create_resp.success {
            return Err(create_resp.detail.unwrap_or_else(|| {
                "Failed to create TorBox web download".to_string()
            }));
        }
        let webdl_id: u64 = create_resp
            .data
            .ok_or("No data returned from createwebdownload")?
            .webdl_id
            .ok_or("No webdl_id returned from createwebdownload")?;

        // 2. Poll until the web download is ready (up to 60s).
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(2));
        let mut ready = false;
        for _ in 0..30 {
            interval.tick().await;
            let list_resp = client
                .get("https://api.torbox.app/v1/api/webdl/mylist?bypass=true")
                .header("Authorization", format!("Bearer {}", apikey))
                .send()
                .await
                .map_err(|e| format!("Failed to poll webdl list: {}", e))?;
            let body: TorBoxResponse<Vec<TorBoxWebDlListEntry>> =
                list_resp.json().await.map_err(|e| {
                    format!("Failed to parse webdl mylist response: {}", e)
                })?;
            if let Some(entries) = body.data {
                if let Some(entry) = entries.iter().find(|e| e.id == webdl_id) {
                    if entry.download_finished && entry.download_present {
                        ready = true;
                        break;
                    }
                    if let Some(ref err) = entry.error {
                        return Err(format!("TorBox web download failed: {}", err));
                    }
                }
            }
        }
        if !ready {
            return Err("TorBox web download timed out (60s)".to_string());
        }

        // 3. Request the direct download link.
        //
        // TorBox's `requestdl` endpoint uses `web_id` (not `webid`) as
        // the query parameter. There is no `as_url` parameter — the
        // API returns a JSON object with the download link in the
        // `data` field. The `redirect=true` parameter would cause an
        // HTTP redirect instead of a JSON response, which we don't
        // want here (we need the URL as a string to pass to the
        // direct downloader).
        let dl_resp = client
            .get(format!(
                "https://api.torbox.app/v1/api/webdl/requestdl?web_id={}",
                webdl_id
            ))
            .header("Authorization", format!("Bearer {}", apikey))
            .send()
            .await
            .map_err(|e| format!("Failed to request webdl download link: {}", e))?;
        let dl_body: TorBoxResponse<TorBoxWebDlLinkData> = dl_resp.json().await.map_err(|e| {
            format!("Failed to parse webdl requestdl response: {}", e)
        })?;
        if !dl_body.success {
            return Err(dl_body.detail.unwrap_or_else(|| {
                "Failed to get direct download link from TorBox".to_string()
            }));
        }
        dl_body
            .data
            .and_then(|d| d.download_link)
            .ok_or_else(|| "No direct link returned by TorBox".to_string())
    }
}

/// Response from `POST /v1/api/webdl/createwebdownload`.
/// `webdl_id` is the primary field name, but we add `alias = "id"`
/// as a safety net in case TorBox returns the download ID under a
/// different key.
#[derive(Deserialize, Debug)]
struct TorBoxWebDlCreateData {
    #[serde(default, alias = "id")]
    webdl_id: Option<u64>,
}

/// Entry in the `GET /v1/api/webdl/mylist` response array.
/// `#[serde(default)]` on the bool fields guards against TorBox
/// returning a pending entry before those fields are populated —
/// without it the entire `mylist` response would fail to deserialize
/// and kill the poll loop.
#[derive(Deserialize, Debug)]
struct TorBoxWebDlListEntry {
    id: u64,
    #[serde(default)]
    download_finished: bool,
    #[serde(default)]
    download_present: bool,
    #[serde(default)]
    error: Option<String>,
}

/// Response from `GET /v1/api/webdl/requestdl`.
///
/// TorBox returns the direct-download link in the `data` field as an
/// object with a `download_link` key. We use `#[serde(alias)]` to
/// also accept `link` in case TorBox's response shape varies across
/// API versions.
#[derive(Deserialize, Debug)]
struct TorBoxWebDlLinkData {
    #[serde(default, alias = "link")]
    download_link: Option<String>,
}
