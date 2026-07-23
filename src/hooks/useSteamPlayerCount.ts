import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * useSteamPlayerCount
 * ───────────────────
 * Live Steam concurrent-player count for an appid, extracted from the
 * original `<SteamPlayerCount>` badge so the combined Steam + Hydra
 * badge (`PlayerCountBadge`) can share the exact same polling
 * behavior:
 *
 *  - Immediate fetch on mount / appId change.
 *  - Re-poll every 60s (matches the Rust-side `PLAYER_COUNT_CACHE_TTL`
 *    so we never burn a Steam API call before the backend cache has
 *    expired anyway).
 *  - Re-fetch on window focus so the user catches up after long idle.
 *
 * Returns `null` when:
 *  - appId is missing / falsy
 *  - the backend reports `Ok(None)` (Steam-tracked-but-quiet title)
 *  - Steam confirmed 0 players (a "0 playing" badge is noise)
 *  - the fetch errored (offline, invalid appid, …)
 */

/** Keep in lockstep with `PLAYER_COUNT_CACHE_TTL` in `src-tauri/src/lib.rs`. */
const REFRESH_INTERVAL_MS = 60_000;

export default function useSteamPlayerCount(appId?: number): number | null {
  const [count, setCount] = useState<number | null>(null);

  // Stable ref so polling / focus handlers always see the latest appId
  // without re-registering window listeners.
  const appIdRef = useRef(appId);
  appIdRef.current = appId;

  const fetchNow = useCallback(async () => {
    const id = appIdRef.current;
    if (!id) {
      setCount(null);
      return;
    }
    try {
      const result = await invoke<number | null>("get_steam_player_count", {
        appId: id,
      });
      // Guard against the appId changing while the request was in
      // flight (Store Hero rotation swaps games under our feet).
      if (appIdRef.current !== id) return;
      setCount(result && result > 0 ? result : null);
    } catch (err) {
      console.warn(`[useSteamPlayerCount] fetch failed for appid ${id}:`, err);
      if (appIdRef.current === id) setCount(null);
    }
  }, []);

  useEffect(() => {
    if (!appId) {
      setCount(null);
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

  return count;
}
