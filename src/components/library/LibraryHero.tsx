import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { open } from "@tauri-apps/plugin-dialog";
import type { Game } from "../../types/game";
import { parsePlayTime, formatPlayTime } from "../../types/game";
import { useGames } from "../../context/GameContext";
import { useToast } from "../../context/ToastContext";
import StatCard from "./StatCard";
import { gameNameFromPath } from "../../types/game";

interface LibraryHeroProps {
  games: Game[];
}

/**
 * Library hero: time-of-day greeting, four aggregate stat cards, and
 * a pair of quick-action CTAs. Sits at the top of the Library page
 * above the filter chips, giving the page a recognizable "home" feel
 * instead of dropping straight into the grid.
 *
 * The hero also exports the four computed stat numbers as a `useMemo`
 * so callers that want to reuse the same numbers (e.g. an info bar
 * elsewhere) don't recompute them. We don't actually use that here,
 * but it documents the derivation is intentional rather than a free
 * side effect of the render.
 *
 * The "Import Games" button is wired to a single-file exe picker that
 * calls `importLocalGames` directly with `metadata: null` so the user
 * gets an instant one-click import without going through the multi-
 * file matching modal. The full Folder Scan flow is still available
 * in the sidebar's import menu for power users.
 */
export default function LibraryHero({ games }: LibraryHeroProps) {
  const navigate = useNavigate();
  const { importLocalGames } = useGames();
  const { showToast } = useToast();

  // Time-of-day greeting: morning < 12, afternoon < 18, evening otherwise.
  // Computed once on mount — flipping the greeting mid-session feels
  // gimmicky and would force a re-render every minute.
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 5) return "Up late";
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  // ── Aggregate stats ────────────────────────────────────────────────
  // Four numbers, four cards. Computed off the raw `games` array so
  // they're always in sync with the grid below — no separate source
  // of truth to keep aligned.
  const stats = useMemo(() => {
    const total = games.length;
    const installed = games.filter((g) => g.installed).length;
    const installedPct =
      total > 0 ? Math.round((installed / total) * 100) : 0;
    const totalMinutes = games.reduce(
      (sum, g) => sum + parsePlayTime(g.playTime),
      0
    );
    // "Recently added" = games whose `addedAt` falls in the last 7 days.
    // Using a 7-day window (vs 30) keeps the count meaningful even for
    // a moderate library — a 30-day window would saturate the label
    // with a single big Steam import and stop being a useful signal.
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentlyAdded = games.filter(
      (g) => (g.addedAt ?? 0) >= sevenDaysAgo
    ).length;
    return {
      total,
      installed,
      installedPct,
      totalPlayTime: formatPlayTime(totalMinutes),
      recentlyAdded,
    };
  }, [games]);

  async function handleQuickImport() {
    try {
      const filePath = await open({
        multiple: false,
        directory: false,
        title: "Import a Game Executable",
        filters: [{ name: "Executable", extensions: ["exe"] }],
      });
      if (filePath && typeof filePath === "string") {
        // Single-file quick import — no matching modal, no IGDB scrape.
        // The user can open the game page later to fetch metadata.
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
    <section className="library-hero" aria-label="Library overview">
      <div className="library-hero-glow" aria-hidden />

      <div className="library-hero-content">
        <div className="library-hero-text">
          <h1 className="library-hero-greeting">
            {greeting}
            <span className="library-hero-greeting-dot" aria-hidden>
              .
            </span>
          </h1>
          <p className="library-hero-subtitle">
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

        <div className="library-hero-actions">
          <button
            type="button"
            className="library-hero-btn library-hero-btn--primary"
            onClick={handleQuickImport}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Import Games
          </button>
          <button
            type="button"
            className="library-hero-btn library-hero-btn--secondary"
            onClick={handleBrowseStore}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
              <polyline points="17 6 23 6 23 12" />
            </svg>
            Browse Store
          </button>
        </div>
      </div>

      <div className="library-hero-stats">
        <StatCard
          value={stats.total}
          label="Total Games"
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          }
          delayMs={0}
        />
        <StatCard
          value={stats.installed}
          label="Installed"
          subtext={
            stats.total > 0
              ? `${stats.installedPct}% of library`
              : "No games yet"
          }
          tone="success"
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          }
          delayMs={60}
        />
        <StatCard
          value={stats.totalPlayTime}
          label="Total Playtime"
          tone="info"
          icon={
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
              <polyline points="12 6 12 12 16 14" />
            </svg>
          }
          delayMs={120}
        />
        <StatCard
          value={stats.recentlyAdded}
          label="Added This Week"
          subtext={stats.recentlyAdded === 1 ? "new arrival" : undefined}
          tone="warning"
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          }
          delayMs={180}
        />
      </div>
    </section>
  );
}
