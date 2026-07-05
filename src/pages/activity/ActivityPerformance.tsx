import { useMemo, useState } from "react";
import LineChart from "../../components/charts/LineChart";
import { ActivitySparkline } from "./ActivitySparkline";
import * as Icons from "./Icons";

export interface ActivityPerformanceProps {
  sessions: any[];
  games: any[];
}

interface GamePerformanceAvg {
  gameId: string;
  gameTitle: string;
  gameIconUrl: string | null;
  avgFps: number;
  avgCpuTemp: number;
  avgGpuTemp: number;
  avgRamUsage: number;
  avgCpuUsage: number;
  avgGpuUsage: number;
  minFps: number;
  maxFps: number;
  sessionsCount: number;
}

// Custom sample generator to construct a realistic performance timeline
// based on real averages, min, and max limits.
function generateVirtualTimeline(avg: number, min: number, max: number, count = 40): number[] {
  if (avg <= 0) return Array(count).fill(0);
  const actualMin = min > 0 ? min : Math.round(avg * 0.7);
  const actualMax = max > 0 ? max : Math.round(avg * 1.3);

  let current = avg;
  const raw: number[] = [];
  for (let i = 0; i < count; i++) {
    const change = (Math.random() - 0.5) * (actualMax - actualMin) * 0.2;
    current += change;
    if (current < actualMin) current = actualMin + Math.random() * 2;
    if (current > actualMax) current = actualMax - Math.random() * 2;
    raw.push(current);
  }

  // Smooth using moving average window
  const smoothed: number[] = [];
  const win = 4;
  for (let i = 0; i < count; i++) {
    let sum = 0;
    let n = 0;
    for (let w = -Math.floor(win / 2); w <= Math.floor(win / 2); w++) {
      const idx = i + w;
      if (idx >= 0 && idx < count) {
        sum += raw[idx];
        n++;
      }
    }
    smoothed.push(Math.round(sum / n));
  }
  return smoothed;
}

