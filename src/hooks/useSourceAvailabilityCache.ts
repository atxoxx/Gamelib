import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSources } from "../context/SourceContext";
import type { StoreGameSummary } from "../types/game";
import { extractSteamAppIdFromWebsites } from "../types/game";
import type { MatchedDownload } from "../types/source";

/**
 * Cap concurrent `sources_search_game` calls so enabling the source
 * filter doesn't fire 20 parallel Hydra API requests on the first paint.
 */
const MAX_CONCURRENT = 3;

/**
 * FIFO cap on the in-memory availability cache to prevent unbounded
 * growth across long browsing sessions. Map insertion order is the JS
 * spec, so we evict the oldest by skipping the first N entries.
 */
const MAX_AVAILABILITY_ENTRIES = 500;

/**
 * Per-source membership for a single game. Keys are `SourceLink.id`,
 * values are `true` (match found) or `false` (no match / search error).
 */
export type GameAvailability = Map<string, boolean>;
export type AvailabilityMap = Map<string, GameAvailability>;

const EMPTY_AVAILABILITY: AvailabilityMap = new Map();

function trimAvailability(prev: AvailabilityMap): AvailabilityMap {
  if (prev.size <= MAX_AVAILABILITY_ENTRIES) {
    return new Map(prev);
  }
  const next = new Map<string, GameAvailability>();
  let toSkip = prev.size - MAX_AVAILABILITY_ENTRIES;
  for (const [k, v] of prev) {
    if (toSkip > 0) {
      toSkip -= 1;
      continue;
    }
    next.set(k, v);
  }
  return next;
}

/** Serialize the availability map to the on-disk JSON shape. */
function serialize(map: AvailabilityMap): string {
  const out: Record<string, Record<string, boolean>> = {};
  for (const [slug, inner] of map) {
    const entry: Record<string, boolean> = {};
    for (const [sid, val] of inner) entry[sid] = val;
    out[slug] = entry;
  }
  return JSON.stringify(out);
}

/** Parse the on-disk JSON shape into the availability map. */
function deserialize(raw: string | null): AvailabilityMap {
  if (!raw) return new Map();
  try {
    const parsed = JSON.parse(raw) as Record<string, Record<string, boolean>>;
    const map: AvailabilityMap = new Map();
    for (const [slug, inner] of Object.entries(parsed)) {
      const entry = new Map<string, boolean>();
      for (const [sid, val] of Object.entries(inner)) entry.set(sid, val);
      map.set(slug, entry);
    }
    return map;
  } catch {
    return new Map();
  }
}

export interface UseSourceAvailabilityCacheResult {
  /** `games` narrowed to entries present in every selected source. */
  visibleGames: StoreGameSummary[];
  /** Number of (game, source) checks currently in flight. */
  pending: number;
  /** True when the user has selected at least one source to filter by. */
  isFilterActive: boolean;
  /** `true` while at least one background check is running. */
  isFetching: boolean;
}

/**
 * Deferred, disk-cached per-game download-source availability hook.
 *
 * Unlike the original `useStoreSourceAvailability`, this hook does NOT
 * fire any network requests during ordinary browsing. It only runs the
 * worker pool when `selectedSourceIds.length > 0`, and it hydrates its
 * availability map from `<app_data>/source_cache.json` on mount so
 * repeat visits are instant. Resolved results are written back to disk
 * (debounced) so the cache survives across sessions.
 *
 * This removes the previous ~20 Hydra-API calls / page bottleneck:
 * source checks now happen only on explicit user action and are served
 * from cache afterwards.
 */
