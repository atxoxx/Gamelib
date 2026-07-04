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

// ─── Store Browsing Types ────────────────────────────────────────────────────

/** Category tabs in the Store page. */
export type StoreCategory = "trending" | "popular" | "top" | "all";

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

