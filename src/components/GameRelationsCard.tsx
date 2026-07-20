import { useEffect, useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import { useGames } from "../context/GameContext";
import { useProgressiveImage } from "../hooks/useProgressiveImages";
import { useBigScreen } from "../context/BigScreenContext";
import { useFocusable } from "../hooks/useFocusable";
import { slugify } from "../types/game";
import type {
  Game,
  GameMetadataResult,
  RelatedGame,
  RelationGroup,
  RelationType,
  StoreGameSummary,
  SimilarGame,
} from "../types/game";
import {
  RELATION_GROUP_ORDER,
} from "../types/game";

/* ────────────────────────────────────────────────────────────────────────
 *  GameRelationsCard
 * ────────────────────────────────────────────────────────────────────────
 *
 *  A unified "Game Relations" card that surfaces every meaningful
 *  relationship the current game has with other games — both inside
 *  the local library and from IGDB.
 *
 *  Inspired by Playnite's "GameRelations" generic extension
 *  (https://github.com/darklinkpower/PlayniteExtensionsCollection
 *  /tree/master/source/Generic/GameRelations), which surfaces
 *  library-local matches (Same Series, Same Developer, Same
 *  Publisher) alongside similarity signals. We extend that idea to
 *  also surface IGDB-derived groups (Collection Members, Similar
 *  Games) on the Store game detail page where local-library
 *  matching is the wrong primary signal.
 *
 *  ── Two modes, one component ──
 *
 *  - `mode="library"`  (Library GamePage)
 *      Scans the local library via `useGames()` to compute 4
 *      library-local groups: same series, same franchise, same
 *      developer, same publisher, plus a shared-genres fallback
 *      for games that don't share a high-level metadata field.
 *
 *  - `mode="store"`    (Store GameDetail)
 *      Uses the IGDB-sourced data passed in as props (similar
 *      games) plus a one-shot `get_collection_games` Tauri
 *      command to fetch the rest of the collection. Also runs the
 *      library scan in "in your library" mode (the store game's
 *      title is matched against local library names) so the user
 *      can jump to the owned copy with one click.
 *
 *  ── Deduplication ──
 *
 *  A single `seenIds: Set<string>` is threaded through the group
 *  builders so the same game never appears in two different
 *  groups. Without this, "Halo: Combat Evolved" could surface in
 *  "Same Series", "Same Developer", and "Same Publisher" all at
 *  once, which the user experience treats as redundant. Games are
 *  keyed by their normalized lowercase name so library games and
 *  IGDB games with the same title dedupe correctly.
 *
 *  ── Empty state ──
 *
 *  If no groups have content after the scan, the card renders
 *  `null` (i.e. nothing). An empty "Game Relations" card with
 *  just a title and "Nothing to show" would be visual noise on
 *  games that genuinely don't have any local or IGDB relations.
 *
 *  ── Performance ──
 *
 *  The library scan is O(N × G) where N is library size and G is
 *  the number of groups being built (max 5). For a 1000-game
 *  library, that's 5000 string comparisons — well under 1ms in
 *  V8. Memoized with `useMemo` so re-renders (e.g. when the
 *  active tab on the GamePage flips) don't re-run the scan.
 * ──────────────────────────────────────────────────────────────────── */

// ─── Public Props ──────────────────────────────────────────────────────

export type GameRelationsMode = "library" | "store";

interface BaseProps {
  /** Where the card is mounted. Drives which group builders run. */
  mode: GameRelationsMode;
  /**
   * The "current" game the relations are computed against.
   * In `mode="library"` this should be a `Game` from the local
   * library. In `mode="store"` this should be the
   * `GameMetadataResult` from `get_store_game_detail`. The
   * component is duck-typed against both via field-presence
   * checks — both have `name` and optional `developer` /
   * `publisher` / `collection` / `franchise` / `genres`.
   */
  currentGame: Game | GameMetadataResult;
}

interface LibraryModeProps extends BaseProps {
  mode: "library";
  /** The current game's local-library id (used for self-exclusion). */
  currentGameId: string;
  /** IGDB's `similar_games` field, already on the Game's metadata.
   *  Optional: when absent, the "Similar games" group is omitted. */
  similarGames?: SimilarGame[];
  /** IGDB collection ID for the "Other in this collection" group.
   *  Optional: when absent, the "Other in this collection" group is
   *  omitted (which is the common case for one-off games). */
  collectionId?: number;
  /** Human-readable collection name (used as the group's subtitle). */
  collectionName?: string;
}

interface StoreModeProps extends BaseProps {
  mode: "store";
  /** IGDB's `similar_games` field, already on the metadata. */
  similarGames?: SimilarGame[];
  /** IGDB collection ID for the "Other in Collection" group. */
  collectionId?: number;
  /** Human-readable collection name (used as the group's subtitle). */
  collectionName?: string;
}

export type GameRelationsCardProps = LibraryModeProps | StoreModeProps;

/* ─── Module-level collection cache ─────────────────────────────────────
 *
 * The Store page may mount the GameRelationsCard for many
 * different games in a single session (e.g. when a user is
 * browsing several trending games in a row). Without a cache,
 * each mount would re-query IGDB for the collection members.
 *
 * Keyed by `collection_id`. The 6-hour TTL matches the existing
 * `STORE_CACHE_TTL_MS` constant in the store cache; collection
 * membership is stable on the same timescale (IGDB rarely adds
 * or removes titles from a collection once published).
 *
 * Bounded to `COLLECTION_CACHE_MAX_ENTRIES` to prevent unbounded
 * memory growth across long browsing sessions. When the cap is
 * hit, the oldest insertion is evicted (FIFO via Map iteration
 * order, which is guaranteed to be insertion order).
 *
 * Errors are not cached: if IGDB returned an error, we want the
 * next mount to retry. Only successful empty arrays are cached.
 */
interface CollectionCacheEntry {
  games: StoreGameSummary[];
  fetchedAt: number;
}
const collectionCache = new Map<number, CollectionCacheEntry>();
const COLLECTION_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const COLLECTION_CACHE_MAX_ENTRIES = 50; // ~50 collections × ~5KB each = 250KB ceiling

/* ─── Library scan helpers ──────────────────────────────────────────── */

/** Normalize a name for cross-source deduplication. */
function normalizeName(name: string): string {
  return name.toLowerCase().trim();
}

/** True when two strings are essentially the same, ignoring trivial
 *  differences (whitespace, case). Used for the in-library check
 *  on the Store page where the IGDB title and the library name
 *  may differ in punctuation but refer to the same game. */
function namesMatch(a: string, b: string): boolean {
  return normalizeName(a) === normalizeName(b);
}

/** Count overlapping elements between two string arrays. */
function countOverlap(a: string[] | undefined, b: string[] | undefined): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  const set = new Set(a.map((g) => g.toLowerCase()));
  let count = 0;
  for (const g of b) {
    if (set.has(g.toLowerCase())) count++;
  }
  return count;
}

