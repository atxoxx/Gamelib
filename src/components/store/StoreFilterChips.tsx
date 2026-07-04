interface StoreFilterChipsProps {
  selectedGenres: string[];
  selectedPlatforms: string[];
  yearMin: number | null;
  yearMax: number | null;
  ratingMin: number | null;
  onRemoveGenre: (genre: string) => void;
  onRemovePlatform: (platform: string) => void;
  onRemoveYear: () => void;
  onRemoveRating: () => void;
  resultCount?: number;
}

export default function StoreFilterChips({
  selectedGenres,
  selectedPlatforms,
  yearMin,
  yearMax,
  ratingMin,
  onRemoveGenre,
  onRemovePlatform,
  onRemoveYear,
  onRemoveRating,
  resultCount,
}: StoreFilterChipsProps) {
  const hasFilters =
    selectedGenres.length > 0 ||
    selectedPlatforms.length > 0 ||
    yearMin != null ||
    yearMax != null ||
    ratingMin != null;

  if (!hasFilters) return null;

  return (
    <div className="store-filter-chips">
      {resultCount != null && (
        <span className="store-filter-count">
          {resultCount} game{resultCount !== 1 ? "s" : ""}
        </span>
      )}

      {selectedGenres.map((genre) => (
        <span key={`g-${genre}`} className="store-filter-chip">
          {genre}
          <button onClick={() => onRemoveGenre(genre)} aria-label={`Remove ${genre}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </span>
      ))}

      {selectedPlatforms.map((platform) => (
        <span key={`p-${platform}`} className="store-filter-chip">
          {platform}
          <button onClick={() => onRemovePlatform(platform)} aria-label={`Remove ${platform}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </span>
      ))}

      {(yearMin != null || yearMax != null) && (
        <span className="store-filter-chip">
          {yearMin ?? "..."} – {yearMax ?? "..."}
          <button onClick={onRemoveYear} aria-label="Remove year filter">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </span>
      )}

      {ratingMin != null && (
        <span className="store-filter-chip">
          ⭐ {ratingMin}+
          <button onClick={onRemoveRating} aria-label="Remove rating filter">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </span>
      )}
    </div>
  );
}
