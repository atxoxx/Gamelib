import { useState, useMemo, useEffect, useRef } from "react";
import type { Game, LibrarySource } from "../../types/game";
import type { LibraryFilters, LibraryStatus, LibrarySort } from "../../hooks/useLibraryFilters";
import { useFocusable } from "../../hooks/useFocusable";
import BigScreenGameCard from "./BigScreenGameCard";
import { SORT_LABELS } from "../../hooks/useLibraryFilters";

interface BigScreenLibraryProps {
  filteredGames: Game[];
  totalGames: number;
  onSelectGame: (game: Game) => void;
  filters: LibraryFilters;
  availableGenres: string[];
  availablePlatforms: string[];
  setSearch: (val: string) => void;
  setGenres: (val: string[]) => void;
  setPlatforms: (val: string[]) => void;
  setStatus: (val: LibraryStatus) => void;
  setSource: (val: LibrarySource) => void;
  setSort: (val: LibrarySort) => void;
  reset: () => void;
}

type DropdownType = "platform" | "genre" | "status" | "source" | "sort" | null;

export default function BigScreenLibrary({
  filteredGames,
  totalGames,
  onSelectGame,
  filters,
  availableGenres,
  availablePlatforms,
  setSearch,
  setGenres,
  setPlatforms,
  setStatus,
  setSource,
  setSort,
  reset,
}: BigScreenLibraryProps) {
  const [dropdown, setDropdown] = useState<DropdownType>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Focusable filters bar
  const searchChip = useFocusable(() => {
    setSearchFocused(true);
    setTimeout(() => searchInputRef.current?.focus(), 50);
  });
  const platformChip = useFocusable(() => setDropdown("platform"));
  const genreChip = useFocusable(() => setDropdown("genre"));
  const statusChip = useFocusable(() => setDropdown("status"));
  const sourceChip = useFocusable(() => setDropdown("source"));
  const sortChip = useFocusable(() => setDropdown("sort"));
  const resetChip = useFocusable(() => reset());

  // Close dropdown on Escape
  useEffect(() => {
    if (!dropdown && !searchFocused) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setDropdown(null);
        setSearchFocused(false);
        searchInputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dropdown, searchFocused]);

  // Clean label helper for platforms filter
  const platformLabel = useMemo(() => {
    if (filters.platforms.length === 0) return "All Platforms";
    if (filters.platforms.length === 1) return filters.platforms[0];
    return `${filters.platforms.length} Platforms`;
  }, [filters.platforms]);

  // Clean label helper for genres filter
  const genreLabel = useMemo(() => {
    if (filters.genres.length === 0) return "All Genres";
    if (filters.genres.length === 1) return filters.genres[0];
    return `${filters.genres.length} Genres`;
  }, [filters.genres]);

  return (
    <div className="bigscreen-library-dashboard">
      <div className="bigscreen-library-header-section">
        <div className="bigscreen-library-title-row">
          <h2 className="bigscreen-library-title">My Collection</h2>
          <span className="bigscreen-library-count">
            {filteredGames.length} of {totalGames}
          </span>
        </div>

        {/* Filters Chips Row */}
        <div className="bigscreen-library-chips-row">
          {/* Search Box / Input */}
          <div
            className={`bigscreen-filter-chip bigscreen-filter-chip--search ${
              searchFocused ? "search-active" : ""
            }`}
            {...searchChip}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search..."
              value={filters.search}
              onChange={(e) => setSearch(e.target.value)}
              onBlur={() => setSearchFocused(false)}
            />
          </div>

          <button type="button" className="bigscreen-filter-chip" {...platformChip}>
            Platform: <span>{platformLabel}</span>
          </button>

          <button type="button" className="bigscreen-filter-chip" {...genreChip}>
            Genre: <span>{genreLabel}</span>
          </button>

          <button type="button" className="bigscreen-filter-chip" {...statusChip}>
            Status: <span>{filters.status === "all" ? "All" : filters.status === "installed" ? "Installed" : "Not Installed"}</span>
          </button>

          <button type="button" className="bigscreen-filter-chip" {...sourceChip}>
            Source: <span>{filters.source === "all" ? "All Sources" : filters.source.toUpperCase()}</span>
          </button>

          <button type="button" className="bigscreen-filter-chip" {...sortChip}>
            Sort: <span>{SORT_LABELS[filters.sort]}</span>
          </button>

          {(filters.search ||
            filters.platforms.length > 0 ||
            filters.genres.length > 0 ||
            filters.status !== "all" ||
            filters.source !== "all" ||
            filters.sort !== "alphabetical") && (
            <button type="button" className="bigscreen-filter-chip bigscreen-filter-chip--reset" {...resetChip}>
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Main Grid View */}
      <div className="bigscreen-library-grid-container">
        {filteredGames.length === 0 ? (
          <div className="bigscreen-library-empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="64" height="64" opacity="0.3">
              <polygon points="12 2 2 22 22 22" />
            </svg>
            <h3>No games match your criteria</h3>
            <p>Try clearing filters or search parameters to see your library.</p>
          </div>
        ) : (
          <div className="bigscreen-library-grid">
            {filteredGames.map((game) => (
              <BigScreenGameCard
                key={game.id}
                game={game}
                onClick={() => onSelectGame(game)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Filter Options Dropdown Drawer */}
      {dropdown && (
        <FilterDropdownOverlay
          type={dropdown}
          filters={filters}
          availableGenres={availableGenres}
          availablePlatforms={availablePlatforms}
          setGenres={setGenres}
          setPlatforms={setPlatforms}
          setStatus={setStatus}
          setSource={setSource}
          setSort={setSort}
          onClose={() => setDropdown(null)}
        />
      )}
    </div>
  );
}

interface DropdownOverlayProps {
  type: DropdownType;
  filters: LibraryFilters;
  availableGenres: string[];
  availablePlatforms: string[];
  setGenres: (val: string[]) => void;
  setPlatforms: (val: string[]) => void;
  setStatus: (val: LibraryStatus) => void;
  setSource: (val: LibrarySource) => void;
  setSort: (val: LibrarySort) => void;
  onClose: () => void;
}

function FilterDropdownOverlay({
  type,
  filters,
  availableGenres,
  availablePlatforms,
  setGenres,
  setPlatforms,
  setStatus,
  setSource,
  setSort,
  onClose,
}: DropdownOverlayProps) {
  const title = useMemo(() => {
    switch (type) {
      case "platform": return "Select Platforms";
      case "genre": return "Select Genres";
      case "status": return "Filter by Status";
      case "source": return "Filter by Source";
      case "sort": return "Sort order";
      default: return "";
    }
  }, [type]);

  return (
    <div className="bigscreen-overlay-drawer" onClick={onClose}>
      <div className="bigscreen-overlay-drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="bigscreen-overlay-drawer-header">
          <h3>{title}</h3>
          <button type="button" className="bigscreen-overlay-drawer-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="bigscreen-overlay-drawer-content">
          <DropdownOptionsList
            type={type}
            filters={filters}
            availableGenres={availableGenres}
            availablePlatforms={availablePlatforms}
            setGenres={setGenres}
            setPlatforms={setPlatforms}
            setStatus={setStatus}
            setSource={setSource}
            setSort={setSort}
            onClose={onClose}
          />
        </div>
      </div>
    </div>
  );
}

function DropdownOptionsList({
  type,
  filters,
  availableGenres,
  availablePlatforms,
  setGenres,
  setPlatforms,
  setStatus,
  setSource,
  setSort,
  onClose,
}: Omit<DropdownOverlayProps, "title">) {
  const renderOption = (label: string, active: boolean, onClick: () => void) => {
    const optionProps = useFocusable(() => {
      onClick();
      // Keep dropdown open for multi-select, close for single select
      if (type === "status" || type === "source" || type === "sort") {
        onClose();
      }
    });

    return (
      <button
        type="button"
        key={label}
        className={`bigscreen-overlay-drawer-option ${active ? "option-active" : ""}`}
        {...optionProps}
      >
        <span className="option-checkbox">{active ? "✓" : ""}</span>
        <span className="option-label">{label}</span>
      </button>
    );
  };

  if (type === "platform") {
    return (
      <div className="bigscreen-overlay-options-grid">
        {availablePlatforms.map((plat) => {
          const isActive = filters.platforms.includes(plat);
          const toggle = () => {
            const next = isActive
              ? filters.platforms.filter((p) => p !== plat)
              : [...filters.platforms, plat];
            setPlatforms(next);
          };
          return renderOption(plat, isActive, toggle);
        })}
      </div>
    );
  }

  if (type === "genre") {
    return (
      <div className="bigscreen-overlay-options-grid">
        {availableGenres.map((gen) => {
          const isActive = filters.genres.includes(gen);
          const toggle = () => {
            const next = isActive
              ? filters.genres.filter((g) => g !== gen)
              : [...filters.genres, gen];
            setGenres(next);
          };
          return renderOption(gen, isActive, toggle);
        })}
      </div>
    );
  }

  if (type === "status") {
    return (
      <div className="bigscreen-overlay-options-list">
        {renderOption("All", filters.status === "all", () => setStatus("all"))}
        {renderOption("Installed", filters.status === "installed", () => setStatus("installed"))}
        {renderOption("Not Installed", filters.status === "not_installed", () => setStatus("not_installed"))}
      </div>
    );
  }

  if (type === "source") {
    const sources: LibrarySource[] = ["all", "steam", "local", "gog"];
    return (
      <div className="bigscreen-overlay-options-list">
        {sources.map((src) =>
          renderOption(
            src === "all" ? "All Sources" : src.toUpperCase(),
            filters.source === src,
            () => setSource(src)
          )
        )}
      </div>
    );
  }

  if (type === "sort") {
    const sorts: LibrarySort[] = ["alphabetical", "date_added", "most_played", "rating"];
    return (
      <div className="bigscreen-overlay-options-list">
        {sorts.map((srt) =>
          renderOption(SORT_LABELS[srt], filters.sort === srt, () => setSort(srt))
        )}
      </div>
    );
  }

  return null;
}