/* ─── Group builders (per mode) ─────────────────────────────────────── */

/** Library-mode: build all 7 groups (5 library-local + 2 IGDB-derived) in one pass. */
function buildLibraryGroups(
  current: Game,
  library: Game[],
  similarGames: RelatedGame[],
  collectionMembers: StoreGameSummary[]
): RelationGroup[] {
  const name = ("name" in current ? current.name : (current as any).title) || "";
  const seen = new Set<string>();
  // Reserve the current game's own name so it never re-appears
  // in any group (it's the "anchor" the user is already on).
  seen.add(normalizeName(name));

  const groups: RelationGroup[] = [];

  // 1. Same Series (collection)
  if (current.collection && current.collection.trim().length > 0) {
    const currentCollection = current.collection.toLowerCase().trim();
    const matches: RelatedGame[] = [];
    for (const g of library) {
      if (g.id === current.id) continue;
      if (
        g.collection !== undefined &&
        g.collection.toLowerCase().trim() === currentCollection
      ) {
        const key = normalizeName(g.name);
        if (!seen.has(key)) {
          seen.add(key);
          matches.push({
            id: 0,
            name: g.name,
            coverUrl: g.coverArtUrl,
            libraryGameId: g.id,
            inLibrary: true,
          });
        }
      }
    }
    if (matches.length > 0) {
      groups.push({
        type: "same_series",
        title: "More from this series",
        subtitle: current.collection,
        games: matches,
      });
    }
  }

  // 2. Same Franchise
  if (current.franchise && current.franchise.trim().length > 0) {
    const currentFranchise = current.franchise.toLowerCase().trim();
    const matches: RelatedGame[] = [];
    for (const g of library) {
      if (g.id === current.id) continue;
      if (
        g.franchise !== undefined &&
        g.franchise.toLowerCase().trim() === currentFranchise
      ) {
        const key = normalizeName(g.name);
        if (!seen.has(key)) {
          seen.add(key);
          matches.push({
            id: 0,
            name: g.name,
            coverUrl: g.coverArtUrl,
            libraryGameId: g.id,
            inLibrary: true,
          });
        }
      }
    }
    if (matches.length > 0) {
      groups.push({
        type: "same_franchise",
        title: "More from this franchise",
        subtitle: current.franchise,
        games: matches,
      });
    }
  }

  // 3. Same Developer
  if (current.developer && current.developer.trim().length > 0) {
    const currentDev = current.developer.toLowerCase().trim();
    const matches: RelatedGame[] = [];
    for (const g of library) {
      if (g.id === current.id) continue;
      if (
        g.developer !== undefined &&
        g.developer.toLowerCase().trim() === currentDev
      ) {
        const key = normalizeName(g.name);
        if (!seen.has(key)) {
          seen.add(key);
          matches.push({
            id: 0,
            name: g.name,
            coverUrl: g.coverArtUrl,
            libraryGameId: g.id,
            inLibrary: true,
          });
        }
      }
    }
    if (matches.length > 0) {
      groups.push({
        type: "same_developer",
        title: "More by this developer",
        subtitle: current.developer,
        games: matches,
      });
    }
  }

  // 4. Same Publisher
  if (current.publisher && current.publisher.trim().length > 0) {
    const currentPub = current.publisher.toLowerCase().trim();
    const matches: RelatedGame[] = [];
    for (const g of library) {
      if (g.id === current.id) continue;
      if (
        g.publisher !== undefined &&
        g.publisher.toLowerCase().trim() === currentPub
      ) {
        const key = normalizeName(g.name);
        if (!seen.has(key)) {
          seen.add(key);
          matches.push({
            id: 0,
            name: g.name,
            coverUrl: g.coverArtUrl,
            libraryGameId: g.id,
            inLibrary: true,
          });
        }
      }
    }
    if (matches.length > 0) {
      groups.push({
        type: "same_publisher",
        title: "More by this publisher",
        subtitle: current.publisher,
        games: matches,
      });
    }
  }

  // 5. Shared Genres (≥2 overlapping genres; final fallback)
  // Guard the candidate on having its own genres populated so a
  // game with `genres: []` can't be added to the seen set on a
  // 0-overlap result (which would mask it from later groups).
  if (current.genres && current.genres.length > 0) {
    const matches: RelatedGame[] = [];
    for (const g of library) {
      if (g.id === current.id) continue;
      if (!g.genres || g.genres.length === 0) continue;
      if (countOverlap(g.genres, current.genres) < 2) continue;
      const key = normalizeName(g.name);
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({
        id: 0,
        name: g.name,
        coverUrl: g.coverArtUrl,
        libraryGameId: g.id,
        inLibrary: true,
      });
    }
    if (matches.length > 0) {
      groups.push({
        type: "shared_genres",
        title: "Similar by genre",
        subtitle: `${matches.length} game${matches.length !== 1 ? "s" : ""} with overlapping tags`,
        games: matches,
      });
    }
  }

  // 6. Other in this collection (IGDB-fetched, when the GamePage
  // provided a `collectionId` prop). Mirrors the equivalent group in
  // store mode so the Library and Store pages surface the same data.
  if (collectionMembers.length > 0) {
    const matches: RelatedGame[] = [];
    for (const s of collectionMembers) {
      // Self-exclusion by name (the seen seed already handles the
      // exact-match case, but `namesMatch` tolerates punctuation/
      // case variations between the IGDB title and the local name).
      if (namesMatch(s.name, name)) continue;
      const key = normalizeName(s.name);
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({
        id: s.id,
        name: s.name,
        coverUrl: s.coverUrl,
        slug: s.slug,
      });
    }
    if (matches.length > 0) {
      groups.push({
        type: "other_in_collection",
        title: "Other in this collection",
        subtitle: current.collection,
        games: matches,
      });
    }
  }

  // 7. Similar games (IGDB's `similar_games` field). Same dedupe
  // path as the store page so a game that appears in BOTH the local
  // library matches AND the IGDB similar list shows up only once.
  if (similarGames.length > 0) {
    const matches: RelatedGame[] = [];
    for (const sg of similarGames) {
      const key = normalizeName(sg.name);
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({
        id: sg.id,
        name: sg.name,
        coverUrl: sg.coverUrl,
        slug: slugify(sg.name),
      });
    }
    if (matches.length > 0) {
      groups.push({
        type: "similar",
        title: "Similar games",
        subtitle: "From IGDB",
        games: matches,
      });
    }
  }

  // Sort groups by the canonical order so the UI is predictable
  // even though the builder doesn't insert in that order. Mirrors
  // buildStoreGroups so the two modes render in a consistent order.
  groups.sort(
    (a, b) =>
      RELATION_GROUP_ORDER.indexOf(a.type) -
      RELATION_GROUP_ORDER.indexOf(b.type)
  );

  return groups;
}

