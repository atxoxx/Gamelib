import { GENRES } from "./StoreFilterSidebar";

interface StoreGenreQuickFiltersProps {
  /** Currently active genre (if any) — shown as selected. */
  activeGenre?: string | null;
  /** Invoked with a genre when a chip is clicked. */
  onSelect: (genre: string) => void;
}

/** Curated subset of GENRES surfaced as one-tap quick filters on the
 *  Discover landing. Keeping the list short (8) stops the row from
 *  wrapping into a wall of chips on common laptop widths. */
const QUICK_GENRES = [
  "Action",
  "RPG",
  "Shooter",
  "Strategy",
  "Adventure",
  "Indie",
  "Simulation",
  "Horror",
];

/**
 * StoreGenreQuickFilters: a single line of pill buttons above the Discover
 * rails. One tap jumps straight into the category grid narrowed to that
 * genre — a fast "I know what I want" path that complements the
 * browse-first rail layout. Pairs visually with the existing
 * `.store-filter-chip` language so it reads as a filter, not a nav.
 */
export default function StoreGenreQuickFilters({
  activeGenre,
  onSelect,
}: StoreGenreQuickFiltersProps) {
  // Defensive: ensure every quick genre still exists in the canonical
  // list (the sidebar's GENRES is the source of truth; if a name is
  // ever renamed there this drops the stale chip instead of rendering
  // a filter the backend won't match).
  const visible = QUICK_GENRES.filter((g) => GENRES.includes(g));

  if (visible.length === 0) return null;

  return (
    <div className="store-genre-quickfilters" role="group" aria-label="Jump to a genre">
      <span className="store-genre-quickfilters-label">Quick filters</span>
      <div className="store-genre-quickfilters-chips">
        {visible.map((genre) => {
          const active = activeGenre === genre;
          return (
            <button
              key={genre}
              type="button"
              className={`store-genre-quickfilter${active ? " active" : ""}`}
              aria-pressed={active}
              onClick={() => onSelect(genre)}
            >
              {genre}
            </button>
          );
        })}
      </div>
    </div>
  );
}
