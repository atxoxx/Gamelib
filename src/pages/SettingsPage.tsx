import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

import { useToast } from "../context/ToastContext";
import { useActivity } from "../context/ActivityContext";
import { useGames } from "../context/GameContext";
import { useSources } from "../context/SourceContext";
import type { SteamSyncResult, SteamSettings, SteamSession, SteamAuthState } from "../types/steam";
import type { EpicAuthState, EpicSyncResult } from "../types/epic";
import { formatPlayTime, type Game, type SizeUnit } from "../types/game";
import { useSizeUnit } from "../hooks/useSizeUnit";
import SourceManager from "../components/SourceManager";

interface ThemeOption {
  id: string;
  name: string;
  // `bg` / `text` / `accent` come from the actual `:root[data-theme="<id>"]`
  // tokens so theme-card previews stay true to the live theme.
  colors: { bg: string; text: string; accent: string };
}

const themes: ThemeOption[] = [
  { id: "dark", name: "Default Dark", colors: { bg: "#0f1117", text: "#e8eaed", accent: "#6c5ce7" } },
  { id: "light", name: "Light Mode", colors: { bg: "#f3f4f6", text: "#1f2937", accent: "#7c3aed" } },
  { id: "nord", name: "Nord Ice", colors: { bg: "#2e3440", text: "#eceff4", accent: "#88c0d0" } },
  { id: "cyberpunk", name: "Cyberpunk", colors: { bg: "#0c0817", text: "#f0f2f5", accent: "#ff007f" } },
  { id: "emerald", name: "Emerald", colors: { bg: "#08110c", text: "#ecf3ee", accent: "#10b981" } },
  { id: "dracula", name: "Dracula", colors: { bg: "#1e1f29", text: "#f8f8f2", accent: "#bd93f9" } },
];

type SettingsTab = "appearance" | "hardware" | "integrations" | "downloads";

