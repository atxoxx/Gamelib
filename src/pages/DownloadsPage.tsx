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

import { useState } from "react";
import { useDownloads } from "../context/DownloadContext";
import { useToast } from "../context/ToastContext";
import BandwidthHero from "../components/downloads/BandwidthHero";
import BandwidthSparkline from "../components/downloads/BandwidthSparkline";
import MagnetInputBar from "../components/downloads/MagnetInputBar";
import DownloadsToolbar from "../components/downloads/DownloadsToolbar";
import DownloadRow from "../components/downloads/DownloadRow";

const HISTORY_PREVIEW = 5;

export default function DownloadsPage() {
  const {
    activeDownloads,
    completedDownloads,
    pauseDownload,
    resumeDownload,
    removeDownload,
    loading,
  } = useDownloads();
  const { showToast } = useToast();
  const [historyExpanded, setHistoryExpanded] = useState(false);

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
    try {
      await removeDownload(id, false);
      showToast("Download removed", "info");
    } catch (err) {
      showToast(`Remove failed: ${err}`, "error");
    }
  }

  return (
    <div className="dl-page">
      <div className="dl-page-header">
        <div className="dl-page-title-block">
          <h2 className="dl-page-title">Downloads</h2>
          <p className="dl-page-subtitle">
            Manage active torrents, browse history, and add new downloads.
          </p>
        </div>
        <MagnetInputBar />
      </div>

      <BandwidthHero />
      <BandwidthSparkline />

      <section
        className="dl-section"
        aria-labelledby="dl-section-active"
      >
        <div className="dl-section-header">
          <h3 id="dl-section-active" className="dl-section-title">
            Active
            {activeDownloads.length > 0 && (
              <span className="dl-section-count">{activeDownloads.length}</span>
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
            activeDownloads.map((d) => (
              <DownloadRow
                key={d.id}
                download={d}
                onPause={handlePause}
                onResume={handleResume}
                onRemove={handleRemove}
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
            {completedDownloads.length > 0 && (
              <span className="dl-section-count">{completedDownloads.length}</span>
            )}
          </h3>
        </div>

        <div className="dl-list">
          {completedDownloads.length === 0 ? (
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
              {(historyExpanded
                ? completedDownloads
                : completedDownloads.slice(0, HISTORY_PREVIEW)
              ).map((d) => (
                <DownloadRow
                  key={d.id}
                  download={d}
                  onPause={handlePause}
                  onResume={handleResume}
                  onRemove={handleRemove}
                />
              ))}
              {completedDownloads.length > HISTORY_PREVIEW && (
                <button
                  className="dl-list-show-more"
                  onClick={() => setHistoryExpanded((v) => !v)}
                >
                  {historyExpanded
                    ? "Show less"
                    : `Show ${completedDownloads.length - HISTORY_PREVIEW} more`}
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
    </div>
  );
}
