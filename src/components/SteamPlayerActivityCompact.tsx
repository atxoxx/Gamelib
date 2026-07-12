import { useId, useMemo } from "react";
import { usePlayerCountHistory } from "../hooks/usePlayerCountHistory";
import type { PlayerCountHistory as PlayerCountHistoryType } from "../types/game";

/**
 * SteamPlayerActivityCompact
 *
 *  Compact 24h player activity chart for the Steam stats popover. Renders
 *  a tight sparkline + three tiny stat pills (Peak / Avg / Samples) below
 *  it. The card on the Game page's activity tab is the full-fat version
 *  with its own header / status pulse / longer footer; this one is the
 *  "fits-in-a-popover" cut that still surfaces the same headline data.
 *
 *  Layout
 *  ──────
 *    ┌─────────────────────────────────────┐
 *    │  PLAYER ACTIVITY · 24H     ● Live   │  ← section header
 *    │  ┌─────────────────────────────┐    │
 *    │  │     /\___/\__/\___/\__/      │    │  ← SVG sparkline
 *    │  └─────────────────────────────┘    │
 *    │  1,247     PEAK 4,512  AVG 2,034  │  ← 3 stat tiles inline
 *    └─────────────────────────────────────┘
 *
 *  Behavior
 *  ────────
 *  - Polls the Rust ring buffer every 60s via `usePlayerCountHistory`,
 *    refreshes on focus. Reused hook — same code path as the full card.
 *  - Renders nothing useful when `appId` is `undefined`; the parent
 *    shouldn't mount us in that case but the defensive early return
 *    keeps us safe.
 *  - Three render states:
 *      * Loading (first fetch of a new appid) → skeleton chart +
 *        skeleton stat tiles
 *      * Loaded with ≥2 points → sparkline + real stat tiles
 *      * Loaded with 0–1 points → "Collecting data…" placeholder +
 *        the current reading if available
 *
 *  Geometry
 *  ────────
 *  Same `viewBox` + `preserveAspectRatio="none"` pattern as the full
 *  card so the SVG stretches to whatever width the popover gives it
 *  without re-rendering on resize. Y-axis auto-scales to the peak in
 *  the window so a spike doesn't compress the rest of the line.
 */

interface SteamPlayerActivityCompactProps {
  appId: number | undefined;
}

export default function SteamPlayerActivityCompact({
  appId,
}: SteamPlayerActivityCompactProps) {
  if (!appId) return null;
  return <SteamPlayerActivityCompactInner appId={appId} />;
}

