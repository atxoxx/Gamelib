import { useMemo } from "react";
import { usePlayerCountHistory } from "../hooks/usePlayerCountHistory";
import type { PlayerCountHistory as PlayerCountHistoryType } from "../types/game";

/**
 * PlayerCountSparklineCard
 *
 *  Compact sparkline + summary card for the Game page's Activity tab.
 *  Renders the last 24h of concurrent-player counts for the
 *  associated Steam appid, with current / peak / average / sample
 *  count stats below the line.
 *
 *  ── What it shows ──
 *
 *  ┌─────────────────────────────────────────────────┐
 *  │  Player Activity (24h)            ● collecting…  │
 *  │                                                  │
 *  │  1,247 playing                                   │
 *  │   /\__/\___/\__/\__/\____/\____                  │
 *  │                                                  │
 *  │  Peak 4,512   ·   Avg 2,034   ·   1,440 samples │
 *  └─────────────────────────────────────────────────┘
 *
 *  ── Behavior ──
 *
 *  - Polls the Rust ring buffer via `usePlayerCountHistory` every
 *    60s, refreshes on window focus, matches the badge's polling
 *    cadence exactly.
 *  - Renders nothing when `appId` is `undefined` (non-Steam
 *    library entries). The parent tab is responsible for not
 *    mounting the card in that case.
 *  - Three render states:
 *      * Loading (first fetch of a new appid) → skeleton
 *      * Loaded with ≥2 points → sparkline + stats
 *      * Loaded with 0–1 points → "Collecting data…" with a
 *        subtle pulse, plus the current reading if available
 *
 *  ── Sparkline geometry ──
 *
 *  The custom SVG sparkline uses `viewBox` with
 *  `preserveAspectRatio="none"` so it stretches to whatever width
 *  the parent column gives it without re-rendering on resize. The
 *  Y-axis auto-scales to the peak observed in the window so a
 *  spike doesn't compress the rest of the line. An `aria-label`
 *  on the root provides a stable screen-reader summary that
 *  doesn't change on every 60s tick.
 */

interface PlayerCountSparklineCardProps {
  appId: number | undefined;
}

export default function PlayerCountSparklineCard({
  appId,
}: PlayerCountSparklineCardProps) {
  // Non-Steam games (or games with no appid) shouldn't render the
  // card at all — the parent should not mount us, but the
  // defensive `if (!appId) return null` keeps us safe if it does.
  if (!appId) return null;

  return <PlayerCountSparklineCardInner appId={appId} />;
}

