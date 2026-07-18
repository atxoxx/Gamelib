import { useCallback, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useGames } from "../context/GameContext";
import { useDensityContext } from "../context/DensityContext";
import { useToast } from "../context/ToastContext";
import DensityToggle from "../components/DensityToggle";
import { DEFAULT_SORT, sortGames, type SortKey } from "./storage/utils";
import { Button } from "../components/ui";
import { BulkRecalcBar } from "./storage/BulkRecalcBar";
import { StorageHeader } from "./storage/StorageHeader";
import { StorageSortSelect } from "./storage/StorageSortSelect";
import { StorageRow } from "./storage/StorageRow";
import { useStalePaths } from "./storage/useStalePaths";
import "./StoragePage.css";

/** Active list filter for the Storage tab. */
export type StorageFilter = "all" | "sized" | "missing" | "stale";

/** Refactored Storage page — density-aware, searchable, themed.
 *
 *  Orchestration:
 *    1. `useGames()` gives us the live library; the rows react to
 *       size mutations the same way any other consumer would.
 *    2. `sort` lives in local state — never persisted, so visits later
 *       always start at Largest first per the spec.
 *    3. Search filtering is done client-side against game names.
 *    4. Density is shared with Store/Library via `DensityProvider`. */
import { useBigScreen } from "../context/BigScreenContext";
import BigScreenSystem from "../components/bigscreen/BigScreenSystem";

export default function StoragePage() {
  const { isBigScreen } = useBigScreen();
  if (isBigScreen) {
    return <BigScreenSystem />;
  }
  const { games } = useGames();
  const { density, setDensity } = useDensityContext();
  const { showToast } = useToast();
  const [sort, setSort] = useState<SortKey>(DEFAULT_SORT);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StorageFilter>("all");

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

  // Status filter (All / Sized / Missing / Stale) applied before search,
  // so the search box narrows within the chosen cohort.
  const statusFilteredGames = useMemo(() => {
    switch (filter) {
      case "sized":
        return installedGames.filter(
          (g) => g.sizeBytes != null && g.sizeBytes > 0
        );
      case "missing":
        return installedGames.filter(
          (g) => g.sizeBytes == null || g.sizeBytes <= 0
        );
      case "stale":
        return installedGames.filter((g) => staleMap.get(g.id) === true);
      case "all":
      default:
        return installedGames;
    }
  }, [installedGames, filter, staleMap]);

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
    // refreshAll bumps an internal counter; the check resolves fast, so
    // we just clear the spinner after a tick to avoid a stuck state.
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

  return (
    <div className="storage-page">
      {/* ── Page header ──────────────────────────────────────── */}
      <header className="storage__page-header">
        <div className="storage__page-header-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M20.4 14.7 16.1 19l-1.8-1.8" />
            <line x1="12" y1="6" x2="18" y2="6" />
            <line x1="12" y1="10" x2="15" y2="10" />
          </svg>
        </div>
        <div className="storage__page-header-text">
          <h1 className="storage__page-title">Storage</h1>
          <p className="storage__page-subtitle">
            Disk usage across every installed game, broken down by platform and drive.
          </p>
        </div>
      </header>

      {/* ── Dashboard cards ──────────────────────────────────── */}
      <StorageHeader games={installedGames} staleCount={staleCount} />

      {/* ── Status filter chips ──────────────────────────────── */}
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
            {(showingFiltered || filter !== "all") &&
              installedGames.length !== sortedGames.length &&
              ` of ${installedGames.length}`}
            {!showingFiltered && filter === "all" && unsizedCount > 0 &&
              ` ${"·"} ${unsizedCount} missing`}
          </span>
        </div>
      </div>

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
                    : installedGames.length === 0
                      ? "No installed games detected"
                      : "No sized games yet"}
          </p>
          <p className="storage__empty-state-subtitle">
            {showingFiltered
              ? "Try a different search term or clear the search to see all installed games."
              : installedGames.length === 0
                ? "Import games from Steam, Epic, or manually to start tracking disk usage."
                : "Use Auto-detect or Set size on each game to measure its folder."}
          </p>
          {showingFiltered && (
            <Button
              variant="ghost"
              onClick={() => setSearch("")}
            >
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
              onSizeUpdated={() => handleRowSizeUpdated(g.id)}
              onOpenFolder={() => handleOpenFolder(g)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
