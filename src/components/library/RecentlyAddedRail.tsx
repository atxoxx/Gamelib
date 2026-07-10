import { useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { Game } from "../../types/game";
import { useGames } from "../../context/GameContext";
import { Card } from "../ui";
import { useCollapsedState } from "../../hooks/useCollapsedState";

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

/** localStorage key for the Recently Added rail's collapsed state.
 *  Versioned suffix so a schema change can co-exist with stale reads. */
const COLLAPSED_STORAGE_KEY = "gamelib:rail:recently-added:collapsed:v1";

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

  // Collapsed-by-default: rail is hidden until the user expands it.
  // The parent (LibraryPage) gates on `games.length >= 4`, so the
  // rail is guaranteed to have content whenever it's rendered —
  // `hasContent` is therefore a constant `true`, but we pass the
  // live `recent.length > 0` so the rail auto-expands if the gate
  // is ever relaxed in the future (defensive, costs nothing).
  const [collapsed, toggleCollapsed] = useCollapsedState(
    COLLAPSED_STORAGE_KEY,
    recent.length > 0,
    true
  );

  function handleClick(game: Game) {
    if (onCardClick) {
      onCardClick(game);
      return;
    }
    setSelectedGameId(game.id);
    navigate(`/library/${game.id}`);
  }

  const viewportId = "library-rail-recently-added-viewport";

  return (
    <section
      className={`library-rail${collapsed ? " library-rail--collapsed" : ""}`}
      aria-label="Recently added games"
    >
      <div className="library-rail-header">
        <div className="library-rail-title-row">
          <div
            className="library-rail-icon library-rail-icon--recent"
            aria-hidden
          >
            {/* Plus icon — signals "newly added to your library".
             * Matches the tinted-pill pattern used by the hero stat
             * cards and the Continue Playing rail icon so the section
             * hierarchy reads as one system. */}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </div>
          <h3 className="library-rail-title">Recently Added</h3>
          <button
            type="button"
            className="library-rail-toggle"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-controls={viewportId}
            aria-label={
              collapsed
                ? "Expand Recently Added rail"
                : "Collapse Recently Added rail"
            }
            title={collapsed ? "Expand" : "Collapse"}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
        <p className="library-rail-subtitle">
          {recent.length === 0
            ? "Latest additions"
            : `Latest additions · ${recent.length} newest game${
                recent.length === 1 ? "" : "s"
              }`}
        </p>
      </div>

      <div
        id={viewportId}
        className={`library-rail-viewport-wrapper${collapsed ? " library-rail-viewport-wrapper--collapsed" : ""}`}
      >
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
      </div>
    </section>
  );
}

/** Persistence + collapse logic now lives in `useCollapsedState`
 *  (`src/hooks/useCollapsedState.ts`) so both rails can't drift
 *  their storage conventions out of sync. */
