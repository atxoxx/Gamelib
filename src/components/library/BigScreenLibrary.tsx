import { useCallback, useEffect, useMemo, useState } from "react";
import type { Game } from "../../types/game";
import { useGames } from "../../context/GameContext";
import { useSteamAppId } from "../../hooks/useSteamAppId";
import { useFocusable } from "../../hooks/useFocusable";
import { PLAY_STATUS_DETAILS } from "../../types/game";
import SteamPlayerCount from "../SteamPlayerCount";
import BigScreenRail from "./BigScreenRail";
import BigScreenPill from "../bigscreen/BigScreenPill";
import { extractYear, formatLastPlayed } from "../bigscreen/bigscreenFormat";

interface BigScreenLibraryProps {
  filteredGames: Game[];
  totalGames: number;
  onSelectGame: (game: Game) => void;
}

const PlayIcon = (
  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
    <polygon points="6 4 20 12 6 20 6 4" />
  </svg>
);

const HubIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

const RecentIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const GridIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

export default function BigScreenLibrary({
  filteredGames,
  totalGames,
  onSelectGame,
}: BigScreenLibraryProps) {
  const { launchGame, runningGameIds } = useGames();

  // Compute rails
  const continuePlaying = useMemo(() => {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    return filteredGames
      .filter((g) => (g.lastPlayed ?? 0) >= cutoff)
      .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
      .slice(0, 12);
  }, [filteredGames]);

  const recentlyAdded = useMemo(() => {
    return [...filteredGames]
      .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
      .slice(0, 12);
  }, [filteredGames]);

  // Featured game (focus-tracked)
  const [featuredGame, setFeaturedGame] = useState<Game | null>(() => {
    return continuePlaying[0] ?? recentlyAdded[0] ?? filteredGames[0] ?? null;
  });

  const [logoError, setLogoError] = useState(false);
  useEffect(() => {
    setLogoError(false);
  }, [featuredGame?.id]);

  const handleFocusedGameChange = useCallback((g: Game | null) => {
    if (g) setFeaturedGame(g);
  }, []);

  // Steam details for player count
  const { appId: featuredSteamAppId } = useSteamAppId(featuredGame);
  const resolvedSteamAppId =
    typeof featuredSteamAppId === "number"
      ? featuredSteamAppId
      : featuredGame?.steamAppId ?? null;

  const isRunning = featuredGame ? runningGameIds.includes(featuredGame.id) : false;
  const status = featuredGame
    ? PLAY_STATUS_DETAILS[featuredGame.playStatus || "backlog"]
    : null;
  const releaseYear = featuredGame ? extractYear(featuredGame.releaseDate) : null;

  // Actions for detail pane
  const handlePlay = useCallback(() => {
    if (featuredGame) {
      launchGame(featuredGame);
    }
  }, [featuredGame, launchGame]);

  const handleDetails = useCallback(() => {
    if (featuredGame) {
      onSelectGame(featuredGame);
    }
  }, [featuredGame, onSelectGame]);

  const playFocusable = useFocusable(handlePlay);
  const detailsFocusable = useFocusable(handleDetails);

  // Keep featuredGame synced with context updates (e.g. Steam appid writes, metadata changes)
  useEffect(() => {
    if (!featuredGame) return;
    const updated = filteredGames.find((g) => g.id === featuredGame.id);
    if (updated && updated !== featuredGame) {
      setFeaturedGame(updated);
    }
  }, [filteredGames, featuredGame]);


  return (
    <div className="bigscreen-library-dashboard">
      {/* ── Dynamic full-bleed backdrop ── */}
      <div className="bigscreen-dashboard-backdrop-container">
        {featuredGame && (
          <img
            key={featuredGame.id}
            src={featuredGame.bannerUrl || featuredGame.coverArtUrl || ""}
            alt=""
            className="bigscreen-dashboard-backdrop-img animate-fade-in"
          />
        )}
        <div className="bigscreen-dashboard-backdrop-overlay" />
      </div>

      <div className="bigscreen-dashboard-scrollable-content">
        {/* ── Main Game Shelf (Continue Playing or first rail) ── */}
        <div className="bigscreen-dashboard-main-rail">
          <BigScreenRail
            title="Continue Playing"
            icon={PlayIcon}
            games={continuePlaying.length > 0 ? continuePlaying : filteredGames.slice(0, 12)}
            emptyLabel="Play a game to start tracking sessions — they'll show up here."
            onCardClick={onSelectGame}
            onFocusedGameChange={handleFocusedGameChange}
          />
        </div>

        {/* ── Focus Game Detail Pane (PS5 Game Info card layout) ── */}
        {featuredGame && (
          <section className="bigscreen-dashboard-details-pane" aria-label="Game information">
            <div className="bigscreen-details-pane-content">
              {/* Game logo or large text title */}
              <div className="bigscreen-details-logo-area">
                {featuredGame.logoUrl && !logoError ? (
                  <img
                    src={featuredGame.logoUrl}
                    alt={featuredGame.name}
                    className="bigscreen-details-logo"
                    onError={() => setLogoError(true)}
                  />
                ) : (
                  <h2 className="bigscreen-details-title">{featuredGame.name}</h2>
                )}
              </div>

              {/* Sub-info pills */}
              <div className="bigscreen-details-meta">
                <BigScreenPill tone="accent" size="sm">
                  {featuredGame.platform}
                </BigScreenPill>
                {status && (
                  <BigScreenPill tone="muted" size="sm" dot customColor={status.color}>
                    {status.label}
                  </BigScreenPill>
                )}
                {releaseYear && (
                  <BigScreenPill tone="muted" size="sm">
                    {releaseYear}
                  </BigScreenPill>
                )}
                {resolvedSteamAppId != null && (
                  <BigScreenPill tone="muted" size="sm">
                    <SteamPlayerCount appId={resolvedSteamAppId} className="bigscreen-steam-players" /> on Steam
                  </BigScreenPill>
                )}
              </div>

              {/* Description summary */}
              {featuredGame.description && (
                <p className="bigscreen-details-description">
                  {featuredGame.description.length > 180
                    ? `${featuredGame.description.substring(0, 180)}...`
                    : featuredGame.description}
                </p>
              )}

              {/* Action buttons */}
              <div className="bigscreen-details-actions">
                <button
                  type="button"
                  className="bigscreen-details-btn bigscreen-details-btn--primary"
                  {...playFocusable}
                  disabled={isRunning}
                >
                  {PlayIcon}
                  <span>{isRunning ? "Running" : "Play"}</span>
                </button>
                <button
                  type="button"
                  className="bigscreen-details-btn bigscreen-details-btn--secondary"
                  {...detailsFocusable}
                >
                  {HubIcon}
                  <span>Game Hub</span>
                </button>
              </div>

              {/* Quick stats grid */}
              <div className="bigscreen-details-stats-row">
                <div className="bigscreen-details-stat-item">
                  <span className="bigscreen-details-stat-label">Play Time</span>
                  <span className="bigscreen-details-stat-value">
                    {featuredGame.playTime || "0h"}
                  </span>
                </div>
                <div className="bigscreen-details-stat-item">
                  <span className="bigscreen-details-stat-label">Last Played</span>
                  <span className="bigscreen-details-stat-value">
                    {featuredGame.lastPlayed ? formatLastPlayed(featuredGame.lastPlayed) : "Never"}
                  </span>
                </div>
                {featuredGame.developer && (
                  <div className="bigscreen-details-stat-item">
                    <span className="bigscreen-details-stat-label">Developer</span>
                    <span className="bigscreen-details-stat-value">
                      {featuredGame.developer}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ── Secondary rails (scroll down) ── */}
        <div className="bigscreen-dashboard-secondary-rails">
          <BigScreenRail
            title="Recently Added"
            icon={RecentIcon}
            games={recentlyAdded}
            emptyLabel="No newly added games."
            onCardClick={onSelectGame}
            onFocusedGameChange={handleFocusedGameChange}
          />
          <BigScreenRail
            title={`Library · All Games (${totalGames})`}
            icon={GridIcon}
            games={filteredGames}
            emptyLabel="No games in library."
            onCardClick={onSelectGame}
            onFocusedGameChange={handleFocusedGameChange}
          />
        </div>
      </div>
    </div>
  );
}
