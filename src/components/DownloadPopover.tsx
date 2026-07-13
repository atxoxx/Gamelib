// Topnav-anchored popover for managing downloads.
//
// Opens when the user clicks the download button in the topnav.
// Shows the full list of downloads split into "Active" and "History"
// (completed) tabs. Each card has inline pause/resume/remove actions,
// and the History tab exposes a "Clear history" affordance so the
// completed list doesn't accumulate forever.
//
// Replaces the previous floating "live activity" widget:
//
//   * Same data source (`useDownloads`), so state stays in sync with
//     the engine in real time.
//   * Discoverability: anchored to a button that always shows the
//     active count, so users don't need to wait for a download to
//     start before knowing where to look.
//   * Consistency: the topnav right-hand cluster is the place every
//     other app puts a "system tray"-style entry point, so users
//     who muscle-memory reach for it will find the downloads UI.
//
// Behavior:
//   * Click outside the popover or the button → closes.
//   * Escape key → closes.
//   * Tabs auto-switch if a tab becomes empty (so an Open → none-active
//     transition swaps to History automatically).
//   * The History tab's "Clear history" removes every completed
//     download; if you want per-item delete, use the card's Remove
//     button instead.

import { useState, useEffect, useRef, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { useDownloads } from "../context/DownloadContext";
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
} from "../types/download";
import { useToast } from "../context/ToastContext";
import { useSizeUnit } from "../hooks/useSizeUnit";
import { ConfirmModal } from "./ui";

import React from "react";
import {
  PlayIcon,
  PauseIcon,
  RemoveIcon,
  TrashIcon,
  PeersIcon,
  SeedsIcon,
} from "./downloads/DownloadIcons";

interface DownloadPopoverProps {
  open: boolean;
  onClose: () => void;
  /** Button (or trigger) that opened the popover. Clicks inside this
   *  element are ignored by the click-outside handler so the user
   *  can toggle the popover by tapping the button twice. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Optional id used for ARIA linking with the trigger button's
   *  `aria-controls`. Required for screen-reader correctness. */
  id?: string;
}

type TabKey = "active" | "history";

/**
 * Per-card actions. Each action is a small icon button — we keep the
 * surface minimal so a 380px panel can fit 2-3 cards before scrolling.
 *
 * Mirrors the layout of the old floating widget so anyone who used
 * that surface will recognise it instantly.
 */
