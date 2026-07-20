import { useMemo, useState } from "react";
import {
  type Game,
  type GameSession,
  formatPlayTime,
} from "../../types/game";
import { useSettings } from "../../context/SettingsContext";
import { formatTemp, toDisplayTemp, tempMaxY } from "../../utils/temp";
import * as Icons from "./Icons";

/**
 * Sessions Log tab. Lists every recorded session with its duration, when it
 * happened, and—if metrics were captured—collapsible hardware stats for that
 * session. Numbers are formatted in `formatSessionValue` so a stored value of
 * 18.333333333333332% becomes "18.3 %" rather than the raw float.
 */
export function ActivitySessions({
  sessions,
  games,
  onDeleteSession,
}: {
  sessions: GameSession[];
  games: Game[];
  onDeleteSession: (sessionId: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Build a quick id→game lookup so each session row can show the cover
  // icon without scanning the full games array on every render.
  const gameById = useMemo(() => {
    const m = new Map<string, Game>();
    games.forEach((g) => m.set(g.id, g));
    return m;
  }, [games]);

  // Filter sessions by free-text search across game name. Sessions are
  // stored newest-first by `recordSession`, so the filtered list already
  // preserves that natural ordering without an explicit sort.
  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => s.gameName.toLowerCase().includes(q));
  }, [sessions, searchQuery]);

  if (sessions.length === 0) {
    return (
      <div className="section-panel">
        <div className="section-panel__empty">
          No sessions recorded yet. Launch a game and play for at least a
          minute to see it appear here.
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="global-session-list__header">
        <h3 className="section-panel__title">Sessions Log ({sessions.length})</h3>
        <div className="global-session-list__actions">
          <div className="global-session-list__search">
            <Icons.Search size={11} className="global-session-list__search-icon" />
            <input
              className="global-session-list__search-input"
              type="search"
              placeholder="Search sessions..."
              aria-label="Search sessions by game name"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="global-session-list__items">
        {filteredSessions.length === 0 ? (
          <div className="section-panel__empty">
            No sessions match "{searchQuery}".
          </div>
        ) : (
          filteredSessions.map((session) => {
            const game = gameById.get(session.gameId);
            const isExpanded = expandedId === session.id;
            const startDate = new Date(session.date);
            const dateLabel = startDate.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            });
            const timeLabel = startDate.toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
            });

            return (
              <div
                key={session.id}
                className={`activity-session-item${isExpanded ? " activity-session-item--expanded" : ""}`}
              >
                <div
                  className="activity-session-item__row"
                  onClick={() =>
                    setExpandedId(isExpanded ? null : session.id)
                  }
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpandedId(isExpanded ? null : session.id);
                    }
                  }}
                  aria-expanded={isExpanded}
                >
                  <div className="activity-session-item__header-left">
                    <span
                      className="activity-session-item__chevron"
                      // Rotated when expanded so the chevron points down
                      // when collapsed and up when expanded — matches
                      // the convention used in the sidebar / playwright
                      // and makes the row feel "opened" instantly on
                      // click. The base CSS sets the un-rotated layout;
                      // this transform stacks on top.
                      style={{
                        display: "inline-flex",
                        transform: isExpanded ? "rotate(-90deg)" : "rotate(0deg)",
                        transition: "transform 150ms ease",
                      }}
                    >
                      <Icons.ChevronDown size={11} />
                    </span>
                    <div className="activity-session-item__game-icon-container">
                      {game?.iconUrl ? (
                        <img
                          src={game.iconUrl}
                          alt={session.gameName}
                          className="activity-session-item__game-icon"
                        />
                      ) : (
                        <div className="activity-session-item__game-icon-placeholder" />
                      )}
                    </div>
                    <div className="activity-session-item__info">
                      <span className="activity-session-item__date">
                        {session.gameName}
                      </span>
                      <span className="activity-session-item__time">
                        {dateLabel} · {timeLabel}
                      </span>
                    </div>
                  </div>

                  <div className="activity-session-item__header-right">
                    <span className="activity-session-item__duration">
                      {formatPlayTime(session.durationMin)}
                    </span>
                    <button
                      type="button"
                      className="activity-session-item__delete-btn"
                      title="Delete session"
                      aria-label={`Delete session for ${session.gameName}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSession(session.id);
                      }}
                    >
                      <Icons.Trash size={12} />
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="activity-session-item__collapsible">
                    {session.metrics ? (
                      <SessionMetricsCard metrics={session.metrics} />
                    ) : (
                      <div className="activity-session-item__no-hardware">
                        No hardware metrics were recorded for this session.
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

/**
 * Compact "stat card" shown inside an expanded session. Displays the headline
 * value plus a min/max range and an inline-ish percentage/scale bar so it
 * reads as both a number and a quick visual weight.
 */
function SessionMetricsCard({
  metrics,
}: {
  metrics: NonNullable<GameSession["metrics"]>;
}) {
  const { tempUnit } = useSettings();
  return (
    <div className="activity-hardware-card">
      <h4 className="activity-hardware-card__title">
        Captured Metrics ({metrics.resolution})
      </h4>
      <div className="activity-hardware-card__metrics">
        <StatTile
          icon={<Icons.Activity size={11} />}
          label="Avg FPS"
          value={metrics.avgFps ? String(metrics.avgFps) : "—"}
          extra={`${metrics.minFps || "—"}-${metrics.maxFps || "—"}`}
          // FPS scale: 240 ceiling. Bar normalises against 240 so a
          // 144-fps cap visibly fills ~60 % of the inline bar.
          fraction={metrics.avgFps / 240}
        />
        <StatTile
          icon={<Icons.Cpu size={11} />}
          label="CPU Load"
          value={formatSessionValue(metrics.avgCpuUsage, "%", 1)}
          fraction={metrics.avgCpuUsage / 100}
        />
        <StatTile
          icon={<Icons.Gauge size={11} />}
          label="GPU Load"
          value={formatSessionValue(metrics.avgGpuUsage, "%", 1)}
          fraction={metrics.avgGpuUsage / 100}
        />
        <StatTile
          icon={<Icons.MemoryStick size={11} />}
          label="RAM"
          value={formatSessionValue(metrics.avgRamUsage, "%", 1)}
          fraction={metrics.avgRamUsage / 100}
        />
        <StatTile
          icon={<Icons.Thermometer size={11} />}
          label="CPU Temp"
          value={formatTemp(metrics.avgCpuTemp, tempUnit)}
          // 0-100 (°C) / 32-212 (°F) scale (cool → hot).
          fraction={toDisplayTemp(metrics.avgCpuTemp, tempUnit) / tempMaxY(tempUnit)}
        />
        <StatTile
          icon={<Icons.Thermometer size={11} />}
          label="GPU Temp"
          value={formatTemp(metrics.avgGpuTemp, tempUnit)}
          fraction={toDisplayTemp(metrics.avgGpuTemp, tempUnit) / tempMaxY(tempUnit)}
        />
      </div>
    </div>
  );
}

/**
 * Single stat cell inside the expanded session card. Draws an inline
 * accent-coloured bar so the reader can see at-a-glance how heavy the
 * session was without squinting at the number alone.
 */
function StatTile({
  icon,
  label,
  value,
  extra,
  fraction,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  extra?: string;
  fraction: number;
}) {
  // Clamp the bar fill so over-range readings (rare but possible if a
  // session reports >100% CPU from a faulty MAHM sensor) don't render
  // past the tile edge.
  const clamped = Math.max(0, Math.min(1, fraction || 0));
  return (
    <div className="activity-sparkline">
      <span className="activity-sparkline__label">
        <span style={{ marginRight: 4, display: "inline-flex", verticalAlign: "middle" }}>
          {icon}
        </span>
        {label}
      </span>
      <svg className="activity-sparkline__chart" viewBox="0 0 100 30" preserveAspectRatio="none">
        <rect x="0" y="14" width="100" height="2" rx="1" fill="var(--color-bg-tertiary)" />
        <rect
          x="0"
          y="14"
          width={clamped * 100}
          height="2"
          rx="1"
          fill="var(--color-accent)"
        />
      </svg>
      <div className="activity-sparkline__value-group">
        <div className="activity-sparkline__value-item">
          <span className="activity-sparkline__value-item-label">Avg</span>
          <span className="activity-sparkline__value">{value}</span>
        </div>
        {extra && (
          <div className="activity-sparkline__value-item">
            <span className="activity-sparkline__value-item-label">Range</span>
            <span className="activity-sparkline__value activity-sparkline__value--min">
              {extra}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Format a session metric for display. Strips trailing junk from floats so
 * `18.333333333333332%` becomes `18.3%`. `null`/`undefined`/0 collapse to a
 * dash so blank data is unmistakable.
 */
function formatSessionValue(
  value: number | null | undefined,
  unit = "",
  decimals = 0,
): string {
  if (value === null || value === undefined || value === 0) return "—";
  const fixed = value.toFixed(decimals);
  // toFixed already strips, but trim trailing ".0" when no decimals wanted.
  const trimmed = decimals === 0 ? fixed.replace(/\.0$/, "") : fixed;
  return `${trimmed}${unit}`;
}
