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
  ubisoft: "Ubisoft",
};

const CloseIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

/**
 * LibraryFilterChips: horizontal row of dismissable chips summarizing the
 * active filter set, with a live result count. Renders nothing when no
 * filters are applied.
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
    <div className="lib-chips">
      <span className="lib-chip-count">
        {resultCount} game{resultCount !== 1 ? "s" : ""}
      </span>

      {filters.search && (
        <span className="lib-chip">
          &ldquo;{filters.search}&rdquo;
          <button type="button" onClick={onRemoveSearch} aria-label="Clear search">{CloseIcon}</button>
        </span>
      )}

      {filters.status !== "all" && (
        <span className="lib-chip">
          {statusLabel[filters.status]}
          <button type="button" onClick={onRemoveStatus} aria-label="Clear status filter">{CloseIcon}</button>
        </span>
      )}

      {filters.playStatus !== "all" && (
        <span className="lib-chip">
          {PLAY_STATUS_DETAILS[filters.playStatus].label}
          <button type="button" onClick={onRemovePlayStatus} aria-label="Clear play status filter">{CloseIcon}</button>
        </span>
      )}

      {filters.source !== "all" && (
        <span className="lib-chip">
          {sourceLabel[filters.source]}
          <button type="button" onClick={onRemoveSource} aria-label="Clear source filter">{CloseIcon}</button>
        </span>
      )}

      {filters.genres.map((genre) => (
        <span key={`g-${genre}`} className="lib-chip">
          {genre}
          <button type="button" onClick={() => onRemoveGenre(genre)} aria-label={`Remove ${genre}`}>{CloseIcon}</button>
        </span>
      ))}

      {filters.platforms.map((platform) => (
        <span key={`p-${platform}`} className="lib-chip">
          {platform}
          <button type="button" onClick={() => onRemovePlatform(platform)} aria-label={`Remove ${platform}`}>{CloseIcon}</button>
        </span>
      ))}

      {(filters.yearMin != null || filters.yearMax != null) && (
        <span className="lib-chip">
          {filters.yearMin ?? "..."} – {filters.yearMax ?? "..."}
          <button type="button" onClick={onRemoveYear} aria-label="Clear year filter">{CloseIcon}</button>
        </span>
      )}

      {filters.ratingMin != null && (
        <span className="lib-chip">
          ⭐ {filters.ratingMin}+
          <button type="button" onClick={onRemoveRating} aria-label="Clear rating filter">{CloseIcon}</button>
        </span>
      )}

      <button type="button" className="lib-chip-reset" onClick={onResetAll}>
        Clear all
      </button>
    </div>
  );
}
