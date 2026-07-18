import { memo } from "react";
import type { StoreGameSummary, StoreCategory } from "../../types/game";
import StoreHero from "./StoreHero";
import StoreRail from "./StoreRail";

/**
 * The Discover sections shown on the landing, in display order. Kept as data
 * so the render is a single `.map()` — adding/removing/reordering a section
 * is a one-line edit here rather than a copy-paste of a whole block.
 */
const DISCOVER_RAILS: ReadonlyArray<{
  title: string;
  category: StoreCategory;
  badge: string;
}> = [
  { title: "Trending Now", category: "trending", badge: "🔥" },
  { title: "Most Popular", category: "popular", badge: "⭐" },
  { title: "Top Critics", category: "top", badge: "🏆" },
  { title: "Coming Soon", category: "coming_soon", badge: "🎮" },
  { title: "New Releases", category: "new_releases", badge: "✨" },
];

interface StoreDiscoverProps {
  /** Navigate to a game's detail page. */
  onCardClick: (game: StoreGameSummary) => void;
  /** Switch to a category grid (used by the rail "See all" links). */
  onSeeAll: (category: StoreCategory) => void;
}

/**
 * StoreDiscover: the landing shown as the Store tab's default "Discover" mode.
 *
 * Layout (top → bottom):
 *   1. StoreHero  — auto-rotating featured banner (navigable).
 *   2. Sections   — Trending / Popular / Top / Coming Soon / New.
 *
 * Presentational: all data fetching lives inside the children (shared
 * `useDiscoverSection` hook) and navigation is delegated to StorePage.
 */
function StoreDiscover({ onCardClick, onSeeAll }: StoreDiscoverProps) {
  return (
    <div className="store-discover">
      <StoreHero onCardClick={onCardClick} />

      <div className="store-rails">
        {DISCOVER_RAILS.map((rail) => (
          <StoreRail
            key={rail.category}
            title={rail.title}
            category={rail.category}
            onCardClick={onCardClick}
            onSeeAll={onSeeAll}
            badge={rail.badge}
          />
        ))}
      </div>
    </div>
  );
}

export default memo(StoreDiscover);