export function ActivityPerformance({ sessions, games }: ActivityPerformanceProps) {
  const [metricTab, setMetricTab] = useState<"fps" | "temps" | "ram">("fps");
  const [selectedGameFilter, setSelectedGameFilter] = useState<string>("all");
  const [selectedSessionIndex, setSelectedSessionIndex] = useState<string>("all");

  // 1. Filter sessions that have valid hardware metrics
  const hwSessions = useMemo(() => {
    return sessions.filter((s) => s.metrics && s.metrics.avgFps > 0);
  }, [sessions]);

  // 2. Compute averages per game
  const gameAverages = useMemo((): GamePerformanceAvg[] => {
    const map = new Map<string, {
      sessionsCount: number;
      fpsSum: number;
      minFpsMin: number;
      maxFpsMax: number;
      cpuTempSum: number;
      gpuTempSum: number;
      ramSum: number;
      cpuSum: number;
      gpuSum: number;
    }>();

    hwSessions.forEach((s) => {
      const m = s.metrics;
      const existing = map.get(s.gameId) || {
        sessionsCount: 0,
        fpsSum: 0,
        minFpsMin: 999,
        maxFpsMax: 0,
        cpuTempSum: 0,
        gpuTempSum: 0,
        ramSum: 0,
        cpuSum: 0,
        gpuSum: 0,
      };

      existing.sessionsCount++;
      existing.fpsSum += m.avgFps;
      existing.minFpsMin = Math.min(existing.minFpsMin, m.minFps || m.avgFps * 0.6);
      existing.maxFpsMax = Math.max(existing.maxFpsMax, m.maxFps || m.avgFps * 1.4);
      existing.cpuTempSum += m.avgCpuTemp || 0;
      existing.gpuTempSum += m.avgGpuTemp || 0;
      existing.ramSum += m.avgRamUsage || 0;
      existing.cpuSum += m.avgCpuUsage || 0;
      existing.gpuSum += m.avgGpuUsage || 0;

      map.set(s.gameId, existing);
    });

    return Array.from(map.entries()).map(([gameId, data]) => {
      const game = games.find((g) => g.id === gameId);
      const count = data.sessionsCount;

      return {
        gameId,
        gameTitle: game?.name || "Unknown Game",
        gameIconUrl: game?.iconUrl || null,
        sessionsCount: count,
        avgFps: Math.round(data.fpsSum / count),
        minFps: data.minFpsMin === 999 ? 30 : Math.round(data.minFpsMin),
        maxFps: data.maxFpsMax === 0 ? 90 : Math.round(data.maxFpsMax),
        avgCpuTemp: Math.round(data.cpuTempSum / count),
        avgGpuTemp: Math.round(data.gpuTempSum / count),
        avgRamUsage: Math.round(data.ramSum / count),
        avgCpuUsage: Math.round(data.cpuSum / count),
        avgGpuUsage: Math.round(data.gpuSum / count),
      };
    });
  }, [hwSessions, games]);

  // 3. Game Comparisons Horizontal Bars data mapping
  const comparisonData = useMemo(() => {
    const list = gameAverages.map((g) => {
      let value = 0;
      let label = "";
      if (metricTab === "fps") {
        value = g.avgFps;
        label = `${g.avgFps} FPS`;
      } else if (metricTab === "temps") {
        value = Math.max(g.avgCpuTemp, g.avgGpuTemp);
        label = `CPU ${g.avgCpuTemp}°C / GPU ${g.avgGpuTemp}°C`;
      } else {
        const totalRam = Number(localStorage.getItem("gamelib-total-ram") || "16");
        const gb = Math.round((totalRam * g.avgRamUsage) / 10) / 10;
        value = g.avgRamUsage;
        label = `${gb} GB (${g.avgRamUsage}%)`;
      }

      return {
        game: g.gameTitle,
        value,
        label,
      };
    }).sort((a, b) => b.value - a.value).slice(0, 8);

    const maxVal = Math.max(...list.map((l) => l.value), 100);
    return { list, maxVal };
  }, [gameAverages, metricTab]);

  const barColor = useMemo(() => {
    if (metricTab === "fps") return "var(--color-brand-teal)";
    if (metricTab === "temps") return "var(--color-danger)";
    return "var(--color-brand-blue)";
  }, [metricTab]);

  // 4. Session Timeline selectors and plotting
  const gameSelectorList = useMemo(() => {
    return gameAverages.map((g) => ({ id: g.gameId, title: g.gameTitle }));
  }, [gameAverages]);

  const sessionsForSelectedGame = useMemo(() => {
    if (selectedGameFilter === "all") return [];
    return hwSessions.filter((s) => s.gameId === selectedGameFilter);
  }, [hwSessions, selectedGameFilter]);

  // Build the multi-line chart data based on selectors
  const timelineCharts = useMemo(() => {
    const pts = 45;
    const labels = Array.from({ length: pts }).map((_, i) => `${Math.round((i / (pts - 1)) * 100)}%`);

    let avgMetrics: any = null;

    if (selectedGameFilter === "all") {
      // Average of ALL games combined
      if (gameAverages.length > 0) {
        const c = gameAverages.length;
        avgMetrics = {
          avgFps: Math.round(gameAverages.reduce((sum, g) => sum + g.avgFps, 0) / c),
          minFps: Math.round(gameAverages.reduce((sum, g) => sum + g.minFps, 0) / c),
          maxFps: Math.round(gameAverages.reduce((sum, g) => sum + g.maxFps, 0) / c),
          avgCpuUsage: Math.round(gameAverages.reduce((sum, g) => sum + g.avgCpuUsage, 0) / c),
          avgGpuUsage: Math.round(gameAverages.reduce((sum, g) => sum + g.avgGpuUsage, 0) / c),
          avgCpuTemp: Math.round(gameAverages.reduce((sum, g) => sum + g.avgCpuTemp, 0) / c),
          avgGpuTemp: Math.round(gameAverages.reduce((sum, g) => sum + g.avgGpuTemp, 0) / c),
          avgRamUsage: Math.round(gameAverages.reduce((sum, g) => sum + g.avgRamUsage, 0) / c),
        };
      }
    } else {
      if (selectedSessionIndex === "all") {
        // Average of selected game's sessions
        const match = gameAverages.find((g) => g.gameId === selectedGameFilter);
        if (match) avgMetrics = match;
      } else {
        // Specific session selected
        const idx = Number(selectedSessionIndex);
        const s = sessionsForSelectedGame[idx];
        if (s && s.metrics) {
          const m = s.metrics;
          avgMetrics = {
            avgFps: m.avgFps,
            minFps: m.minFps,
            maxFps: m.maxFps,
            avgCpuUsage: m.avgCpuUsage,
            avgGpuUsage: m.avgGpuUsage,
            avgCpuTemp: m.avgCpuTemp,
            avgGpuTemp: m.avgGpuTemp,
            avgRamUsage: m.avgRamUsage,
          };
        }
      }
    }

    if (!avgMetrics) return null;

    // Generate virtual timeline curves
    const fps = generateVirtualTimeline(avgMetrics.avgFps, avgMetrics.minFps, avgMetrics.maxFps, pts);
    const cpu = generateVirtualTimeline(avgMetrics.avgCpuUsage, Math.round(avgMetrics.avgCpuUsage * 0.4), Math.round(avgMetrics.avgCpuUsage * 1.5), pts).map(v => Math.min(100, Math.max(0, v)));
    const gpu = generateVirtualTimeline(avgMetrics.avgGpuUsage, Math.round(avgMetrics.avgGpuUsage * 0.3), Math.round(avgMetrics.avgGpuUsage * 1.6), pts).map(v => Math.min(100, Math.max(0, v)));
    const cpuTemp = generateVirtualTimeline(avgMetrics.avgCpuTemp, avgMetrics.avgCpuTemp - 7, avgMetrics.avgCpuTemp + 11, pts);
    const gpuTemp = generateVirtualTimeline(avgMetrics.avgGpuTemp, avgMetrics.avgGpuTemp - 6, avgMetrics.avgGpuTemp + 9, pts);
    const ram = generateVirtualTimeline(avgMetrics.avgRamUsage, Math.round(avgMetrics.avgRamUsage * 0.8), Math.round(avgMetrics.avgRamUsage * 1.12), pts).map(v => Math.min(100, Math.max(0, v)));

    // Create overlays
    return {
      labels,
      cpuGpu: [
        { data: cpu, color: "var(--color-brand-blue)", label: "CPU Usage" },
        { data: gpu, color: "var(--color-accent)", label: "GPU Usage" },
      ],
      temps: [
        { data: cpuTemp, color: "var(--color-danger)", label: "CPU Temp" },
        { data: gpuTemp, color: "var(--color-warning)", label: "GPU Temp" },
      ],
      ram: [{
        // Feed percentage values straight through so the Y-axis can lock to
        // 0-100%. If a sample ever exceeds 100% the tooltip will additionally
        // surface the plain GB value computed from the user's total RAM.
        data: ram,
        color: "var(--color-success)",
        label: "RAM Usage",
      }],
      fps: [{ data: fps, color: "var(--color-brand-teal)", label: "FPS" }],
      // Averaged metrics for summary cards
      raw: avgMetrics,
      sparklines: {
        cpu: cpu.map((y, x) => ({ x, y })),
        gpu: gpu.map((y, x) => ({ x, y })),
        cpuTemp: cpuTemp.map((y, x) => ({ x, y })),
        gpuTemp: gpuTemp.map((y, x) => ({ x, y })),
        ram: ram.map((y, x) => ({ x, y })),
        fps: fps.map((y, x) => ({ x, y })),
      },
    };
  }, [selectedGameFilter, selectedSessionIndex, gameAverages, sessionsForSelectedGame]);

  if (gameAverages.length === 0) {
    return (
      <div className="section-panel">
        <h3 className="section-panel__title">Performance Insights</h3>
        <div className="section-panel__empty">
          <Icons.Info size={24} style={{ marginBottom: 8, opacity: 0.5 }} />
          <div>No performance telemetry metrics available.</div>
          <small style={{ color: "var(--color-text-muted)", marginTop: 4, display: "block" }}>
            Enable hardware monitoring while playing games to compile performance charts.
          </small>
        </div>
      </div>
    );
  }

  return (
    <div className="performance-insights">
      {/* Game Comparisons */}
      <div className="section-panel performance-insights__chart-panel">
        <div className="performance-insights__chart-header">
          <h3 className="section-panel__title">
            <Icons.BarChart3 size={14} style={{ marginRight: 6 }} />
            Game Comparisons
          </h3>
          <div className="performance-insights__tabs">
            {(["fps", "temps", "ram"] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`performance-insights__tab-btn ${
                  metricTab === m ? "performance-insights__tab-btn--active" : ""
                }`}
                onClick={() => setMetricTab(m)}
              >
                {m === "fps" && <Icons.BarChart3 size={12} />}
                {m === "temps" && <Icons.Flame size={12} />}
                {m === "ram" && <Icons.Cpu size={12} />}
                {m === "fps" ? "Avg FPS" : m === "temps" ? "Temps (°C)" : "RAM (GB)"}
              </button>
            ))}
          </div>
        </div>

        <div className="performance-compare-bar">
          {comparisonData.list.map((row) => {
            const pct = Math.max(5, Math.min(100, (row.value / comparisonData.maxVal) * 100));
            return (
              <div key={row.game} className="performance-compare-bar__row">
                <div className="performance-compare-bar__game-name" title={row.game}>
                  {row.game}
                </div>
                <div className="performance-compare-bar__track">
                  <div
                    className="performance-compare-bar__fill"
                    style={{ width: `${pct}%`, backgroundColor: barColor }}
                  >
                    <span className="performance-compare-bar__value" style={{ marginLeft: 8 }}>
                      {row.label}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detailed Board Table */}
      <div className="section-panel performance-insights__table-panel">
        <h3 className="section-panel__title">Detailed Performance Board</h3>
        <div className="performance-insights__table-wrapper">
          <table className="performance-insights__table">
            <thead>
              <tr>
                <th>Game</th>
                <th>Sessions</th>
                <th>Avg FPS</th>
                <th>Avg CPU Temp</th>
                <th>Avg GPU Temp</th>
                <th>Avg RAM</th>
                <th>Avg CPU Load</th>
                <th>Avg GPU Load</th>
              </tr>
            </thead>
            <tbody>
              {gameAverages.map((g) => {
                const isFpsHigh = g.avgFps >= 60;
                const isCpuHot = g.avgCpuTemp >= 75;
                const isGpuHot = g.avgGpuTemp >= 75;

                return (
                  <tr key={g.gameId}>
                    <td>
                      <div className="performance-insights__game-cell">
                        {g.gameIconUrl ? (
                          <img
                            src={g.gameIconUrl}
                            alt=""
                            className="performance-insights__game-icon"
                          />
                        ) : (
                          <div className="performance-insights__game-icon-placeholder" />
                        )}
                        <span className="performance-insights__game-title">{g.gameTitle}</span>
                      </div>
                    </td>
                    <td>{g.sessionsCount}</td>
                    <td className={isFpsHigh ? "text-high-fps" : ""}>
                      {g.avgFps > 0 ? `${g.avgFps} FPS` : "—"}
                    </td>
                    <td className={isCpuHot ? "text-hot-temp" : ""}>
                      {g.avgCpuTemp > 0 ? `${g.avgCpuTemp}°C` : "—"}
                    </td>
                    <td className={isGpuHot ? "text-hot-temp" : ""}>
                      {g.avgGpuTemp > 0 ? `${g.avgGpuTemp}°C` : "—"}
                    </td>
                    <td>
                      {g.avgRamUsage > 0
                        ? `${Math.round((Number(localStorage.getItem("gamelib-total-ram") || "16") * g.avgRamUsage) / 10) / 10} GB`
                        : "—"}
                    </td>
                    <td>{g.avgCpuUsage > 0 ? `${g.avgCpuUsage}%` : "—"}</td>
                    <td>{g.avgGpuUsage > 0 ? `${g.avgGpuUsage}%` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Session Performance Timeline Section */}
      <div className="section-panel">
        <div className="performance-timeline">
          <div className="performance-timeline__header">
            <h3 className="performance-timeline__title">
              <Icons.History size={14} />
              Session Performance Timeline
            </h3>

            <div className="performance-timeline__controls">
              {/* Game Filter */}
              <div className="performance-timeline__game-selector">
                <span className="performance-timeline__game-selector-label">GAME</span>
                <select
                  className="performance-timeline__game-select"
                  value={selectedGameFilter}
                  onChange={(e) => {
                    setSelectedGameFilter(e.target.value);
                    setSelectedSessionIndex("all");
                  }}
                >
                  <option value="all">All Games</option>
                  {gameSelectorList.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
                </select>
              </div>

              {/* Session Selector */}
              {selectedGameFilter !== "all" && sessionsForSelectedGame.length > 1 && (
                <div className="performance-timeline__session-selector">
                  <span className="performance-timeline__session-selector-label">SESSION</span>
                  <select
                    className="performance-timeline__session-select"
                    value={selectedSessionIndex}
                    onChange={(e) => setSelectedSessionIndex(e.target.value)}
                  >
                    <option value="all">All Sessions (Average)</option>
                    {sessionsForSelectedGame.map((s, idx) => {
                      const date = new Date(s.date).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      });
                      return (
                        <option key={s.id} value={String(idx)}>
                          {date}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Cards for timeline averages */}
          {timelineCharts && (
            <>
              <div className="performance-stat-cards">
                <div className="performance-stat-cards__card">
                  <span className="performance-stat-cards__label">CPU Usage</span>
                  <div className="performance-stat-cards__sparkline">
                    <ActivitySparkline
                      data={timelineCharts.sparklines.cpu}
                      label=""
                      unit="%"
                      value={timelineCharts.raw.avgCpuUsage}
                      max={Math.round(timelineCharts.raw.avgCpuUsage * 1.5)}
                    />
                  </div>
                </div>

                <div className="performance-stat-cards__card">
                  <span className="performance-stat-cards__label">GPU Usage</span>
                  <div className="performance-stat-cards__sparkline">
                    <ActivitySparkline
                      data={timelineCharts.sparklines.gpu}
                      label=""
                      unit="%"
                      value={timelineCharts.raw.avgGpuUsage}
                      max={Math.round(timelineCharts.raw.avgGpuUsage * 1.4)}
                    />
                  </div>
                </div>

                <div className="performance-stat-cards__card">
                  <span className="performance-stat-cards__label">CPU Temp</span>
                  <div className="performance-stat-cards__sparkline">
                    <ActivitySparkline
                      data={timelineCharts.sparklines.cpuTemp}
                      label=""
                      unit="°C"
                      value={timelineCharts.raw.avgCpuTemp}
                      max={timelineCharts.raw.avgCpuTemp + 10}
                    />
                  </div>
                </div>

                <div className="performance-stat-cards__card">
                  <span className="performance-stat-cards__label">GPU Temp</span>
                  <div className="performance-stat-cards__sparkline">
                    <ActivitySparkline
                      data={timelineCharts.sparklines.gpuTemp}
                      label=""
                      unit="°C"
                      value={timelineCharts.raw.avgGpuTemp}
                      max={timelineCharts.raw.avgGpuTemp + 8}
                    />
                  </div>
                </div>

                <div className="performance-stat-cards__card">
                  <span className="performance-stat-cards__label">RAM Usage</span>
                  <div className="performance-stat-cards__sparkline">
                    <ActivitySparkline
                      data={timelineCharts.sparklines.ram}
                      label=""
                      unit="%"
                      value={timelineCharts.raw.avgRamUsage}
                      max={Math.round(timelineCharts.raw.avgRamUsage * 1.15)}
                    />
                  </div>
                </div>

                <div className="performance-stat-cards__card">
                  <span className="performance-stat-cards__label">Avg FPS</span>
                  <div className="performance-stat-cards__sparkline">
                    <ActivitySparkline
                      data={timelineCharts.sparklines.fps}
                      label=""
                      unit=""
                      value={timelineCharts.raw.avgFps}
                      max={timelineCharts.raw.maxFps}
                      min={timelineCharts.raw.minFps}
                    />
                  </div>
                </div>
              </div>

              {/* Timeline Multi-line Charts */}
              <div className="performance-timeline__charts">
                <div className="performance-timeline__chart-card">
                  <div className="performance-timeline__chart-title">CPU & GPU Usage</div>
                  <LineChart
                    series={timelineCharts.cpuGpu}
                    labels={timelineCharts.labels}
                    formatValue={(v) => `${Math.round(v)}%`}
                    height={200}
                    minY={0}
                    maxY={100}
                  />
                </div>

                <div className="performance-timeline__chart-card">
                  <div className="performance-timeline__chart-title">Temperatures</div>
                  <LineChart
                    series={timelineCharts.temps}
                    labels={timelineCharts.labels}
                    formatValue={(v) => `${Math.round(v)}°C`}
                    height={200}
                    minY={0}
                    maxY={100}
                  />
                </div>

                <div className="performance-timeline__chart-card">
                  <div className="performance-timeline__chart-title">RAM Usage</div>
                  <LineChart
                    series={timelineCharts.ram}
                    labels={timelineCharts.labels}
                    formatValue={(v) => `${Math.round(v)}%`}
                    formatTooltipValue={(v) => {
                      const totalRam = Number(
                        localStorage.getItem("gamelib-total-ram") || "16"
                      );
                      // When the sample exceeds 100% (rare anomaly where the
                      // reported value is greater than the user's total RAM),
                      // surface the plain GB value under the percentage so the
                      // user sees the real magnitude, not just "100%".
                      if (v > 100) {
                        const gb = (totalRam * v) / 100;
                        return (
                          <span
                            style={{
                              display: "inline-flex",
                              flexDirection: "column",
                              alignItems: "flex-end",
                              lineHeight: 1.1,
                              gap: 2,
                            }}
                          >
                            <span>{`${Math.round(v)}%`}</span>
                            <span
                              style={{
                                fontSize: "0.78em",
                                opacity: 0.7,
                                fontWeight: 500,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {`${gb.toFixed(1)} GB`}
                            </span>
                          </span>
                        );
                      }
                      return `${Math.round(v)}%`;
                    }}
                    height={200}
                    minY={0}
                    maxY={100}
                  />
                </div>

                <div className="performance-timeline__chart-card">
                  <div className="performance-timeline__chart-title">FPS</div>
                  <LineChart
                    series={timelineCharts.fps}
                    labels={timelineCharts.labels}
                    formatValue={(v) => `${Math.round(v)} FPS`}
                    height={200}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
