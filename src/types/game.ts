/** Generate a URL-safe slug from a game name (for store navigation). */
export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export interface Game {
  id: string;
  name: string;
  path: string; // full path to the game executable
  platform: string; // e.g., "Local", "Steam", "GOG"
  installed: boolean;
  playTime: string;
  addedAt: number; // timestamp
  coverArtUrl?: string; // base64 data URL for cover art image (used in library cards)
  iconUrl?: string; // base64 data URL for small square icon (used in sidebar)
  notes?: string; // user notes about the game
  /** Total disk footprint of the game's root folder in bytes (undefined = not yet measured). */
  sizeBytes?: number;
  /** ISO-8601 timestamp of the last successful size detection, used for the "Last seen" staleness UI. */
  sizeDetectedAt?: string;
  /** The folder the size was measured against (or the user picked). Auditable from the size-edit modal. */
  sizeRootPath?: string;
  /** Steam AppID if sourced from Steam (used for sync and store links) */
  steamAppId?: number;
  /** Epic Games Store namespace (used for sync and store links) */
  epicNamespace?: string;
  /** Epic Games Store catalog item ID */
  epicCatalogItemId?: string;
  /** The exe path that the game watcher detected at runtime.
   *  Set when the game was resolved via PE-header analysis during
   *  sync, or discovered dynamically by the passive process poll.
   *  Distinct from `path` (which is user-set or from old sync). */
  detectedExe?: string;
  /** Playtime in minutes reported by Steam (used as fallback for playTime) */
  steamPlaytime?: number;
  /** ── GOG Galaxy integration fields ──────────────────────────
   *  Mirrors the Steam integration shape so the Library page
   *  filter sidebar can tag GOG-synced titles uniformly. */
  /** GOG numeric product id (e.g. `1207658925`). Drives the
   *  gog-`{id}` slug used by the GameRelationsCard and Store
   *  coverage check. Stored as `string` because GOG is inconsistent
   *  about returning the id as JSON number vs stringified integer. */
  gogGameId?: string;
  /** ── Humble Bundle integration fields ─────────────────────────
   *  Mirrors the GOG/Steam shape so the Library filter sidebar can
   *  tag Humble-synced titles uniformly. */
  /** Stable Humble game id: `<machineName>_<humanName>` for orders,
   *  `<machineName>` for Trove, `humble_extras_…` for extras. */
  humbleGameId?: string;
  /** True when sourced from the Humble Trove catalog (subscriber
   *  streaming library) — drives `humble://launch/` behaviour. */
  humbleIsTrove?: boolean;
  /** True when this entry is a non-game extra (soundtrack/artbook/…). */
  humbleIsExtra?: boolean;
  /** Playtime in minutes reported by the GOG gameplay endpoint
    *  `https://gameplay.gog.com/clients/<user_id>/playtime`. */
  gogPlaytime?: number;
  /** ── Rockstar Games Launcher integration fields ──────────────
    *  Mirrors the GOG/Steam/Epic shape so the Library filter
    *  sidebar can tag Rockstar-synced titles uniformly. Rockstar
    *  has no cloud library API, so these only appear for titles
    *  detected as installed via the Rockstar Games Launcher. */
  /** Rockstar `TitleId` (e.g. `"gta5"`, `"rdr2"`). Drives the
    *  `rockstar-<titleId>` game id and launcher launch/uninstall. */
  rockstarTitleId?: string;
  /** ── Ubisoft Connect (Uplay) integration fields ──────────────
   *  Mirrors the GOG/Steam/Epic/Rockstar shape so the Library filter
   *  sidebar can tag Ubisoft-synced titles uniformly. */
  /** Ubisoft `uplay_id` — drives the `uplay-<id>` game id and the
   *  `uplay://launch/<id>` launch protocol. */
  uplayGameId?: string;
  /** True when this entry was imported from Ubisoft Connect
   *  (drives `uplay://launch/<id>` behaviour). */
  uplayIsConnect?: boolean;
  /** Achievement completion data synced from Steam */
  steamAchievements?: SteamAchievement[];
  /**
   * Unix-millisecond timestamp of the most recent session exit for this
   * game. Stamped by the Rust `GameWatcher.finish_session` hook when a
   * game process terminates (whether launched through Gamelib or
   * detected passively). Drives the Library page's "Continue Playing"
   * rail — games with `lastPlayed` within the last 14 days surface in
   * that section. Persisted automatically by the existing `save_games`
   * round-trip; no separate write path needed.
   *
   * `undefined` until the first session ends (newly imported games
   * won't have a value until they're launched and closed).
   */
  lastPlayed?: number;
  /** Store source for metadata; drives the GamePage store selector */
  storeSource?: StoreSource;
  /** Fetched metadata fields */
  description?: string;
  developer?: string;
  publisher?: string;
  releaseDate?: string;
  genres?: string[];
  bannerUrl?: string; // base64 data URL for hero/banner image (used at top of game page)
  logoUrl?: string; // base64 data URL for logo/title image
  metadataSource?: string; // e.g., "Steam", "IGDB"
  metadataUrl?: string; // source page URL
  rating?: number; // user rating (1-5 stars)
  reviewText?: string; // user review text
  storyline?: string;
  igdbRating?: number; // IGDB community rating (0-100)
  criticRating?: number; // IGDB critic rating (0-100)
  themes?: string[];
  gameModes?: string[];
  playerPerspectives?: string[];
  screenshots?: string[];
  videos?: string[];
  websites?: string[];
  timeToBeat?: TimeToBeat;
  similarGames?: SimilarGame[];
  releases?: ReleaseDateInfo[];
  igdbReviews?: IgdbReview[];
  alternativeNames?: string[];
  collection?: string;
  franchise?: string;
  gameCategory?: string;
  releaseStatus?: string;
  languageSupports?: LanguageSupportInfo[];
  /** IGDB collection ID for the first collection this game belongs to.
   *  Used by the GameRelationsCard on the Library page to fetch
   *  "other games in this collection" via the get_collection_games
   *  Tauri command. Mirrors GameMetadataResult.collectionId and the
   *  Rust GameMetadataResult.collection_id field. Populated by
   *  GameContext.enrichGameMetadata after an IGDB enrichment. */
  collectionId?: number;
  launchArguments?: string;
  runAsAdmin?: boolean;
  playStatus?: PlayStatus;
}

export interface TimeToBeat {
  /** Hours spent rushing through the game (IGDB hastily field).
   *  Note: legacy `hastly` spelling was a typo and is no longer used. */
  hastily?: number;
  normally?: number;
  completely?: number;
}

export interface SimilarGame {
  id: number;
  name: string;
  /**
   * Cover URL. Accepts `string | null` (IGDB's `coverUrl` on
   * `StoreGameSummary` is nullable) and `string | undefined`
   * (older library records may omit it). The GameRelationsCard
   * treats both equivalently via the `useProgressiveImage` hook.
   */
  coverUrl?: string | null;
}

export interface ReleaseDateInfo {
  platform: string;
  dateStr: string;
  region: string;
}

/** A single Steam reaction (👍 / ❤️ / 😂 / etc.) with its count.
 *  The integer `reactionType` is mapped to an emoji via the static
 *  `STEAM_REACTIONS` table in `ReviewsTab.tsx`. */
export interface SteamReaction {
  /** Steam's numeric reaction type (1-22). */
  reactionType: number;
  /** Number of users who reacted with this type. */
  count: number;
}

/** A review record sourced from Steam, IGDB, or external review sites.
 *  Every field is optional so the same shape works across all three
 *  sources and so older `games.json` payloads (where most fields are
 *  absent) deserialize cleanly. */
export interface IgdbReview {
  // ── Core content ─────────────────────────────────────────────
  title?: string;
  content?: string;
  rating?: number;
  username?: string;
  /** ISO 639-1 language code (e.g. "english", "french") from the review source.
   *  Populated by the Steam reviews API; undefined for IGDB-sourced reviews. */
  language?: string;
  /** Number of users who found this review helpful (Steam). */
  votesUp?: number;
  /** Number of users who found this review funny (Steam). */
  votesFunny?: number;
  /** Unix timestamp when this review was created (Steam). */
  timestampCreated?: number;
  /** Unix timestamp when this review was last updated (Steam). */
  timestampUpdated?: number;

