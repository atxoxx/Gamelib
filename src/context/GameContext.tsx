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
import type { Game } from "../types/game";

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
}

const GameContext = createContext<GameContextType | null>(null);

let nextId = 1;
function generateId(): string {
  return `game-${Date.now()}-${nextId++}`;
}

export function GameProvider({ children }: { children: ReactNode }) {
  const [games, setGames] = useState<Game[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
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
