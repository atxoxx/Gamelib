import { useRef, useState } from "react";
import useSteamPlayerCount from "../hooks/useSteamPlayerCount";
import SteamPlayerCountPopover from "./SteamPlayerCountPopover";

/**
 * Compact, pulsing "X playing now" badge powered by the official Steam
 * Web API (`ISteamUserStats/GetNumberOfCurrentPlayers/v1/`). Free, no API
 * key required, returns the count of players currently in-game for a
 * given Steam appid. Used on the Store hero, Store game detail, and
 * Library game detail banners.
 *
 * Click-to-expand
 * ───────────────
 * The badge is now a button that opens `<SteamPlayerCountPopover>`
 * next to itself, showing review breakdown, dev/publisher/release
 * date, and price. The popover is portaled into `document.body` so
 * it is never clipped by the banner's `overflow: hidden`.
 *
 * Behavior:
 *  - Polls every 60s while mounted (matches the Rust-side cache TTL so
 *    we never re-fetch before the backend has fresh data anyway).
 *  - Also re-fetches on tab/window focus so the user catches up after a
 *    long compile / distraction / break.
 *  - Renders nothing silently when:
 *      * appId is missing / falsy
 *      * the backend reports `Ok(None)` (Steam returned `result != 1`
 *        — most likely a Steam-tracked-but-quiet niche title)
 *      * the backend errors out (offline, invalid appid, etc.)
 *  - Counts of 0 also render nothing — a badge that says "0 playing" is
 *    information-free and visually noisy.
 */
export interface SteamPlayerCountProps {
  /** Steam appid, e.g. 730 for CS2. When undefined the badge is hidden. */
  appId?: number;
  /** Extra className merged onto the root pill element for per-banner
   *  positioning (e.g. "hero-player-count" for absolute top-right). */
  className?: string;
}

/** Format large counts as compact strings: 1234 → "1.2K", 1_350_000
 *  → "1.4M". Anything below 1000 stays as the raw integer so we don't
 *  lose sub-thousand precision in hero "12, 47, 89" scenarios. */
export function formatCompactPlayerCount(num: number): string {
  if (num < 1000) return num.toString();
  if (num < 1_000_000) {
    return (num / 1000).toFixed(num % 1000 === 0 ? 0 : 1).replace(/\.0$/, "") + "K";
  }
  return (num / 1_000_000).toFixed(num % 1_000_000 === 0 ? 0 : 1).replace(/\.0$/, "") + "M";
}

export default function SteamPlayerCount({
  appId,
  className = "",
}: SteamPlayerCountProps) {
  // Polling (60s + focus refresh) lives in the shared hook so the
  // combined Steam + Hydra badge (`PlayerCountBadge`) reuses the
  // exact same behavior. `null` covers "no data / errored / zero
  // players" — the badge hides for all of them.
  const count = useSteamPlayerCount(appId);

  // Popover open/close state. Clicking the badge toggles it; the
  // popover itself dismisses on Escape / click-outside / X and
  // calls `setPopoverOpen(false)` to close.
  const [popoverOpen, setPopoverOpen] = useState(false);

  // Ref to the badge element. The popover uses this for anchoring
  // and click-outside exclusion, so a click on the badge is
  // correctly treated as "toggle" (close if open) rather than
  // "outside click" (would also close, but only after the toggle
  // fires and only by accident).
  const badgeRef = useRef<HTMLDivElement>(null);

  if (count === null) return null;

  return (
    <>
      <div
        ref={badgeRef}
        // `steam-player-count--clickable` swaps the cursor and adds
        // a hover lift; the per-banner `className` (e.g. "hero-player-count")
        // stays untouched so positioning across Store / Game page
        // banners is unchanged.
        className={`steam-player-count steam-player-count--clickable ${className}`.trim()}
        title={`${count.toLocaleString()} playing on Steam right now — click for more stats`}
        role="button"
        tabIndex={0}
        aria-label={`${count.toLocaleString()} players currently in this game on Steam. Click for reviews, developer, and more.`}
        aria-haspopup="dialog"
        aria-expanded={popoverOpen}
        onClick={() => setPopoverOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setPopoverOpen((o) => !o);
          }
        }}
        // `data-count` lets the dev tools surface the underlying integer
        // when debugging the compact formatting without a round-trip.
        data-count={count}
      >
        <span className="steam-player-count-dot" aria-hidden="true" />
        <span
          className="steam-player-count-text"
          // `aria-live="polite"` announces count updates without
          // interrupting the screen reader. `aria-atomic="true"`
          // forces the whole "1.2K playing" string to re-read on
          // every tick rather than partial diffs ("1.2K" → "2.4K"
          // would otherwise just announce "K").
          aria-live="polite"
          aria-atomic="true"
        >
          {formatCompactPlayerCount(count)}
          <span className="steam-player-count-suffix"> playing</span>
        </span>
      </div>
      {popoverOpen && appId && (
        <SteamPlayerCountPopover
          appId={appId}
          anchorRef={badgeRef}
          currentCount={count}
          onClose={() => setPopoverOpen(false)}
        />
      )}
    </>
  );
}
