import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SteamGameStats } from "../types/game";

/**
 * useSteamGameStats
 *
 *  React hook that fetches the combined `get_steam_game_stats` payload
 *  for a single Steam appid. The payload includes developer / publisher /
 *  release date / price (the `details` block) and the aggregate review
 *  breakdown (the `reviews` block). Each block degrades independently —
 *  a Steam hiccup on `appdetails` blanks only its own fields, leaving
 *  the live count and reviews intact.
 *
 *  Shared between:
 *   - `SteamPlayerCountPopover` (header subtitle + reviews section)
 *   - `InfoKpiCard`           (the 4th KPI tile showing price)
 *
 *  The Rust backend caches `appdetails` for 24h, so it's safe for both
 *  consumers to call this hook simultaneously — the second call returns
 *  from cache and never re-hits Steam.
 *
 *  Behavior
 *  ────────
 *  - `appId` of `undefined` returns `null` data and does no fetching.
 *    Consumers should still render and only fall back to "—" / skeleton
 *    when their own state requires data.
 *  - Errors are caught + logged once; `error` is returned for callers
 *    that want to surface a custom message, otherwise the hook falls
 *    back to `null` so the calling UI can degrade gracefully.
 *  - `isLoading` is `true` on the first fetch and `false` afterwards.
 *    The hook does not re-fire on focus / interval (no polling); the
 *    data Steam's appdetails returns is essentially static so a single
 *    fetch per mount is the right cadence.
 */
export interface UseSteamGameStatsResult {
  data: SteamGameStats | null;
  isLoading: boolean;
  /** Last fetch error message, or `null`. */
  error: string | null;
}

export function useSteamGameStats(
  appId: number | undefined
): UseSteamGameStatsResult {
  const [data, setData] = useState<SteamGameStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Defensive bail-out so non-Steam games (no appid) never trigger
    // an IPC round-trip. The hook contract guarantees the consumer
    // sees a clean `null` data state and isLoading=false in this case.
    if (!appId) {
      setData(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    // Cancellation guard. A fetched promise that resolves AFTER the
    // appid changes (or the consuming component unmounts) must not
    // clobber the new mount's fresh state. Using a flag instead of a
    // ref keeps the closure simple — this effect re-runs whenever
    // `appId` changes, so the local `cancelled` variable tracks the
    // *current* run's lifetime.
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    invoke<SteamGameStats>("get_steam_game_stats", { appId })
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setIsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn(
          `[useSteamGameStats] stats fetch failed for appid ${appId}:`,
          err
        );
        setError(String(err));
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [appId]);

  return { data, isLoading, error };
}

/**
 * Format a price-overview cents value into a human-readable string.
 * Renders as "Free" when `isFree`, falls back to a plain `N.NN` number
 * when no currency symbol matches the small map below.
 *
 * Shared between the popover header subtitle area's price pill (in
 * future refinements) and the InfoKpiCard's 4th KPI tile.
 */
export function formatSteamPrice(
  cents: number | null | undefined,
  currency: string | null | undefined,
  isFree: boolean | null | undefined
): string {
  if (isFree) return "Free";
  if (cents == null || cents <= 0) return "—";
  const major = cents / 100;
  const symbols: Record<string, string> = {
    USD: "$",
    EUR: "€",
    GBP: "£",
    JPY: "¥",
    CNY: "¥",
    RUB: "₽",
    BRL: "R$",
    AUD: "A$",
    CAD: "C$",
  };
  const symbol = currency ? symbols[currency] ?? "" : "";
  return `${symbol}${major.toFixed(2)}`;
}
