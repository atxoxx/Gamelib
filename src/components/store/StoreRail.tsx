import { memo, useEffect, useRef, useState } from "react";
import type { StoreGameSummary, StoreCategory, ViewDensity } from "../../types/game";
import StoreGameCard from "./StoreGameCard";
import { useDiscoverSection } from "../../hooks/useDiscoverRails";

interface StoreRailProps {
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
  /** Density used for the cards (default "cozy"). */
  density?: ViewDensity;
}

/**
 * StoreRail: a horizontal snap-scroller showing a slice of games from a
 * single IGDB category. Reused across the Discover landing.
 *
 * - Fetches via the shared `useDiscoverSection` hook (de-duped,
 *   StrictMode-safe, with a `refresh()` for retry).
 * - Loading shows skeletons; error shows an inline retry; empty hides.
 * - Gets prev/next arrow buttons + pointer/trackpad wheel scrolling.
 * - Lazy-loads into view via IntersectionObserver.
 */
function StoreRail({
  title,
  category,
  limit = 12,
  onCardClick,
  onSeeAll,
  badge,
  density = "cozy",
}: StoreRailProps) {
  const { data, error, loading, refresh } = useDiscoverSection(category, limit);
  const trackRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  // Lazy-reveal: only mount the track (and thus the cards) once the rail
  // scrolls into view. Rails near the top reveal immediately.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            io.disconnect();
            break;
          }
        }
      },
      { rootMargin: "300px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Pointer-driven horizontal scroll (mouse-wheel h-scroll).
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
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

  const scrollBy = (dir: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    const amount = Math.max(el.clientWidth * 0.8, 240);
    el.scrollBy({ left: dir * amount, behavior: "smooth" });
  };

  const games = inView ? data : null;
  const isEmpty = games !== null && games.length === 0;

  if (isEmpty && error) {
    return (
      <section className="store-rail store-rail-error" aria-label={`${title} rail (error)`}>
        <header className="store-rail-header">
          <h3 className="store-rail-title">
            {badge && <span className="store-rail-badge">{badge}</span>}
            {title}
          </h3>
        </header>
        <div className="store-rail-error-box" role="alert">
          <p className="store-rail-error-message">
            ⚠️ Failed to load: {error.length > 200 ? error.slice(0, 200) + "…" : error}
          </p>
          <button type="button" className="store-rail-retry" onClick={refresh}>
            Retry
          </button>
        </div>
      </section>
    );
  }

  if (isEmpty) return null;

  return (
    <section className="store-rail" aria-label={`${title} rail`} ref={rootRef}>
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </header>

      <div className="store-rail-scroller">
        {games === null || loading ? (
          <div className="store-rail-track" aria-hidden="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={"skel-" + i} className="store-rail-card-skeleton">
                <div className="store-rail-shimmer" />
              </div>
            ))}
          </div>
        ) : (
          <>
            <button
              type="button"
              className="store-rail-arrow store-rail-arrow-prev"
              aria-label={`Scroll ${title} left`}
              onClick={() => scrollBy(-1)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <div ref={trackRef} className="store-rail-track">
              {games.map((game) => (
                <div key={game.id} className="store-rail-card-snap">
                  <StoreGameCard game={game} onClick={onCardClick} density={density} />
                </div>
              ))}
            </div>
            <button
              type="button"
              className="store-rail-arrow store-rail-arrow-next"
              aria-label={`Scroll ${title} right`}
              onClick={() => scrollBy(1)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </>
        )}
      </div>
    </section>
  );
}

export default memo(StoreRail);