function SteamPlayerActivityCompactInner({ appId }: { appId: number }) {
  const { data, isLoading } = usePlayerCountHistory(appId);

  // React-provided unique id so the SVG gradient stops don't collide
  // when multiple popovers are mounted on the same page (e.g. if the
  // Game page + a future comparison card ever render side-by-side).
  // `useId` is stable across re-renders for a given component instance.
  const reactId = useId();
  const gradId = `steam-stats-popover-activity-grad-${reactId.replace(/:/g, "")}`;

  // X-axis / Y-axis / path data for the SVG sparkline. Memoized
  // because the curve computation is O(N) in points.length, and
  // polling will otherwise re-run it 60×/hour for free.
  const pathData = useMemo(() => {
    if (!data || data.points.length < 2) return null;
    return buildSparklinePath(data);
  }, [data]);

  // Whether the data is "live" — has at least one sample. Drives the
  // colored pulse dot in the section header.
  const hasData = !!data && data.sampleCount > 0;

  // Provenance-aware aria summary so screen readers always get a
  // complete sentence even when the chart hasn't drawn yet. We
  // compute it from the raw `data` (which can be null) so the
  // `pathData`-guarded JSX below can safely use it without the
  // "data is possibly null" narrowing TypeScript would otherwise
  // demand at every access.
  const ariaSummary = `Player activity over the last 24 hours. Peak ${data?.peak?.toLocaleString() ?? "—"}. Average ${data?.average != null ? Math.round(data.average).toLocaleString() : "—"} across ${data?.sampleCount ?? 0} samples.`;

  return (
    <section className="steam-stats-popover-activity">
      <div className="steam-stats-popover-section-header">
        <span className="steam-stats-popover-section-title">
          Player Activity · 24h
        </span>
        {isLoading && data == null ? (
          <span className="steam-stats-popover-section-empty">Loading…</span>
        ) : hasData ? (
          <span className="steam-stats-popover-activity-live">
            <span
              className="steam-stats-popover-activity-live-dot"
              aria-hidden="true"
            />
            Live
          </span>
        ) : (
          <span className="steam-stats-popover-section-empty">Awaiting data</span>
        )}
      </div>

      <div className="steam-stats-popover-activity-chart">
        {pathData ? (
          <svg
            className="steam-stats-popover-activity-svg"
            viewBox={`0 0 ${pathData.viewW} ${pathData.viewH}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={ariaSummary}
          >
            <defs>
              <linearGradient
                id={gradId}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="0%"
                  style={{ stopColor: "var(--color-accent)" }}
                  stopOpacity="0.5"
                />
                <stop
                  offset="100%"
                  style={{ stopColor: "var(--color-accent)" }}
                  stopOpacity="0"
                />
              </linearGradient>
            </defs>

            {/* Baseline sits behind the line so a flat-zero chart
             * still has a visible floor. */}
            <line
              x1="0"
              y1={pathData.viewH - 2}
              x2={pathData.viewW}
              y2={pathData.viewH - 2}
              className="steam-stats-popover-activity-baseline"
            />

            {pathData.areaPath && (
              <path
                d={pathData.areaPath}
                fill={`url(#${gradId})`}
              />
            )}
            <path
              d={pathData.linePath}
              fill="none"
              className="steam-stats-popover-activity-line"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {pathData.lastPoint && (
              <circle
                cx={pathData.lastPoint.x}
                cy={pathData.lastPoint.y}
                r="2.5"
                className="steam-stats-popover-activity-now-dot"
              />
            )}
          </svg>
        ) : (
          <div className="steam-stats-popover-activity-empty">
            <span
              className="steam-stats-popover-activity-empty-dot"
              aria-hidden="true"
            />
            <span className="steam-stats-popover-activity-empty-text">
              {isLoading
                ? "Collecting first reading…"
                : "Collecting data — the chart will appear after a few samples."}
            </span>
          </div>
        )}
      </div>

      <div className="steam-stats-popover-activity-stats">
        <ActivityStat
          label="Current"
          value={
            data && data.current != null && data.current > 0
              ? data.current.toLocaleString()
              : "—"
          }
        />
        <ActivityStat
          label="Peak"
          value={data?.peak != null ? data.peak.toLocaleString() : "—"}
        />
        <ActivityStat
          label="Avg"
          value={
            data?.average != null
              ? Math.round(data.average).toLocaleString()
              : "—"
          }
        />
      </div>
    </section>
  );
}

function ActivityStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="steam-stats-popover-activity-stat">
      <span className="steam-stats-popover-activity-stat-value">{value}</span>
      <span className="steam-stats-popover-activity-stat-label">{label}</span>
    </div>
  );
}

// ─── Sparkline geometry ─────────────────────────────────────────────────────

interface SparklinePath {
  viewW: number;
  viewH: number;
  linePath: string;
  areaPath: string;
  lastPoint: { x: number; y: number } | null;
}

// Tighter viewBox than the full card so the line has a bit more
// breathing room at the 360px popover width.
const VIEW_W = 320;
const VIEW_H = 56;
const PAD_X = 3;
const PAD_Y = 4;

function buildSparklinePath(
  data: PlayerCountHistoryType
): SparklinePath | null {
  if (data.points.length < 2) return null;

  const ys = data.points.map((p) => p.count);
  const minVal = Math.min(...ys, 0);
  const maxVal = Math.max(...ys, 1);
  const range = maxVal - minVal || 1;

  const innerW = VIEW_W - PAD_X * 2;
  const innerH = VIEW_H - PAD_Y * 2;
  const stepX = innerW / Math.max(data.points.length - 1, 1);

  const points = data.points.map((p, i) => ({
    x: PAD_X + i * stepX,
    y: PAD_Y + innerH - ((p.count - minVal) / range) * innerH,
  }));

  const linePath =
    `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}` +
    points
      .slice(1)
      .map((pt) => ` L ${pt.x.toFixed(1)},${pt.y.toFixed(1)}`)
      .join("");

  const last = points[points.length - 1];
  const first = points[0];
  const areaPath =
    linePath +
    ` L ${last.x.toFixed(1)},${(VIEW_H - PAD_Y).toFixed(1)}` +
    ` L ${first.x.toFixed(1)},${(VIEW_H - PAD_Y).toFixed(1)} Z`;

  return {
    viewW: VIEW_W,
    viewH: VIEW_H,
    linePath,
    areaPath,
    lastPoint: { x: last.x, y: last.y },
  };
}
