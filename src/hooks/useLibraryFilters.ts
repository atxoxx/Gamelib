import { useCallback, useMemo, useState } from "react";
import type { Game } from "../types/game";
import type { LibrarySource } from "../types/game";
import { parsePlayTime } from "../types/game";

/** Status facets for the library filter sidebar. */
export type LibraryStatus = "all" | "installed" | "not_installed";

/** Sort order for the library grid. */
export type LibrarySort = "alphabetical" | "date_added" | "most_played" | "rating";

/** Label for each sort option (used in dropdown). */
export const SORT_LABELS: Record<LibrarySort, string> = {
  alphabetical: "Alphabetical (A–Z)",
  date_added: "Date Added (Newest)",
  most_played: "Most Played",
  rating: "Highest Rated",
};

/** All sort options in dropdown order. */
export const SORT_OPTIONS: readonly LibrarySort[] = [
  "alphabetical",
  "date_added",
  "most_played",
  "rating",
];

/**
 * Active filter set for the Library page. All fields are optional; an empty
 * value on a facet means "no constraint from this facet". Mirrors the shape
 * of `useStoreGames.StoreGamesFilters` (Store uses an async backend; Library
 * is local and filters in memory).
 */
export interface LibraryFilters {
  /** Free-text name search; case-insensitive substring match. */
  search: string;
  /** Genre names; the game must include at least one of these (OR). */
  genres: string[];
  /** Platform names (matches `Game.platform` exactly). */
  platforms: string[];
  /** Lower bound on the release year (parsed from `Game.releaseDate`). */
  yearMin: number | null;
  /** Upper bound on the release year. */
  yearMax: number | null;
  /** Minimum IGDB / critic rating (0–100 inclusive). */
  ratingMin: number | null;
  /** Installation status filter. */
  status: LibraryStatus;
  /** Source platform filter (all | steam | local | gog). */
  source: LibrarySource;
  /** Sort order for the filtered list. */
  sort: LibrarySort;
}

/** Sentinel for "no filter selected from any facet". */
export const EMPTY_LIBRARY_FILTERS: LibraryFilters = {
  search: "",
  genres: [],
  platforms: [],
  yearMin: null,
  yearMax: null,
  ratingMin: null,
  status: "all",
  source: "all",
  sort: "alphabetical",
};

/**
 * Extract the 4-digit release year from a free-form date string.
 * Handles "2023-05-15", "May 15, 2023", "2023", and ISO timestamps.
 * Returns `null` for missing or malformed values.
 */
function parseReleaseYear(releaseDate: string | undefined | null): number | null {
  if (!releaseDate) return null;
  const head = releaseDate.substring(0, 4);
  const year = parseInt(head, 10);
  if (!Number.isFinite(year) || year < 1970 || year > 2100) return null;
  return year;
}

/** True if `game` passes every active facet in `filters`. */
function gameMatchesFilters(game: Game, filters: LibraryFilters): boolean {
  // Search (name substring, case-insensitive)
  if (filters.search) {
    const q = filters.search.toLowerCase().trim();
    if (q && !game.name.toLowerCase().includes(q)) return false;
  }

  // Status
  if (filters.status === "installed" && !game.installed) return false;
  if (filters.status === "not_installed" && game.installed) return false;

  // Source filter
  if (filters.source !== "all") {
    if (filters.source === "steam" && game.platform !== "Steam") return false;
    if (filters.source === "local" && game.platform !== "Local") return false;
    if (filters.source === "gog" && game.platform !== "GOG") return false;
    if (filters.source === "epic" && game.platform !== "Epic") return false;
  }

  // Genres (OR — game must have at least one selected genre)
  if (filters.genres.length > 0) {
    if (!game.genres || game.genres.length === 0) return false;
    const lowerGenres = game.genres.map((g) => g.toLowerCase());
    const hasMatch = filters.genres.some((g) =>
      lowerGenres.includes(g.toLowerCase())
    );
    if (!hasMatch) return false;
  }

  // Platforms (exact match against `game.platform`)
  if (filters.platforms.length > 0) {
    if (!filters.platforms.includes(game.platform)) return false;
  }

  // Year range
  if (filters.yearMin != null || filters.yearMax != null) {
    const year = parseReleaseYear(game.releaseDate);
    if (year == null) return false;
    if (filters.yearMin != null && year < filters.yearMin) return false;
    if (filters.yearMax != null && year > filters.yearMax) return false;
  }

  // Rating (prefer IGDB community rating, fall back to critic rating)
  if (filters.ratingMin != null) {
    const rating = game.igdbRating ?? game.criticRating;
    if (rating == null || rating < filters.ratingMin) return false;
  }

  return true;
}

/**
 * useLibraryFilters: in-memory filter state + derivation for the Library
 * page. Unlike `useStoreGames` (which talks to the Rust backend), the
 * library is local so this hook just narrows the supplied `games` array
 * via a memoized `Array.prototype.filter`.
 *
 * Returns a flat API:
 * - **filters** — current filter state
 * - **filteredGames** — narrowed game list
 * - **availableGenres** / **availablePlatforms** — unique values from
 *   the source array, used to populate the sidebar's checkbox lists
 * - per-facet setters + remove helpers (for the chips)
 * - **hasFilters** — true when any facet is active
 * - **reset** — clear every facet back to the empty defaults
 */
