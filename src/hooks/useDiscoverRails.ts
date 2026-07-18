import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { StoreGameSummary, StoreCategory } from "../types/game";

/**
 * Shared, de-duplicated fetch for Discover sections (rails + hero pool).
 *
 * Replaces the previous module-level `Map` cache that lived inside the old
 * `SnapRail`: that trick worked but was invisible, untyped, and offered no
 * retry path when a request failed. This hook gives every section a stable
 * `refresh()` and a single shared in-flight `Promise` per cache key so that
 * React 18 StrictMode's double-mount (plus the hero pool and the matching
 * rail both asking for `trending`) collapse into one backend round-trip.
 *
 * - `data`   — the loaded games, or `null` while nothing has loaded yet
 * - `error`  — the last error string, or `null`
 * - `loading`— true while a fetch is in flight
 * - `refresh`— re-run the fetch (used by the retry affordance)
 */
export interface SectionState {
  data: StoreGameSummary[] | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

// Module-scoped so two components asking for the same category+limit share
// a single backend promise (StrictMode double-mount + hero/rail overlap).
const inflight = new Map<string, Promise<StoreGameSummary[]>>();

export function useDiscoverSection(
  category: StoreCategory,
  limit = 12
): SectionState {
  const [data, setData] = useState<StoreGameSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  useEffect(() => {
    const cacheKey = `${category}:${limit}`;
    let cancelled = false;

    setLoading(true);
    setError(null);

    const run = () => {
      let pending = inflight.get(cacheKey);
      if (!pending) {
        pending = invoke<StoreGameSummary[]>("fetch_store_games", {
          category,
          offset: 0,
          limit,
        }).finally(() => {
          inflight.delete(cacheKey);
        });
        inflight.set(cacheKey, pending);
      }
      return pending;
    };

    run()
      .then((results) => {
        if (cancelled || cancelledRef.current) return;
        setData(results);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled || cancelledRef.current) return;
        setError(String(err));
        setData([]);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [category, limit, nonce]);

  const refresh = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  return { data, error, loading, refresh };
}
