import { memo, useEffect, useRef } from "react";
import type { StoreGameSummary, ViewDensity } from "../../types/game";
import StoreGameCard from "./StoreGameCard";

interface StoreLocalRailProps {
  /** Display heading. */
  title: string;
  /** Games to render — supplied by the caller (no internal fetch). */
  games: StoreGameSummary[];
  /** Called when a card is clicked. */
  onCardClick: (game: StoreGameSummary) => void;
  /** Optional accent emoji shown next to the title. */
  badge?: string;
  /** Density used for the cards (default "cozy"). */
  density?: ViewDensity;
  /** Predicate for the "In Library" badge. */
  isInLibrary?: (game: StoreGameSummary) => boolean;
}

/**
 * StoreLocalRail: a horizontal snap-scroller driven by a caller-supplied
 * game list rather than an IGDB category fetch. Used for the "Recently
 * Viewed" and personalized "For You" rails on the Discover landing, which
 * derive their contents from localStorage / the user's library.
 */
function StoreLocalRail({
  title,
  games,
  onCardClick,
  badge,
  density = "cozy",
  isInLibrary,
}: StoreLocalRailProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  // Pointer-driven horizontal scroll (mouse-wheel h-scroll), matching StoreRail.
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

  if (games.length === 0) return null;

  return (
    <section className="store-rail" aria-label={`${title} rail`}>
      <header className="store-rail-header">
        <h3 className="store-rail-title">
          {badge && <span className="store-rail-badge">{badge}</span>}
          {title}
        </h3>
      </header>

      <div className="store-rail-scroller">
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
            <div key={game.id ?? game.slug} className="store-rail-card-snap">
              <StoreGameCard
                game={game}
                onClick={onCardClick}
                density={density}
                inLibrary={isInLibrary ? isInLibrary(game) : false}
              />
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
      </div>
    </section>
  );
}

export default memo(StoreLocalRail);
