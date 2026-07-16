// bigscreenFormat — pure string / number helpers used by the
// Big Screen hero, spotlight, and meta strip.
//
// All functions are deterministic, side-effect-free, and have no
// React or DOM dependencies — they're trivially testable and safe
// to import from any layer (component, hook, context).

/**
 * Truncate a string to at most `max` characters, appending a
 * single-character ellipsis if the input was longer. Whitespace at
 * the cut boundary is trimmed so the ellipsis lands flush against
 * a real letter (no "Hello …" with a dangling space).
 */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

/**
 * Render a Unix-ms timestamp as a relative "time ago" string.
 * Bins chosen for TV viewing distance: minutes, hours, days,
 * weeks, months, years — anything past two years rounds to "2y ago"
 * without becoming noisy.
 */
export function formatLastPlayed(ts: number): string {
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return "Just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 24) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

/**
 * Pull a 4-digit year out of an IGDB date string.
 *
 * ISO `YYYY-MM-DD` is the most common shape; we also accept the
 * first 4-digit run for free-form strings like "Q4 2025". Returns
 * `null` for missing or unparseable input — callers conditionally
 * render the year pill rather than emitting a placeholder.
 */
export function extractYear(date: string | undefined): number | null {
  if (!date) return null;
  const m = date.match(/(19|20)\d{2}/);
  return m ? Number.parseInt(m[0], 10) : null;
}

/**
 * Test whether a URL points to a directly-playable video file
 * (.mp4 / .webm / .mov / .m3u8). Used by the lightbox to decide
 * between `<video>` and `<img>`. Excludes YouTube / Twitch / Vimeo
 * link URLs because those can't play in a regular video element.
 */
export function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m3u8)(\?|#|$)/i.test(url);
}