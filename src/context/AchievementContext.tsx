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
import { useGames } from "./GameContext";
import { useToast } from "./ToastContext";
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
  /**
   * Track achievements for cracked / downloaded (non-Steam) games by
   * watching local crack/emulator achievement files. Mirrored to the
   * Rust background watcher.
   */
  localAchievementsEnabled: boolean;
}

const DEFAULT_SETTINGS: AchievementSettings = {
  autoSyncOnSteamSync: true,
  showLockedDescriptions: true,
  notifyOnUnlock: true,
  localAchievementsEnabled: true,
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
  /**
   * Sync achievements for a single game from local crack/emulator files
   * (schema from the Hydra API). Works for non-Steam / cracked games.
   * An optional `steamAppId` override is used when the game row doesn't
   * yet have one persisted.
   */
  syncLocalAchievements: (gameId: string, steamAppId?: number) => Promise<void>;
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
  /** Reload the achievements cache from disk. */
  reloadCache: () => Promise<void>;
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

  const { showToast } = useToast();

  const syncLocalAchievements = useCallback(
    async (gameId: string, steamAppId?: number) => {
      const data: GameAchievementData = await invoke("sync_local_achievements", {
        gameId,
        steamAppId: steamAppId ?? null,
      });
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
    [persistCache]
  );

  const updateSettings = useCallback(
    (updates: Partial<AchievementSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...updates };
        saveSettings(next);
        // Mirror the local-achievement toggle to the Rust watcher.
        if (
          updates.localAchievementsEnabled !== undefined &&
          updates.localAchievementsEnabled !== prev.localAchievementsEnabled
        ) {
          invoke("set_local_achievements_enabled", {
            enabled: updates.localAchievementsEnabled,
          }).catch((err) =>
            console.warn(
              "[AchievementContext] Failed to set local achievements flag:",
              err
            )
          );
        }
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

  const reloadCache = useCallback(async () => {
    try {
      const raw: string = await invoke("load_achievements_cache");
      if (raw) {
        const parsed = JSON.parse(raw) as AchievementsCache;
        if (parsed && parsed.games) {
          setCache(parsed);
        }
      }
    } catch (err) {
      console.warn("[AchievementContext] Failed to reload cache:", err);
    }
  }, []);

  // Listen for game-exited events to automatically sync achievements for that game
  const { games } = useGames();
  const gamesRef = useRef(games);
  useEffect(() => {
    gamesRef.current = games;
  }, [games]);

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    const unlisten = listen<{ gameId: string }>("game-exited", async (event) => {
      const { gameId } = event.payload;
      const game = gamesRef.current.find((g) => g.id === gameId);
      if (!game) return;

      // Owned Steam games → authoritative Steam Web API sync.
      if (game.steamAppId && game.platform === "Steam") {
        try {
          await syncGameAchievements(game.id, game.steamAppId);
          console.log(`[AchievementContext] Auto-synced Steam achievements for ${game.name} on exit`);
        } catch (err) {
          console.warn(`[AchievementContext] Failed to auto-sync Steam achievements on exit for ${game.name}:`, err);
        }
      }

      // Non-Steam games with a Steam AppID (cracked / downloaded) → scan
      // local crack/emulator achievement files. Owned Steam games are
      // covered by the authoritative Steam sync above.
      if (
        game.steamAppId &&
        game.platform !== "Steam" &&
        settingsRef.current.localAchievementsEnabled
      ) {
        try {
          await syncLocalAchievements(game.id);
          console.log(`[AchievementContext] Synced local achievements for ${game.name} on exit`);
        } catch (err) {
          console.warn(`[AchievementContext] Failed to sync local achievements on exit for ${game.name}:`, err);
        }
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [syncGameAchievements, syncLocalAchievements]);

  // Backend watcher events: reload the affected game's cache, and toast
  // on newly-unlocked achievements.
  useEffect(() => {
    const unlistenUpdated = listen<{ gameId: string }>(
      "achievements-updated",
      () => {
        reloadCache();
      }
    );
    const unlistenUnlocked = listen<{
      gameId: string;
      gameName: string;
      achievements: { displayName: string; icon: string; isRare: boolean }[];
    }>("achievement-unlocked", (event) => {
      if (!settingsRef.current.notifyOnUnlock) return;
      const { gameName, achievements } = event.payload;
      if (!achievements?.length) return;
      const label =
        achievements.length === 1
          ? `🏆 ${achievements[0].displayName} unlocked in ${gameName}`
          : `🏆 ${achievements.length} achievements unlocked in ${gameName}`;
      showToast(label, "success");
    });

    return () => {
      unlistenUpdated.then((fn) => fn());
      unlistenUnlocked.then((fn) => fn());
    };
  }, [reloadCache, showToast]);

  // Push the persisted local-achievement toggle to the Rust watcher on
  // startup so the two stay in sync across restarts.
  useEffect(() => {
    invoke("set_local_achievements_enabled", {
      enabled: settingsRef.current.localAchievementsEnabled,
    }).catch(() => {});
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AchievementContext.Provider
      value={{
        cache,
        getGameAchievements,
        syncGameAchievements,
        syncLocalAchievements,
        syncAllAchievements,
        isSyncing,
        syncProgress,
        settings,
        updateSettings,
        clearCache,
        reloadCache,
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
