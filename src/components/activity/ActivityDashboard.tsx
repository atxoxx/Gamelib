import { useMemo } from "react";
import { type Game, type GameSession, formatPlayTime } from "../../types/game";
import { useActivity } from "../../context/ActivityContext";
import LineChart from "../charts/LineChart";
import BarChart from "../charts/BarChart";
import DonutChart from "../charts/DonutChart";
import * as Icons from "./Icons";

// Activity-page filter shapes. These are also defined on the parent
// ActivityPage.tsx but not exported there. Re-declaring them locally
// here keeps the cross-file coupling explicit ("the parent passes these
// strings down, the child accepts the same shape") without expanding
// types/game.ts beyond what the activity feature needs.
export type DateRangePreset = "7d" | "30d" | "90d" | "all";
export type AggregationType = "day" | "week" | "month";
export type ChartType = "bar" | "line";

// Local donut palette. Mirrors the spirit of the one inside DonutChart.tsx
// (which isn't exported) but adds a couple more slots so the genre list can
// reach up to 8 distinct slices without repeating colours.
const DONUT_PALETTE = [
  "#6c5ce7",
  "#00c853",
  "#ffab00",
  "#ff5252",
  "#448aff",
  "#e040fb",
  "#00bfa5",
  "#ff6d00",
];

/**
 * Activity Dashboard tab. Top row is headline stats (4 pills), then the
 * main playtime chart (bar/line + day/week/month interval, driven by
 * parent state), then a 2-column row of donut breakdowns for genre and
 * platform time-share.
 */
