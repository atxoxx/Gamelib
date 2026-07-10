// Aggregate bandwidth summary for the Downloads page.
//
// Reads the full download list from `useDownloads` and surfaces
// the four numbers the user actually cares about at a glance:
//
//   * Total active downloads (queued + fetching metadata + downloading)
//   * Paused count
//   * Aggregate download speed (sum of every active torrent's
//     `downloadSpeed`)
//   * Aggregate upload speed (same, for `uploadSpeed`)
//
// Stats are computed via `useMemo` so the hero re-renders only when
// the underlying numbers change, not on every progress tick that
// doesn't actually move a counter. The bar uses the same gradient
// as the per-card progress bar so the visual language is
// consistent with the rest of the downloads UI.

import { useMemo } from "react";
import { useDownloads } from "../../context/DownloadContext";
import { formatBytesPerSecond, isActiveStatus } from "../../types/download";
import { useSizeUnit } from "../../hooks/useSizeUnit";

export default function BandwidthHero() {
  const { activeDownloads } = useDownloads();
  const { unit } = useSizeUnit();

  const stats = useMemo(() => {
    let totalDown = 0;
    let totalUp = 0;
    let downloading = 0;
    let paused = 0;
    for (const d of activeDownloads) {
      if (d.status.kind === "paused") {
        paused += 1;
        continue;
      }
      if (isActiveStatus(d.status)) {
        downloading += 1;
      }
      totalDown += d.downloadSpeed;
      totalUp += d.uploadSpeed;
    }
    return { totalDown, totalUp, downloading, paused };
  }, [activeDownloads]);

  // A small visual "live" pulse on the down/up counters whenever
  // there's any active download — uses CSS animation, no JS.
  const isLive = stats.downloading > 0;

  return (
    <div className="dl-hero" aria-label="Bandwidth summary">
      <div className="dl-hero-stat">
        <div className="dl-hero-label">Active</div>
        <div className="dl-hero-value">{stats.downloading}</div>
        <div className="dl-hero-sub">
          {stats.paused > 0
            ? `${stats.paused} paused`
            : stats.downloading === 0
              ? "No downloads in flight"
              : "In progress"}
        </div>
      </div>

      <div className="dl-hero-divider" aria-hidden />

      <div className="dl-hero-stat">
        <div className="dl-hero-label">
          <span
            className={`dl-hero-dot${isLive ? " pulse" : ""}`}
            aria-hidden
          />
          Download
        </div>
        <div className="dl-hero-value dl-hero-value-down">
          {formatBytesPerSecond(stats.totalDown, unit)}
        </div>
        <div className="dl-hero-sub">Across all active torrents</div>
      </div>

      <div className="dl-hero-divider" aria-hidden />

      <div className="dl-hero-stat">
        <div className="dl-hero-label">
          <span
            className={`dl-hero-dot${isLive ? " pulse" : ""}`}
            aria-hidden
          />
          Upload
        </div>
        <div className="dl-hero-value dl-hero-value-up">
          {formatBytesPerSecond(stats.totalUp, unit)}
        </div>
        <div className="dl-hero-sub">
          {stats.totalUp > 0
            ? "Seeding back to the swarm"
            : "Nothing uploading"}
        </div>
      </div>
    </div>
  );
}