const DownloadCard = React.memo(({
  download,
  onPause,
  onResume,
  onRemove,
  onDeleteFiles,
}: {
  download: TorrentDownload;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRemove: (id: string) => void;
  /** Parent opens a confirmation dialog before invoking the actual
   * `removeDownload(id, true)` — we pass the whole record so the
   * dialog can render size / name / save path context. */
  onDeleteFiles: (download: TorrentDownload) => void;
}) => {
  const { unit } = useSizeUnit();
  const status = download.status;
  const errorMessage = getStatusError(status);
  const indeterminate = download.progress == null && isActiveStatus(status);
  const isPaused = status.kind === "paused";
  const isCompleted = status.kind === "completed";
  const isError = status.kind === "error";

  // Border tint + indeterminate bar animation
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
          {download.id.startsWith("dd_") && (
            <span style={{ marginLeft: "6px", fontSize: "9px", padding: "2px 4px", background: "rgba(124, 102, 255, 0.15)", color: "var(--color-accent)", borderRadius: "3px", fontWeight: "bold" }}>DIRECT</span>
          )}
          {download.id.startsWith("db_") && (
            <span style={{ marginLeft: "6px", fontSize: "9px", padding: "2px 4px", background: "rgba(0, 240, 255, 0.15)", color: "#00f0ff", borderRadius: "3px", fontWeight: "bold" }}>DEBRID</span>
          )}
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
          <div className="dl-progress-card-stats-row">
            <span>
              <strong>{formatProgress(download.progress)}</strong>
              {download.totalSize != null ? (
                <> · {formatBytesShort(download.downloaded, unit)} / {formatBytesShort(download.totalSize, unit)}</>
              ) : (
                download.downloaded > 0 && <> · {formatBytesShort(download.downloaded, unit)}</>
              )}
            </span>
            {isActiveStatus(status) && download.downloadSpeed > 0 && (
              <span
                className="dl-progress-card-stat-dl"
                title="Download speed"
                aria-label={`Download speed: ${formatBytesPerSecond(download.downloadSpeed, unit)}`}
              >
                <span className="dl-progress-card-stat-icon" aria-hidden>↓</span>
                {formatBytesPerSecond(download.downloadSpeed, unit)}
              </span>
            )}
            {isCompleted && download.totalSize != null && (
              <span className="dl-progress-card-stat-meta">
                via {download.sourceName}
              </span>
            )}
          </div>
          {isActiveStatus(status) && download.downloadSpeed > 0 && download.totalSize != null && (
            <div className="dl-progress-card-stats-row" style={{ fontSize: "9px", color: "var(--color-text-muted)", marginTop: "1px" }}>
              <span>{formatEta(download.downloaded, download.totalSize, download.downloadSpeed)}</span>
            </div>
          )}
          {(() => {
            // Show the secondary row whenever the torrent is
            // active OR paused with a non-zero swarm. Paused
            // torrents don't get an upload-speed slot (the
            // count is stale) but their swarm numbers are
            // still useful for "should I resume?" decisions.
            const isPaused = status.kind === "paused";
            const hasSwarm = download.peers > 0 || download.seeds > 0;
            const hasUl = isActiveStatus(status) && download.uploadSpeed > 0;
            const showSecondary = isActiveStatus(status)
              ? hasUl || hasSwarm
              : isPaused && hasSwarm;
            if (!showSecondary) return null;
            return (
              <div className="dl-progress-card-stats-row secondary">
                {hasUl && (
                  <span
                    className="dl-progress-card-stat-ul"
                    title="Upload speed"
                    aria-label={`Upload speed: ${formatBytesPerSecond(download.uploadSpeed, unit)}`}
                  >
                    <span
                      className="dl-progress-card-stat-icon"
                      aria-hidden
                    >↑</span>
                    {formatBytesPerSecond(download.uploadSpeed, unit)}
                  </span>
                )}
                <span
                  className="dl-progress-card-stat-seeds"
                  title="Known peers in swarm (approximate; excludes those currently connected)"
                  aria-label={`${download.seeds} known peers in swarm`}
                >
                  <SeedsIcon className="dl-progress-card-stat-svg" />
                  {download.seeds}
                </span>
                <span
                  className="dl-progress-card-stat-peers"
                  title="Peers currently connected"
                  aria-label={`${download.peers} peers currently connected`}
                >
                  <PeersIcon className="dl-progress-card-stat-svg" />
                  {download.peers}
                </span>
              </div>
            );
          })()}
        </div>
        <div className="dl-progress-card-actions">
          {isActiveStatus(status) && !isPaused && (
            <button
              className="dl-progress-card-btn"
              onClick={() => onPause(download.id)}
              title="Pause"
              aria-label="Pause download"
            >
              <PauseIcon />
            </button>
          )}
          {isPaused && (
            <button
              className="dl-progress-card-btn"
              onClick={() => onResume(download.id)}
              title="Resume"
              aria-label="Resume download"
            >
              <PlayIcon />
            </button>
          )}
          <button
            className="dl-progress-card-btn danger"
            onClick={() => onRemove(download.id)}
            title={isCompleted ? "Remove from history" : "Remove"}
            aria-label="Remove download"
          >
            <RemoveIcon />
          </button>
          <button
            className="dl-progress-card-btn danger-fill"
            onClick={() => onDeleteFiles(download)}
            title="Delete from disk"
            aria-label="Delete download from disk"
          >
            <TrashIcon />
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
}, (prevProps, nextProps) => {
  const a = prevProps.download;
  const b = nextProps.download;
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
  if (a.status.kind === "error" && b.status.kind === "error") {
    return a.status.message === b.status.message;
  }
  return true;
});
DownloadCard.displayName = "DownloadCard";

