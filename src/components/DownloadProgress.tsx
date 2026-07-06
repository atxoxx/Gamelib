// Floating "live activity" panel for active and recently completed
// downloads. Renders fixed bottom-right of the viewport. Auto-hides
// when there are zero active downloads AND the user has explicitly
// dismissed it.
//
// We do NOT include this in the TopNav — it's a transient widget,
// not a navigation surface, and the topnav is already a busy
// place. Mounting it as a global overlay (just below the toasts)
// keeps it discoverable without competing with the primary nav.

import { useState, useEffect } from "react";
import { useDownloads } from "../context/DownloadContext";
import {
  formatBytesPerSecond,
  formatBytesShort,
  formatProgress,
  getStatusError,
  getStatusLabel,
  getStatusClassSuffix,
  isActiveStatus,
  type TorrentDownload,
} from "../types/download";
import { useToast } from "../context/ToastContext";

/**
 * Per-card actions. Each action is a small button with an icon —
 * we keep the surface minimal so a 360px panel can fit 2-3 cards
 * before the user has to scroll.
 */
function DownloadCard({
  download,
  onPause,
  onResume,
  onRemove,
}: {
  download: TorrentDownload;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const status = download.status;
  const errorMessage = getStatusError(status);
  const indeterminate = download.progress == null && isActiveStatus(status);
  const isPaused = status.kind === "paused";
  const isCompleted = status.kind === "completed";
  const isError = status.kind === "error";

  // The card class — controls indeterminate bar animation + status
  // border tint. Kept simple; the panel does the heavy visual work.
  const cardClass = [
    "dl-progress-card",
    isError && "error",
    isCompleted && "completed",
    indeterminate && "indeterminate",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cardClass}>
      <div className="dl-progress-card-header">
        <span className="dl-progress-card-name" title={download.name}>
          {download.name}
        </span>
        <span className={`dl-progress-card-status dl-progress-card-status--${getStatusClassSuffix(status)}`}>
          {getStatusLabel(status)}
        </span>
      </div>

      <div className="dl-progress-card-bar">
        <div
          className="dl-progress-card-bar-fill"
          style={{ width: indeterminate ? "30%" : `${(download.progress ?? 0) * 100}%` }}
        />
      </div>

      <div className="dl-progress-card-footer">
        <div className="dl-progress-card-stats">
          <span>
            <strong>{formatProgress(download.progress)}</strong>
            {download.totalSize != null && (
              <> · {formatBytesShort(download.totalSize)}</>
            )}
          </span>
          {isActiveStatus(status) && download.downloadSpeed > 0 && (
            <span>{formatBytesPerSecond(download.downloadSpeed)}</span>
          )}
        </div>
        <div className="dl-progress-card-actions">
          {isActiveStatus(status) && !isPaused && (
            <button
              className="dl-progress-card-btn"
              onClick={() => onPause(download.id)}
              title="Pause"
              aria-label="Pause download"
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            </button>
          )}
          {isPaused && (
            <button
              className="dl-progress-card-btn"
              onClick={() => onResume(download.id)}
              title="Resume"
              aria-label="Resume download"
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </button>
          )}
          <button
            className="dl-progress-card-btn danger"
            onClick={() => onRemove(download.id)}
            title="Remove"
            aria-label="Remove download"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {isError && errorMessage && (
        <div className="dl-progress-card-error" role="alert">
          {errorMessage}
        </div>
      )}
    </div>
  );
}

/**
 * Hide the panel automatically when the user has zero active
 * downloads AND the panel hasn't been explicitly pinned. We use
 * localStorage to remember the pin state across sessions.
 */
function useAutoHide(hasActive: boolean): { visible: boolean; dismiss: () => void } {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem("gamelib-dl-progress-dismissed") === "1";
    } catch {
      return false;
    }
  });
  const [hasSeenActive, setHasSeenActive] = useState(false);

  // Track whether the panel has ever shown an active download — once
  // it has, it stays mounted (just collapsed) until the user
  // explicitly dismisses it. This way a new download starting
  // doesn't pop the panel out of nowhere for a user who closed it.
  useEffect(() => {
    if (hasActive) setHasSeenActive(true);
  }, [hasActive]);

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem("gamelib-dl-progress-dismissed", "1");
    } catch {
      /* localStorage may be unavailable in some sandboxed contexts */
    }
  };

  // Reset the dismissed state if a new download starts (so users
  // get a fresh panel for fresh activity).
  useEffect(() => {
    if (hasActive) {
      setDismissed(false);
    }
  }, [hasActive]);

  const visible = hasActive || (hasSeenActive && !dismissed);
  return { visible, dismiss };
}

export default function DownloadProgress() {
  const {
    activeDownloads,
    completedDownloads,
    pauseDownload,
    resumeDownload,
    removeDownload,
  } = useDownloads();
  const { showToast } = useToast();
  const [collapsed, setCollapsed] = useState(false);

  // Show in-progress AND the most recent 2 completed (so users see
  // "✓ Cyberpunk 2077 finished" before it scrolls off). The cap is
  // a UX call — too many completed cards = the panel becomes a
  // status history nobody looks at.
  const recentCompleted = completedDownloads.slice(0, 2);
  const visibleDownloads = [...activeDownloads, ...recentCompleted];

  const { visible, dismiss } = useAutoHide(activeDownloads.length > 0);

  if (!visible) return null;

  async function handlePause(id: string) {
    try {
      await pauseDownload(id);
    } catch (err) {
      showToast(`Pause failed: ${err}`, "error");
    }
  }

  async function handleResume(id: string) {
    try {
      await resumeDownload(id);
    } catch (err) {
      showToast(`Resume failed: ${err}`, "error");
    }
  }

  async function handleRemove(id: string) {
    try {
      await removeDownload(id, false);
      showToast("Download removed", "info");
    } catch (err) {
      showToast(`Remove failed: ${err}`, "error");
    }
  }

  const hasActive = activeDownloads.length > 0;
  const totalCount = visibleDownloads.length;

  return (
    <div
      className={`dl-progress${collapsed ? " collapsed" : ""}`}
      role="region"
      aria-label="Download progress"
    >
      <div
        className="dl-progress-header"
        onClick={() => setCollapsed((c) => !c)}
      >
        <svg
          className="dl-progress-header-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        <span className="dl-progress-title">
          Downloads
          {totalCount > 0 && (
            <span className={`dl-progress-badge${hasActive ? " pulse" : ""}`}>
              {totalCount}
            </span>
          )}
        </span>
        {!collapsed && (
          <button
            className="dl-progress-card-btn"
            onClick={(e) => {
              e.stopPropagation();
              dismiss();
            }}
            title="Hide panel"
            aria-label="Hide download progress panel"
            style={{ padding: "2px 4px" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
        <svg
          className="dl-progress-chevron"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {!collapsed && (
        <div className="dl-progress-list">
          {visibleDownloads.map((d) => (
            <DownloadCard
              key={d.id}
              download={d}
              onPause={handlePause}
              onResume={handleResume}
              onRemove={handleRemove}
            />
          ))}
        </div>
      )}
    </div>
  );
}
