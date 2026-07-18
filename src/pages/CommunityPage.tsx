import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { open as tauriOpen } from "@tauri-apps/plugin-dialog";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { useActivity } from "../context/ActivityContext";
import { useAchievements } from "../context/AchievementContext";
import { useGames } from "../context/GameContext";
import { useToast } from "../context/ToastContext";
import { useSettings } from "../context/SettingsContext";
import { useNewsFeeds, formatArticleDate } from "../hooks/useNewsFeeds";
import type { NewsArticle } from "../hooks/useNewsFeeds";

import DonutChart from "../components/charts/DonutChart";
import BarChart from "../components/charts/BarChart";
import { Card, KpiTile, Button } from "../components/ui";
import "./community.css";

// ─── Tab types ─────────────────────────────────────────────────────────────

type CommunityTab = "profile" | "screenshots" | "news";

// ─── Icons (inline SVG, theme-friendly) ────────────────────────────────────

const ProfileIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const ImageIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
);

const NewsIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
    <path d="M4 11a9 9 0 0 1 9 9" />
    <path d="M4 4a16 16 0 0 1 16 16" />
    <circle cx="5" cy="19" r="1" />
  </svg>
);

const ClockIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const GamepadIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
    <line x1="6" y1="11" x2="10" y2="11" />
    <line x1="8" y1="9" x2="8" y2="13" />
    <line x1="15" y1="12" x2="15.01" y2="12" />
    <line x1="18" y1="10" x2="18.01" y2="10" />
    <rect x="2" y="6" width="20" height="12" rx="2" />
  </svg>
);

const TrophyIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
    <path d="M4 22h16" />
    <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
    <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
    <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
  </svg>
);

const SparkleIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const FolderIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const ExternalLinkIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

const ChevronLeftIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const ChevronRightIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const XIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const TrendingIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
    <polyline points="17 6 23 6 23 12" />
  </svg>
);

const MessageIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

// ─── Donut chart color palette (theme tokens) ───────────────────────────────

