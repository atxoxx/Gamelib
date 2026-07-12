import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  addSessionTime,
  gameNameFromPath,
  extractSteamAppId,
  type Game,
  type GameMetadataResult,
  type IgdbReview,
} from "../types/game";
import { useToast } from "./ToastContext";
import {
  isSplashEnabled,
  useSplash,
  type SplashPayload,
} from "./SplashContext";
import type { GameSession } from "../types/game";

/**
 * Read the most recently persisted session for a given game from
 * localStorage. We deliberately do NOT pull from ActivityContext
 * here — GameContext is mounted *below* SplashContext but
 * *above* ActivityContext in the provider tree, and adding a
 * `useActivity()` call would crash on startup. localStorage is the
 * source of truth (ActivityContext persists every change
 * synchronously) so we read it directly.
 */
function getLastPersistedSession(gameId: string): GameSession | null {
  try {
    const raw = localStorage.getItem("gamelib-sessions");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GameSession[];
    if (!Array.isArray(parsed)) return null;
    return parsed.find((s) => s.gameId === gameId) ?? null;
  } catch {
    return null;
  }
}

interface GameExitEvent {
  gameId: string;
  elapsedSeconds: number;
  /** Unix-millisecond timestamp captured at session-end by the Rust
   *  `GameWatcher.finish_session` hook. Stamped onto the game as
   *  `lastPlayed` so the "Continue Playing" rail can surface recently-
   *  active titles. `0` is treated as "unknown" and skipped (an unset
   *  system clock shouldn't burn the field with a poisoned value). */
  finishedAt?: number;
}

/** Payload for the "game-started" event emitted by the watcher
 *  when a game process is passively detected. */
interface GameStartedEvent {
  gameId: string;
  gameName: string;
  detectedExe?: string;
}

interface GameContextType {
  games: Game[];
  selectedGameId: string | null;
  setSelectedGameId: (id: string | null) => void;
  addGame: (game: Game) => void;
  addGames: (games: Game[]) => void;
  removeGame: (id: string) => void;
  updateGame: (id: string, updates: Partial<Game>) => void;
  getGame: (id: string) => Game | undefined;
  runningGameIds: string[];
  launchGame: (game: Game) => void;
  /**
   * Force-terminate the running game process and record the session.
   * Visible from the Game page "Force Close" button — pairs with the
   * `force_close_game` Tauri command. Reuses the same `game-exited`
   * event path as a natural exit, so activity / playtime / lastPlayed
   * all flow through to the existing listeners without bespoke
   * bookkeeping.
   */
  forceCloseGame: (game: Game) => Promise<void>;
  addStoreGame: (metadata: GameMetadataResult) => Promise<string>;
  importLocalGames: (items: { path: string; metadata: GameMetadataResult | null }[]) => Promise<void>;
  fetchGameReviews: (gameId: string, gameName: string, steamAppId?: number) => Promise<void>;
  /**
   * On-demand IGDB metadata enrichment. Called by GamePage on mount when
   * a game lacks a description (e.g. freshly Steam-synced, or imported
   * without metadata). Single IGDB call per invocation — well under the
   * 4 req/s cap. Safe to call multiple times; the function silently skips
   * games IGDB doesn't recognise.
   */
  enrichGameMetadata: (gameId: string, gameName: string, steamAppId?: number) => Promise<void>;
}

const GameContext = createContext<GameContextType | null>(null);

export const NO_IGDB_MATCH_SOURCE = "Steam (no IGDB match)";

let nextId = 1;
function generateId(): string {
  return `game-${Date.now()}-${nextId++}`;
}

