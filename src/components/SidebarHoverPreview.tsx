import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { Game } from "../types/game";
import { PLAY_STATUS_DETAILS } from "../types/game";

/**
 * Relative-time helper. e.g. "just now", "5m ago", "3h ago",
 * "2d ago", "Mar 14". Caps at 60d so the value stays short on
 * the dense sidebar preview card.
 *
 * Returns "Never" for undefined / non-finite / zero timestamps so
 * the row stays legible without a conditional on every caller.
 */
function formatRelative(unixMs: number | undefined): string {
  if (!unixMs || !Number.isFinite(unixMs)) return "Never";
  const delta = Math.max(0, Date.now() - unixMs);
  const s = Math.floor(delta / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 60) return `${d}d ago`;
  try {
    return new Date(unixMs).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return `${d}d ago`;
  }
}

/** Parse `YYYY-MM-DD…` → `YYYY` for compact display. */
function parseYear(releaseDate: string | undefined | null): number | null {
  if (!releaseDate) return null;
  const head = releaseDate.substring(0, 4);
  const y = parseInt(head, 10);
  if (!Number.isFinite(y) || y < 1970 || y > 2100) return null;
  return y;
}

/**
 * Old surfaced-edge escape for an arbitrary `id` so a malicious /
 * weird game id (e.g. `{ } . # &`) can't break out of an `[id="…"]`
 * selector. We don't expect user-supplied ids, but the rendered
 * card would silently drift if CSS parsing failed — easier to be
 * defensive at the edge.
 */
function cssEscape(value: string): string {
  // CSS.escape is widely supported in Chromium 46+ which Tauri ships
  // with (WebView2 = Edge Chromium). Fall back to a safe substitute
  // only if the runtime doesn't expose it.
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_\-]/g, "\\$&");
}

interface SidebarHoverPreviewProps {
  /**
   * The hovered game, or `null` when the row is no longer active.
   * When null we render nothing (early return BEFORE any layout
   * effect setup so an inactive preview is zero-cost).
   */
  game: Game | null;
  /**
   * Selector that resolves to the row the preview is anchored
   * against. Stored on the row as `data-sidebar-game-id={game.id}`
   * so this is just `[data-sidebar-game-id="<escaped-id>"]`.
   * Using a selector instead of a ref means we don't have to
   * thread refs through every row — the preview locates the
   * anchor lazily whenever it recomputes position.
   */
  anchorSelector: string | null;
  /**
   * Open signal. While `true` the preview is considered for
   * display (gated by an internal delay timer so quick row
   * crossings don't pop a preview for every row touched).
   * `false` forces the preview to dismiss synchronously.
   */
  active: boolean;
  /** Delay (ms) before showing the preview after activation. */
  delay?: number;
}

