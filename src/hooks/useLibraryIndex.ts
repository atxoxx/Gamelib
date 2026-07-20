import { useMemo } from "react";
import { useGames } from "../context/GameContext";
import type { Game, StoreGameSummary } from "../types/game";

/**
 * Normalize a game name for fuzzy library membership checks. Lowercase,
 * strip trademark/edition noise and non-alphanumerics so "Elden Ring"
 * and "ELDEN RING™" collapse to the same key.
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/™|®|©/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

export interface LibraryIndex {
  /** True when a store game (by slug or normalized name) is in the library. */
  isInLibrary: (game: StoreGameSummary) => boolean;
  /** Resolve the matching library game id (for "View in Library"), or null. */
  libraryIdFor: (game: StoreGameSummary) => string | null;
  /** All library games, exposed for personalization (For You rail). */
  games: Game[];
}

/**
 * useLibraryIndex: cross-references the store against the user's library so
 * store cards can show an "In Library" badge and "For You" recommendations
 * can be derived from owned genres/developers.
 *
 * Matching is done by slug first (exact, when a library game carries an
 * IGDB slug) then by normalized name — covering games added via the store
 * (which have slugs) and manually-added local games (which usually don't).
 */
export function useLibraryIndex(): LibraryIndex {
  const { games } = useGames();

  const { bySlug, byName } = useMemo(() => {
    const bySlug = new Map<string, string>();
    const byName = new Map<string, string>();
    for (const g of games) {
      // `slug` is optional on Game; guard defensively.
      const slug = (g as Game & { slug?: string }).slug;
      if (slug) bySlug.set(slug, g.id);
      const key = normalizeName(g.name);
      if (key) byName.set(key, g.id);
    }
    return { bySlug, byName };
  }, [games]);

  return useMemo<LibraryIndex>(() => {
    const libraryIdFor = (game: StoreGameSummary): string | null => {
      const bySlugHit = bySlug.get(game.slug);
      if (bySlugHit) return bySlugHit;
      const byNameHit = byName.get(normalizeName(game.name));
      return byNameHit ?? null;
    };
    return {
      libraryIdFor,
      isInLibrary: (game) => libraryIdFor(game) !== null,
      games,
    };
  }, [bySlug, byName, games]);
}
