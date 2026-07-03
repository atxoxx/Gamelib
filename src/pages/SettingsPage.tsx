import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useToast } from "../context/ToastContext";
import { useActivity } from "../context/ActivityContext";

interface ThemeOption {
  id: string;
  name: string;
  colors: {
    bg: string;
    text: string;
    accent: string;
  };
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
  
  // Theme State
  const [currentTheme, setCurrentTheme] = useState("dark");
  
  // Custom Library and Scraper Settings State
  const [libraryPath, setLibraryPath] = useState("");
  const [scraperProvider, setScraperProvider] = useState("steam");
  const [minimizeOnLaunch, setMinimizeOnLaunch] = useState(false);
  const [autoFetchImages, setAutoFetchImages] = useState(true);

  // Load settings on mount
  useEffect(() => {
    const theme = localStorage.getItem("gamelib-theme") || "dark";
    setCurrentTheme(theme);

    const savedPath = localStorage.getItem("gamelib-library-path") || "C:\\Games";
    setLibraryPath(savedPath);

    const savedScraper = localStorage.getItem("gamelib-scraper") || "steam";
    setScraperProvider(savedScraper);

    const savedMinimize = localStorage.getItem("gamelib-minimize-launch") === "true";
    setMinimizeOnLaunch(savedMinimize);

    const savedAutoFetch = localStorage.getItem("gamelib-autofetch") !== "false";
    setAutoFetchImages(savedAutoFetch);
  }, []);

  // Theme changer
  function handleThemeChange(themeId: string) {
    setCurrentTheme(themeId);
    localStorage.setItem("gamelib-theme", themeId);
    document.documentElement.setAttribute("data-theme", themeId);
    showToast(`Theme changed to ${themes.find((t) => t.id === themeId)?.name}`, "success");
  }

  // Folder picker for library path
  async function handleBrowsePath() {
    try {
      const folderPath = await open({
        multiple: false,
        directory: true,
        title: "Select Games Library Directory",
      });
      if (folderPath && typeof folderPath === "string") {
        setLibraryPath(folderPath);
        localStorage.setItem("gamelib-library-path", folderPath);
        showToast("Library path updated", "success");
      }
    } catch (err) {
      console.error("Browse path error:", err);
      showToast("Could not open file explorer", "error");
    }
  }

  // Save general settings
  function saveGeneralSettings(
    scraper: string,
    minimize: boolean,
    autofetch: boolean
  ) {
    setScraperProvider(scraper);
    localStorage.setItem("gamelib-scraper", scraper);

    setMinimizeOnLaunch(minimize);
    localStorage.setItem("gamelib-minimize-launch", String(minimize));

    setAutoFetchImages(autofetch);
    localStorage.setItem("gamelib-autofetch", String(autofetch));

    showToast("Settings saved successfully", "success");
  }

