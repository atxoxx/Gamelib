import { useEffect, useMemo, useRef, useState } from "react";
import { useSources } from "../context/SourceContext";
import type { StoreGameSummary } from "../types/game";
import type { MatchedDownload } from "../types/source";

/**
 * Cap concurrent `sources_search_game` calls so a 20-game category page
 * doesn't fire 20 parallel Hydra API requests in the first paint. The
 * Rust `search_online` path makes a real HTTP request to Hydra per call
 * for the catalogue fallback; without a cap the user would saturate the
 * Hydra endpoint on every Apply click. Tuned experimentally — 3
 * in-flight feels like a reasonable balance of throughput vs. politeness.
 */
const MAX_CONCURRENT = 3;

/**
 * FIFO cap on the availability cache to prevent unbounded growth in
 * long browsing sessions (which would otherwise hold O(games × pages)
 * entries for the lifetime of the StorePage mount). Map insertion
 * order is the JS spec, so we evict the oldest by skipping the first
 * N entries during iteration.
 *
 * 500 is generous: a category page has 20 games, and we cap auto-load
 * at 3 pages, so even an extreme filter that hasn't resolved yet caps
 * out around 60 pending entries × ~5 sources = ~300 cached results.
 * 500 leaves headroom without burning more than ~50KB of heap.
 */
const MAX_AVAILABILITY_ENTRIES = 500;

/**
 * Pull the Steam AppID out of a `StoreGameSummary.websites` array.
 * IGDB's `websites` field stores all external URLs (store pages, wikis,
 * official sites), so we scan for the canonical Steam store-page host.
 * Returns `undefined` when no Steam URL is present (most non-Steam
 * titles) — in that case the Rust side falls back to catalogue-by-title.
 */
function extractSteamAppIdFromWebsites(
  websites: string[] | undefined
): number | undefined {
  if (!websites) return undefined;
  for (const url of websites) {
    const m = url.match(/store\.steampowered\.com\/app\/(\d+)/);
    if (m && m[1]) {
      const id = parseInt(m[1], 10);
      if (Number.isFinite(id)) return id;
    }
  }
  return undefined;
}

/**
 * Per-source membership for a single game.
 * Keys are `SourceLink.id`, values are `true` (match found) or `false`
 * (no match / search error). A game is absent from the outer Map until
 * at least one (game, source) check has completed; while pending, the
 * game is treated conservatively as "not in any source" until resolved.
 */
export type GameAvailability = Map<string, boolean>;
export type AvailabilityMap = Map<string, GameAvailability>;

const EMPTY_AVAILABILITY: AvailabilityMap = new Map();

/**
 * Trim the availability map down to `MAX_AVAILABILITY_ENTRIES`,
 * evicting the oldest entries by Map insertion order. Always
 * returns a fresh Map (even when no trimming is needed) so React
 * detects the state change.
 */
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

export interface UseStoreSourceAvailabilityResult {
  /**
   * `games` filtered to entries that have at least one confirmed match
   * in every selected source. When no sources are checked, this is the
   * input `games` array unchanged.
   */
  visibleGames: StoreGameSummary[];
  /**
   * Number of (game, source) checks currently in flight. Used to render
   * a "Checking N games…" chip in the filter bar.
   */
  pending: number;
  /** True when the user has selected at least one source to filter by. */
  isFilterActive: boolean;
  /** `true` while at least one background check is running. */
  isFetching: boolean;
}

