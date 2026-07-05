import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useToast } from "../context/ToastContext";
import { useActivity } from "../context/ActivityContext";
import { useGames } from "../context/GameContext";
import type { SteamApiConfig, SteamSyncResult, SteamSettings } from "../types/steam";
import { formatPlayTime, type Game } from "../types/game";

interface ThemeOption {
  id: string;
  name: string;
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

export default function SettingsPage() {
  const { showToast } = useToast();
  const { availableGpus, selectedGpu, setSelectedGpu, refreshGpus } = useActivity();
  const { games, addGames } = useGames();

  const [activeSettingsTab, setActiveSettingsTab] = useState<
    "appearance" | "directories" | "hardware" | "system" | "integrations"
  >("appearance");

  // Steam integration state
  const [steamConfig, setSteamConfig] = useState<SteamApiConfig | null>(null);
  const [steamApiKey, setSteamApiKey] = useState("");
  const [steamId, setSteamId] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SteamSyncResult | null>(null);
  const [steamSettings, setSteamSettings] = useState<SteamSettings>({
    autoSyncOnLaunch: true,
    syncPlaytime: true,
    syncAchievements: true,
  });

  // Theme state
  const [currentTheme, setCurrentTheme] = useState("dark");
  const [libraryPath, setLibraryPath] = useState("");
  const [scraperProvider, setScraperProvider] = useState("steam");
  const [minimizeOnLaunch, setMinimizeOnLaunch] = useState(false);
  const [autoFetchImages, setAutoFetchImages] = useState(true);
  const [showLaunchSplash, setShowLaunchSplash] = useState(true);

  useEffect(() => {
    const theme = localStorage.getItem("gamelib-theme") || "dark";
    setCurrentTheme(theme);
    setLibraryPath(localStorage.getItem("gamelib-library-path") || "C:\\Games");
    setScraperProvider(localStorage.getItem("gamelib-scraper") || "steam");
    setMinimizeOnLaunch(localStorage.getItem("gamelib-minimize-launch") === "true");
    setAutoFetchImages(localStorage.getItem("gamelib-autofetch") !== "false");
    setShowLaunchSplash(localStorage.getItem("gamelib-show-splash") !== "false");

    (async () => {
      try {
        const cfg: SteamApiConfig | null = await invoke("steam_load_config");
        if (cfg) {
          setSteamConfig(cfg);
          setSteamApiKey(cfg.apiKey);
          setSteamId(cfg.steamId);
        }
      } catch { /* no config yet */ }
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

  async function handleBrowsePath() {
    try {
      const folderPath = await open({ multiple: false, directory: true, title: "Select Games Library Directory" });
      if (folderPath && typeof folderPath === "string") {
        setLibraryPath(folderPath);
        localStorage.setItem("gamelib-library-path", folderPath);
        showToast("Library path updated", "success");
      }
    } catch {
      showToast("Could not open file explorer", "error");
    }
  }

  function saveGeneralSettings(scraper: string, minimize: boolean, autofetch: boolean, splash?: boolean) {
    setScraperProvider(scraper);
    localStorage.setItem("gamelib-scraper", scraper);
    setMinimizeOnLaunch(minimize);
    localStorage.setItem("gamelib-minimize-launch", String(minimize));
    setAutoFetchImages(autofetch);
    localStorage.setItem("gamelib-autofetch", String(autofetch));
    if (typeof splash === "boolean") {
      setShowLaunchSplash(splash);
      localStorage.setItem("gamelib-show-splash", String(splash));
    }
    showToast("Settings saved successfully", "success");
  }

  async function handleSaveSteamConfig() {
    if (!steamApiKey.trim() || !steamId.trim()) {
      showToast("Both API key and Steam ID are required", "error");
      return;
    }
    if (!/^\d{17}$/.test(steamId.trim())) {
      showToast("Steam ID must be a 17-digit number", "error");
      return;
    }
    const config: SteamApiConfig = { apiKey: steamApiKey.trim(), steamId: steamId.trim() };
    try {
      await invoke("steam_save_config", { config });
      setSteamConfig(config);
      showToast("Steam configuration saved", "success");
    } catch (err) {
      showToast(`Failed to save: ${err}`, "error");
    }
  }

  async function handleSyncNow() {
    if (!steamConfig) return;
    setIsSyncing(true);
    setSyncResult(null);
    try {
      const result: SteamSyncResult = await invoke("steam_sync_games", {
        config: steamConfig,
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
          newGames.push({
            id: `steam-${entry.appid}`,
            name: entry.name,
            path: "",
            platform: "Steam",
            installed: installedSet.has(entry.appid),
            playTime: formatPlayTime(entry.playtimeForever),
            addedAt: Date.now(),
            steamAppId: entry.appid,
            steamPlaytime: entry.playtimeForever,
            storeSource: "steam" as const,
          });
        }
        if (newGames.length > 0) {
          addGames(newGames);
          showToast(`Synced ${g} games · ${p} playtime · ${a} achievements (${newGames.length} new)`, "success");
        } else {
          showToast(`Synced ${g} games · ${p} playtime · ${a} achievements (all already in library)`, "success");
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
    if (!confirm("Remove your Steam configuration?")) return;
    try {
      await invoke("steam_clear_config");
      setSteamConfig(null);
      setSteamApiKey("");
      setSteamId("");
      setSyncResult(null);
      showToast("Steam configuration removed", "info");
    } catch (err) {
      showToast(`Failed: ${err}`, "error");
    }
  }

  return (
    <div className="settings-container">
      <header className="settings-header">
        <h1 className="settings-title">Settings</h1>
        <p className="settings-desc">
          Customize your Gamelib client appearance, directories, scraper providers, and launching behavior.
        </p>
      </header>

      <div className="settings-tabs">
        <button className={`settings-tab ${activeSettingsTab === "appearance" ? "active" : ""}`} onClick={() => setActiveSettingsTab("appearance")}>Appearance</button>
        <button className={`settings-tab ${activeSettingsTab === "directories" ? "active" : ""}`} onClick={() => setActiveSettingsTab("directories")}>Directories</button>
        <button className={`settings-tab ${activeSettingsTab === "hardware" ? "active" : ""}`} onClick={() => setActiveSettingsTab("hardware")}>Hardware</button>
        <button className={`settings-tab ${activeSettingsTab === "system" ? "active" : ""}`} onClick={() => setActiveSettingsTab("system")}>System</button>
        <button className={`settings-tab ${activeSettingsTab === "integrations" ? "active" : ""}`} onClick={() => setActiveSettingsTab("integrations")}>
          <IntegrationsIcon /> Integrations
        </button>
      </div>

      {/* Appearance */}
      {activeSettingsTab === "appearance" && (
      <section className="settings-section">
        <h2 className="settings-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/></svg>
          Appearance Themes
        </h2>
        <div className="theme-grid">
          {themes.map((theme) => {
            const isActive = currentTheme === theme.id;
            return (
              <div key={theme.id} className={`theme-card${isActive ? " active" : ""}`} onClick={() => handleThemeChange(theme.id)}>
                <div className="theme-preview-bar">
                  <div className="theme-preview-color" style={{ backgroundColor: theme.colors.bg }}/>
                  <div className="theme-preview-color" style={{ backgroundColor: theme.colors.text }}/>
                  <div className="theme-preview-color" style={{ backgroundColor: theme.colors.accent }}/>
                </div>
                <div className="theme-card-info">
                  <span className="theme-card-name">{theme.name}</span>
                  {isActive && <div className="theme-active-dot"/>}
                </div>
              </div>
            );
          })}
        </div>
      </section>)}

      {/* Directories */}
      {activeSettingsTab === "directories" && (
      <section className="settings-section">
        <h2 className="settings-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          Directories
        </h2>
        <div className="settings-row">
          <div className="settings-control">
            <label className="settings-label">Default Scan Directory</label>
            <div className="settings-input-group">
              <input type="text" className="settings-input" value={libraryPath} onChange={(e) => { setLibraryPath(e.target.value); localStorage.setItem("gamelib-library-path", e.target.value); }} placeholder="C:\Games"/>
              <button className="settings-btn" onClick={handleBrowsePath}>Browse...</button>
            </div>
          </div>
        </div>
      </section>)}

      {/* Hardware */}
      {activeSettingsTab === "hardware" && (
      <section className="settings-section">
        <h2 className="settings-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M7 2v20"/><path d="M17 2v20"/><path d="M2 12h20"/><path d="M2 7h5"/><path d="M2 17h5"/><path d="M17 17h5"/><path d="M17 7h5"/></svg>
          Hardware Monitoring
        </h2>
        <div className="settings-row">
          <div className="settings-control">
            <label className="settings-label">GPU Selection</label>
            <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", marginTop: "var(--space-xs)", marginBottom: "var(--space-sm)" }}>
              Select a GPU to monitor during gameplay.
            </p>
            <div className="settings-input-group">
              <select className="settings-select" value={selectedGpu?.id || ""} onChange={(e) => { const gpu = availableGpus.find((g) => g.id === e.target.value); setSelectedGpu(gpu || null); showToast(gpu ? `Selected ${gpu.name}` : "GPU selection cleared", "success"); }} style={{ flex: 1 }}>
                <option value="">-- Select a GPU --</option>
                {availableGpus.map((gpu) => (<option key={gpu.id} value={gpu.id}>{gpu.name} ({gpu.vramMb} MB)</option>))}
              </select>
              <button className="settings-btn" onClick={refreshGpus}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Refresh
              </button>
            </div>
          </div>
        </div>
      </section>)}

      {/* System */}
      {activeSettingsTab === "system" && (
      <section className="settings-section">
        <h2 className="settings-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
          System & Metadata
        </h2>
        <div className="settings-row">
          <div className="settings-control">
            <label className="settings-label">Primary Metadata Source</label>
            <select className="settings-select" value={scraperProvider} onChange={(e) => saveGeneralSettings(e.target.value, minimizeOnLaunch, autoFetchImages)}>
              <option value="steam">Steam Api Scraper</option>
              <option value="igdb">IGDB Database Scraper</option>
              <option value="pcgamingwiki">PCGamingWiki Search</option>
              <option value="all">Search All (Consolidated)</option>
            </select>
          </div>
          <div style={{ marginTop: "var(--space-md)", display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            <label className="settings-checkbox-label"><input type="checkbox" checked={minimizeOnLaunch} onChange={(e) => saveGeneralSettings(scraperProvider, e.target.checked, autoFetchImages, showLaunchSplash)}/><span>Minimize Gamelib window when launching a game</span></label>
            <label className="settings-checkbox-label"><input type="checkbox" checked={showLaunchSplash} onChange={(e) => saveGeneralSettings(scraperProvider, minimizeOnLaunch, autoFetchImages, e.target.checked)}/><span>Show launch splash with game info and visuals</span></label>
            <label className="settings-checkbox-label"><input type="checkbox" checked={autoFetchImages} onChange={(e) => saveGeneralSettings(scraperProvider, minimizeOnLaunch, e.target.checked, showLaunchSplash)}/><span>Auto-download cover art and metadata when adding games</span></label>
          </div>
        </div>
      </section>)}

      {/* Integrations */}
      {activeSettingsTab === "integrations" && (
      <section className="settings-section">
        <h2 className="settings-section-title">
          <IntegrationsIcon /> Integrations
        </h2>

        {/* ── Steam ── */}
        <div className="integration-card">
          <div className="integration-card-header">
            <SteamIcon />
            <div>
              <h3 className="integration-card-name">Steam</h3>
              <p className="integration-card-desc">
                Sync your library, playtime, and achievements using a free Steam Web API key.
              </p>
            </div>
            {steamConfig && <span className="integration-badge active">Connected</span>}
          </div>

          <div className="integration-card-body">
            <div className="settings-row">
              <div className="settings-control">
                <label className="settings-label">
                  Steam Web API Key
                  <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noopener noreferrer" className="integration-link">Get your free key →</a>
                </label>
                <input
                  type="text"
                  className="settings-input"
                  value={steamApiKey}
                  onChange={(e) => setSteamApiKey(e.target.value)}
                  placeholder="Your Steam Web API key"
                />
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-control">
                <label className="settings-label">
                  Steam ID (64-bit)
                  <span className="integration-hint">Found in your profile URL: steamcommunity.com/profiles/&lt;ID&gt;</span>
                </label>
                <input
                  type="text"
                  className="settings-input"
                  value={steamId}
                  onChange={(e) => setSteamId(e.target.value)}
                  placeholder="76561198123456789"
                />
              </div>
            </div>

            <div className="integration-card-actions">
              {!steamConfig ? (
                <button className="btn btn-primary btn-steam" onClick={handleSaveSteamConfig}>
                  <SteamIcon /> Save &amp; Connect
                </button>
              ) : (
                <>
                  <button className="btn btn-primary btn-steam" onClick={handleSaveSteamConfig}>
                    <SteamIcon /> Update
                  </button>
                  <button className="btn btn-steam" onClick={handleSyncNow} disabled={isSyncing}>
                    {isSyncing ? <><span className="spinner"/> Syncing...</> : "Sync Now"}
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={handleDisconnect}>Disconnect</button>
                </>
              )}
            </div>

            {syncResult && (
              <div className={`sync-result ${syncResult.success ? "success" : "error"}`} style={{ marginTop: "var(--space-md)" }}>
                {syncResult.success
                  ? `✓ Synced ${syncResult.gamesSynced ?? 0} games · ${syncResult.playtimeUpdated ?? 0} playtime updates · ${syncResult.achievementsSynced ?? 0} achievement sets`
                  : `✗ ${syncResult.error || "Sync failed"}`}
              </div>
            )}

            {steamConfig && (
              <div style={{ marginTop: "var(--space-md)", display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
                <label className="settings-checkbox-label"><input type="checkbox" checked={steamSettings.autoSyncOnLaunch} onChange={(e) => { const u = { ...steamSettings, autoSyncOnLaunch: e.target.checked }; setSteamSettings(u); localStorage.setItem("gamelib-steam-settings", JSON.stringify(u)); }}/><span>Auto-sync on launch</span></label>
                <label className="settings-checkbox-label"><input type="checkbox" checked={steamSettings.syncPlaytime} onChange={(e) => { const u = { ...steamSettings, syncPlaytime: e.target.checked }; setSteamSettings(u); localStorage.setItem("gamelib-steam-settings", JSON.stringify(u)); }}/><span>Sync playtime</span></label>
                <label className="settings-checkbox-label"><input type="checkbox" checked={steamSettings.syncAchievements} onChange={(e) => { const u = { ...steamSettings, syncAchievements: e.target.checked }; setSteamSettings(u); localStorage.setItem("gamelib-steam-settings", JSON.stringify(u)); }}/><span>Sync achievements</span></label>
              </div>
            )}
          </div>
        </div>

        <p className="integration-footer">
          More integrations coming soon — GOG, Epic Games, and more.
        </p>
      </section>)}
    </div>
  );
}

function SteamIcon() {
  return (
    <svg className="icon-steam" viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm-3-4c0 1.66 1.34 3 3 3s3-1.34 3-3-1.34-3-3-3-3 1.34-3 3z"/>
    </svg>
  );
}

function IntegrationsIcon() {
  return (
    <svg className="icon-steam" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <rect x="2" y="2" width="7" height="7" rx="1"/>
      <rect x="15" y="2" width="7" height="7" rx="1"/>
      <rect x="2" y="15" width="7" height="7" rx="1"/>
      <rect x="15" y="15" width="7" height="7" rx="1"/>
    </svg>
  );
}