  // ── Author context (Steam) ──────────────────────────────────
  /** Reviewer's SteamID64 — used to deep-link to the individual
   *  review on steamcommunity.com. */
  authorSteamId?: string;
  /** Reviewer's total playtime in minutes across all games (Steam). */
  authorPlaytimeForever?: number;
  /** Reviewer's playtime (minutes) in THIS game at the moment the
   *  review was written (Steam). */
  authorPlaytimeAtReview?: number;
  /** Reviewer's playtime (minutes) on Steam Deck for THIS game at
   *  the moment the review was written (Steam). */
  authorDeckPlaytimeAtReview?: number;

  // ── Reviewer badges (Steam) ──────────────────────────────────
  /** True when Steam marks the review as written primarily on a
   *  Steam Deck. Renders a "Steam Deck Played" pill. */
  primarilySteamDeck?: boolean;
  /** True when the reviewer received the game for free. Renders a
   *  "Received for Free" pill. */
  receivedForFree?: boolean;
  /** True when the review was written while the game was in Early
   *  Access. Renders an "Early Access" pill. */
  writtenDuringEarlyAccess?: boolean;
  /** True when the reviewer purchased the game directly on Steam.
   *  Renders a "Steam Purchase" pill. */
  steamPurchase?: boolean;

  // ── Engagement (Steam) ───────────────────────────────────────
  /** Number of comments on this review (Steam). When > 0 the
   *  frontend renders a "💬 N comments" link to the reviewer's
   *  Steam community profile. */
  commentCount?: number;
  /** Full reaction breakdown. Sorted by count descending by the
   *  frontend; only reactions with `count > 0` are returned. */
  reactions?: SteamReaction[];
  /** Steam's recommendation confidence percentage (0-100). */
  weightVoteUpPercentage?: number;

  // ── Reviewer hardware (Steam "computer configuration") ────────
  /** Normalized reviewer hardware, pre-parsed by the Rust backend
   *  from Steam's unstable `hardware` block. */
  hw?: SteamHardware;
}

/** Normalized reviewer hardware ("computer configuration"). Every field is
 *  optional — Steam's hardware block is sparse and varies across reviews. */
export interface SteamHardware {
  os?: string;
  cpuName?: string;
  gpuName?: string;
  /** System RAM in megabytes. */
  systemRamMb?: number;
  /** Video RAM in megabytes. */
  vramSizeMb?: number;
}

export interface ReviewFetchResult {
  reviews: IgdbReview[];
  /** "steam" | "igdb" | "none" */
  source: string;
  error?: string;
  /** Total number of reviews (from Steam query_summary). */
  totalReviews?: number;
  /** Cursor for fetching the next page. null when no more pages. */
  cursor?: string | null;
  steamReviewScore?: number;
  steamReviewScoreDesc?: string;
  steamTotalPositive?: number;
  steamTotalNegative?: number;
}

export interface LanguageSupportInfo {
  language: string;
  supportType: string;
}

// ─── Hydra community reviews (public Hydra launcher API, read-only) ────────

/** Author of a Hydra community review or reply. */
export interface HydraReviewUser {
  id: string;
  /** Falls back to "Anonymous" in the UI when empty. */
  displayName: string;
  profileImageUrl?: string | null;
}

/** A reply ("answer") to a Hydra community review. `answerHtml` is
 *  sanitized by the Rust backend (ammonia) before crossing the IPC
 *  bridge, so it is safe to render with dangerouslySetInnerHTML. */
export interface HydraReviewAnswer {
  id: string;
  answerHtml: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  upvotes: number;
  downvotes: number;
  user: HydraReviewUser;
  /** Other-language HTML versions keyed by base lang code (e.g. "en"). */
  translations: Record<string, string>;
  detectedLanguage?: string | null;
}

/** A Hydra community review. `reviewHtml` is sanitized by the Rust
 *  backend (ammonia) before crossing the IPC bridge. */
export interface HydraReview {
  id: string;
  reviewHtml: string;
  /** 1–5 star score ("note"). */
  score: number;
  /** Author playtime for this game, in seconds. Shown only when > 0. */
  playTimeInSeconds?: number | null;
  upvotes: number;
  downvotes: number;
  /** Total reply count on the server (may exceed answers.length). */
  answerCount: number;
  createdAt?: string | null;
  updatedAt?: string | null;
  user: HydraReviewUser;
  /** First page of replies, eagerly embedded by the server. */
  answers: HydraReviewAnswer[];
  translations: Record<string, string>;
  detectedLanguage?: string | null;
}

export interface HydraReviewsResult {
  reviews: HydraReview[];
  totalCount: number;
}

export interface HydraAnswersResult {
  answers: HydraReviewAnswer[];
  totalCount: number;
}

/** Aggregate Hydra community stats for a game
 *  (`GET /games/stats?objectId={appid}&shop=steam`). */
export interface HydraGameStats {
  /** Players currently in-game per Hydra launcher telemetry. */
  playerCount: number;
  /** Total community downloads recorded by Hydra. */
  downloadCount: number;
  /** Average Hydra user-review score, 1–5 stars (0 when unreviewed). */
  averageScore: number;
  /** Number of Hydra user reviews backing `averageScore`. */
  reviewCount: number;
}

/** Sort options accepted by the Hydra reviews endpoint (`sortBy=`). */
export type HydraSortOption = "newest" | "oldest" | "score_high" | "score_low" | "most_voted";

export const HYDRA_SORT_OPTIONS: { value: HydraSortOption; label: string }[] = [
  { value: "newest",     label: "Newest" },
  { value: "oldest",     label: "Oldest" },
  { value: "score_high", label: "Highest score" },
  { value: "score_low",  label: "Lowest score" },
  { value: "most_voted", label: "Most voted" },
];

/** Steam achievement data synced from Steam. */
export interface SteamAchievement {
  apiname: string;
  name: string;
  description: string;
  achieved: boolean;
  unlocktime: number;
  icon?: string;
  icongray?: string;
}

// ─── Steam Reactions (reviewer-applied emoji reactions) ────────────────────

/** Steam's reaction emoji table. The `type` integer is the same
 *  value Steam returns in `reactions[].reactionType`; we map it to
 *  an emoji + label here so the renderer doesn't need to know
 *  the integer semantics. The label is used in tooltips and the
 *  "Show more" expanded view. */
/** Steam review reaction table (reaction awards). `label` is the award name,
 *  `description` the flavour text shown in tooltips, and `emoji` a fallback
 *  glyph used if the reaction image asset fails to load. The static images
 *  live in `public/reactions/{type}.png` (mirrored from Steam). */
export const STEAM_REACTIONS: Record<
  number,
  { label: string; description: string; emoji: string }
