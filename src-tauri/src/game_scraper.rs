use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Data Types ───────────────────────────────────────────────────────────────

/// Represents a collection of game images (URLs) from a metadata source.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GameImages {
    /// Small square icon (e.g., 32x32 or similar)
    pub icon: Option<String>,
    /// Vertical cover art / box art (e.g., 600x900)
    pub cover: Option<String>,
    /// Hero image / header (e.g., 460x215)
    pub hero: Option<String>,
    /// Wide banner (e.g., 1920x620)
    pub banner: Option<String>,
    /// Game logo / title image (transparent PNG)
    pub logo: Option<String>,
}

/// A unified metadata result from a single source.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GameMetadataResult {
    /// Display title of the game
    pub title: String,
    /// Short description or summary
    pub description: Option<String>,
    /// Developer name(s)
    pub developer: Option<String>,
    /// Publisher name(s)
    pub publisher: Option<String>,
    /// Human-readable release date (e.g., "Oct 20, 2020")
    pub release_date: Option<String>,
    /// Genre tags
    pub genres: Vec<String>,
    /// Image URLs discovered for this game
    pub images: GameImages,
    /// URL of the source page
    pub source_url: String,
    /// Human-readable source name (e.g., "Steam", "IGDB")
    pub source_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storyline: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub igdb_rating: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub critic_rating: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub themes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_modes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub player_perspectives: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub screenshots: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub videos: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub websites: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_to_beat: Option<TimeToBeat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub similar_games: Option<Vec<SimilarGame>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub releases: Option<Vec<ReleaseDateInfo>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub igdb_reviews: Option<Vec<IgdbReview>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alternative_names: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collection: Option<String>,
    /// IGDB collection ID for the first collection this game belongs
    /// to. Used by the frontend Game Relations card to fetch
    /// "other games in this collection" via the dedicated
    /// `get_collection_games` Tauri command.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collection_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub franchise: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub game_category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language_supports: Option<Vec<LanguageSupportInfo>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TimeToBeat {
    /// Seconds spent rushing through the game (IGDB "hastily" field).
    /// The legacy `hastly` typo is accepted as an alias for backward
    /// compatibility with games.json saved before the fix.
    #[serde(alias = "hastly")]
    pub hastily: Option<u64>,
    pub normally: Option<u64>,
    pub completely: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SimilarGame {
    pub id: u64,
    pub name: String,
    pub cover_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseDateInfo {
    pub platform: String,
    pub date_str: String,
    pub region: String,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IgdbReview {
    pub title: Option<String>,
    pub content: Option<String>,
    pub rating: Option<f64>,
    pub username: Option<String>,
    /// ISO 639-1 language code (e.g. "english", "french") from Steam API.
    /// None for IGDB-sourced reviews (endpoint no longer available).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    /// Number of users who found this review helpful (Steam API).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub votes_up: Option<u32>,
    /// Number of users who found this review funny (Steam API).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub votes_funny: Option<u32>,
    /// Unix timestamp when this review was created (Steam API).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp_created: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LanguageSupportInfo {
    pub language: String,
    pub support_type: String,
}

// ─── System Requirements (Steam `pc_requirements`) ──────────────────────────

/// Structured system requirements, parsed from Steam's variable
/// HTML `pc_requirements.minimum` / `pc_requirements.recommended`
/// payload. Steam's markup is wildly inconsistent across titles
/// (some use `<ul><li><strong>OS:</strong> Windows…</li>`, others
/// use plain text with `<br>` separators), so we extract a
/// canonical field set instead of round-tripping the raw HTML.
///
/// Every field is `Option<String>` — Steam frequently omits one
/// or more sections (e.g. Mac-only games have no Windows spec,
/// older indie titles skip VR Support, etc.). The frontend
/// silently drops empty rows so the card never has meaningless
/// `—` entries.
///
/// The known label set covers the entire Steam taxonomy:
///   - os                Windows / macOS / SteamOS + Linux
///   - processor         CPU requirement
///   - memory            RAM requirement
///   - graphics          GPU requirement
///   - directX           DirectX version
///   - network           online play requirement
///   - storage           disk footprint requirement
///   - soundCard         sound card / audio requirement
///   - vrSupport         VR headset + controller requirement
///   - additionalNotes   "Requires X controller", "64-bit only",
///                       "SSD recommended", etc.
#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RequirementsSpec {
    pub os: Option<String>,
    pub processor: Option<String>,
    pub memory: Option<String>,
    pub graphics: Option<String>,
    pub direct_x: Option<String>,
    pub network: Option<String>,
    pub storage: Option<String>,
    pub sound_card: Option<String>,
    pub vr_support: Option<String>,
    pub additional_notes: Option<String>,
}

impl RequirementsSpec {
    /// True when *no* field carries a value. The frontend uses
    /// this to decide whether to render the section at all (vs.
    /// hiding silently when Steam returned garbage).
    pub fn is_empty(&self) -> bool {
        self.os.is_none()
            && self.processor.is_none()
            && self.memory.is_none()
            && self.graphics.is_none()
            && self.direct_x.is_none()
            && self.network.is_none()
            && self.storage.is_none()
            && self.sound_card.is_none()
            && self.vr_support.is_none()
            && self.additional_notes.is_none()
    }
}

/// Combined system-requirements payload returned by the
/// `get_recommended_config` Tauri command. Mirrors the
/// `RichAboutPayload` shape so the frontend has a single
/// familiar contract to consume (source attribution + raw HTML
/// fallback + structured fields).
///
/// `minimum` and `recommended` are both `Option<…>` because Steam
/// occasionally omits the `recommended` block entirely (e.g.
/// older indie titles); when missing, the frontend falls back to
/// showing only the `minimum` column rather than rendering an
/// empty right-hand side.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PcRequirementsPayload {
    /// `"steam" | "none"`. We don't ship an IGDB fallback for
    /// system requirements — IGDB doesn't expose them at all,
    /// and Steam's coverage is essentially universal (every PC
    /// title on the store has `pc_requirements`). `none` means
    /// the section should hide entirely.
    pub source: String,
    /// Deep-link to the Steam app page so the "View on Steam"
    /// footer link in the card has a stable target.
    pub source_url: Option<String>,
    /// Human-readable source name ("Steam").
    pub source_name: Option<String>,
    /// Parsed minimum spec (the lower bar to launch the game).
    pub minimum: Option<RequirementsSpec>,
    /// Parsed recommended spec (the bar for a smooth experience).
    /// `None` when Steam didn't ship one — see the type-level
    /// doc comment for the fallback strategy.
    pub recommended: Option<RequirementsSpec>,
    /// Raw Steam `pc_requirements.minimum` HTML, preserved as a
    /// last-resort fallback for any spec the parser missed
    /// (unrecognised label → freeform paragraph). Frontend
    /// renders this through the same HTML sanitiser the
    /// AboutSection uses when `additional_notes` is empty after
    /// parsing.
    pub minimum_html: Option<String>,
    /// Raw Steam `pc_requirements.recommended` HTML fallback.
    pub recommended_html: Option<String>,
    /// Unix-seconds timestamp of the last successful fetch.
    /// Mirrors `RichAboutPayload.fetchedAt` for consistency.
    pub fetched_at: u64,
}

// ─── Store Types (IGDB catalog browsing) ─────────────────────────────────────

/// Lightweight game summary for store listings (cards, grids).

/// Lightweight game summary for store listings (cards, grids).
/// Contains only what's needed for display — no full metadata.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoreGameSummary {
    pub id: u64,
    pub name: String,
    pub slug: String,
    pub summary: Option<String>,
    pub rating: Option<f64>,
    pub aggregated_rating: Option<f64>,
    pub cover_url: Option<String>,
    pub genres: Vec<String>,
    pub platforms: Vec<String>,
    pub first_release_date: Option<String>,
    pub total_rating_count: u64,
    pub hypes: u64,
    /// External URLs associated with the title on IGDB (Steam store page,
    /// Epic, official site, etc.). Populated for the store hero so it
    /// can render the live Steam concurrent-player badge on rotating
    /// IGDB listings without an extra round-trip per slide change.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub websites: Option<Vec<String>>,
}

/// Internal IGDB deserialization type for store game listings.
#[derive(Debug, Deserialize)]
struct IgdbGameSummary {
    id: u64,
    name: String,
    slug: String,
    summary: Option<String>,
    rating: Option<f64>,
    aggregated_rating: Option<f64>,
    cover: Option<IgdbCover>,
    genres: Option<Vec<IgdbName>>,
    platforms: Option<Vec<IgdbName>>,
    first_release_date: Option<i64>,
    total_rating_count: Option<u64>,
    hypes: Option<u64>,
    /// `websites.url` field shipped from the IGDB Apicalypse body.
    /// We only care about the URL string (the `category` enum is
    /// discarded — Steam fronts are the only category we act on,
    /// and we identify them by URL pattern, not enum value).
    #[serde(default)]
    websites: Option<Vec<IgdbWebsite>>,
}

// ─── Steam API Types (internal) ───────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct SteamSearchResponse {
    items: Vec<SteamSearchItem>,
}

#[derive(Debug, Deserialize)]
struct SteamSearchItem {
    id: u64,
    name: String,
    #[serde(default)]
    tiny_image: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SteamAppDetailResponse {
    #[serde(flatten)]
    apps: HashMap<String, SteamAppDetailWrapper>,
}

#[derive(Debug, Deserialize)]
struct SteamAppDetailWrapper {
    success: bool,
    data: Option<SteamAppDetail>,
}

#[derive(Debug, Deserialize)]
struct SteamAppDetail {
    #[allow(dead_code)]
    name: Option<String>,
    short_description: Option<String>,
    /// Rich "About this game" body the Steam store displays under
    /// the capsule image. Rendered as HTML with embedded `<img>` tags
    /// (pointing at Steam CDN URLs) that act as inline GIFs/images.
    /// Used by the frontend AboutSection for true fidelity — the
    /// plain-text `short_description` is just a teaser.
    #[serde(default)]
    about_the_game: Option<String>,
    /// Steam store "movies" (trailers + gameplay clips). Both `.webm`
    /// and `.mp4` URLs are surfaced per resolution slot; the
    /// frontend `<video>` element picks the best one based on
    /// browser support.
    #[serde(default)]
    movies: Vec<SteamMovie>,
    #[serde(default)]
    developers: Vec<String>,
    #[serde(default)]
    publishers: Vec<String>,
    release_date: Option<SteamReleaseDate>,
    #[serde(default)]
    genres: Vec<SteamGenre>,
    header_image: Option<String>,
    capsule_image: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SteamReleaseDate {
    date: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SteamGenre {
    description: Option<String>,
}

/// Raw movie entry from the Steam `appdetails` endpoint. We expose
/// the four resolution slots (`webm.max`, `webm.full`, `mp4.max`,
/// `mp4.full`) plus `thumbnail` (a JPG poster) and `highlight`
/// (Steam's flagged "main trailer" bit). The frontend uses the
/// thumbnail as `<video poster>` so movies render beautifully
/// while paused.
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SteamMovie {
    #[serde(default)]
    id: u32,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    thumbnail: Option<String>,
    #[serde(default)]
    highlight: bool,
    #[serde(default)]
    webm: Option<SteamMovieVariant>,
    #[serde(default)]
    mp4: Option<SteamMovieVariant>,
}

#[derive(Debug, Deserialize, Clone)]
struct SteamMovieVariant {
    #[serde(default)]
    max: Option<String>,
    #[serde(default)]
    #[serde(rename = "480")]
    p480: Option<String>,
    #[serde(default)]
    full: Option<String>,
}

// ─── Base64 Encoding ─────────────────────────────────────────────────────────

/// Re-export of the base64 encoder shared with lib.rs.
/// This avoids code duplication.
// ─── Rich About Payload (Steam `about_the_game` + `movies[]`) ────────────────

/// A single trailer/gameplay clip sourced from the Steam store. The
/// frontend AboutSection renders a `<video>` tile per entry; `poster`
/// powers the static thumbnail while the browser picks the best
/// `<source>` based on the `kind` (application/vnd.apple.mpegurl /
/// video/webm vs video/mp4 — webm is preferred because Steam encodes
/// at a smaller size for the same perceived quality).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MovieEntry {
    pub id: u32,
    pub name: Option<String>,
    pub thumbnail: Option<String>,
    /// Best webm URL (max resolution when available, else 480p).
    pub webm: Option<String>,
    /// Best mp4 URL (max resolution when available, else 480p, else
    /// full). Webm is preferred on capable browsers; mp4 is the
    /// universal fallback (Safari, mobile, embedded WebView).
    pub mp4: Option<String>,
    pub highlight: bool,
}

/// The combined "About" payload returned by the `get_about_section`
/// Tauri command. Source priority is Steam-first (`source == "steam"`)
/// with IGDB as a graceful fallback (`source == "igdb"`) when:
///   1. The game has no Steam AppID, OR
///   2. Steam's `about_the_game` is empty AND no movies, OR
///   3. Steam's appdetails call failed.
///
/// `about_html` is rendered with `dangerouslySetInnerHTML` after
/// minimal client-side sanitization; it includes Steam CDN `<img>`
/// tags as inlined images/GIFs for the visual richness the user
/// asked for. `about_text` is the fallback for renderers that don't
/// accept raw HTML.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RichAboutPayload {
    /// `"steam" | "igdb" | "none"`. `none` signals "no data" — the
    /// frontend should hide the section OR fall back to its pre-
    /// existing `game.description` field as a last resort.
    pub source: String,
    /// Deep-link to the source page (Steam store / IGDB game).
    pub source_url: Option<String>,
    /// Human-readable source name ("Steam" / "IGDB").
    pub source_name: Option<String>,
    /// Raw HTML body (Steam "about_the_game"). Frontend sanitizes.
    pub about_html: Option<String>,
    /// Plain-text fallback (Steam short_description or IGDB summary).
    pub about_text: Option<String>,
    /// Trailers / gameplay videos from Steam `movies[]`. IGDB
    /// YouTube videos are intentionally not surfaced here — the
    /// existing `VideosSection` already handles YouTube embeds.
    pub movies: Vec<MovieEntry>,
    /// Unix-seconds timestamp of the last successful fetch. Drives
    /// the frontend "Updated {fetchedAt}" label.
    pub fetched_at: u64,
}

// Tiny per-appid TTL cache. Steam's `about_the_game` HTML changes at
// most every few weeks (store page edits, new patch notes), so a
// 6-hour TTL strikes a reasonable balance. We use a `OnceLock<Mutex>`
// for cheap cloning and zero per-fetch hashing; the entry count is
// bounded by the size of the user's Steam library, so there's no
// memory-growth concern.
//
// Cooldown of negative cache: a Steam failure (HTTP error / parse
// error) is NOT cached — we want the next click to have a fresh
// chance to succeed. Negative caching Steam errors would turn a
// single hiccup into a 6-hour outage.
static ABOUT_CACHE: OnceLock<Mutex<HashMap<u32, (Instant, RichAboutPayload)>>> = OnceLock::new();

/// Per-appid TTL cache for the system-requirements payload. Steam's
/// `pc_requirements` block is *extremely* stable (it's set once at
/// launch and only rarely bumped when a game ships a "we now need
/// 16 GB RAM" patch), so we cache for a longer 24h window than
/// `ABOUT_CACHE`. Same `OnceLock<Mutex>` pattern so concurrent
/// fetches across the library share the same in-memory store.
static REQUIREMENTS_CACHE: OnceLock<Mutex<HashMap<u32, (Instant, PcRequirementsPayload)>>> =
    OnceLock::new();

/// 24-hour TTL for cached system-requirements payloads. Steam
/// specs rarely change once a game is published; even when they
/// do (e.g. a "we now recommend 32 GB" update), the next visit
/// after 24h picks it up.
const REQUIREMENTS_CACHE_TTL: Duration = Duration::from_secs(24 * 60 * 60);

const ABOUT_CACHE_TTL: Duration = Duration::from_secs(6 * 60 * 60);
// ─── System Requirements Parser ────────────────────────────────────────────

/// Convert a Steam `pc_requirements.minimum` / `.recommended`
/// HTML blob into a line-oriented plain-text form suitable for
/// label extraction. Steam's pc_requirements block is shallow
/// markup — one of two common shapes:
///
///   1. `<ul class="bb_ul"><li><strong>OS:</strong> Windows…</li>
///        <li><strong>Processor:</strong> …</li>…</ul>`
///   2. `<strong>OS:</strong> Windows…<br><strong>Processor:</strong>
///        …<br>…`
///
/// Both shapes flatten to the same one-pair-per-line plain-text
/// representation under the rules below. We don't ship a full
/// HTML parser for this — it would add a multi-MB dependency for
/// a handful of HTML tags that Steam actually uses, and the
/// hand-written transform is easy to audit.
///
/// Transform rules (applied in order):
///   1. `<br>`, `<br/>`, `<br />`  → `\n`
///   2. `</li>`, `</p>`, `</div>` → `\n`
///   3. `</ul>`, `</ol>`          → `\n`
///   4. `<li …>`                  → `\n`
///   5. `</strong>`, `</b>`       → ` `   (label/value join space)
///   6. Any remaining `<…>` tag   → ` `   (insert a space so
///       `</strong>foo` doesn't fuse with the label word)
///   7. Decode the common HTML entities (`&amp;`, `&nbsp;`, `&lt;`,
///      `&gt;`, `&quot;`, `&#39;`) so the parsed values read cleanly.
fn requirements_html_to_text(html: &str) -> String {
    if html.is_empty() {
        return String::new();
    }
    let mut out = html.to_string();

    // 1. Block-level / line-break tags → newline. We iterate
    //    case-insensitively because some games ship `<BR>` in
    //    uppercase.
    for needle in ["<br>", "<br/>", "<br />", "<BR>", "<BR/>", "<BR />"] {
        out = out.replace(needle, "\n");
    }
    for needle in ["</li>", "</p>", "</div>", "</LI>", "</P>"] {
        out = out.replace(needle, "\n");
    }
    for needle in ["</ul>", "</ol>"] {
        out = out.replace(needle, "\n");
    }
    // 2. Drop the remaining inline tag pairs, leaving a space at
    //    the join so "label value" doesn't become "labelvalue".
    //    `replacen(n, 1)` is fine — we only ever have one pair
    //    per line in practice and the next pass strips the rest.
    for needle in ["</strong>", "</b>", "</em>", "</span>", "</font>"] {
        out = out.replace(needle, " ");
    }
    // Strip ALL remaining `<…>` tag fragments. We use a string-based
    // scanner rather than a regex to keep the dependency graph
    // tight — the spec block is small and we never hit this path
    // more than once per appdetails fetch. Iterating over `&str`
    // rather than `bytes` lets us handle multi-byte UTF-8
    // characters (Steam ships ™ and — in spec values) safely.
    let mut cleaned = String::with_capacity(out.len());
    let mut rest: &str = out.as_str();
    while !rest.is_empty() {
        match rest.find('<') {
            Some(start) => {
                // Copy everything before the `<` verbatim.
                cleaned.push_str(&rest[..start]);
                cleaned.push(' ');
                // Find the matching `>`.
                match rest[start..].find('>') {
                    Some(end) => rest = &rest[start + end + 1..],
                    None => {
                        // Unterminated tag — copy the rest verbatim so
                        // we don't silently truncate user data.
                        cleaned.push_str(&rest[start..]);
                        break;
                    }
                }
            }
            None => {
                cleaned.push_str(rest);
                break;
            }
        }
    }
    out = cleaned;

    // 3. Common HTML entities. We keep this short — pc_requirements
    //    in practice uses `&amp;` heavily (Radeon™ RX 580 & Co.).
    out = out
        .replace("&amp;", "&")
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'");

    // 4. Collapse runs of whitespace within each line, trim edges,
    //    and drop empty lines.
    let mut cleaned = String::with_capacity(out.len());
    for line in out.split('\n') {
        let mut last_space = true;
        let mut current = String::new();
        for ch in line.chars() {
            if ch.is_whitespace() {
                if !last_space {
                    current.push(' ');
                    last_space = true;
                }
            } else {
                current.push(ch);
                last_space = false;
            }
        }
        let trimmed = current.trim();
        if !trimmed.is_empty() {
            cleaned.push_str(trimmed);
            cleaned.push('\n');
        }
    }
    cleaned
}

/// Canonical label table for `parse_requirements_text`. Each
/// entry is `(target_field, lowercase_label)`. The longest
/// labels must come first so the prefix matcher doesn't snap
/// "VR Support" to "VR" + leftover.
const REQUIREMENT_LABELS: &[(&str, &str)] = &[
    ("os", "os"),
    ("processor", "processor"),
    ("memory", "memory"),
    ("graphics", "graphics"),
    ("directX", "directx"),
    ("network", "network"),
    ("storage", "storage"),
    ("soundCard", "sound card"),
    ("vrSupport", "vr support"),
    ("vrSupport", "vr headset"),
    ("additionalNotes", "additional notes"),
    ("additionalNotes", "notes"),
];

/// Resolve a single canonical field name to the slot on a
/// `RequirementsSpec`. Keeping this in one place makes it
/// trivial to audit that every `REQUIREMENT_LABELS` entry has
/// a corresponding destination slot.
fn spec_slot<'a>(spec: &'a mut RequirementsSpec, field: &str) -> Option<&'a mut Option<String>> {
    match field {
        "os" => Some(&mut spec.os),
        "processor" => Some(&mut spec.processor),
        "memory" => Some(&mut spec.memory),
        "graphics" => Some(&mut spec.graphics),
        "directX" => Some(&mut spec.direct_x),
        "network" => Some(&mut spec.network),
        "storage" => Some(&mut spec.storage),
        "soundCard" => Some(&mut spec.sound_card),
        "vrSupport" => Some(&mut spec.vr_support),
        "additionalNotes" => Some(&mut spec.additional_notes),
        _ => None,
    }
}

