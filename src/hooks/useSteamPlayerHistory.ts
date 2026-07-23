import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SteamPlayerHistory } from "../types/game";

/**
 * useSteamPlayerHistory
 *
 *  Fetches the long-range concurrent-player history for a single Steam
 *  appid via the Rust `get_steam_player_history` command (steamcharts.com
 *  feed). Powers the hover popover's historical line chart.
 *
 *  Range
 *  ─────
 *  `rangeDays` is forwarded to the backend: `0` = all-time, otherwise the
 *  trailing N days (30 / 90 / 180). The backend re-filters its cached
 *  full series in-memory, so switching ranges never re-hits the network
 *  within the 6h cache TTL.
 *
 *  Contract
 *  ────────
 *  - `appId` of `undefined` → `null` data, no fetch.
 *  - `isLoading` is `true` only on the first fetch of a given
 *    (appId, rangeDays) pair; range switches and focus refreshes update
 *    in place without flashing a skeleton.
 *  - Errors are swallowed and surfaced via `error` so the caller can
 *    render a quiet fallback instead of blanking the popover.
 *  - Polling is intentionally absent: the historical series changes
 *    slowly (a new daily sample at most), so we fetch on mount, on
 *    `rangeDays` change, and on window focus. The live count (a separate
 *    hook) still ticks every 60s for the headline number.
 */

export type PlayerHistoryRange = 30 | 90 | 180 | 0;

export interface UseSteamPlayerHistoryResult {
  data: SteamPlayerHistory | null;
  isLoading: boolean;
  error: string | null;
  lastUpdated: number;
}

export function useSteamPlayerHistory(
  appId: number | undefined,
  rangeDays: PlayerHistoryRange
): UseSteamPlayerHistoryResult {
  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const [data, setData] = useState<SteamPlayerHistory | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState(0);

  const appIdRef = useRef(appId);
  appIdRef.current = appId;
  const rangeRef = useRef(rangeDays);
  rangeRef.current = rangeDays;

  const fetchNow = useCallback(async () => {
    const id = appIdRef.current;
    const range = rangeRef.current;
    if (!id) {
      setData(null);
      setError(null);
      return;
    }
    try {
      const result = await invoke<SteamPlayerHistory>("get_steam_player_history", {
        appId: id,
        rangeDays: range,
      });
      if (cancelledRef.current) return;
      setData(result);
      setError(null);
      setLastUpdated(Date.now());
    } catch (err) {
      if (cancelledRef.current) return;
      const msg = typeof err === "string" ? err : "Failed to load player history";
      console.warn(`[useSteamPlayerHistory] fetch failed for appid ${id}:`, msg);
      setError(msg);
    }
  }, []);

  useEffect(() => {
    if (!appId) {
      setData(null);
      setIsLoading(false);
      setError(null);
      return;
    }
    setIsLoading(true);
    fetchNow().finally(() => {
      if (!cancelledRef.current) setIsLoading(false);
    });

    const onFocus = () => fetchNow();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, [appId, rangeDays, fetchNow]);

  return { data, isLoading, error, lastUpdated };
}
