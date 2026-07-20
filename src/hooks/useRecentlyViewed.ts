import { useCallback, useEffect, useState } from "react";
import {
  STORE_RECENTLY_VIEWED_KEY,
  STORE_RECENTLY_VIEWED_MAX,
  type StoreGameSummary,
} from "../types/game";

/**
 * useRecentlyViewed: tracks the last-N store games the user opened,
 * persisted to localStorage. Drives the "Recently viewed" rail on the
 * Discover landing — a cheap re-engagement nudge with no backend work.
 *
 * The full `StoreGameSummary` is stored so the rail renders instantly on
 * next launch without a re-query.
 */
export function useRecentlyViewed() {
  const [items, setItems] = useState<StoreGameSummary[]>(() => {
    try {
      const raw = localStorage.getItem(STORE_RECENTLY_VIEWED_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed as StoreGameSummary[];
      }
    } catch {
      /* ignore */
    }
    return [];
  });

  // Persist on change.
  useEffect(() => {
    try {
      localStorage.setItem(STORE_RECENTLY_VIEWED_KEY, JSON.stringify(items));
    } catch {
      /* ignore */
    }
  }, [items]);

  /** Record a game view — moves it to the front, de-duped by slug. */
  const record = useCallback((game: StoreGameSummary) => {
    if (!game?.slug) return;
    setItems((prev) => {
      const next = [game, ...prev.filter((g) => g.slug !== game.slug)];
      return next.slice(0, STORE_RECENTLY_VIEWED_MAX);
    });
  }, []);

  const clear = useCallback(() => setItems([]), []);

  return { items, record, clear };
}
