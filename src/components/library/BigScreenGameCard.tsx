// BigScreenGameCard — oversized game card for Big Screen Mode.
// Mirrors the desktop library-card design but scaled up for TV
// viewing distance, with controller focus support via the shared
// GamepadProvider context.
//
// Focus state: card lifts with translateY(-8px), gets a glowing
// accent border. The A button triggers `onClick` (which should
// navigate to the game detail page).
//
// As of PR 1, focus registration is delegated to `useFocusable` —
// the ref callback is stable across renders, so the focus registry
// doesn't thrash on every parent render the way the previous
// `useCallback` + cleanupRef pattern did.

import { type Game } from "../../types/game";
import { useGames } from "../../context/GameContext";
import { useFocusable } from "../../hooks/useFocusable";

interface BigScreenGameCardProps {
  game: Game;
  onClick: () => void;
}

export default function BigScreenGameCard({
  game,
  onClick,
}: BigScreenGameCardProps) {
  const { runningGameIds } = useGames();
  const isRunning = runningGameIds.includes(game.id);
  // Stable focusable props; ref + cleanup are owned by useFocusable.
  const focusable = useFocusable(onClick);

  return (
    <div
      className={`bigscreen-game-card${isRunning ? " running" : ""}`}
      {...focusable}
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