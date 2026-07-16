import { useSources } from "../../context/SourceContext";
import type { SourceLink } from "../../types/source";

export const GENRES = [
  "Action",
  "Adventure",
  "RPG",
  "Strategy",
  "Shooter",
  "Simulation",
  "Puzzle",
  "Racing",
  "Sports",
  "Fighting",
  "Platform",
  "Indie",
  "Horror",
  "Visual Novel",
];

const PLATFORMS = [
  "PC (Microsoft Windows)",
  "PlayStation 5",
  "PlayStation 4",
  "Xbox Series X|S",
  "Xbox One",
  "Nintendo Switch",
];

interface StoreFilterSidebarProps {
  selectedGenres: string[];
  selectedPlatforms: string[];
  yearMin: number | null;
  yearMax: number | null;
  ratingMin: number | null;
  selectedSourceIds: string[];
  onGenresChange: (genres: string[]) => void;
  onPlatformsChange: (platforms: string[]) => void;
  onYearRangeChange: (min: number | null, max: number | null) => void;
  onRatingMinChange: (rating: number | null) => void;
  onSourcesChange: (sourceIds: string[]) => void;
  onApply: () => void;
  onReset: () => void;
}

export default function StoreFilterSidebar({
  selectedGenres,
  selectedPlatforms,
  yearMin,
  yearMax,
  ratingMin,
  selectedSourceIds,
  onGenresChange,
  onPlatformsChange,
  onYearRangeChange,
  onRatingMinChange,
  onSourcesChange,
  onApply,
  onReset,
}: StoreFilterSidebarProps) {
  // Hook up to the live source list so the sidebar re-renders when the
  // user adds/removes/toggles a source in Settings. Only enabled
  // sources are surfaced — a disabled source wouldn't contribute to
  // any download-search call, so showing it as a filter option would
  // be misleading.
  const { sources } = useSources();
  const enabledSources: SourceLink[] = sources.filter((s) => s.enabled);

  const handleGenreToggle = (genre: string) => {
    if (selectedGenres.includes(genre)) {
      onGenresChange(selectedGenres.filter((g) => g !== genre));
    } else {
      onGenresChange([...selectedGenres, genre]);
    }
  };

  const handlePlatformToggle = (platform: string) => {
    if (selectedPlatforms.includes(platform)) {
      onPlatformsChange(selectedPlatforms.filter((p) => p !== platform));
    } else {
      onPlatformsChange([...selectedPlatforms, platform]);
    }
  };

  const handleSourceToggle = (sourceId: string) => {
    if (selectedSourceIds.includes(sourceId)) {
      onSourcesChange(selectedSourceIds.filter((s) => s !== sourceId));
    } else {
      onSourcesChange([...selectedSourceIds, sourceId]);
    }
  };

  return (
    <aside className="store-filter-sidebar">
      <div className="store-filter-section">
        <h4 className="store-filter-heading">Genres</h4>
        <div className="store-filter-list">
          {GENRES.map((genre) => (
            <label key={genre} className="store-filter-checkbox">
              <input
                type="checkbox"
                checked={selectedGenres.includes(genre)}
                onChange={() => handleGenreToggle(genre)}
              />
              <span>{genre}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="store-filter-section">
        <h4 className="store-filter-heading">Platforms</h4>
        <div className="store-filter-list">
          {PLATFORMS.map((platform) => (
            <label key={platform} className="store-filter-checkbox">
              <input
                type="checkbox"
                checked={selectedPlatforms.includes(platform)}
                onChange={() => handlePlatformToggle(platform)}
              />
              <span>{platform}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="store-filter-section">
        <h4 className="store-filter-heading">Release Year</h4>
        <div className="store-filter-year-row">
          <input
            type="number"
            className="store-filter-year-input"
            placeholder="From"
            value={yearMin ?? ""}
            onChange={(e) =>
              onYearRangeChange(
                e.target.value ? Number(e.target.value) : null,
                yearMax
              )
            }
            min={1970}
            max={2030}
          />
          <span className="store-filter-year-sep">–</span>
          <input
            type="number"
            className="store-filter-year-input"
            placeholder="To"
            value={yearMax ?? ""}
            onChange={(e) =>
              onYearRangeChange(
                yearMin,
                e.target.value ? Number(e.target.value) : null
              )
            }
            min={1970}
            max={2030}
          />
        </div>
      </div>

      <div className="store-filter-section">
        <h4 className="store-filter-heading">
          Minimum Rating: {ratingMin ?? 0}
        </h4>
        <input
          type="range"
          className="store-filter-slider"
          min={0}
          max={100}
          step={5}
          value={ratingMin ?? 0}
          onChange={(e) =>
            onRatingMinChange(
              Number(e.target.value) > 0 ? Number(e.target.value) : null
            )
          }
        />
      </div>

      <div className="store-filter-section">
        <h4 className="store-filter-heading">Download Sources</h4>
        {enabledSources.length === 0 ? (
          <p className="store-filter-empty-text">
            No sources added yet — open Settings → Sources to add one. The
            filter will only show store games whose titles are present in
            every selected source.
          </p>
        ) : (
          <div className="store-filter-list">
            {enabledSources.map((source) => (
              <label key={source.id} className="store-filter-source-row">
                <input
                  type="checkbox"
                  checked={selectedSourceIds.includes(source.id)}
                  onChange={() => handleSourceToggle(source.id)}
                />
                <span className="store-filter-source-name" title={source.url}>
                  {source.name}
                </span>
                {source.gameCount > 0 && (
                  <span
                    className="store-filter-source-count"
                    title={`${source.gameCount.toLocaleString()} entries in source`}
                  >
                    {source.gameCount >= 1000
                      ? `${(source.gameCount / 1000).toFixed(1)}k`
                      : source.gameCount}
                  </span>
                )}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="store-filter-actions">
        <button className="store-filter-btn apply" onClick={onApply}>
          Apply Filters
        </button>
        <button className="store-filter-btn reset" onClick={onReset}>
          Reset
        </button>
      </div>
    </aside>
  );
}