const DONUT_PALETTE = [
  "var(--color-accent)",
  "var(--color-info)",
  "var(--color-success)",
  "var(--color-warning)",
  "var(--color-danger)",
  "color-mix(in srgb, var(--color-accent) 60%, var(--color-info))",
  "color-mix(in srgb, var(--color-info) 60%, var(--color-success))",
  "color-mix(in srgb, var(--color-success) 60%, var(--color-warning))",
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatHours(totalMinutes: number): string {
  if (!totalMinutes || totalMinutes <= 0) return "0m";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h >= 1000) return `${(h / 1000).toFixed(1)}k h`;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// ─── Main Component ─────────────────────────────────────────────────────────

import { useBigScreen } from "../context/BigScreenContext";
import BigScreenHome from "../components/bigscreen/BigScreenHome";

export default function CommunityPage() {
  const { isBigScreen } = useBigScreen();
  if (isBigScreen) {
    return <BigScreenHome />;
  }
  const [activeTab, setActiveTab] = useState<CommunityTab>("profile");

  return (
    <div className="community-page">
      {/* Tab bar */}
      <div className="community-tab-bar" role="tablist" aria-label="Community sections">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "profile"}
          className={`community-tab${activeTab === "profile" ? " active" : ""}`}
          onClick={() => setActiveTab("profile")}
        >
          {ProfileIcon}
          <span>Profile</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "screenshots"}
          className={`community-tab${activeTab === "screenshots" ? " active" : ""}`}
          onClick={() => setActiveTab("screenshots")}
        >
          {ImageIcon}
          <span>Screenshots</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "news"}
          className={`community-tab${activeTab === "news" ? " active" : ""}`}
          onClick={() => setActiveTab("news")}
        >
          {NewsIcon}
          <span>News &amp; Discussion</span>
        </button>
      </div>

      {/* Tab panels */}
      <div className="community-panel">
        {activeTab === "profile" && <ProfileSection />}
        {activeTab === "screenshots" && <ScreenshotsSection />}
        {activeTab === "news" && <NewsDiscussionSection />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Profile Section (#7)
// ═══════════════════════════════════════════════════════════════════════════════

function ProfileSection() {
  const { getAllStats } = useActivity();
  const { cache } = useAchievements();
  const { games } = useGames();
  const { hideAchievementProgress } = useSettings();

  const stats = useMemo(() => getAllStats(), [getAllStats]);

  // Count total achievements across all cached games
  const achievementCounts = useMemo(() => {
    let total = 0;
    let unlocked = 0;
    for (const gid of Object.keys(cache.games)) {
      const g = cache.games[gid];
      total += g.total;
      unlocked += g.unlocked;
    }
    return { total, unlocked };
  }, [cache]);

  // Genre breakdown for donut (top 7 + "Other")
  const genreSlices = useMemo(() => {
    const sorted = [...stats.genreBreakdown];
    if (sorted.length <= 7) {
      return sorted.map((g, i) => ({
        label: g.genre,
        value: g.minutes,
        color: DONUT_PALETTE[i % DONUT_PALETTE.length],
      }));
    }
    const top = sorted.slice(0, 7);
    const rest = sorted.slice(7).reduce((s, g) => s + g.minutes, 0);
    const slices = top.map((g, i) => ({
      label: g.genre,
      value: g.minutes,
      color: DONUT_PALETTE[i % DONUT_PALETTE.length],
    }));
    if (rest > 0) slices.push({ label: "Other", value: rest, color: "var(--color-text-muted)" });
    return slices;
  }, [stats.genreBreakdown]);

  // Platform breakdown
  const platformSlices = useMemo(() => {
    return stats.platformBreakdown.map((p, i) => ({
      label: p.platform,
      value: p.minutes,
      color: DONUT_PALETTE[i % DONUT_PALETTE.length],
    }));
  }, [stats.platformBreakdown]);

  // Games added this month
  const gamesAddedThisMonth = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return games.filter((g) => g.addedAt >= monthStart).length;
  }, [games]);

  // Recently played games (last 14 days)
  const recentlyPlayed = useMemo(() => {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    return games.filter((g) => g.lastPlayed && g.lastPlayed >= cutoff).length;
  }, [games]);

  // Total achievements completion %
  const achievementPct = achievementCounts.total > 0
    ? Math.round((achievementCounts.unlocked / achievementCounts.total) * 100)
    : null;

  const totalGames = games.length;

  // Ranked top games (most played) with cover art + progress bars
  const topGames = useMemo(() => {
    const maxMin = stats.topGames.length > 0 ? stats.topGames[0].minutes : 0;
    return stats.topGames.map((g) => {
      const libGame = games.find((lg) => lg.id === g.gameId);
      return {
        ...g,
        coverArtUrl: libGame?.coverArtUrl,
        platform: libGame?.platform,
        pct: maxMin > 0 ? Math.round((g.minutes / maxMin) * 100) : 0,
      };
    });
  }, [stats.topGames, games]);

  // Distinct genres / platforms played
  const distinctGenres = stats.genreBreakdown.length;

  return (
    <div className="community-profile">
      {/* ── KPI Tile Row ─────────────────────────────────────────────── */}
      <div className="community-kpi-grid">
        <KpiTile
          label="Total Playtime"
          value={formatHours(stats.totalPlayTimeMin)}
          subtext={`${stats.totalSessions} sessions`}
          icon={ClockIcon}
          intent="accent"
          size="md"
        />
        <KpiTile
          label="Games Owned"
          value={totalGames}
          subtext={`${gamesAddedThisMonth} added this month`}
          icon={GamepadIcon}
          intent="info"
          size="md"
        />
        {!hideAchievementProgress && achievementPct !== null && (
          <KpiTile
            label="Achievements"
            value={`${achievementPct}%`}
            subtext={`${achievementCounts.unlocked} of ${achievementCounts.total} unlocked`}
            icon={TrophyIcon}
            intent={achievementPct >= 50 ? "success" : "warning"}
            size="md"
          />
        )}
        <KpiTile
          label="Recently Played"
          value={recentlyPlayed}
          subtext="games in the last 14 days"
          icon={SparkleIcon}
          intent="success"
          size="md"
        />
      </div>

      {/* ── Charts Row ────────────────────────────────────────────────── */}
      <div className="community-charts-row">
        {/* Genre breakdown donut */}
        <Card variant="surface" elevation="1" className="community-chart-card">
          <div className="community-chart-header">
            <h3>Genre Breakdown</h3>
            <span className="community-chart-subtitle">by total playtime</span>
          </div>
          {genreSlices.length > 0 ? (
            <DonutChart
              slices={genreSlices}
              size={200}
              innerRadius={55}
              formatValue={(v) => formatHours(v)}
            />
          ) : (
            <div className="community-empty-chart">
              <p>Play some games to see your genre breakdown</p>
            </div>
          )}
        </Card>

        {/* Platform breakdown donut */}
        <Card variant="surface" elevation="1" className="community-chart-card">
          <div className="community-chart-header">
            <h3>Platform Split</h3>
            <span className="community-chart-subtitle">by total playtime</span>
          </div>
          {platformSlices.length > 0 ? (
            <DonutChart
              slices={platformSlices}
              size={200}
              innerRadius={55}
              formatValue={(v) => formatHours(v)}
            />
          ) : (
            <div className="community-empty-chart">
              <p>Play some games to see your platform breakdown</p>
            </div>
          )}
        </Card>
      </div>

      {/* ── Weekly Activity Chart ─────────────────────────────────────── */}
      {stats.dailyAvg.length > 0 && (
        <Card variant="surface" elevation="1" className="community-chart-card community-weekly-card">
          <div className="community-chart-header">
            <h3>Last 7 Days</h3>
            <span className="community-chart-subtitle">daily playtime (minutes)</span>
          </div>
          <BarChart
            data={stats.dailyAvg}
            labels={stats.dailyLabels}
            height={200}
            color="var(--color-accent)"
            formatValue={(v) => `${v}m`}
          />
        </Card>
      )}

      {/* ── Year in Review Summary Card ───────────────────────────────── */}
      <Card
        variant="glass"
        elevation="glow"
        className="community-year-card"
        header={
          <div className="community-year-header">
            <span className="community-year-icon">🎮</span>
            <span>Your Gaming Year in Review</span>
          </div>
        }
      >
        <div className="community-year-grid">
          <div className="community-year-stat">
            <span className="community-year-stat-value">{formatHours(stats.totalPlayTimeMin)}</span>
            <span className="community-year-stat-label">Total Playtime</span>
          </div>
          <div className="community-year-stat">
            <span className="community-year-stat-value">{stats.totalSessions}</span>
            <span className="community-year-stat-label">Sessions</span>
          </div>
          <div className="community-year-stat">
            <span className="community-year-stat-value">{totalGames}</span>
            <span className="community-year-stat-label">Games in Library</span>
          </div>
          <div className="community-year-stat">
            <span className="community-year-stat-value">{stats.topGames.length}</span>
            <span className="community-year-stat-label">Games Played</span>
          </div>
          <div className="community-year-stat">
            <span className="community-year-stat-value">{stats.longestSessionMin > 0 ? formatHours(stats.longestSessionMin) : "—"}</span>
            <span className="community-year-stat-label">Longest Session</span>
          </div>
          <div className="community-year-stat">
            <span className="community-year-stat-value">{stats.avgSessionMin > 0 ? formatHours(stats.avgSessionMin) : "—"}</span>
            <span className="community-year-stat-label">Avg Session</span>
          </div>
          <div className="community-year-stat">
            <span className="community-year-stat-value">{distinctGenres}</span>
            <span className="community-year-stat-label">Genres Played</span>
          </div>
          {stats.avgFpsAll > 0 && (
            <div className="community-year-stat">
              <span className="community-year-stat-value">{stats.avgFpsAll} fps</span>
              <span className="community-year-stat-label">Avg FPS</span>
            </div>
          )}
        </div>
      </Card>

      {/* ── Most Played Games Breakdown ─────────────────────────────────── */}
      <Card
        variant="surface"
        elevation="1"
        className="community-year-card community-breakdown-card"
        header={
          <div className="community-year-header">
            <span className="community-year-icon">🏆</span>
            <span>Most Played Games</span>
            {topGames.length > 0 && (
              <span className="community-breakdown-total">
                {topGames.length} of {stats.topGames.length} ranked
              </span>
            )}
          </div>
        }
      >
        {topGames.length > 0 ? (
          <ol className="community-breakdown-list">
            {topGames.map((g, i) => (
              <li key={g.gameId} className="community-breakdown-row">
                <span className="community-breakdown-rank">{i + 1}</span>
                <div className="community-breakdown-cover">
                  {g.coverArtUrl ? (
                    <img src={g.coverArtUrl} alt="" loading="lazy" />
                  ) : (
                    <div className="community-breakdown-cover-fallback">{GamepadIcon}</div>
                  )}
                </div>
                <div className="community-breakdown-info">
                  <div className="community-breakdown-name-row">
                    <span className="community-breakdown-name" title={g.gameName}>{g.gameName}</span>
                    <span className="community-breakdown-time">{formatHours(g.minutes)}</span>
                  </div>
                  <div className="community-breakdown-bar">
                    <div
                      className="community-breakdown-bar-fill"
                      style={{ width: `${g.pct}%` }}
                    />
                  </div>
                  <div className="community-breakdown-meta">
                    {g.platform && <span className="community-breakdown-platform">{g.platform}</span>}
                    <span>{g.sessions} session{g.sessions !== 1 ? "s" : ""}</span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="community-empty-chart">
            <p>Play some games to see your most played breakdown</p>
          </div>
        )}
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Screenshots Section (#4) — auto-detect Steam + game-grouped accordion
// ═══════════════════════════════════════════════════════════════════════════════

interface ScreenshotGroup {
  key: string; // unique key for React + expansion tracking
  appId?: number;
  gameName: string;
  gameId?: string;
  coverArtUrl?: string;
  platform?: string;
  folderPath: string;
  screenshots: string[];
  /** Source badge: undefined (Steam/user folder), "nvidia", "amd", or "obs" */
  source?: string;
}

function ScreenshotsSection() {
  const { games } = useGames();
  const { showToast } = useToast();

  // Keep a ref to games so handleAutoDetect doesn't re-create on every playtime tick.
  // Follows the same pattern used in ActivityContext and GameContext.
  const gamesRef = useRef(games);
  useEffect(() => { gamesRef.current = games; }, [games]);

  // ── Auto-detect Steam state ────────────────────────────────────────
  const [groups, setGroups] = useState<ScreenshotGroup[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [isDetecting, setIsDetecting] = useState(false);

  // ── Manual folder state ───────────────────────────────────────────
  const [manualImages, setManualImages] = useState<string[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  // ── Lightbox state (unified across ALL screenshots) ───────────────
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Build a flat array of ALL image paths for lightbox navigation.
  // Prefer groups (Steam detected) over manual folder, but show whichever has content.
  const allImagePaths = useMemo(() => {
    if (groups.length > 0) {
      const flat: string[] = [];
      for (const g of groups) {
        flat.push(...g.screenshots);
      }
      return flat;
    }
    return manualImages;
  }, [groups, manualImages]);

  // ── Auto-detect Steam screenshots ─────────────────────────────────
  const handleAutoDetect = useCallback(async () => {
    setIsDetecting(true);
    setGroups([]);
    setManualImages([]);
    setSelectedFolder(null);
    setExpandedKeys(new Set());

    try {
      // Fan out both detections in parallel
      const [steamFolders, systemFolders] = await Promise.all([
        invoke<{
          appId: number;
          gameName: string;
          folderPath: string;
          screenshots: string[];
        }[]>("detect_steam_screenshot_folders"),
        invoke<{
          source: string;
          gameName: string;
          folderPath: string;
          screenshots: string[];
        }[]>("detect_system_screenshot_folders"),
      ]);

      // ---- Enrich Steam folders with library metadata ----
      const enriched: ScreenshotGroup[] = steamFolders.map((f) => {
        const libGame = gamesRef.current.find((g) => g.steamAppId === f.appId);
        const groupKey = `steam-${f.appId}`;
        if (libGame) {
          return {
            key: groupKey,
            appId: f.appId,
            gameName: libGame.name,
            gameId: libGame.id,
            coverArtUrl: libGame.coverArtUrl,
            platform: libGame.platform,
            folderPath: f.folderPath,
            screenshots: f.screenshots,
          };
        }
        return {
          key: groupKey,
          appId: f.appId,
          gameName: f.gameName,
          folderPath: f.folderPath,
          screenshots: f.screenshots,
        };
      });

      // ---- Add system folders (NVIDIA, AMD, OBS) ----
      for (const sf of systemFolders) {
        enriched.push({
          key: `${sf.source}-${sf.folderPath.replace(/[^a-zA-Z0-9]/g, "-")}`,
          gameName: sf.gameName,
          folderPath: sf.folderPath,
          screenshots: sf.screenshots,
          source: sf.source,
        });
      }

      if (enriched.length === 0) {
        showToast("No screenshots found. Take some captures first!", "info");
        setIsDetecting(false);
        return;
      }

      // Sort by game name
      enriched.sort((a, b) => a.gameName.localeCompare(b.gameName));

      // Auto-expand the first few groups
      const initialExpanded = new Set<string>();
      for (let i = 0; i < Math.min(enriched.length, 3); i++) {
        initialExpanded.add(enriched[i].key);
      }

      setGroups(enriched);
      setExpandedKeys(initialExpanded);

      const totalCount = enriched.reduce((s, g) => s + g.screenshots.length, 0);
      const srcCount = systemFolders.length > 0
        ? ` (${steamFolders.length} Steam, ${systemFolders.length} system)`
        : "";
      showToast(`Found ${enriched.length} groups with ${totalCount} screenshots${srcCount}`, "success");
    } catch (err) {
      console.error("[Community] Steam screenshot detection failed:", err);
      showToast("Failed to detect Steam screenshots", "error");
    } finally {
      setIsDetecting(false);
    }
  }, [showToast]);

  // ── Manual folder picker ──────────────────────────────────────────
  const handlePickFolder = useCallback(async () => {
    try {
      const folderPath = await tauriOpen({
        directory: true,
        multiple: false,
        title: "Select Screenshot Folder",
      });
      if (!folderPath || typeof folderPath !== "string") return;

      // Clear Steam groups when switching to manual mode
      setGroups([]);
      setSelectedFolder(folderPath);
      setIsScanning(true);

      const paths: string[] = await invoke("list_image_files", {
        folderPath,
      });
      setManualImages(paths);
      if (paths.length === 0) {
        showToast("No images found in this folder", "info");
      }
    } catch (err) {
      console.error("[Community] Failed to scan folder:", err);
      showToast("Failed to scan folder for images", "error");
    } finally {
      setIsScanning(false);
    }
  }, [showToast]);

  // ── Accordion toggle ──────────────────────────────────────────────
  const toggleGroup = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // ── Lightbox ──────────────────────────────────────────────────────
  const openLightbox = useCallback((index: number) => {
    setLightboxIndex(index);
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxIndex(null);
  }, []);

  const goNext = useCallback(() => {
    setLightboxIndex((prev) => {
      if (prev === null || allImagePaths.length === 0) return null;
      return (prev + 1) % allImagePaths.length;
    });
  }, [allImagePaths.length]);

  const goPrev = useCallback(() => {
    setLightboxIndex((prev) => {
      if (prev === null || allImagePaths.length === 0) return null;
      return (prev - 1 + allImagePaths.length) % allImagePaths.length;
    });
  }, [allImagePaths.length]);

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (lightboxIndex === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxIndex, closeLightbox, goNext, goPrev]);

  // ── Build a lookup: screenshot index → group ──────────────────────
  const screenshotGroupIndex = useMemo(() => {
    if (groups.length === 0) return null;
    const map: { groupKey: string; gameName: string }[] = [];
    for (const g of groups) {
      for (let i = 0; i < g.screenshots.length; i++) {
        map.push({ groupKey: g.key, gameName: g.gameName });
      }
    }
    return map;
  }, [groups]);

  // ── Precompute offset of each group in the flat image array ───────
  const groupOffsets = useMemo(() => {
    const offsets = new Map<string, number>();
    let current = 0;
    for (const g of groups) {
      offsets.set(g.key, current);
      current += g.screenshots.length;
    }
    return offsets;
  }, [groups]);

  // ── Determine what to show ────────────────────────────────────────
  const hasContent = groups.length > 0 || manualImages.length > 0 || isScanning || isDetecting;

  return (
    <div className="community-screenshots">
      {/* Toolbar */}
      <div className="community-screenshots-toolbar">
        <Button
          variant="primary"
          onClick={handleAutoDetect}
          disabled={isDetecting}
          leftIcon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          }
        >
          {isDetecting ? "Detecting…" : "Auto-detect Steam Screenshots"}
        </Button>
        <Button
          variant="secondary"
          onClick={handlePickFolder}
          disabled={isScanning || isDetecting}
          leftIcon={FolderIcon}
        >
          {selectedFolder ? "Change Folder" : "Pick Screenshot Folder"}
        </Button>
        {selectedFolder && (
          <span className="community-screenshots-folder" title={selectedFolder}>
            {selectedFolder.split(/[\\/]/).pop() || selectedFolder}
            <span className="community-screenshots-count">
              {isScanning ? "Scanning…" : `${manualImages.length} images`}
            </span>
          </span>
        )}
      </div>

      {/* Empty / tip state */}
      {!hasContent && (
        <div className="community-screenshots-empty">
          <div className="community-screenshots-empty-icon">{ImageIcon}</div>
          <h3>Browse Your Screenshots</h3>
          <p>
            Auto-detect your Steam screenshots from any account that
            has signed in on this PC, or pick any folder with game captures.
          </p>
        </div>
      )}

      {/* Loading: Steam detection */}
      {isDetecting && (
        <div className="community-screenshots-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={`detect-sk-${i}`} className="community-screenshot-thumb skeleton" />
          ))}
        </div>
      )}

      {/* Loading: manual folder scan */}
      {isScanning && (
        <div className="community-screenshots-grid">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={`scan-sk-${i}`} className="community-screenshot-thumb skeleton" />
          ))}
        </div>
      )}

      {/* ── Game-grouped accordion (Steam detected) ────────────────── */}
      {!isDetecting && groups.length > 0 && (
        <div className="community-screenshot-groups">
          {groups.map((group) => {
            const isExpanded = expandedKeys.has(group.key);
            const offset = groupOffsets.get(group.key) || 0;

            return (
              <div key={group.key} className="community-screenshot-group">
                {/* Group header */}
                <button
                  type="button"
                  className="community-screenshot-group-header"
                  onClick={() => toggleGroup(group.key)}
                  aria-expanded={isExpanded}
                >
                  <div className="community-screenshot-group-cover">
                    {group.coverArtUrl ? (
                      <img src={group.coverArtUrl} alt="" loading="lazy" />
                    ) : (
                      <div className="community-screenshot-group-cover-fallback">
                        {GamepadIcon}
                      </div>
                    )}
                  </div>
                  <div className="community-screenshot-group-info">
                    <span className="community-screenshot-group-name">{group.gameName}</span>
                    <div className="community-screenshot-group-tags">
                      {group.source && (
                        <span className={`community-source-badge community-source-${group.source}`}>
                          {group.source === "nvidia" ? "NVIDIA" : group.source === "amd" ? "AMD" : group.source === "obs" ? "OBS" : group.source}
                        </span>
                      )}
                      {group.platform && (
                        <span className="community-screenshot-group-platform">{group.platform}</span>
                      )}
                    </div>
                  </div>
                  <div className="community-screenshot-group-right">
                    <span className="community-screenshot-group-count">
                      {group.screenshots.length} screenshot{group.screenshots.length !== 1 ? "s" : ""}
                    </span>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      width="18"
                      height="18"
                      className={`community-screenshot-group-chevron${isExpanded ? " expanded" : ""}`}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                </button>

                {/* Group thumbnails (collapsible) */}
                {isExpanded && (
                  <div className="community-screenshot-group-grid">
                    {group.screenshots.map((p, i) => {
                      const globalIndex = offset + i;
                      return (
                        <div
                          key={p}
                          className="community-screenshot-thumb"
                          onClick={() => openLightbox(globalIndex)}
                          role="button"
                          tabIndex={0}
                          aria-label={`${group.gameName} screenshot ${i + 1}`}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openLightbox(globalIndex);
                            }
                          }}
                        >
                          <img
                            src={convertFileSrc(p)}
                            alt={`${group.gameName} ${i + 1}`}
                            loading="lazy"
                            onError={(e) => {
                              const img = e.currentTarget;
                              if (img.dataset.fallbackTried === "1") return;
                              img.dataset.fallbackTried = "1";
                              invoke<string>("read_cover_image", { filePath: p })
                                .then((dataUrl) => {
                                  img.src = dataUrl;
                                })
                                .catch(() => {
                                  img.style.display = "none";
                                  const placeholder = img.parentElement?.querySelector(
                                    ".community-screenshot-fallback"
                                  ) as HTMLElement | null;
                                  if (placeholder) placeholder.style.display = "flex";
                                });
                            }}
                          />
                          <div className="community-screenshot-fallback" style={{ display: "none" }}>
                            {ImageIcon}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Manual folder gallery (flat grid, no grouping) ──────────── */}
      {!isScanning && !isDetecting && manualImages.length > 0 && groups.length === 0 && (
        <div className="community-screenshots-grid">
          {manualImages.map((p, i) => (
            <div
              key={p}
              className="community-screenshot-thumb"
              onClick={() => openLightbox(i)}
              role="button"
              tabIndex={0}
              aria-label={`Screenshot ${i + 1}`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openLightbox(i);
                }
              }}
            >
              <img
                src={convertFileSrc(p)}
                alt={`Screenshot ${i + 1}`}
                loading="lazy"
                onError={(e) => {
                  const img = e.currentTarget;
                  if (img.dataset.fallbackTried === "1") return;
                  img.dataset.fallbackTried = "1";
                  invoke<string>("read_cover_image", { filePath: p })
                    .then((dataUrl) => {
                      img.src = dataUrl;
                    })
                    .catch(() => {
                      img.style.display = "none";
                      const placeholder = img.parentElement?.querySelector(
                        ".community-screenshot-fallback"
                      ) as HTMLElement | null;
                      if (placeholder) placeholder.style.display = "flex";
                    });
                }}
              />
              <div className="community-screenshot-fallback" style={{ display: "none" }}>
                {ImageIcon}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty after manual scan */}
      {!isScanning && !isDetecting && selectedFolder && manualImages.length === 0 && groups.length === 0 && (
        <div className="community-screenshots-empty">
          <p>No images found in this folder.</p>
        </div>
      )}

      {/* ── Lightbox (unified) ──────────────────────────────────────── */}
      {lightboxIndex !== null && allImagePaths[lightboxIndex] && (
        <div className="community-lightbox" onClick={closeLightbox}>
          <div className="community-lightbox-controls" onClick={(e) => e.stopPropagation()}>
            <button
              className="community-lightbox-nav"
              onClick={goPrev}
              aria-label="Previous image"
            >
              {ChevronLeftIcon}
            </button>
            <div className="community-lightbox-info">
              <span className="community-lightbox-counter">
                {lightboxIndex + 1} / {allImagePaths.length}
              </span>
              {screenshotGroupIndex && screenshotGroupIndex[lightboxIndex] && (
                <span className="community-lightbox-game-name">
                  {screenshotGroupIndex[lightboxIndex].gameName}
                </span>
              )}
            </div>
            <button
              className="community-lightbox-nav"
              onClick={goNext}
              aria-label="Next image"
            >
              {ChevronRightIcon}
            </button>
            <button
              className="community-lightbox-close"
              onClick={closeLightbox}
              aria-label="Close lightbox"
            >
              {XIcon}
            </button>
          </div>
          <div className="community-lightbox-image-wrapper" onClick={(e) => e.stopPropagation()}>
            <img
              src={convertFileSrc(allImagePaths[lightboxIndex])}
              alt={`Screenshot ${lightboxIndex + 1}`}
              onError={(e) => {
                const img = e.currentTarget;
                if (img.dataset.fallbackTried === "1") return;
                img.dataset.fallbackTried = "1";
                invoke<string>("read_cover_image", { filePath: allImagePaths[lightboxIndex] })
                  .then((dataUrl) => {
                    img.src = dataUrl;
                  })
                  .catch(() => {});
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// News & Discussion Section (#5)
// ═══════════════════════════════════════════════════════════════════════════════

function NewsDiscussionSection() {
  const {
    articles,
    loading: newsLoading,
    error: newsError,
    activeSource,
    sourceNames,
    setSourceFilter,
    refresh: newsRefresh,
  } = useNewsFeeds();
  const { games } = useGames();

  // Top 8 most recent articles
  const topArticles = useMemo(() => articles.slice(0, 8), [articles]);

  // Trending games: Steam games with player count potential, sorted by lastPlayed
  const trendingGames = useMemo(() => {
    return games
      .filter((g) => g.steamAppId && g.lastPlayed)
      .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
      .slice(0, 6);
  }, [games]);

  // Discussion links for trending games
  const discussionLinks = useMemo(() => {
    return trendingGames.map((g) => ({
      game: g,
      discussions: `https://steamcommunity.com/app/${g.steamAppId}/discussions/`,
    }));
  }, [trendingGames]);

  return (
    <div className="community-news">
      {/* ── Trending Games Row ─────────────────────────────────────── */}
      {trendingGames.length > 0 && (
        <section className="community-news-section">
          <div className="community-news-section-header">
            <h3>
              <span className="community-news-section-icon">{TrendingIcon}</span>
              Trending in Your Library
            </h3>
          </div>
          <div className="community-trending-grid">
            {trendingGames.map((game) => (
              <div key={game.id} className="community-trending-card">
                <div className="community-trending-cover">
                  {game.coverArtUrl ? (
                    <img src={game.coverArtUrl} alt={game.name} loading="lazy" />
                  ) : (
                    <div className="community-trending-cover-fallback">
                      {SparkleIcon}
                    </div>
                  )}
                </div>
                <div className="community-trending-body">
                  <span className="community-trending-name" title={game.name}>
                    {game.name}
                  </span>
                  <span className="community-trending-platform">{game.platform}</span>
                  <div className="community-trending-links">
                    {game.steamAppId && (
                      <>
                        <a
                          href={`https://steamcommunity.com/app/${game.steamAppId}/discussions/`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="community-trending-link"
                          title="Steam Discussions"
                        >
                          {MessageIcon}
                        </a>
                        <a
                          href={`https://steamcommunity.com/app/${game.steamAppId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="community-trending-link"
                          title="Steam Community Hub"
                        >
                          {ExternalLinkIcon}
                        </a>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── News Feed ────────────────────────────────────────────────── */}
      <section className="community-news-section">
        <div className="community-news-section-header">
          <h3>
            <span className="community-news-section-icon">{NewsIcon}</span>
            Gaming News
          </h3>
          <button
            type="button"
            className="community-news-refresh"
            onClick={newsRefresh}
            title="Refresh news"
            disabled={newsLoading}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" className={newsLoading ? "spinning" : ""}>
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>

        {/* Source filter pills */}
        {sourceNames.length > 0 && (
          <div className="community-news-pills">
            <button
              type="button"
              className={`community-news-pill${activeSource === null ? " active" : ""}`}
              onClick={() => setSourceFilter(null)}
            >
              All
            </button>
            {sourceNames.map((name) => (
              <button
                key={name}
                type="button"
                className={`community-news-pill${activeSource === name ? " active" : ""}`}
                onClick={() => setSourceFilter(activeSource === name ? null : name)}
              >
                {name}
              </button>
            ))}
          </div>
        )}

        {/* News cards */}
        {newsLoading ? (
          <div className="community-news-grid">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="community-news-card skeleton">
                <div className="skeleton-cover" />
                <div className="skeleton-body">
                  <div className="skeleton-line skeleton-title" />
                  <div className="skeleton-line skeleton-subtitle" />
                </div>
              </div>
            ))}
          </div>
        ) : newsError && articles.length === 0 ? (
          <div className="community-news-empty">
            <p>{newsError}</p>
            <button type="button" className="community-news-retry" onClick={newsRefresh}>
              Retry
            </button>
          </div>
        ) : topArticles.length === 0 ? (
          <div className="community-news-empty">
            <p>No news articles yet. Add feeds in the News page settings.</p>
          </div>
        ) : (
          <div className="community-news-grid">
            {topArticles.map((article, i) => (
              <CommunityNewsCard key={`${article.link}-${i}`} article={article} />
            ))}
          </div>
        )}
      </section>

      {/* ── Discussion Quick Links ────────────────────────────────────── */}
      {discussionLinks.length > 0 && (
        <section className="community-news-section">
          <div className="community-news-section-header">
            <h3>
              <span className="community-news-section-icon">{MessageIcon}</span>
              Discussion Links
            </h3>
            <span className="community-news-section-subtitle">Your recently played games</span>
          </div>
          <div className="community-discussion-list">
            {discussionLinks.map(({ game, discussions }) => (
              <a
                key={game.id}
                href={discussions}
                target="_blank"
                rel="noopener noreferrer"
                className="community-discussion-item"
              >
                <div className="community-discussion-cover">
                  {game.coverArtUrl ? (
                    <img src={game.coverArtUrl} alt="" loading="lazy" />
                  ) : (
                    <div className="community-discussion-cover-fallback">
                      {GamepadIcon}
                    </div>
                  )}
                </div>
                <div className="community-discussion-info">
                  <span className="community-discussion-game">{game.name}</span>
                  <span className="community-discussion-hint">Steam Discussions →</span>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ─── News Card (compact) ─────────────────────────────────────────────────

function CommunityNewsCard({ article }: { article: NewsArticle }) {
  const handleClick = useCallback(() => {
    window.open(article.link, "_blank", "noopener,noreferrer");
  }, [article.link]);

  return (
    <div
      className="community-news-card"
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-label={`Read: ${article.title}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      <div className="community-news-card-cover">
        {article.imageUrl ? (
          <img src={article.imageUrl} alt="" loading="lazy" onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }} />
        ) : null}
        <span className="community-news-card-source">{article.sourceName}</span>
      </div>
      <div className="community-news-card-body">
        <h4 className="community-news-card-title">{article.title}</h4>
        <span className="community-news-card-date">
          {article.pubDate ? formatArticleDate(article.pubDate) : ""}
        </span>
      </div>
    </div>
  );
}
