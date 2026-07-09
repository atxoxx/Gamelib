// Bandwidth sparkline — last 60 s of aggregate download / upload
// speeds, rendered as a tiny inline SVG line chart (no chart
// library).
//
// Design:
//
//   * Sample at a fixed 2 s tick (matches the Rust torrent engine's
//     `download-progress` poll cadence). 30 samples per window.
//
//   * Sample buffer lives in a `useRef` array — we mutate the array
//     in place and use a tiny `tick` counter to force a re-render.
//     This keeps the per-tick work to O(1) (one push, one shift)
//     instead of O(N) state updates.
//
//   * The active download list is mirrored into a ref via a
//     `useEffect` (not a render-phase assignment, which would be
//     flagged by StrictMode) so the sampling effect can run with
//     `[]` deps — the effect itself would otherwise tear down and
//     re-create the interval every time a single byte flows
//     through, which would defeat the purpose of having a
//     time-based window.
//
//   * Y-axis auto-scales to the peak observed in the window
//     (clamped to a small floor so the chart isn't visually
//     explosive when one torrent briefly hits 1 GB/s).
//
//   * X-axis is fixed at a 60 s window — we draw samples at their
//     actual age (`now - t`), so the line "scrolls" naturally as
//     time advances.

import { useEffect, useRef, useState } from "react";
import { useDownloads } from "../../context/DownloadContext";
import {
  formatBytesPerSecond,
  type TorrentDownload,
} from "../../types/download";

const WINDOW_MS = 60_000;
const TICK_MS = 2_000;
// 60s / 2s + a small headroom buffer in case the interval drifts.
// Used as a hard cap so a JS GC pause can't blow the array up.
const MAX_SAMPLES = Math.ceil(WINDOW_MS / TICK_MS) + 2;

// SVG viewBox dimensions. preserveAspectRatio="none" lets the chart
// stretch to whatever width its container has.
const VIEW_W = 600;
const VIEW_H = 56;
// Inner padding so the stroke doesn't get clipped at the top / bottom.
const PAD_Y = 3;

// Floor the Y axis so a torrent that briefly hits 1 GB/s doesn't
// make every other sample read as "near zero" for the rest of the
// window. 32 KB/s is a sensible "this connection is doing nothing"
// threshold — below that we still draw the line but it doesn't
// dominate the scale.
const MIN_PEAK_BYTES_PER_SEC = 32 * 1024;

interface Sample {
  /** Wall-clock time the sample was taken (ms). */
  t: number;
  /** Aggregate download speed at sample time, in bytes/sec. */
  dl: number;
  /** Aggregate upload speed at sample time, in bytes/sec. */
  ul: number;
}