/**
 * Per-game download-source availability hook for the Store page.
 *
 * Given a list of `StoreGameSummary` records and a list of selected
 * `SourceLink.id` values, returns the strict-intersection filter —
 * a game is visible iff every selected source has a confirmed match
 * for that game. Match detection is fuzzy: we delegate to
 * `sources_search_game` (Hydra API + local cache) and partition the
 * returned `MatchedDownload[]` by `sourceId` client-side.
 *
 * Why one backend call per game (rather than per (game, sourceId)):
 * the Rust side already fans out across every enabled source inside
 * `search_online` and tags each result with the source it came from.
 * Issuing one call per game keeps the request count at `N` (visible
 * games) instead of `N × M` (visible games × checked sources), which
 * matters because Hydra is a third-party service with implicit rate
 * limits we can't measure.
 *
 * Concurrency: MAX_CONCURRENT worker coroutines share a cursor into
 * the task array; the cursor advances atomically under JS's
 * single-threaded model, so no separate lock is needed.
 *
 * Cancellation: when the games list or selectedSourceIds change
 * (new category / new page / user toggles a source), the previous
 * effect run's `cancelled` flag flips to `true`. Workers in the
 * middle of awaiting `searchSources` are NOT aborted — Tauri
 * `invoke()` has no AbortController hook — but their resolution
 * callbacks skip the `setAvailability` call, so a stale result
 * never paints.
 *
 * Pending counter balance: increment once inside the worker (after
 * picking up a task), decrement once in `finally`. `finally` always
 * runs, including on `return` paths, so cancellation paths don't
 * need a second manual decrement; this was the source of an earlier
 * double-decrement bug that an outer `Math.max(0,…)` floor had been
 * silently masking.
 *
 * Cache: lives for the component's lifetime only, capped at
 * MAX_AVAILABILITY_ENTRIES with FIFO eviction. Navigating away
 * unmounts the StorePage and the cache resets; the next mount
 * re-hydrates the same data which can take a few seconds.
 */
