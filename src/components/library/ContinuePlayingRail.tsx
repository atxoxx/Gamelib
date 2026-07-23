import { useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { Game } from "../../types/game";
import { useGames } from "../../context/GameContext";
import { Card } from "../ui";
import { useCollapsedState } from "../../hooks/useCollapsedState";
import PlayerCountBadge from "../PlayerCountBadge";
import { useSteamAppId } from "../../hooks/useSteamAppId";

interface ContinuePlayingRailProps {
  games: Game[];
  maxItems?: number;
  windowDays?: number;
  onCardClick?: (game: Game) => void;
}

const COLLAPSED_STORAGE_KEY = "gamelib:rail:continue-playing:collapsed:v1";

/**
 * "Continue Playing" rail: surfaces games played in the last N days, sorted
 * by most-recently-played first. Always rendered when the Library isn't
 * empty (shows a friendly empty state when nothing qualifies).
 */
export default function ContinuePlayingRail({
  games,
  maxItems = 12,
  windowDays = 14,
  onCardClick,
}: ContinuePlayingRailProps) {
  const navigate = useNavigate();
  const { setSelectedGameId } = useGames();
  const railRef = useRef<HTMLDivElement | null>(null);

  const recent = useMemo(() => {
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    return [...games]
      .filter((g) => (g.lastPlayed ?? 0) >= cutoff)
      .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
      .slice(0, maxItems);
  }, [games, maxItems, windowDays]);

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

  const viewportId = "lib-rail-continue-viewport";

  return (
    <section
      className={`lib-rail lib-rail--continue${collapsed ? " lib-rail--collapsed" : ""}`}
      aria-label="Continue playing — recently played games"
    >
      <div className="lib-rail-header">
        <div className="lib-rail-title-row">
          <div className="lib-rail-icon lib-rail-icon--continue" aria-hidden>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6 4 20 12 6 20 6 4" />
            </svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <h3 className="lib-rail-title">Continue Playing</h3>
            <p className="lib-rail-subtitle">Pick up where you left off</p>
          </div>
        </div>
        <button
          type="button"
          className="lib-rail-toggle"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-controls={viewportId}
          aria-label={collapsed ? "Expand Continue Playing rail" : "Collapse Continue Playing rail"}
          title={collapsed ? "Expand" : "Collapse"}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      <div id={viewportId} className={`lib-rail-body${collapsed ? " lib-rail-body--collapsed" : ""}`}>
        <div className="lib-rail-viewport">
          {recent.length === 0 ? (
            <div className="lib-rail-empty">
              <div className="lib-rail-empty-icon" aria-hidden>
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <polygon points="6 4 20 12 6 20 6 4" />
                </svg>
              </div>
              <span>
                Play a game to start tracking your sessions — finished sessions will show up here.
              </span>
            </div>
          ) : (
            <>
              <div className="lib-rail-track" ref={railRef}>
                {recent.map((game, i) => (
                  <div key={game.id} className={`lib-rail-item animate-fade-in stagger-${Math.min(i + 1, 8)}`}>
                    <ContinuePlayingCard game={game} onClick={handleClick} />
                  </div>
                ))}
              </div>
              <div className="lib-rail-fade lib-rail-fade--left" aria-hidden />
              <div className="lib-rail-fade lib-rail-fade--right" aria-hidden />
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function ContinuePlayingCard({
  game,
  onClick,
}: {
  game: Game;
  onClick: (game: Game) => void;
}) {
  const { appId: resolvedSteamAppId } = useSteamAppId(game);
  const steamAppId =
    typeof resolvedSteamAppId === "number" ? resolvedSteamAppId : game.steamAppId ?? null;

  return (
    <Card variant="surface" elevation="1" hoverLift className="lib-rail-card" onClick={() => onClick(game)}>
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
        {steamAppId != null && (
          <div className="lib-rail-player-chip">
            <PlayerCountBadge appId={steamAppId} className="lib-rail-player-chip-badge" />
          </div>
        )}
      </div>
      <div className="lib-rail-body">
        <div className="lib-rail-name" title={game.name}>{game.name}</div>
        <div className="lib-rail-meta lib-rail-meta--continue" title={`Last played ${new Date(game.lastPlayed ?? 0).toLocaleString()}`}>
          {formatAgo(game.lastPlayed ?? 0)}
        </div>
      </div>
    </Card>
  );
}

function formatAgo(timestamp: number): string {
  if (!timestamp) return "never";
  const diffMs = Date.now() - timestamp;
  if (diffMs < 0) return "just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return "<1h ago";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}
