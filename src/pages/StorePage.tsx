import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStoreGames } from "../hooks/useStoreGames";
import { useDensityContext } from "../context/DensityContext";
import StoreTabBar from "../components/store/StoreTabBar";
import type { StoreModeTab } from "../components/store/StoreTabBar";
import StoreSearchBar from "../components/store/StoreSearchBar";
import StoreGameGrid from "../components/store/StoreGameGrid";
import StoreFilterChips from "../components/store/StoreFilterChips";
import StoreFilterSidebar from "../components/store/StoreFilterSidebar";
import HeroFeature from "../components/store/HeroFeature";
import SnapRail from "../components/store/SnapRail";
import DensityToggle from "../components/store/DensityToggle";
import type { StoreGameSummary, StoreCategory } from "../types/game";

export default function StorePage() {
  const navigate = useNavigate();
  // Wishlist + density live in app-level providers (`App.tsx`). Read
  // density here so the toolbar can mutate it; the lifted provider's
  // state is shared with the new `/wishlist` page automatically.
  const { density, setDensity } = useDensityContext();
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
    applyFilters,
    resetFilters,
  } = useStoreGames();

  // ── Local filter state (presentational for now — wired to backend later) ─
  const [searchActive, setSearchActive] = useState(false);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [yearMin, setYearMin] = useState<number | null>(null);
  const [yearMax, setYearMax] = useState<number | null>(null);
  const [ratingMin, setRatingMin] = useState<number | null>(null);

  // ── Mode (Discover landing vs Category grid) ──────────────────────────
  const [isDiscover, setIsDiscover] = useState(false);

  // ── Handlers ──────────────────────────────────────────────────────────
  const activeTab: StoreModeTab = isSearching
    ? "search"
    : isDiscover
      ? "discover"
      : category;

  const handleTabChange = useCallback(
    (tab: StoreModeTab) => {
      if (tab === "search") {
        setSearchActive(true);
        setIsDiscover(false);
      } else if (tab === "discover") {
        setSearchActive(false);
        setIsDiscover(true);
      } else {
        setSearchActive(false);
        setIsDiscover(false);
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
    // Forward the user's selected facets to `useStoreGames` so it can
    // re-invoke `fetch_store_games` with the matching IGDB where-clause.
    applyFilters({
      genres: selectedGenres,
      platforms: selectedPlatforms,
      yearMin,
      yearMax,
      ratingMin,
    });
  }, [applyFilters, selectedGenres, selectedPlatforms, yearMin, yearMax, ratingMin]);

  const handleResetFilters = useCallback(() => {
    setSelectedGenres([]);
    setSelectedPlatforms([]);
    setYearMin(null);
    setYearMax(null);
    setRatingMin(null);
    // Trigger an immediate re-fetch with the cleared filter set.
    resetFilters();
  }, [resetFilters]);

  const handleSeeAll = useCallback(
    (next: StoreCategory) => {
      setIsDiscover(false);
      setCategory(next);
    },
    [setCategory]
  );

  // Filters are visible in both Discover mode and Category mode (excluding
  // active search). In Discover they surface the user's selections so the
  // rail results reflect the same filter set when the user navigates to a
  // category.
  const showFilters = !isSearching;

  return (
    <div className="store-page">
      <StoreTabBar activeTab={activeTab} onTabChange={handleTabChange} />

      <StoreSearchBar
        value={searchQuery}
        onChange={handleSearchChange}
        visible={searchActive || isSearching}
      />

      {/* Density toolbar — shows whenever the user can browse cards
          (skipped on the dedicated search screen where input focus
          matters more than layout toggles). */}
      {!isSearching && (
        <div className="store-density-toolbar" aria-label="Layout controls">
          <span className="store-density-toolbar-label">Density</span>
          <DensityToggle density={density} onChange={setDensity} />
        </div>
      )}

      {isDiscover ? (
        /* ── Discover landing: hero + 5 IGDB rails. The wishlist rail
             was removed in Phase 2.7; wishlist content now lives on its
             own /wishlist page (top-nav tab) — Discover stays focused
             on IGDB discovery. */
        <div className="store-discover">
          <HeroFeature onCardClick={handleCardClick} />

          <div className="store-rails">
            <SnapRail
              title="Trending Now"
              category="trending"
              onCardClick={handleCardClick}
              onSeeAll={handleSeeAll}
              badge="🔥"
            />
            <SnapRail
              title="Most Popular"
              category="popular"
              onCardClick={handleCardClick}
              onSeeAll={handleSeeAll}
              badge="⭐"
            />
            <SnapRail
              title="Top Critics"
              category="top"
              onCardClick={handleCardClick}
              onSeeAll={handleSeeAll}
              badge="🏆"
            />
            <SnapRail
              title="Coming Soon"
              category="coming_soon"
              onCardClick={handleCardClick}
              onSeeAll={handleSeeAll}
              badge="🎮"
            />
            <SnapRail
              title="New Releases"
              category="new_releases"
              onCardClick={handleCardClick}
              onSeeAll={handleSeeAll}
              badge="✨"
            />
          </div>
        </div>
      ) : (
        /* ── Category / search detail view ───────────────────────── */
        <>
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
        </>
      )}
    </div>
  );
}