export default function BandwidthSparkline() {
  const { activeDownloads } = useDownloads();

  // Mirror the live list into a ref so the sampling effect can
  // run with an empty dep array. Setting the ref in a `useEffect`
  // (rather than during render) keeps us StrictMode-clean: a
  // double-render in dev would otherwise run the side effect
  // twice with the same value.
  const dataRef = useRef<TorrentDownload[]>(activeDownloads);
  useEffect(() => {
    dataRef.current = activeDownloads;
  }, [activeDownloads]);

  const samplesRef = useRef<Sample[]>([]);
  // We only need the setter (the value is never read). The
  // underscore prefix signals "intentionally unused" to
  // TypeScript and linters, and the setter call is what triggers
  // a re-render of the SVG.
  const [, setTick] = useState(0);

  // Prime the buffer on mount with the current speeds so the
  // chart isn't empty for the first 2 s.
  useEffect(() => {
    samplesRef.current.push({
      t: Date.now(),
      dl: sumSpeed(dataRef.current, "downloadSpeed"),
      ul: sumSpeed(dataRef.current, "uploadSpeed"),
    });
    setTick((n) => n + 1);
  }, []);

  // The sampler effect. Runs once on mount, ticks every 2 s.
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now();
      const arr = samplesRef.current;
      const cutoff = now - WINDOW_MS;
      // Drop expired samples from the front. The buffer is
      // bounded at MAX_SAMPLES so a JS GC pause can't blow it
      // up, but the window cutoff is the real reason we're
      // trimming.
      while (arr.length > 0 && arr[0].t < cutoff) {
        arr.shift();
      }
      // Defense-in-depth: even if the interval is throttled to
      // once every few seconds, never let the buffer exceed
      // MAX_SAMPLES. shift() here keeps the array chronological.
      while (arr.length >= MAX_SAMPLES) {
        arr.shift();
      }
      arr.push({
        t: now,
        dl: sumSpeed(dataRef.current, "downloadSpeed"),
        ul: sumSpeed(dataRef.current, "uploadSpeed"),
      });
      setTick((n) => n + 1);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  // ── Derive the paths from the buffer ─────────────────────────────────
  const samples = samplesRef.current;
  const now = Date.now();
  const peak = Math.max(
    MIN_PEAK_BYTES_PER_SEC,
    ...samples.map((s) => Math.max(s.dl, s.ul)),
  );

  // xFor / yFor translate (timestamp, bytesPerSec) → SVG coords.
  // We map the live `now` against the right edge so the line
  // appears to scroll left as time advances.
  const xFor = (t: number) => {
    const age = now - t;
    return VIEW_W - (age / WINDOW_MS) * VIEW_W;
  };
  const yFor = (v: number) => {
    return VIEW_H - PAD_Y - (v / peak) * (VIEW_H - PAD_Y * 2);
  };

  // Build the download polyline + a closed area path for the
  // gradient fill below it. `samples` is in chronological order;
  // we iterate oldest → newest.
  let dlLine = "";
  let dlArea = "";
  let ulLine = "";
  if (samples.length === 1) {
    // Single point: render a tiny dot at the right edge so the
    // user gets immediate visual feedback (vs. an empty chart for
    // the first 2 s).
    const s = samples[0];
    const x = xFor(s.t);
    const yDl = yFor(s.dl);
    const yUl = yFor(s.ul);
    dlLine = `${x.toFixed(1)},${yDl.toFixed(1)}`;
    ulLine = `${x.toFixed(1)},${yUl.toFixed(1)}`;
  } else if (samples.length > 1) {
    const first = samples[0];
    dlLine = `M ${xFor(first.t).toFixed(1)},${yFor(first.dl).toFixed(1)}`;
    ulLine = `M ${xFor(first.t).toFixed(1)},${yFor(first.ul).toFixed(1)}`;
    for (let i = 1; i < samples.length; i++) {
      const s = samples[i];
      dlLine += ` L ${xFor(s.t).toFixed(1)},${yFor(s.dl).toFixed(1)}`;
      ulLine += ` L ${xFor(s.t).toFixed(1)},${yFor(s.ul).toFixed(1)}`;
    }
    // Closed area for the gradient fill — go from the last point
    // down to the bottom-right, then along the bottom to the
    // bottom-left of the line, then up to the first point.
    const last = samples[samples.length - 1];
    dlArea =
      dlLine +
      ` L ${xFor(last.t).toFixed(1)},${(VIEW_H - PAD_Y).toFixed(1)}` +
      ` L ${xFor(first.t).toFixed(1)},${(VIEW_H - PAD_Y).toFixed(1)} Z`;
  }

  // Current "now" value for the right-edge label. Falls back to 0
  // when the buffer is empty (shouldn't happen post-mount, but
  // keeps the label deterministic).
  const current = samples[samples.length - 1] ?? { dl: 0, ul: 0 };

  // Stable aria-label so screen readers describe the chart
  // without having to read the SVG path. Includes the live peak
  // and the most recent sample so the user knows roughly what
  // they're looking at.
  const ariaLabel =
    `Bandwidth over the last 60 seconds. ` +
    `Current download ${formatBytesPerSecond(current.dl)}, ` +
    `current upload ${formatBytesPerSecond(current.ul)}, ` +
    `peak in window ${formatBytesPerSecond(peak)}`;

  return (
    <div className="dl-sparkline" aria-label={ariaLabel}>
      <div className="dl-sparkline-header">
        <span className="dl-sparkline-title">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className="dl-sparkline-icon"
          >
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          Last 60 seconds
        </span>
        <span className="dl-sparkline-legend">
          <span className="dl-sparkline-legend-item dl-sparkline-legend-dl">
            <span className="dl-sparkline-legend-swatch" aria-hidden />
            {formatBytesPerSecond(current.dl)}
          </span>
          <span className="dl-sparkline-legend-item dl-sparkline-legend-ul">
            <span className="dl-sparkline-legend-swatch" aria-hidden />
            {formatBytesPerSecond(current.ul)}
          </span>
        </span>
      </div>

      <svg
        className="dl-sparkline-svg"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          {/*
            SVG presentation attributes don't resolve CSS custom
            properties — `stopColor="var(--color-accent)"` would
            silently fall back to the default fill. Use inline
            `style` so the variable resolves in a real CSS context.
          */}
          <linearGradient id="dl-sparkline-grad" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              style={{ stopColor: "var(--color-accent)" }}
              stopOpacity="0.35"
            />
            <stop
              offset="100%"
              style={{ stopColor: "var(--color-accent)" }}
              stopOpacity="0"
            />
          </linearGradient>
        </defs>

        {/* Subtle baseline so the user can see "zero" when speeds
            drop to nothing. Drawn before the lines so it sits
            behind them. */}
        <line
          x1="0"
          y1={VIEW_H - PAD_Y}
          x2={VIEW_W}
          y2={VIEW_H - PAD_Y}
          className="dl-sparkline-baseline"
        />

        {dlArea && (
          <path d={dlArea} fill="url(#dl-sparkline-grad)" />
        )}

        {dlLine &&
          (samples.length === 1 ? (
            <circle
              cx={xFor(samples[0].t)}
              cy={yFor(samples[0].dl)}
              r="2"
              className="dl-sparkline-dot-dl"
            />
          ) : (
            <path
              d={dlLine}
              fill="none"
              className="dl-sparkline-line-dl"
            />
          ))}

        {ulLine &&
          (samples.length === 1 ? (
            <circle
              cx={xFor(samples[0].t)}
              cy={yFor(samples[0].ul)}
              r="2"
              className="dl-sparkline-dot-ul"
            />
          ) : (
            <path
              d={ulLine}
              fill="none"
              className="dl-sparkline-line-ul"
            />
          ))}
      </svg>
    </div>
  );
}

/** Sum the chosen speed field across every active torrent. */
function sumSpeed(
  downloads: TorrentDownload[],
  field: "downloadSpeed" | "uploadSpeed",
): number {
  let total = 0;
  for (const d of downloads) {
    total += d[field];
  }
  return total;
}
