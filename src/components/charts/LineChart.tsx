import { useMemo, useState, useCallback, useRef, useLayoutEffect } from "react";

interface Series {
  data: number[];
  color: string;
  label: string;
}

export interface ChartThreshold {
  value: number;
  label?: string;
  color?: string;
}

export interface ChartBand {
  from: number;
  to: number;
  color?: string;
  opacity?: number;
}

interface LineChartProps {
  series: Series[];
  labels: string[];
  width?: number;
  height?: number;
  formatValue?: (v: number) => string;
  /**
   * Optional rich formatter used only for the floating tooltip. Falls back to
   * `formatValue` when omitted. Accepts a ReactNode so the tooltip can render
   * multi-line content (e.g. percentage on the first row, raw GB on the second
   * when a value exceeds 100%).
   */
  formatTooltipValue?: (v: number) => React.ReactNode;
  legend?: boolean;
  fillOpacity?: number;
  minY?: number;
  maxY?: number;
  /** Render smooth Catmull-Rom splines instead of straight segments. */
  smooth?: boolean;
  /**
   * When `maxY` is not supplied, round the auto-computed maximum up to a
   * "nice" round number so the Y-axis reads 0/30/60/… instead of 0/28/57/….
   */
  niceMax?: boolean;
  /** Dashed horizontal reference lines (e.g. a 60 FPS target or 85°C danger). */
  thresholds?: ChartThreshold[];
  /** Shaded vertical regions spanning a value range (e.g. a hot-zone band). */
  bands?: ChartBand[];
}

/** Round a value up to the nearest "nice" number (1/2/2.5/5/10 × 10ⁿ). */
function niceCeil(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const f = v / base;
  let nf: number;
  if (f <= 1) nf = 1;
  else if (f <= 2) nf = 2;
  else if (f <= 2.5) nf = 2.5;
  else if (f <= 5) nf = 5;
  else nf = 10;
  return nf * base;
}

/**
 * Build a smooth path through the given pixel-space points using a
 * Catmull-Rom → cubic Bézier conversion. Produces a natural, continuous
 * curve without the kinks of straight segments.
 */
function buildSmoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length < 3) {
    return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  }
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  return d;
}

