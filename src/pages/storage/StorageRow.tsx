import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useGames } from "../../context/GameContext";
import { useToast } from "../../context/ToastContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { formatSize, type Game } from "../../types/game";

interface Props {
  game: Game;
  /** When true, the row's `sizeRootPath` no longer resolves on disk.
   *  The row renders a stale indicator + a "Re-link" CTA in its
   *  expanded panel. */
  stale?: boolean;
  /** Fired after the row's sizeRootPath/sizeBytes update successfully.
   *  The StoragePage orchestrator uses this to refresh the per-row
   *  staleness check (the new path may or may not exist yet). */
  onSizeUpdated?: () => void;
}

interface SizeDetectionResult {
  sizeBytes: number;
  rootPath: string;
}

/** Phase-5 Storage row.
 *
 *  Collapsed layout: [name | platform | size / Set size pill | last detected | chevron]
 *  Expanded panel:  [absolute path · raw bytes · detected-at · Auto-detect · Clear]
 *
 *  Tauri command convention from earlier work -- args are camelCase on
 *  the JS side (`exePath`, `gameName`, `rootOverride`) and map to the
 *  snake_case Rust parameters via Tauri's default rename behavior. */
export function StorageRow({ game, stale = false, onSizeUpdated }: Props) {
  const { updateGame } = useGames();
  const { showToast } = useToast();
  const { unit } = useSizeUnit();
  const [expanded, setExpanded] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const hasSize = game.sizeBytes != null && game.sizeBytes > 0;
  const isSized = hasSize;

  async function detect(folderOverride?: string) {
    if (detecting) return;
    setDetecting(true);
    try {
      let override = folderOverride;
      if (!override) {
        const picked = await open({
          directory: true,
          multiple: false,
          title: "Select game folder",
        });
        if (!picked) return;
        override = picked;
      }
      const result = await invoke<SizeDetectionResult>("detect_game_size", {
        exePath: game.path,
        gameName: game.name,
        rootOverride: override,
      });
      updateGame(game.id, {
        sizeBytes: result.sizeBytes,
        sizeRootPath: result.rootPath,
        sizeDetectedAt: new Date().toISOString(),
      });
      onSizeUpdated?.();
      showToast(
        `Detected ${formatSize(result.sizeBytes, unit)} for ${game.name}`,
        "success"
      );
    } catch (err) {
      console.error("detect_game_size failed", err);
      showToast(`Could not read folder size: ${err}`, "error");
    } finally {
      setDetecting(false);
    }
  }

  function clearSize() {
    updateGame(game.id, {
      sizeBytes: undefined,
      sizeRootPath: undefined,
      sizeDetectedAt: undefined,
    });
    showToast(`Cleared size for ${game.name}`, "info");
  }

  return (
    <li
      className={`storage__row${expanded ? " storage__row--expanded" : ""}${stale ? " storage__row--stale" : ""}`}
      data-game-id={game.id}
    >
      {/* Collapsed row summary */}
      <div
        role="button"
        tabIndex={0}
        className="storage__row-summary"
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          // Only react when the row summary itself (or a non-button
          // child like the name/chevron span) holds focus. Without
          // this guard, pressing Enter/Space while focus is on the
          // Set-size pill would bubble up here, preventDefault the
          // pill click, and silently toggle expand instead.
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        aria-expanded={expanded}
      >
        <span className="storage__row-name" title={game.name}>
          {game.name}
        </span>
        <span className="storage__row-platform">
          {game.platform || "Unknown"}
        </span>
        {isSized ? (
          <span className="storage__row-size">{formatSize(game.sizeBytes, unit)}</span>
        ) : (
          <button
            type="button"
            className="storage__set-size-pill"
            onClick={(e) => {
              e.stopPropagation();
              detect();
            }}
            title="Pick a folder and calculate size"
          >
            Set size
          </button>
        )}
        <span
          className={`storage__row-detected${stale ? " storage__row-detected--stale" : ""}`}
          title={
            stale
              ? `Last seen ${formatTimestamp(game.sizeDetectedAt, true)}`
              : game.sizeDetectedAt ?? ""
          }
        >
          {stale
            ? `Last seen: ${formatTimestamp(game.sizeDetectedAt)}`
            : formatTimestamp(game.sizeDetectedAt)}
        </span>
        <span
          className={`storage__row-chevron${expanded ? " storage__row-chevron--open" : ""}`}
          aria-hidden="true"
        >
          {"\u25BE"}
        </span>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div className="storage__row-panel">
          <div className="storage__row-path">
            <span className="storage__row-path-label">Path</span>
            <span className="storage__row-path-value" title={game.sizeRootPath ?? ""}>
              {game.sizeRootPath ?? game.path ?? "—"}
            </span>
          </div>
          <div className="storage__row-meta">
            {isSized && (
              <>
                <span>
                  <span className="storage__row-meta-label">Bytes</span>
                  {game.sizeBytes!.toLocaleString()}
                </span>
                <span>
                  <span className="storage__row-meta-label">Detected</span>
                  {formatTimestamp(game.sizeDetectedAt, true) || "—"}
                </span>
              </>
            )}
            {!isSized && (
              <span className="storage__row-meta-empty">
                Unset — pick a folder to measure, or open the game page to set it.
              </span>
            )}
          </div>
          <div className="storage__row-actions">
            <button
              type="button"
              className="storage__btn storage__btn--primary"
              onClick={() => detect()}
              disabled={detecting}
              title={
                stale
                  ? "Pick a new folder to re-link the size measurement"
                  : undefined
              }
            >
              {detecting ? "Detecting..." : stale ? "Re-link" : "Auto-detect"}
            </button>
            {isSized && (
              <button
                type="button"
                className="storage__btn storage__btn--ghost"
                onClick={clearSize}
                disabled={detecting}
              >
                Clear
              </button>
            )}
            <span className="storage__row-spacer" />
          </div>
        </div>
      )}
    </li>
  );
}

/** Short human timestamp for the "Last detected" column. Returns "Not set"
 *  when `iso` is undefined / null. Pass `verbose=true` for a longer
 *  date+time string used inside the expanded panel. */
function formatTimestamp(
  iso: string | undefined | null,
  verbose = false
): string {
  if (!iso) return "Not set";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "Not set";
  const date = new Date(t);
  if (verbose) {
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
