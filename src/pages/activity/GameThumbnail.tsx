import { useState } from "react";

/**
 * A small, square thumbnail for a game.
 *
 * Mirrors the image-resolution chain used in the main app's
 * `SidebarGameItem` so the Activity page games list and sessions log
 * look identical to the sidebar:
 *
 *   1. `iconUrl` — small square icon, preferred at this size.
 *   2. `coverArtUrl` — larger cover image; for Steam-imported games the
 *      URL is a `library_600x900_2x.jpg` reference. If it 404s, walk
 *      the Steam-CDN URL fallback chain
 *      (`library_600x900_2x` → `library_600x900` → `header.jpg`) before
 *      giving up — the same chain the sidebar uses, so behaviour stays
 *      consistent across surfaces.
 *   3. Gradient letter placeholder — the first letter of the game name
 *      on a stable hash-derived gradient, so the row stays visually
 *      identifiable even when no asset is reachable.
 *
 * The outer container class controls the size (28x28 for session rows,
 * 32x32 for the dashboard sidebar). The component always renders a
 * square that fills its container, with `border-radius: inherit` so the
 * parent's rounding still applies.
 *
 * Steam player count
 * ──────────────────
 * The concurrent-player badge is rendered by the parent consumer
 * (ActivitySessionItem / ActivitySidebarGameItem), not inside this
 * component. That keeps the thumbnail's DOM structure flat
 * (img-or-placeholder, no wrapper div) so the existing CSS that
 * sizes via `className` continues to work — wrapping the
 * primary image in a container would have broken the layout that
 * assumes the className lands on the img/placeholder directly.
 */
export function GameThumbnail({
  iconUrl,
  coverArtUrl,
  steamAppId,
  name,
  className,
}: {
  iconUrl?: string | null;
  /** Larger cover image. For Steam games this is typically a
   *  `library_600x900_2x.jpg` reference that can 404 in the wild. */
  coverArtUrl?: string | null;
  /** Steam app id. When set, the cover's `onError` walks the Steam-CDN
   *  fallback chain before giving up. Ignored for non-Steam games. */
  steamAppId?: number | null;
  name: string;
  /** Outer container class. Both the image and the placeholder
   *  inherit its dimensions / border-radius. */
  className?: string;
}) {
  // Track whether the icon failed to load (e.g. stale base64 left over
  // from a previous library import). Reset on URL change so a new icon
  // re-tries the image rather than sticking on the placeholder.
  const [iconError, setIconError] = useState(false);

  // Track whether the cover has fallen through the entire Steam-CDN
  // chain. We can't change `coverArtUrl` from inside the component
  // without prop wiring, so a local boolean is enough — once we've
  // exhausted the fallbacks, fall through to the letter placeholder.
  const [coverExhausted, setCoverExhausted] = useState(false);

  if (iconUrl && !iconError) {
    return (
      <img
        src={iconUrl}
        alt={name}
        className={className}
        onError={() => setIconError(true)}
      />
    );
  }

  if (coverArtUrl && !coverExhausted) {
    return (
      <img
        src={coverArtUrl}
        alt={name}
        className={className}
        onError={(e) => {
          const img = e.currentTarget;
          // Steam-CDN fallback chain. Walks progressively simpler URLs
          // (2x → 1x → header) on each onError. After header.jpg, the
          // chain is exhausted; we let the next render fall through to
          // the letter placeholder. Matches the chain in
          // `SidebarGameItem` so the two surfaces degrade in lockstep.
          //
          // NOTE: locally-stored covers are typically base64 data URLs,
          // so the substring checks below will not match them and the
          // chain collapses to a single `setCoverExhausted(true)` —
          // which is the correct behaviour. The Steam-CDN walk only
          // fires for covers that were originally pulled from Steam
          // (e.g. via `enrichGameMetadata`) and still reference those
          // URLs after a CDN rotate.
          if (steamAppId) {
            if (img.src.includes("library_600x900_2x")) {
              img.src = `https://cdn.akamai.steamstatic.com/steam/apps/${steamAppId}/library_600x900.jpg`;
              return;
            }
            if (img.src.includes("library_600x900")) {
              img.src = `https://cdn.akamai.steamstatic.com/steam/apps/${steamAppId}/header.jpg`;
              return;
            }
          }
          setCoverExhausted(true);
        }}
      />
    );
  }

  // Final fallback: gradient letter placeholder. First character of the
  // game name, uppercased. "BeamNG.drive" → "B". Empty / whitespace-only
  // names collapse to "?" so the placeholder never looks blank.
  const trimmed = (name || "").trim();
  const letter = trimmed.charAt(0).toUpperCase() || "?";

  // Deterministic gradient index from the game name. Same name → same
  // color every render, so a player's library feels consistent between
  // sessions even when icons are missing.
  const gradientIndex = hashStringToIndex(trimmed || "?", GRADIENTS.length);

  return (
    <div
      className={
        (className || "") +
        " game-thumbnail__placeholder" +
        ` game-thumbnail__placeholder--g${gradientIndex}`
      }
      aria-label={name}
      role="img"
    >
      <span className="game-thumbnail__letter">{letter}</span>
    </div>
  );
}

// Eight theme-friendly gradients. Each pair (from / to) is hand-picked
// to stay readable in both light and dark themes, with white text
// contrast. Order is fixed; the hash picks the index.
const GRADIENTS = [
  "linear-gradient(135deg, #6366f1, #8b5cf6)", // indigo → violet
  "linear-gradient(135deg, #06b6d4, #3b82f6)", // cyan → blue
  "linear-gradient(135deg, #10b981, #06b6d4)", // emerald → cyan
  "linear-gradient(135deg, #f59e0b, #ef4444)", // amber → red
  "linear-gradient(135deg, #ec4899, #f43f5e)", // pink → rose
  "linear-gradient(135deg, #8b5cf6, #ec4899)", // violet → pink
  "linear-gradient(135deg, #14b8a6, #22c55e)", // teal → green
  "linear-gradient(135deg, #f97316, #facc15)", // orange → yellow
];

/** Stable hash → index in [0, max). Used for picking a gradient. */
function hashStringToIndex(str: string, max: number): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    // djb2-style hash: cheap, decent distribution for short strings.
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % max;
}
