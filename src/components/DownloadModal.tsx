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

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { useDownloads } from "../context/DownloadContext";
import { useSources } from "../context/SourceContext";
import { useGames } from "../context/GameContext";
import { useToast } from "../context/ToastContext";
import { Button } from "./ui";
import type { MatchedDownload } from "../types/source";
import { type OwnershipResult, formatBytesShort } from "../types/download";

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

type Step = "checking" | "results" | "starting" | "error" | "fetching_metadata" | "file_selection";

/**
 * Single source of truth for "which URI does the user actually want to
 * download". The Rust match can carry explicit `uris` (mirrors) and an
 * optional convenience `magnet`. The user's selected mirror index wins
 * when it points at a real URI; otherwise we fall back to the magnet,
 * then to the first URI. Returning `null` is a hard signal that this
 * match has nothing downloadable (shouldn't happen for results the Rust
 * side vetted, but we guard anyway).
 */
function resolveSourceUri(
  match: MatchedDownload | undefined,
  mirrorIdx: number,
): string | null {
  if (!match) return null;
  if (mirrorIdx >= 0 && mirrorIdx < match.uris.length) {
    return match.uris[mirrorIdx];
  }
  return match.magnet ?? match.uris[0] ?? null;
}

/** Classify a resolved URI into the three engine paths we support. */
function classifyUri(uri: string | null): {
  isMagnet: boolean;
  isTorrentFile: boolean;
  isDirect: boolean;
} {
  const isMagnet = !!uri && uri.startsWith("magnet:");
  const isTorrentFile =
    !!uri && (uri.endsWith(".torrent") || uri.includes(".torrent?"));
  const isDirect =
    !!uri &&
    !isMagnet &&
    !isTorrentFile &&
    (uri.startsWith("http://") || uri.startsWith("https://"));
  return { isMagnet, isTorrentFile, isDirect };
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

  const [step, setStep] = useState<Step>("checking");
  const [ownership, setOwnership] = useState<OwnershipResult | null>(null);
  const [matches, setMatches] = useState<MatchedDownload[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
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

  // Reset selected mirror when the selected result changes, and keep it
  // inside the bounds of that result's `uris` so we never hand
  // `resolveSourceUri` an out-of-range index (e.g. when moving from a
  // 4-mirror result to a 1-mirror one). Also restore the user's last
  // picked mirror for that source, and drop the "Choose files" flag
  // whenever the resolved URI is no longer a torrent (e.g. the user
  // switched to a direct-link mirror) so the hidden checkbox can't
  // leave the flag stale across source types.
  useEffect(() => {
    if (selectedIndex == null) {
      setSelectedMirrorIdx(0);
      return;
    }
    const match = matches[selectedIndex];
    if (!match) return;
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
  }, [selectedIndex, matches, chooseFiles]);

  // Single place to update the mirror so the choice is remembered per
  // source for later re-selection.
  const handleMirrorChange = useCallback(
    (idx: number) => {
      setSelectedMirrorIdx(idx);
      const match = selectedIndex != null ? matches[selectedIndex] : undefined;
      if (match) lastMirrorBySourceRef.current[match.sourceId] = idx;
    },
    [selectedIndex, matches],
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
      // Sort by descending match score so the strongest match is
      // first, then auto-select it so the user can hit Start
      // immediately without an extra click.
      const sorted = [...searchResults].sort(
        (a, b) => b.matchScore - a.matchScore,
      );
      setMatches(sorted);
      setSelectedIndex(sorted.length > 0 ? 0 : null);
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
      if (
        !window.confirm(
          "A download is still starting. Closing now will cancel it. Continue?",
        )
      ) {
        return;
      }
      cancelledRef.current = true;
      onClose();
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
    if (selectedIndex == null) {
      setError("Pick a source result to download from.");
      return;
    }
    if (!savePath) {
      setError("Choose where to save the downloaded files.");
      return;
    }
    const match = matches[selectedIndex];
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
    selectedIndex,
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
    gameName
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
  }, [selectedIndex, savePath]);

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
  }, [step, onClose]);

  // Arrow-key navigation through the results list (big-screen / remote
  // friendly). Up/Down move the selection, Enter starts the download.
  // Only active while we're showing the results list and nothing is
  // in flight.
  useEffect(() => {
    if (step !== "results" && step !== "starting") return;
    if (matches.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
      if (e.key === "Enter") {
        if (step === "results" && selectedIndex != null) handleStart();
        return;
      }
      e.preventDefault();
      setSelectedIndex((prev) => {
        const base = prev ?? -1;
        const delta = e.key === "ArrowDown" ? 1 : -1;
        const next = Math.min(matches.length - 1, Math.max(0, base + delta));
        const el = resultsListRef.current?.querySelectorAll(".dl-result-row")[next] as
          | HTMLElement
          | undefined;
        el?.scrollIntoView({ block: "nearest" });
        return next;
      });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [step, matches, selectedIndex, handleStart]);

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
  const ownershipBanner = useMemo(
    () => buildOwnershipBanner(ownership, step),
    [ownership, step],
  );

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

  // Confidence gate. The Rust side already filters out anything below
  // a 0.2 similarity floor, so every result shown is at least a
  // plausible match — but a 0.2–0.8 result can still be a *similar
  // game name* (e.g. searching "Doom" and landing on "Doom Eternal"
  // when the user wanted the 2016 reboot). Surface an explicit
  // warning when the best available result isn't a high-confidence
  // match so the user double-checks before downloading the wrong
  // game.
  const topMatchesWarning = useMemo<React.ReactNode>(() => {
    if (step !== "results" && step !== "starting") return null;
    if (matches.length === 0) return null;
    const best = matches.reduce(
      (acc, m) => (m.matchScore > acc ? m.matchScore : acc),
      0,
    );
    if (best >= 0.8) return null;
    const label =
      best >= 0.4 ? "partial match" : "low-confidence match";
    return (
      <div
        className="dl-confirm-warning"
        role="alert"
        style={{
          display: "flex",
          gap: "var(--space-xs)",
          alignItems: "flex-start",
          background: "rgba(245, 158, 11, 0.08)",
          border: "1px solid rgba(245, 158, 11, 0.35)",
          borderRadius: "var(--radius-md)",
          padding: "var(--space-sm) var(--space-md)",
          marginBottom: "var(--space-sm)",
          color: "#f59e0b",
          fontSize: "var(--font-size-xs)",
          lineHeight: 1.4,
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          width="16"
          height="16"
          style={{ flexShrink: 0, marginTop: 1 }}
          aria-hidden
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span>
          Search returned only a <strong>{label}</strong> for
          &nbsp;“{gameName}”. Verify the title below is the exact game
          you want before downloading — pick a higher-confidence result
          if one appears, or refine via <strong>Settings → Download
          Sources</strong>.
        </span>
      </div>
    );
  }, [step, matches, gameName]);

  // Render the modal into `document.body` via a React Portal so it
  // escapes any stacking context created by ancestor elements
  // (e.g. the Game page's hero cards). Without this, the modal's
  // z-index is confined to the closest stacking context, which
  // can cause it to be painted behind page-level surfaces even
  // though its z-index (9998) is technically very high. This
  // matches the pattern used by ImportModal, ConfirmModal, etc.
  return createPortal(
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
            <p className="modal-subtitle">
              {gameName}
            </p>
          </div>
        </div>

        <div className="modal-body" style={{ padding: "var(--space-md)" }}>
          {ownershipBanner}

          {topMatchesWarning}

          {step === "checking" && (
            <div className="dl-search-loading">
              <div className="spinner-small" />
              <span>Checking ownership and searching sources…</span>
            </div>
          )}

          {step === "error" && (
            <div className="dl-results-empty" style={{ background: "rgba(239, 68, 68, 0.05)", borderColor: "rgba(239, 68, 68, 0.3)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <p>Couldn't load download information</p>
              <p className="dl-results-empty-hint">
                {error ?? "Unknown error"}
              </p>
              <Button variant="primary" size="sm" onClick={() => runSearch()}>
                Retry
              </Button>
            </div>
          )}

          {(step === "results" || step === "starting") && (
            <div ref={resultsListRef}>
              <ResultsSection
                matches={matches}
                selectedIndex={selectedIndex}
                onSelect={setSelectedIndex}
                showWeakMatches={showWeakMatches}
                onToggleWeak={() => setShowWeakMatches((v) => !v)}
                isDownloaded={isDownloaded}
              />
            </div>
          )}

          {(step === "results" || step === "starting") && (
            <SavePathSection
              savePath={savePath}
              onPickPath={handlePickSavePath}
            />
          )}

          {(step === "results" || step === "starting") && selectedIndex != null && (() => {
            const match = matches[selectedIndex];
            const sourceUri = resolveSourceUri(match, selectedMirrorIdx);
            const { isDirect } = classifyUri(sourceUri);

            return (
              <div className="dl-options-section" style={{ marginTop: "var(--space-md)", display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
                {match.uris.length > 1 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "var(--space-xs)" }}>
                    <span style={{ fontSize: "var(--font-size-xs)", fontWeight: "var(--font-weight-semibold)", color: "var(--color-text-secondary)" }}>
                      Select Mirror / Hoster
                    </span>
                    <select
                      value={selectedMirrorIdx}
                      onChange={(e) => handleMirrorChange(parseInt(e.target.value, 10))}
                      style={{
                        padding: "8px 12px",
                        background: "var(--color-bg-tertiary)",
                        border: "1px solid var(--color-border)",
                        borderRadius: "var(--radius-md)",
                        color: "var(--color-text-primary)",
                        fontFamily: "inherit",
                        fontSize: "var(--font-size-sm)",
                        cursor: "pointer",
                        outline: "none"
                      }}
                    >
                      {match.uris.map((uri, idx) => {
                        let hoster = "Mirror " + (idx + 1);
                        try {
                          const parsed = new URL(uri);
                          hoster = parsed.hostname.replace("www.", "");
                        } catch {}
                        return (
                          <option key={idx} value={idx}>
                            {hoster} ({uri.length > 45 ? uri.substring(0, 45) + "..." : uri})
                          </option>
                        );
                      })}
                    </select>
                  </div>
                )}

                <label className="settings-checkbox-label" style={{ userSelect: "none" }}>
                  <input
                    type="checkbox"
                    checked={autoExtract}
                    onChange={(e) => setAutoExtract(e.target.checked)}
                  />
                  <span>Auto extract archives and delete after extraction</span>
                </label>

                {!isDirect && (
                  <label className="settings-checkbox-label" style={{ userSelect: "none" }}>
                    <input
                      type="checkbox"
                      checked={chooseFiles}
                      onChange={(e) => setChooseFiles(e.target.checked)}
                    />
                    <span>Choose files to download</span>
                  </label>
                )}
              </div>
            );
          })()}

          {step === "fetching_metadata" && (
            <div className="dl-search-loading" style={{ flexDirection: "column", gap: "var(--space-md)", padding: "var(--space-xl) 0" }}>
              <div className="spinner-small" style={{ width: 24, height: 24 }} />
              <span>Fetching torrent files list…</span>
              <p style={{ textAlign: "center", color: "var(--color-text-muted)", fontSize: "var(--font-size-xs)", maxWidth: "420px" }}>
                Connecting to peers to retrieve files metadata. This usually takes a few seconds.
              </p>
            </div>
          )}

          {step === "file_selection" && (
            <FileSelectionSection
              files={activeDownloads.find((d) => d.id === tempTorrentId)?.files ?? []}
              selectedFiles={selectedFiles}
              onChange={setSelectedFiles}
            />
          )}

          {error && step === "results" && (
            <div>
              <p
                role="alert"
                style={{
                  color: "#ef4444",
                  fontSize: "var(--font-size-xs)",
                  marginTop: "var(--space-sm)",
                }}
              >
                {error}
              </p>
              {metadataTimedOut && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleStart()}
                  style={{ marginTop: "var(--space-xs)" }}
                >
                  Try again
                </Button>
              )}
            </div>
          )}

          {step === "starting" && (
            <StartingStatus
              matches={matches}
              selectedIndex={selectedIndex}
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
                ? `${activeDownloads.find((d) => d.id === tempTorrentId)?.files.length ?? 0} total files`
                : "\u00A0" /* non-breaking space so the row doesn't collapse */}
          </span>
          <div className="modal-footer-actions">
            <Button
              variant="ghost"
              onClick={() => handleCloseAttempt()}
              disabled={step === "starting"}
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
                  selectedIndex == null
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
                  const selMatch =
                    selectedIndex != null ? matches[selectedIndex] : null;
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
    </div>,
    document.body
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function ResultsSection({
  matches,
  selectedIndex,
  onSelect,
  showWeakMatches,
  onToggleWeak,
  isDownloaded,
}: {
  matches: MatchedDownload[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  showWeakMatches: boolean;
  onToggleWeak: () => void;
  isDownloaded: (title: string) => boolean;
}) {
  if (matches.length === 0) {
    return (
      <div className="dl-results-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <p>No matches found in your sources</p>
        <p className="dl-results-empty-hint">
          Add more sources in <strong>Settings → Download Sources</strong>, or
          verify that one of your enabled sources actually lists this game. The
          expected JSON format is <code>{`{ title, fileSize, uris }`}</code>.
        </p>
      </div>
    );
  }

  // Keep the high-confidence matches (>= 0.4) always visible; collapse
  // the weaker ones behind a toggle so a wall of "Possible" results
  // doesn't bury the good hit. `realIndex` maps back into `matches`.
  const visible = matches
    .map((match, realIndex) => ({ match, realIndex }))
    .filter(({ match }) => showWeakMatches || match.matchScore >= 0.4);
  const weakCount = matches.filter((m) => m.matchScore < 0.4).length;

  return (
    <div>
      <div className="dl-results-list">
        {visible.map(({ match, realIndex }) => {
          const score = match.matchScore;
          const scoreLabel = score >= 0.8 ? "High match" : score >= 0.4 ? "Partial match" : "Possible";
          return (
            <button
              key={`${match.sourceId}-${realIndex}`}
              type="button"
              className={`dl-result-row${selectedIndex === realIndex ? " selected" : ""}`}
              onClick={() => onSelect(realIndex)}
            >
              <div className="dl-result-info">
                <div className="dl-result-title">
                  <span className="dl-result-title-text">{match.title}</span>
                  <span className="dl-result-badges">
                    {match.isNew && (
                      <span className="dl-badge dl-badge-new" title="Newly added source">
                        NEW
                      </span>
                    )}
                    {isDownloaded(match.title) && (
                      <span className="dl-badge dl-badge-downloaded" title="Already downloaded">
                        Downloaded
                      </span>
                    )}
                  </span>
                </div>
                <div className="dl-result-meta">
                  <span className="dl-result-source">{match.sourceName}</span>
                  <span>·</span>
                  <span>{match.fileSize || "Unknown size"}</span>
                  {match.uploadDate && (
                    <>
                      <span>·</span>
                      <span>{match.uploadDate}</span>
                    </>
                  )}
                  <span className={`dl-result-score ${score >= 0.8 ? "high" : ""}`}>
                    {scoreLabel} ({(score * 100).toFixed(0)}%)
                  </span>
                </div>
              </div>
              <div className="dl-result-actions" aria-hidden>
                {selectedIndex === realIndex ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18, opacity: 0.4 }}>
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {weakCount > 0 && (
        <button
          type="button"
          className="dl-toggle-weak"
          onClick={onToggleWeak}
          aria-expanded={showWeakMatches}
        >
          {showWeakMatches
            ? "Hide weaker matches"
            : `Show ${weakCount} weaker match${weakCount !== 1 ? "es" : ""}`}
        </button>
      )}
    </div>
  );
}

function SavePathSection({
  savePath,
  onPickPath,
}: {
  savePath: string | null;
  onPickPath: () => void;
}) {
  return (
    <div className="dl-save-path">
      <svg
        className="dl-save-path-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
      <span className={`dl-save-path-text${savePath ? "" : " placeholder"}`} title={savePath ?? ""}>
        {savePath ?? "No folder selected — pick where the download will be saved"}
      </span>
      <Button variant="secondary" size="sm" onClick={onPickPath}>
        {savePath ? "Change" : "Choose…"}
      </Button>
    </div>
  );
}

/**
 * Status line shown while the engine is accepting the new torrent.
 * Distinguishes between a magnet link (resolves essentially
 * instantly in librqbit) and an `http(s)://.torrent` URL (librqbit
 * has to download the torrent file before it can return, which
 * can take several seconds on a slow source server). After 10s we
 * nudge the user with a slightly more concerned label so they
 * know the engine is still waiting on the network — not on us.
 */
function StartingStatus({
  matches,
  selectedIndex,
  selectedMirrorIdx,
  elapsedSec,
}: {
  matches: MatchedDownload[];
  selectedIndex: number | null;
  selectedMirrorIdx: number;
  elapsedSec: number;
}) {
  const m = selectedIndex != null ? matches[selectedIndex] : null;
  const uri = resolveSourceUri(m ?? undefined, selectedMirrorIdx);
  const isHttpFetch = !!uri && /^https?:/i.test(uri);
  const slow = elapsedSec >= 10;
  const label = isHttpFetch
    ? slow
      ? "Source server is slow — you can cancel and try another source"
      : "Fetching torrent file from source server…"
    : "Starting download…";
  return (
    <p
      role="status"
      aria-live="polite"
      style={{
        fontSize: "var(--font-size-xs)",
        color: "var(--color-text-muted)",
        marginTop: "var(--space-sm)",
        textAlign: "center",
      }}
    >
      {label}
      {elapsedSec > 0 && <> ({elapsedSec}s)</>}
    </p>
  );
}

// ─── File Selection ──────────────────────────────────────────────────────

function FileSelectionSection({
  files,
  selectedFiles,
  onChange,
}: {
  files: { name: string; size: number }[];
  selectedFiles: Set<number>;
  onChange: (indices: Set<number>) => void;
}) {
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    return files
      .map((f, i) => ({ file: f, idx: i }))
      .filter(({ file }) => file.name.toLowerCase().includes(filter.toLowerCase()));
  }, [files, filter]);

  const handleToggle = (idx: number) => {
    const next = new Set(selectedFiles);
    if (next.has(idx)) {
      next.delete(idx);
    } else {
      next.add(idx);
    }
    onChange(next);
  };

  const handleSelectAll = () => {
    onChange(new Set(files.map((_, i) => i)));
  };

  const handleDeselectAll = () => {
    onChange(new Set());
  };

  return (
    <div className="dl-file-selection">
      <div
        className="dl-file-selection-header"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "var(--space-sm)",
          gap: "var(--space-sm)",
        }}
      >
        <input
          type="text"
          placeholder="Filter files..."
          className="search-input"
          style={{
            flex: 1,
            background: "var(--color-bg-tertiary)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
            padding: "var(--space-xs) var(--space-sm)",
            color: "var(--color-text-primary)",
            fontSize: "var(--font-size-sm)",
          }}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div style={{ display: "flex", gap: "var(--space-xs)" }}>
          <Button variant="secondary" size="sm" onClick={handleSelectAll}>
            Select All
          </Button>
          <Button variant="secondary" size="sm" onClick={handleDeselectAll}>
            Clear
          </Button>
        </div>
      </div>

      <div
        className="dl-file-selection-summary"
        style={{
          fontSize: "var(--font-size-xs)",
          color: "var(--color-text-secondary)",
          marginBottom: "var(--space-sm)",
        }}
      >
        {selectedFiles.size} of {files.length} files selected
        {" · "}
        {formatBytesShort(
          files.reduce(
            (sum, f, i) => (selectedFiles.has(i) ? sum + f.size : sum),
            0,
          ),
        )}{" "}
        of {formatBytesShort(files.reduce((sum, f) => sum + f.size, 0))}
      </div>

      <div
        className="dl-file-list scrollable"
        style={{
          maxHeight: "300px",
          overflowY: "auto",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          background: "var(--color-bg-secondary)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {filtered.length === 0 ? (
          <div style={{ padding: "var(--space-md)", textAlign: "center", color: "var(--color-text-muted)" }}>
            No files match filter
          </div>
        ) : (
          filtered.map(({ file, idx }) => {
            const isChecked = selectedFiles.has(idx);
            return (
              <label
                key={idx}
                className="dl-file-select-item"
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "var(--space-xs) var(--space-sm)",
                  borderBottom: "1px solid var(--color-border-subtle, rgba(255,255,255,0.05))",
                  cursor: "pointer",
                  userSelect: "none",
                  gap: "var(--space-sm)",
                }}
              >
                <input type="checkbox" checked={isChecked} onChange={() => handleToggle(idx)} />
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    textOverflow: "ellipsis",
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    fontSize: "var(--font-size-sm)",
                    color: "var(--color-text-primary)",
                  }}
                  title={file.name}
                >
                  {file.name}
                </span>
                <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-size-xs)", flexShrink: 0 }}>
                  {formatBytesShort(file.size)}
                </span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Ownership banner ────────────────────────────────────────────────────

/**
 * Build the ownership banner. The check can land in three states:
 *   1. Still in flight → muted "checking…" pill
 *   2. Game is owned on one or more stores → amber warning
 *   3. Game is not owned anywhere → no banner (return null)
 */
function buildOwnershipBanner(
  ownership: OwnershipResult | null,
  step: Step,
): React.ReactNode {
  if (step === "checking" || !ownership) {
    return (
      <div className="dl-ownership checking">
        <svg className="dl-ownership-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <div className="dl-ownership-body">
          <div className="dl-ownership-title">Checking ownership…</div>
          <div className="dl-ownership-text">
            Looking up {ownership ? "…" : ""} on Steam, Epic, and your local library.
          </div>
        </div>
      </div>
    );
  }
  if (!ownership.isOwnedAnywhere) return null;

  // Find the first "owned" store to surface in the headline. (We
  // could list all of them, but a single headline is more
  // attention-grabbing and the rest go in the body.)
  const ownedStores = ownership.ownedStores.filter((s) => s.owned);
  const primary = ownedStores[0];
  const others = ownedStores.slice(1);
  const othersText =
    others.length > 0
      ? ` Also owned on ${others.map((o) => o.store).join(", ")}.`
      : "";
  const detailsText = primary.details ? ` (${primary.details})` : "";

  return (
    <div className="dl-ownership owned">
      <svg className="dl-ownership-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <div className="dl-ownership-body">
        <div className="dl-ownership-title">
          You own this on {primary.store}{detailsText}
        </div>
        <div className="dl-ownership-text">
          Consider launching the game from your library rather than downloading
          it. Your purchase supports the developers.{othersText}
        </div>
      </div>
    </div>
  );
}


