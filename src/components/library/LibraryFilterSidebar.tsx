import type { LibraryStatus, LibrarySort } from "../../hooks/useLibraryFilters";
import { SORT_LABELS, SORT_OPTIONS } from "../../hooks/useLibraryFilters";
import type { LibrarySource, PlayStatus } from "../../types/game";

/** Status radio options. Declared at module scope so TypeScript infers
 *  the literal `LibraryStatus` type for each `value` (instead of widening
 *  to `string` and requiring a cast at the call site). */
const STATUS_OPTIONS: readonly { value: LibraryStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "installed", label: "Installed" },
  { value: "not_installed", label: "Not Installed" },
];

const SOURCE_OPTIONS: readonly { value: LibrarySource; label: string }[] = [
  { value: "all", label: "All" },
  { value: "steam", label: "Steam" },
  { value: "local", label: "Local" },
  { value: "gog", label: "GOG" },
  { value: "epic", label: "Epic" },
  { value: "humble", label: "Humble" },
  { value: "rockstar", label: "Rockstar" },
];

const PLAY_STATUS_OPTIONS: readonly { value: PlayStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "backlog", label: "Backlog" },
  { value: "playing", label: "Playing" },
  { value: "completed", label: "Completed" },
  { value: "abandoned", label: "Abandoned" },
  { value: "on_hold", label: "On Hold" },
];

interface LibraryFilterSidebarProps {
  search: string;
  selectedGenres: string[];
  selectedPlatforms: string[];
  yearMin: number | null;
  yearMax: number | null;
  ratingMin: number | null;
  status: LibraryStatus;
  playStatus: PlayStatus | "all";
  /** Unique genre names present in the library, sorted alphabetically. */
  availableGenres: string[];
  /** Unique platform names present in the library, sorted alphabetically. */
  availablePlatforms: string[];
  /** Current source filter value. */
  source: LibrarySource;
  /** Current sort order. */
  sort: LibrarySort;
  onSearchChange: (q: string) => void;
  onGenresChange: (g: string[]) => void;
  onPlatformsChange: (p: string[]) => void;
  onYearRangeChange: (min: number | null, max: number | null) => void;
  onRatingMinChange: (r: number | null) => void;
  onStatusChange: (s: LibraryStatus) => void;
  onPlayStatusChange: (ps: PlayStatus | "all") => void;
  onSourceChange: (s: LibrarySource) => void;
  onSortChange: (s: LibrarySort) => void;
  onReset: () => void;
}

/**
 * LibraryFilterSidebar: left-rail filter panel for the Library page.
 *
 * Mirrors `StoreFilterSidebar` (same overall structure: Search → Status
 * (library-specific) → Genres → Platforms → Release Year → Rating →
 * Reset). Live-applies each change to the hook state (no Apply button)
 * because library filtering is local and instant; the Store needs an
 * Apply button because its filter changes trigger a remote IGDB fetch.
 */
export default function LibraryFilterSidebar({
  search,
  selectedGenres,
  selectedPlatforms,
  yearMin,
  yearMax,
  ratingMin,
  status,
  playStatus,
  availableGenres,
  availablePlatforms,
  source,
  sort,
  onSearchChange,
  onGenresChange,
  onPlatformsChange,
  onYearRangeChange,
  onRatingMinChange,
  onStatusChange,
  onPlayStatusChange,
  onSourceChange,
  onSortChange,
  onReset,
}: LibraryFilterSidebarProps) {
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
    <aside className="library-filter-sidebar">
      <div className="library-filter-section">
        <h4 className="library-filter-heading">Search</h4>
        <input
          type="text"
          className="library-filter-search"
          placeholder="Filter games by name..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      <div className="library-filter-section">
        <h4 className="library-filter-heading">Status</h4>
        <div className="library-filter-radio-group">
          {STATUS_OPTIONS.map((opt) => (
            <label key={opt.value} className="library-filter-radio">
              <input
                type="radio"
                name="library-status"
                value={opt.value}
                checked={status === opt.value}
                onChange={() => onStatusChange(opt.value)}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="library-filter-section">
        <h4 className="library-filter-heading">Play Status</h4>
        <div className="library-filter-radio-group">
          {PLAY_STATUS_OPTIONS.map((opt) => (
            <label key={opt.value} className="library-filter-radio">
              <input
                type="radio"
                name="library-play-status"
                value={opt.value}
                checked={playStatus === opt.value}
                onChange={() => onPlayStatusChange(opt.value)}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="library-filter-section">
        <h4 className="library-filter-heading">Source</h4>
        <div className="library-filter-radio-group">
          {SOURCE_OPTIONS.map((opt) => (
            <label key={opt.value} className="library-filter-radio">
              <input
                type="radio"
                name="library-source"
                value={opt.value}
                checked={source === opt.value}
                onChange={() => onSourceChange(opt.value)}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="library-filter-section">
        <h4 className="library-filter-heading">Sort</h4>
        <select
          className="library-filter-select"
          value={sort}
          onChange={(e) => onSortChange(e.target.value as LibrarySort)}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{SORT_LABELS[opt]}</option>
          ))}
        </select>
      </div>

      {availableGenres.length > 0 && (
        <div className="library-filter-section">
          <h4 className="library-filter-heading">Genres</h4>
          <div className="library-filter-list">
            {availableGenres.map((genre) => (
              <label key={genre} className="library-filter-checkbox">
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
      )}

      {availablePlatforms.length > 0 && (
        <div className="library-filter-section">
          <h4 className="library-filter-heading">Platforms</h4>
          <div className="library-filter-list">
            {availablePlatforms.map((platform) => (
              <label key={platform} className="library-filter-checkbox">
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
      )}

      <div className="library-filter-section">
        <h4 className="library-filter-heading">Release Year</h4>
        <div className="library-filter-year-row">
          <input
            type="number"
            className="library-filter-year-input"
            placeholder="From"
            value={yearMin ?? ""}
            onChange={(e) => {
              // Trim guards against whitespace-only input (which would
              // coerce to 0 and bypass the placeholder state).
              const raw = e.target.value.trim();
              onYearRangeChange(raw ? Number(raw) : null, yearMax);
            }}
            min={1970}
            max={2030}
          />
          <span className="library-filter-year-sep">–</span>
          <input
            type="number"
            className="library-filter-year-input"
            placeholder="To"
            value={yearMax ?? ""}
            onChange={(e) => {
              const raw = e.target.value.trim();
              onYearRangeChange(yearMin, raw ? Number(raw) : null);
            }}
            min={1970}
            max={2030}
          />
        </div>
      </div>

      <div className="library-filter-section">
        <h4 className="library-filter-heading">
          Minimum Rating: {ratingMin ?? 0}
        </h4>
        <input
          type="range"
          className="library-filter-slider"
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

      <div className="library-filter-actions">
        <button className="library-filter-btn reset" onClick={onReset}>
          Reset Filters
        </button>
      </div>
    </aside>
  );
}