> = {
  1: { label: "Deep Thoughts", description: "Trained dolphins couldn't get to the bottom of this one.", emoji: "🤔" },
  2: { label: "Heartwarming", description: "Makes you want to go out and show a rainbow to a kitten.", emoji: "🌈" },
  3: { label: "Hilarious", description: "There's funny, and then there's this absolute gem.", emoji: "😂" },
  4: { label: "Hot Take", description: "You can't start a fire without a spark, and some gasoline.", emoji: "🔥" },
  5: { label: "Poetry", description: "Such elegant prose! A literary feast.", emoji: "📜" },
  6: { label: "Extra Helpful", description: "If this were any more helpful I wouldn't need a brain.", emoji: "🧠" },
  7: { label: "Gotta Have It", description: "Just hand it over, nice and easy.", emoji: "🤲" },
  8: { label: "Michelangelo", description: "It belongs in a museum (and my inventory).", emoji: "🎨" },
  9: { label: "Treasure", description: "We found it! We found the booty!", emoji: "💰" },
  10: { label: "Mind Blown", description: "Human brains aren't ready for this much awesomeness.", emoji: "🤯" },
  11: { label: "Golden Unicorn", description: "Shine on Golden Unicorn, shine on.", emoji: "🦄" },
  12: { label: "Mad Scientist", description: "It's Alive!", emoji: "🧪" },
  13: { label: "Clever", description: "Gold medal in mental gymnastics.", emoji: "🤸" },
  14: { label: "Warm Blanket", description: "Oh to be a cozy blob in a blanket.", emoji: "🛌" },
  15: { label: "Saucy", description: "Sometimes you just need to kick it up a notch.", emoji: "🌶️" },
  16: { label: "Slow Clap", description: "Every standing ovation starts with a single clap.", emoji: "👏" },
  17: { label: "Take My Points", description: "Shut up and take my Steam Points!", emoji: "🪙" },
  18: { label: "Wholesome", description: "Like laying in the grass on a warm sunny day.", emoji: "🌻" },
  19: { label: "Jester", description: "An important part of any royal court.", emoji: "🃏" },
  20: { label: "Fancy Pants", description: "Nothing says fancy like a well tailored pair of pants.", emoji: "👖" },
  21: { label: "Whoa", description: "There are no words.", emoji: "😮" },
  22: { label: "Super Star", description: "Leaping through the sky, like a tiger defying the laws of gravity.", emoji: "⭐" },
  23: { label: "Wild", description: "Can't tame this awesomeness.", emoji: "🐯" },
  24: { label: "Winner", description: "The absolute best! Or first. At least for now.", emoji: "🏆" },
  25: { label: "Beautiful", description: "Words cannot describe, so this award will have to do.", emoji: "💖" },
  26: { label: "Helpful", description: "You're a credit to the team.", emoji: "🙌" },
  27: { label: "Fire", description: "This isn't the first of great works of art, and probably won't be the last.", emoji: "🔥" },
  28: { label: "Funny", description: "ROFL. Or LOL at the very least.", emoji: "😆" },
  29: { label: "One Hundred", description: "Totally, absolutely, completely agree.", emoji: "💯" },
  30: { label: "Life Saver", description: "You've saved me from my tight spot.", emoji: "🛟" },
  31: { label: "Perfect", description: "Couldn't be more correct or on point.", emoji: "🎯" },
  32: { label: "Plus One", description: "I agree. I think everyone should know that I agree.", emoji: "➕" },
  33: { label: "Smart", description: "Ingenuity at its finest.", emoji: "🧠" },
  34: { label: "Pure Gold", description: "So valuable and shiny I want to put it in a box.", emoji: "🥇" },
  35: { label: "Wholesome", description: "So cozy, so warm.", emoji: "🤗" },
};

/** Path to the bundled static reaction image for a Steam reaction type.
 *  Returns null for unknown types (renderer falls back to the emoji). */
export function reactionImagePath(reactionType: number): string | null {
  return STEAM_REACTIONS[reactionType] ? `/reactions/${reactionType}.png` : null;
}

/** Options controlling a Steam reviews query. Mirrors the params the
 *  backend forwards to Steam's `appreviews` endpoint. */
export interface ReviewQueryOptions {
  /** Display order → Steam `filter`: "summary"|"all"|"recent"|"funny". */
  display: "summary" | "all" | "recent" | "funny";
  /** Recommendation → Steam `review_type`: "all"|"positive"|"negative". */
  reviewType: "all" | "positive" | "negative";
  /** Purchase source → Steam `purchase_type`: "all"|"steam"|"other". */
  purchaseType: "all" | "steam" | "other";
  language: string;
  playtimePreset: "none" | "over_1h" | "over_10h" | "custom";
  playtimeMinHours: number;
  playtimeMaxHours: number;
  playtimeDevice: "all" | "deck";
  useHelpfulSystem: boolean;
}

/** Steam language codes accepted by the appreviews `language=` param.
 *  Each entry is a tuple of (Steam code, display label, flag emoji).
 *  The order matches Playnite's `SteamLanguage.cs` enum. */
export const STEAM_LANGUAGES: { code: string; label: string; flag: string }[] = [
  { code: "all",        label: "All languages",          flag: "🌐" },
  { code: "english",    label: "English",                flag: "🇬🇧" },
  { code: "schinese",   label: "简体中文",              flag: "🇨🇳" },
  { code: "tchinese",   label: "繁體中文",              flag: "🇹🇼" },
  { code: "japanese",   label: "日本語",                flag: "🇯🇵" },
  { code: "koreana",    label: "한국어",                flag: "🇰🇷" },
  { code: "russian",    label: "Русский",              flag: "🇷🇺" },
  { code: "ukrainian",  label: "Українська",           flag: "🇺🇦" },
  { code: "german",     label: "Deutsch",                flag: "🇩🇪" },
  { code: "french",     label: "Français",               flag: "🇫🇷" },
  { code: "italian",    label: "Italiano",               flag: "🇮🇹" },
  { code: "spanish",    label: "Español (España)",       flag: "🇪🇸" },
  { code: "latam",      label: "Español (Latinoamérica)", flag: "🇲🇽" },
  { code: "portuguese", label: "Português (Portugal)",   flag: "🇵🇹" },
  { code: "brazilian",  label: "Português (Brasil)",     flag: "🇧🇷" },
  { code: "polish",     label: "Polski",                 flag: "🇵🇱" },
  { code: "czech",      label: "Čeština",                flag: "🇨🇿" },
  { code: "hungarian",  label: "Magyar",                 flag: "🇭🇺" },
  { code: "romanian",   label: "Română",                 flag: "🇷🇴" },
  { code: "bulgarian",  label: "Български",              flag: "🇧🇬" },
  { code: "greek",      label: "Ελληνικά",              flag: "🇬🇷" },
  { code: "turkish",    label: "Türkçe",                 flag: "🇹🇷" },
  { code: "thai",       label: "ไทย",                    flag: "🇹🇭" },
  { code: "vietnamese", label: "Tiếng Việt",             flag: "🇻🇳" },
  { code: "indonesian", label: "Bahasa Indonesia",       flag: "🇮🇩" },
  { code: "finnish",    label: "Suomi",                  flag: "🇫🇮" },
  { code: "swedish",    label: "Svenska",                flag: "🇸🇪" },
  { code: "danish",     label: "Dansk",                  flag: "🇩🇰" },
  { code: "norwegian",  label: "Norsk",                  flag: "🇳🇴" },
  { code: "dutch",      label: "Nederlands",             flag: "🇳🇱" },
];

// ─── Rich About Payload (Steam `about_the_game` + trailers) ────────────────────

/**
 * A single trailer / gameplay clip sourced from the Steam store's
 * `data.movies[]` array. The frontend AboutSection renders one
 * `<video>` tile per entry with `poster = thumbnail`. Webm is the
 * preferred `<source>` (smaller, better quality at the same bitrate)
 * with mp4 as the universal fallback for Safari / mobile / WebView
 * contexts.
 */
export interface MovieEntry {
  id: number;
  name?: string;
  /** Steam CDN JPG poster — set as `<video poster>`. */
  thumbnail?: string;
  /** Best-res webm URL (max -> 480p fallback chain). */
  webm?: string;
  /** Best-res mp4 URL (max -> 480p -> full fallback chain). */
  mp4?: string;
  /** Steam's "main trailer" flag. Highlighted in the UI when true. */
  highlight: boolean;
}

/**
 * The combined "About" payload returned by `get_about_section`.
 * Sourced Steam-first (HTML body + trailers); falls back to IGDB
 * plain text when Steam is unavailable. `source === "none"` means
 * "no data" — the frontend should hide the section or fall back to
 * the legacy `game.description` field.
 */
export interface RichAboutPayload {
  /** `"steam" | "igdb" | "none"` */
  source: string;
  /** Deep-link to the source page (Steam store / IGDB game). */
  sourceUrl?: string;
  /** Human-readable source name ("Steam" / "IGDB"). */
  sourceName?: string;
  /**
   * Raw HTML body (Steam `about_the_game`). Rendered with
   * `dangerouslySetInnerHTML` after minimal client-side
   * sanitization; includes Steam CDN `<img>` tags as inline
   * images/GIFs.
   */
  aboutHtml?: string;
  /** Plain-text fallback (Steam `short_description` or IGDB summary). */
  aboutText?: string;
  /** Steam trailers / gameplay videos. */
  movies: MovieEntry[];
  /** Unix-seconds timestamp of the last successful fetch. */
  fetchedAt: number;
}

