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
import { openUrl } from "@tauri-apps/plugin-opener";
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
        if (data.length > 0) setGames(data);
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
      const { gameId, elapsedSeconds } = event.payload;

      // Remove from running games list
      setRunningGameIds((prev) => prev.filter((id) => id !== gameId));

      // Update session playtime
      setGames((prev) =>
        prev.map((g) =>
          g.id === gameId
            ? { ...g, playTime: addSessionTime(g.playTime, elapsedSeconds) }
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
        return;
      }
      // Prefer IGDB for its richer metadata (timeToBeat, criticRating, themes,
      // screenshots, videos, etc.) — Steam and LaunchBox only provide basics.
      const meta = results.find((r) => r.sourceName === "IGDB") ?? results[0];
      const images = await fetchAllImages(meta.images);
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
        metadataSource: meta.sourceName,
        metadataUrl: meta.sourceUrl,
      });
      console.log(`Enriched ${gameName} via ${meta.sourceName}`);

      // Background review load happens lazily via ReviewsTab on first open,
      // so we don't need to seed it here. This also avoids TDZ ordering
      // issues with fetchGameReviews's useCallback declaration below.
    } catch (err) {
      console.error("enrichGameMetadata failed:", err);
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

  const launchGame = useCallback(async (game: Game) => {
    if (runningGameIds.includes(game.id)) {
      showToast(`${game.name} is already running`, "info");
      return;
    }

    // Resolve the selected GPU ONCE up front — both the Steam watcher
    // and the local-game launcher need to pass it to the Rust metrics
    // collector so performance monitoring picks up the right device.
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

    // Show the launch splash if the user has it enabled. The setting
    // is read fresh on every launch so a Settings toggle takes effect
    // immediately without needing a remount.
    const splashOn = isSplashEnabled();
    if (splashOn) {
      const lastSession = getLastPersistedSession(game.id);
      const payload: SplashPayload = { game, lastSession };
      splash.open(payload);
    }

    // Steam games launch via steam:// protocol — no local executable
    // handle, so we delegate lifetime tracking to the Rust watcher.
    // It polls for the running game process via WMI, collects real
    // metrics, and emits the same `game-exited` event the Local/Store
    // launch path uses — so playTime deltas and ActivityContext
    // sessions work the same way for Steam titles.
    if (game.platform === "Steam" && game.steamAppId) {
      setRunningGameIds((prev) => [...prev, game.id]);

      try {
        await openUrl(`steam://run/${game.steamAppId}`);
        if (splashOn) splash.updateStatus("started");
        showToast(`Launched ${game.name} via Steam`, "success");

        // Replaces the previous hardcoded 300 s placeholder emit —
        // the watcher emits game-exited with real elapsedSeconds +
        // SessionMetrics once the game's process actually closes.
        invoke<void>("watch_steam_game", {
          gameId: game.id,
          steamAppId: game.steamAppId,
          gpuId,
          gpuName,
        }).catch((err: unknown) => {
          // Watcher failed to start (Steam install dir missing,
          // WMI unavailable, etc.). Clear running state so the play
          // button re-enables, and surface the error.
          console.error(`Steam session watch failed: ${err}`);
          setRunningGameIds((prev) => prev.filter((id) => id !== game.id));
          showToast(`Steam session tracking unavailable: ${err}`, "error");
        });
      } catch (err: any) {
        setRunningGameIds((prev) => prev.filter((id) => id !== game.id));
        if (splashOn) splash.updateStatus("error");
        showToast(`Launch failed: ${err}`, "error");
      }
      return;
    }

    setRunningGameIds((prev) => [...prev, game.id]);

    try {
      await invoke("launch_game", {
        gameId: game.id,
        gamePath: game.path,
        gpuId,
        gpuName
      });
      // Flip the splash status pill from "Launching…" to "Game is
      // launching" once the OS process is up. The splash itself
      // schedules its fade + close when it sees this status.
      if (splashOn) splash.updateStatus("started");
      showToast(`Launched ${game.name}`, "success");
    } catch (err: any) {
      setRunningGameIds((prev) => prev.filter((id) => id !== game.id));
      if (splashOn) {
        splash.updateStatus("error");
      }
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
    } else {
      showToast("No new games were imported", "info");
    }
  }, [games, showToast, fetchGameReviews]);

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
