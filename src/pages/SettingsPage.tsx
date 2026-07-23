import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

import { useToast } from "../context/ToastContext";
import { useActivity } from "../context/ActivityContext";
import { useGames } from "../context/GameContext";
import { useSources } from "../context/SourceContext";
import { useTheme, type ThemeDescriptor } from "../context/ThemeContext";
import { useSettings, type LandingPage, type SyncIntervalMinutes } from "../context/SettingsContext";
import type { SteamSyncResult, SteamSettings, SteamSession, SteamAuthState } from "../types/steam";
import type { EpicAuthState, EpicSyncResult } from "../types/epic";
import type { GogAuthState, GogSyncResult } from "../types/gog";
import type { HumbleAuthState, HumbleSettings, HumbleSyncResult } from "../types/humble";
import type { RockstarSyncResult } from "../types/rockstar";
import type { UplaySyncResult, UplaySettings } from "../types/uplay";
import { formatPlayTime, type Game, type SizeUnit } from "../types/game";
import { useSizeUnit } from "../hooks/useSizeUnit";
import { useAchievements } from "../context/AchievementContext";
import SourceManager from "../components/SourceManager";
import { useDownloads } from "../context/DownloadContext";
import { Button } from "../components/ui";
import "../styles/page-settings.css";

/** Maps theme ids to preview colors — kept in sync with App.css overrides. */
const THEME_PREVIEW_COLORS: Record<string, { bg: string; text: string; accent: string }> = {
  dark:      { bg: "#0a0c10", text: "#f0f2f7", accent: "#7c66ff" },
  light:     { bg: "#f8fafc", text: "#0f172a", accent: "#7c3aed" },
  nord:      { bg: "#2e3440", text: "#eceff4", accent: "#88c0d0" },
  cyberpunk: { bg: "#050508", text: "#f0f2f5", accent: "#00f0ff" },
  emerald:   { bg: "#08110c", text: "#ecf3ee", accent: "#10b981" },
  dracula:   { bg: "#1e1f29", text: "#f8f8f2", accent: "#bd93f9" },
  solarized: { bg: "#002b36", text: "#fdf6e3", accent: "#268bd2" },
  tokyonight:{ bg: "#1a1b26", text: "#c0caf5", accent: "#7aa2f7" },
  gruvbox:   { bg: "#282828", text: "#ebdbb2", accent: "#fe8019" },
  catppuccin:{ bg: "#1e1e2e", text: "#cad3f5", accent: "#cba6f7" },
  sunset:    { bg: "#1f0f1a", text: "#fdeef2", accent: "#ff7a59" },
  oceanic:   { bg: "#071a2b", text: "#e6f6fb", accent: "#22d3ee" },
  rosepine:  { bg: "#191724", text: "#e0def4", accent: "#eb6f92" },
  synthwave: { bg: "#170d2b", text: "#f9f2ff", accent: "#ff71ce" },
  forest:    { bg: "#0c1510", text: "#eef5ea", accent: "#84cc16" },
  desert:    { bg: "#1c160f", text: "#f5ead7", accent: "#e0ab55" },
  aurora:    { bg: "#07060f", text: "#f4f2ff", accent: "#8b5cff" },
};

/**
 * Curated palette of preset accent colors exposed to the user on the
 * Appearance tab. Ordered cool→warm so a single horizontal scan
 * reads as a complete hue wheel, matching how the existing grid wraps
 * into ~2 rows at the settings container's 940px max-width.
 *
 * The original 6 hardcoded swatches (Purple/Violet, Emerald, Cyan,
 * Orange, Yellow, Pink) are preserved verbatim so existing
 * `gamelib.accent_color` localStorage values stay detectable as a
 * preset and keep their matching tooltip / aria-label.
 *
 * Hex values pulled from Tailwind's 500-step palette — chosen for
 * enough contrast against the dark theme background to read as an
 * accent when applied to buttons, focus rings, and glows, while
 * staying saturated enough to survive the `#0007`-fading recipe the
 * SettingsContext uses to derive `--color-accent-glow`.
 */
const ACCENT_PRESETS: { name: string; value: string }[] = [
  // Cool spectrum — magenta through green
  { name: "Fuchsia", value: "#d946ef" },
  { name: "Purple",  value: "#a855f7" },
  { name: "Violet",  value: "#7c66ff" }, // (replaces the old "Purple" preset — same hex)
  { name: "Indigo",  value: "#6366f1" },
  { name: "Blue",    value: "#3b82f6" },
  { name: "Sky",     value: "#0ea5e9" },
  { name: "Cyan",    value: "#06b6d4" },
  { name: "Teal",    value: "#14b8a6" },
  { name: "Emerald", value: "#10b981" }, // (replaces the old "Green" preset — same hex)
  { name: "Lime",    value: "#84cc16" },
  // Warm spectrum — yellow through pink
  { name: "Yellow",  value: "#eab308" },
  { name: "Amber",   value: "#f59e0b" },
  { name: "Orange",  value: "#f97316" },
  { name: "Rose",    value: "#f43f5e" },
  { name: "Crimson", value: "#ef4444" },
  { name: "Pink",    value: "#ec4899" },
];

// Lower-cased set so the "is this a custom pick?" branch below only
// needs to do a single O(1) lookup instead of a per-render
// `["#7c66ff", "#ec4899", ...].includes(accentColor)` whose list we'd
// otherwise have to keep in sync with ACCENT_PRESETS by hand.
const PRESET_VALUE_SET: Set<string> = new Set(
  ACCENT_PRESETS.map((p) => p.value.toLowerCase()),
);

const DESCRIPTOR_LABELS: Record<ThemeDescriptor, string> = {
  vibrant: "🎮 Vibrant",
  calm: "🧘 Calm",
  "high-contrast": "♿ High Contrast",
  minimal: "✨ Minimal",
};

type SettingsTab = "appearance" | "hardware" | "integrations" | "downloads" | "launcher";

import { useBigScreen } from "../context/BigScreenContext";
import BigScreenSystem from "../components/bigscreen/BigScreenSystem";