// ─── System Requirements (Steam `pc_requirements`) ────────────────────────────

/**
 * Structured system requirements, parsed from Steam's variable
 * HTML `pc_requirements.minimum` / `pc_requirements.recommended`
 * payload on the Rust side. Every field is optional because
 * Steam frequently omits one or more sections (Mac-only games
 * have no Windows spec, older indie titles skip VR Support,
 * etc.) — the frontend silently drops empty rows so the card
 * never has meaningless `—` entries.
 *
 * Field coverage mirrors the entire Steam taxonomy:
 *   - os                Windows / macOS / SteamOS + Linux
 *   - processor         CPU requirement
 *   - memory            RAM requirement
 *   - graphics          GPU requirement
 *   - directX           DirectX version
 *   - network           online play requirement
 *   - storage           disk footprint requirement
 *   - soundCard         sound card / audio requirement
 *   - vrSupport         VR headset + controller requirement
 *   - additionalNotes   free-form footnote ("Requires X controller",
 *                       "64-bit only", "SSD recommended", etc.)
 */
export interface RequirementsSpec {
  os?: string;
  processor?: string;
  memory?: string;
  graphics?: string;
  directX?: string;
  network?: string;
  storage?: string;
  soundCard?: string;
  vrSupport?: string;
  additionalNotes?: string;
}

/**
 * Combined system-requirements payload returned by the
 * `get_recommended_config` Tauri command. Source priority is
 * Steam-only (IGDB doesn't expose specs); `source === "none"`
 * means the game has no Steam appid and the section should hide
 * entirely.
 *
 * When `minimum` AND `recommended` are both `None` BUT
 * `minimumHtml` / `recommendedHtml` carry values, the parser
 * simply didn't recognise any labels in the raw HTML — the
 * frontend should fall back to rendering the raw HTML through
 * its existing sanitizer rather than dropping the section
 * silently.
 */
export interface PcRequirementsPayload {
  /** `"steam" | "none"` */
  source: string;
  /** Deep-link to the Steam app page (for the "View on Steam" footer). */
  sourceUrl?: string;
  /** Human-readable source name ("Steam"). */
  sourceName?: string;
  /** Parsed minimum spec (lower bar to launch the game). */
  minimum?: RequirementsSpec;
  /** Parsed recommended spec (bar for a smooth experience). */
  recommended?: RequirementsSpec;
  /**
   * Raw Steam `pc_requirements.minimum` HTML, preserved as a
   * last-resort fallback when the label parser missed any spec
   * (unrecognised label → freeform paragraph).
   */
  minimumHtml?: string;
  /** Raw Steam `pc_requirements.recommended` HTML fallback. */
  recommendedHtml?: string;
  /** Unix-seconds timestamp of the last successful fetch. */
  fetchedAt: number;
}

// ─── Achievements / Success Story Types ─────────────────────────────────────

/** A single achievement definition + user progress (from Steam API merge). */
export interface Achievement {
  apiName: string;
  displayName: string;
  description: string;
  /** Icon URL when unlocked. */
  icon: string;
  /** Icon URL when locked. */
  iconGray: string;
  achieved: boolean;
  /** Unix timestamp of unlock (0 if locked). */
  unlockTime: number;
  /** Global unlock percentage (0–100). */
  percent: number;
}

/** Per-game achievement data returned from the backend. */
export interface GameAchievementData {
  steamAppId: number;
  achievements: Achievement[];
  total: number;
  unlocked: number;
  locked: number;
  /** Timestamp (ms) when this data was last fetched. Set by the frontend. */
  lastSynced?: number;
}

/** Whole-library achievements cache, keyed by game ID. */
export interface AchievementsCache {
  games: Record<string, GameAchievementData>;
}

/** Achievement rarity tier thresholds (based on global unlock %). */
export type AchievementRarity = "common" | "uncommon" | "rare" | "ultra_rare";

/** Determine the rarity tier from a global unlock percentage. */
export function getAchievementRarity(percent: number): AchievementRarity {
  if (percent >= 50) return "common";
  if (percent >= 20) return "uncommon";
  if (percent >= 5) return "rare";
  return "ultra_rare";
}

/** Human-readable labels for rarity tiers. */
export const RARITY_LABELS: Record<AchievementRarity, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  ultra_rare: "Ultra Rare",
};

/** Color codes for rarity tiers. */
export const RARITY_COLORS: Record<AchievementRarity, string> = {
  common: "#9ca3af",     // gray
  uncommon: "#10b981",   // emerald
  rare: "#3b82f6",       // blue
  ultra_rare: "#f59e0b", // gold
};

/** Supported store sources for metadata enrichment. */
export type StoreSource = "steam" | "igdb" | "launchbox" | "manual";


/** All valid store source values for runtime validation. */
export const STORE_SOURCES: readonly StoreSource[] = [
  "steam",
  "igdb",
  "launchbox",
  "manual",
] as const;

/**
 * Library source filter for distinguishing between different game
 * origins (Steam sync, local imports, GOG, etc.).
 */
export type LibrarySource = "all" | "steam" | "local" | "gog" | "epic" | "humble" | "rockstar" | "ubisoft";

export type PlayStatus = "backlog" | "playing" | "completed" | "abandoned" | "on_hold";

export const PLAY_STATUS_DETAILS: Record<
  PlayStatus,
  {
    label: string;
    variant: "default" | "success" | "warning" | "danger" | "info" | "accent";
    color: string;
  }
> = {
  backlog: { label: "Backlog", variant: "default", color: "#64748b" },
  playing: { label: "Playing", variant: "success", color: "#10b981" },
  completed: { label: "Completed", variant: "info", color: "#3b82f6" },
  on_hold: { label: "On Hold", variant: "warning", color: "#f59e0b" },
  abandoned: { label: "Abandoned", variant: "danger", color: "#ef4444" },
};

/** Metadata returned from the backend scraper. */
export interface GameMetadataResult {
  title: string;
  description: string | null;
  developer: string | null;
  publisher: string | null;
  releaseDate: string | null;
  genres: string[];
  images: GameMetadataImages;
  sourceUrl: string;
  sourceName: string;
  storyline?: string;
  igdbRating?: number;
  criticRating?: number;
  themes?: string[];
  gameModes?: string[];
  playerPerspectives?: string[];
  screenshots?: string[];
  videos?: string[];
  websites?: string[];
  timeToBeat?: TimeToBeat;
  similarGames?: SimilarGame[];
  releases?: ReleaseDateInfo[];
  igdbReviews?: IgdbReview[];
  alternativeNames?: string[];
  collection?: string;
  /// IGDB collection ID for the first collection this game belongs
  /// to. Used by the Store GameDetail page's GameRelationsCard to
  /// fetch "Other in Collection" members via the dedicated
  /// `get_collection_games` Tauri command. Mirrors the Rust
  /// `GameMetadataResult.collection_id` field.
  collectionId?: number;
  franchise?: string;
  gameCategory?: string;
  releaseStatus?: string;
  languageSupports?: LanguageSupportInfo[];
}

/** Image URLs from a metadata source. */
export interface GameMetadataImages {
  icon: string | null;
  cover: string | null;
  hero: string | null;
  banner: string | null;
  logo: string | null;
}

/** A single categorized image from the LaunchBox Games Database. */
export interface LaunchBoxImageResult {
  category: string;
  region: string | null;
  resolution: string;
  url: string;
}

// ─── Steam Game Stats (popover payload) ────────────────────────────────────

/**
 * Per-game metadata returned by Steam's `appdetails` endpoint. Used
 * by the click-to-expand player-count popover alongside the review
 * breakdown. All fields are optional except `name` so the renderer
 * can degrade gracefully when Steam returns a partial record.
 */
