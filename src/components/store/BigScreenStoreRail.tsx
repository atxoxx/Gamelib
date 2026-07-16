import { useEffect, useRef, type ReactNode } from "react";
import { useGamepad } from "../../hooks/GamepadProvider";
import BigScreenStoreGameCard from "./BigScreenStoreGameCard";
import type { StoreGameSummary } from "../../types/game";

interface BigScreenStoreRailProps {
  title: string;
  icon?: ReactNode;
  games: StoreGameSummary[];
  emptyLabel?: string;
  onCardClick: (game: StoreGameSummary) => void;
  onFocusedGameChange: (game: StoreGameSummary | null) => void;
}

export default function BigScreenStoreRail({
  title,
  icon,
  games,
  emptyLabel = "No games to show yet",
  onCardClick,
  onFocusedGameChange,
}: BigScreenStoreRailProps) {
  const gamepad = useGamepad();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastFocusedIdRef = useRef<string | null>(null);

  // Monitor gamepad focus changes to update the parent backdrop/spotlight
  useEffect(() => {
    const el = gamepad.focusedElement;
    if (!el || !scrollRef.current || !scrollRef.current.contains(el)) return;
    const id = el.getAttribute("data-game-id");
    const game = id ? games.find((g) => String(g.id) === id) ?? null : null;
    if (id !== lastFocusedIdRef.current) {
      lastFocusedIdRef.current = id;
      onFocusedGameChange(game);
    } else {
      // Publish the fresh game reference on sibling list updates
      onFocusedGameChange(game);
    }
  }, [gamepad.focusedElement, games, onFocusedGameChange]);

  // Center active element in the viewport rail
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
    <section className="bigscreen-rail" aria-label={title}>
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
            <div ref={scrollRef} className="bigscreen-rail-track" role="list">
              {games.map((game) => (
                <div key={game.id} role="listitem" className="bigscreen-rail-item">
                  <BigScreenStoreGameCard
                    game={game}
                    onClick={onCardClick}
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