function PlayerCountSparklineCardInner({ appId }: { appId: number }) {
  const { data, isLoading, lastUpdated } = usePlayerCountHistory(appId);

  // X-axis / Y-axis / path data for the SVG sparkline. Memoized
  // because the curve computation is O(N) in points.length, and
  // polling will otherwise re-run it 60×/hour for free.
  const pathData = useMemo(() => {
    if (!data || data.points.length < 2) return null;
    return buildSparklinePath(data);
  }, [data]);

  // The screen-reader summary string. Re-rendered on every data
  // update (polling tick) but only `aria-label` consumers (screen
  // readers) actually read it — and the polite update doesn't
  // interrupt the user's flow.
  const ariaLabel = useMemo(() => {
    if (!data || data.sampleCount === 0) {
      return "Player activity over the last 24 hours. No data yet.";
    }
    const peak = data.peak?.toLocaleString() ?? "—";
    const avg = data.average != null ? Math.round(data.average).toLocaleString() : "—";
    const current = data.current?.toLocaleString() ?? "—";
    return `Player activity over the last ${formatWindow(data.windowEndMs - data.windowStartMs)}. ` +
      `Currently ${current} playing. ` +
      `Peak ${peak}. Average ${avg} across ${data.sampleCount} samples.`;
  }, [data]);

  return (
    <div className="player-sparkline-card" aria-label={ariaLabel}>
      <header className="player-sparkline-card__header">
        <div className="player-sparkline-card__title-group">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="player-sparkline-card__icon"
          >
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <h3 className="player-sparkline-card__title">
            Player Activity
            <span className="player-sparkline-card__subtitle">Last 24 hours on Steam</span>
          </h3>
        </div>
        <div className="player-sparkline-card__status">
          {isLoading && data == null ? (
            <span className="player-sparkline-card__status-text">Loading…</span>
          ) : data && data.sampleCount > 0 ? (
            <>
              <span className="player-sparkline-card__status-dot" aria-hidden="true" />
              <span className="player-sparkline-card__status-text">Live</span>
            </>
          ) : (
            <span className="player-sparkline-card__status-text">Awaiting data</span>
          )}
        </div>
      </header>

      <div className="player-sparkline-card__body">
        {data && data.current != null && data.current > 0 && (
          <div className="player-sparkline-card__current">
            <span className="player-sparkline-card__current-value">
              {data.current.toLocaleString()}
            </span>
            <span className="player-sparkline-card__current-label">
              playing right now
            </span>
          </div>
        )}

        <div className="player-sparkline-card__chart">
          {pathData ? (
            <svg
              className="player-sparkline-card__svg"
              viewBox={`0 0 ${pathData.viewW} ${pathData.viewH}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={ariaLabel}
            >
              <defs>
                {/* SVG presentation attributes don't resolve CSS
                 * custom properties (stopColor="var(--…)" falls
                 * back to the default). Inline `style` resolves in
                 * a real CSS context. */}
                <linearGradient
                  id="player-sparkline-card-grad"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    style={{ stopColor: "var(--color-accent)" }}
                    stopOpacity="0.45"
                  />
                  <stop
                    offset="100%"
                    style={{ stopColor: "var(--color-accent)" }}
                    stopOpacity="0"
                  />
                </linearGradient>
              </defs>

              {/* Subtle baseline so the user can see "zero" when
               * counts drop to nothing. Drawn before the line so
               * it sits behind it. */}
              <line
                x1="0"
                y1={pathData.viewH - 2}
                x2={pathData.viewW}
                y2={pathData.viewH - 2}
                className="player-sparkline-card__baseline"
              />

              {pathData.areaPath && (
                <path
                  d={pathData.areaPath}
                  fill="url(#player-sparkline-card-grad)"
                />
              )}
              <path
                d={pathData.linePath}
                fill="none"
                className="player-sparkline-card__line"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Right-edge "now" dot. Drawn last so it sits on top
               * of the line. */}
              {pathData.lastPoint && (
                <circle
                  cx={pathData.lastPoint.x}
                  cy={pathData.lastPoint.y}
                  r="3"
                  className="player-sparkline-card__now-dot"
                />
              )}
            </svg>
          ) : (
            <div className="player-sparkline-card__empty">
              <span className="player-sparkline-card__empty-dot" aria-hidden="true" />
              <span className="player-sparkline-card__empty-text">
                {isLoading
                  ? "Collecting first reading…"
                  : "Collecting data — the chart will appear after a few samples."}
              </span>
            </div>
          )}
        </div>
      </div>

      {data && data.sampleCount > 0 && (
        <footer className="player-sparkline-card__footer">
          <div className="player-sparkline-card__stat">
            <span className="player-sparkline-card__stat-label">Peak</span>
            <span className="player-sparkline-card__stat-value">
              {data.peak?.toLocaleString() ?? "—"}
            </span>
          </div>
          <div className="player-sparkline-card__stat-divider" aria-hidden="true" />
          <div className="player-sparkline-card__stat">
            <span className="player-sparkline-card__stat-label">Avg</span>
            <span className="player-sparkline-card__stat-value">
              {data.average != null
                ? Math.round(data.average).toLocaleString()
                : "—"}
            </span>
          </div>
          <div className="player-sparkline-card__stat-divider" aria-hidden="true" />
          <div className="player-sparkline-card__stat">
            <span className="player-sparkline-card__stat-label">Samples</span>
            <span className="player-sparkline-card__stat-value">
              {data.sampleCount.toLocaleString()}
            </span>
          </div>
          {lastUpdated > 0 && (
            <div className="player-sparkline-card__updated">
              Updated {formatRelative(Date.now() - lastUpdated)} ago
            </div>
          )}
        </footer>
      )}
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

const VIEW_W = 600;
const VIEW_H = 80;
const PAD_X = 4;
const PAD_Y = 6;

/**
 * Build the SVG path strings for the sparkline. Pure function so
 * it's trivially memoizable on the points array.
 *
 *  - X-axis: oldest sample on the left, newest on the right.
 *    We map the full 24h window to the viewBox width, so a freshly
 *    filled buffer doesn't compress to a tiny slice on the left.
 *  - Y-axis: auto-scales to the peak observed in the window. The
 *    min isn't pinned to 0 because a game that always has 5K–6K
 *    players would render as a flat line at the top of the chart
 *    if we did — the user wants to see *variation*, not the
 *    absolute zero.
 *  - Area path is a closed polygon below the line, used for the
 *    gradient fill.
 */
function buildSparklinePath(data: PlayerCountHistoryType): SparklinePath | null {
  if (data.points.length < 2) return null;

  const ys = data.points.map((p) => p.count);
  const minVal = Math.min(...ys, 0);
  const maxVal = Math.max(...ys, 1);
  // If all points are equal, the line is flat at the top of the
  // chart. Add a tiny range so the flat line is visible rather
  // than collapsing to a point.
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

// ─── Formatters ─────────────────────────────────────────────────────────────

/** "2h 14m" / "47m" / "12s" — short relative-time formatter for the
 *  "Updated Xs ago" line in the footer. */
function formatRelative(deltaMs: number): string {
  const s = Math.max(0, Math.round(deltaMs / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) return remM > 0 ? `${h}h ${remM}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

/** "12h" / "47m" / "23h 14m" — used inside the aria-label so the
 *  screen reader doesn't read the literal ms-since-epoch span. */
function formatWindow(ms: number): string {
  if (ms <= 0) return "window";
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `${totalMin} minutes`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h} hours`;
  const d = Math.floor(h / 24);
  return `${d} days`;
}
