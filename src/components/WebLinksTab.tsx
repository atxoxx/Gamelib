import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Game } from "../types/game";

interface WebLinksTabProps {
  game: Game;
}

type FixedSourceKey =
  | "steam"
  | "protondb"
  | "pcgamingwiki"
  | "ign"
  | "nexusmods"
  | "moddb";

type SteamSectionKey = "store" | "discussions" | "news" | "workshop";

interface SourceDef {
  /** Either a FixedSourceKey or a full user-added URL (for custom sources). */
  key: string;
  label: string;
  /** Brand color for the active-tab accent. */
  accent: string;
  /** Background gradient for the icon chip. */
  iconBg: string;
  /** Inline SVG for the source's logo. */
  icon: ReactNode;
  /** Set true for user-added custom URLs. */
  isCustom?: boolean;
  /** Raw URL — required when isCustom is true (it's also used as the key). */
  url?: string;
}

interface SteamSectionDef {
  key: SteamSectionKey;
  label: string;
  icon: ReactNode;
}

// ─── Steam AppID Detection ────────────────────────────────────────────────────

/**
 * Try to extract a Steam AppID from a game's executable path. Steam games
 * sometimes launch via a `steam://run/{appid}` URI or have an executable file
 * literally named `{appid}.exe` inside `steamapps/common/`. Returns null if no
 * AppID can be detected.
 *
 * NOTE: best-effort only — most modern Steam installs name the executable
 * after the game (e.g. `hl2.exe`, `portal2.exe`) rather than the AppID, so
 * callers should treat a `null` return as "fall back to a search URL" and
 * surface that gracefully in the UI.
 */
function extractSteamAppId(game: Game): string | null {
  if (game.platform !== "Steam") return null;
  const path = game.path || "";
  const rungame = path.match(/steam:\/\/run(?:gameid)?\/(\d+)/i);
  if (rungame) return rungame[1];
  const appidExe = path.match(/[\\/](\d+)\.exe$/i);
  if (appidExe) return appidExe[1];
  return null;
}

// ─── URL Builders ─────────────────────────────────────────────────────────────

/**
 * Build a URL for the selected source. Falls back to a site-specific search
 * page when no AppID is available so the user always lands on a relevant
 * page even for non-Steam games.
 */
function buildUrl(
  game: Game,
  source: FixedSourceKey,
  steamSection: SteamSectionKey,
  appId: string | null
): string {
  const enc = encodeURIComponent(game.name);
  if (source === "steam") {
    if (!appId) {
      return `https://store.steampowered.com/search/?term=${enc}`;
    }
    switch (steamSection) {
      case "store":
        return `https://store.steampowered.com/app/${appId}`;
      case "discussions":
        return `https://steamcommunity.com/app/${appId}/discussions/`;
      case "news":
        return `https://store.steampowered.com/news/app/${appId}`;
      case "workshop":
        return `https://steamcommunity.com/app/${appId}/workshop/`;
    }
  }
  if (source === "protondb") {
    return appId
      ? `https://www.protondb.com/app/${appId}`
      : `https://www.protondb.com/search?q=${enc}`;
  }
  if (source === "pcgamingwiki") {
    return appId
      ? `https://www.pcgamingwiki.com/api/appid.php?appid=${appId}`
      : `https://www.pcgamingwiki.com/w/index.php?search=${enc}`;
  }
  if (source === "ign") {
    return `https://www.ign.com/search?q=${enc}`;
  }
  if (source === "nexusmods") {
    return `https://www.nexusmods.com/search/?gsearch=${enc}`;
  }
  if (source === "moddb") {
    return `https://www.moddb.com/games?kw=${enc}`;
  }
  return "about:blank";
}

// ─── SVG Icons (inline, theme-friendly) ───────────────────────────────────────

const SteamIcon = (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="12" r="10" />
    <circle cx="15.5" cy="9.5" r="2.5" />
    <circle cx="9" cy="14" r="1.6" />
    <path d="M2 15l5.5 2.2a3 3 0 0 0 4.7-3l5.6 1.5a2.4 2.4 0 1 0 .5-1.9L13 10.2a3 3 0 0 0-5.4-.4L2 7.6V15z" opacity="0.25" />
  </svg>
);

const ProtonDBIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="3" />
    <line x1="12" y1="2" x2="12" y2="9" />
    <line x1="12" y1="15" x2="12" y2="22" />
    <line x1="2" y1="12" x2="9" y2="12" />
    <line x1="15" y1="12" x2="22" y2="12" />
  </svg>
);

const PCGamingWikiIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
    <line x1="9" y1="9" x2="15" y2="15" />
    <line x1="15" y1="9" x2="9" y2="15" />
  </svg>
);

const IGNIcon = (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <rect x="2" y="3" width="20" height="18" rx="2" />
    <text x="12" y="16" fontSize="11" fontWeight="900" textAnchor="middle" fill="currentColor" fontFamily="sans-serif">IGN</text>
  </svg>
);

const NexusModsIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 22 8 22 16 12 22 2 16 2 8" />
    <line x1="12" y1="2" x2="12" y2="22" />
    <line x1="2" y1="8" x2="22" y2="16" />
    <line x1="22" y1="8" x2="2" y2="16" />
  </svg>
);

const ModDBIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7h18v10H3z" />
    <path d="M7 7v10" />
    <path d="M11 7v10" />
    <path d="M15 7l4 5-4 5" />
  </svg>
);

const CustomLinkIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

const OpenExternalIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

const ReloadIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

const SteamStoreIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="21" r="1" />
    <circle cx="20" cy="21" r="1" />
    <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
  </svg>
);

const SteamChatIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const SteamNewsIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
    <path d="M18 14h-8M15 18h-5M10 6h8M10 10h8" />
  </svg>
);

const SteamWorkshopIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </svg>
);

const FixedSources: SourceDef[] = [
  { key: "steam", label: "Steam", accent: "#66c0f4", iconBg: "#1b2838", icon: SteamIcon },
  { key: "protondb", label: "ProtonDB", accent: "#7c5cff", iconBg: "#3a2d8a", icon: ProtonDBIcon },
  { key: "pcgamingwiki", label: "PCGamingWiki", accent: "#d83b3b", iconBg: "#3a1c1c", icon: PCGamingWikiIcon },
  { key: "ign", label: "IGN", accent: "#ff3333", iconBg: "#2a0606", icon: IGNIcon },
  { key: "nexusmods", label: "NexusMods", accent: "#d88e2b", iconBg: "#3a2810", icon: NexusModsIcon },
  { key: "moddb", label: "ModDB", accent: "#5ec469", iconBg: "#15351b", icon: ModDBIcon },
];

const SteamSections: SteamSectionDef[] = [
  { key: "store", label: "Store", icon: SteamStoreIcon },
  { key: "discussions", label: "Discussions", icon: SteamChatIcon },
  { key: "news", label: "News", icon: SteamNewsIcon },
  { key: "workshop", label: "Workshop", icon: SteamWorkshopIcon },
];

