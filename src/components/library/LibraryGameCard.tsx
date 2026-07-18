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
  className?: string;
}

/**
 * Library game card with two auto-fetch paths for missing / broken covers.
 * Memoized so a parent re-render (e.g. hovering a sibling, opening a context
 * menu, or changing the filtered list reference) never re-renders an
 * unchanged card.
 */
function LibraryGameCardBase({
  game,
  density,
  isRunning,
  onClick,
  onContextMenu,
  className,
}: LibraryGameCardProps) {
  const { updateGame, enrichGameMetadata } = useGames();
  const coverRef = useRef<HTMLDivElement | null>(null);

  const installed = game.installed;
  const platform = game.platform.toLowerCase();

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

  return (
    <Card
      variant="surface"
      elevation="1"
      hoverLift
      className={`library-card density-${density}${isRunning ? " running" : ""}${className ? ` ${className}` : ""}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <div className="library-card-cover" ref={coverRef}>
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
          <div className="library-card-cover-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
        )}
        {isRunning && (
          <Badge variant="success" size="sm" dot className="library-card-running-badge">
            Running
          </Badge>
        )}
        <Badge variant="accent" size="sm" className="library-card-playtime-badge">
          {game.playTime}
        </Badge>
        <Badge
          variant={installed ? "success" : "default"}
          size="sm"
          dot
          className={`library-card-status-badge ${installed ? "installed" : "not-installed"}`}
        >
          {installed ? "Ready" : "Not Installed"}
        </Badge>
      </div>
      <div className="library-card-body">
        <h3 className="library-card-name" title={game.name}>
          {game.name}
        </h3>
        <div className="library-card-meta-row">
          <Badge variant="info" size="sm" className={`library-card-platform platform-${platform}`}>
            {game.platform}
          </Badge>
          <Badge
            variant={PLAY_STATUS_DETAILS[game.playStatus || "backlog"].variant}
            size="sm"
            dot
            className={`library-card-play-status status-${game.playStatus || "backlog"}`}
          >
            {PLAY_STATUS_DETAILS[game.playStatus || "backlog"].label}
          </Badge>
          {(() => {
            const rating = game.igdbRating ?? game.criticRating;
            if (rating == null || rating <= 0) return null;
            return (
              <Badge
                variant="accent"
                size="sm"
                className="library-card-rating"
                title={`${game.igdbRating != null ? "IGDB" : "Critic"} Rating: ${Math.round(rating)}%`}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  width="10"
                  height="10"
                  style={{ marginRight: 3 }}
                >
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                {Math.round(rating)}%
              </Badge>
            );
          })()}
        </div>
        {game.developer && (
          <p className="library-card-developer" title={game.developer}>
            {game.developer}
          </p>
        )}
        {game.genres && game.genres.length > 0 && (
          <div className="library-card-genres">
            {game.genres.slice(0, 3).map((g) => (
              <Badge key={g} variant="default" size="sm" className="library-card-genre-tag">
                {g}
              </Badge>
            ))}
          </div>
        )}
        {game.notes ? (
          <p className="library-card-notes">{game.notes}</p>
        ) : game.description ? (
          <p className="library-card-notes">
            {game.description.slice(0, 80)}
            {game.description.length > 80 ? "..." : ""}
          </p>
        ) : (
          <p className="library-card-notes library-card-notes-empty">No notes</p>
        )}
      </div>
    </Card>
  );
}

// Memoized so cards only re-render when their own props change. The
// `isRunning` flag still flips correctly because it's passed per-card.
const LibraryGameCard = memo(LibraryGameCardBase, (prev, next) => {
  return (
    prev.game === next.game &&
    prev.density === next.density &&
    prev.isRunning === next.isRunning &&
    prev.onClick === next.onClick &&
    prev.onContextMenu === next.onContextMenu &&
    prev.className === next.className
  );
});

export default LibraryGameCard;
