import { useMemo } from "react";

interface DonutSlice {
  value: number;
  color: string;
  label: string;
}

interface DonutChartProps {
  slices: DonutSlice[];
  size?: number;
  innerRadius?: number;
  showLegend?: boolean;
  formatValue?: (v: number) => string;
}

const DONUT_COLORS = [
  "var(--color-accent)",
  "var(--color-info)",
  "var(--color-success)",
  "var(--color-warning)",
  "var(--color-danger)",
  "var(--color-stale, var(--color-text-muted))",
  "color-mix(in srgb, var(--color-accent) 60%, var(--color-info))",
  "color-mix(in srgb, var(--color-info) 60%, var(--color-success))",
  "color-mix(in srgb, var(--color-success) 60%, var(--color-warning))",
  "color-mix(in srgb, var(--color-warning) 60%, var(--color-danger))",
];

export default function DonutChart({
  slices,
  size = 200,
  innerRadius = 55,
  showLegend = true,
  formatValue = (v) => String(v),
}: DonutChartProps) {
  const total = useMemo(() => {
    const raw = slices.reduce((s, sl) => s + sl.value, 0) || 1;
    // Round to strip floating-point summation artifacts (e.g. 0.1 + 0.2 = 0.300...004)
    // while preserving up to 2 decimals of legitimate precision.
    return Math.round(raw * 100) / 100;
  }, [slices]);

  const arcs = useMemo(() => {
    let startAngle = -90;
    return slices
      .filter((s) => s.value > 0)
      .map((slice, i) => {
        const pct = slice.value / total;
        const angle = pct * 360;
        const endAngle = startAngle + angle;
        const color = slice.color || DONUT_COLORS[i % DONUT_COLORS.length];

        const cx = size / 2;
        const cy = size / 2;
        const outerR = size / 2 - 4;
        const innerR = innerRadius;

        const startRad = (startAngle * Math.PI) / 180;
        const endRad = (endAngle * Math.PI) / 180;

        const x1 = cx + outerR * Math.cos(startRad);
        const y1 = cy + outerR * Math.sin(startRad);
        const x2 = cx + outerR * Math.cos(endRad);
        const y2 = cy + outerR * Math.sin(endRad);

        const ix1 = cx + innerR * Math.cos(startRad);
        const iy1 = cy + innerR * Math.sin(startRad);
        const ix2 = cx + innerR * Math.cos(endRad);
        const iy2 = cy + innerR * Math.sin(endRad);

        const largeArc = angle > 180 ? 1 : 0;

        const d = [
          `M ${x1} ${y1}`,
          `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2}`,
          `L ${ix2} ${iy2}`,
          `A ${innerR} ${innerR} 0 ${largeArc} 0 ${ix1} ${iy1}`,
          "Z",
        ].join(" ");

        const result = { d, color, label: slice.label, value: slice.value, pct, startAngle, endAngle };
        startAngle = endAngle;
        return result;
      });
  }, [slices, total, size, innerRadius]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-xl)", flexWrap: "wrap" }}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        style={{ flexShrink: 0 }}
      >
        {arcs.map((arc, i) => (
          <g key={`arc-${i}`}>
            <path d={arc.d} fill={arc.color} opacity={0.9} stroke="var(--color-bg-primary)" strokeWidth="2">
              <title>
                {arc.label}: {formatValue(arc.value)} ({Math.round(arc.pct * 100)}%)
              </title>
            </path>
          </g>
        ))}
        {/* Center text */}
        <text
          x={size / 2}
          y={size / 2 - 6}
          textAnchor="middle"
          fill="var(--color-text-primary)"
          fontSize="18"
          fontWeight="700"
        >
          {formatValue(total)}
        </text>
        <text
          x={size / 2}
          y={size / 2 + 14}
          textAnchor="middle"
          fill="var(--color-text-muted)"
          fontSize="11"
        >
          Total
        </text>
      </svg>

      {showLegend && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {arcs.map((arc, i) => (
            <div key={`leg-${i}`} style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "3px",
                  background: arc.color,
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-secondary)" }}>
                {arc.label}
              </span>
              <span style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-primary)", fontWeight: 600, marginLeft: "auto" }}>
                {Math.round(arc.pct * 100)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
