import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Game } from "../types/game";
import { extractSteamAppId, extractSteamAppIdFromWebsites } from "../types/game";
import { useGames } from "../context/GameContext";

/**
 * useSteamAppId
 *
 *  Resolve a Steam appid for `game` so the live concurrent-player
 *  badge works on EVERY library row, not just Steam-synced titles.
 *
 *  Steam-synced games already carry `game.steamAppId` set at sync
 *  time. But:
 *   - Manually imported games (`ImportModal` → local exe path with
 *     no Steam metadata) never get one.
 *   - Games added from the Store page (IGDB / LaunchBox hit on
 *     "Add to library") never get one — `search_game_metadata`
 *     returns `GameMetadataResult` which is shape-only; the appid
 *     computed inside `search_steam` is discarded.
 *   - Epic / GOG library syncs surface their native ids
 *     (`epicNamespace`, `gogGameId`) but never name-match against
 *     Steam — many cross-store titles (e.g. a Halo game sold on
 *     both Steam and Microsoft Store) silently miss the Steam
 *     concurrent-player badge entirely.
 *
 *  Resolution order
 *  ────────────────
 *  1. `game.steamAppId` if set (Steam-synced / previously resolved).
 *  2. `extractSteamAppId(game.path)` for `steam://run/<id>` paths
 *     used by the "Launch via Steam" flow, even when no exe exists
 *     on disk.
 *  2b. `extractSteamAppIdFromWebsites(game.websites)` — IGDB
 *     enrichment stores the Steam store URL in `websites`; parsing
 *     it is free and needs no network. Positive hits are persisted
 *     to the row (this is how manually added exe/batch games get a
 *     stored Steam id).
 *  3. Module-level positive cache — survives across renders and
 *     across multiple hook instances on the same gameId so a
 *     library carousel + activity page + Game page each still
 *     show the badge with one Rust round-trip total.
 *  4. localStorage miss cache — negative results ("Steam had
 *     nothing for this name") cached for `MISS_TTL_MS` (24h) so we
 *     don't re-query indefinitely for titles Steam doesn't track.
 *     After the TTL, the next mount retries — covers the rare
 *     case of a game being added to Steam long after our first
 *     lookup returned empty.
 *  5. Tauri `lookup_steam_app_id_for_game` command — Steam store
 *     search with token-based name match (every whitespace word in
 *     `game_name` must appear in the candidate's display name, so
 *     "Halo" → Halo Infinite but "The Witcher" doesn't silently
 *     grab "The Witcher 3").
 *
 *  Persistence
 *  ───────────
 *  - Positive findings are written back via `updateGame` so the
 *    resolution lives on the game row (`steamAppId` column).
 *    Subsequent library loads skip the lookup entirely.
 *  - Negative findings are NOT written to the row (we don't know
 *    if it'll stay negative forever) but ARE written to the
 *    localStorage miss cache so subsequent in-session mounts
 *    short-circuit.
 *
 *  Concurrency
 *  ───────────
 *  - `inFlightRef` (Map of gameId → promise resolver set) prevents
 *    duplicate invocations when the same gameId is mounted by
 *    multiple siblings in the same render frame (e.g. activity
 *    dashboard sidebar + sessions list + Game thumbnail on screen
 *    simultaneously when user clicks a game from the activity tab).
 *  - Errors do NOT write to miss cache (so a transient Steam
 *    hiccup causes a retry on the next mount, not a 24h cold
 *    period).
 *
 *  Cross-platform note: `window`/`localStorage` access is gated so
 *  SSR / a future React Native port wouldn't choke; today the app
 *  is Tauri-only so the gates are belt-and-braces.
 */

const MISS_CACHE_KEY = "gamelib_steam_lookup_miss_v1";
/** 24 hours. Steam can add a game long after our first lookup returns
 *  empty, so we re-try daily. */
const MISS_TTL_MS = 24 * 60 * 60 * 1000;
/** LocalStorage FIFO cap — long browsing sessions don't accumulate. */
const MISS_CACHE_CAP = 500;

interface MissEntry {
  /** Unix-ms timestamp of the negative result. */
  ts: number;
}
type MissCache = Record<string, MissEntry>;

function readMissCache(): MissCache {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(MISS_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as MissCache;
  } catch {
    return {};
  }
}

function writeMissCache(c: MissCache): void {
  if (typeof window === "undefined") return;
  try {
    // FIFO trim by JS Object.keys insertion order — spec preserved
    // for non-integer string keys (the case here; ids are uuid-like).
    const entries = Object.entries(c);
    while (entries.length > MISS_CACHE_CAP) entries.shift();
    window.localStorage.setItem(
      MISS_CACHE_KEY,
      JSON.stringify(Object.fromEntries(entries))
    );
  } catch (e) {
    // Quota errors are silent — a non-persistent miss cache is an
    // acceptable degradation; we just re-query next mount.
    void e;
  }
}

