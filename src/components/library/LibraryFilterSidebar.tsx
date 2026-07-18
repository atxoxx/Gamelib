import type { LibraryStatus, LibrarySort } from "../../hooks/useLibraryFilters";
import { SORT_LABELS, SORT_OPTIONS } from "../../hooks/useLibraryFilters";
import type { LibrarySource, PlayStatus } from "../../types/game";

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
  { value: "ubisoft", label: "Ubisoft" },
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
  availableGenres: string[];
  availablePlatforms: string[];
  source: LibrarySource;
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
 * LibraryFilterSidebar: the left-rail filter panel. Status / Play Status /
 * Source are compact segmented controls; Genres / Platforms are pill
 * toggles. Every change applies live (library filtering is local + instant).
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
  const toggleGenre = (genre: string) =>
    onGenresChange(
      selectedGenres.includes(genre)
        ? selectedGenres.filter((g) => g !== genre)
        : [...selectedGenres, genre]
    );

  const togglePlatform = (platform: string) =>
    onPlatformsChange(
      selectedPlatforms.includes(platform)
        ? selectedPlatforms.filter((p) => p !== platform)
        : [...selectedPlatforms, platform]
    );

  return (
    <aside className="lib-filter" aria-label="Library filters">
      <div className="lib-filter-section">
        <h4 className="lib-filter-heading">Search</h4>
        <input
          type="text"
          className="lib-filter-search"
          placeholder="Filter games by name..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      <div className="lib-filter-section">
        <h4 className="lib-filter-heading">Status</h4>
        <div className="lib-segment">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`lib-segment-option${status === opt.value ? " active" : ""}`}
              onClick={() => onStatusChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="lib-filter-section">
        <h4 className="lib-filter-heading">Play Status</h4>
        <div className="lib-segment">
          {PLAY_STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`lib-segment-option${playStatus === opt.value ? " active" : ""}`}
              onClick={() => onPlayStatusChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="lib-filter-section">
        <h4 className="lib-filter-heading">Source</h4>
        <div className="lib-segment">
          {SOURCE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`lib-segment-option${source === opt.value ? " active" : ""}`}
              onClick={() => onSourceChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="lib-filter-section">
        <h4 className="lib-filter-heading">Sort</h4>
        <select
          className="lib-filter-search"
          value={sort}
          onChange={(e) => onSortChange(e.target.value as LibrarySort)}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{SORT_LABELS[opt]}</option>
          ))}
        </select>
      </div>

      {availableGenres.length > 0 && (
        <div className="lib-filter-section">
          <h4 className="lib-filter-heading">
            Genres
            {selectedGenres.length > 0 && (
              <span className="lib-filter-count-badge">{selectedGenres.length}</span>
            )}
          </h4>
          <div className="lib-pills">
            {availableGenres.map((genre) => (
              <button
                key={genre}
                type="button"
                className={`lib-pill${selectedGenres.includes(genre) ? " active" : ""}`}
                onClick={() => toggleGenre(genre)}
              >
                {genre}
              </button>
            ))}
          </div>
        </div>
      )}

      {availablePlatforms.length > 0 && (
        <div className="lib-filter-section">
          <h4 className="lib-filter-heading">
            Platforms
            {selectedPlatforms.length > 0 && (
              <span className="lib-filter-count-badge">{selectedPlatforms.length}</span>
            )}
          </h4>
          <div className="lib-pills">
            {availablePlatforms.map((platform) => (
              <button
                key={platform}
                type="button"
                className={`lib-pill${selectedPlatforms.includes(platform) ? " active" : ""}`}
                onClick={() => togglePlatform(platform)}
              >
                {platform}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="lib-filter-section">
        <h4 className="lib-filter-heading">Release Year</h4>
        <div className="lib-year-row">
          <input
            type="number"
            className="lib-year-input"
            placeholder="From"
            value={yearMin ?? ""}
            onChange={(e) => {
              const raw = e.target.value.trim();
              onYearRangeChange(raw ? Number(raw) : null, yearMax);
            }}
            min={1970}
            max={2030}
          />
          <span className="lib-year-sep">–</span>
          <input
            type="number"
            className="lib-year-input"
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

      <div className="lib-filter-section">
        <div className="lib-rating-head">
          <h4 className="lib-filter-heading">Minimum Rating</h4>
          <span className="lib-rating-value">{ratingMin ?? 0}+</span>
        </div>
        <input
          type="range"
          className="lib-rating-slider"
          min={0}
          max={100}
          step={5}
          value={ratingMin ?? 0}
          onChange={(e) =>
            onRatingMinChange(Number(e.target.value) > 0 ? Number(e.target.value) : null)
          }
        />
      </div>

      <button className="lib-filter-reset" onClick={onReset}>
        Reset Filters
      </button>
    </aside>
  );
}