export default function SettingsPage() {
  const { showToast } = useToast();
  const { availableGpus, selectedGpu, setSelectedGpu, refreshGpus } = useActivity();
  const { games, addGames } = useGames();
  const { sources } = useSources();
  const { unit: sizeUnit, setUnit: setSizeUnit } = useSizeUnit();

  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>("appearance");

  // Steam integration state
  const [steamAuth, setSteamAuth] = useState<SteamAuthState>({ isAuthenticated: false });
  const [isSteamLoggingIn, setIsSteamLoggingIn] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SteamSyncResult | null>(null);
  const [steamSettings, setSteamSettings] = useState<SteamSettings>({
    autoSyncOnLaunch: true,
    syncPlaytime: true,
    syncAchievements: true,
  });

  // Epic integration state
  const [epicAuth, setEpicAuth] = useState<EpicAuthState>({ isAuthenticated: false });
  const [epicSyncResult, setEpicSyncResult] = useState<EpicSyncResult | null>(null);
  const [isEpicLoggingIn, setIsEpicLoggingIn] = useState(false);
  const [isEpicSyncing, setIsEpicSyncing] = useState(false);

  // Theme state
  const [currentTheme, setCurrentTheme] = useState("dark");

  useEffect(() => {
    const theme = localStorage.getItem("gamelib-theme") || "dark";
    setCurrentTheme(theme);

    (async () => {
      try {
        const session: SteamSession | null = await invoke("steam_get_session");
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
    })();

    (async () => {
      try {
        const authenticated: boolean = await invoke("epic_is_authenticated");
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

    try {
      const saved = localStorage.getItem("gamelib-steam-settings");
      if (saved) setSteamSettings(JSON.parse(saved));
    } catch { /* keep defaults */ }
  }, []);

  function handleThemeChange(themeId: string) {
    setCurrentTheme(themeId);
    localStorage.setItem("gamelib-theme", themeId);
    document.documentElement.setAttribute("data-theme", themeId);
    showToast(`Theme changed to ${themes.find((t) => t.id === themeId)?.name}`, "success");
  }

  async function handleSteamLogin() {
    setIsSteamLoggingIn(true);
    try {
      showToast("A login window will open — log in to Steam there", "info");
      const resultJson: string = await invoke("steam_start_login");

      // Finish login — persists session to disk
      const session: SteamSession = await invoke("steam_finish_login", { sessionData: resultJson });
      setSteamAuth({ isAuthenticated: true, session });

      localStorage.setItem("gamelib-steam-sync-info", JSON.stringify({
        displayName: session.displayName,
      }));
      showToast(`Connected to Steam${session.displayName ? ` as ${session.displayName}` : ""}`, "success");

      // Auto-sync after login — token-based API call, no manual data passing
      await handleSyncNow(session);
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
          });
        }
        if (newGames.length > 0) {
          addGames(newGames);
          showToast(`Synced ${g} games · ${p} playtime updates (${newGames.length} new)`, "success");
        } else {
          showToast(`Synced ${g} games · ${p} playtime updates (all already in library)`, "success");
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
          });
        }
        if (newGames.length > 0) {
          addGames(newGames);
          showToast(`Synced ${result.gamesImported} Epic games · ${newGames.length} new`, "success");
        } else {
          showToast(`Synced ${result.gamesImported} Epic games (all already in library)`, "success");
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

  // Live count of connected integrations — drives the badge on the
  // Integrations pill in the sub-nav. Lints nicely to 0 when neither is
  // connected and to 2 when both are.
  const connectedIntegrations =
    (steamAuth.isAuthenticated ? 1 : 0) + (epicAuth.isAuthenticated ? 1 : 0);

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
                        "--miniBg": theme.colors.bg,
                        "--miniText": theme.colors.text,
                        "--miniAccent": theme.colors.accent,
                      } as React.CSSProperties
                    }
                  >
                    <div className="theme-preview-bar">
                      <div className="theme-preview-color" style={{ backgroundColor: theme.colors.bg }} />
                      <div className="theme-preview-color" style={{ backgroundColor: theme.colors.text }} />
                      <div className="theme-preview-color" style={{ backgroundColor: theme.colors.accent }} />
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
                    <span className="theme-card-name">{theme.name}</span>
                    {isActive && <span className="theme-active-dot" aria-hidden />}
                  </div>
                </div>
              );
            })}
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
          <div className="settings-row">
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
                <button type="button" className="settings-btn" onClick={refreshGpus}>
                  <RefreshIcon /> Refresh
                </button>
              </div>
            </div>
          </div>

          {/* Storage — display unit for the Storage tab's size column.
           *  Lives under Hardware because it controls how physical
           *  resources are reported, not how the UI looks. */}
          <div className="settings-row settings-row--spaced">
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
                    achievements with one-click WebView login.
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
                  Your session data stays local — no API key needed.
                </p>

                <div className="integration-tile-actions">
                  {steamAuth.isAuthenticated ? (
                    <button
                      type="button"
                      className="btn btn-primary btn-steam"
                      onClick={() => handleSyncNow()}
                      disabled={isSyncing}
                    >
                      {isSyncing ? <><span className="spinner" /> Syncing…</> : "Sync Library"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary btn-steam"
                      onClick={handleSteamLogin}
                      disabled={isSteamLoggingIn}
                    >
                      {isSteamLoggingIn ? <><span className="spinner" /> Waiting for login…</> : "Connect Steam Account"}
                    </button>
                  )}
                </div>

                {syncResult && (
                  <div className={`sync-result ${syncResult.success ? "success" : "error"}`}>
                    {syncResult.success
                      ? `✓ Synced ${syncResult.gamesSynced ?? 0} games · ${syncResult.playtimeUpdated ?? 0} playtime updates`
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
                    <label className="settings-checkbox-label settings-checkbox-label--disabled">
                      <input type="checkbox" disabled />
                      <span>Achievements sync not available with WebView login</span>
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
                <button type="button" className="btn btn-danger btn-sm" onClick={handleDisconnect}>
                  Disconnect
                </button>
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
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleEpicSync}
                      disabled={isEpicSyncing}
                    >
                      {isEpicSyncing ? <><span className="spinner" /> Syncing…</> : "Sync Library"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleEpicLogin}
                      disabled={isEpicLoggingIn}
                    >
                      {isEpicLoggingIn ? <><span className="spinner" /> Waiting for login…</> : "Connect Epic Account"}
                    </button>
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
                <button type="button" className="btn btn-danger btn-sm" onClick={handleEpicDisconnect}>
                  Disconnect
                </button>
              </div>
            )}
          </div>

          <p className="integration-footer">
            More integrations coming soon — GOG and more.
          </p>
        </section>
      )}

      {/* Downloads — manage download sources for finding game mirrors. */}
      {activeSettingsTab === "downloads" && (
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
