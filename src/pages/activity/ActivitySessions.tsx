import { useMemo, useState, type ComponentProps } from "react";
import LineChart from "../../components/charts/LineChart";
import { ActivitySparkline } from "./ActivitySparkline";
import { GameThumbnail } from "./GameThumbnail";
import SteamPlayerCount from "../../components/SteamPlayerCount";
import { useSteamAppId } from "../../hooks/useSteamAppId";
import { useSettings } from "../../context/SettingsContext";
import { useActivity } from "../../context/ActivityContext";
import { buildSingleSessionSeries } from "../../utils/perfSamples";
import { formatTemp, toDisplayTemp, toDisplayTemps, tempUnitLabel, tempThreshold, tempMinY, tempMaxY } from "../../utils/temp";
import * as Icons from "./Icons";

export interface ActivitySessionsProps {
  sessions: any[];
  games: any[];
  onDeleteSession: (id: string) => void;
}

// Custom sample generator to construct a realistic performance timeline
// based on real averages, min, and max limits.
function generateVirtualSamples(avg: number, min: number, max: number, count = 40): number[] {
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

interface SessionItemProps {
  session: any;
  game: any;
  onDelete: (id: string) => void;
}

function ActivitySessionItem({ session, game, onDelete }: SessionItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeChartTab, setActiveChartTab] = useState<"usage" | "temps" | "ram" | "fps">("usage");
  const { tempUnit } = useSettings();
  const { totalRamGb } = useActivity();

  // Resolve the Steam appid for this session's game. The hook also
  // persists successful lookups back onto the library row via
  // updateGame, so the second session for the same game loads
  // instantly without a Steam round-trip.
  const { appId: resolvedSteamAppId } = useSteamAppId(game ?? null);
  const steamAppId =
    typeof resolvedSteamAppId === "number"
      ? resolvedSteamAppId
      : game?.steamAppId ?? null;

  const durationMs = session.durationMin * 60 * 1000;

  const formattedDate = useMemo(() => {
    const d = new Date(session.date);
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }, [session.date]);

  const formattedTime = useMemo(() => {
    const d = new Date(session.date);
    const start = new Date(d.getTime() - durationMs);
    const fmt = (date: Date) => date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `${fmt(start)} - ${fmt(d)}`;
  }, [session.date, durationMs]);

  const formattedDuration = useMemo(() => {
    const h = Math.floor(session.durationMin / 60);
    const m = session.durationMin % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }, [session.durationMin]);

  // Build real hardware sample logs for chart overlays. Prefer the
  // per-sample telemetry captured during the session (metrics.samples);
  // when a session has no real samples (legacy / synthetic recordings) we
  // fall back to reconstructing a plausible curve from the recorded
  // averages so the timeline still renders something coherent.
  const chartProps = useMemo(() => {
    if (!session.metrics) return null;
    const m = session.metrics;
    const pts = 45;

    const real = buildSingleSessionSeries(m, pts);
    let fps: number[], cpu: number[], gpu: number[], cpuTemp: number[], gpuTemp: number[], ram: number[];

    if (real) {
      fps = real.fps;
      cpu = real.cpu;
      gpu = real.gpu;
      cpuTemp = real.cpuTemp;
      gpuTemp = real.gpuTemp;
      ram = real.ram;
    } else {
      fps = generateVirtualSamples(m.avgFps, m.minFps, m.maxFps, pts);
      cpu = generateVirtualSamples(m.avgCpuUsage, Math.round(m.avgCpuUsage * 0.4), Math.round(m.avgCpuUsage * 1.5), pts).map(v => Math.min(100, Math.max(0, v)));
      gpu = generateVirtualSamples(m.avgGpuUsage, Math.round(m.avgGpuUsage * 0.3), Math.round(m.avgGpuUsage * 1.6), pts).map(v => Math.min(100, Math.max(0, v)));
      cpuTemp = generateVirtualSamples(m.avgCpuTemp, m.avgCpuTemp - 7, m.avgCpuTemp + 11, pts);
      gpuTemp = generateVirtualSamples(m.avgGpuTemp, m.avgGpuTemp - 6, m.avgGpuTemp + 9, pts);
      ram = generateVirtualSamples(m.avgRamUsage, Math.round(m.avgRamUsage * 0.8), Math.round(m.avgRamUsage * 1.15), pts).map(v => Math.min(100, Math.max(0, v)));
    }

    // Labels represent timeline progress
    const labels = Array.from({ length: pts }).map((_, i) => `${Math.round((i / (pts - 1)) * 100)}%`);

    return { fps, cpu, gpu, cpuTemp, gpuTemp, ram, labels, real: !!real };
  }, [session.metrics]);

  const chartSeries = useMemo(() => {
    if (!chartProps) return [];
    if (activeChartTab === "usage") {
      return [
        { data: chartProps.cpu, color: "var(--color-brand-blue)", label: "CPU Load" },
        { data: chartProps.gpu, color: "var(--color-accent)", label: "GPU Load" },
      ];
    } else if (activeChartTab === "temps") {
      return [
        { data: toDisplayTemps(chartProps.cpuTemp, tempUnit), color: "var(--color-danger)", label: `CPU Temp` },
        { data: toDisplayTemps(chartProps.gpuTemp, tempUnit), color: "var(--color-warning)", label: `GPU Temp` },
      ];
    } else if (activeChartTab === "ram") {
      // Read total system RAM from the activity context (no localStorage).
      const totalRam = totalRamGb || 16;
      const ramGb = chartProps.ram.map((v) => Math.round((totalRam * v) / 10) / 10);
      return [{ data: ramGb, color: "var(--color-success)", label: "RAM Usage" }];
    } else {
      return [{ data: chartProps.fps, color: "var(--color-brand-teal)", label: "FPS" }];
    }
  }, [chartProps, activeChartTab, tempUnit]);

  const yValFormatter = (val: number) => {
    if (activeChartTab === "usage") return `${Math.round(val)}%`;
    if (activeChartTab === "temps") return formatTemp(val, tempUnit);
    if (activeChartTab === "ram") return `${val.toFixed(1)} GB`;
    return `${Math.round(val)} FPS`;
  };

  // Per-tab chart refinements: smoothing plus reference lines / hot-zone bands.
  const chartExtra = useMemo<Partial<ComponentProps<typeof LineChart>>>(() => {
    if (activeChartTab === "usage") {
      return {
        smooth: true,
        minY: 0,
        maxY: 100,
        thresholds: [{ value: 90, label: "High 90%", color: "var(--color-warning)" }],
      };
    }
    if (activeChartTab === "temps") {
      return {
        smooth: true,
        minY: tempMinY(tempUnit),
        maxY: tempMaxY(tempUnit),
        bands: [
          { from: tempThreshold(85, tempUnit), to: tempMaxY(tempUnit), color: "var(--color-danger)", opacity: 0.1 },
        ],
        thresholds: [
          { value: tempThreshold(75, tempUnit), label: "Warm 75°", color: "var(--color-warning)" },
          { value: tempThreshold(85, tempUnit), label: "Hot 85°", color: "var(--color-danger)" },
        ],
      };
    }
    if (activeChartTab === "ram") {
      return { smooth: true, niceMax: true };
    }
    return {
      smooth: true,
      minY: 0,
      niceMax: true,
      thresholds: [{ value: 60, label: "60 FPS", color: "var(--color-success)" }],
    };
  }, [activeChartTab, tempUnit]);

  // Build sparkline structures
  const sparklineData = useMemo(() => {
    if (!chartProps) return null;
    const formatSpark = (arr: number[]) => arr.map((y, x) => ({ x, y }));
    return {
      cpu: formatSpark(chartProps.cpu),
      gpu: formatSpark(chartProps.gpu),
      cpuTemp: formatSpark(chartProps.cpuTemp),
      gpuTemp: formatSpark(chartProps.gpuTemp),
      ram: formatSpark(chartProps.ram),
      fps: formatSpark(chartProps.fps),
    };
  }, [chartProps]);

  return (
    <div className={`activity-session-item ${isExpanded ? "activity-session-item--expanded" : ""}`}>
      {/* Header Row */}
      <div className="activity-session-item__row" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="activity-session-item__header-left">
          <span className="activity-session-item__chevron">
            {isExpanded ? <Icons.ChevronUp size={14} /> : <Icons.ChevronDown size={14} />}
          </span>
          <div className="activity-session-item__game-icon-container">
            <GameThumbnail
              iconUrl={game?.iconUrl}
              coverArtUrl={game?.coverArtUrl}
              steamAppId={steamAppId}
              name={session.gameName}
              className="activity-session-item__game-icon"
            />
            {steamAppId != null ? (
              <div
                className="activity-session-item__player-chip"
                aria-hidden={false}
              >
                <SteamPlayerCount
                  appId={steamAppId}
                  className="activity-session-item__player-chip-badge"
                />
              </div>
            ) : null}
          </div>
          <div className="activity-session-item__info">
            <span className="activity-session-item__date">{session.gameName}</span>
            <span className="activity-session-item__time">
              {formattedDate} · {formattedTime}
            </span>
          </div>
        </div>

        <div className="activity-session-item__header-right">
          <span className="activity-session-item__duration">{formattedDuration}</span>
          <button
            type="button"
            className="activity-session-item__delete-btn"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(session.id);
            }}
            title="Delete session"
          >
            <Icons.Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Expanded Accordion Body */}
      {isExpanded && (
        <div className="activity-session-item__collapsible">
          {session.metrics && sparklineData ? (
            <div className="activity-hardware-card">
              <h4 className="activity-hardware-card__title">Hardware Telemetry Summary</h4>
              <div className="activity-hardware-card__metrics">
                <ActivitySparkline
                  data={sparklineData.cpu}
                  label="CPU Usage"
                  unit="%"
                  value={session.metrics.avgCpuUsage}
                  max={Math.round(session.metrics.avgCpuUsage * 1.5)}
                  thresholds={{ warn: 70, danger: 90 }}
                />

                <ActivitySparkline
                  data={sparklineData.gpu}
                  label="GPU Usage"
                  unit="%"
                  value={session.metrics.avgGpuUsage}
                  max={Math.round(session.metrics.avgGpuUsage * 1.4)}
                  thresholds={{ warn: 70, danger: 90 }}
                />

                <ActivitySparkline
                  data={sparklineData.cpuTemp.map((p) => ({ ...p, y: toDisplayTemp(p.y, tempUnit) }))}
                  label="CPU Temperature"
                  unit={tempUnitLabel(tempUnit)}
                  value={toDisplayTemp(session.metrics.avgCpuTemp, tempUnit)}
                  max={toDisplayTemp(session.metrics.avgCpuTemp + 10, tempUnit)}
                  thresholds={{ warn: tempThreshold(75, tempUnit), danger: tempThreshold(85, tempUnit) }}
                />

                <ActivitySparkline
                  data={sparklineData.gpuTemp.map((p) => ({ ...p, y: toDisplayTemp(p.y, tempUnit) }))}
                  label="GPU Temperature"
                  unit={tempUnitLabel(tempUnit)}
                  value={toDisplayTemp(session.metrics.avgGpuTemp, tempUnit)}
                  max={toDisplayTemp(session.metrics.avgGpuTemp + 8, tempUnit)}
                  thresholds={{ warn: tempThreshold(75, tempUnit), danger: tempThreshold(85, tempUnit) }}
                />

                <ActivitySparkline
                  data={sparklineData.ram}
                  label="RAM Load"
                  unit="%"
                  value={session.metrics.avgRamUsage}
                  max={Math.round(session.metrics.avgRamUsage * 1.15)}
                />

                <ActivitySparkline
                  data={sparklineData.fps}
                  label="FPS"
                  unit=""
                  value={session.metrics.avgFps}
                  max={session.metrics.maxFps}
                  min={session.metrics.minFps}
                  thresholds={{ warn: 60, danger: 30 }}
                  inverted
                />
              </div>

              {/* Performance Timeline Charts */}
              {chartProps && (
                <div className="activity-session-item__chart-section">
                  <div className="activity-session-item__chart-header">
                    <div className="activity-session-item__chart-title">
                      <Icons.BarChart3 size={12} />
                      Performance Timeline
                      {!chartProps.real && (
                        <span
                          className="activity-session-item__chart-estimated"
                          title="No per-sample telemetry was captured for this session; the curve is estimated from recorded averages."
                        >
                          estimated
                        </span>
                      )}
                    </div>
                    <div className="activity-session-item__chart-tabs">
                      {(["usage", "temps", "ram", "fps"] as const).map((tab) => (
                        <button
                          key={tab}
                          type="button"
                          className={`activity-session-item__chart-tab-btn ${
                            activeChartTab === tab ? "activity-session-item__chart-tab-btn--active" : ""
                          }`}
                          onClick={() => setActiveChartTab(tab)}
                        >
                          {tab.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="activity-session-item__chart-container">
                    <LineChart
                      series={chartSeries}
                      labels={chartProps.labels}
                      formatValue={yValFormatter}
                      height={180}
                      legend={true}
                      {...chartExtra}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="activity-session-item__no-hardware">
              <Icons.Info size={16} style={{ marginBottom: 4, opacity: 0.5 }} />
              <div>No hardware performance logs recorded for this session.</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ActivitySessions({
  sessions,
  games,
  onDeleteSession,
}: ActivitySessionsProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(15);

  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [sessions]);

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sortedSessions;
    const q = searchQuery.toLowerCase();
    return sortedSessions.filter((s) => s.gameName.toLowerCase().includes(q));
  }, [sortedSessions, searchQuery]);

  const visibleSessions = useMemo(() => {
    return filteredSessions.slice(0, visibleCount);
  }, [filteredSessions, visibleCount]);

  return (
    <div className="section-panel">
      <div className="global-session-list__header">
        <h3 className="section-panel__title">Recent Gameplay Sessions</h3>
        <div className="global-session-list__actions">
          <div className="global-session-list__search">
            <Icons.Search size={12} className="global-session-list__search-icon" />
            <input
              type="text"
              className="global-session-list__search-input"
              placeholder="Search sessions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="global-session-list__refresh-btn"
            onClick={() => setVisibleCount(15)}
            title="Reset view count"
          >
            <Icons.RotateCcw size={12} />
          </button>
        </div>
      </div>

      <div className="global-session-list__items">
        {visibleSessions.map((session) => {
          const game = games.find((g) => g.id === session.gameId);
          return (
            <ActivitySessionItem
              key={session.id}
              session={session}
              game={game}
              onDelete={onDeleteSession}
            />
          );
        })}

        {filteredSessions.length === 0 && (
          <div className="section-panel__empty">No sessions matching search query.</div>
        )}

        {filteredSessions.length > visibleCount && (
          <button
            type="button"
            className="global-session-list__load-more"
            onClick={() => setVisibleCount((prev) => prev + 15)}
          >
            Load More Sessions
          </button>
        )}
      </div>
    </div>
  );
}
