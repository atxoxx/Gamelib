import { useMemo, useState } from "react";
import { formatPlayTime } from "../../types/game";
import BarChart from "../../components/charts/BarChart";
import LineChart from "../../components/charts/LineChart";
import DonutChart from "../../components/charts/DonutChart";
import * as Icons from "./Icons";

export interface ActivityDashboardProps {
  sessions: any[];
  games: any[];
  dateRange: string;
  startDate: string;
  endDate: string;
  aggregation: "day" | "week" | "month";
  chartType: "bar" | "line";
  sourceFilter: string;
}

export function ActivityDashboard({
  sessions,
  games,
  dateRange,
  startDate,
  endDate,
  aggregation,
  chartType,
  sourceFilter,
}: ActivityDashboardProps) {
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // 1. Filter sessions by date range and source filter
  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      const d = s.date.slice(0, 10);
      const inRange = d >= startDate && d <= endDate;
      if (!inRange) return false;
      if (sourceFilter === "all") return true;

      const game = games.find((g) => g.id === s.gameId);
      const plat = game?.platform || "Local";
      return plat.toLowerCase() === sourceFilter.toLowerCase();
    });
  }, [sessions, games, startDate, endDate, sourceFilter]);

  // 2. Filter sessions by selected game if one is isolated
  const gameIsolatedSessions = useMemo(() => {
    if (!selectedGameId) return filteredSessions;
    return filteredSessions.filter((s) => s.gameId === selectedGameId);
  }, [filteredSessions, selectedGameId]);

  // 3. Compute Top Games Played (Sidebar list)
  const sidebarGamesList = useMemo(() => {
    const gamePlaytimes = new Map<string, number>();
    filteredSessions.forEach((s) => {
      gamePlaytimes.set(s.gameId, (gamePlaytimes.get(s.gameId) || 0) + s.durationMin);
    });

    return Array.from(gamePlaytimes.entries())
      .map(([gameId, minutes]) => {
        const game = games.find((g) => g.id === gameId);
        return {
          id: gameId,
          title: game?.name || "Unknown Game",
          platform: game?.platform || "Local",
          iconUrl: game?.iconUrl || null,
          minutes,
        };
      })
      .sort((a, b) => b.minutes - a.minutes);
  }, [filteredSessions, games]);

  // Filter sidebar list by search query
  const filteredSidebarGames = useMemo(() => {
    if (!searchQuery.trim()) return sidebarGamesList;
    const q = searchQuery.toLowerCase();
    return sidebarGamesList.filter((g) => g.title.toLowerCase().includes(q));
  }, [sidebarGamesList, searchQuery]);

  const maxSidebarMinutes = useMemo(() => {
    return sidebarGamesList.reduce((max, g) => Math.max(max, g.minutes), 0) || 1;
  }, [sidebarGamesList]);

  const totalPlaytimeMinutes = useMemo(() => {
    return sidebarGamesList.reduce((sum, g) => sum + g.minutes, 0);
  }, [sidebarGamesList]);

  // 4. Compute Overview Stat Cards
  const stats = useMemo(() => {
    const totalMin = gameIsolatedSessions.reduce((sum, s) => sum + s.durationMin, 0);
    const totalHoursStr = totalMin >= 60 ? `${Math.floor(totalMin / 60)}h ${totalMin % 60}m` : `${totalMin}m`;

    const gamesPlayedCount = new Set(gameIsolatedSessions.map((s) => s.gameId)).size;
    const totalSessCount = gameIsolatedSessions.length;

    // Averages
    let numDays = 7;
    if (dateRange === "30d") numDays = 30;
    else if (dateRange === "90d") numDays = 90;
    else if (dateRange === "all") {
      if (sessions.length > 0) {
        const oldest = new Date(sessions[sessions.length - 1].date);
        const today = new Date();
        const diffTime = Math.abs(today.getTime() - oldest.getTime());
        numDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
      } else {
        numDays = 1;
      }
    }
    const avgPerDayMin = Math.round(totalMin / numDays);
    const avgPerDayStr = avgPerDayMin >= 60 ? `${Math.floor(avgPerDayMin / 60)}h ${avgPerDayMin % 60}m` : `${avgPerDayMin}m`;

    // Longest Streak (consecutive days played)
    const dates = new Set(sessions.map((s) => s.date.slice(0, 10)));
    const sortedDates = Array.from(dates).sort();
    let longestStreak = 0;
    let currentStreak = 0;
    let prevTime: number | null = null;
    for (const dStr of sortedDates) {
      const curTime = new Date(dStr + "T00:00:00").getTime();
      if (prevTime === null) {
        currentStreak = 1;
      } else {
        const diffDays = (curTime - prevTime) / (1000 * 60 * 60 * 24);
        if (diffDays === 1) {
          currentStreak++;
        } else if (diffDays > 1) {
          longestStreak = Math.max(longestStreak, currentStreak);
          currentStreak = 1;
        }
      }
      prevTime = curTime;
    }
    longestStreak = Math.max(longestStreak, currentStreak);

    return {
      playtimeStr: totalHoursStr,
      gamesPlayed: gamesPlayedCount,
      avgPerDayStr,
      sessionsCount: totalSessCount,
      longestStreak: longestStreak > 0 ? `${longestStreak}d` : "—",
    };
  }, [gameIsolatedSessions, dateRange, sessions]);

  // 5. Heatmap Data (daily playtime across all games)
  const heatmapDays = useMemo(() => {
    const dayMap = new Map<string, number>();
    filteredSessions.forEach((s) => {
      const d = s.date.slice(0, 10);
      dayMap.set(d, (dayMap.get(d) || 0) + s.durationMin);
    });

    const list = [];
    const end = new Date(endDate + "T00:00:00");
    const cursor = new Date(startDate + "T00:00:00");

    while (cursor <= end) {
      const dateStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
      const mins = dayMap.get(dateStr) ?? 0;
      list.push({
        date: dateStr,
        hours: mins / 60,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return list;
  }, [filteredSessions, startDate, endDate]);

  const heatmapPaddedDays = useMemo(() => {
    const list: ({ date: string; hours: number } | null)[] = [];
    if (heatmapDays.length === 0) return list;

    const firstDate = new Date(heatmapDays[0].date + "T00:00:00");
    const firstDayOfWeek = firstDate.getDay(); // 0 is Sunday, 1 is Monday

    for (let i = 0; i < firstDayOfWeek; i++) {
      list.push(null);
    }
    list.push(...heatmapDays);
    return list;
  }, [heatmapDays]);

  const getHeatmapIntensity = (hours: number): string => {
    if (hours <= 0) return "weekly-heatmap__cell--empty";
    if (hours < 0.5) return "weekly-heatmap__cell--low";
    if (hours < 2) return "weekly-heatmap__cell--medium";
    if (hours < 4) return "weekly-heatmap__cell--high";
    return "weekly-heatmap__cell--peak";
  };

  // 6. Platform Breakdown & Genre Breakdown Donut Charts
  const platformBreakdownSlices = useMemo(() => {
    const platformMap = new Map<string, number>();
    gameIsolatedSessions.forEach((s) => {
      const game = games.find((g) => g.id === s.gameId);
      const plat = game?.platform || "Local";
      platformMap.set(plat, (platformMap.get(plat) || 0) + s.durationMin);
    });

    return Array.from(platformMap.entries()).map(([label, mins]) => ({
      label,
      value: Math.round((mins / 60) * 10) / 10,
      color: "", // Let DonutChart color it automatically
    }));
  }, [gameIsolatedSessions, games]);

  const genreBreakdownSlices = useMemo(() => {
    const genreMap = new Map<string, number>();
    gameIsolatedSessions.forEach((s) => {
      const game = games.find((g) => g.id === s.gameId);
      if (game?.genres && game.genres.length > 0) {
        game.genres.forEach((genre: string) => {
          genreMap.set(genre, (genreMap.get(genre) || 0) + s.durationMin);
        });
      } else {
        genreMap.set("Unknown", (genreMap.get("Unknown") || 0) + s.durationMin);
      }
    });

    return Array.from(genreMap.entries())
      .map(([label, mins]) => ({
        label,
        value: Math.round((mins / 60) * 10) / 10,
        color: "",
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [gameIsolatedSessions, games]);

  // 7. Playtime Chart Data (aggregated by day, week, or month)
  const chartPoints = useMemo(() => {
    const dayMap = new Map<string, number>();
    gameIsolatedSessions.forEach((s) => {
      const d = s.date.slice(0, 10);
      dayMap.set(d, (dayMap.get(d) || 0) + s.durationMin);
    });

    const points: { label: string; date: string; value: number }[] = [];
    const end = new Date(endDate + "T00:00:00");
    const cursor = new Date(startDate + "T00:00:00");

    if (aggregation === "day") {
      while (cursor <= end) {
        const dateStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
        const mins = dayMap.get(dateStr) ?? 0;
        points.push({
          label: dateStr.slice(5), // MM-DD
          date: dateStr,
          value: Math.round((mins / 60) * 10) / 10, // hours
        });
        cursor.setDate(cursor.getDate() + 1);
      }
    } else if (aggregation === "week") {
      // Group by week
      const weeklyMap = new Map<string, number>();
      for (const [dStr, mins] of dayMap.entries()) {
        const date = new Date(dStr + "T00:00:00");
        const startOfWeek = new Date(date);
        startOfWeek.setDate(date.getDate() - date.getDay()); // Sunday start
        const wKey = `${startOfWeek.getFullYear()}-${String(startOfWeek.getMonth() + 1).padStart(2, "0")}-${String(startOfWeek.getDate()).padStart(2, "0")}`;
        weeklyMap.set(wKey, (weeklyMap.get(wKey) || 0) + mins);
      }

      const cursorWeek = new Date(startDate + "T00:00:00");
      cursorWeek.setDate(cursorWeek.getDate() - cursorWeek.getDay());

      while (cursorWeek <= end) {
        const wKey = `${cursorWeek.getFullYear()}-${String(cursorWeek.getMonth() + 1).padStart(2, "0")}-${String(cursorWeek.getDate()).padStart(2, "0")}`;
        const mins = weeklyMap.get(wKey) ?? 0;
        points.push({
          label: wKey.slice(5),
          date: wKey,
          value: Math.round((mins / 60) * 10) / 10,
        });
        cursorWeek.setDate(cursorWeek.getDate() + 7);
      }
    } else {
      // Month aggregation
      const monthlyMap = new Map<string, number>();
      for (const [dStr, mins] of dayMap.entries()) {
        const mKey = dStr.slice(0, 7); // YYYY-MM
        monthlyMap.set(mKey, (monthlyMap.get(mKey) || 0) + mins);
      }

      const startMonth = new Date(startDate + "T00:00:00");
      const endMonth = new Date(endDate + "T00:00:00");
      const cursorMonth = new Date(startMonth.getFullYear(), startMonth.getMonth(), 1);

      while (cursorMonth <= endMonth) {
        const mKey = `${cursorMonth.getFullYear()}-${String(cursorMonth.getMonth() + 1).padStart(2, "0")}`;
        const mins = monthlyMap.get(mKey) ?? 0;
        points.push({
          label: cursorMonth.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
          date: mKey,
          value: Math.round((mins / 60) * 10) / 10,
        });
        cursorMonth.setMonth(cursorMonth.getMonth() + 1);
      }
    }

    return points;
  }, [gameIsolatedSessions, aggregation, startDate, endDate]);

  const chartData = useMemo(() => chartPoints.map((p) => p.value), [chartPoints]);
  const chartLabels = useMemo(() => chartPoints.map((p) => p.label), [chartPoints]);

  const selectedGame = useMemo(() => {
    if (!selectedGameId) return null;
    return games.find((g) => g.id === selectedGameId) || null;
  }, [selectedGameId, games]);

  return (
    <div className="activity__content">
      {/* ── Overview Stats Row ── */}
      <div className="activity-stats-bar">
        <div className="activity-stats-bar__pill activity-stats-bar__pill--highlight">
          <span className="activity-stats-bar__pill-icon">
            <Icons.Clock size={14} />
          </span>
          <div className="activity-stats-bar__pill-content">
            <span className="activity-stats-bar__pill-label">Total Playtime</span>
            <span className="activity-stats-bar__pill-value">{stats.playtimeStr}</span>
          </div>
        </div>

        <div className="activity-stats-bar__pill">
          <span className="activity-stats-bar__pill-icon">
            <Icons.Gamepad2 size={14} />
          </span>
          <div className="activity-stats-bar__pill-content">
            <span className="activity-stats-bar__pill-label">Games Played</span>
            <span className="activity-stats-bar__pill-value">{stats.gamesPlayed}</span>
          </div>
        </div>

        <div className="activity-stats-bar__pill">
          <span className="activity-stats-bar__pill-icon">
            <Icons.TrendingUp size={14} />
          </span>
          <div className="activity-stats-bar__pill-content">
            <span className="activity-stats-bar__pill-label">Average Per Day</span>
            <span className="activity-stats-bar__pill-value">{stats.avgPerDayStr}</span>
          </div>
        </div>

        <div className="activity-stats-bar__pill">
          <span className="activity-stats-bar__pill-icon">
            <Icons.Calendar size={14} />
          </span>
          <div className="activity-stats-bar__pill-content">
            <span className="activity-stats-bar__pill-label">Sessions</span>
            <span className="activity-stats-bar__pill-value">{stats.sessionsCount}</span>
          </div>
        </div>

        <div className="activity-stats-bar__pill">
          <span className="activity-stats-bar__pill-icon">
            <Icons.Zap size={14} />
          </span>
          <div className="activity-stats-bar__pill-content">
            <span className="activity-stats-bar__pill-label">Longest Streak</span>
            <span className="activity-stats-bar__pill-value">{stats.longestStreak}</span>
          </div>
        </div>
      </div>

      {/* ── Main Dashboard Layout ── */}
      <div className="activity__dashboard-layout">
        {/* Left Sidebar */}
        <aside className="activity-game-sidebar">
          <div className="activity-game-sidebar__header">
            <h3 className="activity-game-sidebar__title">
              <Icons.LayoutDashboard size={14} />
              Games
            </h3>
            <span className="activity-game-sidebar__count">{sidebarGamesList.length}</span>
          </div>

          <div className="activity-game-sidebar__summary">
            <span className="activity-game-sidebar__summary-label">Total Playtime</span>
            <span className="activity-game-sidebar__summary-value">{formatPlayTime(totalPlaytimeMinutes)}</span>
          </div>

          <div className="activity-game-sidebar__search">
            <Icons.Search size={13} className="activity-game-sidebar__search-icon" />
            <input
              type="text"
              className="activity-game-sidebar__search-input"
              placeholder="Search games..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="activity-game-sidebar__list">
            <button
              type="button"
              className={`activity-game-sidebar__item activity-game-sidebar__item--all ${
                selectedGameId === null ? "activity-game-sidebar__item--selected" : ""
              }`}
              onClick={() => setSelectedGameId(null)}
            >
              <span className="activity-game-sidebar__all-icon">
                <Icons.LayoutDashboard size={15} />
              </span>
              <div className="activity-game-sidebar__info">
                <span className="activity-game-sidebar__name" style={{ color: "var(--color-text-primary)" }}>
                  All Games
                </span>
              </div>
              <span className="activity-game-sidebar__time">{sidebarGamesList.length}</span>
            </button>

            {filteredSidebarGames.map((g) => {
              const barWidth = maxSidebarMinutes > 0 ? (g.minutes / maxSidebarMinutes) * 100 : 0;
              return (
                <button
                  key={g.id}
                  type="button"
                  className={`activity-game-sidebar__item ${
                    selectedGameId === g.id ? "activity-game-sidebar__item--selected" : ""
                  }`}
                  onClick={() => setSelectedGameId(g.id)}
                >
                  {g.iconUrl ? (
                    <img className="activity-game-sidebar__icon" src={g.iconUrl} alt={g.title} />
                  ) : (
                    <span className="activity-game-sidebar__icon-placeholder" />
                  )}
                  <div className="activity-game-sidebar__info">
                    <span className="activity-game-sidebar__name">{g.title}</span>
                    <div className="activity-game-sidebar__bar">
                      <div className="activity-game-sidebar__bar-fill" style={{ width: `${barWidth}%` }} />
                    </div>
                  </div>
                  <span className="activity-game-sidebar__time">{formatPlayTime(g.minutes)}</span>
                </button>
              );
            })}

            {filteredSidebarGames.length === 0 && (
              <div className="activity-game-sidebar__empty">No games found</div>
            )}
          </div>
        </aside>

        {/* Right Main Panel */}
        <div className="activity__dashboard-main">
          {/* Main Chart */}
          <div className="activity-main-chart">
            <div className="activity-main-chart__header">
              <div className="activity-main-chart__header-left">
                <h3 className="activity-main-chart__title">
                  {selectedGame ? selectedGame.name : "Overview"}
                </h3>
              </div>
              <span className="activity-main-chart__subtitle">{stats.playtimeStr}</span>
            </div>

            <div className="activity-main-chart__body">
              {chartData.length === 0 ? (
                <div className="activity-main-chart__empty">No activity recorded for this period</div>
              ) : chartType === "bar" ? (
                <BarChart
                  data={chartData}
                  labels={chartLabels}
                  formatValue={(v) => `${v}h`}
                  height={220}
                  color="var(--color-brand-teal)"
                />
              ) : (
                <LineChart
                  series={[{ data: chartData, color: "var(--color-brand-teal)", label: "Playtime (Hours)" }]}
                  labels={chartLabels}
                  formatValue={(v) => `${v}h`}
                  height={220}
                  legend={false}
                />
              )}
            </div>
          </div>

          {/* Platform and Genre Donuts */}
          {!selectedGameId && (
            <>
              <div className="activity__two-column">
                <div className="section-panel">
                  <h3 className="section-panel__title">Platform Breakdown</h3>
                  {platformBreakdownSlices.length === 0 ? (
                    <div className="section-panel__empty">No platform data available</div>
                  ) : (
                    <div className="platform-breakdown__content">
                      <DonutChart slices={platformBreakdownSlices} size={150} formatValue={(v) => `${Math.round(v * 10) / 10}h`} />
                    </div>
                  )}
                </div>

                <div className="section-panel">
                  <h3 className="section-panel__title">Playtime by Genre</h3>
                  {genreBreakdownSlices.length === 0 ? (
                    <div className="section-panel__empty">No genre data available</div>
                  ) : (
                    <div className="genre-breakdown__content">
                      <DonutChart slices={genreBreakdownSlices} size={150} formatValue={(v) => `${Math.round(v * 10) / 10}h`} />
                    </div>
                  )}
                </div>
              </div>

              {/* Weekly Heatmap */}
              <div className="section-panel">
                <h3 className="section-panel__title">Weekly Activity Heatmap</h3>
                {heatmapDays.length === 0 ? (
                  <div className="section-panel__empty">No activity in this timeframe</div>
                ) : (
                  <>
                    <div className="weekly-heatmap__container">
                      <div className="weekly-heatmap__row-labels">
                        <span>Sun</span>
                        <span>Mon</span>
                        <span>Tue</span>
                        <span>Wed</span>
                        <span>Thu</span>
                        <span>Fri</span>
                        <span>Sat</span>
                      </div>
                      <div className="weekly-heatmap__grid">
                        {heatmapPaddedDays.map((day, idx) => {
                          if (!day) {
                            return <div key={`pad-${idx}`} className="weekly-heatmap__cell weekly-heatmap__cell--padded" />;
                          }
                          return (
                            <div
                              key={day.date}
                              className={`weekly-heatmap__cell ${getHeatmapIntensity(day.hours)}`}
                              title={`${day.date} · ${Math.round(day.hours * 10) / 10}h played`}
                            />
                          );
                        })}
                      </div>
                    </div>
                    <div className="weekly-heatmap__footer">
                      <span>Less</span>
                      <div className="weekly-heatmap__cell weekly-heatmap__cell--empty" />
                      <div className="weekly-heatmap__cell weekly-heatmap__cell--low" />
                      <div className="weekly-heatmap__cell weekly-heatmap__cell--medium" />
                      <div className="weekly-heatmap__cell weekly-heatmap__cell--high" />
                      <div className="weekly-heatmap__cell weekly-heatmap__cell--peak" />
                      <span>More</span>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
