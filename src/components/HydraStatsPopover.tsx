import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { HydraGameStats } from "../types/game";
import { formatCompactPlayerCount } from "./SteamPlayerCount";

/**
 * HydraStatsPopover
 *
 *  Click-to-expand companion to `<HydraPlayerCount>`. Renders a compact
 *  anchored card next to the badge with the Hydra launcher's community
 *  stats for the game:
 *
 *   1. **Active players** — Hydra users currently in-game.
 *   2. **Community downloads** — total downloads recorded by Hydra
 *      across community sources.
 *   3. **Community score** — average 1–5 star score from Hydra user
 *      reviews (the same reviews shown in the Reviews → Hydra tab),
 *      rendered as a fractional star row + review count.
 *
 *  The stats object is passed in by the parent badge (already fetched
 *  and polling via `useHydraGameStats`), so opening the popover costs
 *  zero extra IPC/HTTP round-trips.
 *
 *  Positioning, dismissal, and accessibility mirror
 *  `SteamPlayerCountPopover` exactly (portal into body, anchor-flip +
 *  viewport clamp, Escape / click-outside / X to close, dialog
 *  semantics, focus restore). Shares the `steam-stats-popover` CSS
 *  skeleton with a `hydra-stats-popover` modifier for the purple
 *  accent.
 */

interface HydraStatsPopoverProps {
  /** Already-fetched Hydra stats from the parent badge's hook. */
  stats: HydraGameStats;
  /** Ref to the badge element the popover anchors to. */
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}

const VIEWPORT_MARGIN = 12;
/** Fallback width for the first-paint position pass, before the
 *  browser has measured the rendered popover (canonical width lives
 *  in `store.css` on `.steam-stats-popover`). */
const FALLBACK_WIDTH_PX = 360;

/** Fractional 1–5 star row: a dimmed base layer of five stars with a
 *  filled overlay clipped to `score / 5` width. Pure CSS clip — no
 *  per-star SVG math. */
function StarRow({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, (score / 5) * 100));
  const stars = "★★★★★";
  return (
    <span
      className="hydra-stats-stars"
      role="img"
      aria-label={`${score.toFixed(1)} out of 5 stars`}
    >
      <span className="hydra-stats-stars-base" aria-hidden="true">
        {stars}
      </span>
      <span
        className="hydra-stats-stars-fill"
        style={{ width: `${pct}%` }}
        aria-hidden="true"
      >
        {stars}
      </span>
    </span>
  );
}

export default function HydraStatsPopover({
  stats,
  anchorRef,
  onClose,
}: HydraStatsPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  // Keep the latest onClose in a ref so the global keydown / mousedown
  // handlers (registered once on mount) always call the freshest
  // version without re-binding on every parent render.
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // ── Position state ──────────────────────────────────────────────
  // Same anchor-flip + viewport-clamp math as SteamPlayerCountPopover.
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

  // ── Focus capture + global dismissal ────────────────────────────
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;

    requestAnimationFrame(() => {
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

  const hasScore = stats.reviewCount > 0 && stats.averageScore > 0;

  return createPortal(
    <div
      ref={popoverRef}
      className={`steam-stats-popover hydra-stats-popover ${position.growFromLeft ? "from-left" : "from-right"}`}
      style={{ top: position.top, left: position.left }}
      role="dialog"
      aria-modal="true"
      aria-label="Hydra community stats"
    >
      {/* ── Header ──────────────────────────────────────────────── */}
      <header className="steam-stats-popover-header">
        <div className="steam-stats-popover-header-icon" aria-hidden="true">
          <span className="steam-stats-popover-header-dot hydra-player-count-dot" />
        </div>
        <div className="steam-stats-popover-header-body">
          <div className="steam-stats-popover-header-title">
            Hydra Community
          </div>
          <div className="steam-stats-popover-header-subtitle">
            Hydra Launcher
          </div>
        </div>
        <button
          type="button"
          className="steam-stats-popover-close"
          onClick={onClose}
          aria-label="Close Hydra stats"
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

      {/* ── Body ────────────────────────────────────────────────── */}
      <div className="steam-stats-popover-body">
        {/* Active players — headline number, same slot as the Steam
            popover's "playing right now". */}
        <div className="steam-stats-popover-stat steam-stats-popover-stat--current">
          <div
            className="steam-stats-popover-stat-value"
            aria-live="polite"
            aria-atomic="true"
          >
            {stats.playerCount.toLocaleString()}
          </div>
          <div className="steam-stats-popover-stat-label">
            playing on Hydra right now
          </div>
        </div>

        <div className="steam-stats-popover-divider" />

        {/* Community downloads. */}
        <section className="steam-stats-popover-section">
          <div className="steam-stats-popover-section-header">
            <span className="steam-stats-popover-section-title">
              Community downloads
            </span>
            <span className="steam-stats-popover-section-badge hydra-stats-badge">
              {formatCompactPlayerCount(stats.downloadCount)}
            </span>
          </div>
          <div className="steam-stats-popover-reviews-count">
            <strong>{stats.downloadCount.toLocaleString()}</strong> downloads
            across community sources
          </div>
        </section>

        <div className="steam-stats-popover-divider" />

        {/* Community score — 1-5 stars from Hydra user reviews (the
            same reviews listed in the Reviews → Hydra tab). */}
        <section className="steam-stats-popover-section">
          <div className="steam-stats-popover-section-header">
            <span className="steam-stats-popover-section-title">
              Community score
            </span>
            {hasScore ? (
              <span className="steam-stats-popover-section-badge hydra-stats-badge">
                {stats.averageScore.toFixed(1)} / 5
              </span>
            ) : (
              <span className="steam-stats-popover-section-empty">—</span>
            )}
          </div>
          {hasScore ? (
            <div className="hydra-stats-score-row">
              <StarRow score={stats.averageScore} />
              <span className="steam-stats-popover-reviews-count">
                {stats.reviewCount.toLocaleString()}{" "}
                {stats.reviewCount === 1 ? "review" : "reviews"}
              </span>
            </div>
          ) : (
            <div className="steam-stats-popover-section-error">
              No Hydra reviews yet
            </div>
          )}
        </section>
      </div>
    </div>,
    document.body
  );
}
