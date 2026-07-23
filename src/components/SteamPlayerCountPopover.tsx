import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { SteamGameReviews } from "../types/game";
import { useSteamGameStats } from "../hooks/useSteamGameStats";
import SteamPlayerActivityCompact from "./SteamPlayerActivityCompact";

/**
 * SteamPlayerCountPopover
 *
 *  Click-to-expand companion to `<SteamPlayerCount>`. Renders a compact
 *  anchored card next to the badge with three layers of info:
 *
 *   1. **Live current players** — pulled from the parent's count so
 *      the badge and the popover header agree at click time.
 *   2. **Aggregate review breakdown** — positive/total ratio as a
 *      horizontal bar with Steam's qualitative label ("Very Positive",
 *      "Mixed", …) and the raw counts underneath.
 *   3. **Player activity (24h)** — compact sparkline + Peak / Avg /
 *      Samples summary so the user gets the trend without leaving the
 *      popover.
 *
 *  Static metadata (developer / publisher / release date / price) was
 *  moved off the popover:
 *    - Developer / publisher / release date live on the Game page
 *      Info card (more appropriate context, doesn't compete with the
 *      sparkline for vertical space).
 *    - Price is rendered as the 4th KPI tile in `InfoKpiCard` next
 *      to Status / Play Time / Size, fetched via the same shared
 *      `useSteamGameStats` hook.
 *
 *  All three popover sections are populated by a single
 *  `get_steam_game_stats` Tauri command so the IPC round-trip is one
 *  and the two HTTP fetches fan out in parallel on the Rust side.
 *  Each section degrades independently — a Steam hiccup on
 *  `appdetails` blanks only the dependent data, leaving the live
 *  count and reviews intact.
 *
 *  Positioning & dismissal
 *  ───────────────────────
 *  - Rendered into `document.body` via a React portal so the popover
 *    is never clipped by the banner's `overflow: hidden` (every
 *    surface this lives on has one).
 *  - Anchored to the badge by `anchorRef`. Position is recomputed on
 *    mount, window resize, and any scroll so the card stays pinned
 *    to the badge as the user scrolls the page.
 *  - Flips horizontally when the badge sits close to the right edge
 *    of the viewport (typical on the Game page where the banner is
 *    full-width) and clamps against the viewport edges with a 12px
 *    margin so it never sticks flush to a side.
 *  - Dismissed by clicking outside the popover + anchor, by pressing
 *    Escape, or by clicking the X in the header.
 *
 *  Accessibility
 *  ─────────────
 *  - `role="dialog"` + `aria-modal="true"` so screen readers
 *    announce it as a modal even though there's no full-page backdrop.
 *  - Focus moves to the close button on open and is restored to the
 *    badge on close so keyboard users don't lose their place.
 *  - The live count is `aria-live="polite"` so an updated number
 *    doesn't interrupt the user's screen-reader flow.
 */

interface SteamPlayerCountPopoverProps {
  appId: number;
  /** Ref to the badge element the popover anchors to. Must be the
   *  same ref used by the click handler so click-outside detection,
   *  position recalc, and focus restoration all read from a single
   *  element. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Current count, captured at click time from the parent. Re-using
   *  the parent's number instead of awaiting the backend's `current`
   *  field keeps the popover header in lockstep with the badge. */
  currentCount: number;
  onClose: () => void;
}

/**
 * SteamStatsPopoverBody
 * ─────────────────────
 * The Steam sections of the popover (live count, review breakdown,
 * 24h activity sparkline, "View on Steam" footer link), extracted so
 * the combined Steam + Hydra `PlayerCountPopover` can render them as
 * its Steam tab without duplicating the fetch/derive logic. Owns its
 * own `useSteamGameStats` call — the hook + Rust cache dedupe repeat
 * fetches, so embedding is free.
 */
