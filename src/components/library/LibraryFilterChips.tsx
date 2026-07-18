import type { LibraryFilters, LibraryStatus } from "../../hooks/useLibraryFilters";
import type { LibrarySource } from "../../types/game";
import { PLAY_STATUS_DETAILS } from "../../types/game";

interface LibraryFilterChipsProps {
  filters: LibraryFilters;
  resultCount: number;
  onRemoveSearch: () => void;
  onRemoveGenre: (g: string) => void;
  onRemovePlatform: (p: string) => void;
  onRemoveYear: () => void;
  onRemoveRating: () => void;
  onRemoveStatus: () => void;
  onRemovePlayStatus: () => void;
  onRemoveSource: () => void;
  onResetAll: () => void;
}

/**
 * LibraryFilterChips: horizontal row of dismissable chips summarizing the
 * active filter set. Renders nothing when no filters are applied. The
 * `resultCount` shows the narrowed result count so users can see at a
 * glance how aggressive their filters are.
 *
 * Mirrors `StoreFilterChips` but adds two library-specific facets:
 * a free-text search chip and an installation status chip.
 */
export default function LibraryFilterChips({
  filters,
  resultCount,
  onRemoveSearch,
  onRemoveGenre,
  onRemovePlatform,
  onRemoveYear,
  onRemoveRating,
  onRemoveStatus,
  onRemovePlayStatus,
  onRemoveSource,
  onResetAll,
}: LibraryFilterChipsProps) {
  const statusLabel: Record<LibraryStatus, string> = {
    all: "All",
    installed: "Installed",
    not_installed: "Not Installed",
  };

  const sourceLabel: Record<LibrarySource, string> = {
    all: "All",
    steam: "Steam",
    local: "Local",
    gog: "GOG",
    epic: "Epic",
    humble: "Humble",
    rockstar: "Rockstar",
  };

  const hasAny =
    filters.search.length > 0 ||
    filters.genres.length > 0 ||
    filters.platforms.length > 0 ||
    filters.yearMin != null ||
    filters.yearMax != null ||
    filters.ratingMin != null ||
    filters.status !== "all" ||
    filters.source !== "all" ||
    filters.playStatus !== "all";

  if (!hasAny) return null;

  return (
    <div className="library-filter-chips">
      <span className="library-filter-count">
        {resultCount} game{resultCount !== 1 ? "s" : ""}
      </span>

      {filters.search && (
        <span className="library-filter-chip">
          &ldquo;{filters.search}&rdquo;
          <button type="button" onClick={onRemoveSearch} aria-label="Clear search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </span>
      )}

      {filters.status !== "all" && (
        <span className="library-filter-chip">
          {statusLabel[filters.status]}
          <button type="button" onClick={onRemoveStatus} aria-label="Clear status filter">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </span>
      )}

      {filters.playStatus !== "all" && (
        <span className="library-filter-chip">
          {PLAY_STATUS_DETAILS[filters.playStatus].label}
          <button type="button" onClick={onRemovePlayStatus} aria-label="Clear play status filter">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </span>
      )}

      {filters.source !== "all" && (
        <span className="library-filter-chip">
          {sourceLabel[filters.source]}
          <button type="button" onClick={onRemoveSource} aria-label="Clear source filter">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </span>
      )}

      {filters.genres.map((genre) => (
        <span key={`g-${genre}`} className="library-filter-chip">
          {genre}
          <button type="button" onClick={() => onRemoveGenre(genre)} aria-label={`Remove ${genre}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </span>
      ))}

      {filters.platforms.map((platform) => (
        <span key={`p-${platform}`} className="library-filter-chip">
          {platform}
          <button
            type="button"
            onClick={() => onRemovePlatform(platform)}
            aria-label={`Remove ${platform}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </span>
      ))}

      {(filters.yearMin != null || filters.yearMax != null) && (
        <span className="library-filter-chip">
          {filters.yearMin ?? "..."} – {filters.yearMax ?? "..."}
          <button type="button" onClick={onRemoveYear} aria-label="Clear year filter">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </span>
      )}

      {filters.ratingMin != null && (
        <span className="library-filter-chip">
          ⭐ {filters.ratingMin}+
          <button type="button" onClick={onRemoveRating} aria-label="Clear rating filter">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </span>
      )}

      <button type="button" className="library-filter-reset-all" onClick={onResetAll}>
        Clear all
      </button>
    </div>
  );
}
