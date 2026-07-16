// BigScreenRail — horizontal scrollable rail of BigScreenGameCard
// tiles for the new Big Screen library. Each card registers its
// focus with the parent via the `onFocusedChange` callback so a
// sibling Spotlight component can mirror the focused game's
// overview/Play button — the same pattern Steam Big Picture and
// PS5 use for their "focused game's detail updates on entry".
//
// Why a dedicated rail (vs. reusing BigScreenGameCard in a div)
// ──────────────────────────────────────────────────────────────
// BigScreenGameCard carries its own `data-focused` focus state via
// the GamepadProvider. BigScreenRail takes advantage of that to
// surface focus changes: when a card gains focus (D-pad Left/Right
// lands here, an LB/RB tab-cycler was the indirect cause, or a
// pointer hover) we bubble the game up so the parent can update a
// shared "spotlight" panel without us having to duplicate state.

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
   * Invoked whenever the focused card CHANGES (not on every focus
   * tick — only on rising-edge changes, so a re-render of the
   * focused element for styling reasons doesn't trigger an
   * unnecessary parent re-render). The parent typically uses this
   * to update a Spotlight's "currently featured" game.
   */
  onFocusedGameChange: (game: Game | null) => void;
}

export default function BigScreenRail({
  title,
  icon,
  games,
  emptyLabel = "No games to show yet",
  onCardClick,
  onFocusedGameChange,
}: BigScreenRailProps) {
  const gamepad = useGamepad();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Last-published focused game id so we can dedupe and only emit on
  // rising-edge changes (prevents the parent Spotlight from
  // re-rendering every time the focus ring's internal state ticks).
  const lastFocusedIdRef = useRef<string | null>(null);

  // ── Watch the focused element; surface changes ───────────────
  // The GamepadProvider exposes `focusedElement` as a React state
  // value updated on focus changes. We poll a derived "is one of
  // OUR cards focused?" predicate via a small effect that listens
  // for that state move and looks up the owning game by a
  // `data-game-id` attribute we set on each card below.
  useEffect(() => {
    const el = gamepad.focusedElement;
    if (!el || !scrollRef.current || !scrollRef.current.contains(el)) return;
    const id = el.getAttribute("data-game-id");
    const game = id ? games.find((g) => g.id === id) ?? null : null;
    if (id !== lastFocusedIdRef.current) {
      lastFocusedIdRef.current = id;
      onFocusedGameChange(game);
    } else {
      // Publish the fresh game reference on sibling list updates
      onFocusedGameChange(game);
    }
  }, [gamepad.focusedElement, games, onFocusedGameChange]);

  // Auto-scroll the rail when the focus ring's owner scrolls into
  // view would normally happen via the GamepadProvider's
  // `scrollIntoView` (see useGamepad.ts). We add ONE extra bit of
  // behavior here: after a focus change inside the rail, nudge the
  // scroll position so the focused card lands at ~25% from the left
  // edge (instead of the provider's default "nearest-edge" snap,
  // which on a horizontal rail keeps the card pinned to the left
  // until it goes off-screen and snaps to the right).
  //
  // Math note: we deliberately use `getBoundingClientRect` rather
  // than `el.offsetLeft` — the latter is measured against the
  // nearest positioned ancestor (`offsetParent`), which is NOT
  // necessarily our scroll container. `getBoundingClientRect` is
  // viewport-relative, so subtracting the rail's viewport-relative
  // rect and adding its current `scrollLeft` gives the card's true
  // offset inside the scroll container, regardless of how the DOM
  // is nested (see the focus-watcher in BigScreenLibrary which
  // works against the same assumption).
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
