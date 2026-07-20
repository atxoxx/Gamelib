import type { PerfSample, SessionMetrics } from "../types/game";

/**
 * Linearly resample `series` to exactly `n` points. Used to align sessions
 * of different lengths before averaging them into one comparable curve.
 */
export function resample(series: number[], n: number): number[] {
  if (series.length === 0) return new Array(n).fill(0);
  if (series.length === 1) return new Array(n).fill(series[0]);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const pos = (i / (n - 1)) * (series.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    const frac = pos - lo;
    out.push(series[lo] + (series[hi] - series[lo]) * frac);
  }
  return out;
}

/** Point-by-point mean of several resampled series (empty ones ignored). */
export function averageSeries(seriesList: number[][], n: number): number[] {
  const valid = seriesList.filter((s) => s.length > 0).map((s) => resample(s, n));
  if (valid.length === 0) return new Array(n).fill(0);
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (const s of valid) sum += s[i];
    out[i] = sum / valid.length;
  }
  return out;
}

/** True when a metrics payload carries enough real samples to plot. */
export function hasRealSamples(metrics?: SessionMetrics): boolean {
  return !!metrics && Array.isArray(metrics.samples) && metrics.samples.length >= 2;
}

export interface PerfTimelineSeries {
  cpu: number[];
  gpu: number[];
  cpuTemp: number[];
  gpuTemp: number[];
  ram: number[];
  fps: number[];
}

/**
 * Build real per-metric series by averaging the captured samples across the
 * supplied sessions. When none of the sessions have real samples, returns
 * `null` so the caller can fall back to synthetic curve generation.
 *
 * `fps` samples that are `null` (no real FPS source that poll) are treated
 * as 0 for the averaged curve — the stat-card "avg FPS" still comes from
 * the real session average, so a missing instantaneous reading only flattens
 * one point of the shape, not the reported number.
 */
export function buildTimelineFromSessions(
  sessions: { metrics?: SessionMetrics }[],
  pts = 45
): PerfTimelineSeries | null {
  const withSamples = sessions.filter((s) =>
    hasRealSamples(s.metrics)
  ) as { metrics: SessionMetrics }[];
  if (withSamples.length === 0) return null;

  const pick = (sel: (p: PerfSample) => number) =>
    withSamples.map((s) => s.metrics.samples!.map(sel));

  return {
    cpu: averageSeries(pick((p) => p.cpu), pts),
    gpu: averageSeries(pick((p) => p.gpu), pts),
    ram: averageSeries(pick((p) => p.ram), pts),
    cpuTemp: averageSeries(pick((p) => p.cpuTemp), pts),
    gpuTemp: averageSeries(pick((p) => p.gpuTemp), pts),
    fps: averageSeries(
      pick((p) => (p.fps != null ? p.fps : 0)),
      pts
    ),
  };
}

/**
 * Build real per-metric series for a single session (no averaging). Returns
 * `null` when the session has no usable samples. Length is resampled to `pts`
 * so callers can keep fixed-size labels / sparklines.
 */
export function buildSingleSessionSeries(
  metrics: SessionMetrics | undefined,
  pts = 45
): PerfTimelineSeries | null {
  if (!hasRealSamples(metrics)) return null;
  const s = metrics!.samples!;
  return {
    cpu: resample(s.map((p) => p.cpu), pts),
    gpu: resample(s.map((p) => p.gpu), pts),
    ram: resample(s.map((p) => p.ram), pts),
    cpuTemp: resample(s.map((p) => p.cpuTemp), pts),
    gpuTemp: resample(s.map((p) => p.gpuTemp), pts),
    fps: resample(
      s.map((p) => (p.fps != null ? p.fps : 0)),
      pts
    ),
  };
}