export function SteamStatsPopoverBody({
  appId,
  currentCount,
}: {
  appId: number;
  /** Live Steam count from the parent badge (0 when Steam has none). */
  currentCount: number;
}) {
  const {
    data: stats,
    isLoading: statsLoading,
    error: fetchError,
  } = useSteamGameStats(appId);

  const reviewsLoading = statsLoading;

  // Memoize the positive-percent so the bar fill doesn't recompute on
  // every render (it's just a division, but the bar transition is
  // smoother when the value's identity is stable).
  const reviewPositivePct = useMemo(() => {
    if (!stats?.reviews) return null;
    const total = stats.reviews.totalReviews;
    if (total <= 0) return null;
    return Math.round((stats.reviews.totalPositive / total) * 100);
  }, [stats?.reviews]);

  // Review score is Steam's 1-9 bucket; map to a color tier so the
  // bar reads as a quick visual signal. 7+ = green, 5-6 = amber, ≤4
  // = red. Bucket 0 means Steam hasn't assigned one yet.
  const reviewTone = useMemo<"good" | "mid" | "bad" | "none">(() => {
    const s = stats?.reviews?.score;
    if (s == null || s === 0) return "none";
    if (s >= 7) return "good";
    if (s >= 5) return "mid";
    return "bad";
  }, [stats?.reviews?.score]);

  const reviewSummary: SteamGameReviews | null = stats?.reviews ?? null;

  return (
    <>
      <div className="steam-stats-popover-body">
        {/* Live current players — reuses the parent badge's count so
            the two agree at the moment of click. */}
        <div className="steam-stats-popover-stat steam-stats-popover-stat--current">
          <div
            className="steam-stats-popover-stat-value"
            aria-live="polite"
            aria-atomic="true"
          >
            {currentCount.toLocaleString()}
          </div>
          <div className="steam-stats-popover-stat-label">
            playing on Steam right now
          </div>
        </div>

        <div className="steam-stats-popover-divider" />

        {/* Reviews — aggregate only (the per-review list is hidden in
            the backend to keep the response small). */}
        <section className="steam-stats-popover-section">
          <div className="steam-stats-popover-section-header">
            <span className="steam-stats-popover-section-title">Reviews</span>
            {reviewsLoading ? (
              <span className="steam-stats-popover-skeleton-pill" />
            ) : reviewSummary ? (
              <span
                className={`steam-stats-popover-section-badge steam-stats-popover-tone-${reviewTone}`}
              >
                {reviewSummary.scoreDesc ?? "Unrated"}
              </span>
            ) : (
              <span className="steam-stats-popover-section-empty">—</span>
            )}
          </div>
          {reviewsLoading ? (
            <>
              <div className="steam-stats-popover-skeleton-bar" />
              <div className="steam-stats-popover-skeleton-line short" />
            </>
          ) : reviewSummary ? (
            <>
              <div
                className={`steam-stats-popover-reviews-bar steam-stats-popover-tone-${reviewTone}`}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={reviewPositivePct ?? 0}
                aria-label={`${reviewPositivePct ?? 0}% positive reviews`}
              >
                <div
                  className="steam-stats-popover-reviews-bar-fill"
                  style={{ width: `${reviewPositivePct ?? 0}%` }}
                />
              </div>
              <div className="steam-stats-popover-reviews-count">
                <strong>{reviewSummary.totalPositive.toLocaleString()}</strong>{" "}
                positive
                <span className="steam-stats-popover-reviews-count-sep">·</span>
                {reviewSummary.totalNegative.toLocaleString()} negative
                <span className="steam-stats-popover-reviews-count-sep">·</span>
                {reviewSummary.totalReviews.toLocaleString()} total
              </div>
            </>
          ) : (
            <div className="steam-stats-popover-section-error">
              {stats?.reviewsError ?? "No review data"}
            </div>
          )}
        </section>

        <div className="steam-stats-popover-divider" />

        {/* Player activity (24h) — compact sparkline + Peak / Avg /
            Samples summary. Owns its own polling via
            `usePlayerCountHistory`. */}
        <SteamPlayerActivityCompact appId={appId} />

        {/* If the whole fetch failed (e.g. offline), surface a single
            inline message instead of three "—" placeholders. */}
        {fetchError && !stats && (
          <div className="steam-stats-popover-fetch-error" role="alert">
            Couldn't reach Steam. Check your connection and try again.
          </div>
        )}
      </div>

      <footer className="steam-stats-popover-footer">
        <a
          href={`https://store.steampowered.com/app/${appId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="steam-stats-popover-footer-link"
        >
          <svg
            viewBox="0 0 24 24"
            width="13"
            height="13"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          View on Steam
        </a>
      </footer>
    </>
  );
}

const VIEWPORT_MARGIN = 12;
/** Fallback width for the layout-effect position recalc on first
 *  paint, used only when the browser has not yet measured the
 *  rendered popover. The canonical width lives in the CSS custom
 *  property `--steam-stats-popover-width` (set in `store.css` on
 *  `.steam-stats-popover`); this constant exists solely so the
 *  position math doesn't read `0` on the first layout pass. */
const FALLBACK_WIDTH_PX = 360;

export default function SteamPlayerCountPopover({
  appId,
  anchorRef,
  currentCount,
  onClose,
}: SteamPlayerCountPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  // Keep the latest onClose in a ref so the global keydown / mousedown
  // handlers (registered once on mount) always call the freshest version
  // without re-binding on every parent render.
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // ── Position state ─────────────────────────────────────────────────
  // Stored in state (not derived in render) so the JSX stays pure and
  // the position-flip animation has a stable, memoized class.
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    growFromLeft: boolean;
  }>({ top: VIEWPORT_MARGIN, left: VIEWPORT_MARGIN, growFromLeft: true });

  useLayoutEffect(() => {
    function recompute() {
      const anchor = anchorRef.current;
      const popover = popoverRef.current;
      if (!anchor || !popover) return;
      const rect = anchor.getBoundingClientRect();
      const popRect = popover.getBoundingClientRect();
      const popWidth = popRect.width || FALLBACK_WIDTH_PX;
      const popHeight = popRect.height;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Horizontal: prefer the right of the anchor; flip to the left
      // when there isn't room. When neither side fits, pick whichever
      // has more room and clamp against the viewport edge.
      const spaceRight = vw - rect.right - VIEWPORT_MARGIN;
      const spaceLeft = rect.left - VIEWPORT_MARGIN;
      let left: number;
      let growFromLeft: boolean;
      if (spaceRight >= popWidth) {
        left = rect.right + 6;
        growFromLeft = true;
      } else if (spaceLeft >= popWidth) {
        left = rect.left - popWidth - 6;
        growFromLeft = false;
      } else if (spaceRight >= spaceLeft) {
        left = rect.right + 6;
        growFromLeft = true;
      } else {
        left = rect.left - popWidth - 6;
        growFromLeft = false;
      }
      left = Math.max(
        VIEWPORT_MARGIN,
        Math.min(left, vw - popWidth - VIEWPORT_MARGIN)
      );

      // Vertical: align top with the anchor's top by default. If
      // the popover would extend past the bottom of the viewport,
      // shift it up so the footer stays visible.
      let top = rect.top;
      if (top + popHeight + VIEWPORT_MARGIN > vh) {
        top = Math.max(VIEWPORT_MARGIN, vh - popHeight - VIEWPORT_MARGIN);
      }
      if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;

      setPosition({ top, left, growFromLeft });
    }

    recompute();
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, true);
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, true);
    };
    // anchorRef is a stable ref object — intentionally excluded.
  }, [anchorRef]);

  // ── Focus capture + global dismissal ────────────────────────────────
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;

    requestAnimationFrame(() => {
      // Default focus target is the close button so Tab moves into
      // the body of the popover on the next press. If the close
      // button doesn't exist yet (e.g. SSR or a future refactor),
      // fall back to the popover root.
      const target =
        popoverRef.current?.querySelector<HTMLElement>(
          ".steam-stats-popover-close"
        ) ?? popoverRef.current;
      target?.focus();
    });

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      }
    }
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node | null;
      if (popoverRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onCloseRef.current();
    }

    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handlePointerDown);
      previouslyFocused?.focus();
    };
    // anchorRef intentionally excluded (stable ref).
  }, [anchorRef]);

  return createPortal(
    <div
      ref={popoverRef}
      className={`steam-stats-popover ${position.growFromLeft ? "from-left" : "from-right"}`}
      style={{ top: position.top, left: position.left }}
      role="dialog"
      aria-modal="true"
      aria-label="Steam game stats"
    >
      {/* ── Header ────────────────────────────────────────────────── */}
      <header className="steam-stats-popover-header">
        <div className="steam-stats-popover-header-icon" aria-hidden="true">
          <span className="steam-stats-popover-header-dot" />
        </div>
        <div className="steam-stats-popover-header-body">
          <div className="steam-stats-popover-header-title">Steam</div>
          <div className="steam-stats-popover-header-subtitle">
            Live player stats
          </div>
        </div>
        <button
          type="button"
          className="steam-stats-popover-close"
          onClick={onClose}
          aria-label="Close stats"
          title="Close"
        >
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </header>

      {/* ── Body + footer — shared with the combined popover's Steam
          tab (see PlayerCountPopover.tsx). */}
      <SteamStatsPopoverBody appId={appId} currentCount={currentCount} />
    </div>,
    document.body
  );
}
