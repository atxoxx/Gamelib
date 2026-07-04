import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { StoreGameSummary, StoreCategory } from "../../types/game";
import StoreGameCard from "./StoreGameCard";

interface SnapRailProps {
  /** Display heading (e.g. "Trending", "Coming Soon"). */
  title: string;
  /** IGDB category to fetch — passed to `fetch_store_games`. */
  category: StoreCategory;
  /** Number of games to load (default 12). */
  limit?: number;
  /** Called when a game card is clicked. */
  onCardClick: (game: StoreGameSummary) => void;
  /** Called when the user clicks the "See all →" link. */
  onSeeAll: (category: StoreCategory) => void;
  /** Optional accent emoji shown next to the title. */
  badge?: string;
}

/**
 * SnapRail: a horizontal scroller that shows a slice of games from a
 * single IGDB category. Reused across the Discover landing for Trending,
 * Popular, Top, Coming Soon, and New Releases rails.
 *
 * - Fetches games on mount via the existing `fetch_store_games` Tauri
 *   command and renders them as `StoreGameCard`s.
 * - Loading state shows 6 skeleton cards.
 * - Empty state hides the entire rail.
 * - Pointer-driven horizontal scrolling (matches web store conventions).
 */
export default function SnapRail({
  title,
  category,
  limit = 12,
  onCardClick,
  onSeeAll,
  badge,
}: SnapRailProps) {
  const [games, setGames] = useState<StoreGameSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  // ── Fetch on mount and when category changes ───────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const results = await invoke<StoreGameSummary[]>(
          "fetch_store_games",
          {
            category,
            offset: 0,
            limit,
          }
        );
        if (!cancelled) {
          setGames(results);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
          setGames([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [category, limit]);

  // ── Pointer-driven horizontal scroll (mouse-wheel h-scroll) ────────
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      // Only hijack when the user is scrolling vertically with a horizontal
      // intent (deltaY dominant). Also skip if Trackpad horizontal scroll
      // (deltaX is significant).
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      // Don't hijack if the user is already at the rail edges
      if (
        (el.scrollLeft <= 0 && e.deltaY < 0) ||
        (el.scrollLeft >= el.scrollWidth - el.clientWidth - 1 && e.deltaY > 0)
      ) {
        return;
      }
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ── Hide rail when errored out or empty after fetch ────────────────
  if (games !== null && games.length === 0) return null;

  return (
    <section className="store-rail" aria-label={`${title} rail`}>
      <header className="store-rail-header">
        <h3 className="store-rail-title">
          {badge && <span className="store-rail-badge">{badge}</span>}
          {title}
        </h3>

        <button
          type="button"
          className="store-rail-see-all"
          onClick={() => onSeeAll(category)}
          aria-label={`See all ${title}`}
        >
          See all
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </header>

      <div ref={trackRef} className="store-rail-track">
        {games === null && !error
          ? Array.from({ length: 6 }).map((_, i) => (
              <div
                key={"skel-" + i}
                className="store-rail-card-skeleton"
                aria-hidden="true"
              >
                <div className="store-rail-shimmer" />
              </div>
            ))
          : games?.map((game) => (
              <div key={game.id} className="store-rail-card-snap">
                {/* SnapRail forces density=\"cozy\" so rail heights stay
                    predictable regardless of user's density setting. */}
                <StoreGameCard
                  game={game}
                  onClick={onCardClick}
                  density="cozy"
                />
              </div>
            ))}
      </div>
    </section>
  );
}