export default function DownloadPopover({
  open,
  onClose,
  anchorRef,
  id,
}: DownloadPopoverProps) {
  const {
    activeDownloads,
    completedDownloads,
    pauseDownload,
    resumeDownload,
    removeDownload,
  } = useDownloads();
  const { showToast } = useToast();
  const { unit } = useSizeUnit();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>("active");
  const [clearing, setClearing] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // ── "Delete from disk" confirmation state ────────────────────────
  // At most one modal per popover instance. The dialog is rendered
  // via a React Portal inside `ConfirmModal`, which is critical
  // here — the popover has `overflow: hidden` and would otherwise
  // clip the overlay.
  const [deletingContext, setDeletingContext] = useState<TorrentDownload | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  function handleDeleteFiles(download: TorrentDownload) {
    setDeletingContext(download);
  }

  async function confirmDelete() {
    if (!deletingContext) return;
    const target = deletingContext;
    setDeletingBusy(true);
    try {
      await removeDownload(target.id, true);
      showToast(
        target.autoExtract
          ? `Deleted archives for "${target.name}"; installed files kept`
          : `Deleted "${target.name}" from disk`,
        "info",
      );
      setDeletingContext(null);
    } catch (err) {
      showToast(`Delete failed: ${err}`, "error");
    } finally {
      setDeletingBusy(false);
    }
  }

  // Navigate to the dedicated Downloads page and close the popover.
  // We close the popover explicitly (rather than relying on
  // unmount) so the click-outside effect doesn't fight the route
  // change.
  function handleViewAll() {
    onClose();
    navigate("/downloads");
  }

  // ── Click outside + Escape to close ─────────────────────────────────
  // Critical: when the user has a "Delete from disk" confirmation
  // modal open (which renders into `document.body` via React Portal),
  // clicks INSIDE that modal also count as "outside the popover" by
  // the naive `popoverRef.contains` / `anchorRef.contains` check,
  // which would otherwise fire `onClose` and orphan the dialog
  // mid-confirmation. We additionally exclude any mousedown whose
  // target is inside a `.modal-backdrop`.
  //
  // TypeScript note: `closest` is defined on `Element`, not on the
  // abstract `Node` interface, so we narrow the target to Element
  // before calling it (and short-circuit on Text nodes etc. which
  // have no `closest`).
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      const inModal = target instanceof Element
        ? target.closest(".modal-backdrop")
        : null;
      if (inModal) return;
      const inPopover = popoverRef.current?.contains(target ?? null);
      const inAnchor = anchorRef.current?.contains(target ?? null);
      if (!inPopover && !inAnchor) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef, deletingContext]);

  // ── Auto-switch tabs when one becomes empty ─────────────────────────
  // Smooth UX so a user who just finished their last download isn't
  // left looking at "No active downloads" — the panel flips to
  // History automatically.
  useEffect(() => {
    if (tab === "active" && activeDownloads.length === 0 && completedDownloads.length > 0) {
      setTab("history");
    }
    if (tab === "history" && completedDownloads.length === 0 && activeDownloads.length > 0) {
      setTab("active");
    }
  }, [tab, activeDownloads.length, completedDownloads.length]);

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

  async function handleClearHistory() {
    if (clearing) return;
    setClearing(true);
    const ids = completedDownloads.map((d) => d.id);
    let success = 0;
    let failed = 0;
    try {
      // Fire sequentially — Rust side does file-system work per call
      // and we don't want a thundering herd against the engine.
      for (const id of ids) {
        try {
          await removeDownload(id, false);
          success++;
        } catch {
          failed++;
        }
      }
      if (failed === 0) {
        showToast(`Cleared ${success} from history`, "info");
      } else {
        showToast(`Cleared ${success}, ${failed} failed`, "error");
      }
    } finally {
      setClearing(false);
    }
  }

  if (!open) return null;

  const activeCount = activeDownloads.length;
  const historyCount = completedDownloads.length;
  const list = tab === "active" ? activeDownloads : completedDownloads;
  const totalCount = activeCount + historyCount;

  return (
    <div
      id={id}
      className="dl-popover"
      ref={popoverRef}
      role="dialog"
      aria-label="Downloads manager"
    >
      <div className="dl-popover-header">
        <div className="dl-popover-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === "active"}
            className={`dl-popover-tab${tab === "active" ? " active" : ""}`}
            onClick={() => setTab("active")}
          >
            Active
            {activeCount > 0 && (
              <span className={`dl-popover-tab-count${activeCount > 0 && tab !== "active" ? " pulse" : ""}`}>
                {activeCount}
              </span>
            )}
          </button>
          <button
            role="tab"
            aria-selected={tab === "history"}
            className={`dl-popover-tab${tab === "history" ? " active" : ""}`}
            onClick={() => setTab("history")}
          >
            History
            {historyCount > 0 && (
              <span className="dl-popover-tab-count">{historyCount}</span>
            )}
          </button>
        </div>
        <button
          className="dl-popover-close"
          onClick={onClose}
          aria-label="Close downloads panel"
          title="Close"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="dl-popover-body" role="tabpanel">
        {list.length === 0 ? (
          <div className="dl-popover-empty">
            <svg
              className="dl-popover-empty-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <p className="dl-popover-empty-title">
              {tab === "active"
                ? totalCount === 0
                  ? "No downloads yet"
                  : "No active downloads"
                : "No completed downloads"}
            </p>
            <p className="dl-popover-empty-hint">
              {tab === "active"
                ? "Start one from a game's Store or Library page."
                : "Completed downloads will appear here for easy access."}
            </p>
          </div>
        ) : (
          list.map((d) => (
            <DownloadCard
              key={d.id}
              download={d}
              onPause={handlePause}
              onResume={handleResume}
              onRemove={handleRemove}
              onDeleteFiles={handleDeleteFiles}
            />
          ))
        )}
      </div>

      {tab === "history" && historyCount > 0 && (
        <div className="dl-popover-footer">
          <button
            className="dl-popover-footer-btn"
            onClick={handleClearHistory}
            disabled={clearing}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
            </svg>
            {clearing ? "Clearing…" : "Clear history"}
          </button>
        </div>
      )}

      {/* Always-on footer link to the dedicated Downloads page.
       *  Sits below whatever the tab-specific footer (clear-history
       *  button, if any) renders, so it's visible on both the
       *  Active and History tabs. The link is the natural
       *  next-step once a popover user wants the full table view,
       *  bulk actions, or the magnet quick-add bar. */}
      <div className="dl-popover-footer dl-popover-footer--viewall">
        <button
          className="dl-popover-footer-link"
          onClick={handleViewAll}
          title="Open the full Downloads page"
        >
          <svg
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
          View all downloads
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            style={{ width: 12, height: 12, marginLeft: "auto" }}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* ── "Delete from disk" confirmation modal ────────────────
       * Rendered via Portal inside `ConfirmModal` so the popover's
       * `overflow: hidden` doesn't clip the overlay. The dialog
       * carries the same rich copy as the page-level modal: bytes
       * that will be wiped, save path, and a yellow warning when
       * auto-extract keeps the installed game files. */}
      <ConfirmModal
        open={deletingContext !== null}
        title={
          deletingContext ? (
            <>
              Delete <strong>{deletingContext.name}</strong> from disk?
            </>
          ) : (
            "Delete from disk?"
          )
        }
        message={
          deletingContext && (
            <>
              This will permanently remove{" "}
              <strong>
                {formatBytesShort(deletingContext.downloaded, unit)}
              </strong>{" "}
              from{" "}
              <code title={deletingContext.savePath}>
                {deletingContext.savePath}
              </code>
              . This action cannot be undone.
            </>
          )
        }
        warning={
          deletingContext?.autoExtract && (
            <>
              This download was auto-extracted. If any source archive files
              remain, only those will be removed — extracted game files in
              the same folder will stay on disk.
            </>
          )
        }
        confirmLabel={`Delete from disk${deletingContext?.autoExtract ? " (archives only)" : ""}`}
        busy={deletingBusy}
        onConfirm={confirmDelete}
        onCancel={() => {
          if (!deletingBusy) setDeletingContext(null);
        }}
      />
    </div>
  );
}
