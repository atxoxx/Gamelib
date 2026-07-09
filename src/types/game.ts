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
  /** Playtime in minutes reported by Steam (used as fallback for playTime) */
  steamPlaytime?: number;
  /** Achievement completion data synced from Steam */
  steamAchievements?: SteamAchievement[];
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
  coverUrl?: string;
}

export interface ReleaseDateInfo {
  platform: string;
  dateStr: string;
  region: string;
}

export interface IgdbReview {
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
export type LibrarySource = "all" | "steam" | "local" | "gog" | "epic";

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

// ─── View Density ──────────────────────────────────────────────────────────────

/**
 * User-selectable card layout density in the Store page. Synced to
 * localStorage and applied to every `StoreGameCard` instance.
 *
 *   - compact   : cover-only, minimal footprint
 *   - cozy      : default; cover + small body with genres/platforms
 *   - cinematic : larger cards with body overlaid on the cover
 */
export type ViewDensity = "compact" | "cozy" | "cinematic";

/** localStorage key for the user's chosen density. */
export const VIEW_DENSITY_STORAGE_KEY = "gamelib_store_density_v1";

/** Default density when nothing is stored (or stored value is invalid). */
export const DEFAULT_DENSITY: ViewDensity = "cozy";

/** All valid density values, for runtime validation in the hook. */
export const VIEW_DENSITIES: readonly ViewDensity[] = [
  "compact",
  "cozy",
  "cinematic",
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
  genres: string[];
  platforms: string[];
  firstReleaseDate: string | null;
  totalRatingCount: number;
  hypes: number;
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

// ─── CrackWatch Status ──────────────────────────────────────────────────────

/** CrackWatch status parsed from crackrelease.com.
 *  Fetched on-demand via the `fetch_crackwatch_status` Tauri command. */
export interface CrackWatchStatus {
  /** "cracked" | "uncracked" | null — null when the page wasn't found or couldn't be parsed. */
  status: "cracked" | "uncracked" | null;
  /** Human-readable status label (e.g. "CRACKED", "UNCRACKED"). */
  statusLabel: string | null;
  /** e.g. "0 DAYS AND COUNTING" or "X DAYS AFTER RELEASE". */
  counter: string | null;
  /** Human-readable release date. */
  releaseDate: string | null;
  /** Crack date (e.g. "Jul 9, 2026" or "TBD"). "TBD" when not yet cracked. */
  crackDate: string | null;
  /** DRM protection (e.g. "Denuvo", "Steam", "Arxan"). */
  drmProtection: string | null;
  /** Scene group name (e.g. "CODEX", "CPY", "EMPRESS" or "TBD"). */
  sceneGroup: string | null;
  /** URL of the crackrelease page. */
  pageUrl: string | null;
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
  return { ...m, avgFps: avg, minFps: min, maxFps: max };
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
  avgFpsAll: number;
  avgGpuAll: number;
  avgCpuAll: number;
}

