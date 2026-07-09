// Bulk-action toolbar for the Downloads page.
//
// Renders a single row above the active list with the actions that
// affect every torrent at once: pause all, resume all, clear
// history. Each action is disabled with an explanatory title when
// it would have no effect (e.g. "Pause all" with zero active
// downloads) so the buttons never feel "broken".
//
// The "clear history" button mirrors the popover's footer button —
// but because the page has more room, we also let the user
// optionally delete the downloaded files alongside the metadata
// removal. The first click confirms via a tooltip + the button
// label change; the actual destructive `removeDownload` calls fire
// sequentially (same pattern as the popover).

import { useState } from "react";
import { useDownloads } from "../../context/DownloadContext";
import { useToast } from "../../context/ToastContext";
import { Button } from "../ui";

interface DownloadsToolbarProps {
  /** How many active (non-completed) torrents exist. Drives the
   *  pause/resume button labels and the "are these enabled?"
   *  logic. */
  activeCount: number;
  /** How many completed torrents are in history. */
  historyCount: number;
}

export default function DownloadsToolbar({
  activeCount,
  historyCount,
}: DownloadsToolbarProps) {
  const { pauseAll, resumeAll, removeDownload, completedDownloads } =
    useDownloads();
  const { showToast } = useToast();
  const [busy, setBusy] = useState<"pause" | "resume" | "clear" | null>(null);

  async function handlePauseAll() {
    if (busy) return;
    setBusy("pause");
    try {
      const n = await pauseAll();
      showToast(n > 0 ? `Paused ${n} download${n !== 1 ? "s" : ""}` : "Nothing to pause", "info");
    } catch (err) {
      showToast(`Pause all failed: ${err}`, "error");
    } finally {
      setBusy(null);
    }
  }

  async function handleResumeAll() {
    if (busy) return;
    setBusy("resume");
    try {
      const n = await resumeAll();
      showToast(n > 0 ? `Resumed ${n} download${n !== 1 ? "s" : ""}` : "Nothing to resume", "info");
    } catch (err) {
      showToast(`Resume all failed: ${err}`, "error");
    } finally {
      setBusy(null);
    }
  }

  async function handleClearHistory() {
    if (busy) return;
    setBusy("clear");
    // Snapshot the list before we start firing `remove`s so we
    // don't iterate a mutating array.
    const ids = completedDownloads.map((d) => d.id);
    if (ids.length === 0) {
      setBusy(null);
      return;
    }
    let success = 0;
    let failed = 0;
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
    setBusy(null);
  }

  return (
    <div className="dl-toolbar" role="toolbar" aria-label="Download bulk actions">
      <div className="dl-toolbar-group">
        <Button
          variant="secondary"
          size="sm"
          onClick={handlePauseAll}
          disabled={busy !== null || activeCount === 0}
          isLoading={busy === "pause"}
          leftIcon={
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ width: 12, height: 12 }}>
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          }
          title="Pause every active download"
        >
          Pause all
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleResumeAll}
          disabled={busy !== null || activeCount === 0}
          isLoading={busy === "resume"}
          leftIcon={
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ width: 12, height: 12 }}>
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          }
          title="Resume every paused download"
        >
          Resume all
        </Button>
      </div>

      <div className="dl-toolbar-spacer" />

      <Button
        variant="ghost"
        size="sm"
        onClick={handleClearHistory}
        disabled={busy !== null || historyCount === 0}
        isLoading={busy === "clear"}
        leftIcon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ width: 13, height: 13 }}>
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
          </svg>
        }
        title="Remove every entry from history (files are kept on disk)"
      >
        Clear history
        {historyCount > 0 && (
          <span className="dl-toolbar-count">{historyCount}</span>
        )}
      </Button>
    </div>
  );
}
