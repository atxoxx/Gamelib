import { useMemo, useState } from "react";
import { type Game, type GameSession, buildSessionMetricsSeries } from "../../types/game";
import LineChart from "../charts/LineChart";
import { useActivity } from "../../context/ActivityContext";
import * as Icons from "./Icons";

/**
 * Performance tab. The headline section is four LineCharts stacked
 * vertically / in a 2-up grid:
 *
 *   - FPS       → dynamic Y-axis (a 240-cap clamps too aggressively for
 *                 360-Hz monitors, and a clamped axis would mislead on
 *                 real benchmarks). Numeric tooltip in "FPS".
 *   - CPU/GPU/RAM → FIXED minY=0 maxY=100 so 40% always reads as 40%
 *                   of chart height, regardless of session selection.
 *                   This is the bug fix for "Fps Graphs Should Use
 *                   Fixed 0-100 Scale" — comparing a 40% CPU session
 *                   against a 95% one must be visually obvious.
 *   - Temps     → FIXED minY=0 maxY=100 °C. Same rationale.
 *
 * Below the charts a per-game leaderboard table ranks the most-played
 * games by their average FPS / load / temp so users can see their top
 * performers at a glance.
 */
export function ActivityPerformance({
  sessions,
  games,
}: {
  sessions: GameSession[];
  games: Game[];
}) {
  const { getGameStats } = useActivity();

  // Sessions with usable metrics are the only data we can chart. The
  // helper sorts them oldest→newest so the x-axis timeline reads
  // naturally.
  const series = useMemo(() => buildSessionMetricsSeries(sessions), [sessions]);

  // Game picker that narrows the per-game leaderboard. The four trend
  // charts always show ALL sessions (any filtering by specific game
  // would mask the cross-game comparison the fix is meant to enable).
  const [selectedGameId, setSelectedGameId] = useState<string>("all");

  const gamesWithSessions = useMemo(() => {
    const ids = new Set(sessions.map((s) => s.gameId));
    return games.filter((g) => ids.has(g.id));
  }, [sessions, games]);

  // Per-game averages via the ActivityContext aggregate so the
  // leaderboard stays consistent with how the donut / bar charts
  // elsewhere compute their numbers.
  const leaderboard = useMemo(() => {
    const rows = gamesWithSessions.map((g) => {
      const stats = getGameStats(g.id);
      return {
        game: g,
        avgFps: stats.avgFpsAll,
        avgCpu: stats.avgCpuAll,
        avgGpu: stats.avgGpuAll,
      };
    });
    // Sort by FPS descending so the "top performers" feel comes through
    // naturally. Games without metrics just sink to the bottom.
    return rows.sort((a, b) => b.avgFps - a.avgFps);
  }, [gamesWithSessions, getGameStats]);

  // Chart series bundles. Each is one-per-chart because LineChart's X
  // axis is shared — putting multiple unrelated trends on the same
  // chart would require either dual Y-axes (which we don't have) or
  // noisy legends (we'd rather one chart = one concept).
  const fpsSeries = useMemo(
    () => [
      {
        data: series.fps,
        color: "#10b981",
        label: "FPS",
      },
    ],
    [series.fps],
  );

  const loadSeries = useMemo(
    () => [
      { data: series.cpu, color: "#3b82f6", label: "CPU" },
      { data: series.gpu, color: "#a855f7", label: "GPU" },
      { data: series.ram, color: "#f59e0b", label: "RAM" },
    ],
    [series.cpu, series.gpu, series.ram],
  );

  const tempSeries = useMemo(
    () => [
      { data: series.cpuTemp, color: "#ef4444", label: "CPU °C" },
      { data: series.gpuTemp, color: "#fb923c", label: "GPU °C" },
    ],
    [series.cpuTemp, series.gpuTemp],
  );

  const isEmpty = series.labels.length === 0;

  return (
    <div className="performance-insights">
      {isEmpty ? (
        <div className="section-panel">
          <div className="section-panel__empty">
            No performance data yet. Launch a game and play for at least a
            minute — its metrics will appear here.
          </div>
        </div>
      ) : (
        <>
          {/* ── FPS trend (dynamic Y-axis) ─────────────────────────────── */}
          <div className="section-panel">
            <div className="performance-insights__chart-header">
              <h3 className="section-panel__title performance-timeline__title">
                <Icons.Activity size={12} />
                Frames Per Second Over Time
              </h3>
              <span className="performance-timeline__game-selector-label">
                {series.labels.length} session{series.labels.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="performance-insights__chart-container">
              <LineChart
                series={fpsSeries}
                labels={series.labels}
                width={640}
                height={220}
                formatValue={(v) => `${Math.round(v)} FPS`}
                // Dynamic Y-axis: shows honest FPS even when value
                // exceeds a fixed cap (e.g. 360 Hz monitor).
              />
            </div>
          </div>

          {/* ── CPU/GPU/RAM trend (FIXED 0-100) ────────────────────────── */}
          <div className="section-panel">
            <div className="performance-insights__chart-header">
              <h3 className="section-panel__title performance-timeline__title">
                <Icons.Cpu size={12} />
                System Load (CPU · GPU · RAM)
              </h3>
              <span className="performance-timeline__game-selector-label">
                Fixed 0-100 % scale
              </span>
            </div>
            <div className="performance-insights__chart-container">
              <LineChart
                series={loadSeries}
                labels={series.labels}
                width={640}
                height={220}
                minY={0}
                maxY={100}
                formatValue={(v) => `${v.toFixed(0)}%`}
                formatTooltipValue={(v) => (
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>
                    {v.toFixed(1)}%
                  </span>
                )}
                fillOpacity={0.06}
              />
            </div>
          </div>

          {/* ── Temperatures trend (FIXED 0-100 °C) ────────────────────── */}
          <div className="section-panel">
            <div className="performance-insights__chart-header">
              <h3 className="section-panel__title performance-timeline__title">
                <Icons.Thermometer size={12} />
                Temperatures (CPU · GPU)
              </h3>
              <span className="performance-timeline__game-selector-label">
                Fixed 0-100 °C scale
              </span>
            </div>
            <div className="performance-insights__chart-container">
              <LineChart
                series={tempSeries}
                labels={series.labels}
                width={640}
                height={220}
                minY={0}
                maxY={100}
                formatValue={(v) => `${v.toFixed(0)}°C`}
                formatTooltipValue={(v) => (
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>
                    {v.toFixed(0)}°C
                  </span>
                )}
                fillOpacity={0.06}
              />
            </div>
          </div>
        </>
      )}

      {/* ── Per-game leaderboard ──────────────────────────────────────── */}
      <div className="section-panel">
        <div className="performance-insights__chart-header">
          <h3 className="section-panel__title performance-timeline__title">
            <Icons.BarChart3 size={12} />
            Game Performance Breakdown
          </h3>
          <div className="performance-timeline__game-selector">
            <label
              htmlFor="perf-game-select"
              className="performance-timeline__game-selector-label"
            >
              Game:
            </label>
            <select
              id="perf-game-select"
              className="performance-timeline__game-select"
              value={selectedGameId}
              onChange={(e) => setSelectedGameId(e.target.value)}
            >
              <option value="all">All</option>
              {gamesWithSessions.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="performance-insights__table-wrapper">
          <table className="performance-insights__table">
            <thead>
              <tr>
                <th>Game</th>
                <th>Avg FPS</th>
                <th>Avg CPU</th>
                <th>Avg GPU</th>
                <th>Sessions</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.length === 0 ? (
                <tr>
                  <td colSpan={5} className="section-panel__empty">
                    No per-game metrics available.
                  </td>
                </tr>
              ) : (
                leaderboard
                  .filter(
                    (row) =>
                      selectedGameId === "all" || row.game.id === selectedGameId,
                  )
                  .map((row) => {
                    const gameSessions = sessions.filter(
                      (s) => s.gameId === row.game.id,
                    );
                    return (
                      <tr key={row.game.id}>
                        <td>
                          <div className="performance-insights__game-cell">
                            {row.game.iconUrl ? (
                              <img
                                src={row.game.iconUrl}
                                alt={row.game.name}
                                className="performance-insights__game-icon"
                              />
                            ) : (
                              <div className="performance-insights__game-icon-placeholder" />
                            )}
                            <span className="performance-insights__game-title">
                              {row.game.name}
                            </span>
                          </div>
                        </td>
                        <td
                          className={
                            row.avgFps >= 90 ? "text-high-fps" : undefined
                          }
                        >
                          {row.avgFps > 0 ? row.avgFps : "—"}
                        </td>
                        <td>{formatPercent(row.avgCpu)}</td>
                        <td>{formatPercent(row.avgGpu)}</td>
                        <td>{gameSessions.length}</td>
                      </tr>
                    );
                  })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/**
 * Format a 0-100 percentage for the leaderboard. Falls back to "—" when
 * the aggregate is 0 (which happens when a game has no metrics-bearing
 * sessions so we shouldn't fabricate "0.0%" on screen).
 */
function formatPercent(value: number): string {
  if (!value || value <= 0) return "—";
  // 0 decimal places for table cells — they're already wide enough that
  // 1 decimal would be visual clutter.
  return `${value.toFixed(0)}%`;
}