/// True when the first character of `line` past `label_len`
/// matches our "label boundary" rule (whitespace, colon, or
/// end-of-line). This prevents "osm" from accidentally matching
/// the "OS" label and the equivalent for every other label.
fn is_label_boundary(rest: &str) -> bool {
    match rest.chars().next() {
        None => true,
        Some(c) => c.is_whitespace() || c == ':' || c == '\t',
    }
}

/// Parse the line-oriented text produced by
/// `requirements_html_to_text` into a `RequirementsSpec`.
///
/// We scan the text once, looking for the known label set
/// (see `REQUIREMENT_LABELS`). For each match we capture the
/// rest of the line as the value, then continue with the next
/// line. The parser is tolerant to:
///
///   - Trailing colons (`OS: Windows`) or no colon (`OS Windows`)
///   - Case-insensitive label matching (we lowercase the input)
///   - Whitespace between the label and the colon
///   - Multi-word labels (`Sound Card`, `VR Support`)
///
/// Unknown labels are silently dropped so a publisher writing
/// "Controller: Gamepad required" doesn't leak into the wrong
/// field. If a label appears multiple times, the *longest* value
/// wins (Steam sometimes appends a redundant footnote to the
/// minimum spec).
fn parse_requirements_text(text: &str) -> RequirementsSpec {
    let mut spec = RequirementsSpec::default();
    let lower = text.to_lowercase();

    for raw_line in lower.lines() {
        let line = raw_line.trim_start();
        for (field, label) in REQUIREMENT_LABELS {
            // Longest labels must come first so we don't snap
            // "sound card" to "sound" + leftover. We still guard
            // with `is_label_boundary` so a partial prefix like
            // "memoryx" doesn't match "memory".
            // `label` is `&&str` from the slice iteration; deref to
            // `&str` directly rather than calling `.as_str()` (which
            // is the unstable `str_as_str` feature) so we stay on
            // stable Rust.
            if line.len() <= label.len() || !line.starts_with(*label) {
                continue;
            }
            if !is_label_boundary(&line[label.len()..]) {
                continue;
            }
            let value = line[label.len()..]
                .trim_start_matches(|c: char| c == ':' || c.is_whitespace())
                .to_string();
            if value.is_empty() {
                break;
            }
            if let Some(slot) = spec_slot(&mut spec, field) {
                let dominated = slot.as_ref().is_some_and(|existing| existing.len() >= value.len());
                if !dominated {
                    *slot = Some(value);
                }
            }
            break;
        }
    }

    spec
}

/// Public convenience wrapper: takes the raw Steam HTML for a
/// spec block and returns a parsed `RequirementsSpec`. Returns
/// `None` when both the input is empty and the parsed output is
/// empty (frontend hides the section in that case).
fn parse_requirements_html(html: Option<&str>) -> Option<RequirementsSpec> {
    let text = html.map(requirements_html_to_text).unwrap_or_default();
    let spec = parse_requirements_text(&text);
    if spec.is_empty() {
        None
    } else {
        Some(spec)
    }
}

// ─── System Requirements Fetch + Cache ──────────────────────────────────────

/// Strip every HTML tag from `html` and return the resulting
/// plain text. Used by the About-section path to derive a
/// `short_description`-friendly text preview from Steam's rich
/// `about_the_game` HTML (which contains inline `<img>` tags the
/// text preview shouldn't show). The transformation is more
/// aggressive than `requirements_html_to_text` — it doesn't
/// preserve line structure because the text preview feeds into
/// a single-line display field, not a multi-line list.
fn strip_html_for_preview(html: &str) -> String {
    if html.is_empty() {
        return String::new();
    }
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                if !out.ends_with(' ') {
                    out.push(' ');
                }
            }
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Fetch system requirements with a per-appid TTL cache. Returns
/// `None` only when Steam is unreachable AND the IGDB fallback
/// (currently a no-op since IGDB doesn't expose specs) produced
/// nothing. On a successful Steam response with *both* blocks
/// empty, we return `Some(PcRequirementsPayload { source: "steam",
/// …, minimum: None, recommended: None })` so the frontend can
/// still render the "Steam returned no requirements for this
/// title" empty state with a stable shape.
pub async fn fetch_system_requirements(
    steam_app_id: Option<u32>,
) -> Option<PcRequirementsPayload> {
    let app_id = steam_app_id?;
    fetch_steam_requirements_cached(app_id).await
}

async fn fetch_steam_requirements_cached(app_id: u32) -> Option<PcRequirementsPayload> {
    // Positive-cache hit? Return it.
    {
        let cache = REQUIREMENTS_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
        let guard = cache.lock().ok()?;
        if let Some((fetched, payload)) = guard.get(&app_id) {
            if fetched.elapsed() < REQUIREMENTS_CACHE_TTL {
                return Some(payload.clone());
            }
        }
    }

    // Hit Steam's appdetails endpoint. We reuse `http_client()` for
    // TLS session cache warmth — the about-payload fetcher on the
    // same appid warms the connection a few seconds before us.
    let url = format!(
        "https://store.steampowered.com/api/appdetails?appids={}&cc=us&l=en",
        app_id
    );
    let client = http_client();
    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(_) => return None,
    };
    if !resp.status().is_success() {
        return None;
    }

    #[derive(Deserialize)]
    struct ReqWrapper {
        success: bool,
        #[serde(default)]
        data: Option<ReqAppDetail>,
    }
    #[derive(Deserialize)]
    struct ReqAppDetail {
        #[serde(default)]
        pc_requirements: Option<PcRequirementsRaw>,
        #[serde(default)]
        mac_requirements: Option<PcRequirementsRaw>,
        #[serde(default)]
        linux_requirements: Option<PcRequirementsRaw>,
    }
    #[derive(Deserialize, Default)]
    #[serde(default)]
    struct PcRequirementsRaw {
        minimum: Option<String>,
        recommended: Option<String>,
    }

    let map: HashMap<String, ReqWrapper> = match resp.json().await {
        Ok(m) => m,
        Err(_) => return None,
    };
    let wrapper = map.get(&app_id.to_string())?;
    if !wrapper.success {
        return None;
    }
    let data = wrapper.data.as_ref()?;

    // Prefer Windows (pc) requirements. Mac / Linux blocks are
    // present on cross-platform titles but the overwhelming
    // majority of the library is Windows-first; we'll consider
    // them in a future iteration if the demand is there.
    let block = data
        .pc_requirements
        .as_ref()
        .or(data.mac_requirements.as_ref())
        .or(data.linux_requirements.as_ref());

    let (minimum_html, recommended_html) = match block {
        Some(b) => (b.minimum.clone(), b.recommended.clone()),
        None => (None, None),
    };

    let minimum = parse_requirements_html(minimum_html.as_deref());
    let recommended = parse_requirements_html(recommended_html.as_deref());

    // When Steam returned empty strings for BOTH blocks, surface
    // an empty payload so the frontend can decide whether to
    // render the "no requirements published" empty state. We
    // never cache an empty payload — that would suppress a future
    // edit-cycle from being picked up for 24h.
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let payload = PcRequirementsPayload {
        source: "steam".to_string(),
        source_url: Some(format!("https://store.steampowered.com/app/{}", app_id)),
        source_name: Some("Steam".to_string()),
        minimum,
        recommended,
        minimum_html,
        recommended_html,
        fetched_at: now,
    };

    // Only cache payloads that actually carry some data. A title
    // that hasn't published requirements yet today may publish
    // them tomorrow, and we'd rather re-fetch than 24h-cache a
    // negative.
    if payload.minimum.is_some() || payload.recommended.is_some() {
        if let Some(cache) = REQUIREMENTS_CACHE.get() {
            if let Ok(mut guard) = cache.lock() {
                guard.insert(app_id, (Instant::now(), payload.clone()));
            }
        }
    }

    Some(payload)
}

/// Fetch the rich-about payload with a small cache. Returns
/// `None` when *both* Steam and IGDB come back empty (frontend hides
/// the section in that case, or falls back to the legacy
/// `game.description` field).
pub async fn fetch_rich_about(
    steam_app_id: Option<u32>,
    game_name: Option<&str>,
) -> Option<RichAboutPayload> {
    // 1. Steam ─ the user's preferred source.
    if let Some(app_id) = steam_app_id {
        if let Some(payload) = fetch_steam_about_cached(app_id).await {
            if payload.about_html.is_some() || !payload.movies.is_empty() {
                return Some(payload);
            }
            // Steam responded but produced nothing useful — fall
            // through to IGDB.
        }
        // No payload OR empty payload — fall through.
    }

    // 2. IGDB fallback by game name. We don't accept a slug here
    // because the Steam-priority path already covers any title
    // we have an appid for. Without an appid we're guessing by
    // name anyway, and IGDB's `summary`/`storyline` + YouTube
    // `videos[]` (handled by the existing VideosSection) is good
    // enough.
    if let Some(name) = game_name {
        if let Some(payload) = fetch_igdb_about(name).await {
            return Some(payload);
        }
    }

    None
}

/// Steam-specific fetch + cache. The cache key is the Steam appid;
/// the TTL is `ABOUT_CACHE_TTL`. Returns `None` on any failure
/// (network, parse, missing appid) — the caller treats that as
/// "Steam unavailable" and walks the IGDB fallback.
async fn fetch_steam_about_cached(app_id: u32) -> Option<RichAboutPayload> {
    // Positive-cache hit? Return it.
    {
        let cache = ABOUT_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
        let guard = cache.lock().ok()?;
        if let Some((fetched, payload)) = guard.get(&app_id) {
            if fetched.elapsed() < ABOUT_CACHE_TTL {
                return Some(payload.clone());
            }
        }
    }

    // 1. Hit Steam's appdetails endpoint. Mirrors the URL the
    //    existing `fetch_steam_game_details_impl` uses; we reuse
    //    `http_client()` for TLS session cache warmth.
    let url = format!(
        "https://store.steampowered.com/api/appdetails?appids={}&cc=us&l=en",
        app_id
    );
    let client = http_client();
    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(_) => return None,
    };
    if !resp.status().is_success() {
        return None;
    }

    // 2. Parse the raw response. The Steam wrapper is keyed by the
    //    appid string, identical to `SteamAppDetailResponse` used by
    //    `search_steam`, so we reuse the deserialization path —
    //    except we also read `about_the_game` + `movies` which the
    //    search path ignores. We declare a local copy of the
    //    wrapper here so the change is self-contained (touching the
    //    outer `SteamAppDetail` would silently let the search path
    //    start pulling trailers, which we don't want yet).
    #[derive(Deserialize)]
    struct RichWrapper {
        success: bool,
        #[serde(default)]
        data: Option<RichAppDetail>,
    }
    #[derive(Deserialize)]
    struct RichAppDetail {
        #[serde(default)]
        about_the_game: Option<String>,
        #[serde(default)]
        short_description: Option<String>,
        #[serde(default)]
        movies: Vec<SteamMovie>,
    }

    let map: HashMap<String, RichWrapper> = match resp.json().await {
        Ok(m) => m,
        Err(_) => return None,
    };
    let wrapper = match map.get(&app_id.to_string()) {
        Some(w) => w,
        None => return None,
    };
    if !wrapper.success {
        return None;
    }
    let data = match wrapper.data.as_ref() {
        Some(d) => d,
        None => return None,
    };

    // 3. Build the payload. Map movies to the frontend schema; pick
    //    the best webm (max → 480 → None) and best mp4 (max → 480 →
    //    full → None) slots.
    let movies: Vec<MovieEntry> = data
        .movies
        .iter()
        .map(|m| {
            let webm = m
                .webm
                .as_ref()
                .and_then(|v| v.max.clone().or_else(|| v.p480.clone()));
            let mp4 = m
                .mp4
                .as_ref()
                .and_then(|v| v.max.clone().or_else(|| v.p480.clone()).or_else(|| v.full.clone()));
            MovieEntry {
                id: m.id,
                name: m.name.clone(),
                thumbnail: m.thumbnail.clone(),
                webm,
                mp4,
                highlight: m.highlight,
            }
        })
        .collect();

    let about_text = data
        .about_the_game
        .as_deref()
        .map(strip_html_for_preview)
        .filter(|s| !s.is_empty());

    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let payload = RichAboutPayload {
        source: "steam".to_string(),
        source_url: Some(format!("https://store.steampowered.com/app/{}", app_id)),
        source_name: Some("Steam".to_string()),
        about_html: data.about_the_game.clone(),
        about_text,
        movies,
        fetched_at: now,
    };

    // 4. Cache + return. Only positive results are cached so a
    //    transient Steam hiccup doesn't poison subsequent renders.
    if payload.about_html.is_some() || !payload.movies.is_empty() {
        if let Some(cache) = ABOUT_CACHE.get() {
            if let Ok(mut guard) = cache.lock() {
                guard.insert(app_id, (Instant::now(), payload.clone()));
            }
        }
    }

    Some(payload)
}

/// IGDB fallback: search by name and return the first hit's
/// storyline + summary as plain text. We don't include IGDB videos
/// here because the existing VideosSection already surfaces them
/// via YouTube embeds; doubling-up would create two trailers rows.
async fn fetch_igdb_about(game_name: &str) -> Option<RichAboutPayload> {
    let results = search_igdb(game_name).await;
    let best = results.into_iter().next()?;

    // Prefer the longer `storyline`; fall back to `summary`. Skip
    // when both are empty (no IGDB data worth showing).
    let about_text = best
        .storyline
        .clone()
        .filter(|s| !s.trim().is_empty())
        .or(best.description.clone().filter(|s| !s.trim().is_empty()));

    let about_text = match about_text {
        Some(s) => s,
        None => return None,
    };

    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    Some(RichAboutPayload {
        source: "igdb".to_string(),
        source_url: Some(best.source_url.clone()),
        source_name: Some("IGDB".to_string()),
        about_html: None,
        about_text: Some(about_text),
        movies: Vec::new(),
        fetched_at: now,
    })
}

fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(CHARS[((triple >> 18) & 63) as usize] as char);
        out.push(CHARS[((triple >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(CHARS[((triple >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(CHARS[(triple & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

// ─── Public API ───────────────────────────────────────────────────────────────

/// Search for game metadata across multiple sources.
/// Returns results ordered by relevance (best match first).
/// Currently supports Steam and LaunchBox Games Database.
pub async fn search_game_metadata(game_name: &str, skip_launchbox: bool) -> Vec<GameMetadataResult> {
    let mut results: Vec<GameMetadataResult> = Vec::new();

    if skip_launchbox {
        // Steam-synced games: skip LaunchBox (wasteful scrape), use IGDB + Steam
        let (steam_result, igdb_results) = tokio::join!(
            search_steam(game_name),
            search_igdb(game_name)
        );
        if let Some(r) = steam_result {
            results.push(r);
        }
        results.extend(igdb_results);
    } else {
        // Local imports: search all three sources
        let (steam_result, launchbox_result, igdb_results) = tokio::join!(
            search_steam(game_name),
            search_launchbox(game_name),
            search_igdb(game_name)
        );
        if let Some(r) = steam_result {
            results.push(r);
        }
        if let Some(r) = launchbox_result {
            results.push(r);
        }
        results.extend(igdb_results);
    }

    results
}

/// Download an image from a URL and return it as a base64 data URL.
/// Returns `None` if the download fails.
pub async fn download_image_to_base64(url: &str) -> Option<String> {
    let client = http_client();

    let response = client.get(url).send().await.ok()?;
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();

    let bytes = response.bytes().await.ok()?;
    let b64 = base64_encode(&bytes);
    Some(format!("data:{};base64,{}", content_type, b64))
}

/// Batch-download images and return base64 data URLs.
/// This is exposed as a Tauri command.
pub async fn fetch_game_images(urls: Vec<String>) -> Vec<Option<String>> {
    let mut handles = Vec::new();
    for url in urls {
        handles.push(tokio::spawn(async move {
            download_image_to_base64(&url).await
        }));
    }
    let mut results = Vec::new();
    for handle in handles {
        results.push(handle.await.unwrap_or(None));
    }
    results
}

/// Use Spider to crawl a single page and return its full HTML content.
/// Uses Spider v2's Website API for HTTP-only crawling.
pub async fn spider_fetch_page(url: &str) -> Result<String, String> {
    // Spider v2: create Website and crawl the target URL.
    // The Website API handles robots.txt, rate limiting, and user-agent
    // rotation automatically.
    let mut website = spider::website::Website::new(url);
    website.configuration.respect_robots_txt = true;
    website.configuration.delay = 200;

    website.crawl().await;

    // get_pages returns Option<&Vec<Page>>.
    if let Some(page) = website.get_pages().and_then(|pages| pages.first()) {
        Ok(page.get_html())
    } else {
        Err(format!(
            "Spider: no pages scraped for URL: {}",
            url
        ))
    }
}

/// Use Spider to crawl a page and extract data using CSS selectors.
/// Returns a map of field name → extracted text values.
pub async fn spider_extract(
    url: &str,
    selectors: &HashMap<String, String>,
) -> Result<HashMap<String, Vec<String>>, String> {
    let html = spider_fetch_page(url).await?;
    let document = scraper::Html::parse_document(&html);

    let mut results: HashMap<String, Vec<String>> = HashMap::new();
    for (field_name, css_selector) in selectors {
        let selector = scraper::Selector::parse(css_selector)
            .map_err(|e| format!("Invalid CSS selector '{}': {}", css_selector, e))?;
        let values: Vec<String> = document
            .select(&selector)
            .map(|el| {
                el.text()
                    .collect::<Vec<_>>()
                    .join(" ")
                    .trim()
                    .to_string()
            })
            .filter(|s| !s.is_empty())
            .collect();
        results.insert(field_name.clone(), values);
    }

    Ok(results)
}

// ─── Source: Steam ────────────────────────────────────────────────────────────

/// Search Steam's store for a game and return metadata.
async fn search_steam(game_name: &str) -> Option<GameMetadataResult> {
    let client = http_client();

    // Step 1: Search the Steam store
    let search_url = format!(
        "https://store.steampowered.com/api/storesearch/?term={}&l=english&cc=us",
        url_encode(game_name)
    );

    let search_resp = client.get(&search_url).send().await.ok()?;
    let search_data: SteamSearchResponse = search_resp.json().await.ok()?;

    let best_match = search_data.items.into_iter().next()?;
    let app_id = best_match.id;
    let title = best_match.name;

    // Step 2: Get detailed app information
    let detail_url = format!(
        "https://store.steampowered.com/api/appdetails?appids={}",
        app_id
    );

    let detail_resp = client.get(&detail_url).send().await.ok()?;
    let detail_data: SteamAppDetailResponse = detail_resp.json().await.ok()?;

    let wrapper = detail_data.apps.get(&app_id.to_string())?;
    if !wrapper.success {
        return None;
    }
    let data = wrapper.data.as_ref()?;

    // Build images from the API response and CDN patterns
    let images = GameImages {
        icon: best_match.tiny_image.map(|hash| {
            format!(
                "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/{}/{}.jpg",
                app_id, hash
            )
        }),
        cover: Some(format!(
            "https://cdn.cloudflare.steamstatic.com/steam/apps/{}/library_600x900.jpg",
            app_id
        )),
        hero: data
            .capsule_image
            .clone()
            .or_else(|| data.header_image.clone())
            .or_else(|| {
                Some(format!(
                    "https://cdn.cloudflare.steamstatic.com/steam/apps/{}/header.jpg",
                    app_id
                ))
            }),
        banner: Some(format!(
            "https://cdn.cloudflare.steamstatic.com/steam/apps/{}/library_hero.jpg",
            app_id
        )),
        logo: Some(format!(
            "https://cdn.cloudflare.steamstatic.com/steam/apps/{}/logo.png",
            app_id
        )),
    };

    Some(GameMetadataResult {
        title,
        description: data.short_description.clone(),
        developer: data.developers.first().cloned(),
        publisher: data.publishers.first().cloned(),
        // Steam API does not return IGDB collection IDs, so the
        // GameRelationsCard cannot fetch "Other in Collection"
        // members for Steam-sourced metadata. Hardcode `None`
        // because the struct requires the field.
        collection_id: None,
        release_date: data
            .release_date
            .as_ref()
            .and_then(|rd| rd.date.clone()),
        genres: data
            .genres
            .iter()
            .filter_map(|g| g.description.clone())
            .collect(),
        images,
        source_url: format!("https://store.steampowered.com/app/{}", app_id),
        source_name: "Steam".to_string(),
        storyline: None,
        igdb_rating: None,
        critic_rating: None,
        themes: None,
        game_modes: None,
        player_perspectives: None,
        screenshots: None,
        videos: None,
        websites: None,
        time_to_beat: None,
        similar_games: None,
        releases: None,
        igdb_reviews: None,
        alternative_names: None,
        collection: None,
        franchise: None,
        game_category: None,
        release_status: None,
        language_supports: None,
    })
}

// ─── Source: LaunchBox Games Database ──────────────────────────────────────────

/// A single image entry from the LaunchBox Games Database detail page.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LaunchBoxImageResult {
    /// Category such as "Box - Front", "Banner", "Fanart - Background", "Clear Logo"
    pub category: String,
    /// Region label if available (e.g., "World", "Europe", "North America")
    pub region: Option<String>,
    /// Resolution string (e.g., "1920x1080")
    pub resolution: String,
    /// Full-resolution image URL
    pub url: String,
}

/// Build a shared reqwest client for LaunchBox requests.
fn launchbox_client() -> Option<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .ok()
}

/// Search the LaunchBox Games Database for a game and return metadata.
async fn search_launchbox(game_name: &str) -> Option<GameMetadataResult> {
    let client = launchbox_client()?;

    // Step 1: Search the LaunchBox Games Database
    let search_url = format!(
        "https://gamesdb.launchbox-app.com/games/results/{}",
        url_encode(game_name)
    );

    let search_resp = client.get(&search_url).send().await.ok()?;
    let search_html = search_resp.text().await.ok()?;

    // Parse HTML synchronously and extract all data (scraper::Html is !Send)
    struct SearchHit {
        href: String,
        title: String,
        _platform: String,
        cover_url: Option<String>,
        description: Option<String>,
        release_date: Option<String>,
    }

    let (hits, detail_url_str) = {
        let document = scraper::Html::parse_document(&search_html);

        let card_selector = scraper::Selector::parse(".games-grid-card").ok()?;
        let link_selector = scraper::Selector::parse("a.list-item").ok()?;
        let title_selector = scraper::Selector::parse(".cardTitle h3").ok()?;
        let platform_selector = scraper::Selector::parse(".cardTitle p").ok()?;
        let img_selector = scraper::Selector::parse(".cardImgPart > img").ok()?;
        let desc_selector = scraper::Selector::parse(".cardContent > p").ok()?;
        let date_selector = scraper::Selector::parse(".releaseDate h5").ok()?;

        let mut hits: Vec<SearchHit> = Vec::new();

        for card in document.select(&card_selector).take(12) {
            let href = card
                .select(&link_selector)
                .next()
                .and_then(|a| a.value().attr("href"))
                .unwrap_or("")
                .to_string();

            if href.is_empty() {
                continue;
            }

            let title = card
                .select(&title_selector)
                .next()
                .map(|el| el.text().collect::<Vec<_>>().join("").trim().to_string())
                .unwrap_or_default();

            let platform = card
                .select(&platform_selector)
                .next()
                .map(|el| el.text().collect::<Vec<_>>().join("").trim().to_string())
                .unwrap_or_default();

            let cover_url = card
                .select(&img_selector)
                .next()
                .and_then(|el| el.value().attr("src"))
                .map(|s| s.to_string());

            let description = card
                .select(&desc_selector)
                .last()
                .map(|el| el.text().collect::<Vec<_>>().join("").trim().to_string())
                .filter(|s| !s.is_empty());

            let release_date = card
                .select(&date_selector)
                .next()
                .map(|el| el.text().collect::<Vec<_>>().join("").trim().to_string())
                .filter(|s| !s.is_empty());

            if !title.is_empty() {
                hits.push(SearchHit {
                    href,
                    title,
                    _platform: platform.clone(),
                    cover_url,
                    description,
                    release_date,
                });
            }
        }

        if hits.is_empty() {
            return None;
        }

        // Prefer Windows platform if available, otherwise take first result
        let best_idx = hits
            .iter()
            .position(|h| h._platform.eq_ignore_ascii_case("Windows"))
            .unwrap_or(0);

        let detail_url = if hits[best_idx].href.starts_with("http") {
            hits[best_idx].href.clone()
        } else {
            format!("https://gamesdb.launchbox-app.com{}", hits[best_idx].href)
        };

        (hits, detail_url)
        // document is dropped here — scraper::Html is no longer alive across .await
    };

    // Prefer Windows platform, fallback to first
    let best_idx = hits
        .iter()
        .position(|h| h._platform.eq_ignore_ascii_case("Windows"))
        .unwrap_or(0);
    let best = &hits[best_idx];

    // Step 2: Fetch the detail page for richer metadata
    let (description, developer, publisher, genres, release_date, images) =
        fetch_launchbox_details(&client, &detail_url_str).await.unwrap_or_else(|| {
            // Fallback: use search result data
            (
                best.description.clone(),
                None,
                None,
                Vec::new(),
                best.release_date.clone(),
                GameImages {
                    icon: None,
                    cover: best.cover_url.clone(),
                    hero: None,
                    banner: None,
                    logo: None,
                },
            )
        });

    Some(GameMetadataResult {
        title: best.title.clone(),
        description,
        developer,
        publisher,
        // LaunchBox does not return IGDB collection IDs, so the
        // GameRelationsCard cannot fetch "Other in Collection"
        // members for LaunchBox-sourced metadata. Hardcode `None`.
        collection_id: None,
        release_date,
        genres,
        images,
        source_url: detail_url_str,
        source_name: "LaunchBox".to_string(),
        storyline: None,
        igdb_rating: None,
        critic_rating: None,
        themes: None,
        game_modes: None,
        player_perspectives: None,
        screenshots: None,
        videos: None,
        websites: None,
        time_to_beat: None,
        similar_games: None,
        releases: None,
        igdb_reviews: None,
        alternative_names: None,
        collection: None,
        franchise: None,
        game_category: None,
        release_status: None,
        language_supports: None,
    })
}

/// Fetch a LaunchBox game detail page and extract metadata + best images.
async fn fetch_launchbox_details(
    client: &reqwest::Client,
    detail_url: &str,
) -> Option<(
    Option<String>,       // description
    Option<String>,       // developer
    Option<String>,       // publisher
    Vec<String>,          // genres
    Option<String>,       // release_date
    GameImages,           // images
)> {
    let resp = client.get(detail_url).send().await.ok()?;
    let html = resp.text().await.ok()?;
    let doc = scraper::Html::parse_document(&html);

    // --- Extract description from the meta tag (most reliable for Nuxt SSR pages) ---
    let description = scraper::Selector::parse("meta[name='description']")
        .ok()
        .and_then(|sel| {
            doc.select(&sel)
                .next()
                .and_then(|el| el.value().attr("content"))
                .map(|s| s.trim().to_string())
        })
        .filter(|s| !s.is_empty());

    // --- Extract developer/publisher/genre from the detail page ---
    // The new Nuxt-based detail page uses <dt>/<dd> pairs
    let dt_selector = scraper::Selector::parse("dt").ok()?;
    let dd_selector = scraper::Selector::parse("dd").ok()?;
    let a_selector = scraper::Selector::parse("a").ok()?;
    let time_selector = scraper::Selector::parse("time").ok()?;

    let mut developer: Option<String> = None;
    let mut publisher: Option<String> = None;
    let mut genres: Vec<String> = Vec::new();
    let mut release_date: Option<String> = None;

    // Walk through all <dt> elements and match their text content
    let dts: Vec<_> = doc.select(&dt_selector).collect();
    let dds: Vec<_> = doc.select(&dd_selector).collect();

    for (dt, dd) in dts.iter().zip(dds.iter()) {
        let label = dt
            .text()
            .collect::<Vec<_>>()
            .join("")
            .trim()
            .to_lowercase();

        if label.contains("developer") {
            let devs: Vec<String> = dd
                .select(&a_selector)
                .map(|a| a.text().collect::<Vec<_>>().join("").trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            if !devs.is_empty() {
                developer = Some(devs.join("; "));
            }
        } else if label.contains("publisher") {
            let pubs: Vec<String> = dd
                .select(&a_selector)
                .map(|a| a.text().collect::<Vec<_>>().join("").trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            if !pubs.is_empty() {
                publisher = Some(pubs.join("; "));
            }
        } else if label.contains("genre") {
            genres = dd
                .select(&a_selector)
                .map(|a| a.text().collect::<Vec<_>>().join("").trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
        } else if label.contains("release") {
            release_date = dd
                .select(&time_selector)
                .next()
                .and_then(|t| t.value().attr("datetime"))
                .map(|s| s.trim().to_string())
                .or_else(|| {
                    Some(
                        dd.text()
                            .collect::<Vec<_>>()
                            .join("")
                            .trim()
                            .to_string(),
                    )
                })
                .filter(|s| !s.is_empty());
        }
    }

    // --- Extract images by category ---
    let all_images = extract_launchbox_images(&doc);

    // Map to our GameImages — pick the first image in each relevant category
    let find_image = |categories: &[&str]| -> Option<String> {
        for cat in categories {
            if let Some(img) = all_images.iter().find(|i| {
                i.category.to_lowercase().contains(&cat.to_lowercase())
            }) {
                return Some(img.url.clone());
            }
        }
        None
    };

    let images = GameImages {
        icon: None,
        cover: find_image(&["Box - Front", "Box Front"]),
        hero: find_image(&["Banner"]),
        banner: find_image(&["Fanart - Background", "Fanart", "Screenshot"]),
        logo: find_image(&["Clear Logo"]),
    };

    Some((description, developer, publisher, genres, release_date, images))
}

/// Extract all categorized images from a LaunchBox detail page document.
fn extract_launchbox_images(doc: &scraper::Html) -> Vec<LaunchBoxImageResult> {
    let mut results: Vec<LaunchBoxImageResult> = Vec::new();

    // The detail page groups images under <article> elements with <h3> category headings.
    // Each image is an <img> inside a container with an alt text containing metadata.
    // Alt format: "GAME_TITLE - Category (Region) - WIDTHxHEIGHT"
    let article_selector = match scraper::Selector::parse("article") {
        Ok(s) => s,
        Err(_) => return results,
    };
    let h3_selector = match scraper::Selector::parse("h3") {
        Ok(s) => s,
        Err(_) => return results,
    };
    let img_selector = match scraper::Selector::parse("img[loading='lazy']") {
        Ok(s) => s,
        Err(_) => return results,
    };

    for article in doc.select(&article_selector) {
        // Get the category name from the <h3> element
        let category = match article.select(&h3_selector).next() {
            Some(h3) => h3
                .text()
                .collect::<Vec<_>>()
                .join("")
                .trim()
                .to_string(),
            None => continue,
        };

        if category.is_empty() || category == "Overview" || category == "Media" {
            continue;
        }

        // Extract images within this article
        for img in article.select(&img_selector) {
            let src = match img.value().attr("src") {
                Some(s) if s.contains("launchbox") => s.to_string(),
                _ => continue,
            };

            let alt = img
                .value()
                .attr("alt")
                .unwrap_or("")
                .to_string();

            // Parse alt text: "DOOM - Box - Front (World) - 1440x2160"
            let (region, resolution) = parse_launchbox_image_alt(&alt);

            results.push(LaunchBoxImageResult {
                category: category.clone(),
                region,
                resolution,
                url: src,
            });
        }
    }

    results
}

/// Parse the alt text of a LaunchBox image to extract region and resolution.
/// Expected format: "TITLE - Category (Region) - WIDTHxHEIGHT"
fn parse_launchbox_image_alt(alt: &str) -> (Option<String>, String) {
    let mut region: Option<String> = None;
    let mut resolution = String::new();

    // Extract region from parentheses
    if let Some(start) = alt.rfind('(') {
        if let Some(end) = alt[start..].find(')') {
            let r = alt[start + 1..start + end].trim().to_string();
            if !r.is_empty() && r != "null" {
                region = Some(r);
            }
        }
    }

    // Extract resolution — last segment matching NNNxNNN pattern
    for part in alt.rsplit(" - ") {
        let trimmed = part.trim();
        if trimmed.contains('x') {
            let pieces: Vec<&str> = trimmed.split('x').collect();
            if pieces.len() == 2
                && pieces[0].trim().parse::<u32>().is_ok()
                && pieces[1].trim().parse::<u32>().is_ok()
            {
                resolution = trimmed.to_string();
                break;
            }
        }
    }

    (region, resolution)
}

/// Search LaunchBox for images of a given game name.
/// Returns all categorized images found on the detail page.
pub async fn search_launchbox_images(game_name: &str) -> Result<Vec<LaunchBoxImageResult>, String> {
    let client = launchbox_client().ok_or("Failed to create HTTP client")?;

    // Search LaunchBox
    let search_url = format!(
        "https://gamesdb.launchbox-app.com/games/results/{}",
        url_encode(game_name)
    );

    let search_resp = client
        .get(&search_url)
        .send()
        .await
        .map_err(|e| format!("LaunchBox search failed: {}", e))?;
    let search_html = search_resp
        .text()
        .await
        .map_err(|e| format!("Failed to read search response: {}", e))?;

    let href = {
        let document = scraper::Html::parse_document(&search_html);

        // Find the first game link
        let link_selector = scraper::Selector::parse("a.list-item")
            .map_err(|e| format!("Selector error: {}", e))?;

        // Collect links and try to find a Windows platform match
        let card_selector = scraper::Selector::parse(".games-grid-card")
            .map_err(|e| format!("Selector error: {}", e))?;
        let platform_selector = scraper::Selector::parse(".cardTitle p")
            .map_err(|e| format!("Selector error: {}", e))?;

        let mut best_href: Option<String> = None;
        let mut first_href: Option<String> = None;

        for card in document.select(&card_selector).take(12) {
            let href = card
                .select(&link_selector)
                .next()
                .and_then(|a| a.value().attr("href"))
                .map(|s| s.to_string());

            if let Some(ref h) = href {
                if first_href.is_none() {
                    first_href = Some(h.clone());
                }
                let platform = card
                    .select(&platform_selector)
                    .next()
                    .map(|el| el.text().collect::<Vec<_>>().join("").trim().to_string())
                    .unwrap_or_default();
                if platform.eq_ignore_ascii_case("Windows") {
                    best_href = Some(h.clone());
                    break;
                }
            }
        }

        best_href
            .or(first_href)
            .ok_or("No results found on LaunchBox")?
    };

    let detail_url = if href.starts_with("http") {
        href
    } else {
        format!("https://gamesdb.launchbox-app.com{}", href)
    };

    // Fetch the detail page
    let detail_resp = client
        .get(&detail_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch detail page: {}", e))?;
    let detail_html = detail_resp
        .text()
        .await
        .map_err(|e| format!("Failed to read detail page: {}", e))?;
    let detail_doc = scraper::Html::parse_document(&detail_html);

    Ok(extract_launchbox_images(&detail_doc))
}

// ─── Source: IGDB Twitch API ──────────────────────────────────────────────────

use std::sync::OnceLock;
use std::sync::Mutex;
use std::time::{Instant, Duration, SystemTime};

struct TokenCache {
    token: String,
    expires_at: Instant,
}

static TOKEN_CACHE: OnceLock<Mutex<Option<TokenCache>>> = OnceLock::new();

// Cooldown cache for token fetch failures — prevents a single credential
// error from spamming the console on every concurrent IGDB call.
static TOKEN_FAILURE_UNTIL: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();

// ── IGDB Rate Limiter ────────────────────────────────────────────────────────
// IGDB free tier: 4 req/s, max 8 concurrent.
// https://api-docs.igdb.com/#rate-limits

static IGDB_SEM: OnceLock<tokio::sync::Semaphore> = OnceLock::new();
static IGDB_LAST: OnceLock<Mutex<Instant>> = OnceLock::new();

/// Acquire a rate-limit slot for an IGDB API call.
///
/// Two layers of throttling, both required to coexist safely with IGDB's
/// free-tier caps:
///
/// 1. **Local concurrency.** A `Semaphore::new(16)` caps the number of
///    in-flight IGDB POSTs to 16. IGDB's documented cap is 8 concurrent
///    per docs; we permit 16 locally so React StrictMode's dev-mode
///    double-mount burst (5 Discover rails x -  2 mounts = 10 simultaneous
///    `invoke("fetch_store_games", ...)` calls) doesn't deadlock on
///    `sem.acquire().await`. The frontend Promise cache in
///    `SnapRail.tsx` dedups identical in-flight requests so the IGDB
///    layer typically only sees 5 simultaneous calls per session.
///
/// 2. **Global request rate.** A `Mutex<Instant>` (`IGDB_LAST`) enforces
///    a minimum 250 ms gap between IGDB POST *starts*. With concurrent
///    calls, each caller reserves a *future* timestamp
///    `max(now, last_req + 250 ms)` so the cumulative spacing drains
///    smoothly rather than bunching on the next interval. This honors
///    IGDB's 4 req/sec global cap regardless of how many parallel
///    executors are waiting on a permit.
///
/// The `SemaphorePermit<'static>` returned by this function is bound to
/// the `IGDB_SEM` tokio Semaphore inside a `OnceLock`, so the lifetime
/// extends for the process lifetime  -  drop the permit when the HTTP
/// call completes (Rust's RAII does this).
async fn igdb_acquire() -> tokio::sync::SemaphorePermit<'static> {
    let sem = IGDB_SEM.get_or_init(|| tokio::sync::Semaphore::new(16));
    let permit = sem.acquire().await.unwrap();

    let last = IGDB_LAST.get_or_init(|| Mutex::new(Instant::now()));
    // Cumulative scheduling: each caller reserves a future time slot
    // 250 ms after the previous caller. This prevents multiple tasks
    // from seeing the same old timestamp, sleeping together, and then
    // all firing simultaneously — which would trip IGDB's server-side
    // 4 req/s rate limit (HTTP 429).
    let sleep_dur = {
        let mut last_req = last.lock().unwrap();
        let now = Instant::now();
        let next_allowed = *last_req + Duration::from_millis(250);
        let scheduled = if now < next_allowed { next_allowed } else { now };
        *last_req = scheduled; // advance for the NEXT caller
        if scheduled > now { Some(scheduled - now) } else { None }
    }; // MutexGuard dropped before .await

    if let Some(dur) = sleep_dur {
        tokio::time::sleep(dur).await;
    }

    permit
}


// ── Shared HTTP client ──────────────────────────────────────────────────────
// A single reqwest::Client reused across all functions avoids creating
// a fresh connection pool per request, which would exhaust OS sockets
// and TLS session tickets when 100+ concurrent calls are spawned during
// Steam sync / batch metadata imports.
static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn http_client() -> reqwest::Client {
    HTTP_CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .user_agent("Mozilla/5.0 (compatible; GameLib/1.0)")
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .expect("Failed to build shared HTTP client")
        })
        .clone() // reqwest::Client wraps an Arc internally
}

async fn get_twitch_token() -> Result<String, String> {
    let client_id = crate::config::get_twitch_client_id();
    if client_id.is_empty() {
        return Err("Missing TWITCH_CLIENT_ID — set it at build time or in your .env file.".to_string());
    }
    let client_secret = crate::config::get_twitch_client_secret();
    if client_secret.is_empty() {
        return Err("Missing TWITCH_CLIENT_SECRET — set it at build time or in your .env file.".to_string());
    }

    let failure_mutex = TOKEN_FAILURE_UNTIL.get_or_init(|| Mutex::new(None));
    let cache_mutex = TOKEN_CACHE.get_or_init(|| Mutex::new(None));

    // ── Check success cache FIRST — a valid token beats cooldown ─────
    {
        let cache = cache_mutex.lock().map_err(|e| e.to_string())?;
        if let Some(ref c) = *cache {
            if Instant::now() < c.expires_at {
                return Ok(c.token.clone());
            }
        }
    }

    // ── Check failure cooldown — only if no valid token is cached ────
    {
        let failure = failure_mutex.lock().map_err(|e| e.to_string())?;
        if let Some(until) = *failure {
            if Instant::now() < until {
                return Err("Twitch token fetch skipped — cooling down after previous failure".to_string());
            }
        }
    }

    let client = http_client();
    let url = format!(
        "https://id.twitch.tv/oauth2/token?client_id={}&client_secret={}&grant_type=client_credentials",
        client_id, client_secret
    );

    #[derive(Deserialize)]
    struct TokenResponse {
        access_token: String,
        expires_in: u64,
    }

    let resp = client.post(&url)
        .header("Content-Length", "0")
        .send()
        .await
        .map_err(|e| {
            if let Ok(mut f) = failure_mutex.lock() {
                *f = Some(Instant::now() + Duration::from_secs(30));
            }
            format!("Failed to send Twitch token request: {}", e)
        })?;

    // ── Check HTTP status before deserializing ───────────────────────
    //     Must capture status BEFORE consuming the body with .text()
    let http_status = resp.status();
    if !http_status.is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        if let Ok(mut f) = failure_mutex.lock() {
            *f = Some(Instant::now() + Duration::from_secs(30));
        }
        return Err(format!(
            "Twitch token request failed with HTTP {}: {}",
            http_status, err_text
        ));
    }

    let data = resp.json::<TokenResponse>()
        .await
        .map_err(|e| {
            if let Ok(mut f) = failure_mutex.lock() {
                *f = Some(Instant::now() + Duration::from_secs(30));
            }
            format!("Failed to parse Twitch token response: {}", e)
        })?;

    let expires_in_secs = if data.expires_in > 60 { data.expires_in - 60 } else { data.expires_in };
    let expires_at = Instant::now() + Duration::from_secs(expires_in_secs);

    let token = data.access_token.clone();
    {
        let mut cache = cache_mutex.lock().map_err(|e| e.to_string())?;
        *cache = Some(TokenCache {
            token: token.clone(),
            expires_at,
        });
    }

    // ── Clear failure cooldown on success ────────────────────────────
    if let Ok(mut f) = failure_mutex.lock() {
        *f = None;
    }

    Ok(token)
}

#[derive(Debug, Deserialize)]
struct IgdbGame {
    id: u64,
    name: String,
    slug: String,
    summary: Option<String>,
    storyline: Option<String>,
    first_release_date: Option<i64>,
    rating: Option<f64>,
    aggregated_rating: Option<f64>,
    cover: Option<IgdbCover>,
    genres: Option<Vec<IgdbName>>,
    themes: Option<Vec<IgdbName>>,
    game_modes: Option<Vec<IgdbName>>,
    player_perspectives: Option<Vec<IgdbName>>,
    involved_companies: Option<Vec<IgdbInvolvedCompany>>,
    screenshots: Option<Vec<IgdbImage>>,
    artworks: Option<Vec<IgdbImage>>,
    videos: Option<Vec<IgdbVideo>>,
    websites: Option<Vec<IgdbWebsite>>,
    similar_games: Option<Vec<IgdbSimilarGameRaw>>,
    release_dates: Option<Vec<IgdbReleaseDateRaw>>,
    game_type: Option<u32>,
    status: Option<u32>,
    /// IGDB collections: each collection has both an ID and a name.
    /// We only use the first one for the GameMetadataResult, but
    /// keeping the full list lets future "in N collections" UI work
    /// without re-querying IGDB.
    collections: Option<Vec<IgdbCollection>>,
    franchises: Option<Vec<IgdbName>>,
    alternative_names: Option<Vec<IgdbName>>,
    language_supports: Option<Vec<IgdbLanguageSupport>>,
}

#[derive(Debug, Deserialize)]
struct IgdbTimeToBeatRaw {
    hastily: Option<u64>,
    normally: Option<u64>,
    completely: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct IgdbSimilarGameRaw {
    id: u64,
    name: String,
    cover: Option<IgdbCover>,
}

#[derive(Debug, Deserialize)]
struct IgdbReleaseDateRaw {
    platform: Option<IgdbPlatformRaw>,
    human: Option<String>,
    region: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct IgdbPlatformRaw {
    name: String,
}


#[derive(Debug, Deserialize)]
struct IgdbCover {
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IgdbName {
    name: String,
}

/// IGDB collection reference with both id and name. Used by the
/// `IgdbGame.collections` field and by the `get_collection_games`
/// command to identify a collection unambiguously. The `id` is
/// what we forward to the frontend; the `name` is what we display.
#[derive(Debug, Deserialize)]
struct IgdbCollection {
    id: u64,
    name: String,
}

#[derive(Debug, Deserialize)]
struct IgdbInvolvedCompany {
    company: IgdbName,
    developer: bool,
    publisher: bool,
}

#[derive(Debug, Deserialize)]
struct IgdbImage {
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IgdbVideo {
    video_id: Option<String>,
    #[allow(dead_code)]
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IgdbWebsite {
    url: Option<String>,
    #[allow(dead_code)]
    category: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct IgdbLanguageSupport {
    language: Option<IgdbName>,
    language_support_type: Option<IgdbName>,
}

fn format_unix_timestamp(ts: i64) -> String {
    let seconds_in_day = 86400;
    let days = ts / seconds_in_day;
    
    let mut year = 1970;
    let mut day_count = days;
    
    loop {
        let is_leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
        let days_in_year = if is_leap { 366 } else { 365 };
        if day_count < days_in_year {
            break;
        }
        day_count -= days_in_year;
        year += 1;
    }
    
    let is_leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
    let month_lengths = if is_leap {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    
    let mut month = 1;
    for &length in month_lengths.iter() {
        if day_count < length {
            break;
        }
        day_count -= length;
        month += 1;
    }
    
    let day = day_count + 1;
    format!("{:04}-{:02}-{:02}", year, month, day)
}

fn map_game_category(game_type: u32) -> String {
    match game_type {
        0 => "Main Game",
        1 => "DLC / Add-on",
        2 => "Expansion",
        3 => "Bundle",
        4 => "Standalone Expansion",
        5 => "Mod",
        6 => "Episode",
        7 => "Season",
        8 => "Remake",
        9 => "Remaster",
        10 => "Expanded Game",
        11 => "Port",
        12 => "Fork",
        13 => "Pack",
        14 => "Playable Prototype",
        _ => "Unknown",
    }.to_string()
}

fn map_release_status(status: u32) -> String {
    match status {
        0 => "Released",
        2 => "Alpha",
        3 => "Beta",
        4 => "Early Access",
        5 => "Offline",
        6 => "Cancelled",
        _ => "Unknown",
    }.to_string()
}

pub async fn search_igdb(game_name: &str) -> Vec<GameMetadataResult> {
    let token = match get_twitch_token().await {
        Ok(t) => t,
        Err(e) => {
            eprintln!("IGDB token error: {}", e);
            return Vec::new();
        }
    };
    
    let client = http_client();
    
    let escaped_name = game_name.replace('"', "\\\"");
    let body = format!(
        r#"search "{}";
fields name, slug, summary, storyline, first_release_date, rating, aggregated_rating,
       cover.url, screenshots.url, artworks.url, videos.video_id, videos.name,
       genres.name, themes.name, game_modes.name, player_perspectives.name,
       involved_companies.developer, involved_companies.publisher, involved_companies.company.name,
       websites.url, websites.category,
       similar_games.name, similar_games.cover.url,
       release_dates.platform.name, release_dates.human, release_dates.region,
       game_type, status, collections.id, collections.name, franchises.name, alternative_names.name,
       language_supports.language.name, language_supports.language_support_type.name;
limit 8;"#,
        escaped_name
    );
    
    let client_id = crate::config::get_twitch_client_id();
    
    let _guard = igdb_acquire().await;
    let resp = match client.post("https://api.igdb.com/v4/games")
        .header("Client-ID", &client_id)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "text/plain")
        .body(body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("IGDB request error: {}", e);
            return Vec::new();
        }
    };
    
    let status = resp.status();
    if !status.is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        eprintln!("IGDB request failed with status {}: {}", status, err_text);
        return Vec::new();
    }

    let text = match resp.text().await {
        Ok(t) => t,
        Err(e) => {
            eprintln!("Failed to read IGDB response text: {}", e);
            return Vec::new();
        }
    };
    
    let igdb_games: Vec<IgdbGame> = match serde_json::from_str(&text) {
        Ok(games) => games,
        Err(e) => {
            eprintln!("IGDB parse error: {}, body was: {}", e, text);
            return Vec::new();
        }
    };

    let game_ids: Vec<String> = igdb_games.iter().map(|g| g.id.to_string()).collect();
    // IGDB removed the public /v4/reviews endpoint. Reviews are no longer
    // fetched. The IgdbReview field is kept only for backward compatibility
    // with saved library data.
    if !game_ids.is_empty() {
        // NOTE: The IGDB /v4/reviews endpoint was removed from the public IGDB API
    // (returns 404 "Endpoint not found" as of 2024+). Reviews are no longer
    // available from IGDB. The IgdbReview field on GameMetadataResult is
    // retained for backward compatibility with saved library data, but new
    // fetches no longer populate it.
    }

    let mut time_to_beat_by_game: std::collections::HashMap<u64, IgdbTimeToBeatRaw> = std::collections::HashMap::new();
    if !game_ids.is_empty() {
        // IGDB v4/game_time_to_beats schema uses `game_id` (NOT `game`) as the
        // game foreign key, and `hastily` (NOT `hastly`) for the rushed completion
        // time. Both must be spelled exactly as the IGDB API requires, otherwise
        // IGDB responds with HTTP 400 "Invalid field name".
        let ttb_body = format!(
            "fields game_id, hastily, normally, completely; where game_id = ({}); limit 50;",
            game_ids.join(",")
        );
        let _guard2 = igdb_acquire().await;
        let resp = match client.post("https://api.igdb.com/v4/game_time_to_beats")
            .header("Client-ID", &client_id)
            .header("Authorization", format!("Bearer {}", token))
            .header("Content-Type", "text/plain")
            .body(ttb_body)
            .send()
            .await
        {
            Ok(r) => Some(r),
            Err(e) => {
                eprintln!("IGDB game_time_to_beats request error: {}", e);
                None
            }
        };

        if let Some(r) = resp {
            if r.status().is_success() {
                if let Ok(text) = r.text().await {
                    #[derive(Debug, Deserialize)]
                    struct IgdbTimeToBeatRawInner {
                        game_id: u64,
                        hastily: Option<u64>,
                        normally: Option<u64>,
                        completely: Option<u64>,
                    }
                    if let Ok(raw_ttbs) = serde_json::from_str::<Vec<IgdbTimeToBeatRawInner>>(&text) {
                        for ttb in raw_ttbs {
                            let mapped = IgdbTimeToBeatRaw {
                                hastily: ttb.hastily,
                                normally: ttb.normally,
                                completely: ttb.completely,
                            };
                            time_to_beat_by_game.insert(ttb.game_id, mapped);
                        }
                    } else {
                        eprintln!("IGDB game_time_to_beats parse error for search: {}", text);
                    }
                }
            }
        }
    }

    let mut results = Vec::new();
    for game in igdb_games {
        let mut developers = Vec::new();
        let mut publishers = Vec::new();
        if let Some(ref companies) = game.involved_companies {
            for comp in companies {
                if comp.developer {
                    developers.push(comp.company.name.clone());
                }
                if comp.publisher {
                    publishers.push(comp.company.name.clone());
                }
            }
        }
        
        let developer = if developers.is_empty() { None } else { Some(developers.join("; ")) };
        let publisher = if publishers.is_empty() { None } else { Some(publishers.join("; ")) };
        
        let release_date = game.first_release_date.map(format_unix_timestamp);
        
        let genres = game.genres
            .unwrap_or_default()
            .into_iter()
            .map(|g| g.name)
            .collect::<Vec<_>>();
            
        let themes = game.themes
            .map(|list| list.into_iter().map(|item| item.name).collect::<Vec<_>>());
            
        let game_modes = game.game_modes
            .map(|list| list.into_iter().map(|item| item.name).collect::<Vec<_>>());
            
        let player_perspectives = game.player_perspectives
            .map(|list| list.into_iter().map(|item| item.name).collect::<Vec<_>>());
            
        let cover_url = game.cover
            .and_then(|c| c.url)
            .map(|url| {
                let clean = if url.starts_with("//") { format!("https:{}", url) } else { url };
                clean.replace("t_thumb", "t_cover_big")
            });
            
        let mut screenshot_urls = Vec::new();
        if let Some(screenshots) = game.screenshots {
            for scr in screenshots {
                if let Some(ref url) = scr.url {
                    let clean = if url.starts_with("//") { format!("https:{}", url) } else { url.clone() };
                    screenshot_urls.push(clean.replace("t_thumb", "t_720p"));
                }
            }
        }
        
        let mut artwork_urls = Vec::new();
        if let Some(artworks) = game.artworks {
            for art in artworks {
                if let Some(ref url) = art.url {
                    let clean = if url.starts_with("//") { format!("https:{}", url) } else { url.clone() };
                    artwork_urls.push(clean.replace("t_thumb", "t_720p"));
                }
            }
        }
        
        let hero = artwork_urls.first()
            .or_else(|| screenshot_urls.first())
            .cloned();
            
        let banner = screenshot_urls.first()
            .or_else(|| artwork_urls.first())
            .cloned();
            
        let images = GameImages {
            icon: None,
            cover: cover_url,
            hero,
            banner,
            logo: None,
        };
        
        let videos = game.videos
            .map(|list| {
                list.into_iter()
                    .filter_map(|v| v.video_id.map(|id| format!("https://www.youtube.com/watch?v={}", id)))
                    .collect::<Vec<_>>()
            });
            
        let websites = game.websites
            .map(|list| {
                let mut unique_urls = Vec::new();
                let mut seen = std::collections::HashSet::new();
                for w in list {
                    if let Some(url) = w.url {
                        if seen.insert(url.clone()) {
                            unique_urls.push(url);
                        }
                    }
                }
                unique_urls
            });

        // Map Time to Beat
        let time_to_beat = time_to_beat_by_game.get(&game.id).map(|t| TimeToBeat {
            hastily: t.hastily,
            normally: t.normally,
            completely: t.completely,
        });

        // Map Similar Games
        let similar_games = game.similar_games.map(|list| {
            list.into_iter()
                .map(|g| {
                    let cover_url = g.cover.and_then(|c| c.url).map(|url| {
                        let clean = if url.starts_with("//") { format!("https:{}", url) } else { url };
                        clean.replace("t_thumb", "t_cover_big")
                    });
                    SimilarGame {
                        id: g.id,
                        name: g.name,
                        cover_url,
                    }
                })
                .collect::<Vec<_>>()
        });

        // Map Releases
        let releases = game.release_dates.map(|list| {
            list.into_iter()
                .map(|r| {
                    let platform = r.platform.map(|p| p.name).unwrap_or_else(|| "Unknown".to_string());
                    let date_str = r.human.unwrap_or_else(|| "Unknown".to_string());
                    let region = match r.region {
                        Some(1) => "Europe",
                        Some(2) => "North America",
                        Some(3) => "Australia",
                        Some(4) => "New Zealand",
                        Some(5) => "Japan",
                        Some(6) => "China",
                        Some(7) => "Asia",
                        Some(8) => "Worldwide",
                        Some(9) => "Korea",
                        Some(10) => "Brazil",
                        _ => "Global",
                    }.to_string();
                    ReleaseDateInfo {
                        platform,
                        date_str,
                        region,
                    }
                })
                .collect::<Vec<_>>()
        });

        let igdb_reviews: Option<Vec<IgdbReview>> = None;
        
        let alternative_names = game.alternative_names.as_ref()
            .map(|list| list.iter().map(|a| a.name.clone()).collect::<Vec<_>>());

        let collection = game.collections.as_ref()
            .and_then(|list| list.first().map(|c| c.name.clone()));

        let collection_id = game.collections.as_ref()
            .and_then(|list| list.first().map(|c| c.id));

        let franchise = game.franchises.as_ref()
            .and_then(|list| {
                if list.is_empty() { None }
                else { Some(list.iter().map(|f| f.name.clone()).collect::<Vec<_>>().join("; ")) }
            });

        let game_category = Some(map_game_category(game.game_type.unwrap_or(0)));
        let release_status = Some(map_release_status(game.status.unwrap_or(0)));

        let language_supports = game.language_supports.as_ref().map(|list| {
            list.iter()
                .filter_map(|ls| {
                    let lang = ls.language.as_ref()?.name.clone();
                    let support_type = ls.language_support_type.as_ref()?.name.clone();
                    Some(LanguageSupportInfo {
                        language: lang,
                        support_type,
                    })
                })
                .collect::<Vec<_>>()
        });
            
        results.push(GameMetadataResult {
            title: game.name,
            description: game.summary,
            developer,
            publisher,
            release_date,
            genres,
            images,
            source_url: format!("https://www.igdb.com/games/{}", game.slug),
            source_name: "IGDB".to_string(),
            storyline: game.storyline,
            igdb_rating: game.rating,
            critic_rating: game.aggregated_rating,
            themes,
            game_modes,
            player_perspectives,
            screenshots: if screenshot_urls.is_empty() { None } else { Some(screenshot_urls) },
            videos,
            websites,
            time_to_beat,
            similar_games,
            releases,
            igdb_reviews,
            alternative_names,
            collection,
            collection_id,
            franchise,
            game_category,
            release_status,
            language_supports,
        });
    }
    
    results
}

// ─── Store: Browse & Search IGDB Catalog ──────────────────────────────────────

/// Fetch a page of store games by category from IGDB.
///
/// Categories:
/// - "trending"  → sorted by hypes descending (recent buzz)
/// - "popular"   → sorted by total_rating_count descending (most rated)
/// - "top"       → sorted by rating descending (highest rated)
/// - "all"        → sorted by total_rating_count (browse everything)
// ─── Genre / platform name → IGDB ID lookup tables ─────────────────────
//
// IGDB genre and platform identifiers are stable integers. Frontend
// filters send names (matching `StoreFilterSidebar.GENRES` / `.PLATFORMS`
// exactly) so we don't have to mirror IGDB's IDs across the network.
// Unknown names silently drop out — that way a typo'd facet on the
// frontend doesn't crash the catalog browse.

/// IGDB genre IDs (https://api.igdb.com/v4/genres). Names match
/// the frontend filter sidebar verbatim.
fn genre_name_to_id(name: &str) -> Option<u32> {
    Some(match name {
        "Action" => 4,
        "Adventure" => 31,
        "RPG" => 12,
        "Strategy" => 15,
        "Shooter" => 5,
        "Simulation" => 8,
        "Puzzle" => 9,
        "Racing" => 10,
        "Sports" => 14,
        "Fighting" => 6,
        "Platform" => 8, // IGDB's "Platformer" genre
        "Indie" => 32,
        "Horror" => 19,
        "Visual Novel" => 34,
        _ => return None,
    })
}

/// IGDB platform IDs (https://api.igdb.com/v4/platforms). Names match
/// the frontend filter sidebar verbatim.
fn platform_name_to_id(name: &str) -> Option<u32> {
    Some(match name {
        "PC (Microsoft Windows)" => 6,
        "PlayStation 5" => 167,
        "PlayStation 4" => 48,
        "Xbox Series X|S" => 169,
        "Xbox One" => 12,
        "Nintendo Switch" => 130,
        _ => return None,
    })
}

/// Map a `(year_min, year_max)` pair to IGDB `first_release_date`
/// Unix timestamp bounds. Returns `(None, None)` when both inputs
/// are null; otherwise missing bounds stay open (∞ in that direction).
fn year_bounds_to_timestamps(
    year_min: Option<i32>,
    year_max: Option<i32>,
) -> (Option<i64>, Option<i64>) {
    use chrono::{NaiveDate, TimeZone, Utc};
    let to_min = |y: i32| -> Option<i64> {
        NaiveDate::from_ymd_opt(y, 1, 1)
            .and_then(|d| d.and_hms_opt(0, 0, 0))
            .map(|dt| Utc.from_utc_datetime(&dt).timestamp())
    };
    let to_max = |y: i32| -> Option<i64> {
        // Include the whole year by clamping to Dec 31 23:59:59.
        NaiveDate::from_ymd_opt(y, 12, 31)
            .and_then(|d| d.and_hms_opt(23, 59, 59))
            .map(|dt| Utc.from_utc_datetime(&dt).timestamp())
    };
    (year_min.and_then(to_min), year_max.and_then(to_max))
}

/// Compose the IGDB `where` clause for the supplied category. Returns
/// `(where_clause, sort_clause)`. Empty `where_clause` means no constraint.
fn category_where_sort(category: &str) -> (String, String) {
    use chrono::Utc;
    let now = Utc::now().timestamp();
    match category {
        "trending" => (
            "hypes > 0".to_string(),
            "hypes desc".to_string(),
        ),
        "popular" => (
            "total_rating_count > 5".to_string(),
            "total_rating_count desc".to_string(),
        ),
        "top" => (
            "aggregated_rating > 70".to_string(),
            "aggregated_rating desc".to_string(),
        ),
        "coming_soon" => (
            // Hype-sorted, release date in the next ~6 months.
            format!(
                "hypes > 0 & first_release_date > {} & first_release_date < {}",
                now,
                now + 60 * 60 * 24 * 30 * 6
            ),
            "hypes desc".to_string(),
        ),
        "new_releases" => (
            // Last 30 days of releases.
            format!(
                "first_release_date < {} & first_release_date > {}",
                now + 60 * 60 * 24,
                now - 60 * 60 * 24 * 30
            ),
            "first_release_date desc".to_string(),
        ),
        _ => ("".to_string(), "total_rating_count desc".to_string()),
    }
}

/// Fetch a page of IGDB games for a category, optionally narrowed by
/// genre / platform / release-year / rating filters. Filters are ANDed
/// together with the category clause; any facet set to `None` or empty
/// contributes no constraint.
pub async fn fetch_store_games(
    category: &str,
    offset: u32,
    limit: u32,
    genres: Option<Vec<String>>,
    platforms: Option<Vec<String>>,
    year_min: Option<i32>,
    year_max: Option<i32>,
    rating_min: Option<f64>,
) -> Result<Vec<StoreGameSummary>, String> {
    let token = get_twitch_token().await?;
    let client = http_client();

    let client_id = crate::config::get_twitch_client_id();

    // Resolve the base (where, sort) tuple for the active category
    // (curated IGDB view like `trending` or a pure `-ranked default
    // for `all`), then AND in any optional filter facets the user
    // supplied from the sidebar. An empty `Vec` or `None` for a
    // facet contributes no constraint so the call degrades cleanly.
    let (base_where, base_sort) = category_where_sort(category);
    let mut clauses: Vec<String> = Vec::new();
    if !base_where.is_empty() {
        clauses.push(base_where);
    }

    if let Some(g_names) = genres {
        let ids: Vec<u32> = g_names
            .iter()
            .filter_map(|n| genre_name_to_id(n))
            .collect();
        if !ids.is_empty() {
            clauses.push(format!(
                "genres = ({})",
                ids.iter()
                    .map(|i| i.to_string())
                    .collect::<Vec<_>>()
                    .join(",")
            ));
        }
    }

    if let Some(p_names) = platforms {
        let ids: Vec<u32> = p_names
            .iter()
            .filter_map(|n| platform_name_to_id(n))
            .collect();
        if !ids.is_empty() {
            clauses.push(format!(
                "platforms = ({})",
                ids.iter()
                    .map(|i| i.to_string())
                    .collect::<Vec<_>>()
                    .join(",")
            ));
        }
    }

    // Year filter maps to Unix-timestamp bounds on
    // `first_release_date`. We let the helper choose the precision
    // (year start vs year end-of-day) so timezone slip is avoided.
    let (year_min_ts, year_max_ts) =
        year_bounds_to_timestamps(year_min, year_max);
    if let Some(ts) = year_min_ts {
        clauses.push(format!("first_release_date >= {}", ts));
    }
    if let Some(ts) = year_max_ts {
        clauses.push(format!("first_release_date <= {}", ts));
    }

    if let Some(rating) = rating_min {
        clauses.push(format!("rating >= {}", rating));
    }

    let where_clause = if clauses.is_empty() {
        String::new()
    } else {
        clauses.join(" & ")
    };

    // Compose the IGDB Apicalypse body. The field list mirrors what
    // the Store UI surfaces (cover, genres, platforms, etc.). We also
    // request `websites.url` so the Store hero can render the live
    // Steam concurrent-player badge without an extra round-trip; this
    // adds a few extra bytes per response and zero extra API calls.
    let body = if where_clause.is_empty() {
        format!(
            "fields name,slug,summary,first_release_date,rating,aggregated_rating,cover.url,genres.name,platforms.name,total_rating_count,hypes,follows,websites.url; sort {}; limit {}; offset {};",
            base_sort, limit.min(50), offset
        )
    } else {
        format!(
            "fields name,slug,summary,first_release_date,rating,aggregated_rating,cover.url,genres.name,platforms.name,total_rating_count,hypes,follows,websites.url; where {}; sort {}; limit {}; offset {};",
            where_clause, base_sort, limit.min(50), offset
        )
    };

    let _guard3 = igdb_acquire().await;
    let resp = client
        .post("https://api.igdb.com/v4/games")
        .header("Client-ID", &client_id)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "text/plain")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("IGDB store request failed: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        return Err(format!("IGDB store request failed with status {}: {}", status, err_text));
    }

    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read IGDB response: {}", e))?;

    let games: Vec<IgdbGameSummary> =
        serde_json::from_str(&text).map_err(|e| format!("IGDB parse error: {}", e))?;

    let summaries: Vec<StoreGameSummary> = games
        .into_iter()
        .map(|g| {
            let cover_url = g.cover.and_then(|c| c.url).map(|url| {
                let clean = if url.starts_with("//") {
                    format!("https:{}", url)
                } else {
                    url
                };
                clean.replace("t_thumb", "t_cover_big")
            });

            let release_date = g.first_release_date.map(format_unix_timestamp);

            // De-duped via an inline HashSet so duplicate IGDB entries
            // (rare but observed in the API) don't pollute the JSON
            // payload or the React map over `websites`. Identical
            // query → identical dedupe performance to the GameMetadata
            // path in `search_igdb()` above.
            let websites = g.websites.and_then(|list| {
                let mut unique = Vec::new();
                let mut seen = std::collections::HashSet::new();
                for w in list {
                    if let Some(url) = w.url {
                        if seen.insert(url.clone()) {
                            unique.push(url);
                        }
                    }
                }
                if unique.is_empty() { None } else { Some(unique) }
            });

            StoreGameSummary {
                id: g.id,
                name: g.name,
                slug: g.slug,
                summary: g.summary,
                rating: g.rating,
                aggregated_rating: g.aggregated_rating,
                cover_url,
                genres: g
                    .genres
                    .unwrap_or_default()
                    .into_iter()
                    .map(|gen| gen.name)
                    .collect(),
                platforms: g
                    .platforms
                    .unwrap_or_default()
                    .into_iter()
                    .map(|p| p.name)
                    .collect(),
                first_release_date: release_date,
                total_rating_count: g.total_rating_count.unwrap_or(0),
                hypes: g.hypes.unwrap_or(0),
                websites,
            }
        })
        .collect();

    Ok(summaries)
}

/// Search IGDB games by name (live search with debounce expected from frontend).
pub async fn search_store_games(
    query: &str,
    offset: u32,
    limit: u32,
) -> Result<Vec<StoreGameSummary>, String> {
    let token = get_twitch_token().await?;
    let client = http_client();

    let client_id = crate::config::get_twitch_client_id();

    let escaped = query.replace('"', "\\\"");
    let body = format!(
        r#"search "{}"; fields name,slug,summary,first_release_date,rating,aggregated_rating,cover.url,genres.name,platforms.name,total_rating_count,hypes,websites.url; limit {}; offset {};"#,
        escaped,
        limit.min(50),
        offset
    );

    let _guard4 = igdb_acquire().await;
    let resp = client
        .post("https://api.igdb.com/v4/games")
        .header("Client-ID", &client_id)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "text/plain")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("IGDB search request failed: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        return Err(format!("IGDB search request failed with status {}: {}", status, err_text));
    }

    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read IGDB response: {}", e))?;

    let games: Vec<IgdbGameSummary> =
        serde_json::from_str(&text).map_err(|e| format!("IGDB search parse error: {}", e))?;

    let summaries: Vec<StoreGameSummary> = games
        .into_iter()
        .map(|g| {
            let cover_url = g.cover.and_then(|c| c.url).map(|url| {
                let clean = if url.starts_with("//") {
                    format!("https:{}", url)
                } else {
                    url
                };
                clean.replace("t_thumb", "t_cover_big")
            });

            let release_date = g.first_release_date.map(format_unix_timestamp);

            let websites = g.websites.and_then(|list| {
                let mut unique = Vec::new();
                let mut seen = std::collections::HashSet::new();
                for w in list {
                    if let Some(url) = w.url {
                        if seen.insert(url.clone()) {
                            unique.push(url);
                        }
                    }
                }
                if unique.is_empty() { None } else { Some(unique) }
            });

            StoreGameSummary {
                id: g.id,
                name: g.name,
                slug: g.slug,
                summary: g.summary,
                rating: g.rating,
                aggregated_rating: g.aggregated_rating,
                cover_url,
                genres: g
                    .genres
                    .unwrap_or_default()
                    .into_iter()
                    .map(|gen| gen.name)
                    .collect(),
                platforms: g
                    .platforms
                    .unwrap_or_default()
                    .into_iter()
                    .map(|p| p.name)
                    .collect(),
                first_release_date: release_date,
                total_rating_count: g.total_rating_count.unwrap_or(0),
                hypes: g.hypes.unwrap_or(0),
                websites,
            }
        })
        .collect();

    Ok(summaries)
}

/// Fetch full metadata for a single IGDB game by its slug.
/// Returns the same rich GameMetadataResult used by the library detail page.
pub async fn get_store_game_detail(slug: &str) -> Option<GameMetadataResult> {
    let token = match get_twitch_token().await {
        Ok(t) => t,
        Err(e) => {
            eprintln!("IGDB token error: {}", e);
            return None;
        }
    };

    let client = http_client();

    let escaped_slug = slug.replace('"', "\\\"");
    let body = format!(
        r#"where slug = "{}";
fields name, slug, summary, storyline, first_release_date, rating, aggregated_rating,
       cover.url, screenshots.url, artworks.url, videos.video_id, videos.name,
       genres.name, themes.name, game_modes.name, player_perspectives.name,
       involved_companies.developer, involved_companies.publisher, involved_companies.company.name,
       websites.url, websites.category,
       similar_games.name, similar_games.cover.url,
       release_dates.platform.name, release_dates.human, release_dates.region,
       game_type, status, collections.id, collections.name, franchises.name, alternative_names.name,
       language_supports.language.name, language_supports.language_support_type.name;
limit 1;"#,
        escaped_slug
    );

    let client_id = crate::config::get_twitch_client_id();

    let _guard5 = igdb_acquire().await;
    let resp = match client
        .post("https://api.igdb.com/v4/games")
        .header("Client-ID", &client_id)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "text/plain")
        .body(body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("IGDB detail request error: {}", e);
            return None;
        }
    };

    let status = resp.status();
    if !status.is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        eprintln!("IGDB detail request failed with status {}: {}", status, err_text);
        return None;
    }

    let text = match resp.text().await {
        Ok(t) => t,
        Err(e) => {
            eprintln!("Failed to read IGDB detail response: {}", e);
            return None;
        }
    };

    let mut igdb_games: Vec<IgdbGame> = match serde_json::from_str(&text) {
        Ok(games) => games,
        Err(e) => {
            eprintln!("IGDB detail parse error: {}", e);
            return None;
        }
    };

    let game = igdb_games.pop()?;

    // NOTE: Reviews endpoint (/v4/reviews) was removed from the IGDB public
    // API and returns 404. Reviews are not fetched here; the IgdbReview field
    // is kept for backward compatibility with saved library data only.

    // Fetch time-to-beat for this game
    let mut time_to_beat: Option<IgdbTimeToBeatRaw> = None;
    let ttb_body = format!(
        "fields game_id, hastily, normally, completely; where game_id = {}; limit 1;",
        game.id
    );
    let _guard6 = igdb_acquire().await;
    if let Ok(r) = client
        .post("https://api.igdb.com/v4/game_time_to_beats")
        .header("Client-ID", &client_id)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "text/plain")
        .body(ttb_body)
        .send()
        .await
    {                if r.status().is_success() {
                if let Ok(text) = r.text().await {
                #[derive(Debug, Deserialize)]
                struct IgdbTimeToBeatRawInner {
                    // game_id is required by IGDB Apicalypse deserialization
                    // but unused here (we only fetch one TTB by game.id).
                    #[allow(dead_code)]
                    game_id: u64,
                    hastily: Option<u64>,
                    normally: Option<u64>,
                    completely: Option<u64>,
                }
                if let Ok(raw_ttbs) =
                    serde_json::from_str::<Vec<IgdbTimeToBeatRawInner>>(&text)
                {
                    if let Some(first) = raw_ttbs.into_iter().next() {
                        time_to_beat = Some(IgdbTimeToBeatRaw {
                            hastily: first.hastily,
                            normally: first.normally,
                            completely: first.completely,
                        });
                    }
                } else {
                    eprintln!("IGDB game_time_to_beats parse error for detail: {}", text);
                }
            }
        }
    }

    // Map the IgdbGame → GameMetadataResult
    let mut developers = Vec::new();
    let mut publishers = Vec::new();
    if let Some(ref companies) = game.involved_companies {
        for comp in companies {
            if comp.developer {
                developers.push(comp.company.name.clone());
            }
            if comp.publisher {
                publishers.push(comp.company.name.clone());
            }
        }
    }

    let developer = if developers.is_empty() {
        None
    } else {
        Some(developers.join("; "))
    };
    let publisher = if publishers.is_empty() {
        None
    } else {
        Some(publishers.join("; "))
    };

    let release_date = game.first_release_date.map(format_unix_timestamp);

    let genres: Vec<String> = game
        .genres
        .unwrap_or_default()
        .into_iter()
        .map(|g| g.name)
        .collect();

    let themes = game
        .themes
        .map(|list| list.into_iter().map(|item| item.name).collect::<Vec<_>>());

    let game_modes = game
        .game_modes
        .map(|list| list.into_iter().map(|item| item.name).collect::<Vec<_>>());

    let player_perspectives = game
        .player_perspectives
        .map(|list| list.into_iter().map(|item| item.name).collect::<Vec<_>>());

    let cover_url = game.cover.and_then(|c| c.url).map(|url| {
        let clean = if url.starts_with("//") {
            format!("https:{}", url)
        } else {
            url
        };
        clean.replace("t_thumb", "t_cover_big")
    });

    let mut screenshot_urls = Vec::new();
    if let Some(screenshots) = game.screenshots {
        for scr in screenshots {
            if let Some(ref url) = scr.url {
                let clean = if url.starts_with("//") {
                    format!("https:{}", url)
                } else {
                    url.clone()
                };
                screenshot_urls.push(clean.replace("t_thumb", "t_720p"));
            }
        }
    }

    let mut artwork_urls = Vec::new();
    if let Some(artworks) = game.artworks {
        for art in artworks {
            if let Some(ref url) = art.url {
                let clean = if url.starts_with("//") {
                    format!("https:{}", url)
                } else {
                    url.clone()
                };
                artwork_urls.push(clean.replace("t_thumb", "t_720p"));
            }
        }
    }

    let hero = artwork_urls
        .first()
        .or_else(|| screenshot_urls.first())
        .cloned();

    let banner = screenshot_urls
        .first()
        .or_else(|| artwork_urls.first())
        .cloned();

    let images = GameImages {
        icon: None,
        cover: cover_url,
        hero,
        banner,
        logo: None,
    };

    let videos = game.videos.map(|list| {
        list.into_iter()
            .filter_map(|v| {
                v.video_id
                    .map(|id| format!("https://www.youtube.com/watch?v={}", id))
            })
            .collect::<Vec<_>>()
    });

    let websites = game.websites.map(|list| {
        let mut unique_urls = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for w in list {
            if let Some(url) = w.url {
                if seen.insert(url.clone()) {
                    unique_urls.push(url);
                }
            }
        }
        unique_urls
    });

    let mapped_time_to_beat = time_to_beat.map(|t| TimeToBeat {
        hastily: t.hastily,
        normally: t.normally,
        completely: t.completely,
    });

    let similar_games = game.similar_games.map(|list| {
        list.into_iter()
            .map(|g| {
                let cover_url = g.cover.and_then(|c| c.url).map(|url| {
                    let clean = if url.starts_with("//") {
                        format!("https:{}", url)
                    } else {
                        url
                    };
                    clean.replace("t_thumb", "t_cover_big")
                });
                SimilarGame {
                    id: g.id,
                    name: g.name,
                    cover_url,
                }
            })
            .collect::<Vec<_>>()
    });

    let releases = game.release_dates.map(|list| {
        list.into_iter()
            .map(|r| {
                let platform = r
                    .platform
                    .map(|p| p.name)
                    .unwrap_or_else(|| "Unknown".to_string());
                let date_str = r
                    .human
                    .unwrap_or_else(|| "Unknown".to_string());
                let region = match r.region {
                    Some(1) => "Europe",
                    Some(2) => "North America",
                    Some(3) => "Australia",
                    Some(4) => "New Zealand",
                    Some(5) => "Japan",
                    Some(6) => "China",
                    Some(7) => "Asia",
                    Some(8) => "Worldwide",
                    Some(9) => "Korea",
                    Some(10) => "Brazil",
                    _ => "Global",
                }
                .to_string();
                ReleaseDateInfo {
                    platform,
                    date_str,
                    region,
                }
            })
            .collect::<Vec<_>>()
    });

    let igdb_reviews: Option<Vec<IgdbReview>> = None;

    let alternative_names = game.alternative_names.as_ref()
        .map(|list| list.iter().map(|a| a.name.clone()).collect::<Vec<_>>());

    let collection = game.collections.as_ref()
        .and_then(|list| list.first().map(|c| c.name.clone()));

    let collection_id = game.collections.as_ref()
        .and_then(|list| list.first().map(|c| c.id));

    let franchise = game.franchises.as_ref()
        .and_then(|list| {
            if list.is_empty() { None }
            else { Some(list.iter().map(|f| f.name.clone()).collect::<Vec<_>>().join("; ")) }
        });

    let game_category = Some(map_game_category(game.game_type.unwrap_or(0)));
    let release_status = Some(map_release_status(game.status.unwrap_or(0)));

    let language_supports = game.language_supports.as_ref().map(|list| {
        list.iter()
            .filter_map(|ls| {
                let lang = ls.language.as_ref()?.name.clone();
                let support_type = ls.language_support_type.as_ref()?.name.clone();
                Some(LanguageSupportInfo {
                    language: lang,
                    support_type,
                })
            })
            .collect::<Vec<_>>()
    });

    Some(GameMetadataResult {
        title: game.name,
        description: game.summary,
        developer,
        publisher,
        release_date,
        genres,
        images,
        source_url: format!("https://www.igdb.com/games/{}", game.slug),
        source_name: "IGDB".to_string(),
        storyline: game.storyline,
        igdb_rating: game.rating,
        critic_rating: game.aggregated_rating,
        themes,
        game_modes,
        player_perspectives,
        screenshots: if screenshot_urls.is_empty() {
            None
        } else {
            Some(screenshot_urls)
        },
        videos,
        websites,
        time_to_beat: mapped_time_to_beat,
        similar_games,
        releases,
        igdb_reviews,
        alternative_names,
        collection,
        collection_id,
        franchise,
        game_category,
        release_status,
        language_supports,
    })
}

// ─── Reviews Fetcher (multi-source with fallback) ─────────────────────────────

/// Result of a reviews fetch attempt. `source` is "steam" | "igdb" | "none".
/// The frontend uses `source` to label the reviews correctly in the UI.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReviewFetchResult {
    pub reviews: Vec<IgdbReview>,
    pub source: String,
    pub error: Option<String>,
    /// Total number of reviews returned by Steam (query_summary.total_reviews).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_reviews: Option<u64>,
    /// Cursor for fetching the next page of reviews (Steam cursor-based pagination).
    /// None when there are no more pages.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steam_review_score: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steam_review_score_desc: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steam_total_positive: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steam_total_negative: Option<u64>,
}

/// Fetch reviews for a game from the best available source.
///
/// If `cursor` is provided (non-empty), fetches the next page from Steam.
/// Otherwise starts from the beginning.
pub async fn fetch_game_reviews(
    game_name: &str,
    steam_app_id: Option<u64>,
    cursor: Option<String>,
    language: Option<String>,
    filter_type: Option<String>,
    purchase_type: Option<String>,
    _playtime_min_hours: Option<u32>,
    _playtime_max_hours: Option<u32>,
) -> ReviewFetchResult {
    // ── 1. Steam ──────────────────────────────────────────────────────────
    let app_id_to_try: Option<u64> = match steam_app_id {
        Some(id) => Some(id),
        None => lookup_steam_app_id(game_name).await,
    };

    if let Some(app_id) = app_id_to_try {
        match fetch_steam_reviews(
            app_id,
            &cursor.unwrap_or_default(),
            language.as_deref(),
            filter_type.as_deref(),
            purchase_type.as_deref(),
        )
        .await
        {
            Ok((reviews, total, next_cursor, summary)) if !reviews.is_empty() => {
                return ReviewFetchResult {
                    reviews,
                    source: "steam".to_string(),
                    error: None,
                    total_reviews: Some(total),
                    cursor: next_cursor,
                    steam_review_score: summary.as_ref().map(|s| s.review_score),
                    steam_review_score_desc: summary.as_ref().and_then(|s| s.review_score_desc.clone()),
                    steam_total_positive: summary.as_ref().map(|s| s.total_positive),
                    steam_total_negative: summary.as_ref().map(|s| s.total_negative),
                };
            }
            Ok(_) => {
                // Steam returned 0 reviews — try IGDB before giving up.
            }
            Err(e) => {
                eprintln!("Steam reviews fetch failed for app {}: {}", app_id, e);
            }
        }
    }

    // ── 2. IGDB (best-effort) ─────────────────────────────────────────────
    match fetch_igdb_reviews(game_name).await {
        Ok(reviews) if !reviews.is_empty() => {
            return ReviewFetchResult {
                reviews,
                source: "igdb".to_string(),
                error: None,
                total_reviews: None,
                cursor: None,
                steam_review_score: None,
                steam_review_score_desc: None,
                steam_total_positive: None,
                steam_total_negative: None,
            };
        }
        Ok(_) => {}
        Err(e) => {
            // The endpoint is known to be dead upstream; treat as expected.
            eprintln!("IGDB reviews fetch failed: {}", e);
        }
    }

    ReviewFetchResult {
        reviews: Vec::new(),
        source: "none".to_string(),
        error: Some("No reviews available from any source".to_string()),
        total_reviews: None,
        cursor: None,
        steam_review_score: None,
        steam_review_score_desc: None,
        steam_total_positive: None,
        steam_total_negative: None,
    }
}

/// Look up a Steam app id for a given game name. Returns `None` if no
/// confident match is found. We require a token-based name match: every
/// whitespace-separated word in the query must appear in the result name.
/// This prevents fetching reviews for the wrong game when queries are
/// ambiguous (e.g. "The Witcher" should not silently return reviews for
/// "The Witcher 3" when the user actually has "The Witcher 2").
pub async fn lookup_steam_app_id(game_name: &str) -> Option<u64> {
    let client = http_client();

    let url = format!(
        "https://store.steampowered.com/api/storesearch/?term={}&l=english&cc=us",
        url_encode(game_name)
    );

    let resp = client.get(&url).send().await.ok()?;
    let data: SteamSearchResponse = resp.json().await.ok()?;

    // Normalize: lowercase + collapse whitespace. We use this to compare
    // query words against the result name.
    let query_norm = game_name
        .to_lowercase()
        .split_whitespace()
        .map(|s| s.trim_matches(|c: char| !c.is_alphanumeric()))
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect::<Vec<_>>();

    if query_norm.is_empty() {
        return None;
    }

    data.items.into_iter().find(|item| {
        let name_norm = item.name.to_lowercase();
        query_norm.iter().all(|word| name_norm.contains(word.as_str()))
    }).map(|item| item.id)
}

#[derive(Debug, Deserialize)]
struct SteamReviewResponse {
    success: u32,
    #[serde(default)]
    query_summary: Option<SteamQuerySummary>,
    reviews: Option<Vec<SteamReview>>,
    #[serde(default)]
    cursor: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct SteamQuerySummary {
    #[serde(default)]
    total_reviews: u64,
    #[serde(default)]
    total_positive: u64,
    #[serde(default)]
    total_negative: u64,
    #[serde(default)]
    review_score: u32,
    #[serde(default)]
    review_score_desc: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SteamReview {
    review: Option<String>,
    voted_up: Option<bool>,
    votes_up: Option<u32>,
    votes_funny: Option<u32>,
    language: Option<String>,
    timestamp_created: Option<u64>,
    author: Option<SteamAuthor>,
}

#[derive(Debug, Deserialize)]
struct SteamAuthor {
    steamid: Option<String>,
    personaname: Option<String>,
}

/// Fetch recent reviews from the Steam storefront for a given app id.
///
/// Uses cursor-based pagination. Returns (reviews, total_count, next_cursor, query_summary).
/// `total_count` is the total reviews returned by query_summary.
/// `next_cursor` is None when there are no more pages.
async fn fetch_steam_reviews(
    app_id: u64,
    cursor: &str,
    language: Option<&str>,
    // Both `_filter_type` and `_purchase_type` are intentionally
    // unused at present — they were added for the post-ReviewViewer-
    // parity enhancement pipeline and are kept on the signature so
    // the Tauri command in `lib.rs` continues to compile without
    // a breaking change. Prefix with `_` to silence the
    // `unused_variable` warning without removing the public API.
    _filter_type: Option<&str>,
    _purchase_type: Option<&str>,
) -> Result<(Vec<IgdbReview>, u64, Option<String>, Option<SteamQuerySummary>), String> {
    let client = http_client();

    let cursor_param = if cursor.is_empty() || cursor == "*" {
        "*"
    } else {
        cursor
    };

    // Steam cursors contain characters like '+' and '/' which must be URL-encoded
    // so they are not corrupted or misparsed as space/slashes by the Steam server.
    let encoded_cursor = if cursor_param == "*" {
        "*".to_string()
    } else {
        url_encode(&cursor_param)
    };

    let lang_param = language.unwrap_or("all");
    let url = format!(
        "https://store.steampowered.com/appreviews/{}?json=1&filter=all&language={}&num_per_page=20&purchase_type=all&cursor={}",
        app_id,
        lang_param,
        encoded_cursor
    );

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Steam reviews request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Steam reviews returned HTTP {}", resp.status()));
    }

    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read Steam reviews response: {}", e))?;

    let data: SteamReviewResponse = serde_json::from_str(&text)
        .map_err(|e| format!("Steam reviews parse error: {}", e))?;

    if data.success != 1 {
        return Err("Steam reviews response was not successful".to_string());
    }

    let summary = data.query_summary.clone();
    let total_reviews = data
        .query_summary
        .map(|q| q.total_reviews)
        .unwrap_or(0);
    let next_cursor = data.cursor.filter(|c| !c.is_empty() && c != "*");

    let raw_reviews = data.reviews.unwrap_or_default();

    let reviews = raw_reviews
        .into_iter()
        .filter_map(|r| {
            let content = r.review.filter(|s| !s.trim().is_empty())?;
            let score = if r.voted_up.unwrap_or(false) { 85.0 } else { 35.0 };
            let steamid = r.author.as_ref().and_then(|a| a.steamid.as_ref());
            let display_name = r.author.as_ref()
                .and_then(|a| a.personaname.as_ref())
                .cloned()
                .or_else(|| {
                    steamid.map(|id| {
                        let tail = id.chars().rev().take(4).collect::<String>().chars().rev().collect::<String>();
                        if tail.is_empty() { format!("Steam Player") }
                        else { format!("Steam Player …{}", tail) }
                    })
                });
            Some(IgdbReview {
                title: None,
                content: Some(content),
                rating: Some(score),
                language: r.language,
                votes_up: r.votes_up,
                votes_funny: r.votes_funny,
                timestamp_created: r.timestamp_created,
                username: display_name,
                ..Default::default()
            })
        })
        .collect();

    Ok((reviews, total_reviews, next_cursor, summary))
}

/// Best-effort fetch of reviews from the IGDB `/v4/reviews` endpoint.
///
/// The public IGDB API has removed this endpoint (it returns 404). We still
/// call it because the request is cheap and may be re-enabled in the future.
async fn fetch_igdb_reviews(game_name: &str) -> Result<Vec<IgdbReview>, String> {
    let token = get_twitch_token().await?;
    let client = http_client();

    let client_id = crate::config::get_twitch_client_id();

    let escaped = game_name.replace('"', "\\\"");
    // First, find the game id by name. We can't fetch reviews without an id.
    let search_body = format!(
        r#"search "{}"; fields id; limit 1;"#,
        escaped
    );

    let _guard7 = igdb_acquire().await;
    let search_resp = client
        .post("https://api.igdb.com/v4/games")
        .header("Client-ID", &client_id)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "text/plain")
        .body(search_body)
        .send()
        .await
        .map_err(|e| format!("IGDB search failed: {}", e))?;

    if !search_resp.status().is_success() {
        return Err(format!("IGDB search returned {}", search_resp.status()));
    }

    let search_text = search_resp
        .text()
        .await
        .map_err(|e| format!("Failed to read IGDB search response: {}", e))?;

    #[derive(Debug, Deserialize)]
    struct IgdbIdOnly {
        id: u64,
    }

    let id_hits: Vec<IgdbIdOnly> = serde_json::from_str(&search_text)
        .map_err(|e| format!("IGDB id parse error: {}", e))?;

    let Some(first) = id_hits.into_iter().next() else {
        return Ok(Vec::new());
    };

    // Now query the reviews endpoint for that id. The IGDB schema for reviews:
    //   id, game, user, title, content, rating, positive, negative, etc.
    let reviews_body = format!(
        r#"fields title, content, rating, user; where game = {}; limit 20;"#,
        first.id
    );

    let _guard8 = igdb_acquire().await;
    let resp = client
        .post("https://api.igdb.com/v4/reviews")
        .header("Client-ID", &client_id)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "text/plain")
        .body(reviews_body)
        .send()
        .await
        .map_err(|e| format!("IGDB reviews request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("IGDB reviews returned {}", resp.status()));
    }

    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read IGDB reviews response: {}", e))?;

    #[derive(Debug, Deserialize)]
    struct IgdbReviewRaw {
        title: Option<String>,
        content: Option<String>,
        rating: Option<u32>,
        user: Option<u64>,
    }

    let raw: Vec<IgdbReviewRaw> = serde_json::from_str(&text)
        .map_err(|e| format!("IGDB reviews parse error: {}", e))?;

    let reviews = raw
        .into_iter()
        .map(|r| IgdbReview {
            title: r.title,
            content: r.content,
            rating: r.rating.map(|v| v as f64),
            username: r.user.map(|id| format!("User #{}", id)),
            language: None,
            votes_up: None,
            votes_funny: None,
            timestamp_created: None,
            ..Default::default()
        })
        .collect();

    Ok(reviews)
}

// ─── External Reviews: Metacritic, OpenCritic, RAWG ─────────────────────────

/// Pre-formatted suffix (with leading separator) that callers append to
/// user-visible errors whenever the OpenCritic HTML-scraping path fails
/// for reasons a RapidAPI key would work around (Cloudflare 403/429/503,
/// missing page, etc.). Always concatenate, never format-interpolate
/// alone. Keep in sync with the docs in `.env` setup.
const OPENCRITIC_RAPIDAPI_HINT_SUFFIX: &str =
    " - hint: set OPENCRITIC_RAPIDAPI_KEY at build time or in .env for reliable results";

/// Fetch reviews from an external source (metacritic, opencritic, or rawg).
///
/// Uses direct-slug-first URL resolution with DuckDuckGo HTML search fallback
/// when the direct guess returns 404.
pub async fn fetch_external_reviews(
    game_name: &str,
    source: &str,
) -> Result<Vec<IgdbReview>, String> {
    match source {
        "metacritic" => fetch_metacritic_reviews(game_name).await,
        "opencritic" => fetch_opencritic_reviews(game_name).await,
        "rawg" => fetch_rawg_reviews(game_name).await,
        _ => Err(format!("Unknown review source: {}", source)),
    }
}

/// Convert a game name into a URL-friendly slug.
fn slugify_rust(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

/// Parse a date string like "Jun 20, 2026" to a Unix timestamp (seconds).
fn parse_date_to_timestamp(date_str: &str) -> Option<u64> {
    let trimmed = date_str.trim();
    let months: &[(&str, u32)] = &[
        ("jan", 1), ("feb", 2), ("mar", 3), ("apr", 4),
        ("may", 5), ("jun", 6), ("jul", 7), ("aug", 8),
        ("sep", 9), ("oct", 10), ("nov", 11), ("dec", 12),
    ];

    // Try "Mon DD, YYYY" format
    let parts: Vec<&str> = trimmed.split_whitespace().collect();
    if parts.len() >= 3 {
        let month_str = parts[0].to_lowercase();
        let day_str = parts[1].trim_end_matches(',');
        let year_str = parts[2];

        if let (Ok(day), Ok(year)) = (day_str.parse::<u32>(), year_str.parse::<i32>()) {
            for (name, num) in months {
                if month_str.starts_with(name) {
                    use chrono::{NaiveDate, TimeZone, Utc};
                    if let Some(date) = NaiveDate::from_ymd_opt(year, *num, day) {
                        if let Some(dt) = date.and_hms_opt(0, 0, 0) {
                            return Some(Utc.from_utc_datetime(&dt).timestamp() as u64);
                        }
                    }
                    return None;
                }
            }
        }
    }

    // Try "DD Mon YYYY" format (European)
    if parts.len() >= 3 {
        let day_str = parts[0].trim_end_matches(',');
        let month_str = parts[1].to_lowercase();
        let year_str = parts[2];

        if let (Ok(day), Ok(year)) = (day_str.parse::<u32>(), year_str.parse::<i32>()) {
            for (name, num) in months {
                if month_str.starts_with(name) {
                    use chrono::{NaiveDate, TimeZone, Utc};
                    if let Some(date) = NaiveDate::from_ymd_opt(year, *num, day) {
                        if let Some(dt) = date.and_hms_opt(0, 0, 0) {
                            return Some(Utc.from_utc_datetime(&dt).timestamp() as u64);
                        }
                    }
                    return None;
                }
            }
        }
    }

    None
}

/// Build a shared reqwest client for external review scraping.
/// Build a shared reqwest client for external review scraping.
///
/// Includes browser-like `Accept` and `Accept-Language` headers so we
/// don't get rejected by Cloudflare bot challenges on sites like OpenCritic.
fn external_reviews_client() -> Option<reqwest::Client> {
    use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE};
    let mut headers = HeaderMap::new();
    headers.insert(
        ACCEPT,
        HeaderValue::from_static(
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        ),
    );
    headers.insert(ACCEPT_LANGUAGE, HeaderValue::from_static("en-US,en;q=0.5"));

    reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        .default_headers(headers)
        .timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .ok()
}

/// Resolve a game page URL on a given site by trying the direct slug first,
/// then falling back to a DuckDuckGo HTML search.
async fn resolve_game_url(
    client: &reqwest::Client,
    direct_url: &str,
    site_domain: &str,
    game_name: &str,
) -> Result<String, String> {
    // Step 1: Try direct slug URL
    let resp = client.get(direct_url).send().await.map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        return Ok(direct_url.to_string());
    }

    // Step 2: Fall back to DuckDuckGo HTML search
    let query = format!("site:{} {}", site_domain, game_name);
    let ddg_url = format!(
        "https://html.duckduckgo.com/html/?q={}",
        url_encode(&query)
    );

    let ddg_resp = client
        .get(&ddg_url)
        .send()
        .await
        .map_err(|e| format!("DDG search failed: {}", e))?;

    if !ddg_resp.status().is_success() {
        return Err(format!("DDG search returned {}", ddg_resp.status()));
    }

    let html = ddg_resp
        .text()
        .await
        .map_err(|e| format!("Failed to read DDG response: {}", e))?;

    let doc = scraper::Html::parse_document(&html);

    // Extract the first result link (`.result__a` or `.result__url`)
    let link_sel = scraper::Selector::parse("a.result__a")
        .map_err(|e| e.to_string())?;

    for link in doc.select(&link_sel) {
        if let Some(href) = link.value().attr("href") {
            // DDG result links are wrapped — extract the actual URL
            let decoded = href
                .split("uddg=")
                .nth(1)
                .and_then(|s| s.split('&').next())
                .and_then(|s| {
                    urlencoding::decode(s).ok().map(|d| d.into_owned())
                })
                .unwrap_or_else(|| href.to_string());

            if decoded.contains(site_domain) {
                return Ok(decoded);
            }
        }
    }

    Err(format!(
        "Could not find {} page for '{}'",
        site_domain, game_name
    ))
}

// ── Metacritic User Reviews ──────────────────────────────────────────────────

async fn fetch_metacritic_reviews(game_name: &str) -> Result<Vec<IgdbReview>, String> {
    let client =
        external_reviews_client().ok_or("Failed to create HTTP client")?;

    let slug = slugify_rust(game_name);
    let direct_url = format!("https://www.metacritic.com/game/{}/user-reviews", slug);

    let url = resolve_game_url(&client, &direct_url, "metacritic.com", game_name).await?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Metacritic request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Metacritic returned {}", resp.status()));
    }

    let html = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read Metacritic response: {}", e))?;

    let doc = scraper::Html::parse_document(&html);

    // Primary: Fandom redesign review cards. Fallback: old .review.user_review.
    // Using CSS comma selector so both are tried; scraper::Selector::parse
    // never fails for valid CSS, so .or_else chains are useless for fallbacks.
    let review_sel = scraper::Selector::parse(
        "[data-testid='review-card'], .c-reviews-container--multi-column > div, .review.user_review",
    )
    .map_err(|e| e.to_string())?;

    let username_sel = scraper::Selector::parse("a[href^='/user/']")
        .map_err(|e| e.to_string())?;

    let score_sel = scraper::Selector::parse(
        "[data-testid='review-card-score'] span, .c-siteReviewScore span",
    )
    .map_err(|e| e.to_string())?;

    let date_sel = scraper::Selector::parse(
        "[data-testid='review-card-date'], time, .date",
    )
    .map_err(|e| e.to_string())?;

    let body_sel = scraper::Selector::parse(
        "[data-testid='review-quote-text'], .review_body span, .c-siteReview_quote span",
    )
    .map_err(|e| e.to_string())?;

    let mut reviews = Vec::new();

    for card in doc.select(&review_sel) {
        let username = card
            .select(&username_sel)
            .next()
            .map(|el| el.text().collect::<Vec<_>>().join("").trim().to_string())
            .filter(|s| !s.is_empty());

        let rating = card
            .select(&score_sel)
            .next()
            .and_then(|el| {
                el.text()
                    .collect::<Vec<_>>()
                    .join("")
                    .trim()
                    .parse::<f64>()
                    .ok()
            })
            .map(|v| v * 10.0); // Metacritic scores are 0-10, normalize to 0-100

        let body = card
            .select(&body_sel)
            .map(|el| el.text().collect::<Vec<_>>().join(" "))
            .collect::<Vec<_>>()
            .join(" ")
            .trim()
            .to_string();

        let date_str = card
            .select(&date_sel)
            .next()
            .and_then(|el| el.value().attr("datetime"))
            .map(|s| s.to_string())
            .or_else(|| {
                card.select(&date_sel).next().map(|el| {
                    el.text().collect::<Vec<_>>().join("").trim().to_string()
                })
            });

        let timestamp_created = date_str
            .as_ref()
            .and_then(|s| parse_date_to_timestamp(s));

        if body.is_empty() && username.is_none() {
            continue;
        }

        reviews.push(IgdbReview {
            title: None,
            content: if body.is_empty() { None } else { Some(body) },
            rating,
            username,
            language: None,
            votes_up: None,
            votes_funny: None,
            timestamp_created,
            ..Default::default()
        });
    }

    Ok(reviews)
}

/// Resolve an OpenCritic game page URL.
///
/// OpenCritic's `/search?criteria=...` always returns HTTP 200, which would
/// incorrectly trip `resolve_game_url`'s success check and skip the DDG
/// fallback. So we pass a guaranteed-404 sentinel URL (`/game/0/{slug}`)
/// to make the DuckDuckGo fallback always run and locate the real game
/// page (if any). When a RapidAPI key is available, prefer
/// `fetch_opencritic_via_rapidapi` which gets scores directly without
/// needing a page URL.
async fn resolve_opencritic_url(
    client: &reqwest::Client,
    game_name: &str,
) -> Result<String, String> {
    let slug = slugify_rust(game_name);
    let sentinel = format!("https://opencritic.com/game/0/{}", slug);
    resolve_game_url(client, &sentinel, "opencritic.com", game_name).await
}

// ── OpenCritic RapidAPI types (matching Playnite OpenCriticMetadata extension) ──

#[derive(Debug, Deserialize)]
struct OcSearchItem {
    id: u64,
    name: String,
    #[serde(default)]
    relation: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OcGameDetail {
    #[allow(dead_code)]
    id: u64,
    #[allow(dead_code)]
    name: String,
    #[serde(default)]
    #[allow(dead_code)]
    description: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    has_lootboxes: Option<bool>,
    #[serde(default)]
    #[allow(dead_code)]
    is_major_release: bool,
    #[serde(default)]
    num_reviews: i32,
    #[serde(default)]
    #[allow(dead_code)]
    num_top_critic_reviews: i32,
    #[serde(default)]
    median_score: Option<f64>,
    #[serde(default)]
    top_critic_score: Option<f64>,
    #[serde(default)]
    #[allow(dead_code)]
    percentile: Option<f64>,
    #[serde(default)]
    percent_recommended: Option<f64>,
    #[serde(default)]
    #[allow(dead_code)]
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OcUserRatings {
    #[serde(default)]
    median: Option<f64>,
    #[serde(default)]
    count: i32,
}

/// Search OpenCritic via RapidAPI and return the best-matching game ID.
async fn search_opencritic_via_rapidapi(
    client: &reqwest::Client,
    game_name: &str,
    api_key: &str,
) -> Result<(u64, String, String), String> {
    let query = game_name.replace(' ', "+");
    let search_url = format!(
        "https://opencritic-api.p.rapidapi.com/meta/search?criteria={}",
        query
    );

    let resp = client
        .get(&search_url)
        .header("x-rapidapi-host", "opencritic-api.p.rapidapi.com")
        .header("x-rapidapi-key", api_key)
        .send()
        .await
        .map_err(|e| format!("RapidAPI search failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("RapidAPI search returned {}", resp.status()));
    }

    let items: Vec<OcSearchItem> = resp
        .json()
        .await
        .map_err(|e| format!("RapidAPI search parse error: {}", e))?;

    // Prefer relation == "game", fall back to first result
    let game = items
        .iter()
        .find(|item| item.relation.as_deref() == Some("game"))
        .or_else(|| items.first())
        .ok_or_else(|| format!("No results found for '{}'", game_name))?;

    Ok((game.id, game.name.clone(), game.relation.clone().unwrap_or_default()))
}

/// Fetch OpenCritic game detail via RapidAPI (same endpoint used by Playnite extension).
async fn fetch_opencritic_game_detail(
    client: &reqwest::Client,
    game_id: u64,
    api_key: &str,
) -> Result<OcGameDetail, String> {
    let url = format!("https://opencritic-api.p.rapidapi.com/game/{}", game_id);

    let resp = client
        .get(&url)
        .header("x-rapidapi-host", "opencritic-api.p.rapidapi.com")
        .header("x-rapidapi-key", api_key)
        .send()
        .await
        .map_err(|e| format!("RapidAPI game/{} failed: {}", game_id, e))?;

    if !resp.status().is_success() {
        return Err(format!("RapidAPI game/{} returned {}", game_id, resp.status()));
    }

    resp.json()
        .await
        .map_err(|e| format!("RapidAPI game/{} parse error: {}", game_id, e))
}

/// Fetch OpenCritic user/community ratings via RapidAPI.
async fn fetch_opencritic_user_ratings(
    client: &reqwest::Client,
    game_id: u64,
    api_key: &str,
) -> Result<OcUserRatings, String> {
    let url = format!("https://opencritic-api.p.rapidapi.com/ratings/game/{}", game_id);

    let resp = client
        .get(&url)
        .header("x-rapidapi-host", "opencritic-api.p.rapidapi.com")
        .header("x-rapidapi-key", api_key)
        .send()
        .await
        .map_err(|e| format!("RapidAPI ratings/game/{} failed: {}", game_id, e))?;

    if !resp.status().is_success() {
        return Err(format!("RapidAPI ratings/game/{} returned {}", game_id, resp.status()));
    }

    resp.json()
        .await
        .map_err(|e| format!("RapidAPI ratings/game/{} parse error: {}", game_id, e))
}

/// Fetch OpenCritic scores via RapidAPI and return them as aggregate IgdbReview entries.
/// This is the primary path when OPENCRITIC_RAPIDAPI_KEY is configured.
async fn fetch_opencritic_via_rapidapi(
    client: &reqwest::Client,
    game_name: &str,
    api_key: &str,
) -> Result<Vec<IgdbReview>, String> {
    let (game_id, _oc_name, _relation) =
        search_opencritic_via_rapidapi(client, game_name, api_key).await?;

    // Fetch game detail and user ratings in parallel (matching Playnite extension pattern)
    let (detail_res, ratings_res) = tokio::join!(
        fetch_opencritic_game_detail(client, game_id, api_key),
        fetch_opencritic_user_ratings(client, game_id, api_key),
    );

    let detail = detail_res?;
    let ratings = ratings_res.unwrap_or(OcUserRatings { median: None, count: 0 });
    let oc_name = &detail.name;

    let mut reviews = Vec::new();

    // Build critic score summary review
    let mut critic_parts: Vec<String> = Vec::new();
    if let Some(median) = detail.median_score {
        critic_parts.push(format!("Median Score: {:.0}/100", median.round()));
    }
    if let Some(top) = detail.top_critic_score {
        critic_parts.push(format!("Top Critics: {:.0}/100", top.round()));
    }
    if detail.num_reviews > 0 {
        critic_parts.push(format!("Based on {} critic reviews", detail.num_reviews));
    }
    if let Some(pct) = detail.percent_recommended {
        critic_parts.push(format!("Recommended by {:.0}% of critics", pct));
    }
    if !critic_parts.is_empty() {
        let score = detail.median_score.or(detail.top_critic_score);
        reviews.push(IgdbReview {
            title: Some(format!("OpenCritic Critics — {}", oc_name)),
            content: Some(critic_parts.join(". ") + "."),
            rating: score,
            username: Some("OpenCritic Critics".to_string()),
            language: None,
            votes_up: None,
            votes_funny: None,
            timestamp_created: None,
            ..Default::default()
        });
    }

    // Build community score summary review
    if ratings.count > 0 || ratings.median.is_some() {
        let mut community_parts: Vec<String> = Vec::new();
        if let Some(median) = ratings.median {
            community_parts.push(format!("Median Score: {:.1}/5", median));
        }
        if ratings.count > 0 {
            community_parts.push(format!("Based on {} player ratings", ratings.count));
        }
        if !community_parts.is_empty() {
            let score = ratings.median.map(|v| v * 20.0); // Normalize 0-5 to 0-100
            reviews.push(IgdbReview {
                title: Some(format!("OpenCritic Community — {}", oc_name)),
                content: Some(community_parts.join(". ") + "."),
                rating: score,
                username: Some("OpenCritic Community".to_string()),
                language: None,
                votes_up: Some(ratings.count as u32),
                votes_funny: None,
                timestamp_created: None,
                ..Default::default()
            });
        }
    }

    if reviews.is_empty() {
        return Err(format!("No scores available on OpenCritic for '{}'", game_name));
    }

    Ok(reviews)
}

async fn fetch_opencritic_reviews(game_name: &str) -> Result<Vec<IgdbReview>, String> {
    let client =
        external_reviews_client().ok_or("Failed to create HTTP client")?;

    // ── 1. RapidAPI (primary, if key is configured) ───────────────────
    let rapidapi_key = crate::config::get_opencritic_rapidapi_key();
    if !rapidapi_key.is_empty() {
        match fetch_opencritic_via_rapidapi(&client, game_name, &rapidapi_key).await {
            Ok(reviews) if !reviews.is_empty() => return Ok(reviews),
            Ok(_) => {} // empty reviews, fall through to HTML scraping
            Err(e) => eprintln!("OpenCritic RapidAPI failed: {} — falling back to HTML scraping", e),
        }
    }

    // ── 2. HTML scraping fallback ──────────────────────────────────────
    // The URL resolver returns an error verbatim (DDG fallback also failed).
    // Surface a hint about OPENCRITIC_RAPIDAPI_KEY so the toast in
    // ReviewsTab.tsx tells the user how to get reliable results.
    let detail_url = resolve_opencritic_url(&client, game_name)
        .await
        .map_err(|e| format!("{}{}", e, OPENCRITIC_RAPIDAPI_HINT_SUFFIX))?;

    let resp = client
        .get(&detail_url)
        .send()
        .await
        .map_err(|e| format!(
            "OpenCritic detail request failed: {}{}",
            e,
            OPENCRITIC_RAPIDAPI_HINT_SUFFIX,
        ))?;

    if !resp.status().is_success() {
        // Any non-2xx in this HTML-scraping block means we can't reach the
        // real OpenCritic page (Cloudflare 401/403/429/503, missing page,
        // redirected to a challenge). The RapidAPI path bypasses all of
        // those, so the hint is always relevant here.
        return Err(format!(
            "OpenCritic returned {}{}",
            resp.status(),
            OPENCRITIC_RAPIDAPI_HINT_SUFFIX,
        ));
    }

    let html = resp
        .text()
        .await
        .map_err(|e| format!(
            "Failed to read OpenCritic response: {}{}",
            e,
            OPENCRITIC_RAPIDAPI_HINT_SUFFIX,
        ))?;

    let doc = scraper::Html::parse_document(&html);

    // Try embedded JSON state first (Angular SSR)
    if let Some(reviews) = extract_opencritic_json_reviews(&doc) {
        if !reviews.is_empty() {
            return Ok(reviews);
        }
    }

    // Fallback: scrape <app-review-card> elements
    let card_sel = scraper::Selector::parse("app-review-card")
        .map_err(|e| e.to_string())?;

    let outlet_sel = scraper::Selector::parse("h4 > a[href^='/outlet/']")
        .map_err(|e| e.to_string())?;

    let author_sel = scraper::Selector::parse(".author > a[href^='/critic/']")
        .map_err(|e| e.to_string())?;

    let score_sel = scraper::Selector::parse(".score")
        .map_err(|e| e.to_string())?;

    let snippet_sel = scraper::Selector::parse("p.font-small.grey-dark-text")
        .map_err(|e| e.to_string())?;

    let date_sel = scraper::Selector::parse(".date, time")
        .map_err(|e| e.to_string())?;

    let mut reviews = Vec::new();

    for card in doc.select(&card_sel) {
        let outlet = card
            .select(&outlet_sel)
            .next()
            .map(|el| el.text().collect::<Vec<_>>().join("").trim().to_string());

        let author = card
            .select(&author_sel)
            .next()
            .map(|el| el.text().collect::<Vec<_>>().join("").trim().to_string());

        let username = match (author, outlet) {
            (Some(a), Some(o)) => Some(format!("{} (via {})", a, o)),
            (Some(a), None) => Some(a),
            (None, Some(o)) => Some(o),
            (None, None) => None,
        };

        let rating = card
            .select(&score_sel)
            .next()
            .and_then(|el| {
                let text = el.text().collect::<Vec<_>>().join("").trim().to_string();
                parse_opencritic_score(&text)
            });

        let content = card
            .select(&snippet_sel)
            .next()
            .map(|el| el.text().collect::<Vec<_>>().join(" ").trim().to_string())
            .filter(|s| !s.is_empty());

        let timestamp_created = card
            .select(&date_sel)
            .next()
            .and_then(|el| el.value().attr("datetime"))
            .and_then(|s| parse_date_to_timestamp(s))
            .or_else(|| {
                card.select(&date_sel).next().and_then(|el| {
                    let t = el.text().collect::<Vec<_>>().join("").trim().to_string();
                    parse_date_to_timestamp(&t)
                })
            });

        if content.is_none() && username.is_none() {
            continue;
        }

        reviews.push(IgdbReview {
            title: None,
            content,
            rating,
            username,
            language: None,
            votes_up: None,
            votes_funny: None,
            timestamp_created,
            ..Default::default()
        });
    }

    Ok(reviews)
}

// ── OpenCritic Critic Reviews ─────────────────────────────────────────────────

fn extract_opencritic_json_reviews(doc: &scraper::Html) -> Option<Vec<IgdbReview>> {
    let script_sel = scraper::Selector::parse("script#serverApp-state[type='application/json']")
        .ok()?;

    let json_text = doc
        .select(&script_sel)
        .next()
        .map(|el| el.text().collect::<Vec<_>>().join(""))?;

    // OpenCritic Angular SSR HTML-encodes JSON (e.g. &q; for double-quote).
    // Decode the five standard XML entities before serde parsing.
    let decoded_text = json_text
        .replace("&q;", "\"")
        .replace("&s;", "'")
        .replace("&a;", "&")
        .replace("&l;", "<")
        .replace("&g;", ">");

    // Try to parse and navigate the JSON tree
    let parsed: serde_json::Value = serde_json::from_str(&decoded_text).ok()?;

    // Navigate: Find any key matching "game/*/reviews" or "game/*/landing"
    let reviews_val = find_json_reviews(&parsed)?;
    let arr = reviews_val.as_array()?;

    let mut reviews = Vec::new();

    for item in arr {
        let author = item.get("Authors").and_then(|v| v.as_array()).and_then(|authors| {
            authors.first()?.get("name")?.as_str()
        });

        let outlet = item.get("Outlet").and_then(|v| v.get("name")).and_then(|v| v.as_str());

        let username = match (author, outlet) {
            (Some(a), Some(o)) => Some(format!("{} (via {})", a, o)),
            (Some(a), None) => Some(a.to_string()),
            (None, Some(o)) => Some(o.to_string()),
            (None, None) => None,
        };

        let rating = item
            .get("npScore")
            .or_else(|| item.get("score"))
            .and_then(|v| v.as_f64());

        let content = item
            .get("snippet")
            .or_else(|| item.get("quote"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty());

        let timestamp_created = item
            .get("publishedDate")
            .or_else(|| item.get("date"))
            .and_then(|v| v.as_str())
            .and_then(|s| parse_date_to_timestamp(s));

        if content.is_none() && username.is_none() {
            continue;
        }

        reviews.push(IgdbReview {
            title: None,
            content,
            rating,
            username,
            language: None,
            votes_up: None,
            votes_funny: None,
            timestamp_created,
            ..Default::default()
        });
    }

    if reviews.is_empty() {
        None
    } else {
        Some(reviews)
    }
}

/// Walk the OpenCritic JSON state to find the reviews array.
fn find_json_reviews<'a>(value: &'a serde_json::Value) -> Option<&'a serde_json::Value> {
    match value {
        serde_json::Value::Object(map) => {
            for (key, val) in map {
                // Match both /reviews and /landing keys (both contain review data)
                if (key.starts_with("game/") || key.starts_with("q:game/")) && (key.contains("/reviews") || key.contains("/landing")) {
                    if let Some(arr) = val.as_array() {
                        if !arr.is_empty() {
                            return Some(val);
                        }
                    }
                }
            }
            // Recursively search
            for val in map.values() {
                if let Some(found) = find_json_reviews(val) {
                    return Some(found);
                }
            }
            None
        }
        serde_json::Value::Array(arr) => {
            for item in arr {
                if let Some(found) = find_json_reviews(item) {
                    return Some(found);
                }
            }
            None
        }
        _ => None,
    }
}

/// Parse an OpenCritic score string like "4/5", "85", or "Recommended".
fn parse_opencritic_score(text: &str) -> Option<f64> {
    let trimmed = text.trim().to_lowercase();

    // Keywords
    if trimmed.contains("essential") || trimmed.contains("masterpiece") {
        return Some(100.0);
    }
    if trimmed.contains("recommended") || trimmed.contains("great") {
        return Some(85.0);
    }
    if trimmed.contains("mixed") || trimmed.contains("fair") {
        return Some(60.0);
    }
    if trimmed.contains("skip") || trimmed.contains("poor") || trimmed.contains("weak") {
        return Some(30.0);
    }

    // "X/Y" format
    if let Some(slash_pos) = trimmed.find('/') {
        let num = trimmed[..slash_pos].trim().parse::<f64>().ok()?;
        let den = trimmed[slash_pos + 1..].trim().parse::<f64>().ok()?;
        if den > 0.0 {
            return Some((num / den) * 100.0);
        }
    }

    // Plain number
    trimmed.parse::<f64>().ok()
}

// ── RAWG User Reviews ────────────────────────────────────────────────────────

async fn fetch_rawg_reviews(game_name: &str) -> Result<Vec<IgdbReview>, String> {
    let client =
        external_reviews_client().ok_or("Failed to create HTTP client")?;

    let slug = slugify_rust(game_name);
    let direct_url = format!("https://rawg.io/games/{}/reviews", slug);

    let url = resolve_game_url(
        &client,
        &direct_url,
        "rawg.io",
        game_name,
    )
    .await?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("RAWG request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("RAWG returned {}", resp.status()));
    }

    let html = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read RAWG response: {}", e))?;

    let doc = scraper::Html::parse_document(&html);

    let card_sel = scraper::Selector::parse(
        ".review-card.review-card_common, .review-card.review-card_full",
    )
    .map_err(|e| e.to_string())?;

    let username_sel = scraper::Selector::parse(
        ".review-card__user-link, .review-card__user a",
    )
    .map_err(|e| e.to_string())?;

    let date_sel = scraper::Selector::parse(
        ".review-card__date, .review-card__info time",
    )
    .map_err(|e| e.to_string())?;

    let rating_sel = scraper::Selector::parse(
        ".rating__text, .review-card__rating, .review-card__rating-text",
    )
    .map_err(|e| e.to_string())?;

    let body_sel = scraper::Selector::parse(
        ".review-card__text, .truncate-block__wrapper div, .review-card__content",
    )
    .map_err(|e| e.to_string())?;

    let mut reviews = Vec::new();

    for card in doc.select(&card_sel) {
        let username = card
            .select(&username_sel)
            .next()
            .map(|el| el.text().collect::<Vec<_>>().join("").trim().to_string())
            .filter(|s| !s.is_empty());

        let rating = card
            .select(&rating_sel)
            .next()
            .and_then(|el| {
                let text = el
                    .text()
                    .collect::<Vec<_>>()
                    .join("")
                    .trim()
                    .to_lowercase();
                parse_rawg_rating(&text)
            });

        let content = card
            .select(&body_sel)
            .map(|el| el.text().collect::<Vec<_>>().join(" "))
            .collect::<Vec<_>>()
            .join(" ")
            .trim()
            .to_string();

        let timestamp_created = card
            .select(&date_sel)
            .next()
            .and_then(|el| el.value().attr("datetime"))
            .and_then(|s| parse_date_to_timestamp(s))
            .or_else(|| {
                card.select(&date_sel).next().and_then(|el| {
                    let t = el.text().collect::<Vec<_>>().join("").trim().to_string();
                    parse_date_to_timestamp(&t)
                })
            });

        if content.is_empty() && username.is_none() {
            continue;
        }

        reviews.push(IgdbReview {
            title: None,
            content: if content.is_empty() { None } else { Some(content) },
            rating,
            username,
            language: None,
            votes_up: None,
            votes_funny: None,
            timestamp_created,
            ..Default::default()
        });
    }

    Ok(reviews)
}

/// Map RAWG rating text to a normalized 0-100 score.
fn parse_rawg_rating(text: &str) -> Option<f64> {
    let t = text.trim().to_lowercase();
    match t {
        s if s.contains("exceptional") || s.contains("masterpiece") => Some(95.0),
        s if s.contains("recommended") || s.contains("great") => Some(80.0),
        s if s.contains("meh") || s.contains("mixed") || s.contains("okay") => Some(50.0),
        s if s.contains("skip") || s.contains("poor") || s.contains("bad") => Some(25.0),
        _ => {
            // Try parsing as a numeric score
            t.parse::<f64>().ok()
        }
    }
}

// ─── Utility Functions ────────────────────────────────────────────────────────

/// Simple URL encoding (only safe chars pass through).
fn url_encode(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                result.push(byte as char);
            }
            b' ' => result.push_str("%20"),
            _ => {
                result.push_str(&format!("%{:02X}", byte));
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_url_encode_spaces() {
        assert_eq!(url_encode("hello world"), "hello%20world");
    }

    #[test]
    fn test_url_encode_special_chars() {
        let encoded = url_encode("AC/DC: Back in Black");
        assert!(!encoded.contains(' '));
        assert!(encoded.contains("%2F"));
    }

    #[test]
    fn test_base64_roundtrip() {
        let input = b"Hello, World!";
        let encoded = base64_encode(input);
        // Decode manually to verify
        assert_eq!(encoded, "SGVsbG8sIFdvcmxkIQ==");
    }

    #[tokio::test]
    async fn test_search_igdb() {
        let results = search_igdb("Portal 2").await;
        println!("IGDB results count: {}", results.len());
        assert!(!results.is_empty());
    }
}






// ─── Collection Lookup (Game Relations card) ───────────────────────────────
//
// Fetch every game that belongs to a given IGDB collection.
//
// The frontend Game Relations card uses this to populate the
// "Other in Collection" group on the Store game detail page.
// We deliberately use IGDB's `where collections = {id}` filter
// on `/v4/games` directly rather than calling
// `/v4/collections/{id}` first to get the member IDs — the
// single-call approach is both faster (1 round-trip vs 2) and
// lets us request the full `StoreGameSummary` field set in one
// pass.
//
// Returns results sorted by `first_release_date` ascending so the
// user sees the series in chronological order, with the current
// game visible in context (it's not excluded — the frontend
// de-duplicates if needed).
pub async fn get_collection_games(
    collection_id: u64,
    limit: u32,
) -> Result<Vec<StoreGameSummary>, String> {
    let token = get_twitch_token().await?;
    let client = http_client();
    let client_id = crate::config::get_twitch_client_id();

    // Field list mirrors the one used by `fetch_store_games` so
    // the returned `StoreGameSummary` shape is identical to
    // what the Store grid expects. The `limit` is clamped to 50
    // (IGDB's per-request max) to avoid silent truncation.
    let body = format!(
        r#"fields name,slug,summary,first_release_date,rating,aggregated_rating,cover.url,genres.name,platforms.name,total_rating_count,hypes,websites.url;
where collections = ({});
sort first_release_date asc;
limit {};
offset 0;"#,
        collection_id,
        limit.min(50),
    );

    let _guard = igdb_acquire().await;
    let resp = client
        .post("https://api.igdb.com/v4/games")
        .header("Client-ID", &client_id)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "text/plain")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("IGDB collection games request failed: {}", e))?;

    if !resp.status().is_success() {
        // Capture the status BEFORE consuming the body via
        // `resp.text()` — `text` takes `self` by value and
        // moves `resp`, so a subsequent `resp.status()` call
        // would be a borrow-of-moved-value error.
        let status = resp.status();
        let err_text = resp.text().await.unwrap_or_default();
        return Err(format!(
            "IGDB collection games failed with status {}: {}",
            status,
            err_text
        ));
    }

    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read IGDB response: {}", e))?;

    // Reuse the same `IgdbGameSummary` parser + `StoreGameSummary`
    // mapper as `fetch_store_games` so the returned objects are
    // bit-for-bit identical (same field set, same cover-URL
    // size, same website dedup). The mapping logic is duplicated
    // rather than extracted because Rust's `fn` returns own
    // their values and the mapper is short enough that the
    // duplication is cheaper than the trait/generic overhead.
    let games: Vec<IgdbGameSummary> =
        serde_json::from_str(&text).map_err(|e| format!("IGDB collection games parse error: {}", e))?;

    let summaries: Vec<StoreGameSummary> = games
        .into_iter()
        .map(|g| {
            let cover_url = g.cover.and_then(|c| c.url).map(|url| {
                let clean = if url.starts_with("//") {
                    format!("https:{}", url)
                } else {
                    url
                };
                clean.replace("t_thumb", "t_cover_big")
            });

            let release_date = g.first_release_date.map(format_unix_timestamp);

            let websites = g.websites.and_then(|list| {
                let mut unique = Vec::new();
                let mut seen = std::collections::HashSet::new();
                for w in list {
                    if let Some(url) = w.url {
                        if seen.insert(url.clone()) {
                            unique.push(url);
                        }
                    }
                }
                if unique.is_empty() { None } else { Some(unique) }
            });

            StoreGameSummary {
                id: g.id,
                name: g.name,
                slug: g.slug,
                summary: g.summary,
                rating: g.rating,
                aggregated_rating: g.aggregated_rating,
                cover_url,
                genres: g
                    .genres
                    .unwrap_or_default()
                    .into_iter()
                    .map(|gen| gen.name)
                    .collect(),
                platforms: g
                    .platforms
                    .unwrap_or_default()
                    .into_iter()
                    .map(|p| p.name)
                    .collect(),
                first_release_date: release_date,
                total_rating_count: g.total_rating_count.unwrap_or(0),
                hypes: g.hypes.unwrap_or(0),
                websites,
            }
        })
        .collect();

    Ok(summaries)
}
