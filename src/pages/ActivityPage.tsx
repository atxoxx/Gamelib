import { useState, useMemo } from "react";
import { useActivity } from "../context/ActivityContext";
import { formatPlayTime, deriveMetricsTimeSeries, type ActivityStats } from "../types/game";
import BarChart from "../components/charts/BarChart";
import LineChart from "../components/charts/LineChart";
import DonutChart from "../components/charts/DonutChart";

type ActivityTab = "overview" | "performance" | "timeline";

export default function ActivityPage() {
  const { sessions, getAllStats, selectedGpu } = useActivity();
  const [activeTab, setActiveTab] = useState<ActivityTab>("overview");
  const stats = useMemo(() => getAllStats(), [getAllStats]);

  return (
    <div className="activity-page">
      <header className="activity-header">
        <h1 className="activity-title">Activity</h1>
        <p className="activity-subtitle">
          Track gameplay sessions, playtime trends, and hardware performance metrics.
        </p>
      </header>

      {/* Tabbed sub-navigation */}
      <div className="activity-tabs-wrapper">
        <div className="activity-tabs">
          {([
            ["overview", "Overview"],
            ["performance", "Performance"],
            ["timeline", "Timeline"],
          ] as [ActivityTab, string][]).map(([tab, label]) => (
            <button
              key={tab}
              className={`activity-tab ${activeTab === tab ? "active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="activity-content">
        {activeTab === "overview" && <OverviewTab stats={stats} />}
        {activeTab === "performance" && <PerformanceTab stats={stats} selectedGpuName={selectedGpu?.name} />}
        {activeTab === "timeline" && <TimelineTab sessions={sessions} />}
      </div>
    </div>
  );
}

// ─── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({ stats }: { stats: ActivityStats }) {
  return (
    <div className="activity-tab-content">
      {/* Summary stat cards */}
      <div className="activity-stat-cards">
        <StatCard
          label="Total Sessions"
          value={String(stats.totalSessions)}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          }
          color="var(--color-accent)"
        />
        <StatCard
          label="Total Play Time"
          value={formatPlayTime(stats.totalPlayTimeMin)}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
          }
          color="var(--color-success)"
        />
        <StatCard
          label="Avg Session"
          value={formatPlayTime(stats.avgSessionMin)}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          }
          color="var(--color-info)"
        />
        <StatCard
          label="Most Played"
          value={stats.mostPlayedGame}
          sub={`${formatPlayTime(stats.mostPlayedGameTimeMin)}`}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          }
          color="var(--color-warning)"
        />
      </div>

      {/* Charts grid */}
      <div className="activity-charts-grid">
        <section className="activity-section">
          <h2 className="activity-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
            </svg>
            Playtime (Last 7 Days)
          </h2>
          <BarChart
            data={stats.dailyAvg}
            labels={stats.dailyLabels}
            formatValue={(v) => formatPlayTime(v)}
            height={200}
          />
        </section>

        <section className="activity-section">
          <h2 className="activity-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
            </svg>
            Weekly Playtime
          </h2>
          <BarChart
            data={stats.weeklyAvg}
            labels={stats.weeklyLabels}
            formatValue={(v) => formatPlayTime(v)}
            color="var(--color-success)"
            height={200}
          />
        </section>
      </div>

      {/* Genre & Platform breakdown */}
      <div className="activity-charts-grid">
        <section className="activity-section">
          <h2 className="activity-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.21 15.89A10 10 0 1 1 8 2.83" /><path d="M22 12A10 10 0 0 0 12 2v10z" />
            </svg>
            Genre Distribution
          </h2>
          <DonutChart
            slices={stats.genreBreakdown.map((g) => ({
              value: g.minutes,
              color: "",
              label: g.genre,
            }))}
            formatValue={(v) => formatPlayTime(v)}
            size={200}
          />
        </section>

        <section className="activity-section">
          <h2 className="activity-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.21 15.89A10 10 0 1 1 8 2.83" /><path d="M22 12A10 10 0 0 0 12 2v10z" />
            </svg>
            Platform Distribution
          </h2>
          <DonutChart
            slices={stats.platformBreakdown.map((p) => ({
              value: p.minutes,
              color: "",
              label: p.platform,
            }))}
            formatValue={(v) => formatPlayTime(v)}
            size={200}
          />
        </section>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="activity-stat-card" style={{ borderTopColor: color }}>
      <div className="activity-stat-icon" style={{ color }}>
        {icon}
      </div>
      <div className="activity-stat-info">
        <span className="activity-stat-label">{label}</span>
        <span className="activity-stat-value">{value}</span>
        {sub && <span className="activity-stat-sub">{sub}</span>}
      </div>
    </div>
  );
}

// ─── Performance Tab ───────────────────────────────────────────────────────────

function PerformanceTab({ stats, selectedGpuName }: { stats: ActivityStats; selectedGpuName?: string }) {
  const { sessions } = useActivity();

  // Derive time-series data from the most recent session that has real metrics
  const { fpsData, gpuData, cpuData, chartLabels, tempGpuData, tempCpuData } = useMemo(() => {
    const sessionsWithMetrics = sessions
      .filter((s) => s.metrics)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    if (sessionsWithMetrics.length === 0) {
      return { fpsData: [], gpuData: [], cpuData: [], chartLabels: [], tempGpuData: [], tempCpuData: [] };
    }

    // Use the most recent session for a detailed time-series view
    const latest = sessionsWithMetrics[0];
    const points = deriveMetricsTimeSeries(latest.metrics!, latest.durationMin, 20);
    const intervalMin = Math.max(1, Math.round(latest.durationMin / 20));

    return {
      fpsData: points.map((p) => p.fps),
      gpuData: points.map((p) => p.gpuUsage),
      cpuData: points.map((p) => p.cpuUsage),
      chartLabels: points.map((_, i) => `${i * intervalMin}m`),
      tempGpuData: points.map((p) => p.gpuTemp),
      tempCpuData: points.map((p) => p.cpuTemp),
    };
  }, [sessions]);

  const hasData = fpsData.length > 0;

  return (
    <div className="activity-tab-content">
      {/* Hardware summary cards */}
      <div className="activity-stat-cards">
        <StatCard
          label="Average FPS"
          value={stats.avgFpsAll > 0 ? `${stats.avgFpsAll}` : "-"}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          }
          color="var(--color-accent)"
        />
        <StatCard
          label="GPU Usage"
          value={stats.avgGpuAll > 0 ? `${stats.avgGpuAll}%` : "-"}
          sub={selectedGpuName ? `GPU: ${selectedGpuName}` : undefined}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="2" /><path d="M7 2v20" /><path d="M17 2v20" /><path d="M2 12h20" /><path d="M2 7h5" /><path d="M2 17h5" /><path d="M17 17h5" /><path d="M17 7h5" />
            </svg>
          }
          color="var(--color-success)"
        />
        <StatCard
          label="CPU Usage"
          value={stats.avgCpuAll > 0 ? `${stats.avgCpuAll}%` : "-"}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="4" width="16" height="16" rx="2" ry="2" /><rect x="8" y="8" width="8" height="8" rx="1" ry="1" /><line x1="4" y1="12" x2="1" y2="12" /><line x1="9" y1="4" x2="9" y2="1" /><line x1="15" y1="4" x2="15" y2="1" /><line x1="20" y1="12" x2="23" y2="12" />
            </svg>
          }
          color="var(--color-info)"
        />
        <StatCard
          label="GPU Selected"
          value={selectedGpuName || "None"}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          }
          color="var(--color-warning)"
        />
      </div>

      {/* Performance chart — derived from most recent session */}
      <section className="activity-section">
        <h2 className="activity-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          Performance Metrics (Latest Session)
        </h2>
        {hasData ? (
          <LineChart
            series={[
              {
                data: fpsData,
                color: "var(--color-accent)",
                label: "FPS",
              },
              {
                data: gpuData,
                color: "var(--color-success)",
                label: "GPU %",
              },
              {
                data: cpuData,
                color: "var(--color-info)",
                label: "CPU %",
              },
            ]}
            labels={chartLabels}
            height={240}
          />
        ) : (
          <div className="activity-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            <p>Launch a game and play for a while to see performance metrics.</p>
          </div>
        )}
      </section>

      {/* Temperature chart */}
      <section className="activity-section">
        <h2 className="activity-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" />
          </svg>
          Temperature History (Latest Session)
        </h2>
        {hasData && (tempGpuData.some((v) => v > 0) || tempCpuData.some((v) => v > 0)) ? (
          <LineChart
            series={[
              {
                data: tempGpuData,
                color: "#ff5252",
                label: "GPU Temp °C",
              },
              {
                data: tempCpuData,
                color: "#ffab00",
                label: "CPU Temp °C",
              },
            ]}
            labels={chartLabels}
            formatValue={(v) => `${v}°C`}
            height={240}
          />
        ) : (
          <div className="activity-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" />
            </svg>
            <p>Temperature data is not available. WMI thermal sensors are not currently supported.</p>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Timeline Tab ──────────────────────────────────────────────────────────────

function TimelineTab({ sessions }: { sessions: import("../types/game").GameSession[] }) {
  // Group sessions by date
  const grouped = useMemo(() => {
    const map = new Map<string, import("../types/game").GameSession[]>();
    sessions.forEach((s) => {
      const dateKey = new Date(s.date).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      const existing = map.get(dateKey) || [];
      existing.push(s);
      map.set(dateKey, existing);
    });
    return Array.from(map.entries()).sort(
      (a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime()
    );
  }, [sessions]);

  if (sessions.length === 0) {
    return (
      <div className="activity-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
        <p>No sessions recorded yet. Launch some games to start tracking.</p>
      </div>
    );
  }

  return (
    <div className="activity-tab-content">
      <div className="activity-timeline">
        {grouped.map(([date, daySessions]) => (
          <div key={date} className="activity-timeline-day">
            <div className="activity-timeline-date">
              <span className="activity-timeline-date-text">{date}</span>
              <span className="activity-timeline-date-count">
                {daySessions.length} session{daySessions.length !== 1 ? "s" : ""} ·{" "}
                {formatPlayTime(daySessions.reduce((s, sess) => s + sess.durationMin, 0))}
              </span>
            </div>
            <div className="activity-timeline-items">
              {daySessions.map((session) => (
                <div key={session.id} className="activity-timeline-item">
                  <div className="activity-timeline-dot" />
                  <div className="activity-timeline-card">
                    <div className="activity-timeline-card-header">
                      <span className="activity-timeline-game">{session.gameName}</span>
                      <span className="activity-timeline-duration">
                        {formatPlayTime(session.durationMin)}
                      </span>
                    </div>
                    {session.metrics && (
                      <div className="activity-timeline-metrics">
                        <span className="activity-metric-tag" title="Average FPS">
                          {session.metrics.avgFps} FPS
                        </span>
                        <span className="activity-metric-tag" title="GPU Usage">
                          GPU {session.metrics.avgGpuUsage}%
                        </span>
                        <span className="activity-metric-tag" title="CPU Usage">
                          CPU {session.metrics.avgCpuUsage}%
                        </span>
                        <span className="activity-metric-tag" title="Resolution">
                          {session.metrics.resolution}
                        </span>
                      </div>
                    )}
                    <div className="activity-timeline-time">
                      {new Date(session.date).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