/** Store-mode: build library + IGDB + collection groups. */
function buildStoreGroups(
  current: GameMetadataResult,
  library: Game[],
  similarGames: RelatedGame[],
  collectionMembers: StoreGameSummary[]
): RelationGroup[] {
  const title = ("title" in current ? current.title : (current as any).name) || "";
  const seen = new Set<string>();
  // Reserve the current title.
  seen.add(normalizeName(title));

  const groups: RelationGroup[] = [];

  // 1. In Your Library (cross-ref the local library for matches by name)
  // O(N) — single pass, no nested .find() calls.
  //
  // BUGFIX: the previous order checked `seen.has(key)` BEFORE
  // `namesMatch`, which always returned early for the current
  // game's own title (seeded into `seen` at the top of this
  // function) and silently produced an empty group. We now check
  // name match first and only consult `seen` to dedupe; this
  // correctly surfaces library games that share the current
  // title under any punctuation/case variation.
  const inLibrary: RelatedGame[] = [];
  for (const g of library) {
    if (!namesMatch(g.name, title)) continue;
    const key = normalizeName(g.name);
    if (seen.has(key)) continue;
    seen.add(key);
    inLibrary.push({
      id: 0,
      name: g.name,
      coverUrl: g.coverArtUrl,
      libraryGameId: g.id,
      inLibrary: true,
    });
  }
  if (inLibrary.length > 0) {
    groups.push({
      type: "in_your_library",
      title: "In your library",
      subtitle: "You already own this game",
      games: inLibrary,
    });
  }

  // 2. Other in Collection (IGDB-fetched)
  if (collectionMembers.length > 0) {
    const matches: RelatedGame[] = [];
    for (const s of collectionMembers) {
      if (namesMatch(s.name, title)) continue;
      const key = normalizeName(s.name);
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({
        id: s.id,
        name: s.name,
        coverUrl: s.coverUrl,
        slug: s.slug,
      });
    }
    if (matches.length > 0) {
      groups.push({
        type: "other_in_collection",
        title: "Other in this collection",
        subtitle: current.collection,
        games: matches,
      });
    }
  }

  // 3. Similar Games (IGDB)
  if (similarGames.length > 0) {
    const matches: RelatedGame[] = [];
    for (const sg of similarGames) {
      const key = normalizeName(sg.name);
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({
        id: sg.id,
        name: sg.name,
        coverUrl: sg.coverUrl,
        slug: slugify(sg.name),
      });
    }
    if (matches.length > 0) {
      groups.push({
        type: "similar",
        title: "Similar games",
        subtitle: "From IGDB",
        games: matches,
      });
    }
  }

  // 4. Same Developer (library scan, store page also gets this)
  if (current.developer && current.developer.trim().length > 0) {
    const currentDev = current.developer.toLowerCase().trim();
    const matches: RelatedGame[] = [];
    for (const g of library) {
      if (g.developer === undefined) continue;
      if (g.developer.toLowerCase().trim() !== currentDev) continue;
      const key = normalizeName(g.name);
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({
        id: 0,
        name: g.name,
        coverUrl: g.coverArtUrl,
        libraryGameId: g.id,
        inLibrary: true,
      });
    }
    if (matches.length > 0) {
      groups.push({
        type: "same_developer",
        title: "More by this developer",
        subtitle: current.developer,
        games: matches,
      });
    }
  }

  // 5. Same Publisher (library scan)
  if (current.publisher && current.publisher.trim().length > 0) {
    const currentPub = current.publisher.toLowerCase().trim();
    const matches: RelatedGame[] = [];
    for (const g of library) {
      if (g.publisher === undefined) continue;
      if (g.publisher.toLowerCase().trim() !== currentPub) continue;
      const key = normalizeName(g.name);
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({
        id: 0,
        name: g.name,
        coverUrl: g.coverArtUrl,
        libraryGameId: g.id,
        inLibrary: true,
      });
    }
    if (matches.length > 0) {
      groups.push({
        type: "same_publisher",
        title: "More by this publisher",
        subtitle: current.publisher,
        games: matches,
      });
    }
  }

  // 6. Same Series / collection (library scan)
  if (current.collection && current.collection.trim().length > 0) {
    const currentCollection = current.collection.toLowerCase().trim();
    const matches: RelatedGame[] = [];
    for (const g of library) {
      if (g.collection === undefined) continue;
      if (g.collection.toLowerCase().trim() !== currentCollection) continue;
      const key = normalizeName(g.name);
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({
        id: 0,
        name: g.name,
        coverUrl: g.coverArtUrl,
        libraryGameId: g.id,
        inLibrary: true,
      });
    }
    if (matches.length > 0) {
      groups.push({
        type: "same_series",
        title: "More from this series",
        subtitle: current.collection,
        games: matches,
      });
    }
  }

  // 7. Same Franchise (library scan)
  if (current.franchise && current.franchise.trim().length > 0) {
    const currentFranchise = current.franchise.toLowerCase().trim();
    const matches: RelatedGame[] = [];
    for (const g of library) {
      if (g.franchise === undefined) continue;
      if (g.franchise.toLowerCase().trim() !== currentFranchise) continue;
      const key = normalizeName(g.name);
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({
        id: 0,
        name: g.name,
        coverUrl: g.coverArtUrl,
        libraryGameId: g.id,
        inLibrary: true,
      });
    }
    if (matches.length > 0) {
      groups.push({
        type: "same_franchise",
        title: "More from this franchise",
        subtitle: current.franchise,
        games: matches,
      });
    }
  }

  // 8. Shared Genres (≥2 overlapping genres; final fallback).
  // Self-exclusion is handled by the `seen` seed at the top of this
  // function (current.title is reserved) — we do NOT compare library
  // ids because `GameMetadataResult` has no local-library id.
  if (current.genres && current.genres.length > 0) {
    const matches: RelatedGame[] = [];
    for (const g of library) {
      if (!g.genres || g.genres.length === 0) continue;
      if (countOverlap(g.genres, current.genres) < 2) continue;
      const key = normalizeName(g.name);
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({
        id: 0,
        name: g.name,
        coverUrl: g.coverArtUrl,
        libraryGameId: g.id,
        inLibrary: true,
      });
    }
    if (matches.length > 0) {
      groups.push({
        type: "shared_genres",
        title: "Similar by genre",
        subtitle: `${matches.length} game${matches.length !== 1 ? "s" : ""} with overlapping tags`,
        games: matches,
      });
    }
  }

  // Sort groups by the canonical order so the UI is predictable
  // even though the builder doesn't insert in that order.
  groups.sort(
    (a, b) =>
      RELATION_GROUP_ORDER.indexOf(a.type) -
      RELATION_GROUP_ORDER.indexOf(b.type)
  );

  return groups;
}

