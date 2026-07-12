import type { SourceLink } from "../../types/source";

interface StoreFilterChipsProps {
  selectedGenres: string[];
  selectedPlatforms: string[];
  yearMin: number | null;
  yearMax: number | null;
  ratingMin: number | null;
  /**
   * SourceLink IDs the user has selected for the download-source filter.
   * The display name is resolved against the full `sources` list so the
   * chip shows the user-friendly name rather than the opaque id.
   */
  selectedSourceIds: string[];
  /** All known sources from `useSources()` (any enabled state). */
  sources: SourceLink[];
  /**
   * Number of (game, source) checks currently in flight from
   * `useStoreSourceAvailability`. When > 0 alongside an active source
   * filter, we render a "Checking…" chip so the user knows the result
   * set is still narrowing.
   */
  sourceChecksPending: number;
  onRemoveGenre: (g: string) => void;
  onRemovePlatform: (p: string) => void;
  onRemoveYear: () => void;
  onRemoveRating: () => void;
  onRemoveSource: (sourceId: string) => void;
  resultCount?: number;
}

export default function StoreFilterChips({
  selectedGenres,
  selectedPlatforms,
  yearMin,
  yearMax,
  ratingMin,
  selectedSourceIds,
  sources,
  sourceChecksPending,
  onRemoveGenre,
  onRemovePlatform,
  onRemoveYear,
  onRemoveRating,
  onRemoveSource,
  resultCount,
}: StoreFilterChipsProps) {
  const hasFilters =
    selectedGenres.length > 0 ||
    selectedPlatforms.length > 0 ||
    yearMin != null ||
    yearMax != null ||
    ratingMin != null ||
    selectedSourceIds.length > 0;

  if (!hasFilters) return null;

  // Build a name lookup so chip removal can find human-readable names
  // without having to thread the full sources list down to a callback.
  const sourceNameById = new Map<string, string>();
  for (const s of sources) {
    sourceNameById.set(s.id, s.name);
  }

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

      {selectedSourceIds.map((sourceId) => {
        const name = sourceNameById.get(sourceId) ?? "Unknown source";
        return (
          <span key={`s-${sourceId}`} className="store-filter-chip store-filter-chip-source">
            <svg
              className="store-filter-chip-source-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {name}
            <button
              onClick={() => onRemoveSource(sourceId)}
              aria-label={`Remove source ${name}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </span>
        );
      })}

      {selectedSourceIds.length > 0 && sourceChecksPending > 0 && (
        <span className="store-filter-chip store-filter-chip-pending">
          <span className="store-filter-chip-spinner" aria-hidden="true" />
          Checking {sourceChecksPending}…
        </span>
      )}
    </div>
  );
}
