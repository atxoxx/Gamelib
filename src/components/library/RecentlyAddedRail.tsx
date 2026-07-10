import { useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { Game } from "../../types/game";
import { useGames } from "../../context/GameContext";
import { Card } from "../ui";

interface RecentlyAddedRailProps {
  games: Game[];
  /** Max number of cards to show in the rail. Defaults to 12. */
  maxItems?: number;
  /**
   * Optional click handler. When supplied, clicking a card invokes
   * this callback instead of the default "navigate to game page"
   * behavior. The LibraryPage uses the default (navigate) so a card
   * click opens the game detail page.
   */
  onCardClick?: (game: Game) => void;
}

/**
 * "Recently Added" horizontal rail: the N most recently imported games,
 * shown as compact cards the user can scroll through without leaving
 * the page. Sits between the hero and the main grid in the Library
 * page, giving new additions immediate visual real estate.
 *
 * Behavior:
 *  - The parent (LibraryPage) gates on `games.length >= 4` so the
 *    rail doesn't render at all for very small libraries.
 *  - Sorted by `addedAt` desc. Games without an `addedAt` fall to the
 *    end of the rail rather than disappearing — their cards still have
 *    a name and a cover that the user might want to surface.
 *  - Scroll-snap + native horizontal scrolling. No JS scroll listener.
 *  - Edge fade masks hint at overflow that exists beyond the viewport.
 */
export default function RecentlyAddedRail({
  games,
  maxItems = 12,
  onCardClick,
}: RecentlyAddedRailProps) {
  const navigate = useNavigate();
  const { setSelectedGameId } = useGames();
  const railRef = useRef<HTMLDivElement | null>(null);

  const recent = useMemo(() => {
    return [...games]
      .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
      .slice(0, maxItems);
  }, [games, maxItems]);

  function handleClick(game: Game) {
    if (onCardClick) {
      onCardClick(game);
      return;
    }
    setSelectedGameId(game.id);
    navigate(`/library/${game.id}`);
  }

  return (
    <section className="library-rail" aria-label="Recently added games">
      <div className="library-rail-header">
        <div className="library-rail-header-text">
          <h3 className="library-rail-title">Recently Added</h3>
          <p className="library-rail-subtitle">
            Your {recent.length} newest game{recent.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="library-rail-hint" aria-hidden>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          Scroll
        </div>
      </div>

      <div className="library-rail-viewport">
        <div className="library-rail-track" ref={railRef}>
          {recent.map((game, i) => (
            <div
              key={game.id}
              className={`library-rail-item animate-fade-in stagger-${Math.min(i + 1, 8)}`}
            >
              <Card
                variant="surface"
                elevation="1"
                hoverLift
                className="library-rail-card"
                onClick={() => handleClick(game)}
              >
                <div className="library-rail-card-cover">
                  {game.coverArtUrl ? (
                    <img src={game.coverArtUrl} alt={game.name} />
                  ) : (
                    <div className="library-rail-card-cover-placeholder">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1"
                        aria-hidden
                      >
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                      </svg>
                    </div>
                  )}
                  <span className="library-rail-card-platform">
                    {game.platform}
                  </span>
                </div>
                <div className="library-rail-card-body">
                  <div className="library-rail-card-name" title={game.name}>
                    {game.name}
                  </div>
                  <div className="library-rail-card-meta">
                    {game.playTime}
                  </div>
                </div>
              </Card>
            </div>
          ))}
        </div>
        <div
          className="library-rail-fade library-rail-fade--left"
          aria-hidden
        />
        <div
          className="library-rail-fade library-rail-fade--right"
          aria-hidden
        />
      </div>
    </section>
  );
}
