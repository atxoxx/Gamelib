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

/** A time-series data point for charts. */
export interface MetricsDataPoint {
  timestamp: number;
  fps: number;
  cpuUsage: number;
  gpuUsage: number;
  ramUsage: number;
  cpuTemp: number;
  gpuTemp: number;
}

/** GPU info returned from the system. */
export interface GpuInfo {
  id: string;
  name: string;
  vendor: string;
  vramMb: number;
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

/** Derive time-series data points from session metrics for chart rendering.
 *  Since we collect aggregated per-session metrics (not high-frequency samples),
 *  we generate synthetic data points that represent the session's performance profile. */
export function deriveMetricsTimeSeries(
  metrics: SessionMetrics,
  durationMin: number,
  pointCount: number = 20
): MetricsDataPoint[] {
  const points: MetricsDataPoint[] = [];
  const baseTime = Date.now() - durationMin * 60000;
  const intervalMs = (durationMin * 60000) / pointCount;

  for (let i = 0; i < pointCount; i++) {
    // Deterministic curve: start high, dip in middle, end high
    const phase = i / pointCount;
    const curveFactor = 1.0 - 0.15 * Math.sin(phase * Math.PI * 2);
    // Deterministic micro-variation based on index (always same for same input)
    const micro = Math.sin(i * 7.3 + phase * 11.1) * 0.05;

    points.push({
      timestamp: baseTime + Math.floor(i * intervalMs),
      fps: Math.round(metrics.avgFps * (curveFactor + micro)),
      cpuUsage: Math.round(metrics.avgCpuUsage * (curveFactor + micro)),
      gpuUsage: Math.round(metrics.avgGpuUsage * (curveFactor + micro)),
      ramUsage: Math.round(metrics.avgRamUsage * (curveFactor + micro * 0.5)),
      cpuTemp: metrics.avgCpuTemp,
      gpuTemp: metrics.avgGpuTemp,
    });
  }
  return points;
}


