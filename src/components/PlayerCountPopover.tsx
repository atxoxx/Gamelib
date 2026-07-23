import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { HydraGameStats } from "../types/game";
import { SteamStatsPopoverBody } from "./SteamPlayerCountPopover";
import { HydraStatsPopoverBody } from "./HydraStatsPopover";

/**
 * PlayerCountPopover
 *
 *  Click-to-expand companion to the combined `<PlayerCountBadge>`.
 *  One anchored card, two sub-tabs:
 *
 *   - **Steam** — live count, aggregate review breakdown, 24h player
 *     activity sparkline, "View on Steam" link
 *     (`SteamStatsPopoverBody`, shared with the legacy Steam-only
 *     popover).
 *   - **Hydra** — active Hydra players, total community downloads,
 *     and the 1–5 star community score (`HydraStatsPopoverBody`).
 *
 *  The header shows the combined total so the badge and popover agree
 *  at click time; the tab strip underneath splits it per source. The
 *  default tab is whichever source contributes more players, so the
 *  most relevant detail is one click away, not two.
 *
 *  Positioning, dismissal, and accessibility mirror
 *  `SteamPlayerCountPopover` exactly (portal into body, anchor-flip +
 *  viewport clamp, Escape / click-outside / X to close, dialog
 *  semantics, focus restore). Reuses the `steam-stats-popover` CSS
 *  skeleton; the tab strip is the only new block.
 */

interface PlayerCountPopoverProps {
  appId: number;
  /** Ref to the badge element the popover anchors to. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Live Steam count captured from the badge (0 when none). */
  steamCount: number;
  /** Already-fetched Hydra stats from the badge's hook (null when
   *  Hydra has no data for this appid — the tab shows an empty
   *  state instead of refetching). */
  hydraStats: HydraGameStats | null;
  onClose: () => void;
}

type StatsTab = "steam" | "hydra";

const VIEWPORT_MARGIN = 12;
/** Fallback width for the first-paint position pass, before the
 *  browser has measured the rendered popover (canonical width lives
 *  in `store.css` on `.steam-stats-popover`). */
const FALLBACK_WIDTH_PX = 360;

export default function PlayerCountPopover({
  appId,
  anchorRef,
  steamCount,
  hydraStats,
  onClose,
}: PlayerCountPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  // Keep the latest onClose in a ref so the global keydown / mousedown
  // handlers (registered once on mount) always call the freshest
  // version without re-binding on every parent render.
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const hydraCount = hydraStats?.playerCount ?? 0;
  const total = steamCount + hydraCount;

  // Land on the tab with more players — usually the one the user is
  // curious about. Steam wins ties (richer content: reviews + chart).
  const [tab, setTab] = useState<StatsTab>(
    hydraCount > steamCount ? "hydra" : "steam"
  );

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
    // `tab` included so switching tabs (content height changes)
    // re-clamps against the bottom of the viewport.
  }, [anchorRef, tab]);

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

  return createPortal(
    <div
      ref={popoverRef}
      className={`steam-stats-popover ${tab === "hydra" ? "hydra-stats-popover" : ""} ${position.growFromLeft ? "from-left" : "from-right"}`.trim()}
      style={{ top: position.top, left: position.left }}
      role="dialog"
      aria-modal="true"
      aria-label="Player stats"
    >
      {/* ── Header — combined total, agrees with the badge. ──────── */}
      <header className="steam-stats-popover-header">
        <div className="steam-stats-popover-header-icon" aria-hidden="true">
          <span className="steam-stats-popover-header-dot" />
        </div>
        <div className="steam-stats-popover-header-body">
          <div className="steam-stats-popover-header-title">
            {total.toLocaleString()} playing now
          </div>
          <div className="steam-stats-popover-header-subtitle">
            {steamCount.toLocaleString()} Steam ·{" "}
            {hydraCount.toLocaleString()} Hydra
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

      {/* ── Source tabs ───────────────────────────────────────────── */}
      <div className="player-stats-tabs" role="tablist" aria-label="Stats source">
        <button
          type="button"
          role="tab"
          id="player-stats-tab-steam"
          aria-selected={tab === "steam"}
          aria-controls="player-stats-panel-steam"
          className={`player-stats-tab player-stats-tab--steam ${tab === "steam" ? "is-active" : ""}`.trim()}
          onClick={() => setTab("steam")}
        >
          <span className="player-stats-tab-dot" aria-hidden="true" />
          Steam
        </button>
        <button
          type="button"
          role="tab"
          id="player-stats-tab-hydra"
          aria-selected={tab === "hydra"}
          aria-controls="player-stats-panel-hydra"
          className={`player-stats-tab player-stats-tab--hydra ${tab === "hydra" ? "is-active" : ""}`.trim()}
          onClick={() => setTab("hydra")}
        >
          <span className="player-stats-tab-dot" aria-hidden="true" />
          Hydra
        </button>
      </div>

      {/* ── Tab panels — bodies shared with the single-source
          popovers, so content and styling stay in lockstep. ──────── */}
      {tab === "steam" ? (
        <div
          role="tabpanel"
          id="player-stats-panel-steam"
          aria-labelledby="player-stats-tab-steam"
        >
          <SteamStatsPopoverBody appId={appId} currentCount={steamCount} />
        </div>
      ) : (
        <div
          role="tabpanel"
          id="player-stats-panel-hydra"
          aria-labelledby="player-stats-tab-hydra"
        >
          {hydraStats ? (
            <HydraStatsPopoverBody stats={hydraStats} />
          ) : (
            <div className="steam-stats-popover-body">
              <div className="steam-stats-popover-section-error">
                No Hydra community data for this game yet.
              </div>
            </div>
          )}
        </div>
      )}
    </div>,
    document.body
  );
}
