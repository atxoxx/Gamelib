import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useGames } from "./GameContext";
import {
  type GameSession,
  type SessionMetrics,
  type ActivityStats,
  type GpuInfo,
  type Game,
} from "../types/game";

interface GameExitEvent {
  gameId: string;
  elapsedSeconds: number;
  metrics?: SessionMetrics;
}

interface ActivityContextType {
  sessions: GameSession[];
  selectedGpu: GpuInfo | null;
  availableGpus: GpuInfo[];
  setSelectedGpu: (gpu: GpuInfo | null) => void;
  refreshGpus: () => Promise<void>;
  getGameSessions: (gameId: string) => GameSession[];
  getAllStats: () => ActivityStats;
  getGameStats: (gameId: string) => ActivityStats;
  recordSession: (gameId: string, gameName: string, durationMin: number, metrics?: SessionMetrics) => void;
}

const ActivityContext = createContext<ActivityContextType | null>(null);

export function ActivityProvider({ children }: { children: ReactNode }) {
  const { games } = useGames();
  const [sessions, setSessions] = useState<GameSession[]>([]);
  const [availableGpus, setAvailableGpus] = useState<GpuInfo[]>([]);
  const [selectedGpu, setSelectedGpu] = useState<GpuInfo | null>(null);
  const initializedRef = useRef(false);

  // Keep a ref to selectedGpu so the event listener always sees the latest value
  const selectedGpuRef = useRef<GpuInfo | null>(null);

  // Initialize sessions from localStorage and detect GPUs on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    // Load persisted sessions (no mock seeding — real data only)
    const saved = localStorage.getItem("gamelib-sessions");
    if (saved) {
      try {
        const parsed: GameSession[] = JSON.parse(saved);
        setSessions(parsed);
      } catch {
        // Corrupted data — start fresh
      }
    }

    // Load GPUs — try real detection first, fall back to cached data
    const savedGpus = localStorage.getItem("gamelib-gpus");
    let loadedGpus: GpuInfo[] = [];
    const loadGpus = async () => {
      try {
        // Try to detect real GPUs via the Rust backend
        const detected: GpuInfo[] = await invoke("detect_gpus");
        if (detected.length > 0) {
          loadedGpus = detected;
          setAvailableGpus(detected);
          localStorage.setItem("gamelib-gpus", JSON.stringify(detected));
        } else if (savedGpus) {
          loadedGpus = JSON.parse(savedGpus);
          setAvailableGpus(loadedGpus);
        }
      } catch {
        // Backend unavailable or non-Windows — use cached data
        if (savedGpus) {
          try {
            loadedGpus = JSON.parse(savedGpus);
            setAvailableGpus(loadedGpus);
          } catch {
            // corrupted data, leave empty
          }
        }
      }

      // Load selected GPU after GPUs are available
      const savedGpuId = localStorage.getItem("gamelib-selected-gpu");
      if (savedGpuId && loadedGpus.length > 0) {
        const found = loadedGpus.find((g) => g.id === savedGpuId);
        if (found) {
          setSelectedGpu(found);
          selectedGpuRef.current = found;
        }
      }
    };
    loadGpus();
  }, []);

  // Sync selectedGpu to ref
  useEffect(() => {
    selectedGpuRef.current = selectedGpu;
  }, [selectedGpu]);

  // ─── Listen for game-exited events to automatically record sessions ──────
  useEffect(() => {
    const unlisten = listen<GameExitEvent>("game-exited", (event) => {
      const { gameId, elapsedSeconds, metrics } = event.payload;
      const game = games.find((g) => g.id === gameId);
      if (!game) return;

      const durationMin = Math.round(elapsedSeconds / 60);
      if (durationMin < 1) return; // Ignore sessions shorter than 1 minute

      recordSession(gameId, game.name, durationMin, metrics);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [games]);

  // Persist sessions
  const persistSessions = useCallback((s: GameSession[]) => {
    localStorage.setItem("gamelib-sessions", JSON.stringify(s));
  }, []);

  const recordSession = useCallback(
    (gameId: string, gameName: string, durationMin: number, metrics?: SessionMetrics) => {
      const newSession: GameSession = {
        id: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        gameId,
        gameName,
        date: new Date().toISOString(),
        durationMin,
        metrics,
      };
      setSessions((prev) => {
        const updated = [newSession, ...prev];
        persistSessions(updated);
        return updated;
      });
    },
    [persistSessions]
  );

  const getGameSessions = useCallback(
    (gameId: string) => sessions.filter((s) => s.gameId === gameId),
    [sessions]
  );

  const handleSetSelectedGpu = useCallback(
    (gpu: GpuInfo | null) => {
      setSelectedGpu(gpu);
      if (gpu) {
        localStorage.setItem("gamelib-selected-gpu", gpu.id);
      } else {
        localStorage.removeItem("gamelib-selected-gpu");
      }
    },
    []
  );

  const refreshGpus = useCallback(async () => {
    try {
      const detected: GpuInfo[] = await invoke("detect_gpus");
      setAvailableGpus(detected);
      localStorage.setItem("gamelib-gpus", JSON.stringify(detected));
    } catch (err) {
      console.error("Failed to refresh GPU list:", err);
    }
  }, []);

  // Compute aggregate stats
  const getAllStats = useCallback((): ActivityStats => {
    return computeStats(sessions, games);
  }, [sessions, games]);

  const getGameStats = useCallback(
    (gameId: string): ActivityStats => {
      return computeStats(sessions.filter((s) => s.gameId === gameId), games);
    },
    [sessions, games]
  );

  return (
    <ActivityContext.Provider
      value={{
        sessions,
        selectedGpu,
        availableGpus,
        setSelectedGpu: handleSetSelectedGpu,
        refreshGpus,
        getGameSessions,
        getAllStats,
        getGameStats,
        recordSession,
      }}
    >
      {children}
    </ActivityContext.Provider>
  );
}

export function useActivity(): ActivityContextType {
  const ctx = useContext(ActivityContext);
  if (!ctx) {
    throw new Error("useActivity must be used within an ActivityProvider");
  }
  return ctx;
}

// ─── Stats computation helper ────────────────────────────────────────────────

function computeStats(sessions: GameSession[], games: Game[]): ActivityStats {
  if (sessions.length === 0) {
    return {
      totalSessions: 0,
      totalPlayTimeMin: 0,
      avgSessionMin: 0,
      mostPlayedGame: "-",
      mostPlayedGameTimeMin: 0,
      dailyAvg: [0, 0, 0, 0, 0, 0, 0],
      dailyLabels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      weeklyAvg: [],
      weeklyLabels: [],
      genreBreakdown: [],
      platformBreakdown: [],
      avgFpsAll: 0,
      avgGpuAll: 0,
      avgCpuAll: 0,
    };
  }

  const totalPlayTimeMin = sessions.reduce((s, sess) => s + sess.durationMin, 0);
  const totalSessions = sessions.length;
  const avgSessionMin = Math.round(totalPlayTimeMin / totalSessions);

  // Most played game
  const gameMap = new Map<string, number>();
  sessions.forEach((s) => {
    gameMap.set(s.gameName, (gameMap.get(s.gameName) || 0) + s.durationMin);
  });
  let mostPlayedGame = "-";
  let mostPlayedGameTimeMin = 0;
  gameMap.forEach((mins, name) => {
    if (mins > mostPlayedGameTimeMin) {
      mostPlayedGameTimeMin = mins;
      mostPlayedGame = name;
    }
  });

  // Daily avg (last 7 days)
  const dailyAvg: number[] = [];
  const dailyLabels: string[] = [];
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const dEnd = new Date(d);
    dEnd.setHours(23, 59, 59, 999);
    const mins = sessions
      .filter((s) => {
        const sd = new Date(s.date);
        return sd >= d && sd <= dEnd;
      })
      .reduce((sum, s) => sum + s.durationMin, 0);
    dailyAvg.push(mins);
    dailyLabels.push(dayNames[d.getDay()]);
  }

  // Weekly avg (last 4 weeks)
  const weeklyAvg: number[] = [];
  const weeklyLabels: string[] = [];
  for (let i = 3; i >= 0; i--) {
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() - i * 7);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    const mins = sessions
      .filter((s) => {
        const sd = new Date(s.date);
        return sd >= weekStart && sd <= weekEnd;
      })
      .reduce((sum, s) => sum + s.durationMin, 0);
    weeklyAvg.push(mins);
    const monthDay = weekStart.getDate();
    const monthName = weekStart.toLocaleDateString(undefined, { month: "short" });
    weeklyLabels.push(`${monthName} ${monthDay}`);
  }

  // ─── Real genre & platform breakdown from GameContext ────────────────────

  // Pre-compute per-game playtime for efficient lookups
  const sessionGameIds = [...new Set(sessions.map((s) => s.gameId))];
  const gameIdToMinutes = new Map<string, number>();
  for (const gid of sessionGameIds) {
    gameIdToMinutes.set(gid, sessions.filter((s) => s.gameId === gid).reduce((sum, s) => sum + s.durationMin, 0));
  }

  // Genre breakdown — aggregate playtime by real game genres (no mock fallback)
  const genreMap = new Map<string, number>();
  for (const gid of sessionGameIds) {
    const game = games.find((g) => g.id === gid);
    const gMins = gameIdToMinutes.get(gid) || 0;
    if (game?.genres && game.genres.length > 0) {
      for (const genre of game.genres) {
        genreMap.set(genre, (genreMap.get(genre) || 0) + gMins);
      }
    }
  }
  const genreBreakdown = Array.from(genreMap.entries())
    .map(([genre, minutes]) => ({ genre, minutes }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 8);

  // Platform breakdown — aggregate playtime by real game platforms
  const platformMap = new Map<string, number>();
  for (const gid of sessionGameIds) {
    const game = games.find((g) => g.id === gid);
    if (game) {
      const platMins = gameIdToMinutes.get(gid) || 0;
      platformMap.set(game.platform, (platformMap.get(game.platform) || 0) + platMins);
    }
  }
  const platformBreakdown = Array.from(platformMap.entries())
    .map(([platform, minutes]) => ({ platform, minutes }))
    .sort((a, b) => b.minutes - a.minutes);

  // Average metrics across all sessions
  const sessionsWithMetrics = sessions.filter((s) => s.metrics);
  const avgFpsAll = sessionsWithMetrics.length > 0
    ? Math.round(sessionsWithMetrics.reduce((s, sess) => s + sess.metrics!.avgFps, 0) / sessionsWithMetrics.length)
    : 0;
  const avgGpuAll = sessionsWithMetrics.length > 0
    ? Math.round(sessionsWithMetrics.reduce((s, sess) => s + sess.metrics!.avgGpuUsage, 0) / sessionsWithMetrics.length)
    : 0;
  const avgCpuAll = sessionsWithMetrics.length > 0
    ? Math.round(sessionsWithMetrics.reduce((s, sess) => s + sess.metrics!.avgCpuUsage, 0) / sessionsWithMetrics.length)
    : 0;

  return {
    totalSessions,
    totalPlayTimeMin,
    avgSessionMin,
    mostPlayedGame,
    mostPlayedGameTimeMin,
    dailyAvg,
    dailyLabels,
    weeklyAvg,
    weeklyLabels,
    genreBreakdown,
    platformBreakdown,
    avgFpsAll,
    avgGpuAll,
    avgCpuAll,
  };
}
