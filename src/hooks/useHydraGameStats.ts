import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { HydraGameStats } from "../types/game";

/**
 * useHydraGameStats
 * ─────────────────
 * Polls the Hydra launcher's public community-stats endpoint
 * (`get_hydra_game_stats` Tauri command → GET /games/stats) for a
 * Steam appid. Returns `null` until the first successful fetch, or
 * when Hydra has no data for the appid, so consumers can hide their
 * badge/popover silently.
 *
 * Behavior mirrors `SteamPlayerCount`:
 *  - Immediate fetch on mount / appId change.
 *  - Re-poll every 60s (matches the Rust-side `HYDRA_STATS_CACHE_TTL`
 *    so we never re-fetch before the backend cache expires anyway).
 *  - Re-fetch on window focus to catch up after long idle stretches.
 *  - Errors fall through to `null` (badge hides) with a single
 *    console.warn per failure.
 */

/** Keep in lockstep with `HYDRA_STATS_CACHE_TTL` in `src-tauri/src/lib.rs`. */
const REFRESH_INTERVAL_MS = 60_000;

export default function useHydraGameStats(
  appId?: number,
): HydraGameStats | null {
  const [stats, setStats] = useState<HydraGameStats | null>(null);

  // Stable ref so polling / focus handlers always see the latest appId
  // without re-registering window listeners.
  const appIdRef = useRef(appId);
  appIdRef.current = appId;

  const fetchNow = useCallback(async () => {
    const id = appIdRef.current;
    if (!id) {
      setStats(null);
      return;
    }
    try {
      const result = await invoke<HydraGameStats | null>(
        "get_hydra_game_stats",
        { appId: id },
      );
      // Guard against the appId changing while the request was in
      // flight (Store Hero rotation swaps games under our feet).
      if (appIdRef.current !== id) return;
      setStats(result ?? null);
    } catch (err) {
      console.warn(`[useHydraGameStats] fetch failed for appid ${id}:`, err);
      if (appIdRef.current === id) setStats(null);
    }
  }, []);

  useEffect(() => {
    if (!appId) {
      setStats(null);
      return;
    }

    fetchNow();

    const interval = window.setInterval(fetchNow, REFRESH_INTERVAL_MS);
    const onFocus = () => {
      fetchNow();
    };
    window.addEventListener("focus", onFocus);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [appId, fetchNow]);

  return stats;
}
