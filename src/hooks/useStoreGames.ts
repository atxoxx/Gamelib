import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStoreCache } from "./useStoreCache";
import type { StoreGameSummary } from "../types/game";
import type { StoreCategory } from "../types/game";
import { STORE_PAGE_SIZE } from "../types/game";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Primary data-fetching hook for the Store page.
 *
 * Orchestrates category browsing, live search, infinite-scroll pagination,
 * disk caching (via `useStoreCache`), and error handling.
 *
 * Returns a flat API:
 * - **games** — current list of loaded games
 * - **loading** — true while a fetch is in flight
 * - **error** — error message string or null
 * - **hasMore** — whether more pages are available
 * - **loadMore** — call to fetch the next page (idempotent while loading)
 * - **category** — the active category (trending / popular / top / all)
 * - **setCategory** — switch category (resets the game list)
 * - **searchQuery** — current live-search text
 * - **setSearchQuery** — triggers a debounced search
 * - **isSearching** — true when a search is active (vs. category browsing)
 */
export function useStoreGames() {
  const { getCategoryCache, setCategoryCache } = useStoreCache();

  // ── State ──────────────────────────────────────────────────────────────
  const [games, setGames] = useState<StoreGameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [category, setCategoryState] = useState<StoreCategory>("trending");
  const [searchQuery, setSearchQueryRaw] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  // ── Mutable refs (avoid stale closures) ────────────────────────────────
  const offsetRef = useRef(0);
  const requestIdRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeCategoryRef = useRef<StoreCategory>("trending");
  const mountedRef = useRef(true);
  const gamesRef = useRef<StoreGameSummary[]>([]);

  // Keep gamesRef in sync so performFetch can read latest games without
  // needing games in its dependency array (avoids cascading re-creations).
  useEffect(() => {
    gamesRef.current = games;
  }, [games]);

  // Track mount status so we don't setState after unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // ── Helper: perform a fetch (shared by category & search) ──────────────
  const performFetch = useCallback(
    async (
      reqId: number,
      fetchCategory: StoreCategory | null,
      query: string,
      offset: number,
      append: boolean
    ) => {
      if (!mountedRef.current) return;

      setLoading(true);
      setError(null);

      try {
        let results: StoreGameSummary[];
        if (query) {
          // Live search
          results = await invoke<StoreGameSummary[]>("search_store_games", {
            query,
            offset,
            limit: STORE_PAGE_SIZE,
          });
        } else {
          // Category browsing
          results = await invoke<StoreGameSummary[]>("fetch_store_games", {
            category: fetchCategory ?? "all",
            offset,
            limit: STORE_PAGE_SIZE,
          });
        }

        // Discard stale responses
        if (reqId !== requestIdRef.current || !mountedRef.current) return;

        const currentGames = gamesRef.current;
        const newList = append ? [...currentGames, ...results] : results;

        setGames(newList);
        offsetRef.current = newList.length;
        setHasMore(results.length >= STORE_PAGE_SIZE);

        // Persist to cache (only for category browsing, not search)
        if (fetchCategory && !query) {
          setCategoryCache(fetchCategory, newList);
        }
      } catch (err) {
        if (reqId !== requestIdRef.current || !mountedRef.current) return;
        setError(String(err));
      } finally {
        if (reqId === requestIdRef.current && mountedRef.current) {
          setLoading(false);
        }
      }
    },
    [setCategoryCache]
  );

  // ── Category change: load from cache or fetch fresh ────────────────────
  const setCategory = useCallback(
    (newCategory: StoreCategory) => {
      // Cancel any in-flight request
      requestIdRef.current += 1;
      const reqId = requestIdRef.current;

      // Reset state
      activeCategoryRef.current = newCategory;
      setCategoryState(newCategory);
      setIsSearching(false);
      setSearchQueryRaw("");
      setError(null);

      // Try cache first
      const cached = getCategoryCache(newCategory);
      if (cached) {
        setGames(cached);
        offsetRef.current = cached.length;
        setHasMore(cached.length >= STORE_PAGE_SIZE);
        setLoading(false);
        return;
      }

      // No cache — fetch fresh
      setGames([]);
      offsetRef.current = 0;
      performFetch(reqId, newCategory, "", 0, false);
    },
    [getCategoryCache, performFetch]
  );

  // ── Initial load on mount ──────────────────────────────────────────────
  useEffect(() => {
    const cached = getCategoryCache("trending");
    if (cached) {
      setGames(cached);
      offsetRef.current = cached.length;
      setHasMore(cached.length >= STORE_PAGE_SIZE);
      setLoading(false);
    } else {
      const reqId = ++requestIdRef.current;
      performFetch(reqId, "trending", "", 0, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Infinite scroll: load next page ────────────────────────────────────
  const loadMore = useCallback(() => {
    if (loading || !hasMore) return;

    const reqId = ++requestIdRef.current;
    const currentCategory = isSearching ? null : activeCategoryRef.current;
    const currentQuery = isSearching ? searchQuery : "";

    performFetch(reqId, currentCategory, currentQuery, offsetRef.current, true);
  }, [loading, hasMore, isSearching, searchQuery, performFetch]);

  // ── Search with debounce ───────────────────────────────────────────────
  const setSearchQuery = useCallback(
    (query: string) => {
      setSearchQueryRaw(query);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (!query.trim()) {
        // Empty query — go back to category browsing
        setIsSearching(false);
        requestIdRef.current += 1;
        const cached = getCategoryCache(activeCategoryRef.current);
        if (cached) {
          setGames(cached);
          offsetRef.current = cached.length;
          setHasMore(cached.length >= STORE_PAGE_SIZE);
          setLoading(false);
        } else {
          // No cache — fetch fresh from the current category
          const reqId = ++requestIdRef.current;
          setGames([]);
          offsetRef.current = 0;
          performFetch(reqId, activeCategoryRef.current, "", 0, false);
        }
        return;
      }

      setIsSearching(true);

      debounceRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        const reqId = ++requestIdRef.current;
        setGames([]);
        offsetRef.current = 0;
        performFetch(reqId, null, query, 0, false);
      }, SEARCH_DEBOUNCE_MS);
    },
    [getCategoryCache, performFetch]
  );

  return {
    games,
    loading,
    error,
    hasMore,
    loadMore,
    category,
    setCategory,
    searchQuery,
    setSearchQuery,
    isSearching,
  };
}
