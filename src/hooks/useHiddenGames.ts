import { useCallback, useEffect, useMemo, useState } from "react";
import { STORE_HIDDEN_KEY } from "../types/game";

/**
 * useHiddenGames: a "Not Interested" set of store game slugs, persisted to
 * localStorage. Hidden games are filtered out of every category/search view
 * by default; the store toolbar exposes a toggle to reveal them.
 */
export function useHiddenGames() {
  const [hidden, setHidden] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(STORE_HIDDEN_KEY);
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
      localStorage.setItem(STORE_HIDDEN_KEY, JSON.stringify(hidden));
    } catch {
      /* ignore */
    }
  }, [hidden]);

  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);

  const isHidden = useCallback(
    (slug: string) => hiddenSet.has(slug),
    [hiddenSet]
  );

  const hide = useCallback((slug: string) => {
    setHidden((prev) => (prev.includes(slug) ? prev : [...prev, slug]));
  }, []);

  const unhide = useCallback((slug: string) => {
    setHidden((prev) => prev.filter((s) => s !== slug));
  }, []);

  const clear = useCallback(() => setHidden([]), []);

  return { hidden, hiddenSet, isHidden, hide, unhide, clear, count: hidden.length };
}
