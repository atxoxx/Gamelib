// Dense, table-style row for the Downloads page.
//
// Deliberately NOT a reuse of the popover's `DownloadCard`:
// the popover card is optimised for a constrained 380px panel
// (vertical stacking, name-ellipsis on one line, action icons on
// the right). On a full page we have horizontal room to spread
// the same information into columns:
//
//   [Status] [Name + source + added]   [Progress bar]   [Speed]   [Swarm]   [Actions]
//
// The `actions` slot is a small set of icon buttons that mirror
// what the popover card does. The progress bar reuses the same
// fill + indeterminate animation so the visual language stays
// consistent.

import {
  formatBytesPerSecond,
  formatBytesShort,
  formatProgress,
  getStatusError,
  getStatusLabel,
  getStatusClassSuffix,
  isActiveStatus,
  type TorrentDownload,
} from "../../types/download";

interface DownloadRowProps {
  download: TorrentDownload;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRemove: (id: string) => void;
}

export default function DownloadRow({
  download,
  onPause,
  onResume,
  onRemove,
}: DownloadRowProps) {
  const status = download.status;
  const indeterminate = download.progress == null && isActiveStatus(status);
  const isPaused = status.kind === "paused";
  const isCompleted = status.kind === "completed";
  const isError = status.kind === "error";
  const errorMessage = getStatusError(status);

  const rowClass = [
    "dl-row",
    isError && "error",
    isCompleted && "completed",
    isPaused && "paused",
    indeterminate && "indeterminate",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rowClass}>
      <span
        className={`dl-row-status dl-row-status--${getStatusClassSuffix(status)}`}
        title={getStatusLabel(status)}
        aria-label={`Status: ${getStatusLabel(status)}`}
      >
        {getStatusLabel(status)}
      </span>

      <div className="dl-row-main">
        <div className="dl-row-name-row">
          <span className="dl-row-name" title={download.name}>
            {download.name}
          </span>
          <span className="dl-row-source" title={`Source: ${download.sourceName}`}>
            {download.sourceName}
          </span>
        </div>
        <div className="dl-row-progress-row">
          <div className="dl-row-bar">
            <div
              className="dl-row-bar-fill"
              style={{
                width: indeterminate
                  ? "30%"
                  : `${(download.progress ?? 0) * 100}%`,
              }}
            />
          </div>
          <span className="dl-row-progress">
            {formatProgress(download.progress)}
            {download.totalSize != null && (
              <span className="dl-row-size">
                {" · "}
                {formatBytesShort(download.totalSize)}
              </span>
            )}
          </span>
        </div>
        {isError && errorMessage && (
          <div className="dl-row-error" role="alert">
            {errorMessage}
          </div>
        )}
      </div>

      <div className="dl-row-speed">
        {isActiveStatus(status) && download.downloadSpeed > 0 ? (
          <>
            <span className="dl-row-speed-dl" title="Download speed">
              <span aria-hidden>↓</span>
              {formatBytesPerSecond(download.downloadSpeed)}
            </span>
            {download.uploadSpeed > 0 && (
              <span className="dl-row-speed-ul" title="Upload speed">
                <span aria-hidden>↑</span>
                {formatBytesPerSecond(download.uploadSpeed)}
              </span>
            )}
          </>
        ) : isPaused ? (
          <span className="dl-row-speed-muted">Paused</span>
        ) : isCompleted ? (
          <span className="dl-row-speed-muted">Done</span>
        ) : (
          <span className="dl-row-speed-muted">—</span>
        )}
      </div>

      <div className="dl-row-swarm" aria-label="Swarm">
        {download.peers > 0 || download.seeds > 0 ? (
          <>
            <span title="Known peers in swarm">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
                style={{ width: 11, height: 11 }}
              >
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              {download.peers}
            </span>
            <span title="Seeds in swarm" className="dl-row-swarm-seeds">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
                style={{ width: 11, height: 11 }}
              >
                <polyline points="6 16 12 10 18 16" />
              </svg>
              {download.seeds}
            </span>
          </>
        ) : (
          <span className="dl-row-swarm-muted">—</span>
        )}
      </div>

      <div className="dl-row-actions">
        {isActiveStatus(status) && !isPaused && (
          <button
            className="dl-row-btn"
            onClick={() => onPause(download.id)}
            title="Pause"
            aria-label="Pause download"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          </button>
        )}
        {isPaused && (
          <button
            className="dl-row-btn"
            onClick={() => onResume(download.id)}
            title="Resume"
            aria-label="Resume download"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </button>
        )}
        <button
          className="dl-row-btn danger"
          onClick={() => onRemove(download.id)}
          title={isCompleted ? "Remove from history" : "Remove"}
          aria-label="Remove download"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            aria-hidden
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
