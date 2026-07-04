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
import { addSessionTime } from "../types/game";
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

  const addGame = useCallback((game: Game) => {
    setGames((prev) => [...prev, { ...game, id: game.id || generateId() }]);
  }, []);

  const addGames = useCallback((newGames: Game[]) => {
    setGames((prev) => [
      ...prev,
      ...newGames.map((g) => ({ ...g, id: g.id || generateId() })),
    ]);
  }, []);

  const removeGame = useCallback((id: string) => {
    setGames((prev) => prev.filter((g) => g.id !== id));
    setSelectedGameId((current) => (current === id ? null : current));
  }, []);

  const updateGame = useCallback((id: string, updates: Partial<Game>) => {
    setGames((prev) =>
      prev.map((g) => (g.id === id ? { ...g, ...updates } : g))
    );
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

    // Download cover image to base64 for offline use
    let coverArtUrl: string | undefined;
    const coverUrl = metadata.images.cover;
    if (coverUrl) {
      try {
        const dataUrl: string | null = await invoke("download_image", { url: coverUrl });
        if (dataUrl) coverArtUrl = dataUrl;
      } catch {
        // Fall back to the remote URL if download fails
        coverArtUrl = coverUrl;
      }
    }

    const newGame: Game = {
      id: generateId(),
      name: metadata.title,
      path: "",
      platform: "Unknown",
      installed: false,
      playTime: "0h",
      addedAt: Date.now(),
      coverArtUrl,
      iconUrl: undefined,
      bannerUrl: metadata.images.hero ?? metadata.images.banner ?? undefined,
      logoUrl: metadata.images.logo ?? undefined,
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