export interface SteamGameDetails {
  /** Display name from the Steam store (e.g. "Counter-Strike 2"). */
  name: string;
  /** First-listed developer. Multi-developer games keep the lead dev. */
  developer: string | null;
  /** First-listed publisher. */
  publisher: string | null;
  /** Pre-formatted release date string from Steam (e.g. "Mar 21, 2024").
   *  Already locale-formatted on the Rust side. */
  releaseDate: string | null;
  /** Steam's `is_free` flag. When true, `priceCents` is `null`. */
  isFree: boolean;
  /** Price in minor units (cents) after any current discount. `null`
   *  when the game is free-to-play or no price is published. */
  priceCents: number | null;
  /** ISO 4217 currency code from the price overview (e.g. "USD"). */
  currency: string | null;
  /** Genre descriptions as Steam surfaces them (e.g. ["Action", "FPS"]). */
  genres: string[];
}

/**
 * Aggregate review breakdown for a Steam app, sourced from
 * `appreviews?json=1&filter=all&num_per_page=0`. We request zero per-page
 * results so the response stays small regardless of how many reviews the
 * title has accumulated.
 */
export interface SteamGameReviews {
  /** Cumulative count of positive reviews over the lifetime of the title. */
  totalPositive: number;
  /** Cumulative count of negative reviews. */
  totalNegative: number;
  /** Sum of `totalPositive + totalNegative`. */
  totalReviews: number;
  /** Steam's 1-9 review score bucket (1 = "Overwhelmingly Negative",
   *  9 = "Overwhelmingly Positive"). `null` when Steam hasn't bucketed
   *  this title yet (very few reviews). */
  score: number | null;
  /** Human-readable bucket label (e.g. "Very Positive", "Mixed"). */
  scoreDesc: string | null;
}

/**
 * Combined popover payload from `get_steam_game_stats`. Each section is
 * returned independently so a partial failure on `appdetails` doesn't
 * blank the popover if reviews came back fine.
 *
 * Note: the current concurrent-player count is intentionally absent.
 * The badge's own 60s poll already has the freshest value and passes
 * it down to the popover as a prop; re-fetching it from the backend
 * would burn a Steam call we just made and introduce a small window
 * where the badge number and the popover header disagree.
 */
export interface SteamGameStats {
  appId: number;
  details: SteamGameDetails | null;
  reviews: SteamGameReviews | null;
  /** Per-section error string, present only on failure. Renderers
   *  should show "—" (or a friendly fallback) for the failed field
   *  rather than blanking the whole popover. */
  detailsError: string | null;
  reviewsError: string | null;
}

// ─── Player Count History (activity-tab sparkline) ──────────────────────────

/**
 * One sample in the per-appid player-count history ring buffer.
 * Sourced from the Rust `PlayerCountPoint` struct, which itself
 * records every successful `get_steam_player_count` fetch.
 */
export interface PlayerCountPoint {
  /** Unix-millisecond timestamp of the sample. Sourced from
   *  `SystemTime::now()` on the Rust side so the value is
   *  renderable in the user's local time without conversion. */
  timestamp: number;
  /** Concurrent-player count at sample time. Always > 0 — zero
   *  readings are filtered at the source (a flat zero line on
   *  every poll would be visual noise). */
  count: number;
}

/**
 * Per-appid history slice returned by `get_player_count_history`.
 * Backend filters the ring buffer to the requested `max_age_ms`
 * window (default 24h) and computes the aggregates so the
 * frontend renders a complete summary card in one IPC round-trip.
 */
export interface PlayerCountHistory {
  appId: number;
  /** Time-series points within the requested window, oldest first.
   *  Empty when the appid has no recorded samples yet. */
  points: PlayerCountPoint[];
  /** Most recent reading, or `null` when `points` is empty. */
  current: number | null;
  /** Maximum count observed in the window, or `null` when empty. */
  peak: number | null;
  /** Arithmetic mean of the window, or `null` when empty. */
  average: number | null;
  /** Number of points in the returned window. Lets the renderer
   *  distinguish "no data ever" from "very few samples" without
   *  re-counting the array. */
  sampleCount: number;
  /** Wall-clock start of the returned window (unix-ms). 0 when empty. */
  windowStartMs: number;
  /** Wall-clock end of the returned window (unix-ms). 0 when empty. */
  windowEndMs: number;
}

// ─── Steam Player History (hover popover line chart) ──────────────────────────

/**
 * One sample in the long-range concurrent-player history returned by
 * `get_steam_player_history` (sourced from the free steamcharts.com CCU
 * feed — the same data SteamDB's charts display). Already downsampled by
 * the backend to ≤180 points, so it plots directly.
 */
export interface SteamPlayerHistoryPoint {
  /** Unix-millisecond timestamp of the sample. */
  timestamp: number;
  /** Concurrent players at sample time. */
  count: number;
}

/**
 * Long-range concurrent-player history for a single Steam appid, returned
 * by `get_steam_player_history`. The `points` series is oldest-first and
 * pre-downsampled; the aggregates let the popover render a summary strip
 * (Current / Peak / Avg) without re-iterating the array.
 */
export interface SteamPlayerHistory {
  appId: number;
  /** Downsampled time-series, oldest first. */
  points: SteamPlayerHistoryPoint[];
  /** Most recent reading in the (filtered) series. */
  current: number;
  /** Peak across the requested range. */
  peakInRange: number;
  /** Peak across the entire steamcharts history (all-time). */
  peakAllTime: number;
  /** Arithmetic mean across the requested range. */
  averageInRange: number;
  /** Number of points in the returned (downsampled) series. */
  sampleCount: number;
  /** True when `points` was downsampled from a denser series. */
  downsampled: boolean;
}

// ─── View Density ──────────────────────────────────────────────────────────────

/**
 * User-selectable card layout density in the Store page. Synced to
 * localStorage and applied to every `StoreGameCard` instance.
 *
 *   - compact   : cover-only, minimal footprint
 *   - cozy      : default; cover + small body with genres/platforms
 *   - cinematic : larger cards with body overlaid on the cover
 *   - list      : horizontal row with small image preview + text
 */
export type ViewDensity = "compact" | "cozy" | "cinematic" | "list";

/** localStorage key for the user's chosen density. */
export const VIEW_DENSITY_STORAGE_KEY = "gamelib_store_density_v1";

/** Default density when nothing is stored (or stored value is invalid). */
export const DEFAULT_DENSITY: ViewDensity = "cozy";

/** All valid density values, for runtime validation in the hook. */
export const VIEW_DENSITIES: readonly ViewDensity[] = [
  "compact",
  "cozy",
  "cinematic",
  "list",
] as const;

// ─── Size Unit ──────────────────────────────────────────────────────────────

/**
 * User-selectable display unit for disk sizes on the Storage tab.
 *
 *   - `gb`  : decimal SI gigabytes (1 GB = 1,000,000,000 bytes).
 *             Matches how Steam, the Windows Explorer Properties
 *             dialog, and most modern OSes report folder size. The
 *             locked default for backward compat.
 *   - `gib` : binary gibibytes  (1 GiB = 1,073,741,824 bytes).
 *             Matches how `df -h` and Task Manager (Windows 10+) report
 *             sizes and is more accurate when summing raw byte counts.
 *
 * The label in the rendered string is uppercase (`"GB"` / `"GIB"`),
 * matching the spec convention. The choice is persisted to localStorage
 * and respected by every `formatSize()` call site across the app.
 */
export type SizeUnit = "gb" | "gib";

/** localStorage key for the user's chosen size unit. */
export const SIZE_UNIT_STORAGE_KEY = "gamelib_size_unit_v1";

/** localStorage key for persisted library filter state (status, source, sort, etc.). */
export const LIBRARY_FILTERS_STORAGE_KEY = "gamelib_library_filters_v1";

/** Default unit when nothing is stored (or stored value is invalid). */
export const DEFAULT_SIZE_UNIT: SizeUnit = "gb";

/** All valid size unit values, for runtime validation in the hook. */
export const SIZE_UNITS: readonly SizeUnit[] = ["gb", "gib"] as const;

// ─── Wishlist ──────────────────────────────────────────────────────────────────

/**
 * A persisted wishlist entry. We store the entire `StoreGameSummary`
 * payload alongside `addedAt` so the wishlist rail renders instantly on
 * next launch without re-querying IGDB.
 */
