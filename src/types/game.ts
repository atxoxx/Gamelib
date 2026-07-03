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
}

export interface TimeToBeat {
  hastly?: number;
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

/** Extract a human-readable game name from an executable file path. */
export function gameNameFromPath(filePath: string): string {
  return (
    filePath
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.exe$/i, "") || "Unknown Game"
  );
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

