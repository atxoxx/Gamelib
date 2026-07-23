import { useCallback, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useGames } from "../context/GameContext";
import { useDensityContext } from "../context/DensityContext";
import { useToast } from "../context/ToastContext";
import { Button, ConfirmModal, PageHeader } from "../components/ui";
import DensityToggle from "../components/DensityToggle";
import { DEFAULT_SORT, driveOf, sortGames, type SortKey } from "./storage/utils";
import { BulkRecalcBar } from "./storage/BulkRecalcBar";
import { StorageHeader } from "./storage/StorageHeader";
import { StorageSortSelect } from "./storage/StorageSortSelect";
import { StorageRow } from "./storage/StorageRow";
import { MoveGameDialog } from "./storage/MoveGameDialog";
import { useStalePaths } from "./storage/useStalePaths";
import type { Game } from "../types/game";
import "./StoragePage.css";
import "../styles/page-storage.css";

/** Active list filter for the Storage tab. */
export type StorageFilter = "all" | "sized" | "missing" | "stale";

/** Refactored Storage page — density-aware, searchable, themed, and now a
 *  real game *manager*: multi-select rows, batch move between drives, and
 *  uninstall with confirmation.
 *
 *  Orchestration:
 *    1. `useGames()` gives us the live library; the rows react to size
 *       mutations the same way any other consumer would.
 *    2. `sort` lives in local state — never persisted, so visits always
 *       start at Largest first per the spec.
 *    3. Search filtering is done client-side against game names.
 *    4. Density is shared with Store/Library via `DensityProvider`. */
import { useBigScreen } from "../context/BigScreenContext";
import BigScreenSystem from "../components/bigscreen/BigScreenSystem";