export function useStoreSourceAvailability(
  games: StoreGameSummary[],
  selectedSourceIds: string[]
): UseStoreSourceAvailabilityResult {
  const { searchSources } = useSources();

  // ── Availability cache (state, not a ref) ──────────────────────────
  // Using state so React re-renders whenever any individual (game,
  // source) check resolves — useMemo below recomputes visibleGames
  // and the UI reflects the new narrowed set automatically.
  const [availability, setAvailability] = useState<AvailabilityMap>(
    EMPTY_AVAILABILITY
  );

  // ── In-flight dedupe by (slug, sorted selectedSourceIds) ────────────
  // Prevents the effect from re-issuing the same call when React
  // triggers a re-render before the previous one resolves. Cleared
  // in each task's success/error closure below.
  const inFlightRef = useRef<Set<string>>(new Set());

  // ── Pending counter ────────────────────────────────────────────────
  // Incremented only when a worker actually picks up a task (not at
  // effect entry), so it never leaks when tasks are skipped due to
  // cancellation. Decremented in each worker's finally.
  const [pending, setPending] = useState(0);

  // ── Stabilize inputs for the effect ────────────────────────────────
  // `games` is a fresh array reference each render from useStoreGames.
  // Identity changes when items are added or removed but stays equal
  // across unrelated re-renders. Anchor effect reactions to a sortable
  // signature of slugs so a no-op re-render doesn't refire checks.
  const gamesKey = useMemo(() => games.map((g) => g.slug).join("|"), [games]);

  // ── Use a serialized signature of selectedSourceIds for the effect ──
  // Including the raw array in deps would re-fire on every render
  // (selectedSourceIds is recreated each render by the parent). The
  // join is content-equal regardless of order, so [A,B] and [B,A]
  // produce the same key.
  const selectedKey = useMemo(
    () => [...selectedSourceIds].sort().join("|"),
    [selectedSourceIds]
  );

  // ── Fire missing checks when the inputs change ─────────────────────
  useEffect(() => {
    // No filter selected → nothing to check. Reset pending counter so
    // the UI doesn't display a stale "checking…" chip after the user
    // clears every checkbox.
    if (selectedSourceIds.length === 0) {
      setPending(0);
      return;
    }

    // Snapshot the inputs for this pass so closures hitting them
    // don't read the latest array (which may have changed by the
    // time a Promise resolves).
    const snapshotGames = games;
    // Sort so the dedupe key is order-invariant (so [A,B] and [B,A]
    // collide on the same in-flight entry).
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
      // Skip tasks we've already dispatched in a prior effect run
      // (the in-flight set survives across effect runs).
      if (inFlightRef.current.has(dedupeKey)) continue;

      const gameCache = availability.get(game.slug);
      const allResolved =
        gameCache !== undefined &&
        snapshotSources.every((sid) => gameCache.has(sid));
      // Skip fully-cached games — no new work.
      if (allResolved) continue;

      tasks.push({
        slug: game.slug,
        query: game.name,
        steamAppId: extractSteamAppIdFromWebsites(game.websites),
        dedupeKey,
      });
    }

    if (tasks.length === 0) return;

    // Cleanup-driven cancellation flag. Each effect run owns its own
    // `cancelled`; when the deps change (or unmount), the cleanup
    // flips the previous run's flag so its workers stop pulling work
    // and skip their `setAvailability` writes.
    let cancelled = false;

    // ── Worker-pool executor ────────────────────────────────────────
    // Each worker loops: take the next task, run it, decrement
    // pending, repeat. Workers exit when cancelled OR the cursor
    // passes the last task. The pool size is MAX_CONCURRENT.
    //
    // Shared `cursor` advances atomically (JS is single-threaded);
    // no separate lock needed. Each loop iteration increments
    // pending exactly once at the start and decrements once when the
    // task body settles — `finally` runs even on cancellation paths,
    // so the counter stays balanced without a second manual
    // decrement (where it would normally underflow without an outer
    // `Math.max(0,…)` floor).
    let cursor = 0;

    const worker = async () => {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (cancelled) return;
        if (cursor >= tasks.length) return;
        const i = cursor++;
        const t = tasks[i];

        // Increment pending atomically when we actually pick up the
        // task. The matching decrement lives in `finally` below.
        setPending((p) => p + 1);

        try {
          // Cancellation early-exit: a newer effect run already
          // started; bail without issuing the network call.
          // `finally` still decrements pending and clears the dedupe key.
          if (cancelled) return;

          const results = await searchSources(t.query, t.steamAppId);

          // Cancellation during the await: discard the result. The
          // task still decrements pending in the finally block.
          if (cancelled) return;

          // Build the membership set for this game: sourceIds
          // present in the matched-downloads list represent
          // "yes, this source has it". The Rust side already
          // filters at score >= 0.3, so any returned match is
          // trustworthy. Sources not represented in the response
          // are tagged false.
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
        } catch (err) {
          if (cancelled) return;
          // On network / parse / Tauri error, conservatively tag
          // every selected source as "no match" so AND semantics
          // produce the correct, conservative answer: this game
          // won't appear in the visible list until the user
          // re-tries (e.g. by toggling the source off+on or
          // clicking Reset).
          console.warn(
            `[useStoreSourceAvailability] searchSources failed for ${t.slug}:`,
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
        } finally {
          inFlightRef.current.delete(t.dedupeKey);
          setPending((p) => Math.max(0, p - 1));
        }
      }
    };

    // Spawn up to MAX_CONCURRENT workers. The cap is conservative:
    // with N=20 visible games and cap=3, the worst case is ~7
    // rounds of worker turnover. Workers race for tasks via the
    // shared `cursor`.
    const workers: Array<Promise<void>> = [];
    for (let i = 0; i < MAX_CONCURRENT; i++) {
      workers.push(worker());
    }
    // Fire-and-await the pool. We don't await here (the effect
    // cleanup runs synchronously on deps change); the workers
    // settle naturally on their own and keep updating pending /
    // availability as their tasks complete.
    void Promise.allSettled(workers);

    return () => {
      cancelled = true;
    };
    // We deliberately exclude `availability` and `pending` from the
    // dep array: `availability` is mutated by the worker's own
    // setAvailability calls (would cause an infinite loop), and
    // `pending` is only used to clear the counter on filter-empty
    // (handled inline above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gamesKey, selectedKey, searchSources]);

  // ── Derive visibleGames ──────────────────────────────────────────────
  // When no sources are selected, every game passes. Pending games
  // (no entry yet in `availability`) are conservatively excluded
  // when a filter is active — strict AND requires confirmation that
  // the game is in EVERY selected source, so showing a game whose
  // source-B check hasn't landed yet would be a lie.
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
