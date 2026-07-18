import { memo, useEffect, useRef } from "react";
import { Card, Badge } from "../ui";
import type { Game } from "../../types/game";
import { PLAY_STATUS_DETAILS } from "../../types/game";
import { useGames, NO_IGDB_MATCH_SOURCE } from "../../context/GameContext";

interface LibraryGameCardProps {
  game: Game;
  density: string;
  isRunning: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onLaunch?: (game: Game) => void;
  className?: string;
}

/**
 * Library game card. The cover carries a top-row badge cluster (running /
 * playtime / install status) and a hover-only quick-play FAB; the body
 * holds the title, platform, developer, genres and notes. Memoized so a
 * parent re-render never re-renders an unchanged card.
 */
function LibraryGameCardBase({
  game,
  density,
  isRunning,
  onClick,
  onContextMenu,
  onLaunch,
  className,
}: LibraryGameCardProps) {
  const { updateGame, enrichGameMetadata, launchGame } = useGames();
  const coverRef = useRef<HTMLDivElement | null>(null);

  const canAutoFetchCover =
    !game.coverArtUrl &&
    game.metadataSource !== NO_IGDB_MATCH_SOURCE &&
    !!game.name;

  useEffect(() => {
    if (!canAutoFetchCover || !coverRef.current) return;
    const node = coverRef.current;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        enrichGameMetadata(game.id, game.name, game.steamAppId).catch((err) =>
          console.warn(`Auto-cover fetch failed for ${game.name}:`, err)
        );
      },
      { rootMargin: "300px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [canAutoFetchCover, game.id, game.name, game.steamAppId, enrichGameMetadata]);

  const handleLaunch = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onLaunch) onLaunch(game);
    else launchGame(game);
  };

  const rating = game.igdbRating ?? game.criticRating;

  return (
    <Card
      variant="surface"
      elevation="1"
      hoverLift
      className={`lib-card density-${density}${isRunning ? " running" : ""}${className ? ` ${className}` : ""}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <div className="lib-card-cover" ref={coverRef}>
        {game.coverArtUrl ? (
          <img
            src={game.coverArtUrl}
            alt={game.name}
            loading="lazy"
            decoding="async"
            onError={(e) => {
              const img = e.currentTarget;
              const appId = game.steamAppId;
              if (appId) {
                if (img.src.includes("library_600x900_2x")) {
                  img.src = `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`;
                  return;
                }
                if (img.src.includes("library_600x900")) {
                  img.src = `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`;
                  return;
                }
              }
              console.warn(`Cover image failed for ${game.name}, falling back to placeholder`);
              updateGame(game.id, { coverArtUrl: undefined });
            }}
          />
        ) : (
          <div className="lib-card-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
        )}

        <div className="lib-card-badges">
          {isRunning && (
            <Badge variant="success" size="sm" dot className="lib-card-badge lib-card-badge--running">
              Running
            </Badge>
          )}
          <Badge variant="default" size="sm" className="lib-card-badge lib-card-badge--playtime">
            {game.playTime}
          </Badge>
        </div>

        <button
          type="button"
          className="lib-card-fab"
          onClick={handleLaunch}
          aria-label={isRunning ? `Resume ${game.name}` : `Play ${game.name}`}
          title={isRunning ? "Resume" : "Play"}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        </button>
      </div>

      <div className="lib-card-body">
        <h3 className="lib-card-name" title={game.name}>
          {game.name}
        </h3>
        <div className="lib-card-meta">
          <Badge variant="info" size="sm" className="lib-card-platform platform-${platform}">
            {game.platform}
          </Badge>
          <Badge
            variant={PLAY_STATUS_DETAILS[game.playStatus || "backlog"].variant}
            size="sm"
            dot
            className="lib-card-status-badge status-${game.playStatus || 'backlog'}"
          >
            {PLAY_STATUS_DETAILS[game.playStatus || "backlog"].label}
          </Badge>
          {rating != null && rating > 0 && (
            <Badge
              variant="accent"
              size="sm"
              className="lib-card-rating"
              title={`${game.igdbRating != null ? "IGDB" : "Critic"} Rating: ${Math.round(rating)}%`}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10" style={{ marginRight: 3 }} aria-hidden>
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              {Math.round(rating)}%
            </Badge>
          )}
        </div>
        {game.developer && (
          <p className="lib-card-developer" title={game.developer}>
            {game.developer}
          </p>
        )}
        {game.genres && game.genres.length > 0 && (
          <div className="lib-card-genres">
            {game.genres.slice(0, 3).map((g) => (
              <span key={g} className="lib-card-genre">
                {g}
              </span>
            ))}
          </div>
        )}
        {game.notes ? (
          <p className="lib-card-notes">{game.notes}</p>
        ) : game.description ? (
          <p className="lib-card-notes">{game.description.slice(0, 80)}{game.description.length > 80 ? "..." : ""}</p>
        ) : (
          <p className="lib-card-notes is-empty">No notes</p>
        )}
      </div>
    </Card>
  );
}

const LibraryGameCard = memo(LibraryGameCardBase, (prev, next) => {
  return (
    prev.game === next.game &&
    prev.density === next.density &&
    prev.isRunning === next.isRunning &&
    prev.onClick === next.onClick &&
    prev.onContextMenu === next.onContextMenu &&
    prev.onLaunch === next.onLaunch &&
    prev.className === next.className
  );
});

export default LibraryGameCard;
