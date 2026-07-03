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

    return { padding, chartW, chartH, maxVal, barGap, barW };
  }, [data, width, height]);

  const { padding, chartW, chartH, maxVal, barGap, barW } = chart;

  const gridLines = 5;
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
        {gridValues.map((v, i) => {
          const y = padding.top + chartH - (v / maxVal) * chartH;
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
                fontSize="11"
              >
                {v}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {data.map((value, i) => {
          const barH = (value / maxVal) * chartH;
          const x = padding.left + i * (barW + barGap);
          const y = padding.top + chartH - barH;
          const isHovered = hoverIndex === i;
          const isDimmed = hoverIndex !== null && hoverIndex !== i;

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
              {/* Label */}
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
              {/* Value on top */}
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
