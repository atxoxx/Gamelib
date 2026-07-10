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

export default function DownloadModal({
  gameName,
  gameId,
  steamAppId,
  onClose,
}: DownloadModalProps) {
  const { addDownload, selectSavePath, activeDownloads, startSelectedDownload, removeDownload } = useDownloads();
  const { searchSources } = useSources();
  const { games } = useGames();
  const { showToast } = useToast();

  const [step, setStep] = useState<Step>("checking");
  const [ownership, setOwnership] = useState<OwnershipResult | null>(null);
  const [matches, setMatches] = useState<MatchedDownload[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [savePath, setSavePath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [chooseFiles, setChooseFiles] = useState(false);
  const [autoExtract, setAutoExtract] = useState(false);
  const [tempTorrentId, setTempTorrentId] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<number>>(new Set());

  // Wait for metadata loaded to show file checklist
  useEffect(() => {
    if (step === "fetching_metadata" && tempTorrentId) {
      const dl = activeDownloads.find((d) => d.id === tempTorrentId);
      if (dl && dl.files && dl.files.length > 0) {
        setSelectedFiles(new Set(dl.files.map((_, i) => i)));
        setStep("file_selection");
      }
    }
  }, [activeDownloads, step, tempTorrentId]);
  // Suppress the "user has not picked a save path" inline error
  // until they've tried to start at least once.
  const startAttemptedRef = useRef(false);
  const cancelledRef = useRef(false);
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
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // `check_ownership_for_ids` is the variant that takes an
        // explicit Steam AppID; falls back to `check_ownership`
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

        if (cancelled) return;
        setOwnership(own);
        setMatches(searchResults);
        // A fresh search result invalidates any prior selection
        // (the user is now looking at a different list) and any
        // prior error (the previous Start attempt was for stale
        // data). Clear both so the modal returns to a clean state.
        setSelectedIndex(null);
        setError(null);
        setStep("results");
      } catch (err) {
        if (cancelled) return;
        console.error("[DownloadModal] initial checks failed:", err);
        setError(String(err));
        setStep("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gameName, steamAppId, searchSources, localLibraryNames]);

  // ── Helpers ──────────────────────────────────────────────────────
  const handlePickSavePath = useCallback(async () => {
    try {
      const path = await selectSavePath();
      if (path) setSavePath(path);
    } catch (err) {
      showToast(`Couldn't open folder picker: ${err}`, "error");
    }
  }, [selectSavePath, showToast]);

  const handleStart = useCallback(async () => {
    cancelledRef.current = false;
    startAttemptedRef.current = true;
    if (selectedIndex == null) {
      setError("Pick a source result to download from.");
      return;
    }
    if (!savePath) {
      setError("Choose where to save the downloaded files.");
      return;
    }
    setError(null);
    try {
      const match = matches[selectedIndex];
      // Prefer the resolved magnet URI (the source provided it OR
      // we found a magnet: link in the uris array). Fall back to
      // the first URI which may be a .torrent URL.
      const sourceUri = match.magnet || match.uris[0];
      if (!sourceUri) {
        throw new Error("Selected source has no downloadable URI");
      }

      const safeGameFolder = gameName.replace(/[:*?"<>|\\/]/g, "").trim();
      const normalizedSave = savePath.replace(/\\/g, "/");
      const finalSavePath = normalizedSave.endsWith(safeGameFolder)
        ? savePath
        : `${savePath}/${safeGameFolder}`.replace(/\\/g, "/");

      if (chooseFiles) {
        setStep("fetching_metadata");
        // Start the torrent with listOnly = true
        const newDl = await addDownload(sourceUri, finalSavePath, gameId ?? null, match.sourceName, autoExtract, true);
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
      console.error("[DownloadModal] torrent_add failed:", err);
      setError(String(err));
      setStep("results");
    }
  }, [selectedIndex, savePath, matches, addDownload, gameId, showToast, onClose, chooseFiles, autoExtract, gameName]);

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
          onClose();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [step, onClose]);

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

  return (
    <div
      className="modal-backdrop"
      onMouseDown={() => {
        if (step !== "starting") {
          cancelledRef.current = true;
          onClose();
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
            </div>
          )}

          {(step === "results" || step === "starting") && (
            <ResultsSection
              matches={matches}
              selectedIndex={selectedIndex}
              onSelect={setSelectedIndex}
            />
          )}

          {(step === "results" || step === "starting") && (
            <SavePathSection
              savePath={savePath}
              onPickPath={handlePickSavePath}
            />
          )}

          {(step === "results" || step === "starting") && selectedIndex != null && (
            <div className="dl-options-section" style={{ marginTop: "var(--space-md)", display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
              <label className="settings-checkbox-label" style={{ userSelect: "none" }}>
                <input
                  type="checkbox"
                  checked={autoExtract}
                  onChange={(e) => setAutoExtract(e.target.checked)}
                />
                <span>Auto extract archives and delete after extraction</span>
              </label>
              <label className="settings-checkbox-label" style={{ userSelect: "none" }}>
                <input
                  type="checkbox"
                  checked={chooseFiles}
                  onChange={(e) => setChooseFiles(e.target.checked)}
                />
                <span>Choose files to download</span>
              </label>
            </div>
          )}

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
          )}

          {step === "starting" && (
            <StartingStatus
              matches={matches}
              selectedIndex={selectedIndex}
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
              onClick={async () => {
                if (step === "fetching_metadata" || step === "file_selection") {
                  cancelledRef.current = true;
                  if (tempTorrentId) {
                    try {
                      await removeDownload(tempTorrentId, true);
                    } catch (e) {
                      console.error("Failed to remove list-only torrent:", e);
                    }
                  }
                  setTempTorrentId(null);
                  setStep("results");
                } else {
                  onClose();
                }
              }}
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
                {chooseFiles ? "Fetch Files List" : "Start Download"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function ResultsSection({
  matches,
  selectedIndex,
  onSelect,
}: {
  matches: MatchedDownload[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
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

  return (
    <div className="dl-results-list">
      {matches.map((match, i) => {
        const score = match.matchScore;
        const scoreLabel = score >= 0.8 ? "High match" : score >= 0.5 ? "Good match" : "Possible";
        return (
          <button
            key={`${match.sourceId}-${i}`}
            type="button"
            className={`dl-result-row${selectedIndex === i ? " selected" : ""}`}
            onClick={() => onSelect(i)}
          >
            <div className="dl-result-info">
              <div className="dl-result-title">{match.title}</div>
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
              {selectedIndex === i ? (
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
  elapsedSec,
}: {
  matches: MatchedDownload[];
  selectedIndex: number | null;
  elapsedSec: number;
}) {
  const m = selectedIndex != null ? matches[selectedIndex] : null;
  const uri = m ? m.magnet || m.uris[0] : null;
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
        color: "var(--text-muted, #888)",
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


