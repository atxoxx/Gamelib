const GENRES = [
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
  onGenresChange: (genres: string[]) => void;
  onPlatformsChange: (platforms: string[]) => void;
  onYearRangeChange: (min: number | null, max: number | null) => void;
  onRatingMinChange: (rating: number | null) => void;
  onApply: () => void;
  onReset: () => void;
}

export default function StoreFilterSidebar({
  selectedGenres,
  selectedPlatforms,
  yearMin,
  yearMax,
  ratingMin,
  onGenresChange,
  onPlatformsChange,
  onYearRangeChange,
  onRatingMinChange,
  onApply,
  onReset,
}: StoreFilterSidebarProps) {
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