export default function StoragePage() {
  const { isBigScreen } = useBigScreen();
  if (isBigScreen) {
    return <BigScreenSystem />;
  }
  const { games, updateGame, removeGame } = useGames();
  const { density, setDensity } = useDensityContext();
  const { showToast } = useToast();
  const [sort, setSort] = useState<SortKey>(DEFAULT_SORT);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StorageFilter>("all");
  const [driveFilter, setDriveFilter] = useState<string | null>(null);

  // Selection / batch-management state.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveGames, setMoveGames] = useState<Game[] | null>(null);
  const [uninstallGames, setUninstallGames] = useState<Game[] | null>(null);
  const [uninstalling, setUninstalling] = useState(false);

  // Storage is only meaningful for games actually installed on disk.
  const installedGames = useMemo(
    () => games.filter((g) => g.installed),
    [games]
  );

  const { staleMap, refresh, refreshAll } = useStalePaths(installedGames);
  const staleCount = useMemo(
    () =>
      Array.from(staleMap.values()).reduce((n, stale) => (stale ? n + 1 : n), 0),
    [staleMap]
  );

  // Drive filter narrows the cohort to a single volume bucket.
  const driveFilteredGames = useMemo(() => {
    if (!driveFilter) return installedGames;
    return installedGames.filter(
      (g) => g.sizeRootPath && driveOf(g.sizeRootPath) === driveFilter
    );
  }, [installedGames, driveFilter]);

  // Status filter (All / Sized / Missing / Stale) applied before search.
  const statusFilteredGames = useMemo(() => {
    switch (filter) {
      case "sized":
        return driveFilteredGames.filter(
          (g) => g.sizeBytes != null && g.sizeBytes > 0
        );
      case "missing":
        return driveFilteredGames.filter(
          (g) => g.sizeBytes == null || g.sizeBytes <= 0
        );
      case "stale":
        return driveFilteredGames.filter((g) => staleMap.get(g.id) === true);
      case "all":
      default:
        return driveFilteredGames;
    }
  }, [driveFilteredGames, filter, staleMap]);

  // Client-side name search filter.
  const filteredGames = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return statusFilteredGames;
    return statusFilteredGames.filter((g) =>
      g.name.toLowerCase().includes(q)
    );
  }, [statusFilteredGames, search]);

  const sortedGames = useMemo(
    () => sortGames(filteredGames, sort),
    [filteredGames, sort]
  );

  const unsizedCount = useMemo(
    () =>
      installedGames.filter((g) => g.sizeBytes == null || g.sizeBytes <= 0)
        .length,
    [installedGames]
  );

  const missingGames = useMemo(
    () =>
      installedGames.filter((g) => g.sizeBytes == null || g.sizeBytes <= 0),
    [installedGames]
  );

  const handleRowSizeUpdated = useCallback(
    (gameId: string) => {
      void refresh(gameId);
    },
    [refresh]
  );

  const showingFiltered = search.trim().length > 0;

  // Re-check every measured path's existence on disk (e.g. after a
  // drive was re-plugged). Exposed to the user via the toolbar refresh
  // button so the stale count updates on demand, not only on mount.
  const [refreshingPaths, setRefreshingPaths] = useState(false);
  const handleRefreshPaths = useCallback(() => {
    setRefreshingPaths(true);
    refreshAll();
    setTimeout(() => setRefreshingPaths(false), 600);
  }, [refreshAll]);

  const handleOpenFolder = useCallback(
    async (game: { sizeRootPath?: string; path?: string; name: string }) => {
      const target = game.sizeRootPath || game.path;
      if (!target) {
        showToast(`No folder known for ${game.name}`, "info");
        return;
      }
      try {
        await invoke("open_folder", { path: target });
      } catch (err) {
        showToast(`Could not open folder: ${err}`, "error");
      }
    },
    [showToast]
  );

  // ── Selection helpers ────────────────────────────────────────────────
  const selectedGames = useMemo(
    () => installedGames.filter((g) => selected.has(g.id)),
    [installedGames, selected]
  );

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(sortedGames.map((g) => g.id)));
  }, [sortedGames]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);

  // ── Move (single + batch) ─────────────────────────────────────────────
  const openMove = useCallback(
    (targets: Game[]) => {
      const movable = targets.filter((g) => g.sizeRootPath || g.path);
      if (movable.length === 0) {
        showToast("Select games with a known install folder to move.", "info");
        return;
      }
      setMoveGames(movable);
    },
    [showToast]
  );

  const handleMoved = useCallback(
    (game: Game, toPath: string, newExe: string) => {
      updateGame(game.id, {
        path: newExe,
        sizeRootPath: toPath,
        sizeDetectedAt: new Date().toISOString(),
      });
      void refresh(game.id);
    },
    [updateGame, refresh]
  );

  // ── Re-measure selected ───────────────────────────────────────────────
  const remeasureSelected = useCallback(async () => {
    const list = selectedGames.filter(
      (g) => g.path && g.path.trim() !== ""
    );
    if (list.length === 0) return;
    let done = 0;
    for (const g of list) {
      try {
        const result = await invoke<{ sizeBytes: number; rootPath: string }>(
          "detect_game_size",
          { exePath: g.path, gameName: g.name, rootOverride: null }
        );
        updateGame(g.id, {
          sizeBytes: result.sizeBytes,
          sizeRootPath: result.rootPath,
          sizeDetectedAt: new Date().toISOString(),
        });
        done += 1;
      } catch (err) {
        console.error("re-measure failed for", g.name, err);
      }
    }
    showToast(`Re-measured ${done} game${done === 1 ? "" : "s"}.`, "success");
    refreshAll();
  }, [selectedGames, updateGame, showToast, refreshAll]);

  // ── Uninstall (single + batch) ───────────────────────────────────────
  const openUninstall = useCallback(
    (targets: Game[]) => {
      const removable = targets.filter((g) => g.sizeRootPath || g.path);
      if (removable.length === 0) {
        showToast("Select games with a known install folder to uninstall.", "info");
        return;
      }
      setUninstallGames(removable);
    },
    [showToast]
  );

  const confirmUninstall = useCallback(async () => {
    if (!uninstallGames) return;
    setUninstalling(true);
    let removed = 0;
    for (const g of uninstallGames) {
      const root = g.sizeRootPath || g.path;
      if (!root) {
        removeGame(g.id);
        removed += 1;
        continue;
      }
      try {
        await invoke("uninstall_game", { rootPath: root });
        removeGame(g.id);
        removed += 1;
      } catch (err) {
        showToast(`Uninstall failed for ${g.name}: ${err}`, "error");
      }
    }
    setUninstalling(false);
    setUninstallGames(null);
    setSelected(new Set());
    setSelectMode(false);
    refreshAll();
    showToast(
      `Uninstalled ${removed} game${removed === 1 ? "" : "s"}.`,
      "success"
    );
  }, [uninstallGames, removeGame, showToast, refreshAll]);

  return (
    <div className="storage-page page">
      {/* ── Page header ──────────────────────────────────────── */}
      <PageHeader
        eyebrow="Disk & Library"
        title="Storage"
        description="Disk usage across every installed game — move installs between drives, uninstall, and analyze by platform and volume."
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M20.4 14.7 16.1 19l-1.8-1.8" />
            <line x1="12" y1="6" x2="18" y2="6" />
            <line x1="12" y1="10" x2="15" y2="10" />
          </svg>
        }
      />

      {/* ── Dashboard cards ──────────────────────────────────── */}
      <StorageHeader
        games={installedGames}
        staleCount={staleCount}
        activeDrive={driveFilter}
        onDriveClick={(label) => setDriveFilter((cur) => (cur === label ? null : label))}
      />

      {/* ── Status + drive filter chips ──────────────────────── */}
      <div className="storage__filters" role="group" aria-label="Filter games by storage status">
        {(
          [
            { key: "all", label: "All", count: installedGames.length },
            {
              key: "sized",
              label: "Sized",
              count: installedGames.filter(
                (g) => g.sizeBytes != null && g.sizeBytes > 0
              ).length,
            },
            {
              key: "missing",
              label: "Missing",
              count: unsizedCount,
            },
            { key: "stale", label: "Stale", count: staleCount },
          ] as { key: StorageFilter; label: string; count: number }[]
        ).map(({ key, label, count }) => (
          <button
            key={key}
            type="button"
            className={`storage__filter-chip${
              filter === key ? " storage__filter-chip--active" : ""
            }`}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {label}
            <span className="storage__filter-chip-count">{count}</span>
          </button>
        ))}
        {driveFilter && (
          <button
            type="button"
            className="storage__filter-chip storage__filter-chip--active storage__filter-chip--drive"
            onClick={() => setDriveFilter(null)}
            aria-label={`Clear drive filter ${driveFilter}`}
          >
            Drive: {driveFilter}
            <span className="storage__filter-chip-clear" aria-hidden>
              {"×"}
            </span>
          </button>
        )}
      </div>

      {/* ── Toolbar ──────────────────────────────────────────── */}
      <div className="storage__toolbar">
        <div className="storage__toolbar-left">
          {/* Search */}
          <div className="storage__search">
            <svg className="storage__search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              className="storage__search-input"
              type="text"
              placeholder="Search games…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search installed games"
            />
            {search && (
              <button
                type="button"
                className="storage__search-clear"
                onClick={() => setSearch("")}
                aria-label="Clear search"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>

          <StorageSortSelect value={sort} onChange={setSort} />

          {/* Density toggle */}
          <div className="storage__density-group">
            <span className="storage__density-label">Density</span>
            <DensityToggle density={density} onChange={setDensity} />
          </div>

          {/* Selection mode toggle */}
          <Button
            variant={selectMode ? "secondary" : "ghost"}
            size="sm"
            active={selectMode}
            onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            title="Select multiple games for batch move / uninstall"
          >
            Select
          </Button>
        </div>

        <div className="storage__toolbar-right">
          <BulkRecalcBar unsizedGames={missingGames} onComplete={refreshAll} />
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefreshPaths}
            isLoading={refreshingPaths}
            title="Re-check every measured folder against the disk"
          >
            Refresh
          </Button>
          <span className="storage__toolbar-count">
            {sortedGames.length} game{sortedGames.length === 1 ? "" : "s"}
            {(showingFiltered || filter !== "all" || driveFilter) &&
              installedGames.length !== sortedGames.length &&
              ` of ${installedGames.length}`}
            {!showingFiltered && filter === "all" && !driveFilter && unsizedCount > 0 &&
              ` ${"·"} ${unsizedCount} missing`}
          </span>
        </div>
      </div>

      {/* ── Selection / batch toolbar ──────────────────────────── */}
      {selectMode && (
        <div className="storage__batch-bar" role="toolbar" aria-label="Batch actions">
          <span className="storage__batch-count">
            {selected.size} selected
          </span>
          <div className="storage__batch-actions">
            <Button
              variant="primary"
              size="sm"
              onClick={() => openMove(selectedGames)}
              disabled={selected.size === 0}
            >
              Move…
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => openUninstall(selectedGames)}
              disabled={selected.size === 0}
            >
              Uninstall
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={remeasureSelected}
              disabled={selected.size === 0}
            >
              Re-measure
            </Button>
            <Button variant="ghost" size="sm" onClick={selectAll}>
              Select all
            </Button>
            <Button variant="ghost" size="sm" onClick={clearSelection}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* ── Game list ────────────────────────────────────────── */}
      {sortedGames.length === 0 ? (
        <div className="storage__empty-state">
          <div className="storage__empty-state-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M20.4 14.7 16.1 19l-1.8-1.8" />
              <line x1="12" y1="6" x2="18" y2="6" />
              <line x1="12" y1="10" x2="15" y2="10" />
            </svg>
          </div>
          <p className="storage__empty-state-title">
            {showingFiltered
              ? "No games match your search"
              : filter === "stale"
                ? "No stale games"
                : filter === "missing"
                  ? "No missing sizes"
                  : filter === "sized"
                    ? "No sized games"
                    : driveFilter
                      ? `No games measured on ${driveFilter}`
                      : installedGames.length === 0
                        ? "No installed games detected"
                        : "No sized games yet"}
          </p>
          <p className="storage__empty-state-subtitle">
            {showingFiltered
              ? "Try a different search term or clear the search to see all installed games."
              : installedGames.length === 0
                ? "Import games from Steam, Epic, or manually to start tracking disk usage."
                : driveFilter
                  ? "Switch to another drive bucket, or clear the filter to see every install."
                  : "Use Auto-detect or Set size on each game to measure its folder."}
          </p>
          {showingFiltered && (
            <Button variant="ghost" onClick={() => setSearch("")}>
              Clear search
            </Button>
          )}
        </div>
      ) : (
        <ul className={`storage__list density-${density}`}>
          {sortedGames.map((g) => (
            <StorageRow
              key={g.id}
              game={g}
              stale={staleMap.get(g.id) === true}
              density={density}
              selectMode={selectMode}
              selected={selected.has(g.id)}
              onToggleSelect={() => toggleSelect(g.id)}
              onSizeUpdated={() => handleRowSizeUpdated(g.id)}
              onOpenFolder={() => handleOpenFolder(g)}
              onMove={() => openMove([g])}
              onUninstall={() => openUninstall([g])}
            />
          ))}
        </ul>
      )}

      {/* ── Move dialog ───────────────────────────────────────── */}
      {moveGames && (
        <MoveGameDialog
          games={moveGames}
          onMoved={handleMoved}
          onClose={() => {
            setMoveGames(null);
            refreshAll();
          }}
        />
      )}

      {/* ── Uninstall confirmation ────────────────────────────── */}
      <ConfirmModal
        open={uninstallGames !== null}
        title={
          uninstallGames && uninstallGames.length === 1
            ? `Uninstall ${uninstallGames[0].name}?`
            : `Uninstall ${uninstallGames?.length ?? 0} games?`
        }
        message={
          uninstallGames && uninstallGames.length === 1
            ? "This permanently deletes the game's install folder from disk and removes it from your library."
            : "This permanently deletes each game's install folder from disk and removes them from your library."
        }
        warning="This action cannot be undone."
        confirmLabel="Uninstall"
        cancelLabel="Cancel"
        busy={uninstalling}
        onConfirm={confirmUninstall}
        onCancel={() => !uninstalling && setUninstallGames(null)}
      />
    </div>
  );
}
