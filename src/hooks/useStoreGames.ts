import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStoreCache } from "./useStoreCache";
import type { StoreGameSummary } from "../types/game";
import type { StoreCategory } from "../types/game";
import { STORE_PAGE_SIZE } from "../types/game";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Active filter set used to narrow the IGDB catalog browse in
 * `fetch_store_games`. The Rust command receives these as optional
 * arguments; an empty value means "no constraint from this facet."
 * Genres/platforms are sent by name (mapped to IGDB IDs in the Rust
 * scraper via static lookup tables), so the frontend doesn't need to
 * mirror IGDB's ID space.
 */
export interface StoreGamesFilters {
  /** Genre names exactly as they appear in `StoreFilterSidebar.GENRES`. */
  genres: string[];
  /** Platform names exactly as in `StoreFilterSidebar.PLATFORMS`. */
  platforms: string[];
  /** Lower bound on `first_release_date` year (e.g. 2020 → 2020-01-01 UTC). */
  yearMin: number | null;
  /** Upper bound on `first_release_date` year (e.g. 2024 → 2024-12-31 UTC). */
  yearMax: number | null;
  /** Minimum IGDB user/critic rating (0–100 inclusive). */
  ratingMin: number | null;
}

/** Sentinel for "no filter selected from any facet". */
export const EMPTY_STORE_FILTERS: StoreGamesFilters = {
  genres: [],
  platforms: [],
  yearMin: null,
  yearMax: null,
  ratingMin: null,
};

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
        // Snapshot current filter state so the invoke call is consistent
        // even if React state changes mid-flight. The Rust command treats
        // null/empty as "unconstrained" on each facet.
        const f = filtersRef.current;
        const filterArgs = {
          genres: f.genres.length > 0 ? f.genres : null,
          platforms: f.platforms.length > 0 ? f.platforms : null,
          yearMin: f.yearMin,
          yearMax: f.yearMax,
          ratingMin: f.ratingMin,
        };
        if (query) {
          // Live search — filters not currently applied (server-side
          // search has its own ranking; mixing them would muddy results).
          results = await invoke<StoreGameSummary[]>("search_store_games", {
            query,
            offset,
            limit: STORE_PAGE_SIZE,
          });
        } else {
          // Category browsing — pass full filter context.
          results = await invoke<StoreGameSummary[]>("fetch_store_games", {
            category: fetchCategory ?? "all",
            offset,
            limit: STORE_PAGE_SIZE,
            ...filterArgs,
          });
        }

        // Discard stale responses
        if (reqId !== requestIdRef.current || !mountedRef.current) return;

        const currentGames = gamesRef.current;
        const newList = append ? [...currentGames, ...results] : results;

        setGames(newList);
        offsetRef.current = newList.length;
        setHasMore(results.length >= STORE_PAGE_SIZE);

        // Persist to cache (only for unfiltered category browsing).
        //
        // We deliberately skip the cache write when filters are active so
        // a filtered fetch doesn't poison the unfiltered cache for the
        // same category — otherwise the next visit with cleared filters
        // would show the stale filtered slice from disk. Filtered
        // results are short-lived (re-fetched on every Apply click) and
        // aren't worth a disk round-trip.
        const isUnfiltered = !recomputeHasFilters(filtersRef.current);
        if (fetchCategory && !query && isUnfiltered) {
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

  // ── Filter state + apply/reset ───────────────────────────────────────
  // `filtersRef` is the source of truth used by `performFetch` so we don't
  // recreate the closure every time filters change. `hasFilters` is the
  // React-visible re-render flag for the chips/clear button affordances.
  const filtersRef = useRef<StoreGamesFilters>(EMPTY_STORE_FILTERS);
  const [hasFilters, setHasFilters] = useState(false);

  const recomputeHasFilters = useCallback((f: StoreGamesFilters) => {
    return (
      f.genres.length > 0 ||
      f.platforms.length > 0 ||
      f.yearMin !== null ||
      f.yearMax !== null ||
      f.ratingMin !== null
    );
  }, []);

  const applyFilters = useCallback(
    (next: StoreGamesFilters) => {
      filtersRef.current = next;
      setHasFilters(recomputeHasFilters(next));
      // Kick a fresh fetch from the active category so the rail re-narrows.
      requestIdRef.current += 1;
      const reqId = requestIdRef.current;
      setGames([]);
      offsetRef.current = 0;
      setHasMore(true);
      setError(null);
      performFetch(reqId, activeCategoryRef.current, "", 0, false);
    },
    [performFetch, recomputeHasFilters]
  );

  const resetFilters = useCallback(() => {
    applyFilters(EMPTY_STORE_FILTERS);
  }, [applyFilters]);

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
    /** Apply the supplied filter set and re-fetch from the active category. */
    applyFilters,
    /** Clear all filters and re-fetch the un-narrowed category list. */
    resetFilters,
    /** True when any filter facet is currently active. */
    hasFilters,
  };
}