/* ─── Collection fetch hook (store mode only) ──────────────────────── */

function useCollectionGames(collectionId: number | undefined): {
  games: StoreGameSummary[];
  loading: boolean;
} {
  const [games, setGames] = useState<StoreGameSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (collectionId === undefined) {
      setGames([]);
      setLoading(false);
      return;
    }

    // Serve from cache when fresh.
    const cached = collectionCache.get(collectionId);
    if (
      cached !== undefined &&
      Date.now() - cached.fetchedAt < COLLECTION_CACHE_TTL_MS
    ) {
      setGames(cached.games);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    invoke<StoreGameSummary[]>("get_collection_games", {
      collectionId,
      limit: 50,
    })
      .then((result) => {
        if (cancelled) return;
        // Bounded FIFO eviction: if adding this entry would
        // exceed the cap, drop the oldest (first-inserted) entry
        // first. Map iteration order is insertion order, so the
        // first key is the oldest.
        if (collectionCache.size >= COLLECTION_CACHE_MAX_ENTRIES) {
          const oldestKey = collectionCache.keys().next().value;
          if (oldestKey !== undefined) {
            collectionCache.delete(oldestKey);
          }
        }
        collectionCache.set(collectionId, {
          games: result,
          fetchedAt: Date.now(),
        });
        setGames(result);
        setLoading(false);
      })
      .catch((err) => {
        // Silently ignore — the card will simply omit the
        // "Other in Collection" group when IGDB is unreachable.
        // Surfacing a toast here would be noisy since the page
        // already has other metadata-failure paths.
        console.warn("GameRelations: get_collection_games failed:", err);
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [collectionId]);

  return { games, loading };
}

/* ─── Group icon map ───────────────────────────────────────────────── */

const GROUP_ICONS: Record<RelationType, ReactNode> = {
  same_series: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  ),
  same_franchise: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  ),
  same_developer: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 18l6-6-6-6" />
      <path d="M8 6l-6 6 6 6" />
    </svg>
  ),
  same_publisher: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  ),
  shared_genres: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="9" x2="20" y2="9" />
      <line x1="4" y1="15" x2="20" y2="15" />
      <line x1="10" y1="3" x2="8" y2="21" />
      <line x1="16" y1="3" x2="14" y2="21" />
    </svg>
  ),
  in_your_library: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  other_in_collection: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  ),
  similar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  ),
};

