import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { StoreGameSummary, StoreSort } from "../../types/game";
import StoreGameCard from "./StoreGameCard";

type HeroTab = "hot" | "week" | "beat";

interface StoreFeaturedHeroProps {
  /** Navigate to a game's detail page. */
  onPickGame: (game: StoreGameSummary) => void;
}

/** Subtabs map to IGDB sort presets. Each tab fetches its own 12-card
 *  rail and is fully independent of the catalogue sort below. */
const TABS: { id: HeroTab; sort: StoreSort; label: string }[] = [
  { id: "hot", sort: "trending", label: "Hot Now" },
  { id: "week", sort: "follows", label: "Game of the Week" },
  { id: "beat", sort: "rating", label: "Games to Beat" },
];

const HERO_LIMIT = 12;

/**
 * Hydra-style featured rail: a wide banner of 12 game cards with
 * subtabs (Hot Now / Game of the Week / Games to Beat) that switch only
 * this rail's contents — the catalogue grid below keeps its own sort.
 * "Surprise me" jumps to a random card from the visible rail.
 */
export default function StoreFeaturedHero({ onPickGame }: StoreFeaturedHeroProps) {
  const [tab, setTab] = useState<HeroTab>("hot");
  const [games, setGames] = useState<StoreGameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const cacheRef = useRef<Partial<Record<StoreSort, StoreGameSummary[]>>>({});
  const reqRef = useRef(0);

  const sort = TABS.find((t) => t.id === tab)!.sort;

  useEffect(() => {
    const cached = cacheRef.current[sort];
    if (cached) {
      setGames(cached);
      setLoading(false);
      return;
    }
    const id = ++reqRef.current;
    setLoading(true);
    invoke<StoreGameSummary[]>("fetch_store_games", {
      category: "all",
      offset: 0,
      limit: HERO_LIMIT,
      sort,
    })
      .then((res) => {
        if (id !== reqRef.current) return;
        cacheRef.current[sort] = res;
        setGames(res);
        setLoading(false);
      })
      .catch(() => {
        if (id === reqRef.current) setLoading(false);
      });
  }, [sort]);

  const handleSurprise = () => {
    if (games.length === 0) return;
    const game = games[Math.floor(Math.random() * games.length)];
    onPickGame(game);
  };

  return (
    <section className="store-featured-section" aria-label="Store highlights">
      <div className="store-featured-head">
        <div className="store-featured-tablist" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`store-featured-tab${tab === t.id ? " active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="store-featured-surprise"
          onClick={handleSurprise}
          title="Jump to a random game"
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
                key={g.id}
                game={g}
                onClick={onPickGame}
                density="cinematic"
              />
            ))}
      </div>
    </section>
  );
}
