import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useGames } from "../../context/GameContext";
import { useToast } from "../../context/ToastContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { formatSize, type Game } from "../../types/game";
import { Button } from "../../components/ui";

interface Props {
  game: Game;
  /** When true, the row's `sizeRootPath` no longer resolves on disk.
   *  The row renders a stale indicator + a "Re-link" CTA in its
   *  expanded panel. */
  stale?: boolean;
  /** View density from the shared DensityContext. */
  density?: string;
  /** Fired after the row's sizeRootPath/sizeBytes update successfully.
   *  The StoragePage orchestrator uses this to refresh the per-row
   *  staleness check (the new path may or may not exist yet). */
  onSizeUpdated?: () => void;
  /** Reveal the game's measured folder in the OS file manager. The
   *  StoragePage owns the `invoke("open_folder", ...)` call (and toast
   *  surfacing) so a single failure path is shared across every row. */
  onOpenFolder?: () => void;
  /** Selection mode: renders a checkbox in the row summary and switches
   *  the expanded action set to include management actions. */
  selectMode?: boolean;
  /** Whether this row is currently selected (only meaningful in selectMode). */
  selected?: boolean;
  /** Toggle this row's selection. */
  onToggleSelect?: () => void;
  /** Open the move/relocate dialog for this single game. */
  onMove?: () => void;
  /** Open the uninstall confirmation for this single game. */
  onUninstall?: () => void;
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
export function StorageRow({ game, stale = false, density = "cozy", onSizeUpdated, onOpenFolder, selectMode = false, selected = false, onToggleSelect, onMove, onUninstall }: Props) {
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
      className={`storage__row density-${density}${expanded ? " storage__row--expanded" : ""}${stale ? " storage__row--stale" : ""}${selected ? " storage__row--selected" : ""}`}
      data-game-id={game.id}
    >
      {/* Collapsed row summary */}
      <div
        role="button"
        tabIndex={0}
        className={`storage__row-summary${selectMode ? " storage__row-summary--select" : ""}`}
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
        {/* Selection checkbox (only in select mode) */}
        {selectMode && (
          <label
            className="storage__row-select"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect?.()}
              aria-label={`Select ${game.name}`}
            />
          </label>
        )}
        {/* Game cover thumbnail */}
        <div className="storage__row-thumb">
          {game.coverArtUrl || game.iconUrl ? (
            <img src={game.coverArtUrl || game.iconUrl} alt="" loading="lazy" />
          ) : (
            <span className="storage__row-thumb-placeholder">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </span>
          )}
        </div>
        <span className="storage__row-name" title={game.name}>
          {game.name}
          {stale && (
            <span className="storage__stale-badge">Stale</span>
          )}
        </span>
        <span className="storage__row-platform">
          {game.platform || "Unknown"}
        </span>
        {isSized ? (
          <span className="storage__row-size">{formatSize(game.sizeBytes, unit)}</span>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              detect();
            }}
            title="Pick a folder and calculate size"
            style={{ padding: "2px 8px", fontSize: "11px", height: "auto" }}
          >
            Set size
          </Button>
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
        <div
          className="storage__row-panel"
          role="region"
          aria-label={`${game.name} storage details`}
        >
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
            <Button
              variant="primary"
              onClick={() => detect()}
              isLoading={detecting}
              title={
                stale
                  ? "Pick a new folder to re-link the size measurement"
                  : undefined
              }
            >
              {stale ? "Re-link" : "Auto-detect"}
            </Button>
            {isSized && (
              <Button
                variant="ghost"
                onClick={clearSize}
                disabled={detecting}
              >
                Clear
              </Button>
            )}
            {isSized && (
              <Button
                variant="ghost"
                onClick={() => onOpenFolder?.()}
                disabled={detecting}
                title="Open this game's folder in your file manager"
              >
                Open folder
              </Button>
            )}
            {onMove && game.sizeRootPath && (
              <Button
                variant="ghost"
                onClick={() => onMove()}
                disabled={detecting}
                title="Move this install to another drive"
              >
                Move
              </Button>
            )}
            {onUninstall && (game.sizeRootPath || game.path) && (
              <Button
                variant="danger"
                onClick={() => onUninstall()}
                disabled={detecting}
                title="Uninstall and delete this game's folder"
              >
                Uninstall
              </Button>
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
