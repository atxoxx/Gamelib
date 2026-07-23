import { useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { Game } from "../../types/game";
import { useGames } from "../../context/GameContext";
import { Card } from "../ui";
import { useCollapsedState } from "../../hooks/useCollapsedState";

interface RecentlyAddedRailProps {
  games: Game[];
  maxItems?: number;
  onCardClick?: (game: Game) => void;
}

const COLLAPSED_STORAGE_KEY = "gamelib:rail:recently-added:collapsed:v1";

/**
 * "Recently Added" horizontal rail: the N most recently imported games as
 * compact cover-forward cards. Gated by the parent on `games.length >= 4`.
 */
export default function RecentlyAddedRail({
  games,
  maxItems = 12,
  onCardClick,
}: RecentlyAddedRailProps) {
  const navigate = useNavigate();
  const { setSelectedGameId } = useGames();
  const railRef = useRef<HTMLDivElement | null>(null);

  const recent = useMemo(
    () => [...games].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0)).slice(0, maxItems),
    [games, maxItems]
  );

  const [collapsed, toggleCollapsed] = useCollapsedState(
    COLLAPSED_STORAGE_KEY,
    recent.length > 0,
    true
  );

  function handleClick(game: Game) {
    if (onCardClick) return onCardClick(game);
    setSelectedGameId(game.id);
    navigate(`/library/${game.id}`);
  }

  const viewportId = "lib-rail-recently-added-viewport";

  return (
    <section className={`lib-rail${collapsed ? " lib-rail--collapsed" : ""}`} aria-label="Recently added games">
      <div className="lib-rail-header">
        <div className="lib-rail-title-row">
          <div className="lib-rail-icon lib-rail-icon--recent" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <h3 className="lib-rail-title">Recently Added</h3>
            <p className="lib-rail-subtitle">
              {recent.length === 0 ? "Latest additions" : `Latest additions · ${recent.length} newest game${recent.length === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="lib-rail-toggle"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-controls={viewportId}
          aria-label={collapsed ? "Expand Recently Added rail" : "Collapse Recently Added rail"}
          title={collapsed ? "Expand" : "Collapse"}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      <div id={viewportId} className={`lib-rail-body${collapsed ? " lib-rail-body--collapsed" : ""}`}>
        <div className="lib-rail-viewport">
          <div className="lib-rail-track" ref={railRef}>
            {recent.map((game, i) => (
              <div key={game.id} className={`lib-rail-item animate-fade-in stagger-${Math.min(i + 1, 8)}`}>
                <Card variant="surface" elevation="1" hoverLift className="lib-rail-card" onClick={() => handleClick(game)}>
                  <div className="lib-rail-cover">
                    {game.coverArtUrl ? (
                      <img src={game.coverArtUrl} alt={game.name} />
                    ) : (
                      <div className="lib-rail-cover-placeholder">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
                          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                        </svg>
                      </div>
                    )}
                    <span className="lib-rail-platform">{game.platform}</span>
                  </div>
                  <div className="lib-rail-card-body">
                    <div className="lib-rail-name" title={game.name}>{game.name}</div>
                    <div className="lib-rail-meta">{game.playTime}</div>
                  </div>
                </Card>
              </div>
            ))}
          </div>
          <div className="lib-rail-fade lib-rail-fade--left" aria-hidden />
          <div className="lib-rail-fade lib-rail-fade--right" aria-hidden />
        </div>
      </div>
    </section>
  );
}
