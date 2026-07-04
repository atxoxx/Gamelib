import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { StoreCache, StoreCacheEntry, StoreGameSummary, GameMetadataResult } from "../types/game";
import { STORE_CACHE_TTL_MS } from "../types/game";

/** Empty cache factory — used as initial state and when cache is absent. */
function emptyCache(): StoreCache {
  return { categories: {}, detailCache: {} };
}

/**
 * Hook for persisting the store browser cache to disk via the Tauri backend.
 *
 * On mount it loads the cache from `<app_data>/store_cache.json`.  The
 * returned `saveCache` function writes the entire cache object back to disk.
 *
 * Cached entries are considered **stale** after `STORE_CACHE_TTL_MS` (6 h).
 * The caller is responsible for checking TTL with `isStale()` before using
 * cached data.
 */
export function useStoreCache() {
  const [cache, setCache] = useState<StoreCache>(emptyCache);
  const loadedRef = useRef(false);

  // ── Load cache from disk on mount ──────────────────────────────────────
  useEffect(() => {
    invoke<string>("load_store_cache")
      .then((raw) => {
        if (raw) {
          try {
            const parsed: StoreCache = JSON.parse(raw);
            setCache(parsed);
          } catch {
            // Corrupt cache — start fresh
            setCache(emptyCache());
          }
        }
      })
      .catch((err) => console.error("Failed to load store cache:", err))
      .finally(() => {
        loadedRef.current = true;
      });
  }, []);

  // ── Save helper — writes the full cache to disk ────────────────────────
  const saveCache = useCallback(
    async (newCache: StoreCache) => {
      setCache(newCache);
      try {
        await invoke("save_store_cache", {
          data: JSON.stringify(newCache),
        });
      } catch (err) {
        console.error("Failed to save store cache:", err);
      }
    },
    []
  );

  // ── Check if a cached entry is still fresh ─────────────────────────────
  const isFresh = useCallback((entry: StoreCacheEntry<unknown> | undefined): boolean => {
    if (!entry || !entry.fetchedAt) return false;
    return Date.now() - entry.fetchedAt < STORE_CACHE_TTL_MS;
  }, []);

  // ── Retrieve category games from cache (returns null if missing/stale) ─
  const getCategoryCache = useCallback(
    (category: string): StoreGameSummary[] | null => {
      const entry = cache.categories[category];
      return isFresh(entry) ? entry.data : null;
    },
    [cache, isFresh]
  );

  // ── Store category games in cache ──────────────────────────────────────
  const setCategoryCache = useCallback(
    async (category: string, games: StoreGameSummary[]) => {
      const next: StoreCache = {
        ...cache,
        categories: {
          ...cache.categories,
          [category]: { data: games, fetchedAt: Date.now() },
        },
      };
      await saveCache(next);
    },
    [cache, saveCache]
  );

  // ── Retrieve a detail entry from cache ─────────────────────────────────
  const getDetailCache = useCallback(
    (slug: string) => {
      const entry = cache.detailCache[slug];
      return isFresh(entry) ? entry.data : null;
    },
    [cache, isFresh]
  );

  // ── Store a detail entry in cache ──────────────────────────────────────
  const setDetailCache = useCallback(
    async (slug: string, data: GameMetadataResult) => {
      const next: StoreCache = {
        ...cache,
        detailCache: {
          ...cache.detailCache,
          [slug]: { data, fetchedAt: Date.now() },
        },
      };
      await saveCache(next);
    },
    [cache, saveCache]
  );

  return {
    cache,
    saveCache,
    isFresh,
    getCategoryCache,
    setCategoryCache,
    getDetailCache,
    setDetailCache,
  };
}
