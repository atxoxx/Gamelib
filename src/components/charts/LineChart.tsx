import { useMemo, useState, useCallback, useRef } from "react";

interface Series {
  data: number[];
  color: string;
  label: string;
}

interface LineChartProps {
  series: Series[];
  labels: string[];
  width?: number;
  height?: number;
  formatValue?: (v: number) => string;
  legend?: boolean;
  fillOpacity?: number;
  minY?: number;
  maxY?: number;
}

export default function LineChart({
  series,
  labels,
  width = 640,
  height = 260,
  formatValue = (v) => String(v),
  legend = true,
  fillOpacity = 0.08,
  minY,
  maxY,
}: LineChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const chart = useMemo(() => {
    const padding = { top: 16, right: 20, bottom: 28, left: 44 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const allValues = series.flatMap((s) => s.data);

    // Use explicit bounds if provided, otherwise fallback to dynamic calculation
    const maxVal = maxY !== undefined ? maxY : Math.max(...allValues, 1);
    const minVal = minY !== undefined ? minY : Math.min(...allValues, 0);
    const range = maxVal - minVal || 1;

    return { padding, chartW, chartH, maxVal, minVal, range };
  }, [series, width, height, minY, maxY]);

  const { padding, chartW, chartH, minVal, range } = chart;

  const gridLines = 5;
  const gridValues = Array.from({ length: gridLines + 1 }, (_, i) =>
    Math.round(minVal + (range / gridLines) * i)
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
      const scaleX = width / rect.width;
      const mouseX = (e.clientX - rect.left) * scaleX;

      // Only track within chart area
      if (mouseX < padding.left || mouseX > padding.left + chartW) {
        setHoverIndex(null);
        return;
      }

      // Find nearest data point based on X position
      const dataLen = series[0]?.data.length ?? 0;
      if (dataLen === 0) return;
      const idx = Math.round(((mouseX - padding.left) / chartW) * (dataLen - 1));
      const clampedIdx = Math.max(0, Math.min(dataLen - 1, idx));

      setHoverIndex(clampedIdx);
    },
    [width, height, padding.left, chartW, chartH, padding.top, series]
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

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        style={{ fontFamily: "inherit", cursor: "crosshair" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
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
            <path
              d={buildArea(s.data)}
              fill={s.color}
              opacity={fillOpacity}
            />
            <path
              d={buildPath(s.data)}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        ))}

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
                style={{ transition: "opacity 150ms, r 150ms" }}
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
                stroke="#fff"
                strokeWidth="2"
                style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.3))" }}
              />
            );
          })}

        {/* X-axis labels */}
        {labels.map((label, i) => {
          const x = padding.left + (i / Math.max(labels.length - 1, 1)) * chartW;
          const isActive = hoverIndex === i;
          return (
            <text
              key={`label-${i}`}
              x={x}
              y={padding.top + chartH + 18}
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
            left: crosshairX !== null ? `${((crosshairX + (crosshairX > width * 0.6 ? -160 : 20)) / width) * 100}%` : "0%",
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
                <span className="chart-tooltip-val">{formatValue(tv.value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
