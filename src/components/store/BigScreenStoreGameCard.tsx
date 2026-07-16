import { useFocusable } from "../../hooks/useFocusable";
import type { StoreGameSummary } from "../../types/game";

interface BigScreenStoreGameCardProps {
  game: StoreGameSummary;
  onClick: (game: StoreGameSummary) => void;
}

export default function BigScreenStoreGameCard({
  game,
  onClick,
}: BigScreenStoreGameCardProps) {
  const focusable = useFocusable(() => onClick(game));

  return (
    <div
      className="bigscreen-game-card bigscreen-store-game-card"
      {...focusable}
      data-game-id={game.id}
      data-game-slug={game.slug}
    >
      <div className="bigscreen-game-card-cover">
        {game.coverUrl ? (
          <img src={game.coverUrl} alt={game.name} loading="lazy" />
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
        {game.rating != null && (
          <span className="bigscreen-store-card-rating">
            ★ {Math.round(game.rating)}
          </span>
        )}
      </div>
      <div className="bigscreen-game-card-body">
        <h3 className="bigscreen-game-card-name">{game.name}</h3>
        <div className="bigscreen-game-card-meta">
          <span className="bigscreen-game-card-platform">
            {game.platforms.slice(0, 2).join(" · ")}
          </span>
        </div>
      </div>
    </div>
  );
}
