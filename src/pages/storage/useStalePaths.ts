import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Game } from "../../types/game";

/** Per-game staleness: `true` = the `sizeRootPath` no longer exists on
 *  disk, `false` = it still exists, and absence from the map = the
 *  game has no measured size yet (or its path was just cleared). */
export type StaleMap = Map<string, boolean>;

interface UseStalePathsResult {
  /** `game.id` -> true when the path is stale, false when it still
   *  exists. Missing keys mean "no path to check" (not yet measured). */
  staleMap: StaleMap;
  /** Re-check a single game's path. Useful after an Auto-detect that
   *  overwrites `sizeRootPath`, or after a folder pick. */
  refresh: (gameId: string) => Promise<void>;
  /** Re-check every sized game's path. Bumps a hidden counter so the
   *  bulk effect re-runs even if the game list didn't change. */
  refreshAll: () => void;
}

/** Phase-7 stale-path detection.
 *
 *  Strategy:
 *    1. On mount (and whenever the path list changes), batch every
 *       non-empty `sizeRootPath` into a single
 *       `invoke("check_paths_exist", { paths: [...] })` call. The Rust
 *       command is one stat() per path -- cheap enough to run on a
 *       500-game library in a few ms.
 *    2. Race-condition guard: an in-flight check tagged with a
 *       `cancelled` flag drops its result if the path list has changed
 *       by the time it resolves (avoiding stale-state flicker).
 *    3. `refresh(id)` re-checks a single game's path. Used after
 *       Auto-detect overwrites the path so the row's stale status
 *       updates without waiting for the next bulk sweep.
 *    4. `refreshAll()` bumps a hidden counter so the effect re-runs
 *       even if the game list is unchanged (e.g. user re-plugged a
 *       drive and wants a manual sweep). */
export function useStalePaths(games: Game[]): UseStalePathsResult {
  const [staleMap, setStaleMap] = useState<StaleMap>(() => new Map());
  const [bump, setBump] = useState(0);

  // Snapshot of the work list: (gameId, path) pairs. Re-derives only
  // when the underlying games array changes (length, identity) or
  // when refreshAll() bumps the counter.
  const pathList = useMemo<{ id: string; path: string }[]>(() => {
    const out: { id: string; path: string }[] = [];
    for (const g of games) {
      if (g.sizeRootPath && g.sizeRootPath.trim() !== "") {
        out.push({ id: g.id, path: g.sizeRootPath });
      }
    }
    return out;
    // `bump` is intentionally a dep so refreshAll() can invalidate this memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games, bump]);

  useEffect(() => {
    if (pathList.length === 0) {
      // Nothing to check -- keep staleMap empty (no row should look stale
      // just because the bulk check hasn't run yet).
      setStaleMap(new Map());
      return;
    }
    let cancelled = false;
    invoke<boolean[]>("check_paths_exist", {
      paths: pathList.map((p) => p.path),
    })
      .then((results) => {
        if (cancelled) return;
        const m: StaleMap = new Map();
        pathList.forEach((p, i) => {
          // Rust returns true=exists. We invert to "stale" semantics so
          // the StorageRow reads `staleMap.get(id) === true` for a dead path.
          m.set(p.id, results[i] === false);
        });
        setStaleMap(m);
      })
      .catch((err) => {
        if (cancelled) return;
        // Don't blow up the UI on a transient error -- just leave the
        // existing staleMap intact and surface a console hint. The next
        // bulk check (or a manual refresh) will retry.
        console.error("check_paths_exist failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [pathList]);

  const refresh = useCallback(
    async (gameId: string) => {
      const game = games.find((g) => g.id === gameId);
      if (!game || !game.sizeRootPath || game.sizeRootPath.trim() === "") {
        setStaleMap((prev) => {
          if (!prev.has(gameId)) return prev;
          const next = new Map(prev);
          next.delete(gameId);
          return next;
        });
        return;
      }
      try {
        const results = await invoke<boolean[]>("check_paths_exist", {
          paths: [game.sizeRootPath],
        });
        setStaleMap((prev) => {
          const next = new Map(prev);
          next.set(gameId, results[0] === false);
          return next;
        });
      } catch (err) {
        console.error("check_paths_exist (single) failed", err);
      }
    },
    [games]
  );

  const refreshAll = useCallback(() => {
    setBump((b) => b + 1);
  }, []);

  return { staleMap, refresh, refreshAll };
}