export interface WishlistEntry extends StoreGameSummary {
  /** Unix timestamp (ms) when the game was added to the wishlist. */
  addedAt: number;
  /** Free-text note the user can attach to a wishlisted game
   *  (e.g. "buy during winter sale", "play after beating X").
   *  Optional and absent for entries added before notes existed. */
  note?: string;
}

/** Shape of `<app_data>/wishlist_cache.json` on disk. */
export interface WishlistCache {
  /** Keyed by IGDB slug for O(1) membership checks. */
  entries: Record<string, WishlistEntry>;
}

// ─── Store Browsing Types ────────────────────────────────────────────────────

/** Category tabs in the Store page.
 *  `coming_soon` lists games releasing in the next ~6 months
 *  (sorted by hype); `new_releases` lists games released in the
 *  last ~30 days. Both are wired in `fetch_store_games` (Rust). */
export type StoreCategory =
  | "trending"
  | "popular"
  | "top"
  | "coming_soon"
  | "new_releases"
  | "all";

/** Lightweight game summary returned from IGDB for store browsing.
 *  Mirrors the Rust StoreGameSummary struct — field names match the
 *  camelCase serialization from the backend. */
export interface StoreGameSummary {
  id: number;
  name: string;
  slug: string;
  summary: string | null;
  rating: number | null;
  aggregatedRating: number | null;
  coverUrl: string | null;
  logoUrl: string | null;
  genres: string[];
  platforms: string[];
  firstReleaseDate: string | null;
  totalRatingCount: number;
  hypes: number;
  /** External URLs for the title (Steam store page, Epic, official site,
   *  etc.). Populated from IGDB's `websites.url` field so the Store Hero
   *  (and any other card rendering a Steam concurrent-player badge)
   *  can extract the Steam appid without an extra round-trip. */
  websites?: string[];
}

/** Cache entry wrapper with a fetchedAt timestamp for TTL checks. */
export interface StoreCacheEntry<T> {
  data: T;
  fetchedAt: number;
}

/** Full store cache structure persisted to disk. */
export interface StoreCache {
  categories: Record<string, StoreCacheEntry<StoreGameSummary[]>>;
  detailCache: Record<string, StoreCacheEntry<GameMetadataResult>>;
}

/** 6-hour cache TTL in milliseconds. */
export const STORE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Number of store games per page (infinite scroll batch size). */
export const STORE_PAGE_SIZE = 20;

// ─── Store Sort ──────────────────────────────────────────────────────────────

/**
 * User-selectable sort order for store category browsing. Maps to an IGDB
 * `sort` clause in `fetch_store_games` (Rust). `default` keeps the
 * category's built-in ranking (e.g. Trending → hypes desc).
 */
export type StoreSort =
  | "default"
  | "popularity"
  | "rating"
  | "release_new"
  | "release_old"
  | "name";

/** Human-readable labels for the sort dropdown. */
export const STORE_SORT_LABELS: Record<StoreSort, string> = {
  default: "Relevance",
  popularity: "Popularity",
  rating: "Rating",
  release_new: "Release (newest)",
  release_old: "Release (oldest)",
  name: "Name (A–Z)",
};

/** Ordered list of sort options for rendering the dropdown. */
export const STORE_SORTS: readonly StoreSort[] = [
  "default",
  "popularity",
  "rating",
  "release_new",
  "release_old",
  "name",
] as const;

// ─── Store: Recently Viewed / Hidden / Presets (localStorage) ────────────────

/** localStorage key for the last-N store games the user opened. */
export const STORE_RECENTLY_VIEWED_KEY = "gamelib_store_recently_viewed_v1";

/** Max number of recently-viewed store games retained. */
export const STORE_RECENTLY_VIEWED_MAX = 12;

/** localStorage key for the user's recent search queries. */
export const STORE_RECENT_SEARCHES_KEY = "gamelib_store_recent_searches_v1";

/** Max number of recent search queries retained. */
export const STORE_RECENT_SEARCHES_MAX = 8;

/** Curated popular searches shown alongside recent searches in the empty state. */
export const STORE_POPULAR_SEARCHES: readonly string[] = [
  "Elden Ring",
  "Baldur's Gate 3",
  "Cyberpunk 2077",
  "Hades",
  "Stardew Valley",
  "Hollow Knight",
];

/** localStorage key for the set of "not interested" (hidden) game slugs. */
export const STORE_HIDDEN_KEY = "gamelib_store_hidden_v1";

/** localStorage key for saved filter presets. */
export const STORE_PRESETS_KEY = "gamelib_store_presets_v1";

/**
 * A saved filter preset — a named snapshot of the sidebar facets plus
 * the download-source selection so power users can restore a full
 * browse configuration in one click.
 */
export interface StoreFilterPreset {
  /** Stable id (timestamp-based) used as the React key + removal handle. */
  id: string;
  /** User-supplied display name (e.g. "Co-op RPGs, PC, 2018+"). */
  name: string;
  genres: string[];
  platforms: string[];
  yearMin: number | null;
  yearMax: number | null;
  ratingMin: number | null;
  /** Download-source ids (may reference deleted sources; pruned on apply). */
  sourceIds: string[];
  /** Sort order captured with the preset. */
  sort: StoreSort;
}

// ─── Store: Price (CheapShark) ───────────────────────────────────────────────

/** Resolved current price for a game (mirrors the Rust `GamePrice`). */
export interface GamePrice {
  title: string;
  salePrice: number | null;
  normalPrice: number | null;
  discountPercent: number;
  isOnSale: boolean;
  dealUrl: string | null;
  storeId: string | null;
}

// ─── ProtonDB Compatibility ─────────────────────────────────────────────────

/** ProtonDB community-reported Linux / Steam Deck compatibility summary.
 *  Fetched on-demand from the public endpoint
 *  `https://www.protondb.com/api/v1/reports/summaries/{appid}.json`.
 *  The endpoint returns a 404 (no JSON) when a game has zero reports, so
 *  `found` is used to distinguish "no reports yet" from a fetch error. */
export interface ProtonDBStatus {
  /** Whether a summary was found (the endpoint returns 404 with no body
   *  when a game has no reports at all). */
  found: boolean;
  /** Official rating tier. One of: "platinum" | "gold" | "silver" |
   *  "bronze" | "borked" | "pending". "pending" means confidence is too
   *  low for a verdict. */
  tier: ProtonDBTier;
  /** Tier estimate used while `tier` is "pending". */
  provisionalTier?: ProtonDBTier;
  /** Highest tier anyone reported (optimistic). */
  bestReportedTier?: ProtonDBTier;
  /** Recent reports' tier — differs from `tier` when the game is
   *  regressing or improving. */
  trendingTier?: ProtonDBTier;
  /** Confidence in the tier verdict. */
  confidence?: "inadequate" | "low" | "moderate" | "high" | "strong";
  /** Compatibility score in the range 0..1. */
  score?: number;
  /** Total number of community reports. */
  total?: number;
}

export type ProtonDBTier =
  | "pending"
  | "borked"
  | "bronze"
  | "silver"
  | "gold"
  | "platinum";

// ─── CrackWatch Status ──────────────────────────────────────────────────────

/** CrackWatch status scraped from gamestatus.info.
 *
 *  Mirrors Hydra's `CrackWatchStatus` (commit 0954a5b): an `isCracked`
 *  boolean plus the supporting detail fields. `null` detail fields mean
 *  "unknown" — the card simply omits that row. Fetched on-demand via the
 *  `fetch_crackwatch_status` Tauri command, which returns `null` when the
 *  title couldn't be resolved. */
export interface CrackWatchStatus {
  /** Whether the game has been cracked. Drives the CRACKED/UNCRACKED badge. */
  isCracked: boolean;
  /** Crack date (e.g. "2026-07-09") or null when uncracked / unknown. */
  crackDate: string | null;
  /** Scene group / bypass method (e.g. "RUNE", "EMPRESS") or null. */
  crackGroup: string | null;
  /** DRM protection (e.g. "Denuvo", "Steam") or null. */
  protection: string | null;
}

/** Extract a human-readable game name from an executable file path. */
export function gameNameFromPath(filePath: string): string {
  return (
    filePath
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.exe$/i, "") || "Unknown Game"
  );
}

