import { useMemo } from "react";
import { type Game, type GameSession, formatPlayTime } from "../../types/game";

/**
 * Timeline / Gantt view. Renders one row per day in the active range,
 * each row containing a horizontal bar for every session played on that
 * day. Bar position = start-of-session time-of-day, bar width =
 * duration. Hovering shows a tooltip with game name + duration.
 *
 * Simplification vs. a real Gantt: we use a single global palette keyed
 * off the game so the same game always renders the same colour and the
 * legend reads at-a-glance.
 */
export function ActivityGantt({
  sessions,
  games,
  startDate,
  endDate,
}: {
  sessions: GameSession[];
  games: Game[];
  startDate: string;
  endDate: string;
}) {
  // Group sessions by local date so each row corresponds to one calendar
  // day in the user's locale. Sessions are filtered to the active range
  // so an old "All Time" preset won't paint literally thousands of rows.
  const dayBuckets = useMemo(() => {
    const startMs = new Date(startDate).getTime();
    const endMs =
      new Date(endDate).getTime() + 24 * 60 * 60 * 1000 - 1;
    const filtered = sessions.filter((s) => {
      const t = new Date(s.date).getTime();
      return t >= startMs && t <= endMs;
    });

    const buckets = new Map<
      string,
      { sessions: GameSession[]; label: string; sortKey: string }
    >();
    for (const sess of filtered) {
      const d = new Date(sess.date);
      // "YYYY-MM-DD" makes a unique, lex-sortable bucket key.
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const existing = buckets.get(key);
      if (existing) {
        existing.sessions.push(sess);
      } else {
        buckets.set(key, {
          sessions: [sess],
          label: d.toLocaleDateString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
          }),
          // Store the original timestamp as the secondary sort key so we
          // can sort "10 days ago" → "yesterday" without recomputing.
          sortKey: String(d.getTime()),
        });
      }
    }
    return Array.from(buckets.values())
      .sort((a, b) => Number(a.sortKey) - Number(b.sortKey))
      .slice(-30); // Cap to last 30 days so the view stays scannable.
  }, [sessions, startDate, endDate]);

  // One consistent colour per game so the eye tracks a given bar across
  // rows. Hashes the game id for a stable but cheap lookup.
  function colorForGame(id: string): string {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash * 31 + id.charCodeAt(i)) | 0;
    }
    const hue = ((hash % 360) + 360) % 360;
    return `hsl(${hue}, 65%, 55%)`;
  }

  // Top-N most-played games for the legend. We cap at 8 to keep the
  // legend compact; everything after is grouped into "+ N more".
  const topGames = useMemo(() => {
    const totals = new Map<string, number>();
    for (const s of dayBuckets.flatMap((d) => d.sessions)) {
      totals.set(s.gameId, (totals.get(s.gameId) || 0) + s.durationMin);
    }
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [dayBuckets]);

  const lookupGame = useMemo(() => {
    const m = new Map<string, Game>();
    games.forEach((g) => m.set(g.id, g));
    return m;
  }, [games]);

  if (dayBuckets.length === 0) {
    return (
      <div className="section-panel">
        <div className="section-panel__empty">
          No sessions recorded in the selected range.
        </div>
      </div>
    );
  }

  return (
    <div className="activity-gantt">
      {/* ── Legend ─────────────────────────────────────────────────────── */}
      <div className="activity-gantt__legend">
        {topGames.map(([gameId, minutes]) => {
          const g = lookupGame.get(gameId);
          return (
            <div key={gameId} className="activity-gantt__legend-item">
              <span
                className="activity-gantt__legend-dot"
                style={{ background: colorForGame(gameId) }}
              />
              <span
                className="activity-gantt__legend-label"
                title={g?.name || "Unknown"}
              >
                {g?.name || "Unknown"} · {formatPlayTime(minutes)}
              </span>
            </div>
          );
        })}
        {/* Overflow legend if more games than 8 tiles — purely cosmetic
            to let the user know we trimmed it. */}
        {(() => {
          const visible = new Set(topGames.map(([id]) => id));
          const extras = dayBuckets
            .flatMap((d) => d.sessions)
            .filter((s) => !visible.has(s.gameId));
          const unique = new Set(extras.map((s) => s.gameId)).size;
          return unique > 0 ? (
            <span className="activity-gantt__legend-more">
              + {unique} more
            </span>
          ) : null;
        })()}
      </div>

      {/* ── Day timeline header (00:00 ... 24:00) ─────────────────────── */}
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

      {/* ── Day rows ──────────────────────────────────────────────────── */}
      <div className="activity-gantt__rows">
        {dayBuckets.map((bucket) => (
          <div key={bucket.sortKey} className="activity-gantt__row">
            <div className="activity-gantt__date-col">
              <span className="activity-gantt__date-label">
                {bucket.label}
              </span>
            </div>
            <div className="activity-gantt__bar-area">
              {/* Vertical grid lines every 6 hours */}
              {[0, 25, 50, 75, 100].map((pct) => (
                <div
                  key={pct}
                  className="activity-gantt__grid-line"
                  style={{ left: `${pct}%` }}
                />
              ))}
              {bucket.sessions.map((sess) => {
                const start = new Date(sess.date);
                const startMinutes =
                  start.getHours() * 60 +
                  start.getMinutes() +
                  start.getSeconds() / 60;
                // Width = minutes played, but capped to "fit within the
                // day" so a multi-hour session can't visually leak
                // past midnight.
                const left = (startMinutes / (24 * 60)) * 100;
                const widthPct =
                  Math.max(0.4, (sess.durationMin / (24 * 60)) * 100); // minimum 0.4% so very short sessions are still visible
                return (
                  <div
                    key={sess.id}
                    role="button"
                    tabIndex={0}
                    className="activity-gantt__bar"
                    title={`${sess.gameName} · ${formatPlayTime(sess.durationMin)} @ ${start.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`}
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
