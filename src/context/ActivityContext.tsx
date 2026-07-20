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
  sanitizeSessionMetrics,
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
  /** Total system RAM in GB, queried from the backend on mount. Used to
   *  convert RAM-usage percentages into absolute GB for the charts. Kept in
   *  React state (not localStorage) so the graph data carries no webview
   *  persistence dependency. */
  totalRamGb: number;
  setSelectedGpu: (gpu: GpuInfo | null) => void;
  refreshGpus: () => Promise<void>;
  getGameSessions: (gameId: string) => GameSession[];
  getAllStats: () => ActivityStats;
  getGameStats: (gameId: string) => ActivityStats;
  recordSession: () => void;
  deleteSession: (sessionId: string) => void;
}

const ActivityContext = createContext<ActivityContextType | null>(null);

// Shape of a `sessions` table row as returned by the backend. Mirrors
// the Rust `db::sessions::SessionRecord` serde mapping.
interface DbSessionRecord {
  id: number;
  gameId: string;
  gameName?: string | null;
  startedAt: number;
  endedAt?: number | null;
  elapsedSeconds?: number | null;
  avgFps?: number | null;
  avgCpu?: number | null;
  avgGpu?: number | null;
  avgRam?: number | null;
  metricsJson?: string | null;
}

// Map a SQLite session row to the frontend GameSession shape. Returns
// null for sub-minute sessions, which the old JSON store also excluded
// (recordSession dropped anything under 1 minute).
function mapDbSession(r: DbSessionRecord): GameSession | null {
  const elapsed = r.elapsedSeconds ?? 0;
  if (elapsed < 60) return null;
  const date = r.endedAt
    ? new Date(r.endedAt).toISOString()
    : new Date(r.startedAt).toISOString();
  const durationMin = Math.round(elapsed / 60);
  let metrics: SessionMetrics | undefined;
  if (r.metricsJson) {
    try {
      metrics = sanitizeSessionMetrics(JSON.parse(r.metricsJson) as SessionMetrics);
    } catch {
      // Fall through to reconstructing from the average columns.
    }
  }
  if (!metrics && r.avgFps != null) {
    metrics = {
      avgFps: r.avgFps,
      avgCpuUsage: r.avgCpu ?? 0,
      avgGpuUsage: r.avgGpu ?? 0,
      avgRamUsage: r.avgRam ?? 0,
      avgCpuTemp: 0,
      avgGpuTemp: 0,
      minFps: 0,
      maxFps: 0,
      resolution: "",
      samples: [],
    };
  }
  return {
    id: String(r.id),
    gameId: r.gameId,
    gameName: r.gameName ?? "",
    date,
    durationMin,
    metrics,
  };
}

// Import one legacy GameSession (from the old sessions.json / localStorage
// store) into the SQLite sessions table. Best-effort: a failure is logged
// and skipped so one bad row doesn't abort the whole migration.
async function importLegacySession(s: GameSession): Promise<void> {
  const startedAtMs = Date.parse(s.date) - s.durationMin * 60_000;
  const m = s.metrics;
  try {
    await invoke("insert_session", {
      gameId: s.gameId,
      gameName: s.gameName,
      startedAtMs: startedAtMs > 0 ? startedAtMs : Date.parse(s.date),
      elapsedSeconds: s.durationMin * 60,
      avgFps: m?.avgFps ?? null,
      avgCpu: m?.avgCpuUsage ?? null,
      avgGpu: m?.avgGpuUsage ?? null,
      avgRam: m?.avgRamUsage ?? null,
      metricsJson: m ? JSON.stringify(m) : null,
    });
  } catch (e) {
    console.error("Failed to import legacy session:", e);
  }
}

