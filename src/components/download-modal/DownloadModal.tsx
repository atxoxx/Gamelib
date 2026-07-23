// Download flow modal — opened from a Download button on the
// GamePage, StoreGameDetail, or anywhere else. Orchestrates:
//
//   1. `check_ownership`        — warn if the user owns the game on
//                                 Steam/Epic so they're nudged to
//                                 support the developers first
//   2. `sources_search_game`    — fuzzy-match the game name against
//                                 every enabled source's cache
//   3. (optional) `torrent_select_save_path` — open folder picker
//   4. `torrent_add`            — enqueue the download
//
// State machine (the `step` field):
//   `checking`  → fetch ownership + search in parallel
//   `results`   → user picks a source result, then a save path
//   `starting`  → torrent_add in flight
//   `error`     → unrecoverable error (e.g. save path selection
//                 cancelled, torrent_add rejected)
//
// The component is intentionally not routable — it's a transient
// overlay that calls `onClose` to dismiss itself. The parent owns
// the open/close state.
//
// The view is split into small presentational sub-components under
// `./download-modal` (results list, mirror picker, options, save-path
// picker, file selection, step states) so this file stays focused on
// the orchestration: state, backend calls, and keyboard handling.

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { useDownloads } from "../../context/DownloadContext";
import { useSources } from "../../context/SourceContext";
import { useGames } from "../../context/GameContext";
import { useToast } from "../../context/ToastContext";
import { Button } from "../ui";
import { ConfirmModal } from "../ui/ConfirmModal";
import { type OwnershipResult } from "../../types/download";
import { classifyUri, resolveSourceUri, sortMatches } from "./helpers";
import type { DownloadStep, SortKey, DisplayMatch } from "./types";
import { OwnershipBanner } from "./OwnershipBanner";
import { ConfidenceWarning } from "./ConfidenceWarning";
import { ResultsList } from "./ResultsList";
import { MirrorPicker } from "./MirrorPicker";
import { OptionsSection } from "./OptionsSection";
import { SavePathPicker } from "./SavePathPicker";
import { FileSelection } from "./FileSelection";
import {
  CheckingState,
  ErrorState,
  FetchingMetadataState,
  StartingStatus,
} from "./StepStates";

export interface DownloadModalProps {
  /** The game to look up. Required. */
  gameName: string;
  /** Optional: when set, the new download is tagged with this
   *  GameContext id so the progress panel can deep-link back. */
  gameId?: string;
  /** Optional: Steam AppID — used by the ownership check to look
   *  up Steam-specific ownership data. */
  steamAppId?: number;
  onClose: () => void;
}

