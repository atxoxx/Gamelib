import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import "../styles/page-achievements.css";
import { useAchievements } from "../context/AchievementContext";
import { useGames } from "../context/GameContext";
import { useToast } from "../context/ToastContext";
import {
  type Game,
  type Achievement,
  getAchievementRarity,
  RARITY_LABELS,
  RARITY_COLORS,
  type AchievementRarity,
} from "../types/game";

type CompletionFilter = "all" | "perfect" | "in_progress" | "not_started";
type SortBy = "name" | "completion" | "total" | "recent";

import { useBigScreen } from "../context/BigScreenContext";
import BigScreenSystem from "../components/bigscreen/BigScreenSystem";

export default function AchievementsPage() {
  const { isBigScreen } = useBigScreen();
  if (isBigScreen) {
    return <BigScreenSystem />;
  }
  const { games } = useGames();
  const { cache, syncAllAchievements, isSyncing, syncProgress } = useAchievements();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [completionFilter, setCompletionFilter] = useState<CompletionFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("completion");
  const [searchQuery, setSearchQuery] = useState("");

  // Build enriched game list with achievement data
  const gamesWithAchievements = useMemo(() => {
    return games
      .filter((g) => g.steamAppId)
      .map((g) => {
        const data = cache.games[g.id];
        return {
          game: g,
          data,
          total: data?.total ?? 0,
          unlocked: data?.unlocked ?? 0,
          pct: data && data.total > 0 ? Math.round((data.unlocked / data.total) * 100) : 0,
          lastSynced: data?.lastSynced ?? 0,
        };
      })
      .filter((item) => {
        // Search filter
        if (searchQuery && !item.game.name.toLowerCase().includes(searchQuery.toLowerCase())) {
          return false;
        }
        // Completion filter
        if (completionFilter === "perfect") return item.pct === 100 && item.total > 0;
        if (completionFilter === "in_progress") return item.unlocked > 0 && item.pct < 100;
        if (completionFilter === "not_started") return item.unlocked === 0 || !item.data;
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "name") return a.game.name.localeCompare(b.game.name);
        if (sortBy === "completion") return b.pct - a.pct || b.unlocked - a.unlocked;
        if (sortBy === "total") return b.total - a.total;
        if (sortBy === "recent") return b.lastSynced - a.lastSynced;
        return 0;
      });
  }, [games, cache, completionFilter, sortBy, searchQuery]);

  // Aggregate stats
  const stats = useMemo(() => {
    let totalAchievements = 0;
    let totalUnlocked = 0;
    let perfectGames = 0;
    let gamesWithData = 0;

    for (const item of Object.values(cache.games)) {
      if (item.total > 0) {
        gamesWithData++;
        totalAchievements += item.total;
        totalUnlocked += item.unlocked;
        if (item.unlocked === item.total) perfectGames++;
      }
    }

    return {
      totalAchievements,
      totalUnlocked,
      overallPct: totalAchievements > 0 ? Math.round((totalUnlocked / totalAchievements) * 100) : 0,
      perfectGames,
      gamesWithData,
      avgCompletion:
        gamesWithData > 0
          ? Math.round(
              Object.values(cache.games)
                .filter((d) => d.total > 0)
                .reduce((sum, d) => sum + (d.unlocked / d.total) * 100, 0) / gamesWithData
            )
          : 0,
    };
  }, [cache]);

  // Recent achievements (last 20 across all games)
  const recentAchievements = useMemo(() => {
    const all: { achievement: Achievement; gameName: string; gameId: string }[] = [];
    for (const [gameId, data] of Object.entries(cache.games)) {
      const game = games.find((g) => g.id === gameId);
      for (const a of data.achievements) {
        if (a.achieved && a.unlockTime > 0) {
          all.push({ achievement: a, gameName: game?.name ?? "Unknown", gameId });
        }
      }
    }
    return all
      .sort((a, b) => b.achievement.unlockTime - a.achievement.unlockTime)
      .slice(0, 20);
  }, [cache, games]);

  // Rarity distribution across all achievements
  const rarityStats = useMemo(() => {
    const counts: Record<AchievementRarity, number> = {
      common: 0,
      uncommon: 0,
      rare: 0,
      ultra_rare: 0,
    };
    for (const data of Object.values(cache.games)) {
      for (const a of data.achievements) {
        counts[getAchievementRarity(a.percent)]++;
      }
    }
    return counts;
  }, [cache]);

  async function handleSyncAll() {
    try {
      await syncAllAchievements(games);
      showToast("All achievements synced!", "success");
    } catch (err) {
      showToast(`Sync failed: ${err}`, "error");
    }
  }

  return (
    <div className="achievements-page">
      {/* Page header */}
      <div className="achievements-page-header">
        <span className="brand-eyebrow">Your Progress</span>
        <div className="achievements-page-title-row">
          <h1 className="achievements-page-title brand-text">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
              <circle cx="12" cy="8" r="6" />
              <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
            </svg>
            Achievements
          </h1>
          <button
            className="achievements-sync-btn"
            onClick={handleSyncAll}
            disabled={isSyncing}
          >
            {isSyncing ? (
              <>
                <span className="achievements-spinner" />
                Syncing {syncProgress ? `(${syncProgress.current}/${syncProgress.total})` : "…"}
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
                Sync All
              </>
            )}
          </button>
        </div>
      </div>

      {/* Summary stat cards */}
      <div className="achievements-summary-grid">
        <div className="achievements-summary-card">
          <span className="achievements-summary-value">{stats.totalUnlocked}</span>
          <span className="achievements-summary-label">Unlocked</span>
        </div>
        <div className="achievements-summary-card">
          <span className="achievements-summary-value">{stats.totalAchievements}</span>
          <span className="achievements-summary-label">Total</span>
        </div>
        <div className="achievements-summary-card">
          <span className="achievements-summary-value">{stats.overallPct}%</span>
          <span className="achievements-summary-label">Completion</span>
        </div>
        <div className="achievements-summary-card achievements-summary-perfect">
          <span className="achievements-summary-value">{stats.perfectGames}</span>
          <span className="achievements-summary-label">Perfect Games</span>
        </div>
        <div className="achievements-summary-card">
          <span className="achievements-summary-value">{stats.avgCompletion}%</span>
          <span className="achievements-summary-label">Avg. Completion</span>
        </div>
      </div>

      {/* Rarity distribution */}
      {stats.totalAchievements > 0 && (
        <div className="achievements-page-rarity-section">
          <h3 className="achievements-section-title">Rarity Distribution</h3>
          <div className="achievements-rarity-bar-wrap">
            <div className="achievements-rarity-bar achievements-rarity-bar-lg">
              {(["ultra_rare", "rare", "uncommon", "common"] as const).map((tier) => {
                const count = rarityStats[tier];
                if (count === 0) return null;
                return (
                  <div
                    key={tier}
                    className="achievements-rarity-segment"
                    style={{
                      width: `${(count / stats.totalAchievements) * 100}%`,
                      backgroundColor: RARITY_COLORS[tier],
                    }}
                    title={`${RARITY_LABELS[tier]}: ${count}`}
                  />
                );
              })}
            </div>
            <div className="achievements-rarity-legend">
              {(["ultra_rare", "rare", "uncommon", "common"] as const).map((tier) => (
                <span key={tier} className="achievements-rarity-legend-item">
                  <span className="achievements-rarity-dot" style={{ backgroundColor: RARITY_COLORS[tier] }} />
                  {RARITY_LABELS[tier]} ({rarityStats[tier]})
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Recent Achievements Timeline */}
      {recentAchievements.length > 0 && (
        <div className="achievements-recent-section">
          <h3 className="achievements-section-title">Recent Unlocks</h3>
          <div className="achievements-timeline">
            {recentAchievements.map((item, i) => (
              <div
                key={`${item.gameId}-${item.achievement.apiName}-${i}`}
                className="achievements-timeline-item"
                onClick={() => navigate(`/library/${item.gameId}`)}
              >
                <img
                  className="achievements-timeline-icon"
                  src={item.achievement.icon}
                  alt={item.achievement.displayName}
                  loading="lazy"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
                <div className="achievements-timeline-body">
                  <span className="achievements-timeline-name">{item.achievement.displayName}</span>
                  <span className="achievements-timeline-game">{item.gameName}</span>
                </div>
                <span className="achievements-timeline-date">
                  {new Date(item.achievement.unlockTime * 1000).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Games list with toolbar */}
      <div className="achievements-games-section">
        <h3 className="achievements-section-title">Games</h3>
        <div className="achievements-toolbar">
          <div className="achievements-filters">
            {(["all", "perfect", "in_progress", "not_started"] as const).map((f) => (
              <button
                key={f}
                className={`achievements-filter-btn ${completionFilter === f ? "active" : ""}`}
                onClick={() => setCompletionFilter(f)}
              >
                {f === "all"
                  ? "All"
                  : f === "perfect"
                    ? "Perfect"
                    : f === "in_progress"
                      ? "In Progress"
                      : "Not Started"}
              </button>
            ))}
          </div>
          <div className="achievements-search-wrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="achievements-search-input"
              placeholder="Search games…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="achievements-sort">
            <label className="achievements-sort-label">Sort:</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="achievements-sort-select"
            >
              <option value="completion">Completion %</option>
              <option value="name">Name</option>
              <option value="total">Total Achievements</option>
              <option value="recent">Recently Synced</option>
            </select>
          </div>
        </div>

        <div className="achievements-games-list">
          {gamesWithAchievements.map((item) => (
            <GameAchievementRow
              key={item.game.id}
              game={item.game}
              total={item.total}
              unlocked={item.unlocked}
              pct={item.pct}
              lastSynced={item.lastSynced}
              onClick={() => navigate(`/library/${item.game.id}`)}
            />
          ))}
          {gamesWithAchievements.length === 0 && (
            <div className="achievements-no-results">
              {searchQuery ? "No games match your search." : "No Steam games found. Sync your Steam library first."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function GameAchievementRow({
  game,
  total,
  unlocked,
  pct,
  lastSynced,
  onClick,
}: {
  game: Game;
  total: number;
  unlocked: number;
  pct: number;
  lastSynced: number;
  onClick: () => void;
}) {
  return (
    <div className="achievements-game-row" onClick={onClick}>
      <div className="achievements-game-cover">
        {game.coverArtUrl ? (
          <img src={game.coverArtUrl} alt={game.name} loading="lazy" />
        ) : (
          <div className="achievements-game-cover-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="20" height="20">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
        )}
      </div>
      <div className="achievements-game-info">
        <span className="achievements-game-name">{game.name}</span>
        {total > 0 ? (
          <div className="achievements-game-progress-wrap">
            <div className="achievements-game-progress-bar">
              <div
                className="achievements-game-progress-fill"
                style={{
                  width: `${pct}%`,
                  background: pct >= 100
                    ? "linear-gradient(90deg, #10b981, #059669)"
                    : "linear-gradient(90deg, var(--color-accent), #818cf8)",
                }}
              />
            </div>
            <span className="achievements-game-progress-text">
              {unlocked}/{total} ({pct}%)
            </span>
          </div>
        ) : (
          <span className="achievements-game-not-synced">Not synced</span>
        )}
      </div>
      {pct === 100 && total > 0 && (
        <div className="achievements-perfect-badge" title="100% Complete">
          <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        </div>
      )}
      {lastSynced > 0 && (
        <span className="achievements-game-synced-at">
          {new Date(lastSynced).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </span>
      )}
    </div>
  );
}