/* ─── Per-card component (one row item) ────────────────────────────── */

function RelationRowCard({
  game,
  onClick,
}: {
  game: RelatedGame;
  onClick: () => void;
}) {
  const { isBigScreen } = useBigScreen();
  const focusProps = useFocusable(onClick);
  const [coverUrl, imgRef] = useProgressiveImage(game.coverUrl || null);
  return (
    <div
      className="game-relation-card"
      {...(isBigScreen ? focusProps : { onClick })}
      role="button"
      tabIndex={isBigScreen ? -1 : 0}
      onKeyDown={isBigScreen ? undefined : (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label={`${game.name}${game.inLibrary ? " (in your library)" : ""}`}
    >
      <div className="game-relation-card-cover">
        {coverUrl ? (
          <img ref={imgRef} src={coverUrl} alt={game.name} loading="lazy" />
        ) : (
          <div className="game-relation-card-cover-placeholder">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              aria-hidden="true"
            >
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
        )}
        {game.inLibrary && (
          <span
            className="game-relation-card-pill"
            title="In your library"
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="9" height="9" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            OWNED
          </span>
        )}
      </div>
      <div className="game-relation-card-body">
        <span className="game-relation-card-name" title={game.name}>
          {game.name}
        </span>
      </div>
    </div>
  );
}

/* ─── Group section ────────────────────────────────────────────────── */

function RelationGroupSection({
  group,
  onCardClick,
}: {
  group: RelationGroup;
  onCardClick: (game: RelatedGame) => void;
}) {
  return (
    <div className="game-relations-group">
      <div className="game-relations-group-header">
        <span className="game-relations-group-icon">
          {GROUP_ICONS[group.type]}
        </span>
        <div className="game-relations-group-titles">
          <h4 className="game-relations-group-title">
            {group.title}
            <span className="game-relations-group-count">
              {group.games.length}
            </span>
          </h4>
          {group.subtitle && (
            <span className="game-relations-group-subtitle">
              {group.subtitle}
            </span>
          )}
        </div>
      </div>
      <div className="game-relations-row">
        {group.games.map((g, i) => {
          // Composite key so the same game id can appear in two
          // different groups without React warning about duplicate
          // keys (we dedupe upstream, but be defensive).
          const key = `${group.type}-${g.libraryGameId ?? g.id ?? g.slug ?? g.name}-${i}`;
          return (
            <div key={key} className="game-relations-row-item">
              <RelationRowCard
                game={g}
                onClick={() => onCardClick(g)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Main component ───────────────────────────────────────────────── */

export default function GameRelationsCard(props: GameRelationsCardProps) {
  const { mode, currentGame } = props;
  const navigate = useNavigate();
  const { games: library } = useGames();

  // For both modes, optionally fetch the IGDB collection members when
  // a collection ID is available. The useCollectionGames hook is a
  // no-op when `collectionId` is undefined (no fetch, no cache write,
  // no loading state), so it's safe to call unconditionally here.
  const { games: collectionMembers } = useCollectionGames(props.collectionId);

  // Build all groups in a single memo. The expensive bit is the
  // library scan, which is O(N × G). We re-run only when the
  // current game (or its identity-bearing props) changes.
  const groups = useMemo<RelationGroup[]>(() => {
    // IGDB-derived related games are passed in as a flat list of
    // `SimilarGame`s; we wrap them in `RelatedGame` (adding a slug for
    // store navigation) once so both the library and store builders
    // can consume them.
    const similar: RelatedGame[] = (props.similarGames ?? []).map((sg) => ({
      id: sg.id,
      name: sg.name,
      coverUrl: sg.coverUrl,
      slug: slugify(sg.name),
    }));
    if (mode === "library") {
      // Type assertion: the LibraryModeProps type guarantees
      // `currentGame` is a `Game` in library mode.
      return buildLibraryGroups(
        currentGame as Game,
        library,
        similar,
        collectionMembers
      );
    }
    // Store mode
    return buildStoreGroups(
      currentGame as GameMetadataResult,
      library,
      similar,
      collectionMembers
    );
  }, [
    mode,
    currentGame,
    library,
    collectionMembers,
    props.similarGames,
    props.collectionId,
    props.collectionName,
  ]);

  // Navigation handler — pick the right route based on which
  // navigation hint the entry carries. Library games win over
  // slugs because the user almost certainly wants to jump to
  // their owned copy if we know about one.
  const handleCardClick = (game: RelatedGame) => {
    if (game.libraryGameId) {
      navigate(`/library/${game.libraryGameId}`);
    } else if (game.slug) {
      navigate(`/store/${game.slug}`);
    }
  };

  // Empty state — don't render the card at all if every group
  // came back empty. An empty card with just a title and "No
  // related games" would be visual noise on games that genuinely
  // don't have any relations.
  if (groups.length === 0) return null;

  // Render order matches the canonical order, but our groups are
  // already built in that order, so we just render.
  return (
    <section className="game-section game-relations-card" aria-label="Game relations">
      <h2 className="game-section-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
        Game Relations
      </h2>
      <p className="game-relations-blurb">
        {mode === "library"
          ? "Other games in your library connected to this one."
          : "Other games in the same series, by the same creators, or already in your library."}
      </p>
      <div className="game-relations-groups">
        {groups.map((group) => (
          <RelationGroupSection
            key={group.type}
            group={group}
            onCardClick={handleCardClick}
          />
        ))}
      </div>
    </section>
  );
}
