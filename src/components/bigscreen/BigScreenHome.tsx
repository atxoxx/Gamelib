import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useGames } from "../../context/GameContext";
import { useDownloads } from "../../context/DownloadContext";
import { useDriveUsage } from "../../pages/storage/useDriveUsage";
import { useFocusable } from "../../hooks/useFocusable";
import { useGamepad } from "../../hooks/GamepadProvider";
import { PLAY_STATUS_DETAILS } from "../../types/game";
import type { Game } from "../../types/game";
import BigScreenRail from "../library/BigScreenRail";
import BigScreenPill from "./BigScreenPill";
import { extractYear } from "./bigscreenFormat";
import { formatEta } from "../../types/download";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatSpeed(bytesPerSecond: number): string {
  const mb = bytesPerSecond / (1024 * 1024);
  return `${mb.toFixed(1)} MB/s`;
}

export default function BigScreenHome() {
  const { games, launchGame, runningGameIds } = useGames();
  const { activeDownloads } = useDownloads();
  const driveUsage = useDriveUsage(games);
  const gamepad = useGamepad();
  const navigate = useNavigate();

  const [logoError, setLogoError] = useState(false);

  // Compute game lists
  const continuePlaying = useMemo(() => {
    return [...games]
      .filter((g) => g.lastPlayed && g.lastPlayed > 0)
      .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
      .slice(0, 12);
  }, [games]);

  const recentlyAdded = useMemo(() => {
    return [...games]
      .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
      .slice(0, 12);
  }, [games]);

  const initialFeatured = useMemo(() => {
    return continuePlaying[0] ?? recentlyAdded[0] ?? games[0] ?? null;
  }, [continuePlaying, recentlyAdded, games]);

  const [selectedGame, setSelectedGame] = useState<Game | null>(initialFeatured);

  useEffect(() => {
    setLogoError(false);
  }, [selectedGame?.id]);

  // Sync selected game on load or when library initialFeatured changes
  useEffect(() => {
    if (!selectedGame && initialFeatured) {
      setSelectedGame(initialFeatured);
    }
  }, [initialFeatured, selectedGame]);

  // Keep selectedGame reference fresh from games list
  const featuredGame = useMemo(() => {
    if (!selectedGame) return null;
    return games.find((g) => g.id === selectedGame.id) ?? selectedGame;
  }, [games, selectedGame]);

  // Flat lookup for spotlight updates based on spatial focus
  const allGamesById = useMemo(() => {
    const map = new Map<string, Game>();
    for (const g of games) map.set(g.id, g);
    return map;
  }, [games]);

  useEffect(() => {
    const el = gamepad.focusedElement;
    if (!el) {
      console.log("BigScreenHome: No focused element");
      return;
    }
    const id = el.getAttribute("data-game-id");
    console.log("BigScreenHome Focus Watcher: Focused element:", el.tagName, "Class:", el.className, "data-game-id:", id);
    if (!id) return;
    const game = allGamesById.get(id);
    console.log("BigScreenHome Focus Watcher: Looked up game:", game?.name);
    if (game && game.id !== selectedGame?.id) {
      console.log("BigScreenHome Focus Watcher: Setting selectedGame to:", game.name);
      setSelectedGame(game);
    }
  }, [gamepad.focusedElement, allGamesById, selectedGame]);

  const isRunning = featuredGame ? runningGameIds.includes(featuredGame.id) : false;
  const status = featuredGame
    ? PLAY_STATUS_DETAILS[featuredGame.playStatus || "backlog"]
    : null;
  const releaseYear = featuredGame ? extractYear(featuredGame.releaseDate) : null;

  const handlePlay = useCallback(() => {
    if (featuredGame) {
      launchGame(featuredGame);
    }
  }, [featuredGame, launchGame]);

  const handleDetails = useCallback(() => {
    if (featuredGame) {
      navigate(`/library/${featuredGame.id}`);
    }
  }, [featuredGame, navigate]);

  const playProps = useFocusable(handlePlay);
  const detailsProps = useFocusable(handleDetails);

  // Widget actions
  const downloadWidgetProps = useFocusable(() => navigate("/downloads"));
  const storageWidgetProps = useFocusable(() => navigate("/storage"));

  // Calculate storage overview
  const storageOverview = useMemo(() => {
    if (driveUsage.size === 0) return null;
    const firstDrive = Array.from(driveUsage.keys())[0];
    return {
      label: firstDrive,
      usage: driveUsage.get(firstDrive)!,
    };
  }, [driveUsage]);

  // Active download overview
  const activeDownload = activeDownloads[0] ?? null;

  return (
    <div className="bigscreen-library-dashboard">
      {/* Backdrop */}
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
        {/* Side-by-side Spotlight and Widgets */}
        <div className="bigscreen-home-split-row">
          {/* Left Details Pane */}
          <div className="bigscreen-dashboard-details-pane">
            <div className="bigscreen-details-pane-content">
              {featuredGame ? (
                <>
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
                  </div>

                  {featuredGame.description && (
                    <p className="bigscreen-details-description">
                      {featuredGame.description.length > 200
                        ? `${featuredGame.description.substring(0, 200)}...`
                        : featuredGame.description}
                    </p>
                  )}

                  <div className="bigscreen-details-actions">
                    <button
                      type="button"
                      className="bigscreen-details-btn bigscreen-details-btn--primary"
                      {...playProps}
                      disabled={isRunning}
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                        <polygon points="6 4 20 12 6 20 6 4" />
                      </svg>
                      <span>{isRunning ? "Running" : "Play"}</span>
                    </button>
                    <button
                      type="button"
                      className="bigscreen-details-btn bigscreen-details-btn--secondary"
                      {...detailsProps}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="16" x2="12" y2="12" />
                        <line x1="12" y1="8" x2="12.01" y2="8" />
                      </svg>
                      <span>Game Hub</span>
                    </button>
                  </div>
                </>
              ) : (
                <div className="bigscreen-details-placeholder">
                  <h2 className="bigscreen-details-title">Welcome to GameLib</h2>
                  <p className="bigscreen-details-description">
                    Connect a gamepad controller or use your keyboard arrows to navigate. Import games in desktop mode to build your library.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Right Dashboard Widgets Panel */}
          <div className="bigscreen-home-widgets-panel">
            {/* Download Widget */}
            {activeDownload ? (
              <div className="bigscreen-widget-card" {...downloadWidgetProps}>
                <div className="bigscreen-widget-header">
                  <span className="bigscreen-widget-title">Active Download</span>
                  <span className="bigscreen-widget-badge">LIVE</span>
                </div>
                <div className="bigscreen-widget-body">
                  <div className="bigscreen-widget-game-name">{activeDownload.name}</div>
                  <div className="bigscreen-widget-progress-row">
                    <div className="bigscreen-widget-progress-bar">
                      <div
                        className="bigscreen-widget-progress-fill"
                        style={{ width: `${(activeDownload.progress || 0) * 100}%` }}
                      />
                    </div>
                    <span className="bigscreen-widget-progress-percent">
                      {Math.round((activeDownload.progress || 0) * 100)}%
                    </span>
                  </div>
                  <div className="bigscreen-widget-download-meta">
                    <span>{formatSpeed(activeDownload.downloadSpeed || 0)}</span>
                    <span>{formatEta(activeDownload.downloaded, activeDownload.totalSize, activeDownload.downloadSpeed)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bigscreen-widget-card bigscreen-widget-card--idle">
                <div className="bigscreen-widget-header">
                  <span className="bigscreen-widget-title">System Status</span>
                </div>
                <div className="bigscreen-widget-body">
                  <div className="bigscreen-widget-status-msg">All systems ready</div>
                  <div className="bigscreen-widget-status-desc">No active downloads running</div>
                </div>
              </div>
            )}

            {/* Storage Widget */}
            {storageOverview && (
              <div className="bigscreen-widget-card" {...storageWidgetProps}>
                <div className="bigscreen-widget-header">
                  <span className="bigscreen-widget-title">Storage ({storageOverview.label})</span>
                </div>
                <div className="bigscreen-widget-body">
                  <div className="bigscreen-widget-progress-row">
                    <div className="bigscreen-widget-progress-bar">
                      <div
                        className="bigscreen-widget-progress-fill storage-fill"
                        style={{
                          width: `${((storageOverview.usage.total - storageOverview.usage.free) /
                            storageOverview.usage.total) *
                            100}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div className="bigscreen-widget-download-meta">
                    <span>
                      {formatBytes(storageOverview.usage.total - storageOverview.usage.free)} used
                    </span>
                    <span>{formatBytes(storageOverview.usage.free)} free</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Shelves / Rails */}
        <div className="bigscreen-dashboard-main-rail">
          {continuePlaying.length > 0 && (
            <BigScreenRail
              title="Continue Playing"
              games={continuePlaying}
              onCardClick={handleDetails}
              railId="continue-playing"
            />
          )}

          <BigScreenRail
            title="Recently Added"
            games={recentlyAdded.length > 0 ? recentlyAdded : games.slice(0, 12)}
            emptyLabel="No games in library. Switch to desktop to import them."
            onCardClick={handleDetails}
            railId="recently-added"
          />
        </div>
      </div>
    </div>
  );
}
