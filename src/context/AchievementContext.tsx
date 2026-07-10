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
import type {
  Game,
  GameAchievementData,
  AchievementsCache,
} from "../types/game";

// ── Settings persistence ────────────────────────────────────────────────

export interface AchievementSettings {
  /** Auto-sync achievements when Steam library syncs. */
  autoSyncOnSteamSync: boolean;
  /** Show descriptions for locked achievements (vs "Hidden achievement"). */
  showLockedDescriptions: boolean;
  /** Show toast when a newly unlocked achievement is detected. */
  notifyOnUnlock: boolean;
}

const DEFAULT_SETTINGS: AchievementSettings = {
  autoSyncOnSteamSync: true,
  showLockedDescriptions: true,
  notifyOnUnlock: true,
};

const SETTINGS_KEY = "gamelib-achievement-settings";

function loadSettings(): AchievementSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(s: AchievementSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

// ── Context type ────────────────────────────────────────────────────────

interface AchievementContextType {
  /** Full achievements cache (all games). */
  cache: AchievementsCache;
  /** Get achievements for a specific game. */
  getGameAchievements: (gameId: string) => GameAchievementData | null;
  /** Fetch achievements for a single game from Steam and update cache. */
  syncGameAchievements: (gameId: string, steamAppId: number) => Promise<void>;
  /** Bulk-sync achievements for all Steam games in the library. */
  syncAllAchievements: (games: Game[]) => Promise<void>;
  /** Whether a sync operation is in progress. */
  isSyncing: boolean;
  /** Progress of a bulk sync operation. */
  syncProgress: { current: number; total: number } | null;
  /** Achievement settings. */
  settings: AchievementSettings;
  /** Update achievement settings. */
  updateSettings: (updates: Partial<AchievementSettings>) => void;
  /** Clear the entire achievements cache. */
  clearCache: () => Promise<void>;
}

const AchievementContext = createContext<AchievementContextType | null>(null);

// ── Provider ────────────────────────────────────────────────────────────

export function AchievementProvider({ children }: { children: ReactNode }) {
  const [cache, setCache] = useState<AchievementsCache>({ games: {} });
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [settings, setSettings] = useState<AchievementSettings>(loadSettings);

  // Debounce saves to disk
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load cache from disk on mount
  useEffect(() => {
    (async () => {
      try {
        const raw: string = await invoke("load_achievements_cache");
        if (raw) {
          const parsed = JSON.parse(raw) as AchievementsCache;
          if (parsed && parsed.games) {
            setCache(parsed);
          }
        }
      } catch (err) {
        console.warn("[AchievementContext] Failed to load cache:", err);
      }
    })();
  }, []);

  // Persist cache to disk (debounced)
  const persistCache = useCallback((newCache: AchievementsCache) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await invoke("save_achievements_cache", {
          data: JSON.stringify(newCache),
        });
      } catch (err) {
        console.warn("[AchievementContext] Failed to save cache:", err);
      }
    }, 1000);
  }, []);

  const getGameAchievements = useCallback(
    (gameId: string): GameAchievementData | null => {
      return cache.games[gameId] ?? null;
    },
    [cache]
  );

  const getSteamSession = useCallback(async () => {
    try {
      const session = await invoke<{
        steamId: string;
        webApiToken: string;
      } | null>("steam_get_session");
      return session;
    } catch {
      return null;
    }
  }, []);

  const syncGameAchievements = useCallback(
    async (gameId: string, steamAppId: number) => {
      const session = await getSteamSession();
      if (!session) {
        throw new Error("Not connected to Steam. Please log in via Settings.");
      }

      const data: GameAchievementData = await invoke("fetch_achievements", {
        steamAppId,
        steamId: session.steamId,
        apiToken: session.webApiToken,
      });

      // Stamp sync time
      data.lastSynced = Date.now();

      setCache((prev) => {
        const updated = {
          ...prev,
          games: { ...prev.games, [gameId]: data },
        };
        persistCache(updated);
        return updated;
      });
    },
    [getSteamSession, persistCache]
  );

  const syncAllAchievements = useCallback(
    async (games: Game[]) => {
      const steamGames = games.filter((g) => g.steamAppId && g.platform === "Steam");
      if (steamGames.length === 0) return;

      const session = await getSteamSession();
      if (!session) {
        throw new Error("Not connected to Steam. Please log in via Settings.");
      }

      setIsSyncing(true);
      setSyncProgress({ current: 0, total: steamGames.length });

      const updatedGames: Record<string, GameAchievementData> = { ...cache.games };
      let current = 0;

      for (const game of steamGames) {
        try {
          const data: GameAchievementData = await invoke("fetch_achievements", {
            steamAppId: game.steamAppId!,
            steamId: session.steamId,
            apiToken: session.webApiToken,
          });
          data.lastSynced = Date.now();
          updatedGames[game.id] = data;
        } catch (err) {
          console.warn(
            `[AchievementContext] Failed to sync ${game.name}:`,
            err
          );
        }
        current++;
        setSyncProgress({ current, total: steamGames.length });

        // Rate limit: Steam API allows ~100k/day but can 429 on bursts.
        // 300ms between requests ≈ 3.3 req/s — well within limits.
        if (current < steamGames.length) {
          await new Promise((r) => setTimeout(r, 300));
        }
      }

      const newCache: AchievementsCache = { games: updatedGames };
      setCache(newCache);
      persistCache(newCache);
      setIsSyncing(false);
      setSyncProgress(null);
    },
    [cache, getSteamSession, persistCache]
  );

  const updateSettings = useCallback(
    (updates: Partial<AchievementSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...updates };
        saveSettings(next);
        return next;
      });
    },
    []
  );

  const clearCache = useCallback(async () => {
    const empty: AchievementsCache = { games: {} };
    setCache(empty);
    try {
      await invoke("save_achievements_cache", {
        data: JSON.stringify(empty),
      });
    } catch (err) {
      console.warn("[AchievementContext] Failed to clear cache:", err);
    }
  }, []);

  return (
    <AchievementContext.Provider
      value={{
        cache,
        getGameAchievements,
        syncGameAchievements,
        syncAllAchievements,
        isSyncing,
        syncProgress,
        settings,
        updateSettings,
        clearCache,
      }}
    >
      {children}
    </AchievementContext.Provider>
  );
}

/** Hook to access the achievements context. */
export function useAchievements() {
  const ctx = useContext(AchievementContext);
  if (!ctx) {
    throw new Error("useAchievements must be used within AchievementProvider");
  }
  return ctx;
}