// Session-scoped attempt counter `Map` for `enrichGameMetadata`. Multiple
// entry points (LibraryPage IntersectionObserver, GamePage on-mount, batch
// imports, etc.) all converge on this single function.
//
// A counter (not just a Set) does two jobs at once:
//
//  1. **Dedupe**: prevents the same gameId being enriched repeatedly by
//     multiple observers in the same window — the first attempt goes
//     through, subsequent ones see the count > 0 and the top-of-function
//     guard short-circuits them.
//
//  2. **Retry cap**: if Rust persistently fails to download the cover
//     AND the URL it falls back to also 404s in the browser, the
//     library card's `onError` chain clears `coverArtUrl`, the
//     IntersectionObserver re-arms on the next render, and we would
//     otherwise loop indefinitely between Rust call → onError →
//     re-arm → Rust call. Capping at MAX_ENRICH_ATTEMPTS prevents
//     that: after the cap, observer-fired calls bail at the guard,
//     but they are cheap (no Rust round-trip) so the UI stays
//     responsive.
//
// Persisted fields on the Game record are written on the first
// successful attempt; a no-op on subsequent calls is correct, not
// lossy. Module scope keeps the counter alive across library ↔
// detail-page navigation rather than resetting on every GameProvider
// remount.
const MAX_ENRICH_ATTEMPTS = 2;
const enrichAttemptsThisSession = new Map<string, number>();

/**
 * True iff `u` is a base64 data URL — i.e. an image we successfully
 * downloaded to disk. Used by the unpoison block in `enrichGameMetadata`
 * to decide whether a retry is necessary when cover art eventually
 * fails to load.
 *
 * Hoisted to module scope so the helper isn't reallocated on every
 * enrichment call (it's a pure predicate with no closure deps).
 */
const isFrontendUsableImage = (u: string | undefined): boolean =>
  !!u && u.startsWith("data:");

