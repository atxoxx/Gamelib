
export interface ActivitySparklineProps {
  data: { x: number; y: number }[];
  label: string;
  unit: string;
  value: number;
  max?: number;
  min?: number;
  thresholds?: { warn: number; danger: number };
  inverted?: boolean;
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
}: Readonly<ActivitySparklineProps>) {
  const getStatus = (): "good" | "warn" | "danger" => {
    if (!thresholds) return "good";
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

  const renderValueGroup = () => (
    <div className="activity-sparkline__value-group">
      <div className="activity-sparkline__value-item">
        <span className="activity-sparkline__value-item-label">avg</span>
        <span className={`activity-sparkline__value activity-sparkline__value--${status}`} style={{ color: statusColors[status] }}>
          {value}
          {unit}
        </span>
      </div>
      {max !== undefined && max > 0 && (
        <div className="activity-sparkline__value-item">
          <span className="activity-sparkline__value-item-label">max</span>
          <span className="activity-sparkline__value activity-sparkline__value--max">
            {max}
            {unit}
          </span>
        </div>
      )}
      {min !== undefined && min > 0 && (
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

  if (data.length < 2) {
    return (
      <div className="activity-sparkline">
        {label && <span className="activity-sparkline__label">{label}</span>}
        {renderValueGroup()}
      </div>
    );
  }

  // Draw custom SVG sparkline
  const width = 120;
  const height = 30;
  const padding = 2;
  const yValues = data.map((d) => d.y);
  const minVal = Math.min(...yValues);
  const maxVal = Math.max(...yValues);
  const range = maxVal - minVal || 1;

  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - padding - ((d.y - minVal) / range) * (height - padding * 2);
    return `${x},${y}`;
  });

  const linePath = `M ${points.join(" L ")}`;
  const areaPath = `${linePath} L ${width},${height} L 0,${height} Z`;

  return (
    <div className="activity-sparkline">
      {label && <span className="activity-sparkline__label">{label}</span>}
      <div className="activity-sparkline__chart">
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height}>
          <path d={areaPath} fill={statusColors[status]} opacity={0.08} />
          <path d={linePath} fill="none" stroke={statusColors[status]} strokeWidth={1.5} />
        </svg>
      </div>
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
