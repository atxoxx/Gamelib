// BigScreenGameCard — oversized game card for Big Screen Mode.
// Mirrors the desktop library-card design but scaled up for TV
// viewing distance, with controller focus support via the shared
// GamepadProvider context.
//
// Focus state: card lifts with translateY(-8px), gets a glowing
// accent border. The A button triggers `onClick` (which should
// navigate to the game detail page).

import { useCallback, useRef } from "react";
import { type Game } from "../../types/game";
import { useGamepadCtx } from "../../hooks/GamepadProvider";
import { useGames } from "../../context/GameContext";

interface BigScreenGameCardProps {
  game: Game;
  onClick: () => void;
  /**
   * Optional stable id burned onto the root element as a
   * `data-game-id="…"` attribute. Used by sibling components
   * (BigScreenRail's focus watcher in particular) to map the global
   * `gamepad.focusedElement` back to its owning game without having
   * to register a separate listener per card. Defaults to
   * `game.id` so existing callers keep working without changes.
   */
  "data-game-id"?: string;
}

export default function BigScreenGameCard({ game, onClick }: BigScreenGameCardProps) {
  const gamepad = useGamepadCtx();
  const { runningGameIds } = useGames();
  const isRunning = runningGameIds.includes(game.id);
  const cleanupRef = useRef<(() => void) | null>(null);

  const focusableRef = useCallback(
    (el: HTMLElement | null) => {
      // Clean up previous registration
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      if (el) {
        cleanupRef.current = gamepad.registerAction(el, onClick);
      }
    },
    [gamepad, onClick],
  );

  return (
    <div
      className={`bigscreen-game-card${isRunning ? " running" : ""}`}
      ref={focusableRef}
      tabIndex={0}
      role="option"
      onClick={onClick}
      data-game-id={game.id}
    >
      <div className="bigscreen-game-card-cover">
        {game.coverArtUrl ? (
          <img src={game.coverArtUrl} alt={game.name} loading="lazy" />
        ) : game.iconUrl ? (
          <img src={game.iconUrl} alt={game.name} loading="lazy" />
        ) : (
          <div className="bigscreen-game-card-cover-placeholder">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              opacity={0.3}
            >
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
        )}
        {isRunning && (
          <span className="bigscreen-game-card-running-dot" title="Running" />
        )}
      </div>
      <div className="bigscreen-game-card-body">
        <h3 className="bigscreen-game-card-name">{game.name}</h3>
        <div className="bigscreen-game-card-meta">
          <span className="bigscreen-game-card-platform">{game.platform}</span>
          {game.playTime && (
            <span className="bigscreen-game-card-playtime">{game.playTime}</span>
          )}
        </div>
      </div>
    </div>
  );
}
