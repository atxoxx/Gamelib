import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useGames } from "../context/GameContext";
import type { StoreGameSummary } from "../types/game";

/**
 * useForYou: a lightweight personalized recommendation list derived from
 * the user's library. Picks the most common genres across owned games and
 * queries the store for popular titles in those genres, then filters out
 * games the user already owns.
 *
 * Returns an empty list when the library is too small to personalize
 * (the Discover landing simply hides the rail in that case).
 */
export function useForYou(limit = 12): { games: StoreGameSummary[]; genre: string | null } {
  const { games: library } = useGames();
  const [results, setResults] = useState<StoreGameSummary[]>([]);

  // Determine the top genre across the library.
  const { topGenre, ownedNames } = useMemo(() => {
    const counts = new Map<string, number>();
    const owned = new Set<string>();
    for (const g of library) {
      owned.add(g.name.toLowerCase().replace(/[^a-z0-9]+/g, ""));
      for (const genre of g.genres ?? []) {
        counts.set(genre, (counts.get(genre) ?? 0) + 1);
      }
    }
    let topGenre: string | null = null;
    let max = 0;
    for (const [genre, count] of counts) {
      if (count > max) {
        max = count;
        topGenre = genre;
      }
    }
    return { topGenre, ownedNames: owned };
  }, [library]);

  useEffect(() => {
    if (!topGenre || library.length < 3) {
      setResults([]);
      return;
    }
    let cancelled = false;
    invoke<StoreGameSummary[]>("fetch_store_games", {
      category: "popular",
      offset: 0,
      limit: limit + 8, // over-fetch so owned-game filtering still fills the rail
      genres: [topGenre],
    })
      .then((games) => {
        if (cancelled) return;
        const filtered = games
          .filter(
            (g) =>
              !ownedNames.has(g.name.toLowerCase().replace(/[^a-z0-9]+/g, ""))
          )
          .slice(0, limit);
        setResults(filtered);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      });
    return () => {
      cancelled = true;
    };
  }, [topGenre, library.length, ownedNames, limit]);

  return { games: results, genre: topGenre };
}
