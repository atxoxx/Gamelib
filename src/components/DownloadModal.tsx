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
import type { OwnershipResult } from "../types/download";

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

type Step = "checking" | "results" | "starting" | "error";

export default function DownloadModal({
  gameName,
  gameId,
  steamAppId,
  onClose,
}: DownloadModalProps) {
  const { addDownload, selectSavePath } = useDownloads();
  const { searchSources } = useSources();
  const { games } = useGames();
  const { showToast } = useToast();

  const [step, setStep] = useState<Step>("checking");
  const [ownership, setOwnership] = useState<OwnershipResult | null>(null);
  const [matches, setMatches] = useState<MatchedDownload[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [savePath, setSavePath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Suppress the "user has not picked a save path" inline error
  // until they've tried to start at least once.
  const startAttemptedRef = useRef(false);

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
    setStep("starting");
    try {
      const match = matches[selectedIndex];
      // Prefer the resolved magnet URI (the source provided it OR
      // we found a magnet: link in the uris array). Fall back to
      // the first URI which may be a .torrent URL.
      const sourceUri = match.magnet || match.uris[0];
      if (!sourceUri) {
        throw new Error("Selected source has no downloadable URI");
      }
      await addDownload(sourceUri, savePath, gameId ?? null, match.sourceName);
      showToast(
        `Downloading "${match.title}" from ${match.sourceName}`,
        "success",
      );
      onClose();
    } catch (err) {
      console.error("[DownloadModal] torrent_add failed:", err);
      setError(String(err));
      setStep("results");
    }
  }, [selectedIndex, savePath, matches, addDownload, gameId, showToast, onClose]);

  // Reset the inline error when the user changes their selection
  useEffect(() => {
    if (step === "results" && startAttemptedRef.current) {
      setError(null);
    }
  }, [selectedIndex, savePath, step]);

  // ── Render ──────────────────────────────────────────────────────
  const ownershipBanner = useMemo(
    () => buildOwnershipBanner(ownership, step),
    [ownership, step],
  );

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
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
        </div>

        <div className="modal-footer">
          <span className="modal-footer-count">
            {step === "results" && matches.length > 0
              ? `${matches.length} source result${matches.length !== 1 ? "s" : ""}`
              : "\u00A0" /* non-breaking space so the row doesn't collapse */}
          </span>
          <div className="modal-footer-actions">
            <Button
              variant="ghost"
              onClick={onClose}
              disabled={step === "starting"}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleStart}
              disabled={
                step === "starting" ||
                step === "checking" ||
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
              Start Download
            </Button>
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


