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
  FolderIcon,
} from "./DownloadIcons";
import {
  formatBytesPerSecond,
  formatBytesShort,
  formatProgress,
  getStatusError,
  getStatusLabel,
  getStatusClassSuffix,
  getActivityMessage,
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
  const { updateSelectedFiles, updateDirectDownloadUrl, openDownloadFolder } = useDownloads();
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
  const isDirect =
    download.id.startsWith("dd_") || download.id.startsWith("db_");
  const activity = getActivityMessage(download);
  // One-line answer to "is the torrent actually making progress?"
  // becomes extra-emphasised when the swarm reports active peers but
  // zero bytes/sec — that's the classic "stalled" failure mode and
  // we want the user to notice it without us shouting in a separate
  // banner. (The colour tint alone isn't enough because Downloading
  // and Stalled share the same `accent` family.)
  const isStalledActivity =
    !isDirect &&
    status.kind === "downloading" &&
    download.peers > 0 &&
    download.downloadSpeed === 0 &&
    (download.totalSize ?? 0) > 0;

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
              {download.id.startsWith("dd_") && (
                <span className="dl-row-badge dl-row-badge--direct">DIRECT</span>
              )}
              {download.id.startsWith("db_") && (
                <span className="dl-row-badge dl-row-badge--debrid">DEBRID</span>
              )}
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
          {activity && (
            <div
              className={`dl-row-activity dl-row-activity--${status.kind}${
                isStalledActivity ? " dl-row-activity--stalled" : ""
              }`}
            >
              <span className="dl-row-activity-dot" aria-hidden />
              <span className="dl-row-activity-text">{activity}</span>
            </div>
          )}
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
          {download.uris && download.uris.length > 1 && (
            <div className="dl-row-mirror-select-wrapper">
              <select
                className="dl-row-mirror-select"
                value={download.sourceUri}
                onChange={async (e) => {
                  try {
                    await updateDirectDownloadUrl(download.id, e.target.value);
                    showToast("Download mirror updated successfully", "success");
                  } catch (err) {
                    showToast(`Failed to update mirror: ${err}`, "error");
                  }
                }}
                title="Switch mirror hoster"
                aria-label="Switch mirror hoster"
              >
                {download.uris.map((uri, idx) => {
                  let hoster = "Mirror " + (idx + 1);
                  try {
                    const parsed = new URL(uri);
                    hoster = parsed.hostname.replace("www.", "");
                  } catch {}
                  return (
                    <option key={idx} value={uri}>
                      {hoster}
                    </option>
                  );
                })}
              </select>
              <span className="dl-row-mirror-select-caret" aria-hidden>▼</span>
            </div>
          )}
          <button
            className="dl-row-btn"
            onClick={async () => {
              try {
                await openDownloadFolder(download.id);
              } catch (err) {
                showToast(`Failed to open folder: ${err}`, "error");
              }
            }}
            title="Open folder"
            aria-label="Open download folder"
          >
            <FolderIcon />
          </button>
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
              <div key={idx} className={`dl-file-item${file.selected ? "" : " dl-file-item--skipped"}`}>
                <input
                  type="checkbox"
                  className="dl-file-checkbox"
                  checked={file.selected}
                  disabled={isCompleted}
                  onChange={() => handleToggleFile(idx)}
                  aria-label={
                    file.selected
                      ? `Deselect ${file.name}`
                      : `Select ${file.name}`
                  }
                  title={file.selected ? "File selected for download" : "File skipped"}
                />
                <span
                  className={`dl-file-name${file.selected ? "" : " dl-file-name--skipped"}`}
                  title={file.name}
                >
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
    a.status.kind !== b.status.kind ||
    a.sourceUri !== b.sourceUri
  ) {
    return false;
  }
  
  if (a.status.kind === "error" && b.status.kind === "error" && a.status.message !== b.status.message) {
    return false;
  }
  
  if ((a.uris?.length ?? 0) !== (b.uris?.length ?? 0)) return false;
  if (a.uris && b.uris) {
    for (let j = 0; j < a.uris.length; j++) {
      if (a.uris[j] !== b.uris[j]) return false;
    }
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