export default function SettingsPage() {
  const { isBigScreen } = useBigScreen();
  if (isBigScreen) {
    return <BigScreenSystem />;
  }
  const { showToast } = useToast();
  const { availableGpus, selectedGpu, setSelectedGpu, refreshGpus } = useActivity();
  const { games, addGames, updateGame } = useGames();
  const { reloadCache, settings: achievementSettings, updateSettings: updateAchievementSettings } =
    useAchievements();
  const { sources } = useSources();
  const { unit: sizeUnit, setUnit: setSizeUnit } = useSizeUnit();
  const { currentTheme, setTheme, themes, systemSync, setSystemSync } = useTheme();
  const { updateSpeedLimits, selectSavePath } = useDownloads();
  // New settings slice (covers all 12 settings added in this drop:
  // Rust-backed launcher settings + localStorage knobs for sync
  // intervals / privacy / accent / blocklist / discord presence /
  // history retention). Hydration handled inside SettingsProvider.
  const {
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
    hardwareMonitoringEnabled,
    setHardwareMonitoringEnabled,
    metricCapture,
    setMetricCapture,
    samplingIntervalSec,
    setSamplingIntervalSec,
    tempUnit,
    setTempUnit,
    ready,
  } = useSettings();

  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>("appearance");

  // System summary (CPU / RAM / all GPUs) for the Hardware tab. Fetched
  // once on mount; the Rust side reads real hardware via WMI.
  const [systemInfo, setSystemInfo] = useState<{
    cpuName: string;
    ramGb: number;
    gpus: { id: string; name: string; vendor: string; vramMb: number }[];
  } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const info = await invoke<{
          cpuName: string;
          ramGb: number;
          gpus: { id: string; name: string; vendor: string; vramMb: number }[];
        }>("get_system_info");
        setSystemInfo(info);
      } catch (e) {
        console.warn("[SettingsPage] get_system_info failed:", e);
      }
    })();
  }, []);

  // The Rust telemetry config wants milliseconds, but the user-facing
  // settings store the interval in seconds. Derive the ms value so the
  // range slider (in ms) and the backend payload stay in sync.
  const samplingIntervalMs = Math.round(samplingIntervalSec * 1000);

  // Push telemetry config to the Rust watcher whenever the master
  // toggle, per-metric capture flags, or sampling interval change. The
  // watcher reads this at the moment a collection thread is started, so
  // the next launch / passive detection honours the new settings.
  useEffect(() => {
    (async () => {
      try {
        await invoke("set_metrics_config", {
          config: {
            enabled: hardwareMonitoringEnabled,
            intervalMs: samplingIntervalMs,
            captureFps: metricCapture.fps,
            captureCpu: metricCapture.cpu,
            captureGpu: metricCapture.gpu,
            captureRam: metricCapture.ram,
            captureCpuTemp: metricCapture.cpuTemp,
            captureGpuTemp: metricCapture.gpuTemp,
          },
        });
      } catch (e) {
        console.warn("[SettingsPage] set_metrics_config failed:", e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hardwareMonitoringEnabled, metricCapture, samplingIntervalMs]);

  // Speed Limit Settings State
  const [dlLimitEnabled, setDlLimitEnabled] = useState(false);
  const [dlLimitValue, setDlLimitValue] = useState(0);
  const [ulLimitEnabled, setUlLimitEnabled] = useState(false);
  const [ulLimitValue, setUlLimitValue] = useState(0);
  const [disableUpload, setDisableUpload] = useState(false);

  // Default download path + "always ask" toggle. When a default path
  // is set and "always ask" is off, the magnet quick-add bar skips
  // the folder picker and drops downloads straight into this folder.
  const [defaultDownloadPath, setDefaultDownloadPath] = useState("");
  const [alwaysAskPath, setAlwaysAskPath] = useState(true);

  // Completion notification toggles.
  const [notifyComplete, setNotifyComplete] = useState(true);
  const [notifyOs, setNotifyOs] = useState(false);

  // Load limits on mount
  useEffect(() => {
    try {
      setDlLimitEnabled(localStorage.getItem("gamelib-dl-limit-download-enabled") === "true");
      setDlLimitValue(parseInt(localStorage.getItem("gamelib-dl-limit-download-value") || "0", 10));
      setUlLimitEnabled(localStorage.getItem("gamelib-dl-limit-upload-enabled") === "true");
      setUlLimitValue(parseInt(localStorage.getItem("gamelib-dl-limit-upload-value") || "0", 10));
      setDisableUpload(localStorage.getItem("gamelib-dl-limit-disable-upload") === "true");
      setDefaultDownloadPath(localStorage.getItem("gamelib-default-download-path") || "");
      // Default to "always ask" unless the user explicitly turned it off.
      setAlwaysAskPath(localStorage.getItem("gamelib-download-always-ask-path") !== "false");
      setNotifyComplete(localStorage.getItem("gamelib-download-notify-complete") !== "false");
      setNotifyOs(localStorage.getItem("gamelib-download-notify-os") === "true");
    } catch (e) {
      console.error("Failed to load speed limit settings:", e);
    }
  }, []);

  const handlePickDefaultPath = async () => {
    try {
      const path = await selectSavePath();
      if (path) {
        setDefaultDownloadPath(path);
        localStorage.setItem("gamelib-default-download-path", path);
        // Picking a default path implies the user wants to use it.
        setAlwaysAskPath(false);
        localStorage.setItem("gamelib-download-always-ask-path", "false");
      }
    } catch (e) {
      showToast(`Couldn't open folder picker: ${e}`, "error");
    }
  };

  // Debrid Settings State
  const [debridProvider, setDebridProvider] = useState("none");
  const [debridApiKey, setDebridApiKey] = useState("");
  const [testingDebrid, setTestingDebrid] = useState(false);

  // Load Debrid on mount
  useEffect(() => {
    setDebridProvider(localStorage.getItem("gamelib-debrid-provider") || "none");
    setDebridApiKey(localStorage.getItem("gamelib-debrid-apikey") || "");
  }, []);

  const handleTestDebrid = async () => {
    if (!debridApiKey) return;
    setTestingDebrid(true);
    try {
      const res = await invoke<{ username: string; premium_until: number | null }>("test_debrid_key", {
        provider: debridProvider,
        apikey: debridApiKey,
      });
      showToast(`Success! Logged in as ${res.username}`, "success");
    } catch (e) {
      showToast(`Connection failed: ${e}`, "error");
    } finally {
      setTestingDebrid(false);
    }
  };

  const saveAndApplyLimits = async (
    dlEnabled: boolean,
    dlVal: number,
    ulEnabled: boolean,
    ulVal: number,
    noUpload: boolean
  ) => {
    try {
      localStorage.setItem("gamelib-dl-limit-download-enabled", String(dlEnabled));
      localStorage.setItem("gamelib-dl-limit-download-value", String(dlVal));
      localStorage.setItem("gamelib-dl-limit-upload-enabled", String(ulEnabled));
      localStorage.setItem("gamelib-dl-limit-upload-value", String(ulVal));
      localStorage.setItem("gamelib-dl-limit-disable-upload", String(noUpload));

      await updateSpeedLimits(
        dlEnabled && dlVal > 0 ? dlVal : null,
        ulEnabled && ulVal > 0 ? ulVal : null,
        noUpload
      );
    } catch (e) {
      console.error("Failed to update speed limits:", e);
    }
  };

  // Tracks whether the initial Steam-session probe has resolved.
  // Starts false so the API-key + SteamID inputs don't flash in
  // with hydrated localStorage values on remount (e.g. user
  // navigates to Library and back) BEFORE the keychain probe
  // confirms they're actually still connected via Connect Steam.
  // Without this gate, on remount the form would briefly render
  // with hydrated values before isAuthenticated flipped to true,
  // which violates the "stay logged in until disconnect" UX
  // contract even though the underlying state was technically
  // correct.
  const [steamAuthReady, setSteamAuthReady] = useState(false);
  const [steamAuth, setSteamAuth] = useState<SteamAuthState>({ isAuthenticated: false });
  const [isSteamLoggingIn, setIsSteamLoggingIn] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SteamSyncResult | null>(null);
  const [steamSettings, setSteamSettings] = useState<SteamSettings>({
    autoSyncOnLaunch: true,
    syncPlaytime: true,
    syncAchievements: false,
  });
  // The user gets their API key from
  // https://steamcommunity.com/dev/apikey and their SteamID64 from
  // https://steamcommunity.com/my (both linked from the inputs
  // below). Both fields are persisted to localStorage on every
  // keystroke (see the onChange handlers below) and re-hydrated
  // on mount, so navigating away — or a reboot — doesn't wipe them.
  // The keychain still owns the verified SteamSession blob that
  // `steam_connect` writes on successful Connect; the localStorage
  // copy is only the user's *unverified* input, kept around so the
  // form is pre-filled next time they open Settings.
  const [steamApiKey, setSteamApiKey] = useState("");
  const [steamId, setSteamId] = useState("");

  // Hydrate the Steam API key + SteamID64 inputs from localStorage
  // on mount. Tauri WebView stores localStorage in the OS app-data
  // dir, so this survives reboots. Sync (no IPC) — runs once at
  // mount before the async Steam-session probe completes, so the
  // fields are visible the moment the user opens Settings.
  useEffect(() => {
    try {
      setSteamApiKey(localStorage.getItem("gamelib-steam-apikey") || "");
      setSteamId(localStorage.getItem("gamelib-steam-steamid") || "");
    } catch (e) {
      console.error("Failed to load Steam credentials from localStorage:", e);
    }
  }, []);

  // Epic integration state
  const [epicAuth, setEpicAuth] = useState<EpicAuthState>({ isAuthenticated: false });
  const [epicSyncResult, setEpicSyncResult] = useState<EpicSyncResult | null>(null);
  const [isEpicLoggingIn, setIsEpicLoggingIn] = useState(false);
  const [isEpicSyncing, setIsEpicSyncing] = useState(false);
  // Tracks a "previous session is unreachable" state where the OS keychain
  // entry was wiped externally (Credential Manager rebuild, secret-service
  // daemon restart with stale collection, etc.) but localStorage still
  // holds a legacy refresh token from before the security fix. Surfaced as
  // a one-click recovery banner so the user reconnects via a refresh-grant
  // OAuth round-trip rather than the full WebView `Connect Epic Account`
  // flow.
  const [epicStaleSession, setEpicStaleSession] = useState<{
    refreshToken: string;
    accountId: string;
    displayName?: string;
  } | null>(null);
  const [isEpicRecovering, setIsEpicRecovering] = useState(false);

  // GOG Galaxy integration state. The probe at mount mirrors the
  // pattern Epic uses: a cheap `gog_is_authenticated` boolean call
  // to decide whether the Connect or Sync tile is rendered, with the
  // `{ userId, username, lastSync }` enrichment hydrated from a
  // localStorage blob on first success. No `gogAuthReady` gate is
  // required here — there's no paste-in field whose contents should
  // be hidden until the probe resolves (unlike Steam's API key +
  // SteamID64 inputs).
  const [gogAuth, setGogAuth] = useState<GogAuthState>({ isAuthenticated: false });
  const [gogSyncResult, setGogSyncResult] = useState<GogSyncResult | null>(null);
  const [isGogLoggingIn, setIsGogLoggingIn] = useState(false);
  const [isGogSyncing, setIsGogSyncing] = useState(false);

  // Rockstar Games Launcher integration state. No account/auth —
  // it's a pure installed-games scan + launcher client, so the
  // only state is the last scan result + the in-flight flag.
  const [rockstarSyncResult, setRockstarSyncResult] = useState<RockstarSyncResult | null>(null);
  const [isRockstarSyncing, setIsRockstarSyncing] = useState(false);

  // Ubisoft Connect (Uplay) integration state. No account/auth — it's a
  // pure installed-games + owned-library scan + launcher client, so the
  // only state is the last sync result, the in-flight flag, and the
  // user-toggleable settings blob.
  const [uplaySyncResult, setUplaySyncResult] = useState<UplaySyncResult | null>(null);
  const [isUplaySyncing, setIsUplaySyncing] = useState(false);
  const [uplaySettings, setUplaySettings] = useState<UplaySettings>({
    importInstalledGames: true,
    importUninstalledGames: false,
  });

  // Humble Bundle integration state. Cookie-based auth (no OAuth) — a
  // WebView drives humblebundle.com/login and we snapshot the session
  // cookies. The mount probe checks `humble_is_authenticated` (cookie
  // blob present) and hydrates the persisted settings + sync info,
  // mirroring the GOG/Epic pattern.
  const [humbleAuth, setHumbleAuth] = useState<HumbleAuthState>({ isAuthenticated: false });
  const [humbleSyncResult, setHumbleSyncResult] = useState<HumbleSyncResult | null>(null);
  const [humbleSettings, setHumbleSettings] = useState<HumbleSettings>({
    connectAccount: false,
    ignoreThirdPartyStoreGames: true,
    importThirdPartyDrmFree: false,
    importGeneralLibrary: true,
    importGameExtras: false,
    importTroveGames: false,
    launchViaHumbleApp: true,
  });
  const [isHumbleLoggingIn, setIsHumbleLoggingIn] = useState(false);
  const [isHumbleSyncing, setIsHumbleSyncing] = useState(false);

  async function loadHumbleSettings() {
    try {
      const s = await invoke<HumbleSettings>("humble_get_settings");
      if (s) setHumbleSettings(s);
    } catch (e) {
      console.error("Failed to load Humble settings:", e);
    }
  }

  async function loadUplaySettings() {
    try {
      const s = await invoke<UplaySettings>("uplay_get_settings");
      if (s) setUplaySettings(s);
    } catch (e) {
      console.error("Failed to load Uplay settings:", e);
    }
  }

  async function updateUplaySetting<K extends keyof UplaySettings>(
    key: K,
    value: UplaySettings[K],
  ) {
    const next = { ...uplaySettings, [key]: value };
    setUplaySettings(next);
    try {
      await invoke("uplay_save_settings", { settings: next });
    } catch (err) {
      showToast(`Failed to save Uplay setting: ${err}`, "error");
    }
  }

  // Theme state — powered by ThemeContext
  function handleThemeChange(themeId: string) {
    setTheme(themeId);
    const themeMeta = themes.find((t) => t.id === themeId)?.meta;
    showToast(`Theme changed to ${themeMeta?.name ?? themeId}`, "success");
  }

  // Tracks whether the user has navigated away mid-probe so we
  // don't call setState on an unmounted component. The Steam +
  // Epic probes each `await invoke(...)`, which is long enough that
  // the user might leave Settings during the wait.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session: SteamSession | null = await invoke("steam_get_session");
        if (cancelled) return;
        if (session) {
          setSteamAuth({ isAuthenticated: true, session });
          const saved = localStorage.getItem("gamelib-steam-sync-info");
          if (saved) {
            try {
              const info = JSON.parse(saved);
              setSteamAuth((prev) => ({ ...prev, lastSync: info.lastSync }));
            } catch { /* ignore */ }
          }

        }
      } catch { /* no session yet */ }
      finally {
        // Reveal the form only after the probe resolves (success OR
        // error). Without this `finally`, on remount after a prior
        // successful Connect, the form would briefly flash the
        // hydrated API-key + SteamID inputs before isAuthenticated
        // flipped to true — making the user think the connection
        // was lost.
        if (!cancelled) setSteamAuthReady(true);
      }
    })();

    (async () => {
      try {
        const authenticated: boolean = await invoke("epic_is_authenticated");
        if (cancelled) return;
        setEpicAuth({ isAuthenticated: authenticated });
        if (!authenticated) {
          // Keychain probe failed, but localStorage still holds a legacy
          // refresh token from before the security fix wiped tokens.
          // Surface a one-click recovery banner instead of forcing the full
          // OAuth round-trip through Connect Epic Account.
          const savedRaw = localStorage.getItem("gamelib-epic-sync-info");
          if (savedRaw) {
            try {
              const info = JSON.parse(savedRaw);
              if (info?.refreshToken && info?.accountId) {
                setEpicStaleSession({
                  refreshToken: info.refreshToken,
                  accountId: info.accountId,
                  displayName: info.displayName,
                });
                return;
              }
            } catch { /* malformed legacy entry — ignore */ }
          }
        }
        if (authenticated) {
          const saved = localStorage.getItem("gamelib-epic-sync-info");
          if (saved) {
            try {
              const info = JSON.parse(saved);
              setEpicAuth((prev) => ({ ...prev, ...info }));
            } catch { /* ignore */ }
          }
        }
      } catch { /* not authenticated */ }
    })();

    (async () => {
      // GOG probe: same shape as the Epic probe above — a boolean
      // auth check, then hydrate the localStorage enrichment into
      // `gogAuth` so the Sync tile can render `last sync` and
      // username on the first paint without a bounce.
      try {
        const authenticated: boolean = await invoke("gog_is_authenticated");
        if (cancelled) return;
        setGogAuth({ isAuthenticated: authenticated });
        if (authenticated) {
          const saved = localStorage.getItem("gamelib-gog-sync-info");
          if (saved) {
            try {
              const info = JSON.parse(saved);
              setGogAuth((prev) => ({ ...prev, ...info }));
            } catch { /* ignore */ }
          }
        }
      } catch { /* not authenticated */ }
    })();

    (async () => {
      // Humble probe: cookie-based auth — check the persisted cookie
      // blob, then hydrate the persisted settings + sync info so the
      // tile renders correctly on first paint.
      try {
        const authenticated: boolean = await invoke("humble_is_authenticated");
        if (cancelled) return;
        setHumbleAuth({ isAuthenticated: authenticated });
        if (authenticated) {
          const saved = localStorage.getItem("gamelib-humble-sync-info");
          if (saved) {
            try {
              const info = JSON.parse(saved);
              setHumbleAuth((prev) => ({ ...prev, ...info }));
            } catch { /* ignore */ }
          }
        }
      } catch { /* not authenticated */ }
      await loadHumbleSettings();
      await loadUplaySettings();
    })();

    try {
      const saved = localStorage.getItem("gamelib-steam-settings");
      if (saved) setSteamSettings(JSON.parse(saved));
    } catch { /* keep defaults */ }

    return () => {
      cancelled = true;
    };
  }, []);

  // Tracks whether auto-reconnect has already run for this
  // mount cycle. useRef so the value persists across renders
  // within the same component instance without forcing a
  // re-render. A new ref is created on every remount (page
  // navigation away + back, or app restart), giving each fresh
  // visit one attempt to silently re-establish the Steam
  // connection from the localStorage-persisted credentials.
  const autoReconnectAttempted = useRef(false);

  // Auto-reconnect on mount if we have local credentials but the
  // keychain probe didn't find a verified session. The OS
  // keychain occasionally loses entries across reboots on Linux
  // (Secret Service daemon hiccups) and Windows (Credential
  // Manager after OS upgrades) — this restores the connection
  // transparently from the localStorage values the user already
  // typed. Subsequent restarts find the freshly-written
  // keychain entry via the probe directly, so this only fires
  // on the first boot after losing it.
  //
  // Runs ONCE per mount via the useRef guard — a user-initiated
  // Disconnect later in the same session wouldn't re-trigger
  // anyway (steamAuthReady doesn't flip back to false), but the
  // ref short-circuits any future re-renders that happen to
  // read `steamAuthReady` again.
  //
  // `[steamAuthReady]` is the ONLY dep intentionally. Adding
  // `steamApiKey`/`steamId`/`steamAuth.isAuthenticated` would
  // re-fire the effect on every keystroke while the form is
  // open. The hydration effect populates those state values
  // synchronously on mount, so they're stable by the time this
  // effect's dep flips.
  useEffect(() => {
    if (!steamAuthReady) return;
    // Mark FIRST so the guard is consistent regardless of which
    // early-return we hit below — otherwise a user who typed
    // values and got a Steam rejection could poll again on
    // every remount with the same revoked key.
    autoReconnectAttempted.current = true;

    // Probe already found a verified session — nothing to do.
    if (steamAuth.isAuthenticated) return;

    // No persisted credentials to revalidate against — the
    // user must type them in manually.
    if (!steamApiKey.trim() || !steamId.trim()) return;

    // Silent revalidation. { autoSync: false } skips the
    // post-Connect library sync so a quiet reboot doesn't
    // trigger a heavy network round-trip the user didn't opt
    // into. handleSteamLogin's success path writes a fresh
    // entry to the keychain, so the NEXT restart finds the
    // session via steam_get_session directly.
    void handleSteamLogin({ autoSync: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steamAuthReady]);

  async function handleSteamLogin(options: { autoSync?: boolean } = {}) {
    // Destructure with a default so the existing call site (the
    // Connect button) keeps its current semantics — manual
    // Connect auto-syncs fresh game data. The auto-reconnect
    // path passes { autoSync: false } so a quiet reboot doesn't
    // trigger a heavy sync for users with huge libraries.
    const { autoSync = true } = options;
    // Pre-flight: both fields required. The Rust probe call against
    // ISteamUser/GetPlayerSummaries/v2 enforces non-empty + a
    // 17-digit SteamID64, but don't spin up the loading state for
    // a request the user clearly didn't authorise.
    if (!steamApiKey.trim() || !steamId.trim()) {
      showToast("API key and Steam ID are required", "error");
      return;
    }
    setIsSteamLoggingIn(true);
    try {
      // Validate the (API key, SteamID) pair server-side and persist
      // the resulting SteamSession to the OS keychain. No webview, no
      // password round-trip — the user auth'd with Steam in their own
      // browser to obtain the key from
      // https://steamcommunity.com/dev/apikey.
      const session: SteamSession = await invoke("steam_connect", {
        apiKey: steamApiKey.trim(),
        steamId: steamId.trim(),
      });

      setSteamAuth({ isAuthenticated: true, session });

      localStorage.setItem("gamelib-steam-sync-info", JSON.stringify({
        displayName: session.displayName,
      }));
      showToast(`Connected to Steam${session.displayName ? ` as ${session.displayName}` : ""}`, "success");

      // Auto-sync after a manual Connect (same handleSyncNow
      // path as the Sync Library button). The auto-reconnect
      // path passes { autoSync: false } so reboots don't sneak
      // in a heavy sync the user didn't ask for — they can
      // click Sync Library manually for fresh data.
      if (autoSync) {
        // Run the library sync in the background so the "Connecting…"
        // spinner clears as soon as the key validates. The sync keeps
        // its own `isSyncing` state + progress UI.
        void handleSyncNow(session);
      }
    } catch (err) {
      showToast(`Steam connection failed: ${err}`, "error");
    } finally {
      setIsSteamLoggingIn(false);
    }
  }

  async function handleSyncNow(session?: SteamSession) {
    const s = session ?? steamAuth.session;
    if (!s) return;
    setIsSyncing(true);
    setSyncResult(null);
    try {
      const result: SteamSyncResult = await invoke("steam_sync_games", {
        session: s,
        includePlaytime: steamSettings.syncPlaytime,
        includeAchievements: steamSettings.syncAchievements,
      });
      setSyncResult(result);
      if (result.success) {
        const g = result.gamesSynced ?? 0;
        const p = result.playtimeUpdated ?? 0;
        const a = result.achievementsSynced ?? 0;

        // Persist synced games to the library, skipping duplicates by Steam AppID
        const existingAppIds = new Set(games.map((gm) => gm.steamAppId).filter(Boolean));
        const installedSet = new Set(result.installedAppids ?? []);
        const newGames: Game[] = [];
        for (const entry of result.syncedGames ?? []) {
          if (existingAppIds.has(entry.appid)) continue;
          const steamCdnCover = `https://cdn.akamai.steamstatic.com/steam/apps/${entry.appid}/library_600x900_2x.jpg`;
          const steamCdnHero  = `https://cdn.akamai.steamstatic.com/steam/apps/${entry.appid}/library_hero.jpg`;
          newGames.push({
            id: `steam-${entry.appid}`,
            name: entry.name,
            path: entry.exePath ?? "",
            platform: "Steam",
            installed: installedSet.has(entry.appid) || !!entry.exePath,
            playTime: formatPlayTime(entry.playtimeForever),
            addedAt: Date.now(),
            steamAppId: entry.appid,
            steamPlaytime: entry.playtimeForever,
            storeSource: "steam" as const,
            coverArtUrl: steamCdnCover,
            bannerUrl: steamCdnHero,
            // Size fields stamped by the Rust sync flow. `sizeDetectedAt`
            // is left undefined when no size was measured (uninstalled
            // game, exe resolution failed, or the disk walk errored) so
            // the Storage tab's "Not set" pill renders correctly.
            sizeBytes: entry.sizeBytes,
            sizeRootPath: entry.sizeRootPath,
            sizeDetectedAt: entry.sizeBytes !== undefined ? new Date().toISOString() : undefined,
            lastPlayed: entry.rtimeLastPlayed ? entry.rtimeLastPlayed * 1000 : undefined,
          });
        }

        if (steamSettings.syncAchievements) {
          await reloadCache();
        }

        // Update lastPlayed for existing Steam games when Steam reports
        // a more recent session, so the "Continue Playing" rail stays
        // accurate after a sync.
        for (const entry of result.syncedGames ?? []) {
          if (!existingAppIds.has(entry.appid)) continue;
          const game = games.find((g) => g.steamAppId === entry.appid);
          const syncedLastPlayed = entry.rtimeLastPlayed ? entry.rtimeLastPlayed * 1000 : undefined;
          if (game && syncedLastPlayed && (!game.lastPlayed || syncedLastPlayed > game.lastPlayed)) {
            updateGame(game.id, { lastPlayed: syncedLastPlayed });
          }
        }

        const achMsg = steamSettings.syncAchievements ? ` · ${a} games achievements synced` : "";
        if (newGames.length > 0) {
          addGames(newGames);
          showToast(`Synced ${g} games · ${p} playtime updates${achMsg} (${newGames.length} new)`, "success");
        } else {
          showToast(`Synced ${g} games · ${p} playtime updates${achMsg} (all already in library)`, "success");
        }
      }
    } catch (err) {
      setSyncResult({ success: false, gamesSynced: 0, playtimeUpdated: 0, achievementsSynced: 0, syncedGames: [], installedAppids: [], error: String(err) });
      showToast(`Sync failed: ${err}`, "error");
    } finally {
      setIsSyncing(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("Remove your Steam connection?")) return;
    try {
      await invoke("steam_logout");
      setSteamAuth({ isAuthenticated: false });
      setSyncResult(null);
      localStorage.removeItem("gamelib-steam-sync-info");
      // Intentionally NOT clearing `gamelib-steam-apikey` /
      // `gamelib-steam-steamid` here: the requirement is for the
      // user's pasted input to persist, so reconnecting shouldn't
      // force them to re-paste the 32-char key and 17-digit ID.
      showToast("Steam disconnected", "info");
    } catch (err) {
      showToast(`Failed: ${err}`, "error");
    }
  }

  // ── Epic handlers ──────────────────────────────────────────────────

  async function handleEpicLogin() {
    setIsEpicLoggingIn(true);
    try {
      // epic_start_login now does everything:
      // binds port 80 → opens WebView → waits for login redirect → returns auth code
      showToast("A login window will open — log in to Epic Games there", "info");
      const authCode: string = await invoke("epic_start_login");

      // Exchange code for tokens
      const tokens = await invoke<{ accountId: string; displayName?: string }>("epic_finish_login", { authCode });
      setEpicAuth({
        isAuthenticated: true,
        accountId: tokens.accountId,
        displayName: tokens.displayName,
      });
      // Persist ONLY the metadata-only shape. The full OAuth tokens
      // (accessToken + refreshToken) belong in the OS keychain, which
      // epic_finish_login wrote via save_tokens. localStorage is
      // js-readable, never store bearer tokens there. The subsequent
      // handleEpicSync call overwrites this with the same safe shape.
      // On launch, the mount probe detects legacy full-payload entries
      // (pre-security-fix) and surfaces the recovery banner via
      // setEpicStaleSession.
      localStorage.setItem(
        "gamelib-epic-sync-info",
        JSON.stringify({
          accountId: tokens.accountId,
          displayName: tokens.displayName,
          lastSync: Date.now(),
        })
      );
      showToast(`Connected to Epic Games${tokens.displayName ? ` as ${tokens.displayName}` : ""}`, "success");
      // Auto-sync after login
      await handleEpicSync();
    } catch (err) {
      showToast(`Epic connection failed: ${err}`, "error");
    } finally {
      setIsEpicLoggingIn(false);
    }
  }

  async function handleEpicSync() {
    setIsEpicSyncing(true);
    setEpicSyncResult(null);
    try {
      const result: EpicSyncResult = await invoke("epic_sync_library");
      setEpicSyncResult(result);
      if (result.success) {
        // Persist synced games to the library
        const existingEpicIds = new Set(
          games
            .filter((gm) => gm.epicNamespace && gm.epicCatalogItemId)
            .map((gm) => `${gm.epicNamespace}-${gm.epicCatalogItemId}`)
        );
        const newGames: Game[] = [];
        for (const entry of result.syncedGames ?? []) {
          if (existingEpicIds.has(`${entry.namespace}-${entry.catalogItemId}`)) continue;
          newGames.push({
            id: entry.id,
            name: entry.title,
            path: entry.installPath ?? "",
            platform: "Epic",
            installed: entry.isInstalled,
            playTime: formatPlayTime(entry.playtimeMinutes ?? 0),
            addedAt: Date.now(),
            epicNamespace: entry.namespace,
            epicCatalogItemId: entry.catalogItemId,
            coverArtUrl: entry.coverUrl,
            // Size fields stamped by the Rust sync flow. See the Steam
            // block above for the rationale on `sizeDetectedAt` being
            // gated on `sizeBytes !== undefined`.
            sizeBytes: entry.sizeBytes,
            sizeRootPath: entry.sizeRootPath,
            sizeDetectedAt: entry.sizeBytes !== undefined ? new Date().toISOString() : undefined,
            lastPlayed: entry.lastPlayed ? entry.lastPlayed * 1000 : undefined,
          });
        }
        if (newGames.length > 0) {
          addGames(newGames);
          showToast(`Synced ${result.gamesImported} Epic games · ${newGames.length} new`, "success");
        } else {
          showToast(`Synced ${result.gamesImported} Epic games (all already in library)`, "success");
        }

        // Update lastPlayed for existing Epic games when Epic reports a
        // more recent session, so the "Continue Playing" rail stays
        // accurate after a sync.
        for (const entry of result.syncedGames ?? []) {
          const existingId = `${entry.namespace}-${entry.catalogItemId}`;
          if (!existingEpicIds.has(existingId)) continue;
          const game = games.find(
            (g) => g.epicNamespace === entry.namespace && g.epicCatalogItemId === entry.catalogItemId
          );
          const syncedLastPlayed = entry.lastPlayed ? entry.lastPlayed * 1000 : undefined;
          if (game && syncedLastPlayed && (!game.lastPlayed || syncedLastPlayed > game.lastPlayed)) {
            updateGame(game.id, { lastPlayed: syncedLastPlayed });
          }
        }

        // Persist sync info
        setEpicAuth((prev) => ({ ...prev, lastSync: result.lastSync }));
        localStorage.setItem("gamelib-epic-sync-info", JSON.stringify({
          accountId: epicAuth.accountId,
          displayName: epicAuth.displayName,
          lastSync: result.lastSync,
        }));
      }
    } catch (err) {
      setEpicSyncResult({
        success: false,
        gamesImported: 0,
        gamesSkipped: 0,
        errors: [String(err)],
        lastSync: 0,
        syncedGames: [],
      });
      showToast(`Epic sync failed: ${err}`, "error");
    } finally {
      setIsEpicSyncing(false);
    }
  }

  async function handleEpicDisconnect() {
    if (!confirm("Remove your Epic Games connection?")) return;
    try {
      await invoke("epic_logout");
      setEpicAuth({ isAuthenticated: false });
      setEpicSyncResult(null);
      localStorage.removeItem("gamelib-epic-sync-info");
      showToast("Epic Games disconnected", "info");
      // Clear any pending stale-session banner so the recovery prompt
      // doesn't linger after an explicit Disconnect — the user picked
      // the logout path on purpose.
      setEpicStaleSession(null);
    } catch (err) {
      showToast(`Failed: ${err}`, "error");
    }
  }

  // One-click recovery from a wiped keychain entry. The Rust side
  // epic_login_with_refresh_token re-exchanges the localStorage
  // refresh_token for fresh tokens, persists them to the keychain,
  // and returns them for the canonical overwrite step.
  async function handleEpicRecover() {
    const stale = epicStaleSession;
    if (!stale) return;
    setIsEpicRecovering(true);
    try {
      const fresh = await invoke<{ accountId: string; displayName?: string }>(
        "epic_login_with_refresh_token",
        {
          refreshToken: stale.refreshToken,
          accountId: stale.accountId,
          displayName: stale.displayName,
        }
      );
      setEpicAuth({
        isAuthenticated: true,
        accountId: fresh.accountId,
        displayName: fresh.displayName,
      });
      // SECURITY: overwrite localStorage with the safe metadata-only shape.
      // The legacy refreshToken is one-shot \u2014 Epic issues a new one on each
      // refresh-grant. Storing the old token would be a pure regression.
      localStorage.setItem(
        "gamelib-epic-sync-info",
        JSON.stringify({
          accountId: fresh.accountId,
          displayName: fresh.displayName,
          lastSync: Date.now(),
        })
      );
      setEpicStaleSession(null);
      showToast(
        `Recovered Epic Games session${fresh.displayName ? ` as ${fresh.displayName}` : ""}`,
        "success"
      );
      await handleEpicSync();
    } catch (err) {
      // The refresh token was exhausted / revoked \u2014 clear the stale
      // banner so it doesn't loop on the next mount. Strip the dead
      // refreshToken from localStorage to prevent future false banners.
      showToast(`Recovery failed \u2014 please re-login: ${err}`, "error");
      setEpicStaleSession(null);
      try {
        const raw = localStorage.getItem("gamelib-epic-sync-info");
        if (raw) {
          const info = JSON.parse(raw);
          if (info?.refreshToken) {
            localStorage.setItem(
              "gamelib-epic-sync-info",
              JSON.stringify({
                accountId: info.accountId,
                displayName: info.displayName,
              })
            );
          }
        }
      } catch { /* ignore */ }
    } finally {
      setIsEpicRecovering(false);
    }
  }

  // ── GOG handlers ──────────────────────────────────────────────────

  async function handleGogLogin() {
    setIsGogLoggingIn(true);
    try {
      // Single-phase (after the 2026 OAuth pivot): Rust opens a
      // Tauri WebView at gog.com, JS detects the logged-in cookie
      // state and fires `gog_webview_callback` with the bundle, the
      // awaiting command resolves with the persisted GogSession.
      // No more `gog_finish_login` follow-up — that command is gone.
      showToast("A login window will open — log in to GOG Galaxy there", "info");
      const session = await invoke<{ userId: string; username: string }>(
        "gog_start_login"
      );
      setGogAuth({
        isAuthenticated: true,
        userId: session.userId,
        username: session.username,
      });
      localStorage.setItem(
        "gamelib-gog-sync-info",
        JSON.stringify(session)
      );
      showToast(
        `Connected to GOG${session.username ? ` as ${session.username}` : ""}`,
        "success"
      );
      // Auto-sync after first connect — same UX as Steam/Epic so the
      // user sees their library immediately on success.
      await handleGogSync();
    } catch (err) {
      showToast(`GOG connection failed: ${err}`, "error");
    } finally {
      setIsGogLoggingIn(false);
    }
  }

  async function handleGogSync() {
    setIsGogSyncing(true);
    setGogSyncResult(null);
    try {
      const result: GogSyncResult = await invoke("gog_sync_library");
      setGogSyncResult(result);
      if (result.success) {
        // Deduplicate against existing library entries by `gogGameId`.
        // Mirrors the Epic dedupe-by-namespace+itemId and Steam
        // dedupe-by-appid so the three vendors share the same
        // "skip if already imported" parser.
        const existingGogIds = new Set(
          games.filter((gm) => gm.gogGameId).map((gm) => gm.gogGameId)
        );
        const newGames: Game[] = [];
        for (const entry of result.syncedGames ?? []) {
          if (existingGogIds.has(entry.gogGameId)) continue;
          newGames.push({
            id: entry.id,
            name: entry.title,
            path: entry.installPath ?? "",
            platform: "GOG",
            installed: entry.isInstalled,
            playTime: formatPlayTime(entry.playtimeMinutes ?? 0),
            addedAt: Date.now(),
            gogGameId: entry.gogGameId,
            gogPlaytime: entry.playtimeMinutes,
            coverArtUrl: entry.coverUrl,
            sizeBytes: entry.sizeBytes,
            sizeRootPath: entry.sizeRootPath,
            sizeDetectedAt:
              entry.sizeBytes !== undefined ? new Date().toISOString() : undefined,
            // GOG returns `lastPlayed` as unix SECONDS — the project
            // convention is milliseconds (Steam/Epic round-trip the
            // same way). Multiply on ingest.
            lastPlayed: entry.lastPlayed ? entry.lastPlayed * 1000 : undefined,
          });
        }

        // Refresh `lastPlayed` for existing GOG entries when GOG
        // reports a more recent session — same pattern as Steam/Epic,
        // keeps the Library "Continue Playing" rail honest across
        // sync rounds.
        for (const entry of result.syncedGames ?? []) {
          if (!existingGogIds.has(entry.gogGameId)) continue;
          const game = games.find((g) => g.gogGameId === entry.gogGameId);
          const syncedLastPlayed = entry.lastPlayed
            ? entry.lastPlayed * 1000
            : undefined;
          if (
            game &&
            syncedLastPlayed &&
            (!game.lastPlayed || syncedLastPlayed > game.lastPlayed)
          ) {
            updateGame(game.id, { lastPlayed: syncedLastPlayed });
          }
        }

        if (newGames.length > 0) {
          addGames(newGames);
          showToast(
            `Synced ${result.gamesImported} GOG games · ${newGames.length} new`,
            "success"
          );
        } else {
          showToast(
            `Synced ${result.gamesImported} GOG games (all already in library)`,
            "success"
          );
        }

        // Persist sync info. `lastSync` is unix SECONDS — matches the
        // Rust `last_sync: u64` field and the Epic pattern.
        setGogAuth((prev) => ({ ...prev, lastSync: result.lastSync }));
        localStorage.setItem(
          "gamelib-gog-sync-info",
          JSON.stringify({
            userId: gogAuth.userId,
            username: gogAuth.username,
            lastSync: result.lastSync,
          })
        );
      }
    } catch (err) {
      setGogSyncResult({
        success: false,
        gamesImported: 0,
        gamesSkipped: 0,
        errors: [String(err)],
        lastSync: 0,
        syncedGames: [],
      });
      showToast(`GOG sync failed: ${err}`, "error");
    } finally {
      setIsGogSyncing(false);
    }
  }

  async function handleGogDisconnect() {
    if (!confirm("Remove your GOG Galaxy connection?")) return;
    try {
      await invoke("gog_logout");
      setGogAuth({ isAuthenticated: false });
      setGogSyncResult(null);
      localStorage.removeItem("gamelib-gog-sync-info");
      showToast("GOG Galaxy disconnected", "info");
    } catch (err) {
      showToast(`Failed: ${err}`, "error");
    }
  }

  // ── Rockstar handlers ─────────────────────────────────────────────
  // No account/auth — just a local scan of installed Rockstar titles
  // plus launcher-client status. Mirrors the GOG/Epic sync flow's
  // import-into-library half, minus the connect/login step.

  async function handleRockstarSync() {
    setIsRockstarSyncing(true);
    setRockstarSyncResult(null);
    try {
      const result: RockstarSyncResult = await invoke("rockstar_sync_library");
      setRockstarSyncResult(result);
      if (result.success) {
        // Persist scanned games to the library (dedupe by id).
        const existingRockstarIds = new Set(
          games.filter((gm) => gm.rockstarTitleId).map((gm) => gm.id)
        );
        const newGames: Game[] = [];
        for (const entry of result.syncedGames ?? []) {
          if (existingRockstarIds.has(entry.id)) continue;
          newGames.push({
            id: entry.id,
            name: entry.title,
            path: entry.installPath ?? "",
            platform: "Rockstar",
            installed: entry.isInstalled,
            playTime: "0h 0m",
            addedAt: Date.now(),
            rockstarTitleId: entry.titleId,
            iconUrl: entry.iconPath,
            sizeBytes: entry.sizeBytes,
            sizeRootPath: entry.sizeRootPath,
            sizeDetectedAt:
              entry.sizeBytes !== undefined ? new Date().toISOString() : undefined,
          });
        }
        if (newGames.length > 0) {
          addGames(newGames);
          showToast(
            `Scanned ${result.gamesImported} Rockstar games · ${newGames.length} new`,
            "success"
          );
        } else {
          showToast(
            `Scanned ${result.gamesImported} Rockstar games (all already in library)`,
            "success"
          );
        }

        // Update `installed` / size for existing Rockstar entries when
        // the scan reports a different install state.
        for (const entry of result.syncedGames ?? []) {
          const game = games.find((g) => g.id === entry.id);
          if (!game) continue;
          const patch: Partial<Game> = {};
          if (game.installed !== entry.isInstalled) patch.installed = entry.isInstalled;
          if (entry.sizeBytes !== undefined) {
            patch.sizeBytes = entry.sizeBytes;
            patch.sizeRootPath = entry.sizeRootPath;
            patch.sizeDetectedAt = new Date().toISOString();
          }
          if (Object.keys(patch).length > 0) updateGame(game.id, patch);
        }
      }
    } catch (err) {
      setRockstarSyncResult({
        success: false,
        gamesImported: 0,
        gamesSkipped: 0,
        errors: [String(err)],
        lastSync: 0,
        clientInstalled: false,
        clientPath: "",
        syncedGames: [],
      });
      showToast(`Rockstar scan failed: ${err}`, "error");
    } finally {
      setIsRockstarSyncing(false);
    }
  }

  // ── Ubisoft Connect (Uplay) handlers ─────────────────────────────
  // No account/auth — scan of installed + owned library titles plus
  // launcher-client status. Mirrors the Rockstar flow.

  async function handleUplaySync() {
    setIsUplaySyncing(true);
    setUplaySyncResult(null);
    try {
      const result: UplaySyncResult = await invoke("uplay_sync_library");
      setUplaySyncResult(result);
      if (result.success) {
        const existingUplayIds = new Set(
          games.filter((gm) => gm.uplayGameId).map((gm) => gm.id)
        );
        const newGames: Game[] = [];
        for (const entry of result.syncedGames ?? []) {
          if (existingUplayIds.has(entry.id)) continue;
          newGames.push({
            id: entry.id,
            name: entry.title,
            path: entry.installDir ?? "",
            platform: "Ubisoft",
            installed: entry.isInstalled,
            playTime: "0h 0m",
            addedAt: Date.now(),
            uplayGameId: entry.uplayId,
            uplayIsConnect: true,
            coverArtUrl: entry.coverImage,
            iconUrl: entry.iconImage,
            sizeBytes: entry.sizeBytes,
            sizeRootPath: entry.sizeRootPath,
            sizeDetectedAt:
              entry.sizeBytes !== undefined ? new Date().toISOString() : undefined,
          });
        }
        if (newGames.length > 0) {
          addGames(newGames);
          showToast(
            `Scanned ${result.gamesImported} Ubisoft games · ${newGames.length} new`,
            "success"
          );
        } else {
          showToast(
            `Scanned ${result.gamesImported} Ubisoft games (all already in library)`,
            "success"
          );
        }

        // Update `installed` / size for existing Ubisoft entries when
        // the scan reports a different install state.
        for (const entry of result.syncedGames ?? []) {
          const game = games.find((g) => g.id === entry.id);
          if (!game) continue;
          const patch: Partial<Game> = {};
          if (game.installed !== entry.isInstalled) patch.installed = entry.isInstalled;
          if (entry.sizeBytes !== undefined) {
            patch.sizeBytes = entry.sizeBytes;
            patch.sizeRootPath = entry.sizeRootPath;
            patch.sizeDetectedAt = new Date().toISOString();
          }
          if (Object.keys(patch).length > 0) updateGame(game.id, patch);
        }
      }
    } catch (err) {
      setUplaySyncResult({
        success: false,
        gamesImported: 0,
        gamesSkipped: 0,
        errors: [String(err)],
        lastSync: 0,
        clientInstalled: false,
        clientPath: "",
        syncedGames: [],
      });
      showToast(`Ubisoft scan failed: ${err}`, "error");
    } finally {
      setIsUplaySyncing(false);
    }
  }

  // ── Humble handlers ───────────────────────────────────────────────

  async function handleHumbleLogin() {
    setIsHumbleLoggingIn(true);
    try {
      showToast("A login window will open — log in to Humble Bundle there", "info");
      const session = await invoke<{ username: string }>("humble_start_login");
      setHumbleAuth({ isAuthenticated: true, username: session.username });
      await loadHumbleSettings();
      localStorage.setItem(
        "gamelib-humble-sync-info",
        JSON.stringify({ username: session.username })
      );
      showToast(
        `Connected to Humble${session.username ? ` as ${session.username}` : ""}`,
        "success"
      );
      await handleHumbleSync();
    } catch (err) {
      showToast(`Humble connection failed: ${err}`, "error");
    } finally {
      setIsHumbleLoggingIn(false);
    }
  }

  async function handleHumbleSync() {
    setIsHumbleSyncing(true);
    setHumbleSyncResult(null);
    try {
      const result: HumbleSyncResult = await invoke("humble_sync_library");
      setHumbleSyncResult(result);
      if (result.success) {
        const existingHumbleIds = new Set(
          games.filter((gm) => gm.humbleGameId).map((gm) => gm.humbleGameId)
        );
        const newGames: Game[] = [];
        for (const entry of result.syncedGames ?? []) {
          if (existingHumbleIds.has(entry.humbleGameId)) continue;
          newGames.push({
            id: entry.id,
            name: entry.title,
            path: entry.installPath ?? "",
            platform: "Humble",
            installed: entry.isInstalled,
            playTime: "0h",
            addedAt: Date.now(),
            humbleGameId: entry.humbleGameId,
            humbleIsTrove: entry.isTrove,
            humbleIsExtra: entry.isExtra,
            coverArtUrl: entry.coverUrl,
            sizeBytes: entry.sizeBytes,
            sizeRootPath: entry.sizeRootPath,
            sizeDetectedAt:
              entry.sizeBytes !== undefined ? new Date().toISOString() : undefined,
          });
        }

        for (const entry of result.syncedGames ?? []) {
          if (!existingHumbleIds.has(entry.humbleGameId)) continue;
          const game = games.find((g) => g.humbleGameId === entry.humbleGameId);
          if (game && entry.isInstalled && game.installed !== entry.isInstalled) {
            updateGame(game.id, {
              installed: true,
              path: entry.installPath ?? game.path,
            });
          }
        }

        if (newGames.length > 0) {
          addGames(newGames);
          showToast(
            `Synced ${result.gamesImported} Humble games · ${newGames.length} new`,
            "success"
          );
        } else {
          showToast(
            `Synced ${result.gamesImported} Humble games (all already in library)`,
            "success"
          );
        }

        setHumbleAuth((prev) => ({ ...prev, lastSync: result.lastSync }));
        localStorage.setItem(
          "gamelib-humble-sync-info",
          JSON.stringify({
            username: humbleAuth.username,
            lastSync: result.lastSync,
          })
        );
      }
    } catch (err) {
      setHumbleSyncResult({
        success: false,
        gamesImported: 0,
        gamesSkipped: 0,
        errors: [String(err)],
        lastSync: 0,
        syncedGames: [],
      });
      showToast(`Humble sync failed: ${err}`, "error");
    } finally {
      setIsHumbleSyncing(false);
    }
  }

  async function handleHumbleDisconnect() {
    if (!confirm("Remove your Humble Bundle connection?")) return;
    try {
      await invoke("humble_logout");
      setHumbleAuth({ isAuthenticated: false });
      setHumbleSyncResult(null);
      localStorage.removeItem("gamelib-humble-sync-info");
      showToast("Humble Bundle disconnected", "info");
    } catch (err) {
      showToast(`Failed: ${err}`, "error");
    }
  }

  async function updateHumbleSetting<K extends keyof HumbleSettings>(
    key: K,
    value: HumbleSettings[K]
  ) {
    const next = { ...humbleSettings, [key]: value };
    setHumbleSettings(next);
    try {
      await invoke("humble_save_settings", { settings: next });
    } catch (err) {
      showToast(`Failed to save Humble setting: ${err}`, "error");
    }
  }

  // Live count of connected integrations — drives the badge on the
  // Integrations pill in the sub-nav. Lints to 0 when none are
  // connected and to 4 when Steam + Epic + GOG + Humble are all linked.
  const connectedIntegrations =
    (steamAuth.isAuthenticated ? 1 : 0) +
    (epicAuth.isAuthenticated ? 1 : 0) +
    (gogAuth.isAuthenticated ? 1 : 0) +
    (humbleAuth.isAuthenticated ? 1 : 0);

  return (
    <div className="settings-container">
      <div className="settings-panel-accent" aria-hidden="true" />
      <header className="settings-header">
        <div className="settings-header-text">
          <h1 className="settings-title brand-text">
            <span className="settings-title-icon">
              <SettingsGearIcon />
            </span>
            Settings
          </h1>
          <p className="settings-desc">
            Customize Gamelib's appearance, choose which GPU to monitor
            during gameplay, and connect external store integrations.
          </p>
        </div>
      </header>

      {/* Pill segmented sub-nav. Replaces the older "folder tab" look.
       *  `.settings-nav-pill-count` shows the # of connected integrations. */}
      <nav className="settings-nav-pills" role="tablist" aria-label="Settings sections">
        <button
          type="button"
          role="tab"
          aria-selected={activeSettingsTab === "appearance"}
          className={`settings-nav-pill${activeSettingsTab === "appearance" ? " active" : ""}`}
          onClick={() => setActiveSettingsTab("appearance")}
        >
          <PaletteIcon /> Appearance
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSettingsTab === "hardware"}
          className={`settings-nav-pill${activeSettingsTab === "hardware" ? " active" : ""}`}
          onClick={() => setActiveSettingsTab("hardware")}
        >
          <HardwareIcon /> Hardware
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSettingsTab === "integrations"}
          className={`settings-nav-pill${activeSettingsTab === "integrations" ? " active" : ""}`}
          onClick={() => setActiveSettingsTab("integrations")}
        >
          <IntegrationsIcon /> Integrations
          {connectedIntegrations > 0 && (
            <span className="settings-nav-pill-count">{connectedIntegrations}</span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSettingsTab === "downloads"}
          className={`settings-nav-pill${activeSettingsTab === "downloads" ? " active" : ""}`}
          onClick={() => setActiveSettingsTab("downloads")}
        >
          <DownloadIcon /> Downloads
          {sources.length > 0 && (
            <span className="settings-nav-pill-count">{sources.length}</span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSettingsTab === "launcher"}
          className={`settings-nav-pill${activeSettingsTab === "launcher" ? " active" : ""}`}
          onClick={() => setActiveSettingsTab("launcher")}
        >
          <RocketIcon /> Launcher
        </button>
      </nav>

      {/* Appearance */}
      {activeSettingsTab === "appearance" && (
        <section className="settings-section">
          <header className="settings-section-header">
            <span className="settings-section-icon"><PaletteIcon /></span>
            <div className="settings-section-header-text">
              <h2 className="settings-section-title">Appearance themes</h2>
              <p className="settings-section-desc">
                Pick a theme for the entire app — covers topnav, sidebar,
                cards, and accents. Changes apply instantly.
              </p>
            </div>
          </header>
          <div className="theme-grid">
            {themes.map((theme) => {
              const isActive = currentTheme === theme.id;
              const colors = THEME_PREVIEW_COLORS[theme.id] ?? THEME_PREVIEW_COLORS.dark;
              const descriptorLabel = DESCRIPTOR_LABELS[theme.meta.descriptor] ?? null;
              return (
                <div
                  key={theme.id}
                  className={`theme-card${isActive ? " active" : ""}`}
                  onClick={() => handleThemeChange(theme.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleThemeChange(theme.id);
                    }
                  }}
                  aria-pressed={isActive}
                >
                  {/* Theme preview: 3-color swatch on top + a tiny
                   *  mini-app layout (sidebar/topbar/accent button)
                   *  below so users see what the theme will look like. */}
                  <div
                    className="theme-card-preview"
                    style={
                      {
                        "--miniBg": colors.bg,
                        "--miniText": colors.text,
                        "--miniAccent": colors.accent,
                      } as React.CSSProperties
                    }
                  >
                    <div className="theme-preview-bar">
                      <div className="theme-preview-color" style={{ backgroundColor: colors.bg }} />
                      <div className="theme-preview-color" style={{ backgroundColor: colors.text }} />
                      <div className="theme-preview-color" style={{ backgroundColor: colors.accent }} />
                    </div>
                    <div className="theme-preview-mini">
                      <div className="theme-preview-mini-sidebar" />
                      <div className="theme-preview-mini-main">
                        <div className="theme-preview-mini-row">
                          <span className="theme-preview-mini-dot" />
                          <span className="theme-preview-mini-bar" />
                        </div>
                        <div className="theme-preview-mini-card">
                          <span className="theme-preview-mini-accent" />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="theme-card-info">
                    <div className="theme-card-text">
                      <span className="theme-card-name">{theme.meta.name}</span>
                      {descriptorLabel && (
                        <span className="theme-card-descriptor">{descriptorLabel}</span>
                      )}
                    </div>
                    {isActive && <span className="theme-active-dot" aria-hidden />}
                  </div>
                </div>
              );
            })}
          </div>

          {/* System theme sync */}
          <label className="settings-checkbox-label" style={{ marginTop: "var(--space-lg)" }}>
            <input
              type="checkbox"
              checked={systemSync}
              onChange={(e) => setSystemSync(e.target.checked)}
            />
            <span>Sync with system theme (auto-switch dark/light based on OS preference)</span>
          </label>

          {/* Per-theme accent color override — users can pick from a
           *  curated palette of 16 presets OR drop in any arbitrary
           *  hex via the custom picker. Applies to buttons, active
           *  pills, focus rings, and toggles via the
           *  --color-accent CSS variable (re-applied on every change
           *  in SettingsContext). */}
          <div className="settings-row" style={{ marginTop: "var(--space-xl)" }}>
            <div className="settings-control">
              <label className="settings-label">Accent color override</label>
              <p className="settings-helper-lead">
                Tint buttons, links, and active states without losing
                your theme. Resets to the theme's built-in accent when
                cleared.
              </p>
              <div className="accent-picker" role="group" aria-label="Preset accent colors">
                {/* Render the 16 preset swatches from ACCENT_PRESETS so
                 *  adding a new color is a one-line constant edit.
                 *  Clicking an active swatch clears the override back
                 *  to the per-theme default so users can undo without
                 *  hunting for a "clear" button. */}
                {ACCENT_PRESETS.map((swatch) => {
                  // ACCENT_PRESETS values are lowercase by construction,
                  // so a single .toLowerCase() on the user-controlled
                  // accentColor is enough — no need to normalise both
                  // sides of the comparison.
                  const isActive = accentColor?.toLowerCase() === swatch.value;
                  return (
                    <button
                      key={swatch.value}
                      type="button"
                      className={`accent-swatch${isActive ? " active" : ""}`}
                      style={{ backgroundColor: swatch.value }}
                      onClick={() => {
                        setAccentColor(isActive ? null : swatch.value);
                      }}
                      aria-label={`Use ${swatch.name} accent`}
                      aria-pressed={isActive}
                      title={swatch.name}
                    />
                  );
                })}
                {/* Custom 🎨 swatch — only marks itself "active" when
                 *  the user has picked a hex that isn't one of the
                 *  presets. Memoises no extra React state — the
                 *  Set lookup is O(1) and derived from the same
                 *  source of truth as the swatches above. */}
                <label
                  className={`accent-swatch accent-swatch--custom${
                    accentColor && !PRESET_VALUE_SET.has(accentColor.toLowerCase())
                      ? " active"
                      : ""
                  }`}
                  style={accentColor ? { backgroundColor: accentColor } : undefined}
                  title="Pick a custom color"
                >
                  <input
                    type="color"
                    value={accentColor ?? "#7c66ff"}
                    onChange={(e) => setAccentColor(e.target.value)}
                    aria-label="Custom accent color"
                  />
                  <span aria-hidden>🎨</span>
                </label>
                {accentColor && (
                  <button
                    type="button"
                    className="accent-clear"
                    onClick={() => setAccentColor(null)}
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Hardware */}
      {activeSettingsTab === "hardware" && (
        <section className="settings-section">
          <header className="settings-section-header">
            <span className="settings-section-icon"><HardwareIcon /></span>
            <div className="settings-section-header-text">
              <h2 className="settings-section-title">Hardware monitoring</h2>
              <p className="settings-section-desc">
                Choose which GPU to track during gameplay so the
                Activity page shows the right metrics.
              </p>
            </div>
          </header>

          {/* Master toggle — gates the entire telemetry collection thread */}
          <div className="settings-row">
            <div className="settings-hardware-control-card">
              <label className="settings-checkbox-label">
                <input
                  type="checkbox"
                  checked={hardwareMonitoringEnabled}
                  onChange={(e) => setHardwareMonitoringEnabled(e.target.checked)}
                />
                <span>Enable hardware monitoring during gameplay</span>
              </label>
              <p className="settings-helper-lead">
                When off, no CPU, GPU, RAM, or temperature telemetry is
                collected while games run, and the Activity page shows no
                performance data for future sessions.
              </p>
            </div>
          </div>

          {/* Per-metric capture toggles */}
          <div className="settings-row">
            <div className="settings-hardware-control-card">
              <div className="settings-control">
                <label className="settings-label">Metrics to capture</label>
                <p className="settings-helper-lead">
                  Disable streams you don't need. Turning off temperature
                  capture skips the expensive sensor queries, lowering
                  overhead while a game runs.
                </p>
                <div className="settings-metric-toggles">
                  {(
                    [
                      ["fps", "FPS"],
                      ["cpu", "CPU Load"],
                      ["gpu", "GPU Load"],
                      ["ram", "RAM Usage"],
                      ["cpuTemp", "CPU Temp"],
                      ["gpuTemp", "GPU Temp"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="settings-metric-toggle">
                      <input
                        type="checkbox"
                        checked={metricCapture[key]}
                        disabled={!hardwareMonitoringEnabled}
                        onChange={(e) =>
                          setMetricCapture({ ...metricCapture, [key]: e.target.checked })
                        }
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Sampling interval */}
          <div className="settings-row">
            <div className="settings-hardware-control-card">
              <div className="settings-control">
                <label className="settings-label">Sampling interval</label>
                <p className="settings-helper-lead">
                  How often telemetry is polled while a game runs. Lower
                  values produce finer charts but add more overhead.
                </p>
                <div className="settings-input-group">
                  <input
                    type="range"
                    min={0.25}
                    max={60}
                    step={0.25}
                    value={samplingIntervalSec}
                    disabled={!hardwareMonitoringEnabled}
                    onChange={(e) =>
                      setSamplingIntervalSec(Number(e.target.value))
                    }
                    aria-label="Sampling interval in seconds"
                  />
                  <span className="settings-range-value">{samplingIntervalSec} s</span>
                </div>
              </div>
            </div>
          </div>

          {/* Temperature unit */}
          <div className="settings-row">
            <div className="settings-hardware-control-card">
              <div className="settings-control">
                <label className="settings-label">Temperature unit</label>
                <p className="settings-helper-lead">
                  Used everywhere temperatures are shown across the app —
                  the Activity page, session cards, and performance charts.
                </p>
                <div className="settings-segmented" role="group" aria-label="Temperature unit">
                  <button
                    type="button"
                    className={tempUnit === "c" ? "active" : ""}
                    onClick={() => setTempUnit("c")}
                  >
                    °C
                  </button>
                  <button
                    type="button"
                    className={tempUnit === "f" ? "active" : ""}
                    onClick={() => setTempUnit("f")}
                  >
                    °F
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* GPU selection */}
          <div className="settings-row">
            <div className="settings-hardware-control-card">
              <div className="settings-control">
                <label className="settings-label">GPU selection</label>
                <p className="settings-helper-lead">
                  Select a GPU to monitor during gameplay. Stats only
                  appear when a game is running.
                </p>
                <div className="settings-input-group">
                  <select
                    className="settings-select"
                    value={selectedGpu?.id || ""}
                    onChange={(e) => {
                      const gpu = availableGpus.find((g) => g.id === e.target.value);
                      setSelectedGpu(gpu || null);
                      showToast(
                        gpu ? `Selected ${gpu.name}` : "GPU selection cleared",
                        "success"
                      );
                    }}
                    aria-label="Select GPU to monitor"
                  >
                    <option value="">— Select a GPU —</option>
                    {availableGpus.map((gpu) => (
                      <option key={gpu.id} value={gpu.id}>
                        {gpu.name} ({gpu.vramMb} MB)
                      </option>
                    ))}
                  </select>
                  <Button variant="secondary" size="sm" onClick={refreshGpus} leftIcon={<RefreshIcon />}>
                    Refresh
                  </Button>
                </div>
              </div>

              {/* GPU info card — shown when a GPU is selected */}
              {selectedGpu && (
                <div className="settings-gpu-info-card">
                  <span className="settings-gpu-info-icon">
                    <HardwareIcon />
                  </span>
                  <div className="settings-gpu-info-text">
                    <span className="settings-gpu-info-name">{selectedGpu.name}</span>
                    <div className="settings-gpu-info-specs">
                      <span className="settings-gpu-info-spec">
                        {selectedGpu.vramMb} MB VRAM
                      </span>
                      {selectedGpu.id && (
                        <span className="settings-gpu-info-spec">
                          ID: {selectedGpu.id}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="settings-gpu-info-badge">Active</span>
                </div>
              )}
            </div>
          </div>

          {/* Storage — display unit for the Storage tab's size column.
           *  Lives under Hardware because it controls how physical
           *  resources are reported, not how the UI looks. */}
          <div className="settings-row settings-row--spaced">
            <div className="settings-hardware-control-card">
              <div className="settings-control">
                <label className="settings-label">Storage size unit</label>
                <p className="settings-helper-lead">
                  Choose how disk sizes are displayed in the Storage tab.
                  <strong> GB</strong> is decimal (1 GB = 1,000,000,000 bytes — matches
                  Steam and the OS file-explorer).
                  <strong> GiB</strong> is binary (1 GiB = 1,073,741,824 bytes — matches
                  <code> df -h</code> and Windows Task Manager).
                </p>
                <div className="settings-input-group">
                  <select
                    className="settings-select"
                    value={sizeUnit}
                    onChange={(e) => {
                      const next = e.target.value as SizeUnit;
                      setSizeUnit(next);
                      showToast(
                        next === "gb"
                          ? "Storage sizes now in GB (decimal)"
                          : "Storage sizes now in GiB (binary)",
                        "success"
                      );
                    }}
                    aria-label="Select storage size unit"
                  >
                    <option value="gb">GB — decimal (1,000,000,000 bytes)</option>
                    <option value="gib">GiB — binary (1,073,741,824 bytes)</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* System summary — detected CPU / RAM / all GPUs */}
          <div className="settings-row settings-row--spaced">
            <div className="settings-hardware-control-card settings-system-summary">
              <div className="settings-control">
                <label className="settings-label">System summary</label>
                <p className="settings-helper-lead">
                  Hardware detected on this machine.
                </p>
                <div className="settings-system-summary__grid">
                  <div className="settings-system-summary__item">
                    <span className="settings-system-summary__label">CPU</span>
                    <span className="settings-system-summary__value">
                      {systemInfo?.cpuName ?? "Detecting…"}
                    </span>
                  </div>
                  <div className="settings-system-summary__item">
                    <span className="settings-system-summary__label">Memory</span>
                    <span className="settings-system-summary__value">
                      {systemInfo ? `${systemInfo.ramGb} GB` : "—"}
                    </span>
                  </div>
                  <div className="settings-system-summary__item settings-system-summary__item--wide">
                    <span className="settings-system-summary__label">
                      GPUs ({systemInfo?.gpus.length ?? 0})
                    </span>
                    <span className="settings-system-summary__value">
                      {systemInfo && systemInfo.gpus.length > 0
                        ? systemInfo.gpus
                            .map((g) => `${g.name} (${g.vramMb} MB)`)
                            .join(" · ")
                        : "—"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Integrations */}
      {activeSettingsTab === "integrations" && (
        <section className="settings-section">
          <header className="settings-section-header">
            <span className="settings-section-icon"><IntegrationsIcon /></span>
            <div className="settings-section-header-text">
              <h2 className="settings-section-title">Integrations</h2>
              <p className="settings-section-desc">
                Connect external store accounts to import your owned
                games, playtime, and achievements into Gamelib.
              </p>
            </div>
          </header>

          {/* ── Steam ── */}
          <div className="integration-tile steam">
            <div className="integration-tile-body-wrap">
              <div className="integration-tile-header">
                <span className="integration-tile-icon"><SteamIcon /></span>
                <div className="integration-tile-info">
                  <div className="integration-tile-name-row">
                    <h3 className="integration-tile-name">Steam</h3>
                    {steamAuth.isAuthenticated && (
                      <span className="integration-badge active">Connected</span>
                    )}
                  </div>
                  <p className="integration-tile-desc">
                    Import your Steam library, playtime, and
                    achievements using a Steam Web API key.
                  </p>
                </div>
              </div>

              <div className="integration-tile-body">
                {steamAuth.isAuthenticated ? (
                  <div className="auth-status">
                    Connected
                    {steamAuth.session?.displayName ? ` as ${steamAuth.session.displayName}` : ""}
                    {steamAuth.session?.steamId ? ` (ID: ${steamAuth.session.steamId.slice(0, 8)}…)` : ""}
                  </div>
                ) : (
                  <p className="connect-prompt">
                    Log in with your Steam account to import your
                    library. A login window will open inside the app.
                  </p>
                )}

                <p className="auth-note">
                  Your API key stays local — stored only in the
                  encrypted OS keychain.
                </p>

                {/* API-key + SteamID64 paste-in flow. Only rendered
                 *  when the user isn't connected — once
                 *  `steam_is_authenticated` flips to true the inputs
                 *  collapse. Each input is paired with a "?" link
                 *  pointing at the canonical Steam page where the
                 *  user obtains the value, so the workflow doesn't
                 *  require hunting outside the app for instructions.
                 *
                 *  - API key: https://steamcommunity.com/dev/apikey
                 *    (the user logs into Steam in their own browser
                 *    and registers the key against this app's domain)
                 *  - SteamID64: https://steamcommunity.com/my
                 *    (Steam's "My profile" page exposes the 17-digit
                 *    ID under the vanity-URL block at the top) */}
                {!steamAuth.isAuthenticated && steamAuthReady && (
                  <div className="integration-tile-form">
                    <label className="settings-control">
                      <div className="settings-label-row">
                        <span className="settings-label">Steam API Key</span>
                        <a
                          href="https://steamcommunity.com/dev/apikey"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="settings-link"
                        >
                          Get your Steam API key →
                        </a>
                      </div>
                      <input
                        type="password"
                        className="settings-input"
                        value={steamApiKey}
                        onChange={(e) => {
                          setSteamApiKey(e.target.value);
                          localStorage.setItem("gamelib-steam-apikey", e.target.value);
                        }}
                        autoComplete="off"
                        placeholder="32-char hex string from steamcommunity.com/dev/apikey"
                        disabled={isSteamLoggingIn}
                      />
                    </label>
                    <label className="settings-control">
                      <div className="settings-label-row">
                        <span className="settings-label">Steam ID (SteamID64)</span>
                        <a
                          href="https://steamcommunity.com/my"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="settings-link"
                        >
                          Find your Steam ID →
                        </a>
                      </div>
                      <input
                        type="text"
                        className="settings-input"
                        value={steamId}
                        onChange={(e) => {
                          setSteamId(e.target.value);
                          localStorage.setItem("gamelib-steam-steamid", e.target.value);
                        }}
                        autoComplete="off"
                        inputMode="numeric"
                        pattern="[0-9]{17}"
                        placeholder="17-digit number, e.g. 76561197960287930"
                        disabled={isSteamLoggingIn}
                      />
                    </label>
                  </div>
                )}

                <div className="integration-tile-actions">
                  {steamAuth.isAuthenticated ? (
                    <Button
                      variant="primary"
                      onClick={() => handleSyncNow()}
                      isLoading={isSyncing}
                    >
                      Sync Library
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      // Wrapped arrow disables MouseEventHandler arg-passing and
                      // discards the returned Promise with `void` so the new
                      // `{ autoSync?: boolean }` options object doesn't leak
                      // through `.autoSync` on the SyntheticEvent.
                      onClick={() => { void handleSteamLogin(); }}
                      isLoading={isSteamLoggingIn}
                      disabled={!steamAuthReady}
                    >
                      Connect Steam Account
                    </Button>
                  )}
                </div>

                {syncResult && (
                  <div className={`sync-result ${syncResult.success ? "success" : "error"}`}>
                    {syncResult.success
                      ? `✓ Synced ${syncResult.gamesSynced ?? 0} games · ${syncResult.playtimeUpdated ?? 0} playtime updates${syncResult.achievementsSynced ? ` · ${syncResult.achievementsSynced} games achievements synced` : ""}`
                      : `✗ ${syncResult.error || "Sync failed"}`}
                  </div>
                )}

                {steamAuth.isAuthenticated && (
                  <div className="settings-toggles-group">
                    <p className="settings-toggles-title">Sync behaviour</p>
                    <label className="settings-checkbox-label">
                      <input
                        type="checkbox"
                        checked={steamSettings.autoSyncOnLaunch}
                        onChange={(e) => {
                          const u = { ...steamSettings, autoSyncOnLaunch: e.target.checked };
                          setSteamSettings(u);
                          localStorage.setItem("gamelib-steam-settings", JSON.stringify(u));
                        }}
                      />
                      <span>Auto-sync on launch</span>
                    </label>
                    <label className="settings-checkbox-label">
                      <input
                        type="checkbox"
                        checked={steamSettings.syncPlaytime}
                        onChange={(e) => {
                          const u = { ...steamSettings, syncPlaytime: e.target.checked };
                          setSteamSettings(u);
                          localStorage.setItem("gamelib-steam-settings", JSON.stringify(u));
                        }}
                      />
                      <span>Sync playtime</span>
                    </label>
                    <label className="settings-checkbox-label">
                      <input
                        type="checkbox"
                        checked={steamSettings.syncAchievements}
                        onChange={(e) => {
                          const u = { ...steamSettings, syncAchievements: e.target.checked };
                          setSteamSettings(u);
                          localStorage.setItem("gamelib-steam-settings", JSON.stringify(u));
                        }}
                      />
                      <span>Sync achievements</span>
                    </label>
                    <label className="settings-checkbox-label settings-checkbox-label--disabled">
                      <input type="checkbox" checked disabled />
                      <span>IGDB metadata loads automatically when you open a game</span>
                    </label>
                    {/* Steam auto-detect: when enabled, a background
                     *  watcher polls steamapps/ every 5 minutes and
                     *  shows a toast if a new install lands. Mirrors
                     *  the auto-sync-on-launch pattern so users have
                     *  a single "how often should Steam talk to us"
                     *  mental model. */}
                    <label className="settings-checkbox-label">
                      <input
                        type="checkbox"
                        checked={steamAutoDetect}
                        onChange={(e) => {
                          setSteamAutoDetect(e.target.checked);
                          showToast(
                            e.target.checked
                              ? "Will notify when new Steam games are installed"
                              : "Auto-detect disabled",
                            "info",
                          );
                        }}
                      />
                      <span>Detect new Steam installs automatically</span>
                    </label>
                  </div>
                )}
              </div>
            </div>

            {steamAuth.isAuthenticated && (
              <div className="danger-zone">
                <p className="danger-zone-text">
                  <strong>Disconnect Steam.</strong> Clears your local
                  session — your Steam account is untouched.
                </p>
                <Button variant="danger" size="sm" onClick={handleDisconnect}>
                  Disconnect
                </Button>
              </div>
            )}
          </div>

          {/* ── Epic Games ── */}
          <div className="integration-tile epic">
            <div className="integration-tile-body-wrap">
              <div className="integration-tile-header">
                <span className="integration-tile-icon"><EpicIcon /></span>
                <div className="integration-tile-info">
                  <div className="integration-tile-name-row">
                    <h3 className="integration-tile-name">Epic Games</h3>
                    {epicAuth.isAuthenticated && (
                      <span className="integration-badge active">Connected</span>
                    )}
                  </div>
                  <p className="integration-tile-desc">
                    Import your owned Epic Games Store library. Only
                    owned, launchable games are imported.
                  </p>
                </div>
              </div>

              <div className="integration-tile-body">
                {epicAuth.isAuthenticated ? (
                  <div className="auth-status">
                    Connected
                    {epicAuth.displayName ? ` as ${epicAuth.displayName}` : ""}
                    {epicAuth.accountId ? ` (ID: ${epicAuth.accountId.slice(0, 8)}…)` : ""}
                  </div>
                ) : (
                  <p className="connect-prompt">
                    Log in with your Epic Games account to import your
                    library. A login window will open inside the app.
                  </p>
                )}

                {epicStaleSession && (
                  <div className="epic-stale-banner">
                    <p className="epic-stale-banner-text">
                      <strong>Previous Epic session unreachable.</strong>{" "}
                      Local tokens were cleared, but a stored refresh
                      token can restore your connection with one click.
                    </p>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={handleEpicRecover}
                      isLoading={isEpicRecovering}
                    >
                      Reconnect with stored token
                    </Button>
                  </div>
                )}

                <div className="integration-tile-actions">
                  {epicAuth.isAuthenticated ? (
                    <Button
                      variant="primary"
                      onClick={handleEpicSync}
                      isLoading={isEpicSyncing}
                    >
                      Sync Library
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      onClick={handleEpicLogin}
                      isLoading={isEpicLoggingIn}
                    >
                      Connect Epic Account
                    </Button>
                  )}
                </div>

                {epicSyncResult && (
                  <div className={`sync-result ${epicSyncResult.success ? "success" : "error"}`}>
                    {epicSyncResult.success
                      ? `✓ Imported ${epicSyncResult.gamesImported} games · ${epicSyncResult.gamesSkipped} skipped`
                      : `✗ ${epicSyncResult.errors?.[0] || "Sync failed"}`}
                  </div>
                )}

                {epicAuth.lastSync && (
                  <p className="sync-result-time">
                    Last sync: {new Date(epicAuth.lastSync * 1000).toLocaleString()}
                  </p>
                )}
              </div>
            </div>

            {epicAuth.isAuthenticated && (
              <div className="danger-zone">
                <p className="danger-zone-text">
                  <strong>Disconnect Epic Games.</strong> Clears local
                  tokens — your Epic account is unaffected.
                </p>
                <Button variant="danger" size="sm" onClick={handleEpicDisconnect}>
                  Disconnect
                </Button>
              </div>
            )}
          </div>

          {/* ── GOG Galaxy ── */}
          <div className="integration-tile gog">
            <div className="integration-tile-body-wrap">
              <div className="integration-tile-header">
                <span className="integration-tile-icon"><GogIcon /></span>
                <div className="integration-tile-info">
                  <div className="integration-tile-name-row">
                    <h3 className="integration-tile-name">GOG Galaxy</h3>
                    {gogAuth.isAuthenticated && (
                      <span className="integration-badge active">Connected</span>
                    )}
                  </div>
                  <p className="integration-tile-desc">
                    Import your owned GOG Galaxy library, including
                    playtime and last-session stats, plus installed
                    games detected from the standard GOG install paths.
                  </p>
                </div>
              </div>

              <div className="integration-tile-body">
                {gogAuth.isAuthenticated ? (
                  <div className="auth-status">
                    Connected
                    {gogAuth.username ? ` as ${gogAuth.username}` : ""}
                    {gogAuth.userId ? ` (ID: ${gogAuth.userId})` : ""}
                  </div>
                ) : (
                  <p className="connect-prompt">
                    Log in with your GOG Galaxy account to import your
                    library. A login window will open inside the app.
                  </p>
                )}

                <p className="auth-note">
                  Your tokens stay local — stored only in the
                  encrypted OS keychain, just like Steam and Epic.
                </p>

                <div className="integration-tile-actions">
                  {gogAuth.isAuthenticated ? (
                    <Button
                      variant="primary"
                      onClick={handleGogSync}
                      isLoading={isGogSyncing}
                    >
                      Sync Library
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      onClick={handleGogLogin}
                      isLoading={isGogLoggingIn}
                    >
                      Connect GOG Account
                    </Button>
                  )}
                </div>

                {gogSyncResult && (
                  <div className={`sync-result ${gogSyncResult.success ? "success" : "error"}`}>
                    {gogSyncResult.success
                      ? `✓ Imported ${gogSyncResult.gamesImported} games${gogSyncResult.errors.length ? ` · ${gogSyncResult.errors.length} warning(s)` : ""}`
                      : `✗ ${gogSyncResult.errors?.[0] || "Sync failed"}`}
                  </div>
                )}

                {gogAuth.lastSync && (
                  <p className="sync-result-time">
                    Last sync: {new Date(gogAuth.lastSync * 1000).toLocaleString()}
                  </p>
                )}
              </div>
            </div>

            {gogAuth.isAuthenticated && (
              <div className="danger-zone">
                <p className="danger-zone-text">
                  <strong>Disconnect GOG Galaxy.</strong> Clears local
                  tokens — your GOG account is unaffected.
                </p>
                <Button variant="danger" size="sm" onClick={handleGogDisconnect}>
                  Disconnect
                </Button>
              </div>
            )}
          </div>

          {/* ── Humble Bundle ── */}
          <div className="integration-tile humble">
            <div className="integration-tile-body-wrap">
              <div className="integration-tile-header">
                <span className="integration-tile-icon"><HumbleIcon /></span>
                <div className="integration-tile-info">
                  <div className="integration-tile-name-row">
                    <h3 className="integration-tile-name">Humble Bundle</h3>
                    {humbleAuth.isAuthenticated && (
                      <span className="integration-badge active">Connected</span>
                    )}
                  </div>
                  <p className="integration-tile-desc">
                    Import your Humble library — orders, Trove games, and
                    bonus extras — plus installed games detected from the
                    Humble App.
                  </p>
                </div>
              </div>

              <div className="integration-tile-body">
                {humbleAuth.isAuthenticated ? (
                  <div className="auth-status">
                    Connected
                    {humbleAuth.username ? ` as ${humbleAuth.username}` : ""}
                  </div>
                ) : (
                  <p className="connect-prompt">
                    Log in with your Humble Bundle account to import your
                    library. A login window will open inside the app.
                  </p>
                )}

                <p className="auth-note">
                  Your session stays local — only the Humble session cookie
                  is stored, just like GOG and Epic.
                </p>

                <div className="integration-tile-actions">
                  {humbleAuth.isAuthenticated ? (
                    <Button
                      variant="primary"
                      onClick={handleHumbleSync}
                      isLoading={isHumbleSyncing}
                    >
                      Sync Library
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      onClick={handleHumbleLogin}
                      isLoading={isHumbleLoggingIn}
                    >
                      Connect Humble Account
                    </Button>
                  )}
                </div>

                {humbleSyncResult && (
                  <div className={`sync-result ${humbleSyncResult.success ? "success" : "error"}`}>
                    {humbleSyncResult.success
                      ? `✓ Imported ${humbleSyncResult.gamesImported} games${humbleSyncResult.errors.length ? ` · ${humbleSyncResult.errors.length} warning(s)` : ""}`
                      : `✗ ${humbleSyncResult.errors?.[0] || "Sync failed"}`}
                  </div>
                )}

                {humbleAuth.lastSync && (
                  <p className="sync-result-time">
                    Last sync: {new Date(humbleAuth.lastSync * 1000).toLocaleString()}
                  </p>
                )}

                {/* Humble settings toggles (Playnite parity) */}
                <div className="humble-settings-grid">
                  <HumbleToggle
                    label="Import general library"
                    hint="Import owned library subproducts from your Humble orders."
                    checked={humbleSettings.importGeneralLibrary}
                    disabled={!humbleAuth.isAuthenticated}
                    onChange={(v) => updateHumbleSetting("importGeneralLibrary", v)}
                  />
                  <HumbleToggle
                    label="Import game extras"
                    hint="Import soundtracks, artbooks, and other bonus downloads as separate entries."
                    checked={humbleSettings.importGameExtras}
                    disabled={!humbleAuth.isAuthenticated}
                    onChange={(v) => updateHumbleSetting("importGameExtras", v)}
                  />
                  <HumbleToggle
                    label="Import Trove games"
                    hint="Import the Humble Trove subscriber catalog."
                    checked={humbleSettings.importTroveGames}
                    disabled={!humbleAuth.isAuthenticated}
                    onChange={(v) => updateHumbleSetting("importTroveGames", v)}
                  />
                  <HumbleToggle
                    label="Ignore third-party store games"
                    hint="Skip games provided via a partner store (e.g. Steam) rather than drm-free downloads."
                    checked={humbleSettings.ignoreThirdPartyStoreGames}
                    disabled={!humbleAuth.isAuthenticated}
                    onChange={(v) => updateHumbleSetting("ignoreThirdPartyStoreGames", v)}
                  />
                  <HumbleToggle
                    label="Import third-party DRM-free"
                    hint="Still import a third-party game when it also has a drm-free download."
                    checked={humbleSettings.importThirdPartyDrmFree}
                    disabled={!humbleAuth.isAuthenticated}
                    onChange={(v) => updateHumbleSetting("importThirdPartyDrmFree", v)}
                  />
                  <HumbleToggle
                    label="Launch via Humble App"
                    hint="Prefer humble://launch for Trove games over the on-disk executable."
                    checked={humbleSettings.launchViaHumbleApp}
                    disabled={!humbleAuth.isAuthenticated}
                    onChange={(v) => updateHumbleSetting("launchViaHumbleApp", v)}
                  />
                </div>
              </div>
            </div>

            {humbleAuth.isAuthenticated && (
              <div className="danger-zone">
                <p className="danger-zone-text">
                  <strong>Disconnect Humble Bundle.</strong> Clears local
                  session cookies — your Humble account is unaffected.
                </p>
                <Button variant="danger" size="sm" onClick={handleHumbleDisconnect}>
                  Disconnect
                </Button>
              </div>
            )}
          </div>

          {/* ── Rockstar Games Launcher ── */}
          <div className="integration-tile rockstar">
            <div className="integration-tile-body-wrap">
              <div className="integration-tile-header">
                <span className="integration-tile-icon"><RockstarIcon /></span>
                <div className="integration-tile-info">
                  <div className="integration-tile-name-row">
                    <h3 className="integration-tile-name">Rockstar Games Launcher</h3>
                    {rockstarSyncResult?.clientInstalled && (
                      <span className="integration-badge active">Detected</span>
                    )}
                  </div>
                  <p className="integration-tile-desc">
                    Scan installed Rockstar Games Launcher titles (GTA,
                    Red Dead, Max Payne &amp; more) and launch them
                    through the Rockstar client. No account required.
                  </p>
                </div>
              </div>

              <div className="integration-tile-body">
                {rockstarSyncResult?.clientInstalled ? (
                  <div className="auth-status">
                    Rockstar Games Launcher detected
                    {rockstarSyncResult.clientPath
                      ? ` at ${rockstarSyncResult.clientPath}`
                      : ""}
                  </div>
                ) : (
                  <p className="connect-prompt">
                    The Rockstar Games Launcher isn't installed — only
                    titles already on disk can be detected.
                  </p>
                )}

                <p className="auth-note">
                  Detection is fully local: Gamelib reads the Windows
                  uninstall registry for installed Rockstar titles.
                </p>

                <div className="integration-tile-actions">
                  <Button
                    variant="primary"
                    onClick={handleRockstarSync}
                    isLoading={isRockstarSyncing}
                  >
                    Scan Installed Games
                  </Button>
                </div>

                {rockstarSyncResult && (
                  <div className={`sync-result ${rockstarSyncResult.success ? "success" : "error"}`}>
                    {rockstarSyncResult.success
                      ? `✓ Scanned ${rockstarSyncResult.gamesImported} game(s)${rockstarSyncResult.errors.length ? ` · ${rockstarSyncResult.errors.length} warning(s)` : ""}`
                      : `✗ ${rockstarSyncResult.errors?.[0] || "Scan failed"}`}
                  </div>
                )}

                {rockstarSyncResult?.lastSync ? (
                  <p className="sync-result-time">
                    Last scan: {new Date(rockstarSyncResult.lastSync * 1000).toLocaleString()}
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          {/* ── Ubisoft Connect (Uplay) ── */}
          <div className="integration-tile uplay">
            <div className="integration-tile-body-wrap">
              <div className="integration-tile-header">
                <span className="integration-tile-icon"><UplayIcon /></span>
                <div className="integration-tile-info">
                  <div className="integration-tile-name-row">
                    <h3 className="integration-tile-name">Ubisoft Connect</h3>
                    {uplaySyncResult?.clientInstalled && (
                      <span className="integration-badge active">Detected</span>
                    )}
                  </div>
                  <p className="integration-tile-desc">
                    Import your Ubisoft Connect library — installed games and
                    your full owned catalog — plus launch titles through the
                    Ubisoft Connect client. No account required.
                  </p>
                </div>
              </div>

              <div className="integration-tile-body">
                {uplaySyncResult?.clientInstalled ? (
                  <div className="auth-status">
                    Ubisoft Connect detected
                    {uplaySyncResult.clientPath
                      ? ` at ${uplaySyncResult.clientPath}`
                      : ""}
                  </div>
                ) : (
                  <p className="connect-prompt">
                    Ubisoft Connect isn't installed — only games already on disk
                    can be detected via the registry.
                  </p>
                )}

                <p className="auth-note">
                  Detection is fully local: Gamelib reads the Windows
                  uninstall registry for installed titles and the Ubisoft
                  Connect cache for your owned library.
                </p>

                <div className="integration-tile-actions">
                  <Button
                    variant="primary"
                    onClick={handleUplaySync}
                    isLoading={isUplaySyncing}
                  >
                    Sync Library
                  </Button>
                </div>

                {uplaySyncResult && (
                  <div className={`sync-result ${uplaySyncResult.success ? "success" : "error"}`}>
                    {uplaySyncResult.success
                      ? `✓ Scanned ${uplaySyncResult.gamesImported} game(s)${uplaySyncResult.errors.length ? ` · ${uplaySyncResult.errors.length} warning(s)` : ""}`
                      : `✗ ${uplaySyncResult.errors?.[0] || "Sync failed"}`}
                  </div>
                )}

                {uplaySyncResult?.lastSync ? (
                  <p className="sync-result-time">
                    Last sync: {new Date(uplaySyncResult.lastSync * 1000).toLocaleString()}
                  </p>
                ) : null}

                {/* Uplay settings toggles (Playnite parity) */}
                <div className="humble-settings-grid">
                  <UplayToggle
                    label="Import installed games"
                    hint="Import games detected as installed via the Windows registry."
                    checked={uplaySettings.importInstalledGames}
                    onChange={(v) => updateUplaySetting("importInstalledGames", v)}
                  />
                  <UplayToggle
                    label="Import uninstalled games"
                    hint="Import your full owned library (incl. uninstalled) from the Ubisoft Connect cache."
                    checked={uplaySettings.importUninstalledGames}
                    onChange={(v) => updateUplaySetting("importUninstalledGames", v)}
                  />
                </div>
              </div>
            </div>
          </div>

          <p className="integration-footer">
            More integrations coming soon — itch.io and more.
          </p>


          {/* ── Data & sync preferences (across vendors) ── */}
          <header className="settings-section-header" style={{ marginTop: "var(--space-xl)" }}>
            <span className="settings-section-icon"><IntegrationsIcon /></span>
            <div className="settings-section-header-text">
              <h2 className="settings-section-title">Data &amp; sync preferences</h2>
              <p className="settings-section-desc">
                Settings that apply across Steam, Epic, and GOG — or
                control how shared data (player counts, achievements)
                is presented.
              </p>
            </div>
          </header>

          <div className="settings-data-grid">
            {/* Per-store sync interval — single knob that schedules
             *  steam_sync_games / epic_sync_library / gog_sync_library
             *  on a repeating timer. 0 = off (manual only). */}
            <div className="settings-launcher-card">
              <div className="settings-control">
                <label className="settings-label">Auto-sync interval</label>
                <p className="settings-helper-lead">
                  How often Gamelib re-imports your library from Steam,
                  Epic, and GOG in the background.
                </p>
                <div className="settings-input-group">
                  <select
                    className="settings-select"
                    value={syncIntervalMinutes}
                    onChange={(e) => {
                      const raw = parseInt(e.target.value, 10);
                      const next = raw as SyncIntervalMinutes;
                      setSyncIntervalMinutes(next);
                      showToast(
                        next === 0
                          ? "Auto-sync disabled (manual only)"
                          : `Auto-sync set to every ${next === 60 ? "hour" : next === 360 ? "6 hours" : next === 720 ? "12 hours" : next === 1440 ? "24 hours" : `${next} min`}`,
                        "success",
                      );
                    }}
                  >
                    <option value={0}>Off — manual only</option>
                    <option value={15}>Every 15 minutes</option>
                    <option value={30}>Every 30 minutes</option>
                    <option value={60}>Every hour</option>
                    <option value={360}>Every 6 hours</option>
                    <option value={720}>Every 12 hours</option>
                    <option value={1440}>Every 24 hours</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Player-count history retention cap — controls how long
             *  Steam player-count samples are kept around for the
             *  Activity page / game-page sparklines. */}
            <div className="settings-launcher-card">
              <div className="settings-control">
                <label className="settings-label">Player-count history retention</label>
                <p className="settings-helper-lead">
                  How long to keep historical Steam player counts
                  for the trend sparklines on each game page.
                  Shorter = less disk used; longer = richer sparklines.
                </p>
                <div className="settings-input-group">
                  <select
                    className="settings-select"
                    value={historyCapDays}
                    onChange={(e) => {
                      const raw = parseInt(e.target.value, 10);
                      const next = (raw === 7 || raw === 30 ? raw : 1) as 1 | 7 | 30;
                      setHistoryCapDays(next);
                      showToast(
                        next === 1
                          ? "History will roll off after 1 day"
                          : next === 7
                          ? "History will roll off after 1 week"
                          : "History will roll off after 1 month",
                        "info",
                      );
                    }}
                  >
                    <option value={1}>1 day</option>
                    <option value={7}>1 week</option>
                    <option value={30}>1 month</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Achievement privacy — hides unlock percentages + rarity
             *  rings on the GamePage achievements panel + the
             *  AchievementsTab sidebar, since those can act as
             *  spoilers when the user is working through a list. */}
            <div className="settings-launcher-card">
              <label className="settings-checkbox-label">
                <input
                  type="checkbox"
                  checked={hideAchievementProgress}
                  onChange={(e) => {
                    setHideAchievementProgress(e.target.checked);
                    showToast(
                      e.target.checked
                        ? "Achievement progress hidden — no spoilers"
                        : "Achievement progress visible",
                      "info",
                    );
                  }}
                />
                <div className="settings-checkbox-text">
                  <span className="settings-checkbox-title">
                    Hide achievement progress (no spoilers)
                  </span>
                  <span className="settings-checkbox-desc">
                    Strips global unlock percentages and rarity rings
                    from the Achievements tab and Game page so
                    achievement lists read like a clean checklist.
                  </span>
                </div>
              </label>
            </div>

            {/* Local (crack / emulator) achievement tracking — watches
             *  crack/emulator achievement files on disk and merges them
             *  into the achievements cache (schema from the Hydra API),
             *  so cracked / downloaded games unlock achievements too. */}
            <div className="settings-launcher-card">
              <label className="settings-checkbox-label">
                <input
                  type="checkbox"
                  checked={achievementSettings.localAchievementsEnabled}
                  onChange={(e) => {
                    updateAchievementSettings({
                      localAchievementsEnabled: e.target.checked,
                    });
                    showToast(
                      e.target.checked
                        ? "Local achievement tracking enabled"
                        : "Local achievement tracking disabled",
                      "info",
                    );
                  }}
                />
                <div className="settings-checkbox-text">
                  <span className="settings-checkbox-title">
                    Track achievements for cracked / downloaded games
                  </span>
                  <span className="settings-checkbox-desc">
                    Watches local crack &amp; emulator achievement files
                    (Goldberg, CODEX, RUNE, OnlineFix, and more) and
                    unlocks achievements for non-Steam games. Achievement
                    details are fetched anonymously from the Hydra API.
                  </span>
                </div>
              </label>
            </div>

            {/* Discord rich presence — emits state to the
             *  discord-presence-update event when a game launches or
             *  exits. Currently a no-op attach point; the real
             *  renderer lives in lib.rs::emit_discord_presence. */}
            <div className="settings-launcher-card">
              <label className="settings-checkbox-label">
                <input
                  type="checkbox"
                  checked={discordRichPresence}
                  onChange={(e) => {
                    setDiscordRichPresence(e.target.checked);
                    showToast(
                      e.target.checked
                        ? "Discord rich presence will broadcast while playing"
                        : "Discord presence disabled",
                      "info",
                    );
                  }}
                />
                <div className="settings-checkbox-text">
                  <span className="settings-checkbox-title">
                    Show what you’re playing on Discord
                  </span>
                  <span className="settings-checkbox-desc">
                    Posts a “Playing X” status to your Discord profile
                    and clears it when the game exits.
                  </span>
                </div>
              </label>
            </div>
          </div>
        </section>
      )}

      {/* Downloads — manage download sources for finding game mirrors. */}
      {activeSettingsTab === "downloads" && (
        <>
          <section className="settings-section">
            <header className="settings-section-header">
              <span className="settings-section-icon"><DownloadIcon /></span>
              <div className="settings-section-header-text">
                <h2 className="settings-section-title">Default download location</h2>
                <p className="settings-section-desc">
                  Where quick-added magnet links and torrent URLs are saved.
                  When set, the Downloads page skips the folder picker unless
                  "Always ask" is enabled.
                </p>
              </div>
            </header>

            <div className="settings-card" style={{ padding: "var(--space-md)", display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
              <div className="dl-save-path" style={{ marginTop: 0 }}>
                <svg
                  className="dl-save-path-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                <span
                  className={`dl-save-path-text${defaultDownloadPath ? "" : " placeholder"}`}
                  title={defaultDownloadPath}
                >
                  {defaultDownloadPath || "No default folder — downloads will always prompt"}
                </span>
                <div style={{ display: "flex", gap: "var(--space-xs)", flexShrink: 0 }}>
                  <Button variant="secondary" size="sm" onClick={handlePickDefaultPath}>
                    {defaultDownloadPath ? "Change" : "Choose…"}
                  </Button>
                  {defaultDownloadPath && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDefaultDownloadPath("");
                        localStorage.removeItem("gamelib-default-download-path");
                        setAlwaysAskPath(true);
                        localStorage.setItem("gamelib-download-always-ask-path", "true");
                      }}
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </div>

              <label
                className="settings-checkbox-label"
                style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", opacity: defaultDownloadPath ? 1 : 0.5 }}
              >
                <input
                  type="checkbox"
                  checked={alwaysAskPath}
                  disabled={!defaultDownloadPath}
                  onChange={(e) => {
                    setAlwaysAskPath(e.target.checked);
                    localStorage.setItem("gamelib-download-always-ask-path", String(e.target.checked));
                  }}
                />
                <span>Always ask where to save (ignore the default folder)</span>
              </label>
            </div>
          </section>

          <section className="settings-section">
            <header className="settings-section-header">
              <span className="settings-section-icon"><DownloadIcon /></span>
              <div className="settings-section-header-text">
                <h2 className="settings-section-title">Notifications</h2>
                <p className="settings-section-desc">
                  Get notified when a download finishes so you can leave
                  transfers running in the background.
                </p>
              </div>
            </header>

            <div className="settings-card" style={{ padding: "var(--space-md)", display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
              <label className="settings-checkbox-label" style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={notifyComplete}
                  onChange={(e) => {
                    setNotifyComplete(e.target.checked);
                    localStorage.setItem("gamelib-download-notify-complete", String(e.target.checked));
                  }}
                />
                <span>Show an in-app toast when a download completes</span>
              </label>

              <label className="settings-checkbox-label" style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", opacity: notifyComplete ? 1 : 0.5 }}>
                <input
                  type="checkbox"
                  checked={notifyOs}
                  disabled={!notifyComplete}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setNotifyOs(on);
                    localStorage.setItem("gamelib-download-notify-os", String(on));
                    // Proactively request permission so the first real
                    // completion notification isn't swallowed while the
                    // browser prompt is still pending.
                    if (on && typeof Notification !== "undefined" && Notification.permission === "default") {
                      void Notification.requestPermission();
                    }
                  }}
                />
                <span>Also send a desktop notification</span>
              </label>
            </div>
          </section>

          <section className="settings-section">
            <header className="settings-section-header">
              <span className="settings-section-icon"><DownloadIcon /></span>
              <div className="settings-section-header-text">
                <h2 className="settings-section-title">Bandwidth limits</h2>
                <p className="settings-section-desc">
                  Control the maximum speed used for downloading and uploading game torrents.
                </p>
              </div>
            </header>

            <div className="settings-bandwidth-limits" style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
              <div className="settings-limit-row" style={{ display: "flex", alignItems: "center", gap: "var(--space-md)", flexWrap: "wrap" }}>
                <label className="settings-checkbox-label" style={{ minWidth: "220px", display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={dlLimitEnabled}
                    onChange={(e) => {
                      setDlLimitEnabled(e.target.checked);
                      void saveAndApplyLimits(e.target.checked, dlLimitValue, ulLimitEnabled, ulLimitValue, disableUpload);
                    }}
                  />
                  <span>Limit download speed</span>
                </label>
                {dlLimitEnabled && (
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)" }}>
                    <input
                      type="number"
                      className="src-form-input"
                      style={{ width: "120px", padding: "6px 12px", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", background: "var(--color-bg-secondary)", color: "var(--color-text-primary)" }}
                      min="1"
                      value={dlLimitValue || ""}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10) || 0;
                        setDlLimitValue(val);
                        void saveAndApplyLimits(dlLimitEnabled, val, ulLimitEnabled, ulLimitValue, disableUpload);
                      }}
                      placeholder="Speed"
                    />
                    <span style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-secondary)" }}>KB/s</span>
                  </div>
                )}
              </div>

              <div className="settings-limit-row" style={{ display: "flex", alignItems: "center", gap: "var(--space-md)", flexWrap: "wrap" }}>
                <label className="settings-checkbox-label" style={{ minWidth: "220px", display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", opacity: disableUpload ? 0.5 : 1 }}>
                  <input
                    type="checkbox"
                    checked={ulLimitEnabled}
                    disabled={disableUpload}
                    onChange={(e) => {
                      setUlLimitEnabled(e.target.checked);
                      void saveAndApplyLimits(dlLimitEnabled, dlLimitValue, e.target.checked, ulLimitValue, disableUpload);
                    }}
                  />
                  <span>Limit upload speed</span>
                </label>
                {ulLimitEnabled && !disableUpload && (
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)" }}>
                    <input
                      type="number"
                      className="src-form-input"
                      style={{ width: "120px", padding: "6px 12px", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", background: "var(--color-bg-secondary)", color: "var(--color-text-primary)" }}
                      min="1"
                      value={ulLimitValue || ""}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10) || 0;
                        setUlLimitValue(val);
                        void saveAndApplyLimits(dlLimitEnabled, dlLimitValue, ulLimitEnabled, val, disableUpload);
                      }}
                      placeholder="Speed"
                    />
                    <span style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-secondary)" }}>KB/s</span>
                  </div>
                )}
              </div>

              <div className="settings-limit-row">
                <label className="settings-checkbox-label" style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={disableUpload}
                    onChange={(e) => {
                      setDisableUpload(e.target.checked);
                      void saveAndApplyLimits(dlLimitEnabled, dlLimitValue, ulLimitEnabled, ulLimitValue, e.target.checked);
                    }}
                  />
                  <span>Disable upload completely (do not seed)</span>
                </label>
            </div>
          </div>

        </section>

          <section className="settings-section">
            <header className="settings-section-header">
              <span className="settings-section-icon"><DownloadIcon /></span>
              <div className="settings-section-header-text">
                <h2 className="settings-section-title">Blocked source domains</h2>
                <p className="settings-section-desc">
                  Domains listed here are filtered out of every
                  download search — nothing from these hosts appears
                  in the Download modal’s results list. One domain
                  per line.
                </p>
              </div>
            </header>

            <div className="settings-control" style={{ maxWidth: "480px" }}>
              <textarea
                className="settings-input"
                rows={5}
                placeholder="example-tracker.com&#10;suspicious-mirror.net"
                value={blockedSourceDomains.join("\n")}
                onChange={(e) => {
                  setBlockedSourceDomains(
                    e.target.value.split(/\r?\n/).map((line) => line.trim()),
                  );
                }}
                spellCheck={false}
                style={{ resize: "vertical", minHeight: "88px", fontFamily: "SFMono-Regular, Consolas, monospace" }}
              />
              <p className="settings-helper-text">
                Currently blocked: {blockedSourceDomains.length === 0 ? "none" : `${blockedSourceDomains.length} domain${blockedSourceDomains.length === 1 ? "" : "s"}`}
              </p>
            </div>
          </section>

          <section className="settings-section">
            <header className="settings-section-header">
              <span className="settings-section-icon"><DownloadIcon /></span>
              <div className="settings-section-header-text">
                <h2 className="settings-section-title">Download sources</h2>
                <p className="settings-section-desc">
                  Add JSON-formatted source URLs to find download mirrors for
                  your games. Sources use the Hydra-compatible format with a
                  <code> name </code>and a <code> downloads </code>array and
                  are registered with the Hydra API. The Download button on
                  any game's page will search your enabled sources.
                </p>
              </div>
            </header>
            <SourceManager />
          </section>

          <section className="settings-section">
            <header className="settings-section-header">
              <span className="settings-section-icon"><DownloadIcon /></span>
              <div className="settings-section-header-text">
                <h2 className="settings-section-title">Debrid Integration</h2>
                <p className="settings-section-desc">
                  Configure a debrid service (AllDebrid or TorBox) to download torrent magnet links via high-speed direct HTTP connections.
                </p>
              </div>
            </header>
            
            <div className="settings-card" style={{ padding: "var(--space-md)", display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
              <div className="settings-limit-row" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label className="settings-label" style={{ fontSize: "var(--font-size-sm)", fontWeight: "var(--font-weight-semibold)" }}>Debrid Provider</label>
                <select
                  value={debridProvider}
                  onChange={(e) => {
                    setDebridProvider(e.target.value);
                    localStorage.setItem("gamelib-debrid-provider", e.target.value);
                  }}
                  className="settings-select"
                  style={{
                    padding: "8px 12px",
                    background: "var(--color-bg-tertiary)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-md)",
                    color: "var(--color-text-primary)",
                    fontFamily: "inherit",
                    width: "100%",
                    maxWidth: "320px"
                  }}
                >
                  <option value="none">Disabled</option>
                  <option value="alldebrid">AllDebrid</option>
                  <option value="torbox">TorBox</option>
                </select>
              </div>

              {debridProvider !== "none" && (
                <>
                  <div className="settings-limit-row" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <label className="settings-label" style={{ fontSize: "var(--font-size-sm)", fontWeight: "var(--font-weight-semibold)" }}>API Key / Token</label>
                    <div style={{ display: "flex", gap: "8px", maxWidth: "480px" }}>
                      <input
                        type="password"
                        value={debridApiKey}
                        onChange={(e) => {
                          setDebridApiKey(e.target.value);
                          localStorage.setItem("gamelib-debrid-apikey", e.target.value);
                        }}
                        placeholder="Paste your API key here..."
                        style={{
                          flex: 1,
                          padding: "8px 12px",
                          background: "var(--color-bg-tertiary)",
                          border: "1px solid var(--color-border)",
                          borderRadius: "var(--radius-md)",
                          color: "var(--color-text-primary)",
                          fontFamily: "inherit",
                        }}
                      />
                      <Button
                        variant="primary"
                        onClick={handleTestDebrid}
                        disabled={testingDebrid || !debridApiKey}
                      >
                        {testingDebrid ? "Testing..." : "Test Connection"}
                      </Button>
                    </div>
                  </div>

                  <p className="settings-help-text" style={{ marginTop: "var(--space-xs)", fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
                    Debrid is used <strong>only</strong> to unrestrict direct download links. Magnet URIs
                    and <code>.torrent</code> file URLs always go through the P2P torrent engine, regardless
                    of this setting.
                  </p>
                </>
              )}
            </div>
          </section>
        </>
      )}

      {/* Launcher — startup, window, and launch behaviour */}
      {activeSettingsTab === "launcher" && (
        <section className="settings-section">
          <header className="settings-section-header">
            <span className="settings-section-icon"><RocketIcon /></span>
            <div className="settings-section-header-text">
              <h2 className="settings-section-title">Launcher behaviour</h2>
              <p className="settings-section-desc">
                Decide what Gamelib does at boot, when you launch a game,
                and how the window itself behaves.
              </p>
            </div>
          </header>

          <div className="settings-launcher-grid">
            {/* Landing page — where the app routes on open */}
            <div className="settings-launcher-card">
              <div className="settings-control">
                <label className="settings-label" htmlFor="settings-landing-page">
                  Default landing page
                </label>
                <p className="settings-helper-lead">
                  Which route opens when Gamelib launches. Useful if your
                  workflow starts in Activity, Downloads, or Deals rather
                  than the Library.
                </p>
                <div className="settings-input-group">
                  <select
                    id="settings-landing-page"
                    className="settings-select"
                    value={landingPage}
                    onChange={(e) => {
                      const next = e.target.value as LandingPage;
                      setLandingPage(next);
                      showToast(
                        `Default page set to ${next.charAt(0).toUpperCase() + next.slice(1)}`,
                        "success",
                      );
                    }}
                  >
                    <option value="home">✨ Home</option>
                    <option value="library">📚 Library</option>
                    <option value="store">🏬 Store</option>
                    <option value="wishlist">❤️ Wishlist</option>
                    <option value="deals">💰 Deals</option>
                    <option value="activity">📊 Activity</option>
                    <option value="achievements">🏆 Achievements</option>
                    <option value="downloads">⬇️ Downloads</option>
                    <option value="storage">💾 Storage</option>
                    <option value="news">📰 News</option>
                    <option value="community">📊 Stats</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Close-to-tray — closes-to-tray instead of exiting */}
            <div className="settings-launcher-card">
              <label className="settings-checkbox-label">
                <input
                  type="checkbox"
                  checked={closeToTray}
                  disabled={!ready}
                  onChange={(e) => {
                    void setCloseToTray(e.target.checked);
                    showToast(
                      e.target.checked
                        ? "Closing will now minimize to tray"
                        : "Closing will now exit Gamelib",
                      "info",
                    );
                  }}
                />
                <div className="settings-checkbox-text">
                  <span className="settings-checkbox-title">
                    Close to tray instead of quitting
                  </span>
                  <span className="settings-checkbox-desc">
                    Clicking the × keeps the launcher running in the
                    background. Right-click the tray icon to quit
                    for real.
                  </span>
                </div>
              </label>
            </div>

            {/* Minimize on game launch */}
            <div className="settings-launcher-card">
              <label className="settings-checkbox-label">
                <input
                  type="checkbox"
                  checked={minimizeOnLaunch}
                  disabled={!ready}
                  onChange={(e) => {
                    void setMinimizeOnLaunch(e.target.checked);
                    showToast(
                      e.target.checked
                        ? "Gamelib will minimize when you launch a game"
                        : "Gamelib will stay open while you play",
                      "info",
                    );
                  }}
                />
                <div className="settings-checkbox-text">
                  <span className="settings-checkbox-title">
                    Minimize when a game starts
                  </span>
                  <span className="settings-checkbox-desc">
                    Drops the launcher out of the way while a game is
                    in the foreground — useful for one-monitor
                    set-ups.
                  </span>
                </div>
              </label>
            </div>

            {/* Auto-start on boot (system tray) */}
            <div className="settings-launcher-card">
              <label className="settings-checkbox-label">
                <input
                  type="checkbox"
                  checked={autoStartEnabled}
                  disabled={!ready}
                  onChange={(e) => {
                    // Optimistic flip for snappy UX; revert + toast on error
                    const target = e.target.checked;
                    showToast(
                      target
                        ? "Enabling auto-launch on boot…"
                        : "Disabling auto-launch…",
                      "info",
                    );
                    setAutoStartEnabled(target).catch((err) => {
                      showToast(`Auto-launch failed: ${err}`, "error");
                    });
                  }}
                />
                <div className="settings-checkbox-text">
                  <span className="settings-checkbox-title">
                    Start Gamelib when you sign in
                  </span>
                  <span className="settings-checkbox-desc">
                    Registers the app in your OS startup list (Windows
                    Registry / macOS Login Items / Linux .desktop).
                  </span>
                </div>
              </label>
            </div>

            {/* Disable UAC elevation prompts */}
            <div className="settings-launcher-card settings-launcher-card--warn">
              <label className="settings-checkbox-label">
                <input
                  type="checkbox"
                  checked={disableElevationPrompts}
                  disabled={!ready}
                  onChange={(e) => {
                    void setDisableElevationPrompts(e.target.checked);
                    showToast(
                      e.target.checked
                        ? "UAC prompts disabled — games may fail to launch"
                        : "UAC prompts re-enabled",
                      "info",
                    );
                  }}
                />
                <div className="settings-checkbox-text">
                  <span className="settings-checkbox-title">
                    Never request elevation (UAC prompt)
                  </span>
                  <span className="settings-checkbox-desc">
                    Suppresses the Windows "run as administrator"
                    prompt when a game requires it. Games that genuinely
                    need elevation will silently fail to launch —
                    leave off unless you know what you're doing.
                  </span>
                </div>
              </label>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function RocketIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22 22 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

/* ── Inline icons ─────────────────────────────────────────────────── */

function RefreshIcon() {
  return (
    <svg
      className="settings-btn-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function SteamIcon() {
  // Real Steam brand glyph (Simple Icons / CC0), in Steam blue.
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
      <path
        fill="#66c0f4"
        d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z"
      />
    </svg>
  );
}

function EpicIcon() {
  // Real Epic Games brand mark (Simple Icons / CC0), white for the dark tile.
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
      <path
        fill="#ffffff"
        d="M3.537 0C2.165 0 1.66.506 1.66 1.879V18.44a4.262 4.262 0 0 0 .02.433c.031.3.037.59.316.92.027.033.311.245.311.245.153.075.258.13.43.2l8.335 3.491c.433.199.614.276.928.27h.002c.314.006.495-.071.928-.27l8.335-3.492c.172-.07.277-.124.43-.2 0 0 .284-.211.311-.243.28-.33.285-.621.316-.92a4.261 4.261 0 0 0 .02-.434V1.879c0-1.373-.506-1.88-1.878-1.88zm13.366 3.11h.68c1.138 0 1.688.553 1.688 1.696v1.88h-1.374v-1.8c0-.369-.17-.54-.523-.54h-.235c-.367 0-.537.17-.537.539v5.81c0 .369.17.54.537.54h.262c.353 0 .523-.171.523-.54V8.619h1.373v2.143c0 1.144-.562 1.71-1.7 1.71h-.694c-1.138 0-1.7-.566-1.7-1.71V4.82c0-1.144.562-1.709 1.7-1.709zm-12.186.08h3.114v1.274H6.117v2.603h1.648v1.275H6.117v2.774h1.74v1.275h-3.14zm3.816 0h2.198c1.138 0 1.7.564 1.7 1.708v2.445c0 1.144-.562 1.71-1.7 1.71h-.799v3.338h-1.4zm4.53 0h1.4v9.201h-1.4zm-3.13 1.235v3.392h.575c.354 0 .523-.171.523-.54V4.965c0-.368-.17-.54-.523-.54zm-3.74 10.147a1.708 1.708 0 0 1 .591.108 1.745 1.745 0 0 1 .49.299l-.452.546a1.247 1.247 0 0 0-.308-.195.91.91 0 0 0-.363-.068.658.658 0 0 0-.28.06.703.703 0 0 0-.224.163.783.783 0 0 0-.151.243.799.799 0 0 0-.056.299v.008a.852.852 0 0 0 .056.31.7.7 0 0 0 .157.245.736.736 0 0 0 .238.16.774.774 0 0 0 .303.058.79.79 0 0 0 .445-.116v-.339h-.548v-.565H7.37v1.255a2.019 2.019 0 0 1-.524.307 1.789 1.789 0 0 1-.683.123 1.642 1.642 0 0 1-.602-.107 1.46 1.46 0 0 1-.478-.3 1.371 1.371 0 0 1-.318-.455 1.438 1.438 0 0 1-.115-.58v-.008a1.426 1.426 0 0 1 .113-.57 1.449 1.449 0 0 1 .312-.46 1.418 1.418 0 0 1 .474-.309 1.58 1.58 0 0 1 .598-.111 1.708 1.708 0 0 1 .045 0zm11.963.008a2.006 2.006 0 0 1 .612.094 1.61 1.61 0 0 1 .507.277l-.386.546a1.562 1.562 0 0 0-.39-.205 1.178 1.178 0 0 0-.388-.07.347.347 0 0 0-.208.052.154.154 0 0 0-.07.127v.008a.158.158 0 0 0 .022.084.198.198 0 0 0 .076.066.831.831 0 0 0 .147.06c.062.02.14.04.236.061a3.389 3.389 0 0 1 .43.122 1.292 1.292 0 0 1 .328.17.678.678 0 0 1 .207.24.739.739 0 0 1 .071.337v.008a.865.865 0 0 1-.081.382.82.82 0 0 1-.229.285 1.032 1.032 0 0 1-.353.18 1.606 1.606 0 0 1-.46.061 2.16 2.16 0 0 1-.71-.116 1.718 1.718 0 0 1-.593-.346l.43-.514c.277.223.578.335.9.335a.457.457 0 0 0 .236-.05.157.157 0 0 0 .082-.142v-.008a.15.15 0 0 0-.02-.077.204.204 0 0 0-.073-.066.753.753 0 0 0-.143-.062 2.45 2.45 0 0 0-.233-.062 5.036 5.036 0 0 1-.413-.113 1.26 1.26 0 0 1-.331-.16.72.72 0 0 1-.222-.243.73.73 0 0 1-.082-.36v-.008a.863.863 0 0 1 .074-.359.794.794 0 0 1 .214-.283 1.007 1.007 0 0 1 .34-.185 1.423 1.423 0 0 1 .448-.066 2.006 2.006 0 0 1 .025 0zm-9.358.025h.742l1.183 2.81h-.825l-.203-.499H8.623l-.198.498h-.81zm2.197.02h.814l.663 1.08.663-1.08h.814v2.79h-.766v-1.602l-.711 1.091h-.016l-.707-1.083v1.593h-.754zm3.469 0h2.235v.658h-1.473v.422h1.334v.61h-1.334v.442h1.493v.658h-2.255zm-5.3.897l-.315.793h.624zm-1.145 5.19h8.014l-4.09 1.348z"
      />
    </svg>
  );
}

function GogIcon() {
  // Real GOG.com brand wordmark (Simple Icons / CC0), in GOG purple.
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
      <path
        fill="#86328A"
        d="M7.15 15.24H4.36a.4.4 0 0 0-.4.4v2c0 .21.18.4.4.4h2.8v1.32h-3.5c-.56 0-1.02-.46-1.02-1.03v-3.39c0-.56.46-1.02 1.03-1.02h3.48v1.32zM8.16 11.54c0 .58-.47 1.05-1.05 1.05H2.63v-1.35h3.78a.4.4 0 0 0 .4-.4V6.39a.4.4 0 0 0-.4-.4H4.39a.4.4 0 0 0-.41.4v2.02c0 .23.18.4.4.4H6v1.35H3.68c-.58 0-1.05-.46-1.05-1.04V5.68c0-.57.47-1.04 1.05-1.04H7.1c.58 0 1.05.47 1.05 1.04v5.86zM21.36 19.36h-1.32v-4.12h-.93a.4.4 0 0 0-.4.4v3.72h-1.33v-4.12h-.93a.4.4 0 0 0-.4.4v3.72h-1.33v-4.42c0-.56.46-1.02 1.03-1.02h5.61v5.44zM21.37 11.54c0 .58-.47 1.05-1.05 1.05h-4.48v-1.35h3.78a.4.4 0 0 0 .4-.4V6.39a.4.4 0 0 0-.4-.4h-2.03a.4.4 0 0 0-.4.4v2.02c0 .23.18.4.4.4h1.62v1.35H16.9c-.58 0-1.05-.46-1.05-1.04V5.68c0-.57.47-1.04 1.05-1.04h3.43c.58 0 1.05.47 1.05 1.04v5.86zM13.72 4.64h-3.44c-.58 0-1.04.47-1.04 1.04v3.44c0 .58.46 1.04 1.04 1.04h3.44c.57 0 1.04-.46 1.04-1.04V5.68c0-.57-.47-1.04-1.04-1.04m-.3 1.75v2.02a.4.4 0 0 1-.4.4h-2.03a.4.4 0 0 1-.4-.4V6.4c0-.22.17-.4.4-.4H13c.23 0 .4.18.4.4zM12.63 13.92H9.24c-.57 0-1.03.46-1.03 1.02v3.39c0 .57.46 1.03 1.03 1.03h3.39c.57 0 1.03-.46 1.03-1.03v-3.39c0-.56-.46-1.02-1.03-1.02m-.3 1.72v2a.4.4 0 0 1-.4.4v-.01H9.94a.4.4 0 0 1-.4-.4v-1.99c0-.22.18-.4.4-.4h2c.22 0 .4.18.4.4zM23.49 1.1a1.74 1.74 0 0 0-1.24-.52H1.75A1.74 1.74 0 0 0 0 2.33v19.34a1.74 1.74 0 0 0 1.75 1.75h20.5A1.74 1.74 0 0 0 24 21.67V2.33c0-.48-.2-.92-.51-1.24m0 20.58a1.23 1.23 0 0 1-1.24 1.24H1.75A1.23 1.23 0 0 1 .5 21.67V2.33a1.23 1.23 0 0 1 1.24-1.24h20.5a1.24 1.24 0 0 1 1.24 1.24v19.34z"
      />
    </svg>
  );
}

function HumbleIcon() {
  // Real Humble Bundle brand glyph (Simple Icons / CC0), white.
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
      <path
        fill="#ffffff"
        d="M17.895 19.341c-3.384 0 1.826-19.186 1.826-19.186L16.233.151s-1.427 4.515-2.37 9.533h-3.005c.078-1.032.116-2.076.099-3.114-.135-8.26-4.974-6.73-7.14-4.835C1.758 3.538.033 6.962 0 9.6c.328-.016 1.624-.022 1.624-.022S2.702 4.66 6.086 4.66c3.385 0-1.834 19.187-1.834 19.187l3.49.002s1.803-5.136 2.7-10.872l2.87-.017c-.167 1.485-.22 3.124-.196 4.646.136 8.26 4.956 6.488 7.122 4.593 2.166-1.896 3.782-5.9 3.762-7.822.002-.002-1.645.013-1.665.013.006.152-1.056 4.951-4.44 4.951z"
      />
    </svg>
  );
}

function RockstarIcon() {
  // Real Rockstar Games brand glyph (official logo), in Rockstar gold (#ffd344).
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
      <path
        fill="#ffd344"
        d="m15.879 13.997-0.406-2.551-1.493 2.531h-0.284c-0.17-0.293-0.236-0.718-0.236-0.983 0-0.435 0.028-0.86 0.028-1.417 0-0.737-0.217-1.125-0.794-1.266v-0.019c1.219-0.17 1.776-0.983 1.776-2.117 0-1.616-1.078-1.965-2.484-1.965H8.198l-1.606 7.598h2.013l0.586-2.768h1.342c0.718 0 1.011 0.35 1.011 1.02 0 0.51-0.057 0.917-0.057 1.304 0 0.141 0.028 0.482 0.132 0.614l1.455 1.54L11.816 18.211l2.684-1.597 2.003 1.54-0.369-2.542 2.306-1.616zM11.136 9.622H9.53l0.387-1.833h1.493c0.529 0 1.087 0.141 1.087 0.784 0 0.822-0.633 1.049-1.361 1.049z"
      />
    </svg>
  );
}

function UplayIcon() {
  // Real Ubisoft brand glyph (Simple Icons / CC0), in Ubisoft blue (#00aae4).
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
      <path
        fill="#00aae4"
        d="M23.561 11.988C23.301-.304 6.954-4.89.656 6.634c.282.206.661.477.943.672a11.747 11.747 0 00-.976 3.067 11.885 11.885 0 00-.184 2.071C.439 18.818 5.621 24 12.005 24c6.385 0 11.556-5.17 11.556-11.556v-.455zm-20.27 2.06c-.152 1.246-.054 1.636-.054 1.788l-.282.098c-.108-.206-.37-.932-.488-1.908C2.163 10.308 4.7 6.96 8.57 6.33c3.544-.52 6.937 1.68 7.728 4.758l-.282.098c-.087-.087-.228-.336-.77-.878-4.281-4.281-11.002-2.32-11.956 3.74zm11.002 2.081a3.145 3.145 0 01-2.59 1.355 3.15 3.15 0 01-3.155-3.155 3.159 3.159 0 012.927-3.144c1.018-.043 1.972.51 2.416 1.398a2.58 2.58 0 01-.455 2.95c.293.205.575.4.856.595zm6.58.12c-1.669 3.782-5.106 5.766-8.77 5.712-7.034-.347-9.083-8.466-4.38-11.393l.207.206c-.076.108-.358.325-.791 1.182-.51 1.041-.672 2.081-.607 2.732.369 5.67 8.314 6.83 11.045 1.214C21.057 8.217 11.822.401 3.626 6.374l-.184-.184C5.599 2.808 9.816 1.3 13.837 2.309c6.147 1.55 9.453 7.956 7.035 13.94z"
      />
    </svg>
  );
}

function UplayToggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="humble-toggle">
      <span className="humble-toggle-text">
        <span className="humble-toggle-label">{label}</span>
        {hint && <span className="humble-toggle-hint">{hint}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

function HumbleToggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={`humble-toggle ${disabled ? "disabled" : ""}`}>
      <span className="humble-toggle-text">
        <span className="humble-toggle-label">{label}</span>
        {hint && <span className="humble-toggle-hint">{hint}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

function IntegrationsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="14"
      height="14"
      aria-hidden
    >
      <rect x="2" y="2" width="7" height="7" rx="1" />
      <rect x="15" y="2" width="7" height="7" rx="1" />
      <rect x="2" y="15" width="7" height="7" rx="1" />
      <rect x="15" y="15" width="7" height="7" rx="1" />
    </svg>
  );
}

function PaletteIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      <path d="M2 12h20" />
    </svg>
  );
}

function HardwareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2" y="2" width="20" height="20" rx="2" />
      <path d="M7 2v20" />
      <path d="M17 2v20" />
      <path d="M2 12h20" />
      <path d="M2 7h5" />
      <path d="M2 17h5" />
      <path d="M17 17h5" />
      <path d="M17 7h5" />
    </svg>
  );
}

function SettingsGearIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
