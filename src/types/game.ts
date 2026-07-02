export interface Game {
  id: string;
  name: string;
  path: string; // full path to the game executable
  platform: string; // e.g., "Local", "Steam", "GOG"
  installed: boolean;
  playTime: string;
  addedAt: number; // timestamp
  coverArtUrl?: string; // base64 data URL for cover art image
  notes?: string; // user notes about the game
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
