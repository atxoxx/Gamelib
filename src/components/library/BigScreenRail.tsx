// BigScreenRail — horizontal scrollable rail of BigScreenGameCard
// tiles for the new Big Screen library.
//
// Spotlight tracking
// ──────────────────
// As of the "spotlight follows the current rail" pass, the spotlight
// is owned by the parent page (BigScreenLibrary / BigScreenStore),
// which subscribes directly to the GamepadProvider's
// `focusedElement` and resolves the focused card's `data-game-id`
// against a flat game lookup map. This rail no longer publishes its
// focus changes via a callback prop — the central watcher is the
// single source of truth, so the spotlight stays in lockstep with
// whichever rail the user is currently navigating in (and doesn't
// get stuck on a previously-focused card when focus hops through
// non-card focusables like the Details pane buttons or the header
// tab bar).
//
// Auto-scroll
// ───────────
// When a card inside THIS rail gains focus, the viewport nudges the
// scroll position so the focused card lands at ~25% from the left
// edge — see the math comment below.

import { useEffect, useRef, type ReactNode } from "react";
import { useGamepad } from "../../hooks/GamepadProvider";
import BigScreenGameCard from "./BigScreenGameCard";
import type { Game } from "../../types/game";

interface BigScreenRailProps {
  /** Display title for the rail (e.g. "Continue Playing"). */
  title: string;
  /** Small icon shown next to the title (PS5-style tinted pill). */
  icon?: ReactNode;
  /**
   * Ordered list of games to show in the rail. Empty arrays render
   * a friendly empty state instead of an empty strip — prevents the
   * "why is there a blank bar here" first-run confusion.
   */
  games: Game[];
  /** Custom empty-state label; defaults to "No games yet". */
  emptyLabel?: string;
  /** Invoked when the user clicks / activates a card. */
  onCardClick: (game: Game) => void;
  /**
   * Stable identifier for this rail. Rendered on the section as
   * `data-rail-id="..."`. Doesn't drive the spotlight today (the
   * parent reads `data-game-id` directly off the focused element),
   * but is useful for downstream state like a per-rail header
   * highlight and for debug inspection in the DOM.
   */
  railId?: string;
}

export default function BigScreenRail({
  title,
  icon,
  games,
  emptyLabel = "No games to show yet",
  onCardClick,
  railId,
}: BigScreenRailProps) {
  const gamepad = useGamepad();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // ── Auto-scroll a focused card into view ─────────────────────
  // We deliberately use `getBoundingClientRect` rather than
  // `el.offsetLeft` — the latter is measured against the nearest
  // positioned ancestor (`offsetParent`), which is NOT necessarily
  // our scroll container. `getBoundingClientRect` is
  // viewport-relative, so subtracting the rail's viewport-relative
  // rect and adding its current `scrollLeft` gives the card's true
  // offset inside the scroll container, regardless of how the DOM
  // is nested.
  useEffect(() => {
    const el = gamepad.focusedElement;
    if (!el || !scrollRef.current) return;
    if (!scrollRef.current.contains(el)) return;
    const cardRect = el.getBoundingClientRect();
    const containerRect = scrollRef.current.getBoundingClientRect();
    const offsetWithinContainer =
      cardRect.left - containerRect.left + scrollRef.current.scrollLeft;
    const desiredLeft = containerRect.width * 0.25;
    const delta = offsetWithinContainer - desiredLeft;
    if (Math.abs(delta) > 8) {
      scrollRef.current.scrollTo({
        left: scrollRef.current.scrollLeft + delta,
        behavior: "smooth",
      });
    }
  }, [gamepad.focusedElement]);

  return (
    <section
      className="bigscreen-rail"
      aria-label={title}
      data-rail-id={railId}
    >
      <div className="bigscreen-rail-header">
        {icon ? (
          <span className="bigscreen-rail-icon" aria-hidden>
            {icon}
          </span>
        ) : null}
        <h3 className="bigscreen-rail-title">{title}</h3>
        <span className="bigscreen-rail-count">
          {games.length > 0 ? `${games.length}` : ""}
        </span>
      </div>

      <div className="bigscreen-rail-viewport">
        {games.length === 0 ? (
          <div className="bigscreen-rail-empty" role="status">
            <span>{emptyLabel}</span>
          </div>
        ) : (
          <>
            <div
              ref={scrollRef}
              className="bigscreen-rail-track"
              role="list"
            >
              {games.map((game) => (
                <div
                  key={game.id}
                  role="listitem"
                  className="bigscreen-rail-item"
                >
                  <BigScreenGameCard
                    game={game}
                    onClick={() => onCardClick(game)}
                  />
                </div>
              ))}
            </div>
            <div
              className="bigscreen-rail-fade bigscreen-rail-fade--left"
              aria-hidden
            />
            <div
              className="bigscreen-rail-fade bigscreen-rail-fade--right"
              aria-hidden
            />
          </>
        )}
      </div>
    </section>
  );
}