  return (
    <div className="settings-container">
      <header className="settings-header">
        <h1 className="settings-title">Settings</h1>
        <p className="settings-desc">
          Customize your Gamelib client appearance, directories, scraper providers, and launching behavior.
        </p>
      </header>

      {/* Theme selection grid */}
      <section className="settings-section">
        <h2 className="settings-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            <path d="M2 12h20" />
          </svg>
          Appearance Themes
        </h2>
        <div className="theme-grid">
          {themes.map((theme) => {
            const isActive = currentTheme === theme.id;
            return (
              <div
                key={theme.id}
                className={`theme-card${isActive ? " active" : ""}`}
                onClick={() => handleThemeChange(theme.id)}
              >
                <div className="theme-preview-bar">
                  <div
                    className="theme-preview-color"
                    style={{ backgroundColor: theme.colors.bg }}
                  />
                  <div
                    className="theme-preview-color"
                    style={{ backgroundColor: theme.colors.text }}
                  />
                  <div
                    className="theme-preview-color"
                    style={{ backgroundColor: theme.colors.accent }}
                  />
                </div>
                <div className="theme-card-info">
                  <span className="theme-card-name">{theme.name}</span>
                  {isActive && <div className="theme-active-dot" />}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Folders configuration */}
      <section className="settings-section">
        <h2 className="settings-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          Directories
        </h2>
        <div className="settings-row">
          <div className="settings-control">
            <label className="settings-label">Default Scan Directory</label>
            <div className="settings-input-group">
              <input
                type="text"
                className="settings-input"
                value={libraryPath}
                onChange={(e) => {
                  setLibraryPath(e.target.value);
                  localStorage.setItem("gamelib-library-path", e.target.value);
                }}
                placeholder="C:\Games"
              />
              <button className="settings-btn" onClick={handleBrowsePath}>
                Browse...
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* GPU Selector */}
      <section className="settings-section">
        <h2 className="settings-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="2" />
            <path d="M7 2v20" />
            <path d="M17 2v20" />
            <path d="M2 12h20" />
            <path d="M2 7h5" />
            <path d="M2 17h5" />
            <path d="M17 17h5" />
            <path d="M17 7h5" />
          </svg>
          Hardware Monitoring
        </h2>
        <div className="settings-row">
          <div className="settings-control">
            <label className="settings-label">GPU Selection</label>
            <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", marginTop: "var(--space-xs)", marginBottom: "var(--space-sm)" }}>
              Select a GPU to monitor during gameplay. Performance metrics will be collected from the selected GPU only.
            </p>
            <div className="settings-input-group">
              <select
                className="settings-select"
                value={selectedGpu?.id || ""}
                onChange={(e) => {
                  const gpu = availableGpus.find((g) => g.id === e.target.value);
                  setSelectedGpu(gpu || null);
                  showToast(gpu ? `Selected ${gpu.name}` : "GPU selection cleared", "success");
                }}
                style={{ flex: 1 }}
              >
                <option value="">-- Select a GPU --</option>
                {availableGpus.map((gpu) => (
                  <option key={gpu.id} value={gpu.id}>
                    {gpu.name} ({gpu.vramMb} MB)
                  </option>
                ))}
              </select>
              <button className="settings-btn" onClick={refreshGpus}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>{" "}
                Refresh
              </button>
            </div>
            {selectedGpu && (
              <div className="gpu-info-card" style={{ marginTop: "var(--space-md)", padding: "var(--space-md)", background: "var(--color-bg-tertiary)", borderRadius: "var(--radius-md)", border: "1px solid var(--color-border)" }}>
                <div style={{ display: "flex", gap: "var(--space-md)", alignItems: "center" }}>
                  <div style={{ width: 40, height: 40, borderRadius: "var(--radius-md)", background: "var(--color-accent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}>
                      <rect x="2" y="2" width="20" height="20" rx="2" />
                      <path d="M7 2v20" />
                      <path d="M17 2v20" />
                      <path d="M2 12h20" />
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: "var(--font-size-sm)", fontWeight: 600, color: "var(--color-text-primary)" }}>{selectedGpu.name}</div>
                    <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-secondary)" }}>
                      {selectedGpu.vendor} · {selectedGpu.vramMb} MB VRAM
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Scraper / behavior settings */}
      <section className="settings-section">
        <h2 className="settings-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </svg>
          System & Metadata
        </h2>
        <div className="settings-row">
          <div className="settings-control">
            <label className="settings-label">Primary Metadata Source</label>
            <select
              className="settings-select"
              value={scraperProvider}
              onChange={(e) =>
                saveGeneralSettings(
                  e.target.value,
                  minimizeOnLaunch,
                  autoFetchImages
                )
              }
            >
              <option value="steam">Steam Api Scraper</option>
              <option value="igdb">IGDB Database Scraper</option>
              <option value="pcgamingwiki">PCGamingWiki Search</option>
              <option value="all">Search All (Consolidated)</option>
            </select>
          </div>

          <div style={{ marginTop: "var(--space-md)", display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            <label className="settings-checkbox-label">
              <input
                type="checkbox"
                checked={minimizeOnLaunch}
                onChange={(e) =>
                  saveGeneralSettings(
                    scraperProvider,
                    e.target.checked,
                    autoFetchImages
                  )
                }
              />
              <span>Minimize Gamelib window when launching a game</span>
            </label>

            <label className="settings-checkbox-label">
              <input
                type="checkbox"
                checked={autoFetchImages}
                onChange={(e) =>
                  saveGeneralSettings(
                    scraperProvider,
                    minimizeOnLaunch,
                    e.target.checked
                  )
                }
              />
              <span>Auto-download cover art and metadata when adding games</span>
            </label>
          </div>
        </div>
      </section>
    </div>
  );
}
