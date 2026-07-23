import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { StoreGameSummary } from "../types/game";

const DEBOUNCE_MS = 250;

/**
 * Debounced live search suggestions for the store search bar. Returns up
 * to `limit` IGDB matches (cover + name + release year) so the bar can
 * show a Hydra-style dropdown as the user types. Only fires when
 * `enabled` (the search field is focused / active) and the query is at
 * least 2 characters, minimizing IGDB traffic.
 */
export function useSearchSuggestions(query: string, enabled = true, limit = 5) {
  const [suggestions, setSuggestions] = useState<StoreGameSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!enabled || q.length < 2) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    const t = setTimeout(() => {
      invoke<StoreGameSummary[]>("search_store_games", {
        query: q,
        offset: 0,
        limit,
      })
        .then((res) => {
          if (id !== reqId.current) return;
          setSuggestions(res.slice(0, limit));
          setLoading(false);
        })
        .catch(() => {
          if (id !== reqId.current) return;
          setSuggestions([]);
          setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, enabled, limit]);

  return { suggestions, loading };
}