export function useSourceAvailabilityCache(
  games: StoreGameSummary[],
  selectedSourceIds: string[]
): UseSourceAvailabilityCacheResult {
  const { searchSources } = useSources();

  const [availability, setAvailability] = useState<AvailabilityMap>(
    EMPTY_AVAILABILITY
  );
  const [pending, setPending] = useState(0);

  const inFlightRef = useRef<Set<string>>(new Set());
  const loadedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mirror the latest availability into a ref so the debounced
  // write-through always persists the freshest map.
  const availabilityRef = useRef<AvailabilityMap>(availability);
  useEffect(() => {
    availabilityRef.current = availability;
  }, [availability]);

  // Stable debounced write-through to disk.
  const scheduleSave = useRef((map: AvailabilityMap) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      invoke("save_source_cache", { data: serialize(map) }).catch(() => {
        /* best-effort persistence */
      });
    }, 800);
  }).current;

  // ── Hydrate from disk once on mount ──────────────────────────────────
  useEffect(() => {
    invoke<string>("load_source_cache")
      .then((raw) => {
        const parsed = deserialize(raw);
        if (parsed.size > 0) setAvailability(parsed);
      })
      .catch(() => {
        /* no cache yet — start empty */
      })
      .finally(() => {
        loadedRef.current = true;
      });
  }, []);

  const gamesKey = useMemo(() => games.map((g) => g.slug).join("|"), [games]);
  const selectedKey = useMemo(
    () => [...selectedSourceIds].sort().join("|"),
    [selectedSourceIds]
  );

  useEffect(() => {
    if (selectedSourceIds.length === 0) {
      setPending(0);
      return;
    }

    const snapshotGames = games;
    const snapshotSources = [...selectedSourceIds].sort();

    type Task = {
      slug: string;
      query: string;
      steamAppId: number | undefined;
      dedupeKey: string;
    };

    const tasks: Task[] = [];
    for (const game of snapshotGames) {
      const dedupeKey = `${game.slug}|${snapshotSources.join("|")}`;
      if (inFlightRef.current.has(dedupeKey)) continue;

      const gameCache = availability.get(game.slug);
      const allResolved =
        gameCache !== undefined &&
        snapshotSources.every((sid) => gameCache.has(sid));
      if (allResolved) continue;

      tasks.push({
        slug: game.slug,
        query: game.name,
        steamAppId: extractSteamAppIdFromWebsites(game.websites) ?? undefined,
        dedupeKey,
      });
    }

    if (tasks.length === 0) return;

    let cancelled = false;
    let cursor = 0;

    const persist = () => scheduleSave(availabilityRef.current);

    const worker = async () => {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (cancelled) return;
        if (cursor >= tasks.length) return;
        const i = cursor++;
        const t = tasks[i];

        setPending((p) => p + 1);

        try {
          if (cancelled) return;

          const results = await searchSources(t.query, t.steamAppId);

          if (cancelled) return;

          const matchedSourceIds = new Set<string>();
          for (const r of results as MatchedDownload[]) {
            matchedSourceIds.add(r.sourceId);
          }

          setAvailability((prev) => {
            const next = trimAvailability(prev);
            const existing = next.get(t.slug) ?? new Map<string, boolean>();
            const merged = new Map(existing);
            for (const sid of snapshotSources) {
              merged.set(sid, matchedSourceIds.has(sid));
            }
            next.set(t.slug, merged);
            return next;
          });
          persist();
        } catch (err) {
          if (cancelled) return;
          console.warn(
            `[useSourceAvailabilityCache] searchSources failed for ${t.slug}:`,
            err
          );
          setAvailability((prev) => {
            const next = trimAvailability(prev);
            const existing = next.get(t.slug) ?? new Map<string, boolean>();
            const merged = new Map(existing);
            for (const sid of snapshotSources) {
              merged.set(sid, false);
            }
            next.set(t.slug, merged);
            return next;
          });
          persist();
        } finally {
          inFlightRef.current.delete(t.dedupeKey);
          setPending((p) => Math.max(0, p - 1));
        }
      }
    };

    const workers: Array<Promise<void>> = [];
    for (let i = 0; i < MAX_CONCURRENT; i++) {
      workers.push(worker());
    }
    void Promise.allSettled(workers);

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gamesKey, selectedKey, searchSources]);

  const visibleGames = useMemo(() => {
    if (selectedSourceIds.length === 0) return games;

    return games.filter((game) => {
      const cache = availability.get(game.slug);
      if (!cache) return false;
      return selectedSourceIds.every((sid) => cache.get(sid) === true);
    });
  }, [games, selectedSourceIds, availability, gamesKey]);

  return useMemo(
    () => ({
      visibleGames,
      pending,
      isFilterActive: selectedSourceIds.length > 0,
      isFetching: pending > 0,
    }),
    [visibleGames, pending, selectedSourceIds]
  );
}
