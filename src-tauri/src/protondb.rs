//! ProtonDB community Linux / Steam Deck compatibility summary.
//!
//! Fetches the public report summary for a Steam appid from
//! `https://www.protondb.com/api/v1/reports/summaries/{appid}.json`.
//!
//! The endpoint returns `404` (with a Netlify HTML error page, no JSON
//! body) when a game has no reports at all — we treat that as a valid
//! `found: false` result rather than an error so the frontend can simply
//! hide the card. The official tier may be `"pending"` when there are too
//! few reports for a verdict; in that case the `provisional_tier` holds
//! the best estimate.
//!
//! Fetched server-side (Tauri command) rather than from the browser
//! because ProtonDB only sends `Access-Control-Allow-Origin:
//! https://www.protondb.com`, which would block a browser `fetch` from
//! the app's origin.

use serde::{Deserialize, Serialize};

/// Parsed ProtonDB summary.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProtonDBStatus {
    /// Whether a summary was found (false on a 404 / no reports).
    pub found: bool,
    /// Official rating tier. One of: "platinum" | "gold" | "silver" |
    /// "bronze" | "borked" | "pending".
    pub tier: String,
    /// Tier estimate used while `tier` is "pending".
    #[serde(default)]
    pub provisional_tier: Option<String>,
    /// Highest tier anyone reported (optimistic).
    #[serde(default)]
    pub best_reported_tier: Option<String>,
    /// Recent reports' tier — differs from `tier` on regression / fix.
    #[serde(default)]
    pub trending_tier: Option<String>,
    /// Confidence in the tier verdict.
    #[serde(default)]
    pub confidence: Option<String>,
    /// Compatibility score in the range 0..1.
    #[serde(default)]
    pub score: Option<f64>,
    /// Total number of community reports.
    #[serde(default)]
    pub total: Option<u32>,
}

/// Raw shape of the ProtonDB summary JSON (only the fields we use).
#[derive(Debug, Deserialize)]
struct ProtonDbSummary {
    #[serde(default)]
    tier: String,
    #[serde(default)]
    provisional_tier: Option<String>,
    #[serde(default)]
    best_reported_tier: Option<String>,
    #[serde(default)]
    trending_tier: Option<String>,
    #[serde(default)]
    confidence: Option<String>,
    #[serde(default)]
    score: Option<f64>,
    #[serde(default)]
    total: Option<u32>,
}

/// Fetch the ProtonDB summary for a Steam `app_id`.
///
/// Returns `found: false` when the app has no reports (HTTP 404) or when
/// the appid is invalid. Network/parse failures propagate as errors so
/// the frontend can hide the card and avoid a broken state.
#[tauri::command]
pub async fn fetch_protondb_status(app_id: u32) -> Result<ProtonDBStatus, String> {
    let url = format!(
        "https://www.protondb.com/api/v1/reports/summaries/{}.json",
        app_id
    );

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::USER_AGENT, "Gamelib/1.0")
        .send()
        .await
        .map_err(|e| format!("ProtonDB request failed: {}", e))?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(ProtonDBStatus {
            found: false,
            tier: "pending".into(),
            provisional_tier: None,
            best_reported_tier: None,
            trending_tier: None,
            confidence: None,
            score: None,
            total: None,
        });
    }

    if !resp.status().is_success() {
        return Err(format!("ProtonDB responded {}", resp.status()));
    }

    let summary: ProtonDbSummary = resp
        .json()
        .await
        .map_err(|e| format!("ProtonDB parse failed: {}", e))?;

    let tier = if summary.tier.is_empty() {
        "pending".to_string()
    } else {
        summary.tier
    };

    Ok(ProtonDBStatus {
        found: true,
        tier,
        provisional_tier: summary.provisional_tier,
        best_reported_tier: summary.best_reported_tier,
        trending_tier: summary.trending_tier,
        confidence: summary.confidence,
        score: summary.score,
        total: summary.total,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_protondb_cs2() {
        let result = fetch_protondb_status(730).await.unwrap();
        assert!(result.found);
        assert!(!result.tier.is_empty());
    }
}
