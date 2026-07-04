import { useProgressiveImage } from "../../hooks/useProgressiveImages";
import type { StoreGameSummary } from "../../types/game";

interface StoreGameCardProps {
  game: StoreGameSummary;
  onClick: (game: StoreGameSummary) => void;
}

/** Rating badge colors — emerald for high, amber for mid, red for low. */
function ratingColor(score: number): string {
  if (score >= 75) return "#10b981";
  if (score >= 50) return "#f59e0b";
  return "#ef4444";
}

export default function StoreGameCard({ game, onClick }: StoreGameCardProps) {
  const [coverUrl, imgRef] = useProgressiveImage(game.coverUrl);

  return (
    <div className="store-game-card" onClick={() => onClick(game)}>
      <div className="store-card-cover">
        {coverUrl ? (
          <img ref={imgRef} src={coverUrl} alt={game.name} loading="lazy" />
        ) : (
          <div className="store-card-cover-skeleton">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              opacity={0.3}
            >
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
        )}

        {game.rating != null && (
          <span
            className="store-card-rating"
            style={{ background: ratingColor(game.rating) }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              width="10"
              height="10"
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            {Math.round(game.rating)}
          </span>
        )}
      </div>

      <div className="store-card-body">
        <h3 className="store-card-name" title={game.name}>
          {game.name}
        </h3>

        {game.genres.length > 0 && (
          <div className="store-card-genres">
            {game.genres.slice(0, 2).map((g) => (
              <span key={g} className="store-card-genre">
                {g}
              </span>
            ))}
          </div>
        )}

        <div className="store-card-platforms">
          {game.platforms.length > 0
            ? game.platforms.slice(0, 3).join(" · ")
            : game.firstReleaseDate
              ? new Date(game.firstReleaseDate).getFullYear()
              : ""}
        </div>
      </div>
    </div>
  );
}
