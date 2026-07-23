// Downloads page — the dedicated home for the download subsystem.
//
// Layout (top to bottom, single scrollable column):
//
//   ┌────────────────────────────────────────┐
//   │  Page title + magnet input bar         │
//   ├────────────────────────────────────────┤
//   │  Bandwidth hero (active / dl / ul)     │
//   ├────────────────────────────────────────┤
//   │  Toolbar (pause all / resume all /     │
//   │           clear history)               │
//   ├────────────────────────────────────────┤
//   │  Active downloads list                 │
//   │  (DownloadRow per torrent)             │
//   ├────────────────────────────────────────┤
//   │  History list (collapsible)            │
//   └────────────────────────────────────────┘
//
// We deliberately do NOT use in-page tabs — the user wants to
// scroll through everything in one column. The history section is
// collapsed by default when it gets too long (so a 6-month-old
// library doesn't dominate the viewport) and exposes a "Show
// more" affordance when the user does want to browse it.

import { useMemo, useState } from "react";
import { useDownloads } from "../context/DownloadContext";
import { useToast } from "../context/ToastContext";
import { useSizeUnit } from "../hooks/useSizeUnit";
import {
  compareDownloads,
  formatBytesShort,
  isActiveStatus,
  matchesSearchQuery,
  matchesStatusFilter,
  type DownloadSort,
  type DownloadStatusFilter,
  type TorrentDownload,
} from "../types/download";
import BandwidthHero from "../components/downloads/BandwidthHero";
import BandwidthSparkline from "../components/downloads/BandwidthSparkline";
import MagnetInputBar from "../components/downloads/MagnetInputBar";
import DownloadsToolbar from "../components/downloads/DownloadsToolbar";
import DownloadsFilterBar from "../components/downloads/DownloadsFilterBar";
import DownloadRow from "../components/downloads/DownloadRow";
import { ConfirmModal, PageHeader } from "../components/ui";
import "../styles/page-downloads.css";

const HISTORY_PREVIEW = 5;

import { useBigScreen } from "../context/BigScreenContext";
import BigScreenSystem from "../components/bigscreen/BigScreenSystem";

