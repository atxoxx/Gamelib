import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { open } from "@tauri-apps/plugin-dialog";
import type { Game } from "../../types/game";
import { parsePlayTime, formatPlayTime } from "../../types/game";
import { useGames } from "../../context/GameContext";
import { useToast } from "../../context/ToastContext";
import { gameNameFromPath } from "../../types/game";

interface LibraryHeroProps {
  games: Game[];
}

/**
 * Library hero: time-of-day greeting, four aggregate KPI tiles, and a pair
 * of quick-action CTAs. Sits at the top of the Library page above the
 * filter chips, giving the page a recognizable "home" feel.
 *
 * The hero also paints a blurred cover-collage wallpaper from the user's
 * own library art, so the panel reads as *their* collection rather than a
 * generic surface. Decorative only (aria-hidden).
 */
export default function LibraryHero({ games }: LibraryHeroProps) {
  const navigate = useNavigate();
  const { importLocalGames } = useGames();
  const { showToast } = useToast();

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 5) return "Up late";
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  const stats = useMemo(() => {
    const total = games.length;
    const installed = games.filter((g) => g.installed).length;
    const installedPct = total > 0 ? Math.round((installed / total) * 100) : 0;
    const totalMinutes = games.reduce((sum, g) => sum + parsePlayTime(g.playTime), 0);
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentlyAdded = games.filter((g) => (g.addedAt ?? 0) >= sevenDaysAgo).length;
    return { total, installed, installedPct, totalPlayTime: formatPlayTime(totalMinutes), recentlyAdded };
  }, [games]);

  // Pick a handful of covers for the blurred backdrop collage.
  const collage = useMemo(
    () => games.filter((g) => g.coverArtUrl).slice(0, 6).map((g) => g.coverArtUrl as string),
    [games]
  );

  async function handleQuickImport() {
    try {
      const filePath = await open({
        multiple: false,
        directory: false,
        title: "Import a Game Executable",
        filters: [{ name: "Executable", extensions: ["exe"] }],
      });
      if (filePath && typeof filePath === "string") {
        await importLocalGames([{ path: filePath, metadata: null }]);
        showToast(`Imported ${gameNameFromPath(filePath)}`, "success");
      }
    } catch (err) {
      console.error("Quick import failed:", err);
      showToast(`Import failed: ${err}`, "error");
    }
  }

  function handleBrowseStore() {
    navigate("/store");
  }

  return (
    <section className="lib-hero" aria-label="Library overview">
      {collage.length > 0 && (
        <div className="lib-hero-collage" aria-hidden>
          {collage.map((src, i) => (
            <img key={i} src={src} alt="" loading="lazy" />
          ))}
        </div>
      )}
      <div className="lib-hero-veil" aria-hidden />

      <div className="lib-hero-content">
        <div className="lib-hero-text">
          <h1 className="lib-hero-greeting">
            {greeting}
            <span className="lib-hero-greeting-dot" aria-hidden>
              .
            </span>
          </h1>
          <p className="lib-hero-subtitle">
            {stats.total === 0
              ? "Your library is looking a little empty — let's fix that."
              : stats.recentlyAdded > 0
                ? `You've spent ${stats.totalPlayTime} across ${stats.total} game${
                    stats.total === 1 ? "" : "s"
                  } · ${stats.recentlyAdded} added this week.`
                : `You've spent ${stats.totalPlayTime} across ${stats.total} game${
                    stats.total === 1 ? "" : "s"
                  }.`}
          </p>
        </div>

        <div className="lib-hero-actions">
          <button type="button" className="lib-hero-btn lib-hero-btn--primary" onClick={handleQuickImport}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Import Games
          </button>
          <button type="button" className="lib-hero-btn lib-hero-btn--ghost" onClick={handleBrowseStore}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
              <polyline points="17 6 23 6 23 12" />
            </svg>
            Browse Store
          </button>
        </div>
      </div>

      <div className="lib-hero-stats">
        <StatTile
          value={stats.total}
          label="Total Games"
          accent="var(--color-accent)"
          delayMs={0}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          }
        />
        <StatTile
          value={stats.installed}
          label="Installed"
          subtext={stats.total > 0 ? `${stats.installedPct}% of library` : "No games yet"}
          accent="var(--color-success)"
          delayMs={70}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          }
        />
        <StatTile
          value={stats.totalPlayTime}
          label="Total Playtime"
          accent="var(--color-info)"
          delayMs={140}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          }
        />
        <StatTile
          value={stats.recentlyAdded}
          label="Added This Week"
          subtext={stats.recentlyAdded === 1 ? "new arrival" : undefined}
          accent="var(--color-warning)"
          delayMs={210}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          }
        />
      </div>
    </section>
  );
}

interface StatTileProps {
  value: string | number;
  label: string;
  subtext?: string;
  accent: string;
  delayMs: number;
  icon: React.ReactNode;
}

function StatTile({ value, label, subtext, accent, delayMs, icon }: StatTileProps) {
  return (
    <div
      className="lib-stat"
      style={{ animationDelay: `${delayMs}ms`, ["--stat-accent" as string]: accent }}
    >
      <div className="lib-stat-icon" aria-hidden>
        {icon}
      </div>
      <div className="lib-stat-body">
        <div className="lib-stat-value" title={String(value)}>{value}</div>
        <div className="lib-stat-label">{label}</div>
        {subtext && <div className="lib-stat-subtext">{subtext}</div>}
      </div>
    </div>
  );
}
