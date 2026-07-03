import { useMemo, useState } from "react";

export interface ActivityGanttProps {
  sessions: any[];
  games: any[];
  startDate: string;
  endDate: string;
}

// Beautiful color palette for games in Gantt chart
const GANTT_COLORS = [
  "#10b981", // Emerald
  "#3b82f6", // Blue
  "#f59e0b", // Amber
  "#ef4444", // Red
  "#8b5cf6", // Violet
  "#ec4899", // Pink
  "#06b6d4", // Cyan
  "#84cc16", // Lime
  "#f97316", // Orange
  "#6366f1", // Indigo
  "#14b8a6", // Teal
  "#a855f7", // Purple
];

function formatTimeShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function ActivityGantt({
  sessions,
  games,
  startDate,
  endDate,
}: ActivityGanttProps) {
  const [hoveredBar, setHoveredBar] = useState<{
    session: any;
    x: number;
    y: number;
  } | null>(null);

  // Adapt and process sessions to map them onto the Gantt row layout
  const { rows, uniqueGames } = useMemo(() => {
    // 1. Build game color map
    const gameSet = new Map<string, { title: string; iconUrl: string | null }>();
    sessions.forEach((s) => {
      if (!gameSet.has(s.gameId)) {
        const game = games.find((g) => g.id === s.gameId);
        gameSet.set(s.gameId, {
          title: s.gameName,
          iconUrl: game?.iconUrl || null,
        });
      }
    });

    const gameColorMap = new Map<string, string>();
    let colorIdx = 0;
    for (const [id] of gameSet) {
      gameColorMap.set(id, GANTT_COLORS[colorIdx % GANTT_COLORS.length]);
      colorIdx++;
    }

    // 2. Adapt session timestamps (calculate start and end times)
    const adapted = sessions.map((s) => {
      const durationMs = s.durationMin * 60 * 1000;
      const endTime = new Date(s.date);
      const startTime = new Date(endTime.getTime() - durationMs);
      return {
        ...s,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        durationMs,
        color: gameColorMap.get(s.gameId) || "#10b981",
      };
    });

    // 3. Group adapted sessions by date (YYYY-MM-DD)
    const dateGroups = new Map<string, typeof adapted>();
    adapted.forEach((s) => {
      const dateKey = s.date.slice(0, 10);
      if (!dateGroups.has(dateKey)) {
        dateGroups.set(dateKey, []);
      }
      dateGroups.get(dateKey)!.push(s);
    });

    // 4. Generate rows for every day in the range (newest to oldest)
    const startD = new Date(startDate + "T00:00:00");
    const endD = new Date(endDate + "T00:00:00");
    const allRows = [];

    const cursor = new Date(endD);
    while (cursor >= startD) {
      const dateStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
      const daySessions = dateGroups.get(dateStr) || [];

      const bars = daySessions.map((s) => {
        const sessionStart = new Date(s.startTime);
        const sessionEnd = new Date(s.endTime);

        // Position within 24h day (00:00 to 24:00)
        const dayStart = new Date(dateStr + "T00:00:00");
        const dayEndMs = 24 * 60 * 60 * 1000;

        const startMs = Math.max(0, sessionStart.getTime() - dayStart.getTime());
        const endMs = Math.min(dayEndMs, sessionEnd.getTime() - dayStart.getTime());

        const startPct = (startMs / dayEndMs) * 100;
        const widthPct = Math.max(1.0, ((endMs - startMs) / dayEndMs) * 100);

        return {
          session: s,
          gameTitle: s.gameName,
          startPct,
          widthPct,
          color: s.color,
        };
      });

      allRows.push({
        date: dateStr,
        dateLabel: formatDateLabel(dateStr),
        bars,
      });

      cursor.setDate(cursor.getDate() - 1);
    }

    return {
      rows: allRows,
      uniqueGames: Array.from(gameSet.entries()).map(([id, info]) => ({
        id,
        title: info.title,
        iconUrl: info.iconUrl,
        color: gameColorMap.get(id) || "#10b981",
      })),
    };
  }, [sessions, games, startDate, endDate]);

  const visibleRows = useMemo(() => {
    const hasData = rows.filter((r) => r.bars.length > 0);
    if (hasData.length === 0) return rows.slice(0, 14); // default list
    return rows.slice(0, Math.min(rows.length, 60)); // limit rows to avoid memory overhead
  }, [rows]);

  const timeLabels = ["00:00", "06:00", "12:00", "18:00", "24:00"];

  return (
    <div className="activity-gantt">
      {/* Legend */}
      {uniqueGames.length > 0 && (
        <div className="activity-gantt__legend">
          {uniqueGames.slice(0, 12).map((g) => (
            <div className="activity-gantt__legend-item" key={g.id}>
              <span
                className="activity-gantt__legend-dot"
                style={{ backgroundColor: g.color }}
              />
              {g.iconUrl ? (
                <img className="activity-gantt__legend-icon" src={g.iconUrl} alt="" />
              ) : (
                <div className="activity-gantt__legend-dot" style={{ backgroundColor: g.color }} />
              )}
              <span className="activity-gantt__legend-label">{g.title}</span>
            </div>
          ))}
          {uniqueGames.length > 12 && (
            <span className="activity-gantt__legend-more">
              +{uniqueGames.length - 12} more
            </span>
          )}
        </div>
      )}

      {/* Axis Labels */}
      <div className="activity-gantt__timeline-header">
        <div className="activity-gantt__date-col" />
        <div className="activity-gantt__time-axis">
          {timeLabels.map((label) => (
            <span key={label} className="activity-gantt__time-label">
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Rows */}
      <div className="activity-gantt__rows">
        {visibleRows.map((row) => (
          <div
            className={`activity-gantt__row ${row.bars.length > 0 ? "activity-gantt__row--has-data" : ""}`}
            key={row.date}
          >
            <div className="activity-gantt__date-col">
              <span className="activity-gantt__date-label">{row.dateLabel}</span>
            </div>
            <div className="activity-gantt__bar-area">
              {/* Grid lines */}
              <div className="activity-gantt__grid-line" style={{ left: "25%" }} />
              <div className="activity-gantt__grid-line" style={{ left: "50%" }} />
              <div className="activity-gantt__grid-line" style={{ left: "75%" }} />

              {row.bars.map((bar) => (
                <div
                  key={bar.session.id}
                  className="activity-gantt__bar"
                  style={{
                    left: `${bar.startPct}%`,
                    width: `${bar.widthPct}%`,
                    backgroundColor: bar.color,
                  }}
                  onMouseEnter={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHoveredBar({
                      session: bar.session,
                      x: rect.left + rect.width / 2,
                      y: rect.top,
                    });
                  }}
                  onMouseLeave={() => setHoveredBar(null)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {sessions.length === 0 && (
        <div className="activity-gantt__empty">No gameplay sessions recorded for this range.</div>
      )}

      {/* Interactive Floating Tooltip */}
      {hoveredBar && (
        <div
          className="activity-gantt__tooltip"
          style={{
            position: "fixed",
            left: hoveredBar.x,
            top: hoveredBar.y - 8,
            transform: "translate(-50%, -100%)",
            zIndex: 1000,
            pointerEvents: "none",
          }}
        >
          <strong className="activity-gantt__tooltip-game">
            {hoveredBar.session.gameName}
          </strong>
          <span className="activity-gantt__tooltip-time">
            {formatTimeShort(hoveredBar.session.startTime)} — {formatTimeShort(hoveredBar.session.endTime)}
          </span>
          <span className="activity-gantt__tooltip-duration">
            {formatDuration(hoveredBar.session.durationMs)}
          </span>
        </div>
      )}
    </div>
  );
}
