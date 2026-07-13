import { useMemo, useState, useCallback } from "react";

interface BarChartProps {
  data: number[];
  labels: string[];
  width?: number;
  height?: number;
  color?: string;
  formatValue?: (v: number) => string;
  tooltip?: boolean;
}

export default function BarChart({
  data,
  labels,
  width = 600,
  height = 220,
  color = "var(--color-accent)",
  formatValue = (v) => String(v),
  tooltip = true,
}: BarChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const chart = useMemo(() => {
    const padding = { top: 20, right: 16, bottom: 30, left: 40 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;
    const maxVal = Math.max(...data, 1);
    const barGap = Math.max(4, chartW / (data.length * 3));
    const barW = (chartW - barGap * (data.length - 1)) / data.length;

    // Adaptive x-axis label density. With 30+ days, 90+ days, or "all time"
    // the chart fans out to dozens or hundreds of bars; rendering a label
    // for every one produces illegible, overlapping text. We stride the
    // ticks so only ~ floor(chartW / labelBudgetPx) labels show, and we
    // always pin the first and last tick so the time boundaries are clear.
    const labelBudgetPx = 42;
    const maxLabels = Math.max(2, Math.floor(chartW / labelBudgetPx));
    const labelStride = Math.max(1, Math.ceil(data.length / maxLabels));
    // Suppress the "1h / 0h" label printed above each bar when the bar is
    // too narrow to hold any text legibly. In dense views this becomes a
    // wall of repeated "0h" glyphs; the hover tooltip remains the channel
    // for exact values.
    const showValuesOnTop = barW >= 24;

    return {
      padding,
      chartW,
      chartH,
      maxVal,
      barGap,
      barW,
      labelStride,
      showValuesOnTop,
    };
  }, [data, width, height]);

  const {
    padding,
    chartW,
    chartH,
    maxVal,
    barGap,
    barW,
    labelStride,
    showValuesOnTop,
  } = chart;

  const gridLines = 5;
  // Build y-axis tick values, then deduplicate. With tiny maxVal (e.g. 1
  // hour) naive rounding produces "0,0,0,0,1,1" — duplicated labels stack
  // at the top of the chart and visually saturate the y-axis. Drop dupes
  // while keeping every gridline (so the dashed lines still draw).
  const gridValues = Array.from({ length: gridLines + 1 }, (_, i) =>
    Math.round((maxVal / gridLines) * i)
  );

  const handleMouseEnter = useCallback((i: number) => {
    setHoverIndex(i);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoverIndex(null);
  }, []);

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        style={{ fontFamily: "inherit" }}
      >
        {/* Grid lines */}
        {(() => {
          // Dedup adjacent same-valued labels so the axis never reads
          // "0 \u00B7 0 \u00B7 0 \u00B7 0 \u00B7 1 \u00B7 1". We track which
          // labels have been emitted in logical Y-order (top of chart \u2192
          // bottom), so the first occurrence wins and lower duplicates are
          // suppressed. The dashed gridlines still render at every position.
          const seen = new Set<number>();
          return gridValues.map((v, i) => {
            const y = padding.top + chartH - (v / maxVal) * chartH;
            const isDup = seen.has(v);
            seen.add(v);
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
                {!isDup && (
                  <text
                    x={padding.left - 8}
                    y={y + 4}
                    textAnchor="end"
                    fill="var(--color-text-muted)"
                    fontSize="11"
                  >
                    {v}
                  </text>
                )}
              </g>
            );
          });
        })()}

        {/* Bars */}
        {data.map((value, i) => {
          const barH = (value / maxVal) * chartH;
          const x = padding.left + i * (barW + barGap);
          const y = padding.top + chartH - barH;
          const isHovered = hoverIndex === i;
          const isDimmed = hoverIndex !== null && hoverIndex !== i;

          // Tick-stride logic for x-axis labels. Only render a label if this
          // bar is on the stride, OR it's the last tick (so the right
          // boundary is always visible), OR the user is hovering this bar
          // (which "summons" the otherwise-culled label).
          const isStrideTick = i % labelStride === 0;
          const isLastTick = i === data.length - 1;
          // If a stride tick sits within ~60% of a stride of the final tick,
          // drop it — the final tick is always shown, and the two would
          // visually crowd each other (e.g. when stride=8, ticks at 80
          // and 88 with last at 89 are too close to bother rendering both).
          const collapsesWithLast =
            !isLastTick &&
            data.length - 1 - i < Math.ceil(labelStride * 0.6);
          const showXLabel =
            ((isStrideTick && !collapsesWithLast) || isLastTick) || isHovered;
          // Value-on-top is gated by bar width to prevent a wall of "0h"
          // labels in dense views; we also suppress literal "0" labels for
          // even cleaner rendering when the bar is empty.
          const showTopValue =
            (showValuesOnTop || isHovered) && value > 0;

          return (
            <g
              key={`bar-${i}`}
              className="chart-bar-group"
              style={{ cursor: "pointer" }}
              onMouseEnter={() => handleMouseEnter(i)}
              onMouseLeave={handleMouseLeave}
            >
              {/* Hit area (invisible, larger for easier hover) */}
              <rect
                x={x - barGap / 2}
                y={padding.top}
                width={barW + barGap}
                height={chartH}
                fill="transparent"
                style={{ pointerEvents: "all" }}
              />
              {/* Bar */}
              <rect
                x={x}
                y={y}
                width={Math.max(barW, 2)}
                height={Math.max(barH, 1)}
                rx="4"
                fill={color}
                opacity={isDimmed ? 0.35 : 0.85}
                style={{
                  transition: "opacity 200ms, filter 200ms",
                  filter: isHovered ? "brightness(1.3) drop-shadow(0 2px 4px rgba(0,0,0,0.3))" : "none",
                }}
              >
                {tooltip && <title>{labels[i]}: {formatValue(value)}</title>}
              </rect>
              {/*
                Phase 2.9 PR 4 ("data viz touches") — focus ring.
                A 2-px outset rect with stroke={color} that is only
                drawn when this bar is the hovered one. Paints AFTER
                the bar so SVG painter order puts the ring on top of
                the bar's body, not behind the next bar over. Pointer
                events disabled so the ring never intercepts the
                cursor that the bar group is listening for.
                strokeWidth + opacity both transition so the ring
                eases in and out cross-fade-friendly (matches the
                sibling-bar opacity ramp already in place). */}
              <rect
                x={x - 2}
                y={(value / maxVal) * chartH === 0 ? padding.top + chartH - 4 : y - 2}
                width={barW + 4}
                height={Math.max((value / maxVal) * chartH, 1) + (value === 0 ? 4 : 4)}
                rx="5"
                fill="none"
                stroke={color}
                strokeWidth={isHovered ? 2 : 0}
                opacity={isHovered ? 0.6 : 0}
                style={{
                  transition: "opacity 180ms, stroke-width 180ms",
                  pointerEvents: "none",
                }}
              />
              {/* X-axis label only on stride ticks (and the last tick) so
                  the date axis stays legible on 30d/90d/all-time views. */}
              {showXLabel && (
                <text
                  x={x + barW / 2}
                  y={padding.top + chartH + 18}
                  textAnchor="middle"
                  fill={isHovered ? "var(--color-text-primary)" : "var(--color-text-muted)"}
                  fontSize={isHovered ? "11" : "10"}
                  fontWeight={isHovered ? "600" : "400"}
                  style={{ transition: "all 150ms" }}
                >
                  {labels[i]}
                </text>
              )}
              {/* Value-on-top label only when bars are wide enough to hold
                  readable text and the value is non-zero. The hover tooltip
                  remains the source-of-truth for exact values on dense
                  charts. */}
              {showTopValue && (
                <text
                  x={x + barW / 2}
                  y={y - 6}
                  textAnchor="middle"
                  fill={isHovered ? "var(--color-text-primary)" : "var(--color-text-secondary)"}
                  fontSize={isHovered ? "11" : "10"}
                  fontWeight={isHovered ? "700" : "600"}
                  opacity={isDimmed ? 0.4 : 1}
                  style={{ transition: "all 150ms" }}
                >
                  {formatValue(value)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Hover tooltip card */}
      {hoverIndex !== null && (
        <div
          className="chart-bar-tooltip"
          style={{
            position: "absolute",
            top: "4px",
            left: `${((hoverIndex + 0.5) / data.length) * 100}%`,
            transform: "translateX(-50%)",
            pointerEvents: "none",
            zIndex: 20,
          }}
        >
          <div className="bar-tooltip-label">{labels[hoverIndex]}</div>
          <div className="bar-tooltip-value">{formatValue(data[hoverIndex])}</div>
        </div>
      )}
    </div>
  );
}
