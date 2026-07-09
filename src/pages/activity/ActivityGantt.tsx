import { useMemo } from "react";
import type { Game, GameSession } from "../../types/game";
import { formatPlayTime } from "../../types/game";

export interface ActivityGanttProps {
  sessions: GameSession[];
  games: Game[];
  startDate: string;
  endDate: string;
}

/**
 * Timeline / Gantt view. Renders one row per day that has gameplay sessions
 * within the active date range. Each row contains horizontal bars for every
 * session played that day, positioned by time-of-day and sized by duration.
 *
 * Date handling: `session.date` is the session END time (recorded by
 * `recordSession` as `new Date().toISOString()` when the game exits).
 * We compute the start time as `end - durationMin` and bucket by start time
 * so sessions that start late at night and cross midnight don't cause
 * negative bar offsets.
 */

/** Stable, unlimited color palette via hash — same game = same hue forever. */
function colorForGame(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString(undefined, {
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
  // ── 1. Build id→Game lookup ───────────────────────────────────────────
  const gameById = useMemo(() => {
    const m = new Map<string, Game>();
    games.forEach((g) => m.set(g.id, g));
    return m;
  }, [games]);

  // ── 2. Filter + group sessions into day buckets ───────────────────────
  const dayBuckets = useMemo(() => {
    const startMs = new Date(startDate + "T00:00:00").getTime();
    const endMs =
      new Date(endDate + "T23:59:59.999").getTime();

    // Filter: keep sessions whose *start time* is within the range
    const filtered = sessions.filter((s) => {
      const endTime = new Date(s.date).getTime();
      const startTime = endTime - s.durationMin * 60_000;
      return startTime >= startMs && endTime <= endMs + 24 * 60 * 60_000;
    });

    const buckets = new Map<
      string,
      {
        sessions: GameSession[];
        label: string;
        sortKey: number;
      }
    >();

    for (const sess of filtered) {
      const endTime = new Date(sess.date);
      const startTime = new Date(endTime.getTime() - sess.durationMin * 60_000);

      // Bucket by the session's START date so midnight crossovers
      // land in the correct day
      const key = `${startTime.getFullYear()}-${String(startTime.getMonth() + 1).padStart(2, "0")}-${String(startTime.getDate()).padStart(2, "0")}`;

      const existing = buckets.get(key);
      if (existing) {
        existing.sessions.push(sess);
      } else {
        // Clone startTime to midnight for the label date
        const labelDate = new Date(startTime);
        labelDate.setHours(0, 0, 0, 0);
        buckets.set(key, {
          sessions: [sess],
          label: formatDateLabel(labelDate),
          sortKey: labelDate.getTime(),
        });
      }
    }

    // Sort oldest→newest, cap to last 30 days with data
    return Array.from(buckets.values())
      .sort((a, b) => a.sortKey - b.sortKey)
      .slice(-30);
  }, [sessions, startDate, endDate]);

  // ── 3. Top-8 most-played games for the legend ────────────────────────
  const topGames = useMemo(() => {
    const totals = new Map<string, number>();
    for (const bucket of dayBuckets) {
      for (const s of bucket.sessions) {
        totals.set(s.gameId, (totals.get(s.gameId) || 0) + s.durationMin);
      }
    }
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [dayBuckets]);

  // ── Empty state ──────────────────────────────────────────────────────
  if (dayBuckets.length === 0) {
    return (
      <div className="section-panel">
        <div className="section-panel__empty">
          No gameplay sessions recorded in the selected date range.
        </div>
      </div>
    );
  }

  // Full total across all games (not just top 8)
  const totalPlayedMinutes = useMemo(() => {
    return dayBuckets.reduce(
      (sum, b) =>
        sum + b.sessions.reduce((s, sess) => s + sess.durationMin, 0),
      0,
    );
  }, [dayBuckets]);

  return (
    <div className="activity-gantt">
      {/* ── Legend ──────────────────────────────────────────────────── */}
      <div className="activity-gantt__legend">
        {topGames.map(([gameId, minutes]) => {
          const g = gameById.get(gameId);
          return (
            <div key={gameId} className="activity-gantt__legend-item">
              <span
                className="activity-gantt__legend-dot"
                style={{ background: colorForGame(gameId) }}
              />
              {g?.iconUrl ? (
                <img
                  className="activity-gantt__legend-icon"
                  src={g.iconUrl}
                  alt=""
                />
              ) : null}
              <span
                className="activity-gantt__legend-label"
                title={g?.name || "Unknown"}
              >
                {g?.name || "Unknown"} · {formatPlayTime(minutes)}
              </span>
            </div>
          );
        })}

        {/* Overflow count for games beyond the top 8 */}
        {(() => {
          const visible = new Set(topGames.map(([id]) => id));
          const extras = dayBuckets
            .flatMap((d) => d.sessions)
            .filter((s) => !visible.has(s.gameId));
          const unique = new Set(extras.map((s) => s.gameId)).size;
          return unique > 0 ? (
            <span className="activity-gantt__legend-more">
              + {unique} more game{unique === 1 ? "" : "s"}
            </span>
          ) : null;
        })()}

        <span className="activity-gantt__legend-total">
          {formatPlayTime(totalPlayedMinutes)} total
        </span>
      </div>

      {/* ── Timeline header (00:00 … 24:00) ─────────────────────────── */}
      <div className="activity-gantt__timeline-header">
        <div className="activity-gantt__date-col" />
        <div className="activity-gantt__time-axis">
          {["00:00", "06:00", "12:00", "18:00", "24:00"].map((tick) => (
            <span key={tick} className="activity-gantt__time-label">
              {tick}
            </span>
          ))}
        </div>
      </div>

      {/* ── Day rows ────────────────────────────────────────────────── */}
      <div className="activity-gantt__rows">
        {dayBuckets.map((bucket) => (
          <div key={bucket.sortKey} className="activity-gantt__row">
            <div className="activity-gantt__date-col">
              <span className="activity-gantt__date-label">
                {bucket.label}
              </span>
            </div>
            <div className="activity-gantt__bar-area">
              {/* Vertical grid lines at 6-hour intervals */}
              {[0, 25, 50, 75, 100].map((pct) => (
                <div
                  key={pct}
                  className="activity-gantt__grid-line"
                  style={{ left: `${pct}%` }}
                />
              ))}

              {bucket.sessions.map((sess) => {
                const endTime = new Date(sess.date);
                const startTime = new Date(
                  endTime.getTime() - sess.durationMin * 60_000,
                );

                // Position within the 24h day (based on start time)
                const startMinutes =
                  startTime.getHours() * 60 +
                  startTime.getMinutes() +
                  startTime.getSeconds() / 60;

                const left = (startMinutes / (24 * 60)) * 100;

                // Width from duration, capped at end-of-day
                const endMinutes = Math.min(
                  24 * 60,
                  startMinutes + sess.durationMin,
                );
                const widthPct =
                  Math.max(0.4, ((endMinutes - startMinutes) / (24 * 60)) * 100);

                const playTime = formatPlayTime(sess.durationMin);
                const timeStr = startTime.toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                });

                return (
                  <div
                    key={sess.id}
                    role="button"
                    tabIndex={0}
                    className="activity-gantt__bar"
                    title={`${sess.gameName} · ${playTime} · ${timeStr} – ${endTime.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`}
                    style={{
                      left: `${left}%`,
                      width: `${widthPct}%`,
                      background: colorForGame(sess.gameId),
                    }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