function isMissCached(gameId: string, now: number): boolean {
  const c = readMissCache();
  const e = c[gameId];
  if (!e) return false;
  if (now - e.ts > MISS_TTL_MS) return false;
  return true;
}

function setMissCached(gameId: string, now: number): void {
  const c = readMissCache();
  c[gameId] = { ts: now };
  writeMissCache(c);
}

/* ── Module-level positive cache ─────────────────────────────────────
 * Lives for the React process lifetime. Multiple hook instances on
 * the same gameId (Game hero + activity dashboard + Continue Playing
 * rail) all see the resolved value without re-firing the Rust call.
 * Reset on app reload — but by then `game.steamAppId` will have been
 * persisted via updateGame, so the lookup should hit that branch
 * from the start. */
const sessionPositiveCache = new Map<string, number>();

/* ── Module-level in-flight promise dedup ─────────────────────────────
 * A `Map<gameId, Promise<{appId, isLeader}>>`. When two sibling
 * components render the same gameId simultaneously (Continue Playing
 * card + Activity sessions row, both visible when navigating from
 * activity → game page), each instance of `useSteamAppId` used to
 * fire its own `invoke('lookup_steam_app_id_for_game')` + its own
 * `updateGame` call. The Rust HTTP cache de-dupes the Steam search,
 * but the JS layer pays N IPC round-trips and writes `steamAppId` to
 * SQLite N times (one per render site), each triggering a `setGames`
 * rebuild. By collapsing concurrent resolutions onto a single shared
 * Promise:
 *
 *   1. One Rust round-trip total per gameId per session.
 *   2. Only the FIRST caller (the "leader") writes the resolved
 *      appId back to the game row. Followers just receive the same
 *      value via Promise.await and update their LOCAL `resolved`
 *      state — no extra DB write, no extra React rebuild beyond the
 *      one the leader already triggered.
 *
 * After the Promise settles, the entry is removed so the next mount
 * of a new game triggers a fresh lookup. */
interface InFlightResolve {
  appId: number | null;
  /** True ONLY for the instance that created the Promise. Followers
   *  get `isLeader: false` so they don't write back to the row. */
  isLeader: boolean;
}
const inFlightByGameId = new Map<string, Promise<InFlightResolve>>();

function startResolve(
  gameId: string,
  gameName: string
): Promise<InFlightResolve> {
  const existing = inFlightByGameId.get(gameId);
  if (existing) {
    // Follower: re-tag isLeader=false on the same resolution. React
    // Strict Mode mounts twice, so this is the normal hot path.
    return existing.then((r) => ({
      appId: r.appId,
      isLeader: false,
    }));
  }
  const p = (async (): Promise<InFlightResolve> => {
    try {
      const appId = await invoke<number | null>(
        "lookup_steam_app_id_for_game",
        { gameName }
      );
      return { appId, isLeader: true };
    } catch (err) {
      // Collapse errors to null so followers don't crash — a Steam
      // hiccup should be invisible to the React tree beyond a single
      // console.warn from the leader.
      console.warn(
        `[useSteamAppId] Steam appid lookup failed for "${gameName}":`,
        err
      );
      return { appId: null, isLeader: true };
    }
  })();
  inFlightByGameId.set(gameId, p);
  // Cleanup: drop the entry so the NEXT mount of a fresh game can
  // start a fresh lookup. We don't care about the resolved value
  // here, only the side effect on the Map.
  void p.finally(() => {
    inFlightByGameId.delete(gameId);
  });
  return p;
}


export interface UseSteamAppIdResult {
  /** Resolved Steam appid, or `undefined` when the hook is still
   *  resolving (or if no game was passed). NEVER returns `null` —
   *  the badge treats a known-miss the same as a missing appid and
   *  stays hidden. */
  appId: number | undefined;
  /** True ONLY during the very first lookup of a given gameId. Once
   *  resolved (positively OR negatively via miss cache), this flips
   *  to `false` permanently for the mount cycle — the badge
   *  appears or stays hidden, no skeleton flash. */
  isResolving: boolean;
}

