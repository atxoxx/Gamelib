import { useMemo, useState } from "react";
import LineChart from "./charts/LineChart";
import { formatCompactPlayerCount } from "./SteamPlayerCount";
import {
  useSteamPlayerHistory,
  type PlayerHistoryRange,
} from "../hooks/useSteamPlayerHistory";

/**
 * SteamPlayerHistoryChart
 *
 *  Historical concurrent-player line chart for the Steam stats popover.
 *  Replaces the old 24h sparkline with a proper long-range graph backed
 *  by the free steamcharts.com CCU feed (same data SteamDB charts show).
 *
 *  Layout
 *  ──────
 *    ┌─────────────────────────────────────┐
 *    │  PLAYER ACTIVITY       30d 90d 180d ALL│  ← header + range toggle
 *    │  ┌─────────────────────────────┐    │
 *    │  │      __/\___/\_  (line)      │    │  ← LineChart (hover = tooltip)
 *    │  └─────────────────────────────┘    │
 *    │  1.2M   CUR   4.5M  PEAK  2.0M AVG  │  ← 3 stat tiles
 *    └─────────────────────────────────────┘
 *
 *  Hover behavior (the "with mouse hover" ask)
 *  ────────────────────────────────────────
 *  The `LineChart` already renders a crosshair + floating tooltip as the
 *  cursor moves across the plot, so pointing at any point reveals its
 *  date + exact concurrent-player count for free. This component just
 *  feeds it the data.
 *
 *  Range
 *  ─────
 *  30 / 90 / 180 days + All-time, defaulting to 90d (per product
 *  decision). Switching range re-filters the backend's cached full
 *  series in-memory — no second network call inside the TTL.
 */

interface SteamPlayerHistoryChartProps {
  appId: number | undefined;
}

type RangeOption = { label: string; value: PlayerHistoryRange };

const RANGE_OPTIONS: RangeOption[] = [
  { label: "30d", value: 30 },
  { label: "90d", value: 90 },
  { label: "180d", value: 180 },
  { label: "All", value: 0 },
];

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatLabel(ts: number, allTime: boolean): string {
  const d = new Date(ts);
  const mon = MONTHS[d.getMonth()];
  if (allTime) {
    const yy = String(d.getFullYear()).slice(-2);
    return `${mon} '${yy}`;
  }
  return `${mon} ${d.getDate()}`;
}

export default function SteamPlayerHistoryChart({
  appId,
}: SteamPlayerHistoryChartProps) {
  const [range, setRange] = useState<PlayerHistoryRange>(90);
  const { data, isLoading, error } = useSteamPlayerHistory(appId, range);

  const allTime = range === 0;

  const { series, labels } = useMemo(() => {
    if (!data || data.points.length === 0) {
      return { series: [], labels: [] as string[] };
    }
    const counts = data.points.map((p) => p.count);
    const lbls = data.points.map((p) => formatLabel(p.timestamp, allTime));
    return {
      series: [{ data: counts, color: "var(--color-accent)", label: "Players" }],
      labels: lbls,
    };
  }, [data, allTime]);

  if (!appId) return null;

  const showChart = !!data && data.points.length >= 2;
  const hasData = !!data && data.sampleCount > 0;

  return (
    <section className="steam-history-chart">
      <div className="steam-history-chart-header">
        <span className="steam-stats-popover-section-title">
          Player Activity
        </span>
        <div
          className="player-history-range-toggle"
          role="group"
          aria-label="Player history range"
        >
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              type="button"
              className={`player-history-range-btn ${
                range === opt.value ? "is-active" : ""
              }`.trim()}
              aria-pressed={range === opt.value}
              onClick={() => setRange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="steam-history-chart-plot">
        {isLoading && !hasData ? (
          <div className="steam-history-chart-skeleton">
            <div className="steam-history-chart-skeleton-bar" />
            <div className="steam-history-chart-skeleton-tiles">
              <span className="steam-stats-popover-skeleton-pill" />
              <span className="steam-stats-popover-skeleton-pill" />
              <span className="steam-stats-popover-skeleton-pill" />
            </div>
          </div>
        ) : error ? (
          <div className="steam-stats-popover-section-error">
            Player history unavailable
          </div>
        ) : showChart ? (
          <LineChart
            series={series}
            labels={labels}
            height={180}
            smooth
            niceMax
            legend={false}
            fillOpacity={0.12}
            formatValue={formatCompactPlayerCount}
          />
        ) : (
          <div className="steam-stats-popover-activity-empty">
            <span
              className="steam-stats-popover-activity-empty-dot"
              aria-hidden="true"
            />
            <span className="steam-stats-popover-activity-empty-text">
              No history yet — check back soon.
            </span>
          </div>
        )}
      </div>

      {hasData && data && (
        <div className="steam-history-chart-stats">
          <HistoryStat
            label="Current"
            value={formatCompactPlayerCount(data.current)}
          />
          <HistoryStat
            label="Peak"
            value={formatCompactPlayerCount(data.peakInRange)}
          />
          <HistoryStat
            label="Avg"
            value={formatCompactPlayerCount(Math.round(data.averageInRange))}
          />
        </div>
      )}

      {hasData && data && data.peakAllTime > data.peakInRange && (
        <div className="steam-history-chart-footnote">
          All-time peak {formatCompactPlayerCount(data.peakAllTime)}
        </div>
      )}
    </section>
  );
}

function HistoryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="steam-history-chart-stat">
      <span className="steam-history-chart-stat-value">{value}</span>
      <span className="steam-history-chart-stat-label">{label}</span>
    </div>
  );
}