export function GameProvider({ children }: { children: ReactNode }) {
  const { showToast } = useToast();
  // SplashProvider wraps GameProvider in App.tsx, so we can read the
  // splash dispatcher straight from context. No cross-window IPC,
  // no async round-trip — the splash is an in-process React overlay.
  const splash = useSplash();
  const [games, setGames] = useState<Game[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [runningGameIds, setRunningGameIds] = useState<string[]>([]);
  const loadedRef = useRef(false);

  // Load persisted games on mount
  useEffect(() => {
    invoke<Game[]>("load_games")
      .then((data) => {
        if (data.length > 0) {
          setGames(data);
          // Populate the watcher's process index for passive detection.
          // Pass game refs so the background poll loop can match
          // running processes to known games.
          const refs = data.map((g) => ({
            gameId: g.id,
            gameName: g.name,
            platform: g.platform,
            exePath: g.path || "",
            steamAppId: g.steamAppId ?? null,
          }));
          invoke("rebuild_watcher_index", { games: refs }).catch((err) =>
            console.error("Failed to rebuild watcher index:", err)
          );
        }
      })
      .catch((err) => console.error("Failed to load games:", err))
      .finally(() => {
        loadedRef.current = true;
      });
  }, []);

  // Persist whenever games change (skip initial empty state before load)
  useEffect(() => {
    if (loadedRef.current) {
      invoke("save_games", { games }).catch((err) =>
        console.error("Failed to save games:", err)
      );
    }
  }, [games]);

  // Listen for game-exited events from the Rust backend
  useEffect(() => {
    const unlisten = listen<GameExitEvent>("game-exited", (event) => {
      const { gameId, elapsedSeconds, finishedAt } = event.payload;

      // Remove from running games list
      setRunningGameIds((prev) => prev.filter((id) => id !== gameId));

      // Update session playtime + lastPlayed (drives the "Continue
      // Playing" rail). Only stamp `lastPlayed` when the Rust payload
      // carries a real timestamp (`finishedAt > 0`) so an unset system
      // clock on the backend never poisons the field with the unix
      // epoch. Persistence is automatic — the `useEffect` watching
      // `games` will fire `save_games` with the new value.
      setGames((prev) =>
        prev.map((g) => {
          if (g.id !== gameId) return g;
          const updates: Partial<Game> = {
            playTime: addSessionTime(g.playTime, elapsedSeconds),
          };
          if (finishedAt && finishedAt > 0) {
            updates.lastPlayed = finishedAt;
          }
          return { ...g, ...updates };
        })
      );
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Listen for game-started events (passive detection by the watcher)
  useEffect(() => {
    const unlisten = listen<GameStartedEvent>("game-started", (event) => {
      const { gameId, detectedExe } = event.payload;

      // Add to running games list so the UI shows "now playing"
      setRunningGameIds((prev) => {
        if (prev.includes(gameId)) return prev;
        return [...prev, gameId];
      });

      // Stamp lastPlayed when the watcher first detects a running game
      // so passively-launched titles show up in "Continue Playing".
      // Also persist the detected exe path if one was found.
      setGames((prev) =>
        prev.map((g) =>
          g.id === gameId
            ? { ...g, lastPlayed: Date.now(), ...(detectedExe ? { detectedExe } : {}) }
            : g
        )
      );
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const updateGame = useCallback((id: string, updates: Partial<Game>) => {
    setGames((prev) =>
      prev.map((g) => (g.id === id ? { ...g, ...updates } : g))
    );
  }, []);

  /** Download a single image to base64, falling back to the remote URL. */
  async function downloadImageSafe(url: string | undefined | null): Promise<string | undefined> {
    if (!url) return undefined;
    try {
      const dataUrl: string | null = await invoke("download_image", { url });
      return dataUrl ?? url;
    } catch {
      return url;
    }
  }

  /** Batch-download images from a metadata result: cover, hero, banner, logo. */
  async function fetchAllImages(images: { icon?: string | null; cover?: string | null; hero?: string | null; banner?: string | null; logo?: string | null }) {
    const [coverUrl, heroUrl, bannerUrl, logoUrl] = await Promise.all([
      downloadImageSafe(images.cover),
      downloadImageSafe(images.hero),
      downloadImageSafe(images.banner),
      downloadImageSafe(images.logo),
    ]);
    return {
      coverArtUrl: coverUrl ?? undefined,
      bannerUrl: heroUrl ?? bannerUrl ?? undefined,
      logoUrl: logoUrl ?? undefined,
    };
  }

  /** On-demand IGDB metadata enrichment. Called by GamePage on mount when
   *  the game lacks a description (or when the user clicks Fetch Metadata
   *  in the edit panel). Replaces the old `addGame`/`addGames` auto-fetch
   *  fan-out which was wasteful for 500+ game libraries.
   *
   *  SUCCESS/FAILURE SEMANTICS:
   *  * Single IGDB `game` call + (when matches found) one `game_time_to_beats`
   *    call. Rust `igdb_acquire()` enforces 250 ms spacing between IGDB calls.
   *  * Never throws — silently skips games IGDB doesn't recognise.
   *  * Never overwrites a non-empty Game field with an empty IGDB result.
   */
  // Keep a ref to the latest games array so the enrichGameMetadata callback
  // identity stays stable across any game mutation. Otherwise the dep on
  // `games` would re-create this callback on every keystroke or insert,
  // forcing the GamePage effect to re-run (subsequent guard still prevents
  // redundant IGDB calls, but the closure churn was wasted CPU).
  const gamesRef = useRef(games);
  gamesRef.current = games;

  const enrichGameMetadata = useCallback(async (gameId: string, gameName: string, steamAppId?: number) => {
    // Dedupe + retry cap (see MAX_ENRICH_ATTEMPTS comment above). Both
    // the LibraryPage observer and the GamePage on-mount effect settle
    // on this single counter, so multiple fires for the same gameId in
    // a single session collapse into one round-trip (when Rust
    // succeeds) or at most `MAX_ENRICH_ATTEMPTS` round-trips (when
    // Rust keeps failing — the cap protects against an infinite
    // Rust-call loop on permanently broken upstream URLs).
    const previousAttempts = enrichAttemptsThisSession.get(gameId) ?? 0;
    if (previousAttempts >= MAX_ENRICH_ATTEMPTS) return;
    enrichAttemptsThisSession.set(gameId, previousAttempts + 1);

    try {
      const results: GameMetadataResult[] = await invoke("search_game_metadata", {
        gameName,
        skipLaunchbox: !!steamAppId,
      });
      // Find the current game record to merge intelligently (don't
      // overwrite non-empty existing fields with empty IGDB results).
      const current = gamesRef.current.find((g) => g.id === gameId);
      if (!current) return;
      if (results.length === 0) {
        // No IGDB match. Mark the game as a Steam-sourced record so a
        // subsequent visit doesn't try to enrich it again — the GamePage
        // effect uses this sentinel via metadataSource.
        updateGame(gameId, {
          metadataSource: current.metadataSource ?? NO_IGDB_MATCH_SOURCE,
        });
        // DEFINITIVE FAILURE: the search returned nothing rather than
        // timing out or 404-ing. Drop the attempt counter so a future
        // MANUAL user-initiated retry (e.g. clearing the coverArtUrl in
        // the GamePage edit modal) gets a fresh budget instead of
        // inheriting a burned slot. Future AUTO-fetches are gated by
        // the metadataSource sentinel above, so they won't fire
        // regardless of the counter.
        enrichAttemptsThisSession.delete(gameId);
        return;
      }
      // Prefer IGDB for its richer metadata (timeToBeat, criticRating, themes,
      // screenshots, videos, etc.) — Steam and LaunchBox only provide basics.
      const meta = results.find((r) => r.sourceName === "IGDB") ?? results[0];

      // IMAGE-LEVEL FALLBACK across sources: many older / modded /
      // niche titles (e.g. ARMA 2 Private Military Company, Arma Gold,
      // mods without IGDB entries) have NO IGDB cover — but a perfectly
      // valid Steam library_600x900.jpg or LaunchBox box front. Without
      // this cross-source image fallback those games would render as the
      // placeholder text card forever, since the IGDB-only `meta`
      // selection above drops the Steam/LaunchBox image URLs on the floor.
      // Textual metadata still prizes IGDB above other sources.
      const pickImage = (key: "cover" | "hero" | "banner" | "logo"): string | null => {
        if (meta.images[key]) return meta.images[key];
        for (const r of results) {
          if (r.images[key]) return r.images[key];
        }
        return null;
      };
      const images = await fetchAllImages({
        cover: pickImage("cover"),
        hero: pickImage("hero"),
        banner: pickImage("banner"),
        logo: pickImage("logo"),
      });
      // Merge with sentinel "only set if currently empty" for textual fields
      // so a user-edited description isn't clobbered by an IGDB re-fetch.
      const setIfEmpty = <K extends keyof Game>(key: K, value: Game[K] | undefined): Game[K] | undefined => {
        // Treat only null/undefined as "unset". An empty string (e.g. user
        // explicitly clearing the description) is preserved and not overwritten
        // by an IGDB value on subsequent visits.
        if (current[key] === undefined || current[key] === null) return value;
        return current[key];
      };
      updateGame(gameId, {
        description: setIfEmpty("description", meta.description ?? undefined),
        developer: setIfEmpty("developer", meta.developer ?? undefined),
        publisher: setIfEmpty("publisher", meta.publisher ?? undefined),
        releaseDate: setIfEmpty("releaseDate", meta.releaseDate ?? undefined),
        genres: current.genres && current.genres.length > 0 ? current.genres : (meta.genres.length > 0 ? meta.genres : undefined),
        // For images, prefer the IGDB cover/hero over orphaned Steam CDN URLs
        // when IGDB returned one — otherwise keep whatever's already there.
        coverArtUrl: images.coverArtUrl ?? current.coverArtUrl,
        bannerUrl: images.bannerUrl ?? current.bannerUrl,
        logoUrl: images.logoUrl ?? current.logoUrl,
        igdbRating: current.igdbRating ?? meta.igdbRating ?? undefined,
        criticRating: current.criticRating ?? meta.criticRating ?? undefined,
        themes: current.themes ?? meta.themes ?? undefined,
        gameModes: current.gameModes ?? meta.gameModes ?? undefined,
        playerPerspectives: current.playerPerspectives ?? meta.playerPerspectives ?? undefined,
        screenshots: current.screenshots ?? meta.screenshots ?? undefined,
        videos: current.videos ?? meta.videos ?? undefined,
        websites: current.websites ?? meta.websites ?? undefined,
        timeToBeat: current.timeToBeat ?? meta.timeToBeat ?? undefined,
        similarGames: current.similarGames ?? meta.similarGames ?? undefined,
        releases: current.releases ?? meta.releases ?? undefined,
        igdbReviews: current.igdbReviews ?? meta.igdbReviews ?? undefined,
        collectionId: setIfEmpty("collectionId", meta.collectionId ?? undefined),
        metadataSource: meta.sourceName,
        metadataUrl: meta.sourceUrl,
      });
      // Defensive REWARD: when an attempt produced a usable image OR
      // the game already had a working cover from a previous fetch,
      // reset the attempt counter so a future user-initiated clear +
      // re-fire (via the LibraryPage observer being re-armed by an
      // onError-clear, or the user manually editing coverArtUrl to
      // undefined) gets a FRESH attempt budget. Otherwise leave the
      // count alone — the counter we incremented at the top of this
      // function records the attempt just made, and the top-of-function
      // guard will start rejecting after MAX_ENRICH_ATTEMPTS is reached.
      //
      // A frontend-usable cover is a base64 data URL downloaded via
      // Rust. `downloadImageSafe()` falls back to returning the original
      // REMOTE URL on Rust failure, which is technically a truthy string
      // but not a working image — when the browser then 404s on it and
      // the Steam-CDN onError chain on the library card exhausts every
      // fallback and clears `coverArtUrl`, the LibraryPage observer
      // re-arms but our cap protects against an infinite Rust-call loop.
      if (
        isFrontendUsableImage(images.coverArtUrl) ||
        isFrontendUsableImage(images.bannerUrl) ||
        isFrontendUsableImage(images.logoUrl) ||
        !!current.coverArtUrl
      ) {
        enrichAttemptsThisSession.delete(gameId);
      }
      console.log(`Enriched ${gameName} via ${meta.sourceName}`);

      // Background review load happens lazily via ReviewsTab on first open,
      // so we don't need to seed it here. This also avoids TDZ ordering
      // issues with fetchGameReviews's useCallback declaration below.
    } catch (err) {
      console.error("enrichGameMetadata failed:", err);
      // Same rationale as the no-results branch — the Rust / IGDB /
      // LaunchBox call didn't even resolve. Reset the attempt counter
      // so a transient network blip or IPC failure doesn't burn one of
      // the user's two retries.
      enrichAttemptsThisSession.delete(gameId);
    }
  }, [updateGame]);

  /** Fetch reviews for a game from the best available source (Steam first,
   *  IGDB fallback) and persist them on the game record. Safe to call any
   *  time — does not block the UI and never wipes existing reviews on empty
   *  results. */
  const fetchGameReviews = useCallback(
    async (gameId: string, gameName: string, steamAppId?: number) => {
      try {
        const result = await invoke<{ reviews: IgdbReview[]; source: string; error?: string }>(
          "fetch_game_reviews",
          { gameName, steamAppId }
        );
        if (result.reviews.length > 0) {
          updateGame(gameId, { igdbReviews: result.reviews });
        }
      } catch (err) {
        console.error(`Fetch reviews failed for ${gameName}:`, err);
      }
    },
    [updateGame]
  );

  const addGame = useCallback((game: Game) => {
    const id = game.id || generateId();
    setGames((prev) => [...prev, { ...game, id }]);
    // IGDB metadata is now lazy: GamePage calls enrichGameMetadata on mount
    // for any game that lacks a description. This avoids the wasteful fan-out
    // that used to trigger hundreds of IGDB calls during Steam sync.
  }, []);

  const addGames = useCallback((newGames: Game[]) => {
    const withIds = newGames.map((g) => ({ ...g, id: g.id || generateId() }));
    setGames((prev) => [...prev, ...withIds]);
    // IGDB metadata is now lazy: GamePage calls enrichGameMetadata on mount
    // for any game that lacks a description. This avoids the wasteful fan-out
    // that triggered hundreds of IGDB calls during Steam sync even in
    // sequential mode. For a 500-game Steam library, this saves ~4 minutes
    // of background fetching; users only see IGDB work for games they
    // actually open.
  }, []);

  const removeGame = useCallback((id: string) => {
    setGames((prev) => prev.filter((g) => g.id !== id));
    setSelectedGameId((current) => (current === id ? null : current));
  }, []);

  const getGame = useCallback(
    (id: string) => games.find((g) => g.id === id),
    [games]
  );

  const forceCloseGame = useCallback(async (game: Game) => {
    try {
      const result = await invoke<{ pid: number; killed: boolean }>(
        "force_close_game",
        { gameId: game.id }
      );
      // Three distinct outcomes per the backend contract:
      //   - killed=true: process was actually terminated. Success toast.
      //   - killed=false with pid > 0: session cleared but the
      //     terminate call was refused (PID recycled, access denied).
      //     The session is no longer tracked so the running
      //     indicator WILL still clear via `game-exited`, but we
      //     surface the partial success so the user knows the game
      //     itself may still be running on disk.
      //   - pid == 0 (always killed=false): pending session (Steam
      //     protocol / UAC) — nothing to terminate. Treat as success.
      if (result.killed) {
        showToast(`Force closed ${game.name}`, "success");
      } else if (result.pid > 0) {
        showToast(
          `Ended session for ${game.name} — the game process may still be running. Close it manually if needed.`,
          "warning"
        );
      } else {
        showToast(`Force closed ${game.name}`, "success");
      }
    } catch (err) {
      showToast(`Failed to force close ${game.name}: ${err}`, "error");
    }
  }, [showToast]);

  const launchGame = useCallback(async (game: Game) => {
    if (runningGameIds.includes(game.id)) {
      showToast(`${game.name} is already running`, "info");
      return;
    }

    // Resolve the selected GPU from localStorage
    let gpuId: string | null = null;
    let gpuName: string | null = null;
    const savedGpu = localStorage.getItem("gamelib-gpus");
    const savedGpuId = localStorage.getItem("gamelib-selected-gpu");
    if (savedGpu && savedGpuId) {
      try {
        const gpus = JSON.parse(savedGpu);
        const selected = gpus.find((g: any) => g.id === savedGpuId);
        if (selected) {
          gpuId = selected.id;
          gpuName = selected.name;
        }
      } catch (e) {
        console.error("Failed to parse selected GPU from storage", e);
      }
    }

    // Show the launch splash if the user has it enabled
    const splashOn = isSplashEnabled();
    if (splashOn) {
      const lastSession = getLastPersistedSession(game.id);
      const payload: SplashPayload = { game, lastSession };
      splash.open(payload);
    }

    setRunningGameIds((prev) => [...prev, game.id]);

    // Stamp lastPlayed immediately so the game surfaces in the
    // "Continue Playing" rail even before the session ends. If the
    // backend later emits a game-exited event, the timestamp will be
    // refined to the actual finish time.
    setGames((prev) =>
      prev.map((g) =>
        g.id === game.id ? { ...g, lastPlayed: Date.now() } : g
      )
    );

    try {
      // ── Unified launch: single Tauri command for all game types ──────
      // The Rust backend handles:
      //   * Direct exe spawn (Local games, Steam with known path)
      //   * steam:// protocol (Steam without local exe)
      //   * Process lifecycle tracking via GameWatcher background poll
      //   * Metrics collection (starts automatically when PID is known)
      await invoke<string>("launch_game", {
        gameId: game.id,
        gameName: game.name,
        gamePath: game.path || "",
        platform: game.platform,
        steamAppId: game.steamAppId ?? null,
        gpuId,
        gpuName,
        launchArguments: game.launchArguments || null,
        runAsAdmin: game.runAsAdmin || null,
      });

      if (splashOn) splash.updateStatus("started");
      showToast(`Launched ${game.name}`, "success");
    } catch (err: any) {
      setRunningGameIds((prev) => prev.filter((id) => id !== game.id));
      if (splashOn) splash.updateStatus("error");
      showToast(`Launch failed: ${err}`, "error");
    }
  }, [runningGameIds, showToast, splash]);

  const addStoreGame = useCallback(async (metadata: GameMetadataResult): Promise<string> => {
    // Duplicate check — normalized name comparison
    const normName = metadata.title.toLowerCase().trim();
    const existing = games.find(
      (g) => g.name.toLowerCase().trim() === normName
    );
    if (existing) {
      showToast(`${metadata.title} is already in your library`, "info");
      return existing.id;
    }

    // Download all images to base64 for offline use
    const imageData = await fetchAllImages(metadata.images);

    const newGame: Game = {
      id: generateId(),
      name: metadata.title,
      path: "",
      platform: "Store",
      installed: false,
      playTime: "0h",
      addedAt: Date.now(),
      coverArtUrl: imageData.coverArtUrl,
      iconUrl: undefined,
      bannerUrl: imageData.bannerUrl,
      logoUrl: imageData.logoUrl,
      description: metadata.description ?? undefined,
      developer: metadata.developer ?? undefined,
      publisher: metadata.publisher ?? undefined,
      releaseDate: metadata.releaseDate ?? undefined,
      genres: metadata.genres.length > 0 ? metadata.genres : undefined,
      storyline: metadata.storyline,
      igdbRating: metadata.igdbRating ?? undefined,
      criticRating: metadata.criticRating ?? undefined,
      themes: metadata.themes ?? undefined,
      gameModes: metadata.gameModes ?? undefined,
      playerPerspectives: metadata.playerPerspectives ?? undefined,
      screenshots: metadata.screenshots ?? undefined,
      videos: metadata.videos ?? undefined,
      websites: metadata.websites ?? undefined,
      timeToBeat: metadata.timeToBeat ?? undefined,
      similarGames: metadata.similarGames ?? undefined,
      releases: metadata.releases ?? undefined,
      igdbReviews: metadata.igdbReviews ?? undefined,
      alternativeNames: metadata.alternativeNames ?? undefined,
      collection: metadata.collection ?? undefined,
      collectionId: metadata.collectionId,
      franchise: metadata.franchise ?? undefined,
      gameCategory: metadata.gameCategory ?? undefined,
      releaseStatus: metadata.releaseStatus ?? undefined,
      languageSupports: metadata.languageSupports ?? undefined,
      metadataSource: metadata.sourceName,
      metadataUrl: metadata.sourceUrl,
    };

    setGames((prev) => [...prev, newGame]);
    showToast(`Added ${metadata.title} to your library`, "success");

    // Kick off a background review fetch so reviews are ready when the user
    // opens the Reviews tab. The store metadata doesn't carry a Steam app id,
    // so the backend will look one up by name.
    fetchGameReviews(newGame.id, newGame.name).catch((err) =>
      console.error("Background review fetch on add failed:", err)
    );

    return newGame.id;
  }, [games, showToast, fetchGameReviews]);

  const importLocalGames = useCallback(async (
    items: { path: string; metadata: GameMetadataResult | null }[]
  ) => {
    const imported: Game[] = [];
    for (const item of items) {
      const pathNorm = item.path.toLowerCase().trim();
      const duplicate = games.find((g) => g.path.toLowerCase().trim() === pathNorm);
      if (duplicate) {
        continue;
      }

      let newGame: Game;
      if (item.metadata) {
        const imageData = await fetchAllImages(item.metadata.images);
        newGame = {
          id: generateId(),
          name: item.metadata.title,
          path: item.path,
          platform: "Local",
          installed: true,
          playTime: "0h",
          addedAt: Date.now(),
          coverArtUrl: imageData.coverArtUrl,
          bannerUrl: imageData.bannerUrl,
          logoUrl: imageData.logoUrl,
          description: item.metadata.description ?? undefined,
          developer: item.metadata.developer ?? undefined,
          publisher: item.metadata.publisher ?? undefined,
          releaseDate: item.metadata.releaseDate ?? undefined,
          genres: item.metadata.genres.length > 0 ? item.metadata.genres : undefined,
          storyline: item.metadata.storyline,
          igdbRating: item.metadata.igdbRating ?? undefined,
          criticRating: item.metadata.criticRating ?? undefined,
          themes: item.metadata.themes ?? undefined,
          gameModes: item.metadata.gameModes ?? undefined,
          playerPerspectives: item.metadata.playerPerspectives ?? undefined,
          screenshots: item.metadata.screenshots ?? undefined,
          videos: item.metadata.videos ?? undefined,
          websites: item.metadata.websites ?? undefined,
          timeToBeat: item.metadata.timeToBeat ?? undefined,
          similarGames: item.metadata.similarGames ?? undefined,
          releases: item.metadata.releases ?? undefined,
          igdbReviews: item.metadata.igdbReviews ?? undefined,
          alternativeNames: item.metadata.alternativeNames ?? undefined,
          collection: item.metadata.collection ?? undefined,
          collectionId: item.metadata.collectionId,
          franchise: item.metadata.franchise ?? undefined,
          gameCategory: item.metadata.gameCategory ?? undefined,
          releaseStatus: item.metadata.releaseStatus ?? undefined,
          languageSupports: item.metadata.languageSupports ?? undefined,
          metadataSource: item.metadata.sourceName,
          metadataUrl: item.metadata.sourceUrl,
        };
      } else {
        newGame = {
          id: generateId(),
          name: gameNameFromPath(item.path),
          path: item.path,
          platform: "Local",
          installed: true,
          playTime: "0h",
          addedAt: Date.now(),
        };
      }
      imported.push(newGame);
    }

    if (imported.length > 0) {
      setGames((prev) => [...prev, ...imported]);
      showToast(`Imported ${imported.length} game${imported.length !== 1 ? "s" : ""}`, "success");

      // Kick off background review fetches so the Reviews tab is populated
      // when the user opens it. Each import is a potential "game added"
      // event per the spec.
      for (const game of imported) {
        const steamAppId = extractSteamAppId(game.path) ?? undefined;
        fetchGameReviews(game.id, game.name, steamAppId).catch((err: unknown) =>
          console.error(`Background review fetch on import failed for ${game.name}:`, err)
        );
      }

      // Auto-size every locally-imported game in the background. We
      // delegate to the Rust `detect_game_size` Tauri command (same
      // path the Storage tab's Auto-detect button uses); on success
      // we patch the Game record in-place via `updateGame` so the
      // Storage tab picks up the new size the next time it mounts.
      //
      // Failures are silent (per-game) so a single bad path can't
      // poison the batch — the user can always click "Set size" /
      // "Auto-detect" on the Storage row to retry manually.
      for (const game of imported) {
        if (!game.path) continue;
        invoke<{ sizeBytes: number; rootPath: string }>("detect_game_size", {
          exePath: game.path,
          gameName: game.name,
          rootOverride: null,
        })
          .then((result) => {
            if (result && result.sizeBytes > 0) {
              updateGame(game.id, {
                sizeBytes: result.sizeBytes,
                sizeRootPath: result.rootPath,
                sizeDetectedAt: new Date().toISOString(),
              });
            }
          })
          .catch((err: unknown) => {
            // Per-game failure is non-fatal — just log so the user
            // can debug if the Storage tab shows "Not set" later.
            console.warn(`Auto-size on import failed for ${game.name}:`, err);
          });
      }
    } else {
      showToast("No new games were imported", "info");
    }
  }, [games, showToast, fetchGameReviews, updateGame]);

  return (
    <GameContext.Provider
      value={{
        games,
        selectedGameId,
        setSelectedGameId,
        addGame,
        addGames,
        removeGame,
        updateGame,
        getGame,
        runningGameIds,
        launchGame,
        forceCloseGame,
        addStoreGame,
        importLocalGames,
        fetchGameReviews,
        enrichGameMetadata,
      }}
    >
      {children}
    </GameContext.Provider>
  );
}

export function useGames(): GameContextType {
  const ctx = useContext(GameContext);
  if (!ctx) {
    throw new Error("useGames must be used within a GameProvider");
  }
  return ctx;
}
