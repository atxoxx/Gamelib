// SettingsContext — single source of truth for every new
// user-configurable setting introduced in this drop. Consolidates both
// the Rust-backed launcher settings (close-to-tray, minimize-on-launch,
// disable UAC, OS auto-launch) and the localStorage-backed knobs
// (landing page, accent color, per-vendor sync intervals, Steam
// auto-detect, achievement privacy, Discord rich presence, player-
// count history retention cap, source domain blocklist) so the
// SettingsPage can read from a single hook and every consumer agrees
// on the value.
//
// Architecture: this is intentionally a "client-side" context. The
// localStorage values are mirrored to React state so renders stay
// fast (no async reads in render paths) and the writes update both
// the React state and the storage layer in the same tick so the two
// never disagree. The Rust-backed values are fetched once on mount
// and refreshed after every setter call; shared state with the
// backend is durable because the Rust commands persist each toggle
// to the kv_store on update (see lib.rs::set_*_enabled).
//
// The defaults match the design's "opt-in" stance: every new toggle
// is OFF by default so the upgrade is silent for existing users.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";

// ── LocalStorage keys (one per localStorage-backed setting) ─────────────────
//
// Append-only — never rename a key here without a migration. A
// existing user upgrading from an older build will simply see the
// default for the renamed setting, which is the safer failure mode
// (we never want to silently revert a user's intent).

const LS_LANDING_PAGE = "gamelib.landing_page";
const LS_ACCENT_COLOR = "gamelib.accent_color";
const LS_SYNC_INTERVAL = "gamelib.sync_interval_minutes";
const LS_STEAM_AUTO_DETECT = "gamelib.steam_auto_detect_enabled";
const LS_ACHIEVEMENT_PRIVACY = "gamelib.hide_achievement_progress";
const LS_DISCORD_PRESENCE = "gamelib.discord_rich_presence_enabled";
const LS_HISTORY_CAP_DAYS = "gamelib.player_count_history_cap_days";
const LS_BLOCKED_DOMAINS = "gamelib.blocked_source_domains";

// ── Public shape ─────────────────────────────────────────────────────────────

export type LandingPage =
  | "library"
  | "store"
  | "wishlist"
  | "deals"
  | "activity"
  | "achievements"
  | "downloads"
  | "storage"
  | "news"
  | "community";

export type SyncIntervalMinutes = 0 | 15 | 30 | 60 | 360 | 720 | 1440;

export interface SettingsContextValue {
  // ── Launcher (Rust-backed) ───────────────────────────────────────
  closeToTray: boolean;
  setCloseToTray: (next: boolean) => Promise<void>;
  minimizeOnLaunch: boolean;
  setMinimizeOnLaunch: (next: boolean) => Promise<void>;
  disableElevationPrompts: boolean;
  setDisableElevationPrompts: (next: boolean) => Promise<void>;
  autoStartEnabled: boolean;
  setAutoStartEnabled: (next: boolean) => Promise<void>;

  // ── LocalStorage-backed ─────────────────────────────────────────
  landingPage: LandingPage;
  setLandingPage: (next: LandingPage) => void;
  accentColor: string | null;
  setAccentColor: (next: string | null) => void;
  syncIntervalMinutes: SyncIntervalMinutes;
  setSyncIntervalMinutes: (next: SyncIntervalMinutes) => void;
  steamAutoDetect: boolean;
  setSteamAutoDetect: (next: boolean) => void;
  hideAchievementProgress: boolean;
  setHideAchievementProgress: (next: boolean) => void;
  discordRichPresence: boolean;
  setDiscordRichPresence: (next: boolean) => void;
  historyCapDays: 1 | 7 | 30;
  setHistoryCapDays: (next: 1 | 7 | 30) => void;
  blockedSourceDomains: string[];
  setBlockedSourceDomains: (next: string[]) => void;