export default function DownloadModal({
  gameName,
  gameId,
  steamAppId,
  onClose,
}: DownloadModalProps) {
  const {
    addDownload,
    addDirectDownload,
    selectSavePath,
    activeDownloads,
    completedDownloads,
    startSelectedDownload,
  } = useDownloads();
  const { searchSources } = useSources();
  const { games } = useGames();
  const { showToast } = useToast();

  const [step, setStep] = useState<DownloadStep>("checking");
  const [ownership, setOwnership] = useState<OwnershipResult | null>(null);
  const [matches, setMatches] = useState<DisplayMatch[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("date");
  // Reflected copy of `sortBy` so `runSearch` can pick the default
  // selected row from the currently-sorted list without re-running the
  // search every time the user changes the sort.
  const sortByRef = useRef<SortKey>(sortBy);
  sortByRef.current = sortBy;
  const [selectedMirrorIdx, setSelectedMirrorIdx] = useState(0);
  // Remember the last mirror the user picked for each source id, so
  // switching between results and back restores their choice instead
  // of always defaulting to Mirror 1.
  const lastMirrorBySourceRef = useRef<Record<string, number>>({});
  const [savePath, setSavePath] = useState<string | null>(() => {
    // Prefer the last-used path (so repeated downloads stay in one
    // place), then fall back to the configured default download
    // folder from Settings, then to "no path picked yet".
    return (
      localStorage.getItem("gamelib-last-download-path") ||
      localStorage.getItem("gamelib-default-download-path") ||
      null
    );
  });
  const [error, setError] = useState<string | null>(null);

  const [chooseFiles, setChooseFiles] = useState(false);
  const [autoExtract, setAutoExtract] = useState(false);
  const [tempTorrentId, setTempTorrentId] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<number>>(new Set());
  // Collapse low-confidence matches (score < 0.4) behind a toggle so
  // the list stays focused on the most likely correct title.
  const [showWeakMatches, setShowWeakMatches] = useState(false);
  // True after the 30s metadata fetch times out, so we can offer an
  // explicit "Try again" affordance rather than just an error string.
  const [metadataTimedOut, setMetadataTimedOut] = useState(false);
  // Confirm-before-close guard shown while a download is starting.
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  // Display order (re-sorted copy of `matches`) and the currently
  // selected match object. Selection is id-based so re-sorting never
  // desyncs the highlight from the underlying match.
  const sortedMatches = useMemo(
    () => sortMatches(matches, sortBy),
    [matches, sortBy],
  );
  const selectedMatch = useMemo(
    () => matches.find((m) => m.id === selectedId) ?? null,
    [matches, selectedId],
  );

  // Reset selected mirror when the selected result changes, and keep it
  // inside the bounds of that result's `uris` so we never hand
  // `resolveSourceUri` an out-of-range index (e.g. when moving from a
  // 4-mirror result to a 1-mirror one). Also restore the user's last
  // picked mirror for that source, and drop the "Choose files" flag
  // whenever the resolved URI is no longer a torrent (e.g. the user
  // switched to a direct-link mirror) so the hidden checkbox can't
  // leave the flag stale across source types.
  useEffect(() => {
    const match = matches.find((m) => m.id === selectedId);
    if (!match) {
      setSelectedMirrorIdx(0);
      return;
    }
    const maxIdx = Math.max(0, (match.uris.length ?? 1) - 1);
    setSelectedMirrorIdx((prevMirror) => {
      const remembered = lastMirrorBySourceRef.current[match.sourceId];
      const nextIdx =
        remembered != null && remembered <= maxIdx
          ? remembered
          : prevMirror > maxIdx
            ? 0
            : prevMirror;
      return nextIdx;
    });
    const { isDirect } = classifyUri(resolveSourceUri(match, selectedMirrorIdx));
    if (isDirect && chooseFiles) setChooseFiles(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, matches, chooseFiles]);

  // Single place to update the mirror so the choice is remembered per
  // source for later re-selection.
  const handleMirrorChange = useCallback(
    (idx: number) => {
      setSelectedMirrorIdx(idx);
      const match = matches.find((m) => m.id === selectedId);
      if (match) lastMirrorBySourceRef.current[match.sourceId] = idx;
    },
    [selectedId, matches],
  );
  // Marks the moment we entered the metadata-fetch phase so the 30s
  // timeout below is measured from first entry, not from the latest
  // progress poll (which would otherwise keep re-arming and never fire).
  const metadataEnteredAtRef = useRef<number | null>(null);

  // Wait for metadata loaded to show file checklist. The engine emits a
  // `download-progress` event once peers return the file list; when that
  // happens we flip to `file_selection`. If the swarm is dead / the
  // source is unreachable the event may never come, so we also arm a
  // timeout that bails back to `results` with a clear error instead of
  // hanging on the spinner forever.
  useEffect(() => {
    if (step !== "fetching_metadata" || !tempTorrentId) {
      metadataEnteredAtRef.current = null;
      return;
    }
    // Arm the watchdog once, on first entry into this step.
    if (metadataEnteredAtRef.current == null) {
      metadataEnteredAtRef.current = Date.now();
    }
    const onFilesReady = () => {
      const dl = activeDownloads.find((d) => d.id === tempTorrentId);
      if (dl && dl.files && dl.files.length > 0) {
        setSelectedFiles(new Set(dl.files.map((_, i) => i)));
        setStep("file_selection");
        return true;
      }
      return false;
    };
    if (onFilesReady()) return;
    // Only time out against the original entry timestamp, so the 2s
    // progress polls that re-run this effect don't keep resetting it.
    const elapsed = Date.now() - metadataEnteredAtRef.current;
    const remaining = Math.max(0, 30_000 - elapsed);
    const timeout = window.setTimeout(() => {
      if (cancelledRef.current) return;
      // Clean up the orphaned list-only torrent.
      invoke("torrent_remove", { id: tempTorrentId, deleteFiles: true }).catch((e) =>
        console.error("Failed to clean up timed-out temporary torrent:", e),
      );
      setTempTorrentId(null);
      setMetadataTimedOut(true);
      setError(
        "Timed out fetching the torrent's file list. The source may be unreachable — try another mirror or download the full torrent.",
      );
      setStep("results");
    }, remaining);
    return () => window.clearTimeout(timeout);
  }, [activeDownloads, step, tempTorrentId]);
  // Suppress the "user has not picked a save path" inline error
  // until they've tried to start at least once.
  const startAttemptedRef = useRef(false);
  const cancelledRef = useRef(false);
  // Ref to the results list container so we can scroll the keyboard-
  // highlighted row into view as the user arrows through results.
  const resultsListRef = useRef<HTMLDivElement | null>(null);
  const tempTorrentIdRef = useRef<string | null>(null);
  tempTorrentIdRef.current = tempTorrentId;
  // Seconds elapsed since the user clicked Start. Reset to 0 the
  // moment `step` leaves "starting" (success → modal closes, or
  // failure → step becomes "results" again). The footer renders
  // this as a "Starting for Ns…" hint so the user knows the
  // engine is still working, not stalled — especially important
  // for `http(s)://.torrent` sources where librqbit has to
  // download the torrent file before it can return.
  const [elapsedSec, setElapsedSec] = useState(0);

  // Snapshot the local library name list. The Rust `check_ownership*`
  // commands require a `local_library_names` argument; we pass the
  // names (not the whole Game records) so the wire payload stays
  // tiny even for a 5000-game library. The names array only needs
  // to re-snapshot when the *set* of names actually changes, so we
  // build a set-equality key (sorted + NUL-joined) that is
  // order-independent and immune to newline collisions in names.
  const namesKey = useMemo(
    () => games.map((g) => g.name).sort().join("\u0000"),
    [games],
  );
  const localLibraryNames = useMemo(
    () => games.map((g) => g.name),
    [namesKey],
  );

  // ── Step 1: ownership check + source search in parallel ─────────
  // Extracted into a callback so the Retry button can re-run it after
  // an error or a dead-swarm timeout.
  const runSearch = useCallback(async () => {
    setStep("checking");
    setError(null);
    setOwnership(null);
    try {
      // `check_ownership_for_ids` is the variant that takes an
      // explicit Steam AppId; falls back to `check_ownership`
      // (name-only) if no id is available. Both go through the
      // same Rust command registry so the frontend can pick the
      // most-specific one.
      const ownershipPromise: Promise<OwnershipResult> = steamAppId != null
        ? invoke<OwnershipResult>("check_ownership_for_ids", {
            gameName,
            steamAppId,
            localLibraryNames,
          })
        : invoke<OwnershipResult>("check_ownership", {
            gameName,
            localLibraryNames,
          });

      const [own, searchResults] = await Promise.all([
        ownershipPromise,
        searchSources(gameName, steamAppId).catch((e) => {
          console.error("[DownloadModal] searchSources failed:", e);
          return [];
        }),
      ]);

      setOwnership(own);
      // Sort the raw results by descending match score so the
      // strongest match is well-understood, then assign a stable id
      // per search so selection survives re-sorting by the user.
      const scored = [...searchResults].sort(
        (a, b) => b.matchScore - a.matchScore,
      );
      const withIds: DisplayMatch[] = scored.map((m, i) => ({
        ...m,
        id: `${m.sourceId}::${i}`,
      }));
      setMatches(withIds);
      // Auto-select the top row of the *currently sorted* list (date by
      // default) so the highlighted result matches what the user sees.
      const display = sortMatches(withIds, sortByRef.current);
      setSelectedId(display.length > 0 ? display[0].id : null);
      setStep("results");
    } catch (err) {
      console.error("[DownloadModal] initial checks failed:", err);
      setError(String(err));
      setStep("error");
    }
  }, [gameName, steamAppId, searchSources, localLibraryNames]);

  useEffect(() => {
    runSearch();
  }, [runSearch]);

  // ── Helpers ──────────────────────────────────────────────────────
  // Centralised close attempt: when a download is still starting we
  // confirm with the user before tearing it down (which would orphan the
  // temporary torrent). During `fetching_metadata` / `file_selection`
  // the temp torrent is cancelled and we return to the results step so
  // the user can pick another source rather than losing the whole flow.
  const handleCloseAttempt = useCallback(() => {
    if (step === "starting") {
      setConfirmCancelOpen(true);
      return;
    }
    if (step === "fetching_metadata" || step === "file_selection") {
      cancelledRef.current = true;
      if (tempTorrentIdRef.current) {
        invoke("torrent_remove", { id: tempTorrentIdRef.current, deleteFiles: true }).catch((e) =>
          console.error("Failed to remove list-only torrent on close:", e),
        );
      }
      setTempTorrentId(null);
      setStep("results");
      return;
    }
    onClose();
  }, [step, onClose]);

  const handleConfirmCancel = useCallback(() => {
    setConfirmCancelOpen(false);
    cancelledRef.current = true;
    onClose();
  }, [onClose]);

  const handlePickSavePath = useCallback(async () => {
    try {
      const path = await selectSavePath();
      if (path) {
        setSavePath(path);
        localStorage.setItem("gamelib-last-download-path", path);
      }
    } catch (err) {
      showToast(`Couldn't open folder picker: ${err}`, "error");
    }
  }, [selectSavePath, showToast]);

  const handleStart = useCallback(async () => {
    // Guard against double-firing (rapid clicks / Enter key) while a
    // download or metadata fetch is already in flight.
    if (step === "starting" || step === "fetching_metadata") return;
    cancelledRef.current = false;
    startAttemptedRef.current = true;
    setMetadataTimedOut(false);
    if (!selectedMatch) {
      setError("Pick a source result to download from.");
      return;
    }
    if (!savePath) {
      setError("Choose where to save the downloaded files.");
      return;
    }
    const match = selectedMatch;
    // Single source of truth for which URI the user wants. Respects the
    // mirror dropdown; falls back to magnet then first URI.
    const sourceUri = resolveSourceUri(match, selectedMirrorIdx);
    if (!sourceUri) {
      setError("Selected source has no downloadable link.");
      return;
    }
    setError(null);
    try {
      const safeGameFolder = gameName.replace(/[:*?"<>|\\/]/g, "").trim();
      const normalizedSave = savePath.replace(/\\/g, "/");
      const finalSavePath = normalizedSave.endsWith(safeGameFolder)
        ? savePath
        : `${savePath}/${safeGameFolder}`.replace(/\\/g, "/");

      const { isDirect } = classifyUri(sourceUri);

      if (isDirect) {
        setStep("starting");
        let targetFileName = "download";
        try {
          const urlObj = new URL(sourceUri);
          const pathname = urlObj.pathname;
          const lastSeg = pathname.substring(pathname.lastIndexOf('/') + 1);
          if (lastSeg && lastSeg.includes('.')) {
            targetFileName = lastSeg;
          } else {
            const titleMatch = match.title.match(/\.[a-zA-Z0-9]{2,4}$/);
            if (titleMatch) {
              targetFileName = match.title;
            } else {
              targetFileName = match.title + ".zip";
            }
          }
        } catch {
          targetFileName = match.title + ".zip";
        }

        targetFileName = targetFileName.replace(/[:*?"<>|\\/]/g, "").trim();
        const fullSavePath = `${finalSavePath}/${targetFileName}`.replace(/\\/g, "/");

        // Policy note: only direct-download links flow through the
        // `addDirectDownload` path (which earns a debrid unrestrict call
        // when a debrid provider is configured). Torrents — magnet URIs
        // and .torrent file URLs — never go through debrid so they stay
        // on the P2P path below. Debrid is intentionally restricted to
        // direct-link unrestriction here.
        await addDirectDownload(sourceUri, fullSavePath, gameId ?? null, match.sourceName, autoExtract, match.uris);
        showToast(
          `Downloading direct link "${targetFileName}" from ${match.sourceName}`,
          "success",
        );
        onClose();
        return;
      }

      // At this point `sourceUri` is either a magnet URI or a `.torrent`
      // URL — both are handled by the P2P torrent engine via
      // `torrent_add`. We deliberately do NOT route torrents through
      // debird (neither cache-check + unrestrict, nor upload-magnet +
      // status-poll): magnets and `.torrent` URLs are always downloaded
      // through `librqbit` (DHT / trackers / peer swarm), so the
      // metadata fetch, file selection, piece downloads, ratio stats,
      // and persistence all work the way a torrent client is expected
      // to behave.
      if (chooseFiles) {
        setStep("fetching_metadata");
        let newDl;
        try {
          newDl = await addDownload(sourceUri, finalSavePath, gameId ?? null, match.sourceName, autoExtract, true);
        } catch (addErr) {
          if (cancelledRef.current) return;
          console.error("[DownloadModal] list-only add failed:", addErr);
          setError(`Couldn't start the download: ${addErr}`);
          setStep("results");
          return;
        }
        if (cancelledRef.current) {
          invoke("torrent_remove", { id: newDl.id, deleteFiles: true }).catch((e) =>
            console.error("Failed to clean up cancelled temporary torrent:", e)
          );
          return;
        }
        setTempTorrentId(newDl.id);
      } else {
        setStep("starting");
        await addDownload(sourceUri, finalSavePath, gameId ?? null, match.sourceName, autoExtract, false);
        showToast(
          `Downloading "${match.title}" from ${match.sourceName}`,
          "success",
        );
        onClose();
      }
    } catch (err) {
      if (cancelledRef.current) return;
      console.error("[DownloadModal] download failed:", err);
      setError(String(err));
      setStep("results");
    }
  }, [
    selectedMirrorIdx,
    savePath,
    matches,
    addDownload,
    addDirectDownload,
    gameId,
    showToast,
    onClose,
    chooseFiles,
    autoExtract,
    gameName,
    step,
    selectedId,
  ]);

  // Clear the inline error when the user actively changes their
  // selection or save path. Note: `step` is intentionally NOT in
  // the dep array — `handleStart`'s catch block sets `step` to
  // "results" right after setting the error, and we don't want
  // this effect to immediately wipe that error. Only user-driven
  // changes (selectedIndex / savePath) should clear it.
  useEffect(() => {
    if (startAttemptedRef.current) {
      setError(null);
    }
  }, [selectedId, savePath]);

  // Clean up any temporary listing-only torrent on unmount (e.g. backdrop clicks, escape)
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (tempTorrentIdRef.current) {
        invoke("torrent_remove", { id: tempTorrentIdRef.current, deleteFiles: true }).catch((e) =>
          console.error("Failed to clean up temporary torrent on unmount:", e)
        );
      }
    };
  }, []);

  // Escape to close the modal — except when starting
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && step !== "starting") {
        if (step === "fetching_metadata" || step === "file_selection") {
          cancelledRef.current = true;
          if (tempTorrentIdRef.current) {
            invoke("torrent_remove", { id: tempTorrentIdRef.current, deleteFiles: true }).catch((e) =>
              console.error("Failed to remove list-only torrent on escape:", e)
            );
          }
          setTempTorrentId(null);
          setStep("results");
        } else {
          handleCloseAttempt();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [step, handleCloseAttempt]);

  // Arrow-key navigation through the results list (big-screen / remote
  // friendly). Up/Down move the selection, Enter starts the download.
  // Only active while we're showing the results list and nothing is
  // in flight.
  useEffect(() => {
    if (step !== "results" && step !== "starting") return;
    if (sortedMatches.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
      if (e.key === "Enter") {
        if (step === "results" && selectedId != null) handleStart();
        return;
      }
      e.preventDefault();
      setSelectedId((prevId) => {
        const baseIdx = sortedMatches.findIndex((m) => m.id === prevId);
        const base = baseIdx < 0 ? -1 : baseIdx;
        const delta = e.key === "ArrowDown" ? 1 : -1;
        const next = Math.min(sortedMatches.length - 1, Math.max(0, base + delta));
        const el = resultsListRef.current?.querySelectorAll(".dl-result-row")[next] as
          | HTMLElement
          | undefined;
        el?.scrollIntoView({ block: "nearest" });
        return sortedMatches[next].id;
      });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [step, sortedMatches, selectedId, handleStart]);

  // Tick the elapsed-seconds counter while the engine is
  // accepting the new torrent. Stops and resets the moment we
  // leave the "starting" state (either the modal closes on
  // success, or we fall back to "results" on failure). The
  // interval is created lazily so the timer doesn't leak.
  useEffect(() => {
    if (step !== "starting") {
      setElapsedSec(0);
      return;
    }
    const id = window.setInterval(() => {
      setElapsedSec((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [step]);

  // ── Render ──────────────────────────────────────────────────────

  // Titles of downloads that have already completed, so the results
  // list can flag which entries the user has downloaded before. We
  // normalise to lowercase for a case-insensitive match.
  const downloadedTitles = useMemo(() => {
    const set = new Set<string>();
    for (const d of completedDownloads) {
      if (d.name) set.add(d.name.trim().toLowerCase());
    }
    return set;
  }, [completedDownloads]);

  const isDownloaded = useCallback(
    (title: string) => downloadedTitles.has(title.trim().toLowerCase()),
    [downloadedTitles],
  );

  const statusChip = useMemo(() => {
    switch (step) {
      case "checking":
        return { label: "Searching", tone: "muted" as const };
      case "results":
        return { label: "Ready", tone: "success" as const };
      case "starting":
        return { label: "Starting", tone: "accent" as const };
      case "fetching_metadata":
        return { label: "Preparing", tone: "accent" as const };
      case "file_selection":
        return { label: "Select files", tone: "accent" as const };
      case "error":
        return { label: "Error", tone: "danger" as const };
    }
  }, [step]);

  const showResultsUI = step === "results" || step === "starting";

  // Render the modal into `document.body` via a React Portal so it
  // escapes any stacking context created by ancestor elements
  // (e.g. the Game page's hero cards). Without this, the modal's
  // z-index is confined to the closest stacking context, which
  // can cause it to be painted behind page-level surfaces even
  // though its z-index (9998) is technically very high. This
  // matches the pattern used by ImportModal, ConfirmModal, etc.
  return createPortal(
    <>
      <div
        className="modal-backdrop"
        onMouseDown={() => {
          if (step !== "starting") {
            handleCloseAttempt();
          }
        }}
      >
        <div
          className="modal dl-modal"
          onMouseDown={(e) => e.stopPropagation()}
          role="dialog"
          aria-label="Download"
        >
          <div className="modal-header">
            <div className="modal-header-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </div>
            <div className="modal-header-text">
              <h2 className="modal-title">Download</h2>
              <p className="modal-subtitle">{gameName}</p>
            </div>
            <span className={`dl-status-chip dl-status-chip--${statusChip.tone}`}>
              {statusChip.label}
            </span>
          </div>

          <div className="modal-body" style={{ padding: "var(--space-md)" }}>
            <OwnershipBanner ownership={ownership} step={step} />

            {showResultsUI && (
              <ConfidenceWarning matches={matches} gameName={gameName} />
            )}

            {step === "checking" && <CheckingState />}

            {step === "error" && (
              <ErrorState error={error} onRetry={() => runSearch()} />
            )}

            {showResultsUI && (
              <>
                <div ref={resultsListRef}>
                  <ResultsList
                    matches={sortedMatches}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    showWeakMatches={showWeakMatches}
                    onToggleWeak={() => setShowWeakMatches((v) => !v)}
                    isDownloaded={isDownloaded}
                    sortBy={sortBy}
                    onSortChange={setSortBy}
                  />
                </div>

                <SavePathPicker
                  savePath={savePath}
                  gameName={gameName}
                  onPickPath={handlePickSavePath}
                />

                {selectedMatch && (() => {
                  const match = selectedMatch;
                  const sourceUri = resolveSourceUri(match, selectedMirrorIdx);
                  const { isDirect } = classifyUri(sourceUri);
                  return (
                    <div className="dl-options-area">
                      <MirrorPicker
                        uris={match.uris}
                        selectedMirrorIdx={selectedMirrorIdx}
                        onChange={handleMirrorChange}
                      />
                      <OptionsSection
                        autoExtract={autoExtract}
                        onAutoExtract={setAutoExtract}
                        chooseFiles={chooseFiles}
                        onChooseFiles={setChooseFiles}
                        isDirect={isDirect}
                      />
                    </div>
                  );
                })()}
              </>
            )}

            {step === "fetching_metadata" && <FetchingMetadataState />}

            {step === "file_selection" && (
              <FileSelection
                files={activeDownloads.find((d) => d.id === tempTorrentId)?.files ?? []}
                selectedFiles={selectedFiles}
                onChange={setSelectedFiles}
              />
            )}

            {error && step === "results" && (
              <div className="dl-inline-error" role="alert">
                <p className="dl-inline-error-text">{error}</p>
                {metadataTimedOut && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleStart()}
                  >
                    Try again
                  </Button>
                )}
              </div>
            )}

            {step === "starting" && (
              <StartingStatus
                match={selectedMatch}
                selectedMirrorIdx={selectedMirrorIdx}
                elapsedSec={elapsedSec}
              />
            )}
          </div>

          <div className="modal-footer">
            <span className="modal-footer-count">
              {step === "results" && matches.length > 0
                ? `${matches.length} source result${matches.length !== 1 ? "s" : ""}`
                : step === "file_selection"
                  ? `${
                      activeDownloads.find((d) => d.id === tempTorrentId)?.files.length ?? 0
                    } total files`
                  : " " /* non-breaking space so the row doesn't collapse */}
            </span>
            <div className="modal-footer-actions">
              <Button
                variant="ghost"
                onClick={() => handleCloseAttempt()}
              >
                Cancel
              </Button>
              {step === "file_selection" ? (
                <Button
                  variant="primary"
                  onClick={async () => {
                    if (!tempTorrentId) return;
                    const activeId = tempTorrentId;
                    setStep("starting");
                    try {
                      setTempTorrentId(null);
                      await startSelectedDownload(activeId, Array.from(selectedFiles), autoExtract);
                      showToast("Download started with file selection", "success");
                      onClose();
                    } catch (e) {
                      setTempTorrentId(activeId);
                      setError(String(e));
                      setStep("file_selection");
                    }
                  }}
                  disabled={selectedFiles.size === 0}
                >
                  Confirm Download ({selectedFiles.size} selected)
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={handleStart}
                  disabled={
                    step === "starting" ||
                    step === "checking" ||
                    step === "fetching_metadata" ||
                    selectedMatch == null
                  }
                  isLoading={step === "starting"}
                  leftIcon={
                    step !== "starting" ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <polyline points="8 17 12 21 16 17" />
                        <line x1="12" y1="12" x2="12" y2="21" />
                        <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29" />
                      </svg>
                    ) : undefined
                  }
                >
                  {(() => {
                    const selMatch = selectedMatch;
                    const { isDirect } = classifyUri(
                      resolveSourceUri(selMatch ?? undefined, selectedMirrorIdx),
                    );
                    // The "Choose files" prompt only applies to torrents;
                    // direct links can't pre-list files, so they always
                    // start immediately.
                    if (chooseFiles && !isDirect) return "Fetch Files List";
                    return "Start Download";
                  })()}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={confirmCancelOpen}
        title="Cancel this download?"
        message="A download is still starting. Closing now will cancel it."
        confirmLabel="Cancel download"
        cancelLabel="Keep waiting"
        onConfirm={handleConfirmCancel}
        onCancel={() => setConfirmCancelOpen(false)}
      />
    </>,
    document.body,
  );
}
