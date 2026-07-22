import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { useGames } from "../context/GameContext";
import { useToast } from "../context/ToastContext";
import { gameNameFromPath, type Game } from "../types/game";
import LibraryHero from "../components/library/LibraryHero";
import ContinuePlayingRail from "../components/library/ContinuePlayingRail";
import RecentlyAddedRail from "../components/library/RecentlyAddedRail";

/**
 * Home — the app's "wow" first-run surface.
 *
 * Layers a bold brand-gradient hero (the signature violet→cyan→magenta
 * mesh) over the personalized library overview: the greeting + quick
 * actions live in the gradient hero, the aggregate stats reuse
 * `LibraryHero`, and the editorial rails (Continue Playing / Recently
 * Added) carry the everyday browsing into the same screen.
 */
export default function HomePage() {
  const navigate = useNavigate();
  const { games, importLocalGames } = useGames();
  const { showToast } = useToast();

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 5) return "Up late";
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  const isEmpty = games.length === 0;

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
      showToast(`Import failed: ${err}`, "error");
    }
  }

  const openGame = (game: Game) => navigate(`/library/${game.id}`);

  return (
    <div className="home-page">
      <section className="home-hero" aria-label="Welcome">
        <div className="home-hero__mesh" aria-hidden />
        <div className="home-hero__content">
          <p className="home-hero__eyebrow">GameLib</p>
          <h1 className="home-hero__title">
            {greeting},
            <br />
            <span className="home-hero__title-accent">ready to play?</span>
          </h1>
          <p className="home-hero__subtitle">
            {isEmpty
              ? "Your library is empty — import a game or browse the store to get started."
              : `You have ${games.length} game${games.length === 1 ? "" : "s"} ready in your library.`}
          </p>
          <div className="home-hero__actions">
            <button
              type="button"
              className="home-hero__btn home-hero__btn--primary"
              onClick={handleQuickImport}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Import Games
            </button>
            <button
              type="button"
              className="home-hero__btn home-hero__btn--ghost"
              onClick={() => navigate("/store")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                <polyline points="17 6 23 6 23 12" />
              </svg>
              Browse Store
            </button>
          </div>
        </div>
      </section>

      {!isEmpty && <LibraryHero games={games} />}
      {!isEmpty && <ContinuePlayingRail games={games} onCardClick={openGame} />}
      {!isEmpty && games.length >= 4 && <RecentlyAddedRail games={games} onCardClick={openGame} />}
    </div>
  );
}