/** Extract a Steam app id from a `steam://run/12345` path. Returns `null` if
 *  no id can be parsed or the path doesn't look like a Steam protocol URI.
 *  We require an explicit `steam://` prefix to avoid false positives from
 *  local paths like `C:\…\app\12345\game.exe`. */
export function extractSteamAppId(path: string): number | null {
  if (!path) return null;
  const m = path.match(/steam:\/\/run\/(\d+)/);
  if (m && m[1]) {
    const id = parseInt(m[1], 10);
    return Number.isFinite(id) ? id : null;
  }
  return null;
}

/** Pull a Steam app id out of an IGDB `websites` URL list. IGDB stores
 *  all external URLs (store pages, wikis, official sites) there; we
 *  scan for the canonical Steam store-page host. This is how manually
 *  added games (local exe / batch) get a Steam identity after IGDB
 *  enrichment — the WebLinks tab already relied on the same trick. */
export function extractSteamAppIdFromWebsites(
  websites: string[] | undefined | null
): number | null {
  if (!websites) return null;
  for (const url of websites) {
    const m = url.match(/store\.steampowered\.com\/app\/(\d+)/i);
    if (m && m[1]) {
      const id = parseInt(m[1], 10);
      if (Number.isFinite(id)) return id;
    }
  }
  return null;
}

/** Resolve the Steam app id for a Game, preferring the explicit
 *  `game.steamAppId` field over parsing the (often-empty) `path`,
 *  then falling back to the IGDB `websites` Steam store URL.
 *  Returns `null` when no source yields a valid id.
 *
 *  This is the canonical "give me the Steam app id" helper — the
 *  ReviewsTab previously called `extractSteamAppId(game.path)`, which
 *  only worked for Steam games launched via the `steam://run/<id>`
 *  protocol and silently returned null for every other case (Steam
 *  games with a local exe path, EGS/GOG games with a Steam listing
 *  we matched via IGDB, manually added exe/batch games, etc.).
 *  Preferring `game.steamAppId` + the websites fallback makes
 *  reviews + deep links work for the entire library. */
export function resolveSteamAppId(game: Game): number | null {
  if (typeof game.steamAppId === "number" && Number.isFinite(game.steamAppId)) {
    return game.steamAppId;
  }
  const fromPath = extractSteamAppId(game.path);
  if (fromPath != null) return fromPath;
  return extractSteamAppIdFromWebsites(game.websites);
}

/** Parse a play-time string like "142h" or "3h 15m" into total minutes. */
export function parsePlayTime(playTime: string): number {
  let minutes = 0;
  const h = playTime.match(/(\d+)\s*h/);
  const m = playTime.match(/(\d+)\s*m/);
  if (h) minutes += parseInt(h[1], 10) * 60;
  if (m) minutes += parseInt(m[1], 10);
  return minutes;
}