export function ActivityProvider({ children }: { children: ReactNode }) {
  const { games } = useGames();
  const [sessions, setSessions] = useState<GameSession[]>([]);
  const [availableGpus, setAvailableGpus] = useState<GpuInfo[]>([]);
  const [selectedGpu, setSelectedGpu] = useState<GpuInfo | null>(null);
  const [totalRamGb, setTotalRamGb] = useState<number>(16);
  const initializedRef = useRef(false);

  // Keep a ref to selectedGpu so the event listener always sees the latest value
  const selectedGpuRef = useRef<GpuInfo | null>(null);

  // Initialize sessions from SQLite and detect GPUs on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    // Load the canonical session history from the SQLite `sessions` table
    // (written atomically by the backend's `finish_session` on every game
    // exit). Each session's metrics are sanitized on read so legacy data
    // with poisoned FPS fields (maxFps = u32::MAX from older RTSS builds)
    // doesn't drive the charts into the 0x33/…/0xFF banding.
    //
    // One-time migration: if the DB is empty (fresh install or an upgrade
    // from the old `sessions.json` store), import any legacy history from
    // that file and the old `localStorage["gamelib-sessions"]` copy, then
    // stop touching them. We only import when the DB is empty to avoid
    // duplicating sessions the backend already recorded in parallel.
    const loadSessions = async () => {
      try {
        const records: DbSessionRecord[] = await invoke("get_sessions");
        const mapped = records
          .map(mapDbSession)
          .filter((s): s is GameSession => s !== null);
        if (mapped.length > 0) {
          setSessions(mapped);
          return;
        }
      } catch {
        // DB read failed — fall through to migration / fresh start.
      }

      const legacy: GameSession[] = [];
      try {
        const raw = (await invoke<string>("load_sessions")) || "[]";
        const parsed: GameSession[] = JSON.parse(raw);
        if (Array.isArray(parsed)) legacy.push(...parsed);
      } catch {
        // Corrupt legacy file — ignore.
      }
      if (legacy.length === 0) {
        const ls = localStorage.getItem("gamelib-sessions");
        if (ls) {
          try {
            const parsed: GameSession[] = JSON.parse(ls);
            if (Array.isArray(parsed)) legacy.push(...parsed);
          } catch {
            // Corrupt legacy data — ignore.
          }
        }
      }
      if (legacy.length > 0) {
        for (const s of legacy) {
          await importLegacySession(s);
        }
        localStorage.removeItem("gamelib-sessions");
        try {
          const records: DbSessionRecord[] = await invoke("get_sessions");
          const mapped = records
            .map(mapDbSession)
            .filter((s): s is GameSession => s !== null);
          setSessions(mapped);
        } catch {
          // Leave empty if the reload fails.
        }
      }
    };
    loadSessions();

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

      // Query total system RAM and hold it in React state (no localStorage).
      try {
        const totalRamGbResult = await invoke("get_system_ram_gb");
        if (typeof totalRamGbResult === "number" && totalRamGbResult > 0) {
          setTotalRamGb(totalRamGbResult);
        }
      } catch (e) {
        console.error("Failed to query total RAM from backend", e);
      }
    };
    loadGpus();
  }, []);

  // Sync selectedGpu to ref
  useEffect(() => {
    selectedGpuRef.current = selectedGpu;
  }, [selectedGpu]);

  // Reload the canonical session history from SQLite. The backend's
  // `finish_session` has already committed the new row before the
  // `game-exited` event fires, so a reload picks it up atomically —
  // no client-side JSON write, no risk of a truncated file.
  const reloadSessions = useCallback(async () => {
    try {
      const records: DbSessionRecord[] = await invoke("get_sessions");
      const mapped = records
        .map(mapDbSession)
        .filter((s): s is GameSession => s !== null);
      setSessions(mapped);
    } catch (e) {
      console.error("Failed to reload sessions:", e);
    }
  }, []);

  const recordSession = useCallback(async () => {
    // The backend is the sole writer; just refresh from the DB.
    await reloadSessions();
  }, [reloadSessions]);

  // ─── Refs for the game-exited listener ──────────────────────────────────
  // The Tauri event listener subscribes once on mount. Using refs ensures
  // the callback always reads the latest `games` array and `recordSession`
  // without tearing down / re-subscribing on every state change. This
  // eliminates the race condition where events were lost in the gap between
  // unsubscribe and re-subscribe — critical for Steam games whose watcher
  // thread runs for the entire play session (potentially hours).
  const gamesRef = useRef<Game[]>(games);
  useEffect(() => { gamesRef.current = games; }, [games]);

  const recordSessionRef = useRef(recordSession);
  useEffect(() => { recordSessionRef.current = recordSession; }, [recordSession]);

  // ─── Listen for game-exited events to automatically record sessions ──────
  useEffect(() => {
    const unlisten = listen<GameExitEvent>("game-exited", (event) => {
      const { gameId, elapsedSeconds } = event.payload;
      const game = gamesRef.current.find((g) => g.id === gameId);
      if (!game) return;

      const durationMin = Math.round(elapsedSeconds / 60);
      if (durationMin < 1) return; // Ignore sessions shorter than 1 minute

      recordSessionRef.current();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Subscribe once — refs keep values fresh

  const deleteSession = useCallback(
    async (sessionId: string) => {
      // Optimistic local removal; reconcile from the DB.
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      try {
        const id = parseInt(sessionId, 10);
        if (!Number.isNaN(id)) {
          await invoke("delete_session", { id });
        }
      } catch (e) {
        console.error("Failed to delete session:", e);
        // Reconcile so the UI reflects the real DB state.
        await reloadSessions();
      }
    },
    [reloadSessions]
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
        totalRamGb,
        setSelectedGpu: handleSetSelectedGpu,
        refreshGpus,
        getGameSessions,
        getAllStats,
        getGameStats,
        recordSession,
        deleteSession,
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
      topGames: [],
      longestSessionMin: 0,
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

  // Top played games — ranked by total playtime, with session counts
  const topGames = Array.from(gameMap.entries())
    .map(([gameName, minutes]) => {
      const gameSessions = sessions.filter((s) => s.gameName === gameName);
      const game = games.find((g) => g.name === gameName);
      return {
        gameId: game?.id ?? gameSessions[0]?.gameId ?? gameName,
        gameName,
        minutes,
        sessions: gameSessions.length,
      };
    })
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 10);

  // Longest single session
  const longestSessionMin = sessions.reduce(
    (max, s) => (s.durationMin > max ? s.durationMin : max),
    0
  );

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
    topGames,
    longestSessionMin,
    avgFpsAll,
    avgGpuAll,
    avgCpuAll,
  };
}
