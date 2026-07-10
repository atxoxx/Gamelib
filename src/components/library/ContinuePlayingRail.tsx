import { useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { Game } from "../../types/game";
import { useGames } from "../../context/GameContext";
import { Card } from "../ui";

interface ContinuePlayingRailProps {
  games: Game[];
  /** Maximum number of cards to render. Defaults to 12. */
  maxItems?: number;
  /** Window in days — a game counts as "continue-worthy" if its
   *  `lastPlayed` falls within the last N days. Defaults to 14. */
  windowDays?: number;
  /**
   * Optional click handler. When supplied, clicking a card invokes
   * this callback instead of the default "navigate to game page"
   * behavior. The LibraryPage uses the default.
   */
  onCardClick?: (game: Game) => void;
}

/**
 * "Continue Playing" rail: surfaces games the user has played in the
 * last N days, sorted by most-recently-played first.
 *
 * **Always renders** when the Library isn't empty — the rail shows a
 * friendly empty state instead of vanishing when no games have been
 * played yet, so the user always knows the feature exists and where
 * finished sessions will land.
 *
 * **Filtering:**
 *  - Only games with a `lastPlayed` timestamp in the window survive.
 *  - The cutoff is recomputed on every render so the rail naturally
 *    drops off old games as the user plays new ones — no separate
 *    cleanup pass needed.
 *  - Sorted desc by `lastPlayed` so the most recently active title
 *    sits on the left (matches the user's mental model: "what did
 *    I just play?").
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

  function handleClick(game: Game) {
    if (onCardClick) {
      onCardClick(game);
      return;
    }
    setSelectedGameId(game.id);
    navigate(`/library/${game.id}`);
  }

  return (
    <section
      className="library-rail library-rail--continue"
      aria-label="Continue playing — recently played games"
    >
      <div className="library-rail-header">
        <div className="library-rail-header-text">
          <h3 className="library-rail-title">Continue Playing</h3>
          <p className="library-rail-subtitle">
            Your last {windowDays} days of gaming — pick up where you left off
          </p>
        </div>
        {recent.length > 0 && (
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
        )}
      </div>

      <div className="library-rail-viewport">
        {recent.length === 0 ? (
          /* Empty state — the rail stays visible so the user knows
           * the feature exists and where to look once they've played
           * a game. Dashed border + tertiary bg differentiates it
           * from the regular card track so it doesn't read as a
           * broken card. */
          <div className="library-rail-empty">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            <span>
              Play a game to start tracking your sessions — finished
              sessions will show up here.
            </span>
          </div>
        ) : (
          <>
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
                      <div
                        className="library-rail-card-meta library-rail-card-meta--continue"
                        title={`Last played ${new Date(game.lastPlayed ?? 0).toLocaleString()}`}
                      >
                        {formatAgo(game.lastPlayed ?? 0)}
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
          </>
        )}
      </div>
    </section>
  );
}

/**
 * Compact "time since" formatter. Matches the look of the existing
 * "1h 30m" playtime strings so the card meta line stays uniform
 * across both rails:
 *
 *  - `< 1h` ago → `"<1h ago"`  (sub-hour precision is noise here)
 *  - `< 24h` ago → `"Xh ago"`
 *  - `< 7d` ago → `"Xd ago"`
 *  - otherwise → `"Xw ago"`
 *
 * `0` (never played — shouldn't appear because the rail filters on
 * the cutoff, but defensive) renders as `"never"` to surface a
 * obviously-bad state instead of "0s ago".
 */
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