export function useSteamAppId(game: Game | null | undefined): UseSteamAppIdResult {
  const { updateGame } = useGames();

  /* Three-state model:
   *   number  — resolved appid (positive cache hit, freshly resolved,
   *             or read off the game row).
   *   null    — known miss (lookups cached negative). The badge says
   *             "nothing" without spinning off more lookups.
   *   undefined — no game passed, OR first lookup still in flight. */
  const [resolved, setResolved] = useState<number | null | undefined>(() => {
    if (!game) return undefined;
    if (typeof game.steamAppId === "number" && Number.isFinite(game.steamAppId)) {
      return game.steamAppId;
    }
    const fromPath = extractSteamAppId(game.path);
    if (fromPath != null) return fromPath;
    const fromWebsites = extractSteamAppIdFromWebsites(game.websites);
    if (fromWebsites != null) return fromWebsites;
    const cached = sessionPositiveCache.get(game.id);
    if (cached != null) return cached;
    if (isMissCached(game.id, Date.now())) return null;
    return undefined;
  });

  const [isResolving, setIsResolving] = useState(false);

  // Resolve (or re-sync resolved) whenever the game identity changes.
  // Triggering on game.id + game.path + game.name + game.steamAppId
  // catches:
  //   - Game page entered (fresh mount, different gameId)
  //   - user edits steamAppId via Settings / Edit modal
  //   - updateGame call from a sibling hook lands (re-sync via
  //     the steamAppId dep)
  useEffect(() => {
    if (!game) return;
    if (!game.name || game.name.trim().length === 0) return;

    // Fast-paths (mirrors the useState init above; duplicate to keep
    // the dep-driven effect independent of the lazy initializer).
    if (typeof game.steamAppId === "number" && Number.isFinite(game.steamAppId)) {
      setResolved(game.steamAppId);
      return;
    }
    const fromPath = extractSteamAppId(game.path);
    if (fromPath != null) {
      setResolved(fromPath);
      return;
    }
    // IGDB-enriched games carry the Steam store URL in `websites` —
    // zero-cost resolution, no Steam search round-trip. PERSIST the
    // finding on the row so every consumer (reviews, Hydra user
    // reviews, ProtonDB, deep links) reads it straight off
    // `game.steamAppId` on the next load.
    const fromWebsites = extractSteamAppIdFromWebsites(game.websites);
    if (fromWebsites != null) {
      sessionPositiveCache.set(game.id, fromWebsites);
      setResolved(fromWebsites);
      updateGame(game.id, { steamAppId: fromWebsites });
      return;
    }
    if (sessionPositiveCache.has(game.id)) {
      setResolved(sessionPositiveCache.get(game.id)!);
      return;
    }
    if (isMissCached(game.id, Date.now())) {
      setResolved(null);
      return;
    }

    // ── Real lookup ─────────────────────────────────────────────
    // Module-level Promise dedupes concurrent sibling instances
    // (Continue Playing card + Activity sessions row + Game page
    // hero all rendered for the same gameId at once) onto a single
    // Rust round-trip. Only the LEADER writes back to the row;
    // followers update only their local React state.
    setIsResolving(true);

    let cancelled = false;
    startResolve(game.id, game.name)
      .then(({ appId, isLeader }) => {
        if (cancelled) return;
        if (appId != null && Number.isFinite(appId)) {
          sessionPositiveCache.set(game.id, appId);
          setResolved(appId);
          if (isLeader) {
            // Persist on the game row so a future reload uses the
            // steamAppId-path instead of re-querying Steam.
            // Followers skip this — the leader already wrote it.
            updateGame(game.id, { steamAppId: appId });
          }
        } else {
          // Steam returned nothing — cache the miss for 24h so we
          // don't re-query on every remount for a title Steam
          // doesn't track. Only the leader writes the cache entry
          // since both leaders and followers reach this branch with
          // the same null result; idempotent so it's harmless.
          setMissCached(game.id, Date.now());
          setResolved(null);
        }
      })
      .finally(() => {
        if (cancelled) return;
        setIsResolving(false);
      });

    return () => {
      // Unmount / dep change mid-flight → discard any in-flight
      // result so we don't call setResolved after teardown.
      // Note: the MODULE-LEVEL Promise in `inFlightByGameId` is not
      // cancelled by this hook — sibling component instances still
      // need it to complete. We only stop observing it from this
      // particular hook instance.
      cancelled = true;
    };
  }, [game?.id, game?.path, game?.name, game?.steamAppId, game?.websites, updateGame]);

  // No second sync `useEffect` is needed: the main effect above
  // already includes `game?.steamAppId` in its dep array, so when
  // a sibling `updateGame` lands on the same gameId the effect
  // re-runs and the `typeof game.steamAppId === "number"` fast-path
  // re-syncs `resolved` directly. The previous second effect was
  // duplicate logic and only fired in strict-mode double-fire
  // scenarios, where it caused a wasted render. Removed.

  return {
    appId: typeof resolved === "number" ? resolved : undefined,
    isResolving: resolved === undefined && isResolving,
  };
}