/** Format total minutes into a display string (e.g., "2h 30m" or "45m"). */
export function formatPlayTime(totalMinutes: number): string {
  if (totalMinutes <= 0) return "0h";
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

/** Add session seconds to a play-time string and return the updated string. */
export function addSessionTime(playTime: string, elapsedSeconds: number): string {
  const currentMinutes = parsePlayTime(playTime);
  const sessionMinutes = Math.round(elapsedSeconds / 60);
  return formatPlayTime(currentMinutes + sessionMinutes);
}

/**
 * Format a size in bytes as a human-readable string with 1 decimal.
 *
 * Display policy: 1-decimal, unit-suffixed. The unit defaults to `gb`
 * (decimal SI — 1 GB = 1,000,000,000 bytes) for backward compat with
 * every existing call site; pass `"gib"` to render binary gibibytes
 * (1 GiB = 1,073,741,824 bytes) when the user toggles the size-unit
 * setting in Settings. The label is always uppercase to match the
 * spec convention.
 *
 * `bytes <= 0` (or undefined / null) renders as `0.0 <UNIT>` so callers
 * don't have to special-case empty rows.
 */
export function formatSize(
  bytes: number | undefined | null,
  unit: SizeUnit = DEFAULT_SIZE_UNIT
): string {
  // IEC binary prefix is "GiB" (capital G, lowercase iB) — NOT "GIB".
  // Hardcode the label so the user-facing string matches the spec
  // convention regardless of how `unit` is cased internally.
  const label = unit === "gib" ? "GiB" : "GB";
  if (bytes == null || bytes <= 0) return `0.0 ${label}`;
  const divisor = unit === "gib" ? 1_073_741_824 : 1_000_000_000;
  return `${(bytes / divisor).toFixed(1)} ${label}`;
}

// ─── Activity & Performance Types ──────────────────────────────────────────────

/** A single gaming session record. */
export interface GameSession {
  id: string;
  gameId: string;
  gameName: string;
  date: string;       // ISO date string
  durationMin: number; // minutes played
  metrics?: SessionMetrics;
}

/** A single real telemetry sample captured during a session. */
export interface PerfSample {
  /** Seconds since the session (metrics collection) started. */
  t: number;
  cpu: number;        // %
  gpu: number;        // %
  ram: number;        // %
  cpuTemp: number;    // °C
  gpuTemp: number;    // °C
  /** Instantaneous FPS when a real source reported it, else null. */
  fps?: number | null;
}

/** Hardware metrics captured during a session. */
export interface SessionMetrics {
  avgFps: number;
  avgCpuUsage: number;     // %
  avgGpuUsage: number;     // %
  avgRamUsage: number;     // %
  avgCpuTemp: number;      // °C
  avgGpuTemp: number;      // °C
  minFps: number;
  maxFps: number;
  resolution: string;      // e.g. "1920x1080"
  /** Real per-sample telemetry. Present for sessions recorded after the
   *  per-sample capture was added; absent (or empty) for older sessions,
   *  in which case the charts fall back to synthetic curves. */
  samples?: PerfSample[];
}

/**
 * Sanity ceiling for any FPS field read from localStorage.
 *
 * Older builds of the RTSS reader validated `avg_fps <= 500` but NOT
 * `max_fps`, so a single uninitialised shared-memory entry could land
 * `maxFps ≈ u32::MAX ≈ 4.3×10⁹` in the persisted session. Once there, every
 * reduce / aggregation consumer (ActivityPage table, GameActivity FPS chart,
 * Splashscreen "Last Played", etc.) renders u32::MAX, and the chart Y-axis
 * auto-spacing lays out at 858993459 / 1717986918 / 2576980777 / 3435973836 /
 * 4294967262 — the 0x33 / 0x66 / 0x99 / 0xCC / 0xFF banding.
 *
 * Note the FE cap (1000) deliberately sits above the Rust per-sample cap
 * (500): the Rust bound is on an *instantaneous* RTSS/MAHM reading
 * (anything past a single sample's rate is the wrong field), whereas this
 * cap is on an *aggregate* session field that legitimately contains
 * momentary spikes higher than any single sample's instantaneous rate.
 * Harmoning the two caps back into one would re-break the chart.
 */
export const SANE_MAX_FPS = 1000;

/**
 * Sanitize a `SessionMetrics` payload read from localStorage so historical
 * FPS-poisoned data doesn't drive downstream UI into the u32::MAX bands.
 *
 * Rules:
 *  1. Each FPS field (avg / min / max) is clamped to `[0, SANE_MAX_FPS]`.
 *     Out-of-range / non-finite values are dropped to 0 (treated as
 *     "this reading is untrustworthy").
 *  2. If avg is sane but min/max collapsed to 0, synthesise a plausible
 *     `min = round(avg * 0.8)`, `max = round(avg * 1.3)` so the chart
 *     isn't a flat 0 line. Both ends are clamped to [1, SANE_MAX_FPS].
 *  3. Restore the ordering invariant `min ≤ avg ≤ max` so downstream chart
 *     generators (e.g. generateConsistentSeries) don't enter their
 *     degenerate n > l fall-back path that produces a flat line.
 *  4. Each run logs a single `console.warn` summarising which fields had
 *     to be repaired, so a real RTSS / MAHM misread isn't silently lost.
 */
// Per-signature dedupe so a 200-session history doesn't spam the
// console with identical warnings. Cleared on reload — if the bug
// recurs after a restart the user sees the warning again.
const warnedSignatures = new Set<string>();

export function sanitizeSessionMetrics(m: SessionMetrics): SessionMetrics {
  const fix = (v: number | null | undefined): number => {
    if (typeof v !== "number" || !Number.isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > SANE_MAX_FPS) return 0; // poisoned sentinel
    return Math.round(v);
  };

  const originalAvg = m.avgFps;
  const originalMin = m.minFps;
  const originalMax = m.maxFps;

  let avg = fix(originalAvg);
  let min = fix(originalMin);
  let max = fix(originalMax);

  if (avg > 0 && (min === 0 || max === 0 || min > max)) {
    min = Math.max(1, Math.min(SANE_MAX_FPS, Math.round(avg * 0.8)));
    max = Math.max(1, Math.min(SANE_MAX_FPS, Math.round(avg * 1.3)));
  }
  // Restore min ≤ avg ≤ max in case any survive-clamp values are inverted
  // (e.g. a legitimate session whose persisted min > max due to enum drift).
  const lo = Math.min(min, avg, max);
  const hi = Math.max(min, avg, max);
  if (avg > 0 && (min !== lo || max !== hi)) {
    min = lo;
    max = hi;
    avg = Math.min(Math.max(avg, min), max);
  }

  // Single-line observability for poisoned fields vs genuine zeros, so an
  // RTSS / MAHM regression can be diagnosed from the console rather than
  // appearing as a silent "no FPS recorded" empty chart. Deduped per
  // signature so a 200-session history doesn't emit 200 identical warns.
  const poisoned: string[] = [];
  if (typeof originalAvg === "number" && Number.isFinite(originalAvg) && originalAvg > SANE_MAX_FPS) poisoned.push("avg");
  if (typeof originalMin === "number" && Number.isFinite(originalMin) && originalMin > SANE_MAX_FPS) poisoned.push("min");
  if (typeof originalMax === "number" && Number.isFinite(originalMax) && originalMax > SANE_MAX_FPS) poisoned.push("max");
  if (poisoned.length > 0) {
    const sig = poisoned.join(",");
    if (!warnedSignatures.has(sig)) {
      warnedSignatures.add(sig);
      // eslint-disable-next-line no-console
      console.warn(`[sanitizeSessionMetrics] dropped poisoned FPS field(s) [${sig}] from session(s); reconstructed min/max from avg (sane cap ${SANE_MAX_FPS}). Once-per-signature dedupe; further occurrences are silent.`);
    }
  }
  // Preserve real per-sample telemetry (clamping any poisoned FPS). Legacy
  // sessions without samples simply carry `undefined` through.
  const samples = m.samples?.map((s) => ({
    ...s,
    fps:
      s.fps != null && Number.isFinite(s.fps) && s.fps >= 0 && s.fps <= SANE_MAX_FPS
        ? s.fps
        : null,
  }));

  return { ...m, avgFps: avg, minFps: min, maxFps: max, samples };
}

/** GPU info returned from the system. */
export interface GpuInfo {
  id: string;
  name: string;
  vendor: string;
  vramMb: number;
}

/** Build per-session metric series for trend charts. Each data point comes from
 * a single real recorded session (oldest → newest), so the line connects actual
 * measurements, not synthetic interpolations. */
export function buildSessionMetricsSeries(sessions: GameSession[]): {
  fps: number[];
  gpu: number[];
  cpu: number[];
  ram: number[];
  gpuTemp: number[];
  cpuTemp: number[];
  labels: string[];
} {
  const withMetrics = sessions
    .filter((s) => s.metrics !== undefined)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const fmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

  return {
    fps: withMetrics.map((s) => s.metrics!.avgFps),
    gpu: withMetrics.map((s) => s.metrics!.avgGpuUsage),
    cpu: withMetrics.map((s) => s.metrics!.avgCpuUsage),
    ram: withMetrics.map((s) => s.metrics!.avgRamUsage),
    gpuTemp: withMetrics.map((s) => s.metrics!.avgGpuTemp),
    cpuTemp: withMetrics.map((s) => s.metrics!.avgCpuTemp),
    labels: withMetrics.map((s) => fmt.format(new Date(s.date))),
  };
}

/** Aggregated activity stats over a time period. */
export interface ActivityStats {
  totalSessions: number;
  totalPlayTimeMin: number;
  avgSessionMin: number;
  mostPlayedGame: string;
  mostPlayedGameTimeMin: number;
  dailyAvg: number[];       // 7 values for last 7 days (minutes)
  dailyLabels: string[];    // 7 labels ("Mon", "Tue", etc.)
  weeklyAvg: number[];      // 4-5 values for last weeks
  weeklyLabels: string[];
  genreBreakdown: { genre: string; minutes: number }[];
  platformBreakdown: { platform: string; minutes: number }[];
  /** Top played games ranked by total playtime (descending). */
  topGames: {
    gameId: string;
    gameName: string;
    minutes: number;
    sessions: number;
  }[];
  /** Longest single session in minutes. */
  longestSessionMin: number;
  avgFpsAll: number;
  avgGpuAll: number;
  avgCpuAll: number;
}

// ─── Game Relations (relations card on GamePage + StoreGameDetail) ──────────

/**
 * A single entry in the Game Relations card. Extends `SimilarGame` with
 * optional navigation hints so the same shape works for both library
 * games (navigate to /library/{id}) and store games (navigate to
 * /store/{slug}). The `id` field is always required because it's
 * the deduplication key across groups; everything else is optional.
 */
export interface RelatedGame extends SimilarGame {
  /** IGDB slug for store navigation. Populated for store-mode entries. */
  slug?: string;
  /** Local library game id. Populated for in-library entries. */
  libraryGameId?: string;
  /**
   * True when this related game is already in the user's local library.
   * The card renders a subtle "In library" pill on these entries so the
   * user doesn't open a game they already own.
   */
  inLibrary?: boolean;
}

/**
 * The kind of relationship a `RelatedGame` entry has to the "current"
 * game. Each variant maps to a distinct group section in the
 * GameRelationsCard, ordered in a fixed visual hierarchy (see
 * `RELATION_GROUP_ORDER`).
 *
 * - `same_series`      : same IGDB collection (e.g. "Mass Effect")
 * - `same_franchise`   : same IGDB franchise
 * - `same_developer`   : same developer string in the local library
 * - `same_publisher`   : same publisher string in the local library
 * - `shared_genres`    : ≥2 overlapping genre tags (heuristic)
 * - `in_your_library`  : store-page cross-ref; the store game is in
 *                        the user's local library under a matching name
 * - `other_in_collection` : store-page; other games in the same IGDB
 *                        collection, fetched via `get_collection_games`
 * - `similar`          : IGDB's `similar_games` field
 */
export type RelationType =
  | "same_series"
  | "same_franchise"
  | "same_developer"
  | "same_publisher"
  | "shared_genres"
  | "in_your_library"
  | "other_in_collection"
  | "similar";

/**
 * Fixed visual order for relation groups. Library-mode groups come
 * first (the local-library focus is the primary use case, mirroring
 * Playnite's GameRelations), then store-mode groups (which only
 * appear on the Store game detail page).
 */
export const RELATION_GROUP_ORDER: readonly RelationType[] = [
  "same_series",
  "same_franchise",
  "same_developer",
  "same_publisher",
  "shared_genres",
  "in_your_library",
  "other_in_collection",
  "similar",
];

/**
 * One rendered group inside the GameRelationsCard. The card maps
 * `type` → title → icon and renders the entries as a horizontal
 * row of covers. Groups are computed in a single `useMemo` so the
 * library scan runs at most once per game-change.
 */
export interface RelationGroup {
  /** The relation type — drives title, icon, and order. */
  type: RelationType;
  /** Display title (e.g. "More from this series"). */
  title: string;
  /** Optional sub-label (e.g. "Mass Effect" for the series group). */
  subtitle?: string;
  /** The games in this group, ordered by the per-group sort rule. */
  games: RelatedGame[];
}


