import { useId, useMemo, useRef, useState } from "react";

export interface ActivitySparklineProps {
  data: { x: number; y: number }[];
  label: string;
  unit: string;
  value: number;
  max?: number;
  min?: number;
  thresholds?: { warn: number; danger: number };
  inverted?: boolean;
  /** Render a smooth spline instead of straight segments. */
  smooth?: boolean;
}

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

export function ActivitySparkline({
  data,
  label,
  unit,
  value,
  max,
  min,
  thresholds,
  inverted,
  smooth = true,
}: Readonly<ActivitySparklineProps>) {
  const gradientId = useId().replace(/[:]/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const getStatus = (): "good" | "warn" | "danger" => {
    if (!thresholds || !Number.isFinite(value)) return "good";
    if (inverted) {
      if (value <= thresholds.danger) return "danger";
      if (value <= thresholds.warn) return "warn";
      return "good";
    }
    if (value >= thresholds.danger) return "danger";
    if (value >= thresholds.warn) return "warn";
    return "good";
  };

  const status = getStatus();
  const statusColors = {
    good: "var(--color-success, #16b195)",
    warn: "var(--color-warning, #d4a853)",
    danger: "var(--color-danger, #e74c3c)",
  };
  const color = statusColors[status];

  const renderValueGroup = () => (
    <div className="activity-sparkline__value-group">
      <div className="activity-sparkline__value-item">
        <span className="activity-sparkline__value-item-label">avg</span>
        <span
          className={`activity-sparkline__value activity-sparkline__value--${status}`}
          style={{ color }}
        >
          {Number.isFinite(value) ? value : "—"}
          {unit}
        </span>
      </div>
      {max !== undefined && Number.isFinite(max) && (
        <div className="activity-sparkline__value-item">
          <span className="activity-sparkline__value-item-label">max</span>
          <span className="activity-sparkline__value activity-sparkline__value--max">
            {max}
            {unit}
          </span>
        </div>
      )}
      {min !== undefined && Number.isFinite(min) && (
        <div className="activity-sparkline__value-item">
          <span className="activity-sparkline__value-item-label">min</span>
          <span className="activity-sparkline__value activity-sparkline__value--min">
            {min}
            {unit}
          </span>
        </div>
      )}
    </div>
  );

  if (!data || data.length < 2) {
    return (
      <div className="activity-sparkline">
        {label && <span className="activity-sparkline__label">{label}</span>}
        {renderValueGroup()}
      </div>
    );
  }

  // Draw a responsive SVG sparkline with a gradient area fill, a smooth
  // line, min/max markers, an optional threshold guide, and a hover readout.
  const width = 240;
  const height = 44;
  const padding = 3;
  const yValues = data.map((d) => d.y);
  const minVal = Math.min(...yValues);
  const maxVal = Math.max(...yValues);
  const dataRange = maxVal - minVal || 1;

  const toXY = (d: { x: number; y: number }, i: number) => {
    const x = (i / (data.length - 1)) * width;
    const y =
      height - padding - ((d.y - minVal) / dataRange) * (height - padding * 2);
    return { x, y };
  };

  const points = data.map(toXY);

  const linePath = smooth ? buildSmoothPath(points) : points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const areaPath = smooth
    ? `${linePath} L ${width},${height} L 0,${height} Z`
    : `${linePath} L ${width},${height} L 0,${height} Z`;

  // Threshold guide line (warn level), if provided.
  const thresholdY = useMemo(() => {
    if (!thresholds) return null;
    const t = inverted ? thresholds.warn : thresholds.warn;
    if (t < minVal || t > maxVal) return null;
    return height - padding - ((t - minVal) / dataRange) * (height - padding * 2);
  }, [thresholds, minVal, maxVal, height, padding, dataRange, inverted]);

  const hoverHandle = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = width / rect.width;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const idx = Math.round((mouseX / width) * (data.length - 1));
    setHoverIdx(Math.max(0, Math.min(data.length - 1, idx)));
  };

  const hoverPoint = hoverIdx !== null ? points[hoverIdx] : null;

  return (
    <div className="activity-sparkline">
      {label && <span className="activity-sparkline__label">{label}</span>}
      <div className="activity-sparkline__chart">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          preserveAspectRatio="none"
          style={{ cursor: "crosshair", display: "block" }}
          onMouseMove={hoverHandle}
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id={`spark-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>

          {/* Threshold guide */}
          {thresholdY !== null && (
            <line
              x1={0}
              y1={thresholdY}
              x2={width}
              y2={thresholdY}
              stroke={color}
              strokeWidth="1"
              strokeDasharray="3 3"
              opacity={0.45}
            />
          )}

          <path d={areaPath} fill={`url(#spark-${gradientId})`} />
          <path d={linePath} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />

          {/* Min / Max markers */}
          {(() => {
            const minI = yValues.indexOf(minVal);
            const maxI = yValues.indexOf(maxVal);
            return (
              <>
                <circle cx={points[minI].x} cy={points[minI].y} r={2.4} fill={color} opacity={0.6} />
                <circle cx={points[maxI].x} cy={points[maxI].y} r={2.4} fill={color} opacity={0.85} />
              </>
            );
          })()}

          {/* Hover crosshair + readout */}
          {hoverPoint && (
            <>
              <line x1={hoverPoint.x} y1={0} x2={hoverPoint.x} y2={height} stroke="var(--color-text-muted)" strokeWidth={1} strokeDasharray="2 2" opacity={0.5} />
              <circle cx={hoverPoint.x} cy={hoverPoint.y} r={3.5} fill={color} stroke="var(--color-bg-primary)" strokeWidth={1.5} />
            </>
          )}
        </svg>
      </div>

      {/* Hover value bubble */}
      {hoverIdx !== null && (
        <div className="activity-sparkline__hover-value" style={{ color }}>
          {unit === "GB" ? data[hoverIdx].y.toFixed(1) : Math.round(data[hoverIdx].y)}
          {unit}
        </div>
      )}

      {renderValueGroup()}
    </div>
  );
}

export function samplesToSparklineData(
  samples: any[],
  metric: string
): { x: number; y: number }[] {
  if (!samples || samples.length === 0) return [];
  const step = Math.max(1, Math.floor(samples.length / 30));
  return samples
    .filter((_, i) => i % step === 0)
    .map((sample, idx) => ({
      x: idx,
      y: (sample[metric] || sample[metric.replace("MB", "")]) as number,
    }));
}
