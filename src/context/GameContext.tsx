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
import { addSessionTime, gameNameFromPath } from "../types/game";
import type { Game, GameMetadataResult } from "../types/game";
import { useToast } from "./ToastContext";

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
}

const GameContext = createContext<GameContextType | null>(null);

let nextId = 1;
function generateId(): string {
  return `game-${Date.now()}-${nextId++}`;
}

export function GameProvider({ children }: { children: ReactNode }) {
  const { showToast } = useToast();
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

  /** Auto-fetch IGDB metadata and images for a newly imported game. */
  async function autoFetchMetadata(gameId: string, gameName: string) {
    try {
      const results: GameMetadataResult[] = await invoke("search_game_metadata", { gameName });
      if (results.length === 0) return;
      const meta = results[0];
      const images = await fetchAllImages(meta.images);
      updateGame(gameId, {
        description: meta.description ?? undefined,
        developer: meta.developer ?? undefined,
        publisher: meta.publisher ?? undefined,
        releaseDate: meta.releaseDate ?? undefined,
        genres: meta.genres.length > 0 ? meta.genres : undefined,
        coverArtUrl: images.coverArtUrl,
        bannerUrl: images.bannerUrl,
        logoUrl: images.logoUrl,
        igdbRating: meta.igdbRating ?? undefined,
        criticRating: meta.criticRating ?? undefined,
        themes: meta.themes ?? undefined,
        gameModes: meta.gameModes ?? undefined,
        playerPerspectives: meta.playerPerspectives ?? undefined,
        screenshots: meta.screenshots ?? undefined,
        videos: meta.videos ?? undefined,
        websites: meta.websites ?? undefined,
        timeToBeat: meta.timeToBeat ?? undefined,
        similarGames: meta.similarGames ?? undefined,
        releases: meta.releases ?? undefined,
        igdbReviews: meta.igdbReviews ?? undefined,
        metadataSource: meta.sourceName,
        metadataUrl: meta.sourceUrl,
      });
      showToast(`Fetched metadata for ${gameName} from ${meta.sourceName}`, "success");
    } catch (err) {
      console.error("Auto-fetch metadata failed:", err);
    }
  }

  const addGame = useCallback((game: Game) => {
    const id = game.id || generateId();
    const newGame = { ...game, id };
    setGames((prev) => [...prev, newGame]);

    // Auto-fetch metadata in the background for locally imported games
    if (game.path && !game.description) {
      autoFetchMetadata(id, game.name);
    }
  }, [showToast, updateGame]);

  const addGames = useCallback((newGames: Game[]) => {
    const withIds = newGames.map((g) => ({ ...g, id: g.id || generateId() }));
    setGames((prev) => [...prev, ...withIds]);

    // Auto-fetch metadata for each imported game in the background
    for (const game of withIds) {
      if (game.path && !game.description) {
        autoFetchMetadata(game.id, game.name);
      }
    }
  }, [showToast, updateGame]);

  const removeGame = useCallback((id: string) => {
    setGames((prev) => prev.filter((g) => g.id !== id));
    setSelectedGameId((current) => (current === id ? null : current));
  }, []);

  const getGame = useCallback(
    (id: string) => games.find((g) => g.id === id),
    [games]
  );

  const launchGame = useCallback((game: Game) => {
    if (runningGameIds.includes(game.id)) {
      showToast(`${game.name} is already running`, "info");
      return;
    }
    
    setRunningGameIds((prev) => [...prev, game.id]);
    
    let gpuId = null;
    let gpuName = null;
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
    
    invoke("launch_game", { 
      gameId: game.id, 
      gamePath: game.path,
      gpuId,
      gpuName
    })
      .then(() => {
        showToast(`Launched ${game.name}`, "success");
      })
      .catch((err: string) => {
        setRunningGameIds((prev) => prev.filter((id) => id !== game.id));
        showToast(`Launch failed: ${err}`, "error");
      });
  }, [runningGameIds, showToast]);

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
      metadataSource: metadata.sourceName,
      metadataUrl: metadata.sourceUrl,
    };

    setGames((prev) => [...prev, newGame]);
    showToast(`Added ${metadata.title} to your library`, "success");
    return newGame.id;
  }, [games, showToast]);

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
    } else {
      showToast("No new games were imported", "info");
    }
  }, [games, showToast]);

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
