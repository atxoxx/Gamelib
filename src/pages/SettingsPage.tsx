import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

import { useToast } from "../context/ToastContext";
import { useActivity } from "../context/ActivityContext";
import { useGames } from "../context/GameContext";
import { useSources } from "../context/SourceContext";
import { useTheme, type ThemeDescriptor } from "../context/ThemeContext";
import type { SteamSyncResult, SteamSettings, SteamSession, SteamAuthState } from "../types/steam";
import type { EpicAuthState, EpicSyncResult } from "../types/epic";
import type { GogAuthState, GogSyncResult } from "../types/gog";
import { formatPlayTime, type Game, type SizeUnit } from "../types/game";
import { useSizeUnit } from "../hooks/useSizeUnit";
import { useAchievements } from "../context/AchievementContext";
import SourceManager from "../components/SourceManager";
import { useDownloads } from "../context/DownloadContext";
import { Button } from "../components/ui";

/** Maps theme ids to preview colors — kept in sync with App.css overrides. */
const THEME_PREVIEW_COLORS: Record<string, { bg: string; text: string; accent: string }> = {
  dark:      { bg: "#0a0c10", text: "#f0f2f7", accent: "#7c66ff" },
  light:     { bg: "#f8fafc", text: "#0f172a", accent: "#7c3aed" },
  nord:      { bg: "#2e3440", text: "#eceff4", accent: "#88c0d0" },
  cyberpunk: { bg: "#050508", text: "#f0f2f5", accent: "#00f0ff" },
  emerald:   { bg: "#08110c", text: "#ecf3ee", accent: "#10b981" },
  dracula:   { bg: "#1e1f29", text: "#f8f8f2", accent: "#bd93f9" },
};

const DESCRIPTOR_LABELS: Record<ThemeDescriptor, string> = {
  vibrant: "🎮 Vibrant",
  calm: "🧘 Calm",
  "high-contrast": "♿ High Contrast",
  minimal: "✨ Minimal",
};

type SettingsTab = "appearance" | "hardware" | "integrations" | "downloads";

export default function SettingsPage() {
  const { showToast } = useToast();
  const { availableGpus, selectedGpu, setSelectedGpu, refreshGpus } = useActivity();
  const { games, addGames, updateGame } = useGames();
  const { reloadCache } = useAchievements();
  const { sources } = useSources();
  const { unit: sizeUnit, setUnit: setSizeUnit } = useSizeUnit();
  const { currentTheme, setTheme, themes, systemSync, setSystemSync } = useTheme();
  const { updateSpeedLimits } = useDownloads();

  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>("appearance");

  // Speed Limit Settings State
  const [dlLimitEnabled, setDlLimitEnabled] = useState(false);
  const [dlLimitValue, setDlLimitValue] = useState(0);
  const [ulLimitEnabled, setUlLimitEnabled] = useState(false);
  const [ulLimitValue, setUlLimitValue] = useState(0);
  const [disableUpload, setDisableUpload] = useState(false);

  // Load limits on mount
  useEffect(() => {
    try {
      setDlLimitEnabled(localStorage.getItem("gamelib-dl-limit-download-enabled") === "true");
      setDlLimitValue(parseInt(localStorage.getItem("gamelib-dl-limit-download-value") || "0", 10));
      setUlLimitEnabled(localStorage.getItem("gamelib-dl-limit-upload-enabled") === "true");
      setUlLimitValue(parseInt(localStorage.getItem("gamelib-dl-limit-upload-value") || "0", 10));
      setDisableUpload(localStorage.getItem("gamelib-dl-limit-disable-upload") === "true");
    } catch (e) {
      console.error("Failed to load speed limit settings:", e);
    }
  }, []);

  // Debrid Settings State
  const [debridProvider, setDebridProvider] = useState("none");
  const [debridApiKey, setDebridApiKey] = useState("");
  const [fallbackTorrent, setFallbackTorrent] = useState(true);
  const [testingDebrid, setTestingDebrid] = useState(false);

  // Load Debrid on mount
  useEffect(() => {
    setDebridProvider(localStorage.getItem("gamelib-debrid-provider") || "none");
    setDebridApiKey(localStorage.getItem("gamelib-debrid-apikey") || "");
    setFallbackTorrent(localStorage.getItem("gamelib-debrid-fallback-torrent") !== "false");
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
    syncAchievements: true,
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
        await handleSyncNow(session);
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
      localStorage.setItem("gamelib-epic-sync-info", JSON.stringify(tokens));
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
    } catch (err) {
      showToast(`Failed: ${err}`, "error");
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

  // Live count of connected integrations — drives the badge on the
  // Integrations pill in the sub-nav. Lints to 0 when none are
  // connected and to 3 when Steam + Epic + GOG are all linked.
  const connectedIntegrations =
    (steamAuth.isAuthenticated ? 1 : 0) +
    (epicAuth.isAuthenticated ? 1 : 0) +
    (gogAuth.isAuthenticated ? 1 : 0);

  return (
    <div className="settings-container">
      <header className="settings-header">
        <div className="settings-header-text">
          <h1 className="settings-title">
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

          <p className="integration-footer">
            More integrations coming soon — itch.io and more.
          </p>
        </section>
      )}

      {/* Downloads — manage download sources for finding game mirrors. */}
      {activeSettingsTab === "downloads" && (
        <>
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

                  <div className="settings-limit-row">
                    <label className="settings-checkbox-label" style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={fallbackTorrent}
                        onChange={(e) => {
                          setFallbackTorrent(e.target.checked);
                          localStorage.setItem("gamelib-debrid-fallback-torrent", String(e.target.checked));
                        }}
                      />
                      <span>Fallback to standard torrent download if magnet is not cached</span>
                    </label>
                  </div>
                </>
              )}
            </div>
          </section>
        </>
      )}
    </div>
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
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm-3-4c0 1.66 1.34 3 3 3s3-1.34 3-3-1.34-3-3-3-3 1.34-3 3z" />
    </svg>
  );
}

function EpicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
      <path d="M12 2L2 7l1.5 9L12 22l8.5-6L22 7 12 2zm0 2.5l7.5 4-1.3 7.8L12 19.5l-6.2-3.2L4.5 8.5 12 4.5z" />
    </svg>
  );
}

function GogIcon() {
  // Stylised G mark — a chunky stroked ring with a small notch on
  // the right edge (mirroring GOG.com's "open circle + tail" logo).
  // Inline SVG keeps the icon-themeable via `currentColor`.
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 2a8 8 0 0 1 7.74 6H14v3h5.74A8 8 0 0 1 12 20.5 8.5 8.5 0 0 1 3.5 12 8.5 8.5 0 0 1 12 4z" />
    </svg>
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