export default function LineChart({
  series,
  labels,
  width = 640,
  height = 280,
  formatValue = (v) => String(v),
  formatTooltipValue,
  legend = true,
  fillOpacity = 0.08,
  minY,
  maxY,
  smooth = false,
  niceMax = false,
  thresholds,
  bands,
}: LineChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  // Measure the real rendered width so the SVG viewBox matches the element
  // exactly. A fixed 640-wide viewBox inside a wider/narrower container is
  // letterboxed by the default `preserveAspectRatio="xMidYMid meet"`, which
  // is what makes the hover crosshair / tooltip drift away from the cursor.
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const effectiveWidth = measuredWidth && measuredWidth > 0 ? measuredWidth : width;
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setMeasuredWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const chart = useMemo(() => {
    // Padding tuned for the new default height (280px): a touch more room at
    // the top/bottom gives the area-fill and X-axis labels breathing space,
    // and a slightly wider left gutter keeps 4-digit Y-axis labels (e.g.
    // "100 %") from clipping. Right gutter stays slim — the floating
    // tooltip can render past the chart bounds when it would otherwise
    // overflow the right edge.
    const padding = { top: 20, right: 20, bottom: 32, left: 48 };
    const chartW = effectiveWidth - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const allValues = series.flatMap((s) => s.data);

    // Use explicit bounds if provided, otherwise fallback to dynamic calculation
    const rawMax = Math.max(...allValues, 0);
    const computedMax = niceMax ? niceCeil(rawMax) : rawMax;
    const maxVal = maxY !== undefined ? maxY : computedMax;
    const minVal = minY !== undefined ? minY : Math.min(...allValues, 0);
    const range = maxVal - minVal || 1;

    return { padding, chartW, chartH, maxVal, minVal, range };
  }, [series, effectiveWidth, height, minY, maxY, niceMax]);

  // Label stepping: when there are more than ~12 x-axis labels we sample
  // them down so they don't overlap. Every Nth label + always render the
  // first and last so the viewer can orient themselves. Empty strings in
  // between preserve the original index→position mapping for hover coords.
  const labelStep = useMemo(() => {
    const maxLabels = 12;
    return Math.max(1, Math.ceil(labels.length / maxLabels));
  }, [labels.length]);

  const { padding, chartW, chartH, minVal, maxVal, range } = chart;

  const gridLines = 5;
  const gridValues = Array.from({ length: gridLines + 1 }, (_, i) =>
    Math.round(minVal + (range / gridLines) * i)
  );

  const yForValue = useCallback(
    (v: number) => padding.top + chartH - ((v - minVal) / range) * chartH,
    [padding.top, chartH, minVal, range]
  );

  function buildPath(data: number[]): string {
    if (data.length === 0) return "";
    return data
      .map((v, i) => {
        const x = padding.left + (i / Math.max(data.length - 1, 1)) * chartW;
        const y = padding.top + chartH - ((v - minVal) / range) * chartH;
        return `${i === 0 ? "M" : "L"}${x},${y}`;
      })
      .join(" ");
  }

  function buildArea(data: number[]): string {
    if (data.length === 0) return "";
    const path = buildPath(data);
    const lastX = padding.left + chartW;
    const bottomY = padding.top + chartH;
    return `${path} L${lastX},${bottomY} L${padding.left},${bottomY} Z`;
  }

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const scaleX = effectiveWidth / rect.width;
      const mouseX = (e.clientX - rect.left) * scaleX;

      // Find nearest data point based on X position. Hovering anywhere
      // in the chart (including the axis gutters) snaps to the nearest
      // endpoint, so the first/last points aren't dead zones.
      const dataLen = series[0]?.data.length ?? 0;
      if (dataLen === 0) return;
      let idx: number;
      if (mouseX <= padding.left) idx = 0;
      else if (mouseX >= padding.left + chartW) idx = dataLen - 1;
      else idx = Math.round(((mouseX - padding.left) / chartW) * (dataLen - 1));
      const clampedIdx = Math.max(0, Math.min(dataLen - 1, idx));

      setHoverIndex(clampedIdx);
    },
    [effectiveWidth, height, padding.left, chartW, chartH, padding.top, series]
  );

  const handleMouseLeave = useCallback(() => {
    setHoverIndex(null);
  }, []);

  // Compute data point positions for all series
  const pointPositions = useMemo(() => {
    return series.map((s) =>
      s.data.map((v, i) => {
        const x = padding.left + (i / Math.max(s.data.length - 1, 1)) * chartW;
        const y = padding.top + chartH - ((v - minVal) / range) * chartH;
        return { x, y };
      })
    );
  }, [series, padding.left, chartW, chartH, minVal, range]);

  // Tooltip values for hovered index
  const tooltipValues =
    hoverIndex !== null
      ? series.map((s, si) => ({
          label: s.label,
          value: s.data[hoverIndex] ?? 0,
          color: s.color,
          y: pointPositions[si]?.[hoverIndex]?.y ?? 0,
        }))
      : null;

  const crosshairX =
    hoverIndex !== null && pointPositions[0]?.[hoverIndex]
      ? pointPositions[0][hoverIndex].x
      : null;

  const seriesLinePath = (si: number): string =>
    smooth ? buildSmoothPath(pointPositions[si] ?? []) : buildPath(series[si].data);

  const seriesAreaPath = (si: number): string => {
    if (smooth) {
      const p = pointPositions[si];
      if (!p || p.length === 0) return "";
      const bottomY = padding.top + chartH;
      const line = buildSmoothPath(p);
      const lastX = p[p.length - 1].x;
      const firstX = p[0].x;
      return `${line} L ${lastX},${bottomY} L ${firstX},${bottomY} Z`;
    }
    return buildArea(series[si].data);
  };

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${effectiveWidth} ${height}`}
        width="100%"
        height={height}
        style={{ fontFamily: "inherit", cursor: "crosshair" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Shaded bands (drawn under grid + series) */}
        {bands?.map((band, bi) => {
          const lo = Math.min(band.from, band.to);
          const hi = Math.max(band.from, band.to);
          if (hi < minVal || lo > maxVal) return null;
          const yHi = yForValue(Math.min(hi, maxVal));
          const yLo = yForValue(Math.max(lo, minVal));
          const color = band.color ?? "var(--color-danger)";
          return (
            <rect
              key={`band-${bi}`}
              x={padding.left}
              y={yHi}
              width={chartW}
              height={Math.max(0, yLo - yHi)}
              fill={color}
              opacity={band.opacity ?? 0.08}
            />
          );
        })}

        {/* Grid lines */}
        {gridValues.map((v, i) => {
          const y = padding.top + chartH - ((v - minVal) / range) * chartH;
          return (
            <g key={`grid-${i}`}>
              <line
                x1={padding.left}
                y1={y}
                x2={padding.left + chartW}
                y2={y}
                stroke="var(--color-border)"
                strokeWidth="1"
                strokeDasharray="4 4"
                opacity={0.5}
              />
              <text
                x={padding.left - 8}
                y={y + 4}
                textAnchor="end"
                fill="var(--color-text-muted)"
                fontSize="10"
              >
                {formatValue(v)}
              </text>
            </g>
          );
        })}

        {/* Series areas and lines */}
        {series.map((s, si) => (
          <g key={`series-${si}`}>
            <path d={seriesAreaPath(si)} fill={s.color} opacity={fillOpacity} />
            <path
              d={seriesLinePath(si)}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        ))}

        {/* Threshold reference lines (drawn over the series so they stay visible) */}
        {thresholds?.map((t, ti) => {
          if (t.value < minVal || t.value > maxVal) return null;
          const y = yForValue(t.value);
          const color = t.color ?? "var(--color-text-muted)";
          return (
            <g key={`thresh-${ti}`}>
              <line
                x1={padding.left}
                y1={y}
                x2={padding.left + chartW}
                y2={y}
                stroke={color}
                strokeWidth="1"
                strokeDasharray="5 4"
                opacity={0.7}
              />
              {t.label && (
                <text
                  x={padding.left + chartW - 4}
                  y={y - 4}
                  textAnchor="end"
                  fill={color}
                  fontSize="9"
                  fontWeight={600}
                  style={{ textTransform: "uppercase", letterSpacing: "0.4px" }}
                >
                  {t.label}
                </text>
              )}
            </g>
          );
        })}

        {/* Data dots (dimmed when hovering, except the active column) */}
        {pointPositions.map((points, si) =>
          points.map(({ x, y }, i) => {
            const isActive = hoverIndex === i;
            const isDimmed = hoverIndex !== null && hoverIndex !== i;
            return (
              <circle
                key={`dot-${si}-${i}`}
                cx={x}
                cy={y}
                r={isActive ? 5 : 3}
                fill={series[si].color}
                stroke="var(--color-bg-primary)"
                strokeWidth={isActive ? 2 : 1.5}
                opacity={isDimmed ? 0.3 : 1}
                style={{
                  transition: "opacity 150ms, r 150ms",
                  // Phase 2.9 PR 4: an outer-glow drop-shadow on the
                  // active dot telegraphs "this column is what you're
                  // pointing at" even when the cursor is two-three
                  // pixels off. The shadow inherits the series color
                  // so each line keeps its own hue and doesn't
                  // muddy the palette. Inactive dots stay flat so
                  // the only moving target is the active one.
                  filter: isActive
                    ? `drop-shadow(0 0 6px ${series[si].color})`
                    : "none",
                }}
              />
            );
          })
        )}

        {/* Crosshair vertical line */}
        {crosshairX !== null && (
          <line
            x1={crosshairX}
            y1={padding.top}
            x2={crosshairX}
            y2={padding.top + chartH}
            stroke="var(--color-text-muted)"
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity={0.6}
          />
        )}

        {/* Crosshair dots on lines */}
        {hoverIndex !== null &&
          pointPositions.map((points, si) => {
            const pt = points[hoverIndex];
            if (!pt) return null;
            return (
              <circle
                key={`cross-${si}`}
                cx={pt.x}
                cy={pt.y}
                r="5"
                fill={series[si].color}
                stroke="var(--color-bg-primary)"
                strokeWidth="2"
                style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.3))" }}
              />
            );
          })}

        {/* X-axis labels */}
        {labels.map((label, i) => {
          const x = padding.left + (i / Math.max(labels.length - 1, 1)) * chartW;
          const isActive = hoverIndex === i;
          // Show every Nth label so dense series don't overlap. The first
          // and last labels are always rendered for orientation.
          const showLabel =
            i === 0 ||
            i === labels.length - 1 ||
            i % labelStep === 0;
          if (!showLabel) return null;
          return (
            <text
              key={`label-${i}`}
              x={x}
              y={padding.top + chartH + 20}
              textAnchor="middle"
              fill={isActive ? "var(--color-text-primary)" : "var(--color-text-muted)"}
              fontSize={isActive ? "11" : "10"}
              fontWeight={isActive ? "600" : "400"}
              style={{ transition: "all 150ms" }}
            >
              {label}
            </text>
          );
        })}

        {/* Legend */}
        {legend && (
          <g transform={`translate(${padding.left}, ${height - 4})`}>
            {series.map((s, i) => {
              const legendX = i * 140;
              return (
                <g key={`leg-${i}`} transform={`translate(${legendX}, 0)`}>
                  <line
                    x1="0"
                    y1="0"
                    x2="16"
                    y2="0"
                    stroke={s.color}
                    strokeWidth="2.5"
                  />
                  <circle cx="8" cy="0" r="3" fill={s.color} />
                  <text
                    x="22"
                    y="4"
                    fill="var(--color-text-secondary)"
                    fontSize="11"
                  >
                    {s.label}
                  </text>
                </g>
              );
            })}
          </g>
        )}
      </svg>

      {/* Floating tooltip card */}
      {hoverIndex !== null && tooltipValues && (
        <div
          className="chart-tooltip-card"
          style={{
            position: "absolute",
            // Clamp horizontally so the card never spills past the
            // chart edges (the first point's tooltip used to get
            // pushed off-screen on the left).
            left:
              crosshairX !== null
                ? `clamp(4px, ${
                    ((crosshairX +
                      (crosshairX > effectiveWidth * 0.6 ? -176 : 8)) /
                      effectiveWidth) *
                    100
                  }%, calc(100% - 180px))`
                : "0%",
            top: "8px",
            pointerEvents: "none",
            zIndex: 20,
          }}
        >
          <div className="chart-tooltip-label">{labels[hoverIndex]}</div>
          <div className="chart-tooltip-values">
            {tooltipValues.map((tv, i) => (
              <div key={i} className="chart-tooltip-row">
                <span
                  className="chart-tooltip-dot"
                  style={{ background: tv.color }}
                />
                <span className="chart-tooltip-name">{tv.label}</span>
                <span className="chart-tooltip-val">
                  {formatTooltipValue
                    ? formatTooltipValue(tv.value)
                    : formatValue(tv.value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
