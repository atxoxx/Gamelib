import { useCallback, useEffect, useState } from "react";
import {
  STORE_RECENT_SEARCHES_KEY,
  STORE_RECENT_SEARCHES_MAX,
} from "../types/game";

/**
 * useRecentSearches: persists the user's recent store search queries to
 * localStorage. Drives the search empty-state suggestions so users can
 * re-run a previous search in one click.
 */
export function useRecentSearches() {
  const [searches, setSearches] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(STORE_RECENT_SEARCHES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed as string[];
      }
    } catch {
      /* ignore */
    }
    return [];
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORE_RECENT_SEARCHES_KEY, JSON.stringify(searches));
    } catch {
      /* ignore */
    }
  }, [searches]);

  /** Record a committed search — de-duped (case-insensitive), newest first. */
  const record = useCallback((query: string) => {
    const q = query.trim();
    if (!q) return;
    setSearches((prev) => {
      const lower = q.toLowerCase();
      const next = [q, ...prev.filter((s) => s.toLowerCase() !== lower)];
      return next.slice(0, STORE_RECENT_SEARCHES_MAX);
    });
  }, []);

  const remove = useCallback((query: string) => {
    setSearches((prev) => prev.filter((s) => s !== query));
  }, []);

  const clear = useCallback(() => setSearches([]), []);

  return { searches, record, remove, clear };
}