export function ActivityDashboard({
  sessions,
  games,
  dateRange,
  startDate,
  endDate,
  aggregation,
  chartType,
  sourceFilter,
}: {
  sessions: GameSession[];
  games: Game[];
  dateRange: DateRangePreset;
  startDate: string;
  endDate: string;
  aggregation: AggregationType;
  chartType: ChartType;
  sourceFilter: string;
}) {
  const { getAllStats } = useActivity();

  // Filter sessions to the active date range AND source filter. Doing it
  // here keeps the charts and stat pills in sync — they all derive from
  // `displayedSessions`. The `sourceFilter` matches a game.platform value
  // ("all" passes everything through).
  const displayedSessions = useMemo(() => {
    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime() + 24 * 60 * 60 * 1000 - 1;
    return sessions.filter((s) => {
      const t = new Date(s.date).getTime();
      if (t < start || t > end) return false;
      if (sourceFilter === "all") return true;
      const g = games.find((gm) => gm.id === s.gameId);
      return g?.platform === sourceFilter;
    });
  }, [sessions, startDate, endDate, sourceFilter, games]);

  // Aggregate stats are computed against the (all-time) session set via
  // getAllStats() — the dashboard's pills summarise the library, not the
  // filter selection, so shortening the date range still shows the
  // library's overall headline numbers. The main chart below changes
  // its data based on the date range, however, so it tracks the visible
  // window.
  const allStats = useMemo(() => getAllStats(), [getAllStats]);
  const rangedStats = useMemo(() => {
    if (displayedSessions.length === 0) {
      return {
        totalSessions: 0,
        totalPlayTimeMin: 0,
        avgSessionMin: 0,
        mostPlayedGame: "—",
        mostPlayedGameTimeMin: 0,
      };
    }
    const totalSessions = displayedSessions.length;
    const totalPlayTimeMin = displayedSessions.reduce(
      (s, sess) => s + sess.durationMin,
      0,
    );
    const avgSessionMin = Math.round(totalPlayTimeMin / Math.max(1, totalSessions));

    const gameMap = new Map<string, number>();
    displayedSessions.forEach((s) => {
      gameMap.set(s.gameName, (gameMap.get(s.gameName) || 0) + s.durationMin);
    });
    let mostPlayedGame = "—";
    let mostPlayedGameTimeMin = 0;
    gameMap.forEach((mins, name) => {
      if (mins > mostPlayedGameTimeMin) {
        mostPlayedGameTimeMin = mins;
        mostPlayedGame = name;
      }
    });
    return {
      totalSessions,
      totalPlayTimeMin,
      avgSessionMin,
      mostPlayedGame,
      mostPlayedGameTimeMin,
    };
  }, [displayedSessions]);

  // Build the chart data from the filtered sessions. `aggregation` is the
  // temporal bucketing the parent toolbar selected; daily / weekly /
  // monthly roll-ups. The bars/lines always show playtime-in-minutes so
  // units stay consistent across modes.
  const chartData = useMemo(
    () => buildPlaytimeChart(displayedSessions, aggregation),
    [displayedSessions, aggregation],
  );

  // Donut slices — at most 8 of each, picked from the all-time stats so
  // the breakdown isn't disturbed by the currently filtered range.
  const genreSlices = useMemo(
    () =>
      allStats.genreBreakdown.slice(0, 8).map((g, i) => ({
        label: g.genre,
        value: g.minutes,
        color: DONUT_PALETTE[i % DONUT_PALETTE.length],
      })),
    [allStats.genreBreakdown],
  );

  const platformSlices = useMemo(
    () =>
      allStats.platformBreakdown.slice(0, 8).map((p, i) => ({
        label: p.platform,
        value: p.minutes,
        color: DONUT_PALETTE[i % DONUT_PALETTE.length],
      })),
    [allStats.platformBreakdown],
  );

  // Net minutes played across the visible window (formatted for the
  // chart subtitle so the user can see what they're looking at).
  const totalMinutes = rangedStats.totalPlayTimeMin;

  return (
    <>
      {/* ── Top stats pills ──────────────────────────────────────────────── */}
      <div className="activity-stats-bar">
        <StatPill
          label="Total Sessions"
          value={String(rangedStats.totalSessions)}
        />
        <StatPill
          label="Play Time (Window)"
          value={formatPlayTime(rangedStats.totalPlayTimeMin)}
          highlight
        />
        <StatPill
          label="Avg Session"
          value={formatPlayTime(rangedStats.avgSessionMin)}
        />
        <StatPill
          label="Total Library Time"
          value={formatPlayTime(allStats.totalPlayTimeMin)}
        />
        <StatPill
          label="Most Played"
          value={rangedStats.mostPlayedGame}
        />
      </div>

      {/* ── Main playtime chart ─────────────────────────────────────────── */}
      <div className="activity-main-chart">
        <div className="activity-main-chart__header">
          <div className="activity-main-chart__header-left">
            <h3 className="activity-main-chart__title">
              Playtime by {aggregation === "day" ? "Day" : aggregation === "week" ? "Week" : "Month"}
            </h3>
            <span className="activity-main-chart__subtitle">
              {formatPlayTime(totalMinutes)} · {dateRange === "all" ? "All time" : dateRange.toUpperCase()}
            </span>
          </div>
        </div>
        <div className="activity-main-chart__body">
          {chartData.data.length === 0 ? (
            <div className="activity-main-chart--empty">
              No sessions in the selected range.
            </div>
          ) : chartType === "bar" ? (
            <BarChart
              data={chartData.data}
              labels={chartData.labels}
              width={640}
              height={220}
              formatValue={(v) => formatPlayTime(Math.round(v))}
            />
          ) : (
            <LineChart
              series={[
                {
                  data: chartData.data,
                  color: "var(--color-brand-teal)",
                  label: "Minutes",
                },
              ]}
              labels={chartData.labels}
              width={640}
              height={220}
              formatValue={(v) => `${Math.round(v)}m`}
              legend={false}
              fillOpacity={0.18}
            />
          )}
        </div>
      </div>

      {/* ── Genre + Platform donut breakdowns ───────────────────────────── */}
      <div className="activity__two-column">
        <div className="section-panel platform-breakdown">
          <h3 className="section-panel__title">Play Time by Platform</h3>
          <div className="platform-breakdown__content">
            {platformSlices.length === 0 ? (
              <div className="section-panel__empty">
                No platform data yet. Play a session to populate this chart.
              </div>
            ) : (
              <DonutChart
                slices={platformSlices}
                size={180}
                innerRadius={50}
                showLegend
                formatValue={(v) => formatPlayTime(Math.round(v))}
              />
            )}
          </div>
        </div>

        <div className="section-panel genre-breakdown">
          <h3 className="section-panel__title">Play Time by Genre</h3>
          <div className="genre-breakdown__content">
            {genreSlices.length === 0 ? (
              <div className="section-panel__empty">
                Genre data comes from IGDB-tagged games. Fetch metadata from
                a game's page to populate this chart.
              </div>
            ) : (
              <DonutChart
                slices={genreSlices}
                size={180}
                innerRadius={50}
                showLegend
                formatValue={(v) => formatPlayTime(Math.round(v))}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function StatPill({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        "activity-stats-bar__pill" +
        (highlight ? " activity-stats-bar__pill--highlight" : "")
      }
    >
      <div className="activity-stats-bar__pill-icon">
        {/* Shared with the rest of the tab UI's icon set so the size +
            colour treatment stay consistent (the StatPill "icon-pill"
            look matches the other tab headers). */}
        <Icons.Activity size={14} />
      </div>
      <div className="activity-stats-bar__pill-content">
        <span className="activity-stats-bar__pill-label">{label}</span>
        <span className="activity-stats-bar__pill-value" title={value}>
          {value}
        </span>
      </div>
    </div>
  );
}

/**
 * Build playtime-in-minutes buckets for the main chart, bucketed by the
 * selected aggregation level. Bucketing uses the UTC calendar (matching
 * the session `date` ISO-string format) so the offset doesn't drift
 * across DST changes.
 */
function buildPlaytimeChart(
  sessions: GameSession[],
  aggregation: AggregationType,
): { data: number[]; labels: string[] } {
  if (sessions.length === 0) return { data: [], labels: [] };

  // Map of bucketKey → minutesPlayed. bucketKey differs per aggregation:
  //  - "day"   → YYYY-MM-DD
  //  - "week"  → ISO week start (Monday)
  //  - "month" → YYYY-MM
  const buckets = new Map<string, number>();
  const labelByKey = new Map<string, string>();

  for (const sess of sessions) {
    const d = new Date(sess.date);
    const key = bucketKey(d, aggregation);
    buckets.set(key, (buckets.get(key) || 0) + sess.durationMin);
    if (!labelByKey.has(key)) {
      labelByKey.set(key, bucketLabel(d, aggregation));
    }
  }

  // Sort by bucketKey so the chart timeline reads left-to-right naturally.
  // String sort works for YYYY-MM-DD / YYYY-MM / ISO week keys because
  // they're all zero-padded lexicographic-friendly formats.
  const sortedKeys = Array.from(buckets.keys()).sort();
  return {
    data: sortedKeys.map((k) => buckets.get(k) || 0),
    labels: sortedKeys.map((k) => labelByKey.get(k) || k),
  };
}

function bucketKey(d: Date, aggregation: AggregationType): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  if (aggregation === "month") return `${y}-${m}`;
  if (aggregation === "day") return `${y}-${m}-${day}`;
  // week → Monday of that ISO week
  const dow = d.getDay(); // 0 = Sun, 1 = Mon, ...
  const offset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(d);
  monday.setDate(d.getDate() + offset);
  const my = monday.getFullYear();
  const mm = String(monday.getMonth() + 1).padStart(2, "0");
  const md = String(monday.getDate()).padStart(2, "0");
  return `${my}-${mm}-${md}`;
}

function bucketLabel(d: Date, aggregation: AggregationType): string {
  if (aggregation === "month") {
    return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  }
  if (aggregation === "week") {
    // Show "Mon DD" of the week
    const dow = d.getDay();
    const offset = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(d);
    monday.setDate(d.getDate() + offset);
    return monday.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
