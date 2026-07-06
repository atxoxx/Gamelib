import { useMemo, useState } from "react";
import { useGames } from "../context/GameContext";
import { DEFAULT_SORT, sortGames, type SortKey } from "./storage/utils";
import { StorageHeader } from "./storage/StorageHeader";
import { StorageSortSelect } from "./storage/StorageSortSelect";
import { StorageRow } from "./storage/StorageRow";
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

  return (
    <div className="storage__container">
      <StorageHeader games={installedGames} />

      <div className="storage__toolbar">
        <div className="storage__toolbar-left">
          <StorageSortSelect value={sort} onChange={setSort} />
        </div>
        <div className="storage__toolbar-right">
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
            <StorageRow key={g.id} game={g} />
          ))}
        </ul>
      )}
    </div>
  );
}