  // True until the very first Rust-side fetch has resolved. Mirrors
  // SettingsPage's existing `steamAuthReady` gating pattern so a
  // remount doesn't show form-state with hydrated values before the
  // backend confirms them.
  ready: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

// ── localStorage helpers (try/catch around every read/write because
// private-browsing modes and some sandboxed contexts throw) ────────────────
function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
function lsGetJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
function lsSetJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

// ── Provider ────────────────────────────────────────────────────────────────

export function SettingsProvider({ children }: { children: ReactNode }) {
  // Rust-backed state ──────────────────────────────────────────────────────
  const [closeToTray, setCloseToTrayState] = useState(false);
  const [minimizeOnLaunch, setMinimizeOnLaunchState] = useState(false);
  const [disableElevationPrompts, setDisableElevationPromptsState] =
    useState(false);
  const [autoStartEnabled, setAutoStartEnabledState] = useState(false);
  const [ready, setReady] = useState(false);

  // Hydrate from the backend on mount. Cancelled flag protects the
  // mount-then-unmount case (StrictMode's double-mount in dev) from
  // calling setState after the component unmounts.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await invoke<{
          closeToTrayEnabled: boolean;
          minimizeOnLaunchEnabled: boolean;
          disableElevationPrompts: boolean;
        }>("get_launcher_settings");
        if (cancelled) return;
        setCloseToTrayState(s.closeToTrayEnabled);
        setMinimizeOnLaunchState(s.minimizeOnLaunchEnabled);
        setDisableElevationPromptsState(s.disableElevationPrompts);
      } catch {
        // Backend call failed (e.g. `npm run dev` in the browser
        // where the Tauri bridge isn't injected). Keep defaults on
        // the localStorage side regardless so the Settings UI still
        // renders.
      }
      try {
        const isEnabled = await invoke<boolean>("is_autostart_enabled");
        if (!cancelled) setAutoStartEnabledState(isEnabled);
      } catch {
        /* same fallback rationale */
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Setters: dual-write to React state (sync) + Rust kv (async). The
  // optimistic React write keeps the Settings UI responsive; if the
  // Rust call fails we surface it via toast (the page does this)
  // and the next reload picks up the persisted truth again. Argument
  // names MUST match the Rust `#[tauri::command]` parameter names
  // (Tauri 2 sends them through serde camelCase by default).
  const setCloseToTray = useCallback(async (next: boolean) => {
    setCloseToTrayState(next);
    try {
      await invoke("set_close_to_tray_enabled", { enabled: next });
    } catch (err) {
      console.warn("[SettingsContext] set_close_to_tray_enabled failed:", err);
    }
  }, []);

  const setMinimizeOnLaunch = useCallback(async (next: boolean) => {
    setMinimizeOnLaunchState(next);
    try {
      await invoke("set_minimize_on_launch_enabled", { enabled: next });
    } catch (err) {
      console.warn(
        "[SettingsContext] set_minimize_on_launch_enabled failed:",
        err,
      );
    }
  }, []);

  const setDisableElevationPrompts = useCallback(async (next: boolean) => {
    setDisableElevationPromptsState(next);
    try {
      await invoke("set_disable_elevation_prompts", { enabled: next });
    } catch (err) {
      console.warn(
        "[SettingsContext] set_disable_elevation_prompts failed:",
        err,
      );
    }
  }, []);

  const setAutoStartEnabled = useCallback(async (next: boolean) => {
    setAutoStartEnabledState(next);
    try {
      await invoke("set_autostart_enabled", { enabled: next });
    } catch (err) {
      console.warn("[SettingsContext] set_autostart_enabled failed:", err);
      throw err; // Let SettingsPage roll back the optimistic state.
    }
  }, []);

  // LocalStorage-backed state ──────────────────────────────────────────────
  const [landingPage, setLandingPageState] = useState<LandingPage>(() => {
    const raw = lsGet(LS_LANDING_PAGE);
    if (
      raw === "library" ||
      raw === "store" ||
      raw === "wishlist" ||
      raw === "deals" ||
      raw === "activity" ||
      raw === "achievements" ||
      raw === "downloads" ||
      raw === "storage" ||
      raw === "news" ||
      raw === "community"
    ) {
      return raw;
    }
    return "library";
  });

  const setLandingPage = useCallback((next: LandingPage) => {
    setLandingPageState(next);
    lsSet(LS_LANDING_PAGE, next);
  }, []);

  const [accentColor, setAccentColorState] = useState<string | null>(() =>
    lsGet(LS_ACCENT_COLOR),
  );

  const setAccentColor = useCallback((next: string | null) => {
    setAccentColorState(next);
    if (next === null) {
      try {
        localStorage.removeItem(LS_ACCENT_COLOR);
      } catch {
        /* ignore */
      }
    } else {
      lsSet(LS_ACCENT_COLOR, next);
    }
    // Apply to :root so every theme re-tints itself with the override.
    // `null` reverts to the per-theme default computed by App.css.
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      if (next) {
        root.style.setProperty("--color-accent", next);
        root.style.setProperty("--color-accent-glow", `${next}55`);
      } else {
        root.style.removeProperty("--color-accent");
        root.style.removeProperty("--color-accent-glow");
      }
    }
  }, []);

  // Hydrate the accent CSS variable on first mount so a saved override
  // applies before the first paint of the Settings page or any route.
  useEffect(() => {
    if (accentColor && typeof document !== "undefined") {
      const root = document.documentElement;
      root.style.setProperty("--color-accent", accentColor);
      root.style.setProperty("--color-accent-glow", `${accentColor}55`);
    }
  }, [accentColor]);

  const [syncIntervalMinutes, setSyncIntervalState] =
    useState<SyncIntervalMinutes>(() => {
      const raw = parseInt(lsGet(LS_SYNC_INTERVAL) ?? "0", 10);
      if (raw === 15 || raw === 30 || raw === 60 || raw === 360) return raw;
      if (raw === 720) return 720;
      if (raw === 1440) return 1440;
      return 0;
    });
  const setSyncIntervalMinutes = useCallback((next: SyncIntervalMinutes) => {
    setSyncIntervalState(next);
    lsSet(LS_SYNC_INTERVAL, String(next));
  }, []);

  const [steamAutoDetect, setSteamAutoDetectState] = useState<boolean>(() =>
    lsGet(LS_STEAM_AUTO_DETECT) === "true",
  );
  const setSteamAutoDetect = useCallback((next: boolean) => {
    setSteamAutoDetectState(next);
    lsSet(LS_STEAM_AUTO_DETECT, String(next));
  }, []);

  const [hideAchievementProgress, setHideAchievementProgressState] =
    useState<boolean>(() => lsGet(LS_ACHIEVEMENT_PRIVACY) === "true");
  const setHideAchievementProgress = useCallback((next: boolean) => {
    setHideAchievementProgressState(next);
    lsSet(LS_ACHIEVEMENT_PRIVACY, String(next));
  }, []);

  const [discordRichPresence, setDiscordRichPresenceState] = useState<boolean>(
    () => lsGet(LS_DISCORD_PRESENCE) === "true",
  );
  const setDiscordRichPresence = useCallback((next: boolean) => {
    setDiscordRichPresenceState(next);
    lsSet(LS_DISCORD_PRESENCE, String(next));
  }, []);

  const [historyCapDays, setHistoryCapDaysState] = useState<1 | 7 | 30>(() => {
    const raw = parseInt(lsGet(LS_HISTORY_CAP_DAYS) ?? "1", 10);
    if (raw === 7) return 7;
    if (raw === 30) return 30;
    return 1;
  });
  const setHistoryCapDays = useCallback((next: 1 | 7 | 30) => {
    setHistoryCapDaysState(next);
    lsSet(LS_HISTORY_CAP_DAYS, String(next));
  }, []);

  const [blockedSourceDomains, setBlockedSourceDomainsState] = useState<
    string[]
  >(() => lsGetJSON<string[]>(LS_BLOCKED_DOMAINS, []));
  const setBlockedSourceDomains = useCallback((next: string[]) => {
    // Normalize: lowercase, trim, dedupe, drop empty. The user types
    // whatever they want (with caps, trailing whitespace) and we
    // store the cleaned version so the matcher is reproducible.
    const cleaned = Array.from(
      new Set(
        next
          .map((d) => d.trim().toLowerCase())
          .filter((d) => d.length > 0),
      ),
    );
    setBlockedSourceDomainsState(cleaned);
    lsSetJSON(LS_BLOCKED_DOMAINS, cleaned);
  }, []);

  const value = useMemo<SettingsContextValue>(
    () => ({
      closeToTray,
      setCloseToTray,
      minimizeOnLaunch,
      setMinimizeOnLaunch,
      disableElevationPrompts,
      setDisableElevationPrompts,
      autoStartEnabled,
      setAutoStartEnabled,
      landingPage,
      setLandingPage,
      accentColor,
      setAccentColor,
      syncIntervalMinutes,
      setSyncIntervalMinutes,
      steamAutoDetect,
      setSteamAutoDetect,
      hideAchievementProgress,
      setHideAchievementProgress,
      discordRichPresence,
      setDiscordRichPresence,
      historyCapDays,
      setHistoryCapDays,
      blockedSourceDomains,
      setBlockedSourceDomains,
      ready,
    }),
    [
      closeToTray,
      setCloseToTray,
      minimizeOnLaunch,
      setMinimizeOnLaunch,
      disableElevationPrompts,
      setDisableElevationPrompts,
      autoStartEnabled,
      setAutoStartEnabled,
      landingPage,
      setLandingPage,
      accentColor,
      setAccentColor,
      syncIntervalMinutes,
      setSyncIntervalMinutes,
      steamAutoDetect,
      setSteamAutoDetect,
      hideAchievementProgress,
      setHideAchievementProgress,
      discordRichPresence,
      setDiscordRichPresence,
      historyCapDays,
      setHistoryCapDays,
      blockedSourceDomains,
      setBlockedSourceDomains,
      ready,
    ],
  );

  return (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return ctx;
}
