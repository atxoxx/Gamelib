import { useState, useMemo, useEffect, useCallback } from "react";
import { useGames } from "../../context/GameContext";
import { useAchievements } from "../../context/AchievementContext";
import { useFocusable } from "../../hooks/useFocusable";
import { useGamepad } from "../../hooks/GamepadProvider";
import BigScreenPill from "./BigScreenPill";
import BigScreenTabBar, { type TabDef } from "./BigScreenTabBar";
import BigScreenTabPanel from "./BigScreenTabPanel";
import BigScreenLightbox from "./BigScreenLightbox";
import { PLAY_STATUS_DETAILS } from "../../types/game";
import { extractYear } from "./bigscreenFormat";

// Game details components
import SpecsCard from "../game/SpecsCard";
import ReleasesCard from "../game/ReleasesCard";
import LanguagesSection from "../game/LanguagesSection";
import ScreenshotsSection from "../game/ScreenshotsSection";
import VideosSection from "../game/VideosSection";
import SystemRequirementsCard from "../game/SystemRequirementsCard";
import RatingsKpiCard from "../game/RatingsKpiCard";
import TimeToBeatCard from "../game/TimeToBeatCard";
import CrackWatchCard from "../CrackWatchCard";
import GameRelationsCard from "../GameRelationsCard";
import ReviewsTab from "../ReviewsTab";
import WebLinksTab from "../WebLinksTab";

interface BigScreenGameHubProps {
  gameId: string;
  onBack: () => void;
}

type HubTab = "overview" | "achievements" | "media" | "specs" | "more";

const HUB_TABS: TabDef<HubTab>[] = [
  { id: "overview", label: "Overview" },
  { id: "achievements", label: "Achievements" },
  { id: "media", label: "Media" },
  { id: "specs", label: "Specs" },
  { id: "more", label: "More" },
];

