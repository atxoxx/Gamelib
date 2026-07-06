import { useCallback, useMemo, useState } from "react";
import { useGames } from "../context/GameContext";
import { DEFAULT_SORT, sortGames, type SortKey } from "./storage/utils";
import { BulkRecalcBar } from "./storage/BulkRecalcBar";
import { StorageHeader } from "./storage/StorageHeader";
import { StorageSortSelect } from "./storage/StorageSortSelect";
import { StorageRow } from "./storage/StorageRow";
import { useStalePaths } from "./storage/useStalePaths";
import "./StoragePage.css";

/** Phase-5 Storage page.
 *
 *  Orchestration:
 *    1. `useGames()` gives us the live library; the rows react to
 *       size mutations the same way any other consumer would.
 *    2. `sort` lives in local state — never persisted, so visits later
 *       always start at Largest first per the spec.
 *    3. `sortedGames` is memoised off `games` + `sort`; `StorageHeader`
 *       re-aggregates on its own so this component doesn't pre-bucket.
 */
export default function StoragePage() {
  const { games } = useGames();
  const [sort, setSort] = useState<SortKey>(DEFAULT_SORT);

  // Storage is only meaningful for games actually installed on disk.
  // Store-shelf entries (imported from the Store page or sitting in a
  // wishlist) lack a real install path and shouldn't show up in size
  // or drive aggregates.
  const installedGames = useMemo(
    () => games.filter((g) => g.installed),
    [games]
  );

  const sortedGames = useMemo(
    () => sortGames(installedGames, sort),
    [installedGames, sort]
  );

  const unsizedCount = useMemo(
    () =>
      installedGames.filter((g) => g.sizeBytes == null || g.sizeBytes <= 0)
        .length,
    [installedGames]
  );

  // Pass the full unsized-game set to the bulk bar; it filters out
  // games with an empty exe path internally and hides itself entirely
  // when the remaining target list is empty.
  const missingGames = useMemo(
    () =>
      installedGames.filter((g) => g.sizeBytes == null || g.sizeBytes <= 0),
    [installedGames]
  );

  // Phase-7 staleness check: bulk-asks the Rust side which
  // sizeRootPaths still resolve, and exposes a per-row refresh
  // callback the row fires after a successful Auto-detect / Re-link.
  const { staleMap, refresh } = useStalePaths(installedGames);
  const staleCount = useMemo(
    () =>
      Array.from(staleMap.values()).reduce((n, stale) => (stale ? n + 1 : n), 0),
    [staleMap]
  );
  const handleRowSizeUpdated = useCallback(
    (gameId: string) => {
      // A row just got a new sizeRootPath -- re-check it so the
      // stale indicator flips off (or stays on if the user picked
      // another missing path).
      void refresh(gameId);
    },
    [refresh]
  );

  return (
    <div className="storage__container">
      <StorageHeader games={installedGames} staleCount={staleCount} />

      <div className="storage__toolbar">
        <div className="storage__toolbar-left">
          <StorageSortSelect value={sort} onChange={setSort} />
        </div>
        <div className="storage__toolbar-right">
          <BulkRecalcBar unsizedGames={missingGames} />
          <span className="storage__toolbar-count">
            {sortedGames.length} game{sortedGames.length === 1 ? "" : "s"}
            {unsizedCount > 0 &&
              ` ${"·"} ${unsizedCount} missing`}
          </span>
        </div>
      </div>

      {sortedGames.length === 0 ? (
        <div className="storage__empty-state">
          <p>No games in your library yet.</p>
        </div>
      ) : (
        <ul className="storage__list">
          {sortedGames.map((g) => (
            <StorageRow
              key={g.id}
              game={g}
              stale={staleMap.get(g.id) === true}
              onSizeUpdated={() => handleRowSizeUpdated(g.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