export default function DownloadsPage() {
  const { isBigScreen } = useBigScreen();
  if (isBigScreen) {
    return <BigScreenSystem />;
  }
  const {
    downloads,
    activeDownloads,
    completedDownloads,
    pauseDownload,
    resumeDownload,
    removeDownload,
    loading,
  } = useDownloads();
  const { showToast } = useToast();
  const { unit } = useSizeUnit();
  const [historyExpanded, setHistoryExpanded] = useState(false);

  // ── Search / filter / sort state ─────────────────────────────────
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<DownloadStatusFilter>("all");
  const [sort, setSort] = useState<DownloadSort>("added-desc");

  // Per-bucket counts for the filter pill badges (computed over the
  // full list, unaffected by the current search query so the badges
  // stay stable as the user types).
  const counts = useMemo<Record<DownloadStatusFilter, number>>(() => {
    const c: Record<DownloadStatusFilter, number> = {
      all: downloads.length,
      downloading: 0,
      paused: 0,
      completed: 0,
      error: 0,
    };
    for (const d of downloads) {
      if (matchesStatusFilter(d, "downloading")) c.downloading += 1;
      else if (matchesStatusFilter(d, "paused")) c.paused += 1;
      else if (matchesStatusFilter(d, "completed")) c.completed += 1;
      else if (matchesStatusFilter(d, "error")) c.error += 1;
    }
    return c;
  }, [downloads]);

  // Apply search + status filter + sort to each section. The status
  // pills act as a cross-section filter: picking "Completed" empties
  // the Active section and vice-versa, which is the expected mental
  // model when the user narrows to a single state.
  const comparator = useMemo(() => compareDownloads(sort), [sort]);

  const filteredActive = useMemo(
    () =>
      activeDownloads
        .filter(
          (d) =>
            matchesSearchQuery(d, query) && matchesStatusFilter(d, statusFilter),
        )
        .sort(comparator),
    [activeDownloads, query, statusFilter, comparator],
  );

  const filteredHistory = useMemo(
    () =>
      completedDownloads
        .filter(
          (d) =>
            matchesSearchQuery(d, query) && matchesStatusFilter(d, statusFilter),
        )
        .sort(comparator),
    [completedDownloads, query, statusFilter, comparator],
  );

  const isFiltering = query.trim() !== "" || statusFilter !== "all";

  // ── "Delete from disk" confirmation state ────────────────────────
  // At most one modal at a time. `deletingContext` carries the full
  // record so the dialog can render name / size / save path context;
  // null means no modal open. `deletingBusy` keeps the buttons
  // disabled while the Rust call is in flight so a double-click
  // can't fire the destructive command twice.
  const [deletingContext, setDeletingContext] = useState<TorrentDownload | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  // ── "Remove active download" confirmation state ──────────────────
  // Removing an in-progress download discards its partial progress,
  // so we guard it behind a confirm dialog (completed/history rows
  // remove silently since there's nothing to lose).
  const [removingContext, setRemovingContext] = useState<TorrentDownload | null>(null);
  const [removingBusy, setRemovingBusy] = useState(false);

  // Pause / resume / remove handlers. Errors are surfaced via the
  // shared toast so the failure mode is consistent with the
  // popover's behaviour.
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
    // For active (still-in-flight) downloads, open a confirmation
    // dialog first — removing them throws away partial progress.
    // Completed / history rows remove immediately.
    const target = downloads.find((d) => d.id === id);
    if (target && isActiveStatus(target.status)) {
      setRemovingContext(target);
      return;
    }
    try {
      await removeDownload(id, false);
      showToast("Download removed", "info");
    } catch (err) {
      showToast(`Remove failed: ${err}`, "error");
    }
  }

  async function confirmRemoveActive() {
    if (!removingContext) return;
    const target = removingContext;
    setRemovingBusy(true);
    try {
      await removeDownload(target.id, false);
      showToast(`Removed "${target.name}"`, "info");
      setRemovingContext(null);
    } catch (err) {
      showToast(`Remove failed: ${err}`, "error");
    } finally {
      setRemovingBusy(false);
    }
  }


  // "Delete from disk" — opens the confirmation dialog with full
  // download context. The actual Rust call (`removeDownload` with
  // `deleteFiles=true`) only fires from `confirmDelete`.
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

  return (
    <div className="dl-page page">
      <PageHeader
        eyebrow="Download Manager"
        title="Downloads"
        description="Manage active torrents, browse history, and add new downloads."
        actions={<MagnetInputBar />}
      />

      <BandwidthHero />
      <BandwidthSparkline />

      <DownloadsFilterBar
        query={query}
        onQueryChange={setQuery}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        sort={sort}
        onSortChange={setSort}
        counts={counts}
      />

      <section
        className="dl-section"
        aria-labelledby="dl-section-active"
      >
        <div className="dl-section-header">
          <h3 id="dl-section-active" className="dl-section-title">
            Active
            {filteredActive.length > 0 && (
              <span className="dl-section-count">{filteredActive.length}</span>
            )}
          </h3>
          <DownloadsToolbar
            activeCount={activeDownloads.length}
            historyCount={completedDownloads.length}
          />
        </div>

        <div className="dl-list">
          {loading && activeDownloads.length === 0 && completedDownloads.length === 0 ? (
            <div className="dl-list-empty">
              <div className="spinner-small" />
              <span>Loading downloads…</span>
            </div>
          ) : filteredActive.length === 0 && activeDownloads.length > 0 ? (
            <div className="dl-list-no-match">
              No active downloads match your filters.
            </div>
          ) : activeDownloads.length === 0 ? (
            <div className="dl-list-empty">
              <svg
                className="dl-list-empty-icon"
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
              <p className="dl-list-empty-title">No active downloads</p>
              <p className="dl-list-empty-hint">
                Paste a magnet link above, or start one from a game's
                Store or Library page.
              </p>
            </div>
          ) : (
            filteredActive.map((d) => (
              <DownloadRow
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
      </section>

      <section
        className="dl-section"
        aria-labelledby="dl-section-history"
      >
        <div className="dl-section-header">
          <h3 id="dl-section-history" className="dl-section-title">
            History
            {filteredHistory.length > 0 && (
              <span className="dl-section-count">{filteredHistory.length}</span>
            )}
          </h3>
        </div>

        <div className="dl-list">
          {filteredHistory.length === 0 && completedDownloads.length > 0 ? (
            <div className="dl-list-no-match">
              No completed downloads match your filters.
            </div>
          ) : completedDownloads.length === 0 ? (
            <div className="dl-list-empty">
              <svg
                className="dl-list-empty-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <p className="dl-list-empty-title">No completed downloads</p>
              <p className="dl-list-empty-hint">
                Finished downloads will show up here for quick reference.
              </p>
            </div>
          ) : (
            <>
              {(historyExpanded || isFiltering
                ? filteredHistory
                : filteredHistory.slice(0, HISTORY_PREVIEW)
              ).map((d) => (
                <DownloadRow
                  key={d.id}
                  download={d}
                  onPause={handlePause}
                  onResume={handleResume}
                  onRemove={handleRemove}
                  onDeleteFiles={handleDeleteFiles}
                />
              ))}
              {!isFiltering && filteredHistory.length > HISTORY_PREVIEW && (
                <button
                  className="dl-list-show-more"
                  onClick={() => setHistoryExpanded((v) => !v)}
                >
                  {historyExpanded
                    ? "Show less"
                    : `Show ${filteredHistory.length - HISTORY_PREVIEW} more`}
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                    style={{
                      width: 12,
                      height: 12,
                      transform: historyExpanded
                        ? "rotate(180deg)"
                        : "none",
                      transition: "transform 200ms ease",
                    }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              )}
            </>
          )}
        </div>
      </section>

      {/* ── "Delete from disk" confirmation ──────────────────────
       * Single modal per page. Renders into `document.body` via
       * the ConfirmModal portal so the modal is not clipped by
       * ancestor overflow rules. The dialog is rich: it surfaces
       * the bytes that will be wiped, the save path, and — when
       * the torrent auto-extracted on completion — an extra note
       * that the installed game files are NOT being removed. */}
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

      {/* ── "Remove active download" confirmation ────────────────
       * Guards the plain Remove (X) action for still-in-flight
       * downloads. Files are kept on disk — this only discards the
       * queue entry and its partial progress. */}
      <ConfirmModal
        open={removingContext !== null}
        title={
          removingContext ? (
            <>
              Remove <strong>{removingContext.name}</strong>?
            </>
          ) : (
            "Remove download?"
          )
        }
        message={
          removingContext && (
            <>
              This download is still in progress. Removing it discards its
              partial progress
              {removingContext.progress != null && removingContext.progress > 0 ? (
                <>
                  {" "}(
                  <strong>{Math.round(removingContext.progress * 100)}%</strong>{" "}
                  downloaded)
                </>
              ) : null}
              . The downloaded files are kept on disk — use "Delete from disk"
              to remove those too.
            </>
          )
        }
        confirmLabel="Remove download"
        busy={removingBusy}
        onConfirm={confirmRemoveActive}
        onCancel={() => {
          if (!removingBusy) setRemovingContext(null);
        }}
      />
    </div>
  );
}