export default function BigScreenGameHub({ gameId, onBack }: BigScreenGameHubProps) {
  const { games, launchGame, forceCloseGame, runningGameIds } = useGames();
  const { getGameAchievements, syncGameAchievements, isSyncing } = useAchievements();
  const gamepad = useGamepad();

  const game = useMemo(() => games.find((g) => g.id === gameId), [games, gameId]);
  const [activeTab, setActiveTab] = useState<HubTab>("overview");
  const [syncing, setSyncing] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  // If game is not found, return an error
  if (!game) {
    return (
      <div className="bigscreen-gamepage bigscreen-gamepage--error">
        <h3>Game not found</h3>
        <button type="button" className="bigscreen-details-btn" onClick={onBack}>
          Go Back
        </button>
      </div>
    );
  }

  const isRunning = runningGameIds.includes(game.id);
  const status = PLAY_STATUS_DETAILS[game.playStatus || "backlog"];
  const releaseYear = extractYear(game.releaseDate);

  // Focusable actions
  const handleLaunch = useCallback(() => {
    if (isRunning) {
      forceCloseGame(game);
    } else {
      launchGame(game);
    }
  }, [game, isRunning, launchGame, forceCloseGame]);

  const handleSyncAchievements = useCallback(async () => {
    if (game.steamAppId) {
      setSyncing(true);
      try {
        await syncGameAchievements(game.id, game.steamAppId);
      } catch (err) {
        console.error("Failed to sync achievements:", err);
      } finally {
        setSyncing(false);
      }
    }
  }, [game, syncGameAchievements]);

  const playProps = useFocusable(handleLaunch);
  const syncProps = useFocusable(handleSyncAchievements);
  const backProps = useFocusable(onBack);

  // Achievements data
  const achievementsData = getGameAchievements(game.id);
  const achievementsList = achievementsData?.achievements ?? [];
  const pct = achievementsData?.total
    ? Math.round((achievementsData.unlocked / achievementsData.total) * 100)
    : 0;

  // LB/RB tab switcher
  useEffect(() => {
    return gamepad.registerTabCycler((direction: "forward" | "back") => {
      if (lightbox) return;
      setActiveTab((prev) => {
        const currentIndex = HUB_TABS.findIndex((t) => t.id === prev);
        const baseIndex = currentIndex < 0 ? 0 : currentIndex;
        const nextIndex =
          direction === "forward"
            ? (baseIndex + 1) % HUB_TABS.length
            : (baseIndex - 1 + HUB_TABS.length) % HUB_TABS.length;
        return HUB_TABS[nextIndex].id;
      });
    }, 1);
  }, [gamepad, lightbox]);

  return (
    <div className="bigscreen-gamepage">
      {/* Backdrop */}
      <div className="bigscreen-dashboard-backdrop-container">
        <img
          src={game.bannerUrl || game.coverArtUrl || ""}
          alt=""
          className="bigscreen-dashboard-backdrop-img animate-fade-in"
          style={{ opacity: 1 }}
        />
        <div className="bigscreen-dashboard-backdrop-overlay" />
      </div>

      <div className="bigscreen-gamepage-scrollable">
        {/* Back navigation button */}
        <div className="bigscreen-gamepage-nav-row">
          <button type="button" className="bigscreen-gamepage-back-btn" {...backProps}>
            ← Back to Library
          </button>
        </div>

        {/* Hero Area */}
        <div className="bigscreen-gamepage-hero-row">
          <div className="bigscreen-gamepage-cover-container">
            <img src={game.coverArtUrl || game.iconUrl || ""} alt="" />
          </div>
          <div className="bigscreen-gamepage-details-header">
            <h1 className="bigscreen-gamepage-title">{game.name}</h1>
            <div className="bigscreen-details-meta">
              <BigScreenPill tone="accent" size="sm">
                {game.platform}
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
              {game.playTime && (
                <BigScreenPill tone="muted" size="sm">
                  {game.playTime} Played
                </BigScreenPill>
              )}
            </div>

            {/* Launch Buttons */}
            <div className="bigscreen-gamepage-actions-row">
              <button
                type="button"
                className={`bigscreen-details-btn ${
                  isRunning ? "bigscreen-details-btn--danger" : "bigscreen-details-btn--primary"
                }`}
                {...playProps}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                  {isRunning ? (
                    <rect x="4" y="4" width="16" height="16" />
                  ) : (
                    <polygon points="6 4 20 12 6 20 6 4" />
                  )}
                </svg>
                <span>{isRunning ? "Force Close" : "Play"}</span>
              </button>

              {game.steamAppId && (
                <button
                  type="button"
                  className="bigscreen-details-btn bigscreen-details-btn--secondary"
                  {...syncProps}
                  disabled={isSyncing || syncing}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                  </svg>
                  <span>{isSyncing || syncing ? "Syncing..." : "Sync Achievements"}</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="bigscreen-gamepage-tabs-container">
          <BigScreenTabBar
            tabs={HUB_TABS}
            activeTab={activeTab}
            onActivate={setActiveTab}
          />
        </div>

        {/* Tab Panel contents */}
        <div className="bigscreen-gamepage-tab-scroll-region">
          <BigScreenTabPanel tabId="overview" activeTab={activeTab}>
            <div className="bigscreen-gamepage-overview">
              {game.description ? (
                <div className="overview-summary-card">
                  <h3>About the Game</h3>
                  <p>{game.description}</p>
                </div>
              ) : (
                <div className="overview-summary-card placeholder-card">
                  <p>No description available for this game.</p>
                </div>
              )}

              <div className="overview-stats-grid">
                <div className="overview-stat-card">
                  <span className="stat-label">Developer</span>
                  <span className="stat-value">{game.developer || "Unknown"}</span>
                </div>
                <div className="overview-stat-card">
                  <span className="stat-label">Publisher</span>
                  <span className="stat-value">{game.publisher || "Unknown"}</span>
                </div>
                {game.sizeBytes && (
                  <div className="overview-stat-card">
                    <span className="stat-label">Disk Space</span>
                    <span className="stat-value">
                      {parseFloat((game.sizeBytes / (1024 * 1024 * 1024)).toFixed(1))} GB
                    </span>
                  </div>
                )}
              </div>
            </div>
          </BigScreenTabPanel>

          <BigScreenTabPanel tabId="achievements" activeTab={activeTab}>
            <div className="bigscreen-gamepage-achievements-tab">
              {achievementsList.length > 0 ? (
                <>
                  <div className="achievements-progress-container">
                    <div className="achievements-progress-text">
                      Achievements: {achievementsData?.unlocked} / {achievementsData?.total} ({pct}%)
                    </div>
                    <div className="achievements-progress-bar">
                      <div className="achievements-progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="bigscreen-achievements-list">
                    {achievementsList.map((ach) => (
                      <div
                        key={ach.apiName}
                        className={`bigscreen-achievement-row ${
                          ach.achieved ? "achievement-unlocked" : "achievement-locked"
                        }`}
                      >
                        <div className="achievement-icon-wrapper">
                          {ach.icon ? (
                            <img src={ach.icon} alt="" />
                          ) : (
                            <div className="achievement-icon-placeholder" />
                          )}
                        </div>
                        <div className="achievement-info-wrapper">
                          <h4 className="achievement-title">{ach.displayName}</h4>
                          <p className="achievement-desc">{ach.description || "Hidden Achievement"}</p>
                        </div>
                        {ach.achieved && ach.unlockTime && (
                          <div className="achievement-date">
                            {new Date(ach.unlockTime * 1000).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="achievements-empty-state">
                  <p>No achievements cache found for this game.</p>
                  {game.steamAppId && (
                    <p className="sub-text">Click "Sync Achievements" above to pull achievements from Steam.</p>
                  )}
                </div>
              )}
            </div>
          </BigScreenTabPanel>

          <BigScreenTabPanel tabId="media" activeTab={activeTab}>
            <div className="bigscreen-gamepage-media">
              <ScreenshotsSection game={game} onOpen={setLightbox} />
              <VideosSection game={game} />
            </div>
          </BigScreenTabPanel>

          <BigScreenTabPanel tabId="specs" activeTab={activeTab}>
            <div className="bigscreen-gamepage-specs">
              <div className="bigscreen-gamepage-2col">
                <SpecsCard game={game} />
                <ReleasesCard game={game} />
              </div>
              <div className="bigscreen-gamepage-2col">
                <TimeToBeatCard game={game} />
                <RatingsKpiCard game={game} />
              </div>
              <LanguagesSection game={game} />
              <SystemRequirementsCard
                steamAppId={typeof game.steamAppId === "number" ? game.steamAppId : null}
              />
              <CrackWatchCard gameName={game.name} appId={typeof game.steamAppId === "number" ? game.steamAppId : null} />
            </div>
          </BigScreenTabPanel>

          <BigScreenTabPanel tabId="more" activeTab={activeTab}>
            <div className="bigscreen-gamepage-more">
              <GameRelationsCard
                mode="library"
                currentGame={game}
                currentGameId={game.id}
                similarGames={game.similarGames}
                collectionId={game.collectionId}
                collectionName={game.collection}
              />
              <ReviewsTab game={game} />
              <WebLinksTab game={game} visible={true} />
            </div>
          </BigScreenTabPanel>
        </div>
      </div>

      <BigScreenLightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}
