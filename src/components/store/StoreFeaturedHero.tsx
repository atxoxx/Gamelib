import { useEffect, useRef, useState, type ReactElement } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { StoreGameSummary } from "../../types/game";
import StoreGameCard from "./StoreGameCard";

type HeroCategory = "hot" | "weekly" | "achievements";

interface StoreFeaturedHeroProps {
  /** Navigate to a game's detail page. */
  onPickGame: (game: StoreGameSummary) => void;
}

/**
 * Subtabs map 1:1 to Hydra Launcher's curated catalogue categories
 * (`CatalogueCategory` = hot / weekly / achievements). Each tab calls
 * Hydra's own `/catalogue/{category}` API — the exact same method
 * Hydra's home page uses — filtered to the user's enabled download
 * sources. "Surprise me" jumps to a random card from the visible rail.
 */
const TABS: {
  id: HeroCategory;
  label: string;
  icon: ReactElement;
}[] = [
  {
    id: "hot",
    label: "Hot Now",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2c1 3-1 4-1 6 0 1.5 1 2 2 2 2 0 2-2 2-4 3 2 5 5 5 9 0 4-3 7-7 8-3 .7-5-1-6-3-2-3-1-7 1-9 1-2 4-4 5-7z" />
      </svg>
    ),
  },
  {
    id: "weekly",
    label: "Game of the Week",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <path d="M9 16l2 2 4-4" />
      </svg>
    ),
  },
  {
    id: "achievements",
    label: "Games to Beat",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="8" r="6" />
        <path d="M9.5 13.5 8 22l4-3 4 3-1.5-8.5" />
      </svg>
    ),
  },
];

const HERO_LIMIT = 12;

/**
 * Hydra-style featured rail: a wide banner of up to 12 game cards with
 * pill subtabs (Hot Now / Game of the Week / Games to Beat) that switch
 * only this rail's contents — the catalogue grid below keeps its own
 * sort. "Surprise me" jumps to a random card from the visible rail.
 */
export default function StoreFeaturedHero({ onPickGame }: StoreFeaturedHeroProps) {
  const [tab, setTab] = useState<HeroCategory>("hot");
  const [games, setGames] = useState<StoreGameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [surprising, setSurprising] = useState(false);
  const cacheRef = useRef<Partial<Record<HeroCategory, StoreGameSummary[]>>>({});
  const reqRef = useRef(0);

  useEffect(() => {
    const cached = cacheRef.current[tab];
    if (cached) {
      setGames(cached);
      setLoading(false);
      return;
    }
    const id = ++reqRef.current;
    setLoading(true);
    // Same method as Hydra Launcher: GET /catalogue/{category} on the
    // Hydra API, curated to the user's enabled download sources.
    invoke<StoreGameSummary[]>("fetch_hydra_featured", { category: tab })
      .then((res) => {
        if (id !== reqRef.current) return;
        cacheRef.current[tab] = res;
        setGames(res);
        setLoading(false);
      })
      .catch(() => {
        if (id === reqRef.current) setLoading(false);
      });
  }, [tab]);

  const handleSurprise = async () => {
    if (surprising) return;
    // Fetch a genuinely random game from the whole catalogue (the same
    // "surprise me" behaviour as Hydra Launcher) rather than just
    // picking from the cards currently on screen.
    setSurprising(true);
    try {
      const game = await invoke<StoreGameSummary>("get_random_store_game");
      onPickGame(game);
    } catch {
      // Fallback: pick a random card from the visible rail.
      if (games.length > 0) {
        onPickGame(games[Math.floor(Math.random() * games.length)]);
      }
    } finally {
      setSurprising(false);
    }
  };

  return (
    <section className="store-featured-section" aria-label="Store highlights">
      <div className="store-featured-head">
        <div className="store-featured-tablist" role="tablist" aria-label="Featured categories">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`store-featured-tab${tab === t.id ? " active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              <span className="store-featured-tab-icon" aria-hidden="true">
                {t.icon}
              </span>
              {t.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className={`store-featured-surprise${surprising ? " is-spinning" : ""}`}
          onClick={handleSurprise}
          title="Jump to a random game"
          disabled={surprising}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="16 3 21 3 21 8" />
            <line x1="4" y1="20" x2="21" y2="3" />
            <polyline points="21 16 21 21 16 21" />
            <line x1="15" y1="15" x2="21" y2="21" />
            <line x1="4" y1="4" x2="9" y2="9" />
          </svg>
          Surprise me
        </button>
      </div>

      <div className="store-featured-rail">
        {loading && games.length === 0
          ? Array.from({ length: HERO_LIMIT }).map((_, i) => (
              <div
                key={i}
                className="store-game-card store-game-card-skeleton density-cinematic"
              >
                <div className="store-card-cover">
                  <div className="store-card-cover-skeleton" />
                </div>
              </div>
            ))
          : games.map((g) => (
              <StoreGameCard
                key={`${tab}-${g.id}-${g.slug}`}
                game={g}
                onClick={onPickGame}
                density="cinematic"
              />
            ))}
      </div>
    </section>
  );
}