/** Derive a display label + host for a user-added URL. */
function deriveCustomLink(url: string): { label: string; host: string } {
  try {
    const parsed = new URL(url);
    const host = parsed.host.replace(/^www\./, "");
    const parts = host.split(".");
    // Use the second-level domain (e.g. "steamcommunity" from "steamcommunity.com").
    const base = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    const label = base ? base.charAt(0).toUpperCase() + base.slice(1) : "Link";
    return { label, host };
  } catch {
    return { label: "Link", host: url };
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function WebLinksTab({ game }: WebLinksTabProps) {
  const [activeSource, setActiveSource] = useState<string>("steam");
  const [steamSection, setSteamSection] = useState<SteamSectionKey>("store");
  /** Bumped (via Reload) to force webview recreation. */
  const [reloadNonce, setReloadNonce] = useState(0);

  const appId = useMemo(() => extractSteamAppId(game), [game.path, game.platform]);

  /** Custom URLs from Edit form / metadata scraper, de-duped (case-insensitive). */
  const customLinks = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const u of game.websites ?? []) {
      const trimmed = (u ?? "").trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
    }
    return out;
  }, [game.websites]);

  /** Each custom URL becomes a peer source tab. */
  const customSources = useMemo<SourceDef[]>(() => {
    return customLinks.map((url) => {
      const meta = deriveCustomLink(url);
      return {
        key: url,
        label: meta.label,
        accent: "var(--color-accent)",
        iconBg: "var(--color-bg-tertiary)",
        icon: <CustomLinkIcon />,
        isCustom: true,
        url,
      };
    });
  }, [customLinks]);

  const allSources = useMemo(
    () => [...FixedSources, ...customSources],
    [customSources]
  );

  const activeSourceDef = useMemo(
    () => allSources.find((s) => s.key === activeSource) ?? FixedSources[0],
    [allSources, activeSource]
  );
  const isSteamActive = activeSource === "steam";
  const isCustomActive = activeSourceDef?.isCustom === true;

  // URL to embed in the webview.
  const url = useMemo(() => {
    if (isCustomActive && activeSourceDef?.url) return activeSourceDef.url;
    return buildUrl(game, activeSource as FixedSourceKey, steamSection, appId);
  }, [game, activeSource, steamSection, appId, isCustomActive, activeSourceDef]);

  // Steam sub-sections that REQUIRE an AppID (no useful search URL exists).
  const steamSubDisabled = isSteamActive && steamSection !== "store" && !appId;

  async function handleOpenExternal() {
    try {
      await openUrl(url);
    } catch (err) {
      console.error("openUrl failed:", err);
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  function handleReload() {
    setReloadNonce((n) => n + 1);
  }

  // ─── Iframe preview state ───────────────────────────────────────────────
  // We embed the URL in a sandboxed <iframe>. Some sites (Steam Store, IGN,
  // NexusMods) intentionally return `X-Frame-Options: DENY` so the iframe
  // renders blank — for those we surface a fallback panel that highlights
  // the URL and a big "Open in browser" button. We DO NOT try to detect
  // blank-iframe states programmatically because Chrome fires onLoad even
  // when X-Frame blocked the load (with the body left empty).
  //
  // NOTE on `sandbox`: we deliberately omit `allow-same-origin`. This
  // prevents the embed from being treated as same-origin by the browser,
  // which is the right default for cross-site previews — but it also means
  // cookies / local storage on the embedded origin are isolated, so a few
  // embeddable sites (ProtonDB login, NexusMods personalized recommendations)
  // will load without remembered-session state. Acceptable trade-off for
  // tighter isolation.
  const [iframeLoaded, setIframeLoaded] = useState(false);

  useEffect(() => {
    setIframeLoaded(false);
  }, [url, reloadNonce]);

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="wl-tab">
      {/* ─── Outer source TABS (fixed + custom user links) ───────────── */}
      <div className="wl-source-tabs" role="tablist">
        {allSources.map((src) => {
          const isActive = activeSource === src.key;
          const isCustom = src.isCustom === true;
          return (
            <button
              key={src.key}
              role="tab"
              aria-selected={isActive}
              className={`wl-source-tab${isActive ? " active" : ""}${isCustom ? " custom" : ""}`}
              onClick={() => setActiveSource(src.key)}
              style={
                isActive
                  ? {
                      color: src.accent,
                      borderBottomColor: src.accent,
                      background: `linear-gradient(180deg, ${src.iconBg}33, transparent)`,
                    }
                  : undefined
              }
              title={isCustom ? src.key : undefined}
            >
              <span
                className="wl-source-tab-icon"
                style={{ background: isActive ? src.iconBg : "var(--color-bg-tertiary)" }}
              >
                {src.icon}
              </span>
              <span>{src.label}</span>
            </button>
          );
        })}
      </div>

      {/* ─── Steam sub-tabs (only when Steam tab is active) ──────────── */}
      {isSteamActive && (
        <div className="wl-steam-subtabs" role="tablist">
          {SteamSections.map((sec) => {
            const isActive = steamSection === sec.key;
            const disabled = sec.key !== "store" && !appId;
            return (
              <button
                key={sec.key}
                role="tab"
                aria-selected={isActive}
                aria-disabled={disabled}
                disabled={disabled}
                className={`wl-steam-subtab${isActive ? " active" : ""}${disabled ? " disabled" : ""}`}
                onClick={() => !disabled && setSteamSection(sec.key)}
                title={disabled ? "Steam AppID not detected — Search by name instead." : undefined}
              >
                <span className="wl-steam-subtab-icon">{sec.icon}</span>
                <span>{sec.label}</span>
                {disabled && (
                  <span className="wl-steam-subtab-lock" aria-hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ─── URL bar (controls over the webview) ──────────────────────── */}
      <div
        className="wl-urlbar"
        style={{
          borderColor: isCustomActive
            ? "var(--color-accent)55"
            : `${activeSourceDef.accent}55`,
        }}
      >
        <span
          className="wl-urlbar-source-chip"
          style={{
            background: isCustomActive
              ? "var(--color-bg-tertiary)"
              : activeSourceDef.iconBg,
            color: isCustomActive ? "var(--color-accent)" : activeSourceDef.accent,
          }}
        >
          {isCustomActive ? "My Link" : activeSourceDef.label}
        </span>
        <span className="wl-urlbar-url" title={url}>
          {url.replace(/^https?:\/\//, "").replace(/^www\./, "")}
        </span>
        <div className="wl-urlbar-actions">
          <button className="wl-urlbar-btn" onClick={handleReload} type="button" title="Reload preview">
            <ReloadIcon />
            <span>Reload</span>
          </button>
          <button
            className="wl-urlbar-btn primary"
            onClick={handleOpenExternal}
            type="button"
            title="Open in your default browser"
          >
            <OpenExternalIcon />
            <span>Open in browser</span>
          </button>
        </div>
      </div>

      {/* ─── Preview area: Tauri native webview overlaid on placeholder ── */}
      <div className="wl-preview">
        {steamSubDisabled ? (
          // Steam sub-page (Discussions/News/Workshop) without an AppID
          <div className="wl-empty">
            <div className="wl-empty-header">
              <span
                className="wl-empty-icon"
                style={{ color: activeSourceDef.accent, background: activeSourceDef.iconBg }}
              >
                {SteamSections.find((s) => s.key === steamSection)?.icon}
              </span>
              <h3>Steam AppID not detected</h3>
            </div>
            <p>
              The <strong>{SteamSections.find((s) => s.key === steamSection)?.label}</strong> page for this game
              can't be opened because no Steam AppID is associated with{" "}
              <strong>{game.name}</strong>. Set the executable path to{" "}
              <code>{`{appid}.exe`}</code> inside <code>steamapps/common/</code> to enable
              direct community links — or use Steam Store search above to find the
              title and add it back with the correct launch URI.
            </p>
            <button className="wl-empty-btn primary" onClick={handleOpenExternal} type="button">
              <OpenExternalIcon />
              Search Steam Store
            </button>
          </div>
        ) : isSteamActive && !appId ? (
          // Steam Store fallback (search URL is reasonable)
          <div className="wl-empty subtle">
            <div className="wl-empty-header">
              <span
                className="wl-empty-icon"
                style={{ color: activeSourceDef.accent, background: activeSourceDef.iconBg }}
              >
                {SteamIcon}
              </span>
              <h3>Steam search mode</h3>
            </div>
            <p>
              This game isn't tied to a Steam AppID, so we're showing the Steam Store search for{" "}
              <strong>{game.name}</strong>. Deep links to Discussions, News, and Workshop are
              unavailable until an AppID is detected.
            </p>
          </div>
        ) : null}

        {/* Iframe preview — falls back to a clean "open in browser" panel
            for sites that block embedding via X-Frame-Options. */}
        {!steamSubDisabled && (
          <div className="wl-iframe-frame">
            {!iframeLoaded && (
              <div className="wl-iframe-loader" aria-hidden>
                <div className="wl-iframe-spinner" />
                <span>Loading {activeSourceDef.label}…</span>
              </div>
            )}
            <iframe
              key={reloadNonce}
              src={url}
              title={`${activeSourceDef.label} preview for ${game.name}`}
              className="wl-iframe"
              sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer"
              onLoad={() => setIframeLoaded(true)}
            />
            {iframeLoaded && (
              <div className="wl-iframe-blocked-hint">
                <span>
                  If this preview is blank, the site blocks embedding.
                </span>
                <button
                  className="wl-iframe-blocked-btn"
                  type="button"
                  onClick={handleOpenExternal}
                >
                  Open in browser
                  <OpenExternalIcon />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footnote */}
      <div className="wl-footnote">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span>
          Previews load in a sandboxed <code>&lt;iframe&gt;</code>. Some sites
          (Steam Store, IGN, NexusMods) block embedding via{" "}
          <code>X-Frame-Options</code> — if a tab is blank, use{" "}
          <strong>Open in browser</strong>.
        </span>
      </div>
    </div>
  );
}