export function SidebarHoverPreview({
  game,
  anchorSelector,
  active,
  delay = 350,
}: SidebarHoverPreviewProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const navigate = useNavigate();

  // Position state: live screen coords + side flag.
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    placement: "right" | "left";
  } | null>(null);

  // Visible mirror of `active`, gated by the delay.
  const [visible, setVisible] = useState(false);

  // Delay timer: schedule a show after `delay` ms, cancel on
  // deactivation. This is what suppresses preview flicker on
  // quick row-swap gestures.
  useEffect(() => {
    if (active) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = setTimeout(() => setVisible(true), delay);
    } else {
      clearTimeout(showTimerRef.current);
      setVisible(false);
    }
    return () => clearTimeout(showTimerRef.current);
  }, [active, delay]);

  // Re-position while visible. We bind to a single animation frame
  // schedule (requestAnimationFrame collapses slower scroll events
  // so a fast scroll doesn't pile up). When the anchor disappears
  // (e.g. filter changed while hovering), we dismiss instead of
  // silently drifting to (0,0).
  useEffect(() => {
    if (!visible || !anchorSelector) return;

    let rafHandle: number | undefined;

    function recompute() {
      rafHandle = undefined;
      const anchor = document.querySelector<HTMLElement>(anchorSelector!);
      if (!anchor) {
        // Row left the DOM (filter changed, list re-rendered).
        // Tear down so the preview doesn't float in dead space.
        setVisible(false);
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const targetTop = rect.top + rect.height / 2 - 60;
      const PREVIEW_WIDTH = 260;
      const GAP = 8;
      let left: number;
      let placement: "right" | "left";
      if (rect.right + GAP + PREVIEW_WIDTH + 8 <= vw) {
        left = rect.right + GAP;
        placement = "right";
      } else if (rect.left - GAP - PREVIEW_WIDTH - 8 >= 0) {
        left = rect.left - GAP - PREVIEW_WIDTH;
        placement = "left";
      } else {
        const spaceRight = vw - rect.right - GAP;
        const spaceLeft = rect.left - GAP;
        if (spaceRight >= spaceLeft) {
          left = Math.max(8, rect.right + GAP);
          placement = "right";
        } else {
          left = Math.max(8, rect.left - GAP - PREVIEW_WIDTH);
          placement = "left";
        }
      }
      const estimatedHeight = 180;
      const top = Math.min(
        Math.max(8, targetTop),
        Math.max(8, window.innerHeight - estimatedHeight - 8)
      );
      setPos({ top, left, placement });
    }

    function scheduleRecompute() {
      if (rafHandle != null) return;
      rafHandle = requestAnimationFrame(recompute);
    }

    scheduleRecompute();
    window.addEventListener("resize", scheduleRecompute);
    window.addEventListener("scroll", scheduleRecompute, true);
    // Listen on the sidebar's scroll container so scrolling rows
    // re-pin the preview. `closest('.sidebar-list')` is a stable
    // selector and is what the live `.sidebar-list` scrolls on.
    const list = document.querySelector(".sidebar-list") as HTMLElement | null;
    list?.addEventListener("scroll", scheduleRecompute);

    return () => {
      window.removeEventListener("resize", scheduleRecompute);
      window.removeEventListener("scroll", scheduleRecompute, true);
      list?.removeEventListener("scroll", scheduleRecompute);
      if (rafHandle != null) cancelAnimationFrame(rafHandle);
    };
  }, [visible, anchorSelector, game?.id]);

  // Escape dismisses.
  useEffect(() => {
    if (!visible) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setVisible(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible]);

  if (!visible || !pos || !game) return null;

  const rating =
    typeof game.igdbRating === "number"
      ? Math.round(game.igdbRating)
      : typeof game.criticRating === "number"
        ? Math.round(game.criticRating)
        : null;
  const year = parseYear(game.releaseDate);
  const status = PLAY_STATUS_DETAILS[game.playStatus || "backlog"];
  const lastPlayed = formatRelative(game.lastPlayed);
  const developer = game.developer || "—";
  const anchorKey = cssEscape(game.id);

  return createPortal(
    <div
      ref={previewRef}
      className={`sidebar-hover-preview sidebar-hover-preview--${pos.placement}`}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        zIndex: 9100, // Above sidebar (z=200) and the filter popover (9000)
      }}
      role="tooltip"
      aria-hidden="true"
      data-preview-anchor-id={anchorKey}
    >
      <div className="sidebar-hover-preview__cover">
        {game.coverArtUrl ? (
          <img src={game.coverArtUrl} alt={game.name} draggable={false} />
        ) : (
          <div className="sidebar-hover-preview__cover-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
            </svg>
          </div>
        )}
        <div
          className="sidebar-hover-preview__status-pill"
          style={{
            borderColor: status.color,
            color: status.color,
            background: "rgba(0, 0, 0, 0.6)",
          }}
        >
          {status.label}
        </div>
      </div>

      <div className="sidebar-hover-preview__body">
        <div className="sidebar-hover-preview__name" title={game.name}>
          {game.name}
        </div>
        <div className="sidebar-hover-preview__developer">{developer}</div>

        <div className="sidebar-hover-preview__meta-grid">
          <div className="sidebar-hover-preview__meta">
            <span className="sidebar-hover-preview__meta-label">Year</span>
            <span className="sidebar-hover-preview__meta-value">
              {year ?? "—"}
            </span>
          </div>
          <div className="sidebar-hover-preview__meta">
            <span className="sidebar-hover-preview__meta-label">Rating</span>
            <span className="sidebar-hover-preview__meta-value">
              {rating != null ? `${rating}` : "—"}
            </span>
          </div>
          <div className="sidebar-hover-preview__meta">
            <span className="sidebar-hover-preview__meta-label">Played</span>
            <span className="sidebar-hover-preview__meta-value">
              {game.playTime || "0h"}
            </span>
          </div>
          <div className="sidebar-hover-preview__meta">
            <span className="sidebar-hover-preview__meta-label">Last</span>
            <span className="sidebar-hover-preview__meta-value">{lastPlayed}</span>
          </div>
        </div>

        <div className="sidebar-hover-preview__actions">
          <button
            type="button"
            className="sidebar-hover-preview__btn"
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              navigate(`/library/${game.id}`);
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
            Open
          </button>
          <button
            type="button"
            className="sidebar-hover-preview__btn sidebar-hover-preview__btn--ghost"
            onMouseDown={async (e) => {
              e.stopPropagation();
              e.preventDefault();
              // Use the standard browser clipboard API first
              // (works in Tauri WebView without an extra plugin).
              // Fall back to Tauri's clipboard plugin if it
              // happens to be registered (`tauri-plugin-clipboard-manager`
              // exposes `invoke('plugin:clipboard-manager|write_text', …)`).
              const text = game.path || game.name;
              let copied = false;
              try {
                if (typeof navigator !== "undefined" && navigator.clipboard) {
                  await navigator.clipboard.writeText(text);
                  copied = true;
                }
              } catch {
                /* permission denied in some sandboxed contexts */
              }
              if (!copied) {
                try {
                  await invoke("plugin:clipboard-manager|write_text", { label: null, text });
                  copied = true;
                } catch {
                  /* leave clipboard alone; user can still see the path
                   * and copy it manually from the tooltip / row hover. */
                }
              }
            }}
            title={`Copy path: ${game.path || game.name}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
            </svg>
            Copy path
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * Convenience selector builder. Exported so Sidebar.tsx doesn't
 * need to remember the attribute name and avoids duplicating the
 * escape logic. Returns `null` when called with `null` so callers
 * can pass the result directly to `SidebarHoverPreview`'s
 * `anchorSelector` prop without a conditional.
 */
export function buildSidebarAnchorSelector(
  gameId: string | null | undefined
): string | null {
  if (!gameId) return null;
  return `[data-sidebar-game-id="${cssEscape(gameId)}"]`;
}
