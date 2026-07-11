import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PlayerCountHistory } from "../types/game";

/**
 * usePlayerCountHistory
 *
 *  React hook that polls the Rust `get_player_count_history` command
 *  for a single Steam appid and returns the time-series points plus
 *  server-computed aggregates (`current`, `peak`, `average`,
 *  `sampleCount`).
 *
 *  Polling cadence
 *  ──────────────
 *  - 60s while mounted (matches the badge's own polling rate, so the
 *    sparkline stays in lockstep with the live count).
 *  - Immediate fetch on mount and on `appId` change.
 *  - Re-fetch on window focus so the user catches up after a long
 *    distraction / compile / break.
 *
 *  Hook contract
 *  ─────────────
 *  - `appId` of `undefined` returns `null` data and does no fetching.
 *    The hook's render output is fully type-safe in this state: the
 *    consumer can render an "Awaiting data…" placeholder without
 *    null-checking every field.
 *  - `isLoading` is `true` on the very first fetch of a given appid,
 *    `false` afterwards. The polling loop does NOT set `isLoading`
 *    on subsequent fetches — we don't want the sparkline to flash
 *    a skeleton on every 60s tick.
 *  - Errors are logged once and swallowed; `data` stays at its last
 *    known-good value (or `null` on first failure). The frontend
 *    "sparkline card" component renders the last value rather than
 *    a scary error state, because a transient Steam hiccup during
 *    a 60s tick shouldn't blank the activity tab.
 *
 *  Each `<PlayerCountSparklineCard>` instance maintains its own
 *  history state — no cross-instance coordination. The Rust-side
 *  ring buffer is the single source of truth.
 */

export interface UsePlayerCountHistoryResult {
  data: PlayerCountHistory | null;
  isLoading: boolean;
  /** Unix-ms; refreshed on every successful fetch. 0 until first
   *  fetch completes. The component can show "Updated Xs ago" with
   *  this and `Date.now()`. */
  lastUpdated: number;
}

const REFRESH_INTERVAL_MS = 60_000;

export function usePlayerCountHistory(
  appId: number | undefined
): UsePlayerCountHistoryResult {
  // Cancellation guard. A fetched promise that resolves AFTER the
  // component unmounts (or after the effect tore down because the
  // user switched games) must not call setState — that would clobber
  // the new mount's fresh state with stale data from the previous
  // appid. The ref (not state) is intentional: a ref write doesn't
  // trigger a re-render, and reading it inside an async callback
  // always sees the latest value without needing to re-bind the
  // callback.
  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);
  const [data, setData] = useState<PlayerCountHistory | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number>(0);

  // Stable ref so the polling / focus handlers always see the latest
  // `appId` without forcing a re-register of window listeners.
  const appIdRef = useRef(appId);
  appIdRef.current = appId;

  const fetchNow = useCallback(async () => {
    const id = appIdRef.current;
    if (!id) {
      setData(null);
      return;
    }
    try {
      // Default 24h window. We could expose this as a parameter, but
      // the activity tab always wants 24h; the 6h/12h variants would
      // only matter if we later add a date-range picker.
      const result = await invoke<PlayerCountHistory>(
        "get_player_count_history",
        { appId: id, maxAgeMs: 24 * 60 * 60 * 1000 }
      );
      if (cancelledRef.current) return;
      setData(result);
      setLastUpdated(Date.now());
    } catch (err) {
      // Quietly fall through to the last-known state. A single
      // transient Steam hiccup shouldn't blank the activity tab's
      // sparkline card; the next 60s tick will retry.
      if (cancelledRef.current) return;
      console.warn(
        `[usePlayerCountHistory] fetch failed for appid ${id}:`,
        err
      );
    }
  }, []);

  useEffect(() => {
    if (!appId) {
      setData(null);
      setIsLoading(false);
      return;
    }

    // Loading state is only true on the very first fetch of a new
    // appid — subsequent ticks (polling, focus refresh) update the
    // data in place without flashing a skeleton. This keeps the
    // sparkline visually stable across the 60s polling loop.
    setIsLoading(true);
    fetchNow().finally(() => setIsLoading(false));

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

  return { data, isLoading, lastUpdated };
}
