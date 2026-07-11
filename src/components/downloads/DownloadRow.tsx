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

import React, { useState } from "react";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { useDownloads } from "../../context/DownloadContext";
import { useToast } from "../../context/ToastContext";
import {
  PlayIcon,
  PauseIcon,
  RemoveIcon,
  TrashIcon,
  ChevronIcon,
  PeersIcon,
  SeedsIcon,
} from "./DownloadIcons";
import {
  formatBytesPerSecond,
  formatBytesShort,
  formatProgress,
  getStatusError,
  getStatusLabel,
  getStatusClassSuffix,
  isActiveStatus,
  formatEta,
  type TorrentDownload,
} from "../../types/download";

interface DownloadRowProps {
  download: TorrentDownload;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRemove: (id: string) => void;
  /**
   * Destructive-emphasis "delete from disk" handler. The parent
   * typically opens a confirmation dialog before invoking the actual
   * `removeDownload(id, true)` — we pass the whole `download` so the
   * dialog can render size / name / save path context.
   */
  onDeleteFiles: (download: TorrentDownload) => void;
}

const DownloadRow = React.memo(({
  download,
  onPause,
  onResume,
  onRemove,
  onDeleteFiles,
}: DownloadRowProps) => {
  const { unit } = useSizeUnit();
  const { updateSelectedFiles } = useDownloads();
  const { showToast } = useToast();
  const [expanded, setExpanded] = useState(false);

  const handleToggleFile = async (idx: number) => {
    if (!download.files) return;
    
    const currentSelected = download.files
      .map((f, i) => ({ selected: f.selected, index: i }))
      .filter((item) => item.selected)
      .map((item) => item.index);
      
    let newSelected: number[];
    if (download.files[idx].selected) {
      if (currentSelected.length <= 1) {
        showToast("At least one file must be selected for download.", "error");
        return;
      }
      newSelected = currentSelected.filter((i) => i !== idx);
    } else {
      newSelected = [...currentSelected, idx];
    }
    
    try {
      await updateSelectedFiles(download.id, newSelected);
    } catch (err) {
      showToast(`Failed to update file selection: ${err}`, "error");
    }
  };
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
    <div className="dl-row-container">
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
              {download.totalSize != null ? (
                <span className="dl-row-size">
                  {" · "}
                  {formatBytesShort(download.downloaded, unit)} / {formatBytesShort(download.totalSize, unit)}
                </span>
              ) : (
                download.downloaded > 0 && (
                  <span className="dl-row-size">
                    {" · "}
                    {formatBytesShort(download.downloaded, unit)}
                  </span>
                )
              )}
              {isActiveStatus(status) && download.downloadSpeed > 0 && download.totalSize != null && (
                <span className="dl-row-size" style={{ opacity: 0.8 }}>
                  {" · "}
                  {formatEta(download.downloaded, download.totalSize, download.downloadSpeed)}
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
                {formatBytesPerSecond(download.downloadSpeed, unit)}
              </span>
              {download.uploadSpeed > 0 && (
                <span className="dl-row-speed-ul" title="Upload speed">
                  <span aria-hidden>↑</span>
                  {formatBytesPerSecond(download.uploadSpeed, unit)}
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
                <PeersIcon style={{ width: 11, height: 11 }} />
                {download.peers}
              </span>
              <span title="Seeds in swarm" className="dl-row-swarm-seeds">
                <SeedsIcon style={{ width: 11, height: 11 }} />
                {download.seeds}
              </span>
            </>
          ) : (
            <span className="dl-row-swarm-muted">—</span>
          )}
        </div>

        <div className="dl-row-actions">
          {download.files && download.files.length > 0 && (
            <button
              className={`dl-row-btn ${expanded ? "active" : ""}`}
              onClick={() => setExpanded(!expanded)}
              title={expanded ? "Hide files" : "Show files"}
              aria-label={expanded ? "Hide files" : "Show files"}
            >
              <ChevronIcon
                style={{
                  transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s ease-out",
                  width: 14,
                  height: 14,
                }}
              />
            </button>
          )}
          {isActiveStatus(status) && !isPaused && (
            <button
              className="dl-row-btn"
              onClick={() => onPause(download.id)}
              title="Pause"
              aria-label="Pause download"
            >
              <PauseIcon />
            </button>
          )}
          {isPaused && (
            <button
              className="dl-row-btn"
              onClick={() => onResume(download.id)}
              title="Resume"
              aria-label="Resume download"
            >
              <PlayIcon />
            </button>
          )}
          <button
            className="dl-row-btn danger"
            onClick={() => onRemove(download.id)}
            title={isCompleted ? "Remove from history" : "Remove"}
            aria-label="Remove download"
          >
            <RemoveIcon />
          </button>
          <button
            className="dl-row-btn danger-fill"
            onClick={() => onDeleteFiles(download)}
            title="Delete from disk"
            aria-label="Delete download from disk"
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {expanded && download.files && download.files.length > 0 && (
        <div className="dl-row-details">
          <div className="dl-files-list">
            {download.files.map((file, idx) => (
              <div key={idx} className="dl-file-item" style={{ opacity: file.selected ? 1 : 0.45 }}>
                <input
                  type="checkbox"
                  checked={file.selected}
                  disabled={isCompleted}
                  onChange={() => handleToggleFile(idx)}
                  title={file.selected ? "File selected for download" : "File skipped"}
                  style={{
                    cursor: isCompleted ? "not-allowed" : "pointer",
                    width: "14px",
                    height: "14px",
                    margin: "0"
                  }}
                />
                <span className="dl-file-name" title={file.name} style={{ textDecoration: file.selected ? "none" : "line-through" }}>
                  {file.name}
                </span>
                <span className="dl-file-size">
                  {formatBytesShort(file.size, unit)}
                </span>
                <div className="dl-file-progress-bar">
                  <div
                    className="dl-file-progress-fill"
                    style={{ width: `${file.progress * 100}%` }}
                  />
                </div>
                <span className="dl-file-percentage">
                  {Math.round(file.progress * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  const a = prevProps.download;
  const b = nextProps.download;
  
  // Shallow structural comparison
  if (
    a.id !== b.id ||
    a.name !== b.name ||
    a.downloaded !== b.downloaded ||
    a.totalSize !== b.totalSize ||
    a.progress !== b.progress ||
    a.downloadSpeed !== b.downloadSpeed ||
    a.uploadSpeed !== b.uploadSpeed ||
    a.peers !== b.peers ||
    a.seeds !== b.seeds ||
    a.status.kind !== b.status.kind
  ) {
    return false;
  }
  
  if (a.status.kind === "error" && b.status.kind === "error" && a.status.message !== b.status.message) {
    return false;
  }
  
  if ((a.files?.length ?? 0) !== (b.files?.length ?? 0)) return false;
  if (a.files && b.files) {
    for (let j = 0; j < a.files.length; j++) {
      const fa = a.files[j];
      const fb = b.files[j];
      if (
        fa.name !== fb.name ||
        fa.selected !== fb.selected ||
        fa.progress !== fb.progress ||
        fa.downloaded !== fb.downloaded
      ) {
        return false;
      }
    }
  }
  
  return true;
});

DownloadRow.displayName = "DownloadRow";
export default DownloadRow;
