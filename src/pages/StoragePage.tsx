import { useCallback, useMemo, useState } from "react";
import { useGames } from "../context/GameContext";
import { useDensityContext } from "../context/DensityContext";
import DensityToggle from "../components/DensityToggle";
import { DEFAULT_SORT, sortGames, type SortKey } from "./storage/utils";
import { BulkRecalcBar } from "./storage/BulkRecalcBar";
import { StorageHeader } from "./storage/StorageHeader";
import { StorageSortSelect } from "./storage/StorageSortSelect";
import { StorageRow } from "./storage/StorageRow";
import { useStalePaths } from "./storage/useStalePaths";
import "./StoragePage.css";

/** Refactored Storage page — density-aware, searchable, themed.
 *
 *  Orchestration:
 *    1. `useGames()` gives us the live library; the rows react to
 *       size mutations the same way any other consumer would.
 *    2. `sort` lives in local state — never persisted, so visits later
 *       always start at Largest first per the spec.
 *    3. Search filtering is done client-side against game names.
 *    4. Density is shared with Store/Library via `DensityProvider`. */
export default function StoragePage() {
  const { games } = useGames();
  const { density, setDensity } = useDensityContext();
  const [sort, setSort] = useState<SortKey>(DEFAULT_SORT);
  const [search, setSearch] = useState("");

  // Storage is only meaningful for games actually installed on disk.
  const installedGames = useMemo(
    () => games.filter((g) => g.installed),
    [games]
  );

  // Client-side name search filter.
  const filteredGames = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return installedGames;
    return installedGames.filter((g) =>
      g.name.toLowerCase().includes(q)
    );
  }, [installedGames, search]);

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

  const { staleMap, refresh } = useStalePaths(installedGames);
  const staleCount = useMemo(
    () =>
      Array.from(staleMap.values()).reduce((n, stale) => (stale ? n + 1 : n), 0),
    [staleMap]
  );
  const handleRowSizeUpdated = useCallback(
    (gameId: string) => {
      void refresh(gameId);
    },
    [refresh]
  );

  const showingFiltered = search.trim().length > 0;

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
          <BulkRecalcBar unsizedGames={missingGames} />
          <span className="storage__toolbar-count">
            {sortedGames.length} game{sortedGames.length === 1 ? "" : "s"}
            {showingFiltered && installedGames.length !== sortedGames.length &&
              ` of ${installedGames.length}`}
            {!showingFiltered && unsizedCount > 0 &&
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
            <button
              type="button"
              className="storage__btn storage__btn--ghost"
              onClick={() => setSearch("")}
            >
              Clear search
            </button>
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
            />
          ))}
        </ul>
      )}
    </div>
  );
}
