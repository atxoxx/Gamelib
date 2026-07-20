import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { StoreGameSummary } from "../types/game";

const SUGGEST_DEBOUNCE_MS = 220;
const SUGGEST_LIMIT = 5;

/**
 * useSearchSuggestions: debounced mini-search that returns the top few
 * IGDB matches for the current query, for the live suggestion dropdown.
 *
 * Reuses `search_store_games` with a small `limit` so no new backend
 * command is needed. In-flight requests are superseded by newer input via
 * a monotonically increasing request id.
 */
export function useSearchSuggestions(query: string) {
  const [suggestions, setSuggestions] = useState<StoreGameSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const reqIdRef = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const reqId = ++reqIdRef.current;
    const timer = setTimeout(() => {
      invoke<StoreGameSummary[]>("search_store_games", {
        query: q,
        offset: 0,
        limit: SUGGEST_LIMIT,
      })
        .then((results) => {
          if (reqId !== reqIdRef.current) return;
          setSuggestions(results);
          setLoading(false);
        })
        .catch(() => {
          if (reqId !== reqIdRef.current) return;
          setSuggestions([]);
          setLoading(false);
        });
    }, SUGGEST_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  return { suggestions, loading };
}