export function useLibraryFilters(games: Game[]) {
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_LIBRARY_FILTERS);

  // Build unique, sorted facet lists from the source array so the sidebar
  // only shows values that actually exist in the user's library.
  const availableGenres = useMemo(() => {
    const set = new Set<string>();
    for (const game of games) {
      if (game.genres) {
        for (const g of game.genres) {
          if (g) set.add(g);
        }
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [games]);

  const availablePlatforms = useMemo(() => {
    const set = new Set<string>();
    for (const game of games) {
      if (game.platform) set.add(game.platform);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [games]);

  const filteredGames = useMemo(() => {
    const hasActiveFilters =
      filters.search.length > 0 ||
      filters.genres.length > 0 ||
      filters.platforms.length > 0 ||
      filters.yearMin != null ||
      filters.yearMax != null ||
      filters.ratingMin != null ||
      filters.status !== "all" ||
      filters.source !== "all";

    const narrowed = hasActiveFilters
      ? games.filter((g) => gameMatchesFilters(g, filters))
      : games;

    // Apply sort
    const sorted = [...narrowed];
    switch (filters.sort) {
      case "alphabetical":
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "date_added":
        sorted.sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
        break;
      case "most_played":
        sorted.sort((a, b) => parsePlayTime(b.playTime) - parsePlayTime(a.playTime));
        break;
      case "rating":
        sorted.sort((a, b) => {
          const ra = a.igdbRating ?? a.criticRating ?? 0;
          const rb = b.igdbRating ?? b.criticRating ?? 0;
          return rb - ra;
        });
        break;
    }
    return sorted;
  }, [games, filters]);

  const hasFilters = useMemo(() => {
    return (
      filters.search.length > 0 ||
      filters.genres.length > 0 ||
      filters.platforms.length > 0 ||
      filters.yearMin != null ||
      filters.yearMax != null ||
      filters.yearMax != null ||
      filters.ratingMin != null ||
      filters.status !== "all" ||
      filters.source !== "all"
    );
  }, [filters]);

  // ── Bulk setters (replace the whole facet) ─────────────────────────
  const setSearch = useCallback(
    (q: string) => setFilters((f) => ({ ...f, search: q })),
    []
  );
  const setGenres = useCallback(
    (g: string[]) => setFilters((f) => ({ ...f, genres: g })),
    []
  );
  const setPlatforms = useCallback(
    (p: string[]) => setFilters((f) => ({ ...f, platforms: p })),
    []
  );
  const setYearRange = useCallback(
    (min: number | null, max: number | null) =>
      setFilters((f) => ({ ...f, yearMin: min, yearMax: max })),
    []
  );
  const setRatingMin = useCallback(
    (r: number | null) => setFilters((f) => ({ ...f, ratingMin: r })),
    []
  );
  const setStatus = useCallback(
    (s: LibraryStatus) => setFilters((f) => ({ ...f, status: s })),
    []
  );
  const setSource = useCallback(
    (s: LibrarySource) => setFilters((f) => ({ ...f, source: s })),
    []
  );
  const setSort = useCallback(
    (s: LibrarySort) => setFilters((f) => ({ ...f, sort: s })),
    []
  );

  // ── Single-value removers (used by the chips) ──────────────────────
  const removeGenre = useCallback(
    (g: string) =>
      setFilters((f) => ({ ...f, genres: f.genres.filter((x) => x !== g) })),
    []
  );
  const removePlatform = useCallback(
    (p: string) =>
      setFilters((f) => ({
        ...f,
        platforms: f.platforms.filter((x) => x !== p),
      })),
    []
  );
  const removeYear = useCallback(
    () => setFilters((f) => ({ ...f, yearMin: null, yearMax: null })),
    []
  );
  const removeRating = useCallback(
    () => setFilters((f) => ({ ...f, ratingMin: null })),
    []
  );
  const removeStatus = useCallback(
    () => setFilters((f) => ({ ...f, status: "all" })),
    []
  );
  const removeSearch = useCallback(
    () => setFilters((f) => ({ ...f, search: "" })),
    []
  );
  const removeSource = useCallback(
    () => setFilters((f) => ({ ...f, source: "all" })),
    []
  );

  const reset = useCallback(() => setFilters(EMPTY_LIBRARY_FILTERS), []);

  return {
    filters,
    filteredGames,
    availableGenres,
    availablePlatforms,
    setSearch,
    setGenres,
    setPlatforms,
    setYearRange,
    setRatingMin,
    setStatus,
    setSource,
    setSort,
    removeGenre,
    removePlatform,
    removeYear,
    removeRating,
    removeStatus,
    removeSearch,
    removeSource,
    reset,
    hasFilters,
  };
}
