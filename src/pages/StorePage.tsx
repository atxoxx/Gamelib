import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useStoreGames } from "../hooks/useStoreGames";
import StoreTabBar from "../components/store/StoreTabBar";
import StoreSearchBar from "../components/store/StoreSearchBar";
import StoreGameGrid from "../components/store/StoreGameGrid";
import StoreFilterChips from "../components/store/StoreFilterChips";
import StoreFilterSidebar from "../components/store/StoreFilterSidebar";
import type { StoreGameSummary, StoreCategory } from "../types/game";

export default function StorePage() {
  const navigate = useNavigate();
  const {
    games,
    loading,
    error,
    hasMore,
    loadMore,
    category,
    setCategory,
    searchQuery,
    setSearchQuery,
    isSearching,
  } = useStoreGames();

  // ── Local filter state (presentational for now — wired to backend later) ─
  const [searchActive, setSearchActive] = useState(false);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [yearMin, setYearMin] = useState<number | null>(null);
  const [yearMax, setYearMax] = useState<number | null>(null);
  const [ratingMin, setRatingMin] = useState<number | null>(null);

  // ── Handlers ──────────────────────────────────────────────────────────
  const activeTab = isSearching ? "search" : category;

  const handleTabChange = useCallback(
    (tab: StoreCategory | "search") => {
      if (tab === "search") {
        setSearchActive(true);
      } else {
        setSearchActive(false);
        setCategory(tab);
      }
    },
    [setCategory]
  );

  const handleCardClick = useCallback(
    (game: StoreGameSummary) => {
      navigate(`/store/${game.slug}`);
    },
    [navigate]
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchQuery(value);
    },
    [setSearchQuery]
  );

  const handleApplyFilters = useCallback(() => {
    // TODO: Wire to backend when filter support is added
  }, []);

  const handleResetFilters = useCallback(() => {
    setSelectedGenres([]);
    setSelectedPlatforms([]);
    setYearMin(null);
    setYearMax(null);
    setRatingMin(null);
  }, []);

  const showFilters = category === "all" && !isSearching;

  return (
    <div className="store-page">
      <StoreTabBar activeTab={activeTab} onTabChange={handleTabChange} />

      <StoreSearchBar
        value={searchQuery}
        onChange={handleSearchChange}
        visible={searchActive || isSearching}
      />

      {showFilters && (
        <StoreFilterChips
          selectedGenres={selectedGenres}
          selectedPlatforms={selectedPlatforms}
          yearMin={yearMin}
          yearMax={yearMax}
          ratingMin={ratingMin}
          onRemoveGenre={(g) =>
            setSelectedGenres((prev) => prev.filter((x) => x !== g))
          }
          onRemovePlatform={(p) =>
            setSelectedPlatforms((prev) => prev.filter((x) => x !== p))
          }
          onRemoveYear={() => {
            setYearMin(null);
            setYearMax(null);
          }}
          onRemoveRating={() => setRatingMin(null)}
          resultCount={games.length}
        />
      )}

      <div className="store-layout">
        {showFilters && (
          <StoreFilterSidebar
            selectedGenres={selectedGenres}
            selectedPlatforms={selectedPlatforms}
            yearMin={yearMin}
            yearMax={yearMax}
            ratingMin={ratingMin}
            onGenresChange={setSelectedGenres}
            onPlatformsChange={setSelectedPlatforms}
            onYearRangeChange={(min, max) => {
              setYearMin(min);
              setYearMax(max);
            }}
            onRatingMinChange={setRatingMin}
            onApply={handleApplyFilters}
            onReset={handleResetFilters}
          />
        )}

        <div className="store-main">
          {isSearching && searchQuery && !loading && (
            <p className="store-search-results-label">
              Results for "<strong>{searchQuery}</strong>"
              {games.length > 0 && <> — {games.length} game{games.length !== 1 ? "s" : ""}</>}
            </p>
          )}

          <StoreGameGrid
            games={games}
            loading={loading}
            error={error}
            hasMore={hasMore}
            onLoadMore={loadMore}
            onCardClick={handleCardClick}
          />
        </div>
      </div>
    </div>
  );
}
