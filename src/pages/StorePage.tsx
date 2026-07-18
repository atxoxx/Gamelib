import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStoreGames } from "../hooks/useStoreGames";
import { useStoreSourceAvailability } from "../hooks/useStoreSourceAvailability";
import { useDensityContext } from "../context/DensityContext";
import { useSources } from "../context/SourceContext";
import StoreTabBar from "../components/store/StoreTabBar";
import type { StoreModeTab } from "../components/store/StoreTabBar";
import StoreSearchBar from "../components/store/StoreSearchBar";
import StoreGameGrid from "../components/store/StoreGameGrid";
import StoreFilterChips from "../components/store/StoreFilterChips";
import StoreFilterSidebar from "../components/store/StoreFilterSidebar";
import StoreDiscover from "../components/store/StoreDiscover";
import DensityToggle from "../components/DensityToggle";
import type { StoreGameSummary, StoreCategory } from "../types/game";
import { useBigScreen } from "../context/BigScreenContext";
import BigScreenStore from "../components/store/BigScreenStore";

/**
 * Max number of consecutive empty-page auto-loads performed while the
 * source filter narrows an IGDB page to zero visible games. Beyond
 * this, we assume the filter is intentional (the user really wants
 * AND-intersection across N sources) and stop fetching the next IGDB
 * page automatically — manual scroll past the empty page is still
 * possible via the infinite-scroll sentinel.
 */
const MAX_AUTO_EMPTY_FETCHES = 3;

export default function StorePage() {
  const navigate = useNavigate();
  const { isBigScreen } = useBigScreen();
  // Wishlist + density live in app-level providers (`App.tsx`). Read
  // density here so the toolbar can mutate it; the lifted provider's
  // state is shared with the new `/wishlist` page automatically.
  const { density, setDensity } = useDensityContext();
  const { sources } = useSources();

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

  // Handlers
  const handleCardClick = useCallback(
    (game: StoreGameSummary) => {
      navigate(`/store/${game.slug}`);
    },
    [navigate]
  );

  if (isBigScreen) {
    return <BigScreenStore />;
  }


  // ── Library-mode filter state (presentational, wired to backend on Apply) ──
  const [searchActive, setSearchActive] = useState(false);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [yearMin, setYearMin] = useState<number | null>(null);
  const [yearMax, setYearMax] = useState<number | null>(null);
  const [ratingMin, setRatingMin] = useState<number | null>(null);

  // ── Download-source filter state ──────────────────────────────────
  // Client-side membership filter applied on top of the IGDB page:
  // a game is visible iff every selected source has it. The
  // `useStoreSourceAvailability` hook drives the membership map and
  // exposes a narrowed `visibleGames` list. State is local to this
  // component so leaving the Store tab resets the filter (matches
  // the existing per-facet behavior).
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);

  // Slide-over filter panel (mobile/compact efficiency upgrade): the
  // permanent sidebar is replaced by an on-demand drawer so the grid
  // keeps its full width until the user actually wants to filter.
  const [filtersOpen, setFiltersOpen] = useState(false);

  const activeFilterCount = useMemo(
    () =>
      selectedGenres.length +
      selectedPlatforms.length +
      (yearMin != null ? 1 : 0) +
      (yearMax != null ? 1 : 0) +
      (ratingMin != null ? 1 : 0) +
      selectedSourceIds.length,
    [selectedGenres, selectedPlatforms, yearMin, yearMax, ratingMin, selectedSourceIds]
  );

  // ── Prune dangling source IDs on Settings-side deletions ───────────
  // If the user deletes a source from Settings while a filter is
  // active, the deleted ID stays in `selectedSourceIds` until the
  // user manually removes it. The sidebar just removes its checkbox,
  // so the user has no obvious way to know their filter is now
  // referencing a dead source. Symptom: the hook keeps search-call
  // results that no longer include the deleted source → AND
  // intersection is permanently "no match" for every game → empty
  // visible set. Prune here so the chip count and visible set stay
  // consistent with the sidebar's checkbox list.
  const enabledSourceIds = useMemo(
    () => new Set(sources.filter((s) => s.enabled).map((s) => s.id)),
    [sources]
  );
  useEffect(() => {
    setSelectedSourceIds((prev) => {
      const filtered = prev.filter((id) => enabledSourceIds.has(id));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [enabledSourceIds]);

  // ── Mode (Discover landing vs Category grid) ──────────────────────
  const [isDiscover, setIsDiscover] = useState(false);

  // ── Derive visibility via the source-availability hook ────────────
  const {
    visibleGames,
    pending: sourceChecksPending,
    isFilterActive: isSourceFilterActive,
  } = useStoreSourceAvailability(games, selectedSourceIds);

  // ── Empty-page auto-load guard ────────────────────────────────────
  // Scenario: user activates the source filter (e.g. AND across 3
  // sources) and the current 20-game page yields 0 visible games.
  // The pristine infinite-scroll sentinel would auto-fire on the
  // first render, but the user is sitting on a blank screen with
  // no signal that more data is coming. Auto-trigger `loadMore()`
  // up to MAX_AUTO_EMPTY_FETCHES times so the user sees progress
  // without us burning the IGDB rate limit blindly. Reset the
  // counter as soon as any non-empty page renders.
  //
  // Two refs guard the counter: `autoEmptyFetchesRef` is the
  // per-cycle counter; `autoEmptyDispatchedRef` is a single-shot
  // latched per empty-visible cycle so multiple effect re-runs
  // for the same empty state (e.g. unrelated dep flips) don't
  // double-dispatch against the counter.
  const autoEmptyFetchesRef = useRef(0);
  const autoEmptyDispatchedRef = useRef(false);
  useEffect(() => {
    if (visibleGames.length > 0) {
      autoEmptyFetchesRef.current = 0;
      autoEmptyDispatchedRef.current = false;
      return;
    }

    if (!isSourceFilterActive) return;
    if (!hasMore || loading) return;
    if (games.length === 0) return;
    if (autoEmptyFetchesRef.current >= MAX_AUTO_EMPTY_FETCHES) return;
    // Latch: only one auto-dispatch per empty-visible cycle. Cleared
    // by the `visibleGames.length > 0` branch above or by the next
    // fetch actually flipping `visibleGames.length` away from 0.
    if (autoEmptyDispatchedRef.current) return;

    autoEmptyDispatchedRef.current = true;
    autoEmptyFetchesRef.current += 1;
    loadMore();
  }, [
    isSourceFilterActive,
    visibleGames.length,
    hasMore,
    loading,
    games.length,
    loadMore,
  ]);

  // ── Handlers ──────────────────────────────────────────────────────
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
    setSelectedSourceIds([]);
    // Reset the auto-load counter so a fresh filter test isn't
    // capped at the previous run's exhausted attempts.
    autoEmptyFetchesRef.current = 0;
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

  // Total visible-after-source-filter count for the chips. Render
  // the *post-source-filter* count whenever the source filter is
  // active — regardless of whether it narrows the set — because the
  // source chip itself is the affordance telling the user the
  // filter is active, and the adjacent count is the most natural
  // place to communicate "20 games passed" vs. "0 games passed".
  const sourceFilterChipCount = isSourceFilterActive
    ? visibleGames.length
    : undefined;

  // Centralizes the sidebar so it can be mounted in both the inline
  // layout (wide screens) and the slide-over drawer (compact widths)
  // without duplicating the prop list.
  const renderFilterSidebar = () => (
    <StoreFilterSidebar
      selectedGenres={selectedGenres}
      selectedPlatforms={selectedPlatforms}
      yearMin={yearMin}
      yearMax={yearMax}
      ratingMin={ratingMin}
      selectedSourceIds={selectedSourceIds}
      onGenresChange={setSelectedGenres}
      onPlatformsChange={setSelectedPlatforms}
      onYearRangeChange={(min, max) => {
        setYearMin(min);
        setYearMax(max);
      }}
      onRatingMinChange={setRatingMin}
      onSourcesChange={setSelectedSourceIds}
      onApply={() => {
        handleApplyFilters();
        setFiltersOpen(false);
      }}
      onReset={handleResetFilters}
    />
  );

  // Human-readable title for the active category / search context, used
  // by the results header strip so the user always knows what they're
  // browsing without re-reading the tab bar.
  const resultsTitle = useMemo(() => {
    if (isSearching) return "Search";
    const label = {
      trending: "Trending",
      popular: "Popular",
      top: "Top Rated",
      coming_soon: "Coming Soon",
      new_releases: "New Releases",
      all: "All Games",
    }[category];
    return label ?? "Games";
  }, [isSearching, category]);

  return (
    <div className="store-page">
      <StoreTabBar activeTab={activeTab} onTabChange={handleTabChange} />

      <StoreSearchBar
        value={searchQuery}
        onChange={handleSearchChange}
        visible={searchActive || isSearching}
      />

      {isDiscover ? (
        <StoreDiscover
          onCardClick={handleCardClick}
          onSeeAll={handleSeeAll}
        />
      ) : (
        /* ── Category / search detail view ───────────────────────── */
        <div className="store-detail">
          {/* Sticky toolbar: results title + live count on the left,
              filter trigger + density toggle on the right. Stays pinned
              while the grid scrolls so layout controls are always a
              single tap away. */}
          <div className="store-toolbar">
            <div className="store-toolbar-title">
              <h2>{resultsTitle}</h2>
              <span className="store-toolbar-count">
                {sourceFilterChipCount !== undefined
                  ? sourceFilterChipCount
                  : games.length}{" "}
                game{games.length !== 1 ? "s" : ""}
              </span>
            </div>

            <div className="store-toolbar-actions">
              <button
                type="button"
                className={`store-filter-trigger${activeFilterCount > 0 ? " has-active" : ""}`}
                onClick={() => setFiltersOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={filtersOpen}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="4" y1="6" x2="20" y2="6" />
                  <line x1="7" y1="12" x2="17" y2="12" />
                  <line x1="10" y1="18" x2="14" y2="18" />
                </svg>
                Filters
                {activeFilterCount > 0 && (
                  <span className="store-filter-trigger-badge">
                    {activeFilterCount}
                  </span>
                )}
              </button>

              <div className="store-density-toolbar" aria-label="Layout controls">
                <DensityToggle density={density} onChange={setDensity} />
              </div>
            </div>
          </div>

          {showFilters && (
            <StoreFilterChips
              selectedGenres={selectedGenres}
              selectedPlatforms={selectedPlatforms}
              yearMin={yearMin}
              yearMax={yearMax}
              ratingMin={ratingMin}
              selectedSourceIds={selectedSourceIds}
              sources={sources}
              sourceChecksPending={sourceChecksPending}
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
              onRemoveSource={(s) =>
                setSelectedSourceIds((prev) => prev.filter((x) => x !== s))
              }
              resultCount={
                sourceFilterChipCount !== undefined
                  ? sourceFilterChipCount
                  : games.length
              }
            />
          )}

          {/* Inline sidebar on wide viewports. The slide-over drawer
              (below) handles compact widths so the grid keeps its full
              width until filters are explicitly requested. */}
          <div className="store-layout">
            <div className="store-layout-inline-sidebar">{renderFilterSidebar()}</div>

            <div className="store-main">
              {isSearching && searchQuery && !loading && (
                <p className="store-search-results-label">
                  Results for "<strong>{searchQuery}</strong>"
                  {visibleGames.length > 0 && <> — {visibleGames.length} game{visibleGames.length !== 1 ? "s" : ""}</>}
                </p>
              )}

              <StoreGameGrid
                games={visibleGames}
                loading={loading}
                error={error}
                hasMore={hasMore}
                onLoadMore={loadMore}
                onCardClick={handleCardClick}
                isSourceFilterActive={isSourceFilterActive}
                isSourceCheckPending={sourceChecksPending > 0}
              />
            </div>
          </div>
        </div>
      )}

      {/* Slide-over filter drawer (compact widths). Animated, with a
          scrim that closes on click. On wide screens it is hidden and
          the inline sidebar above takes over. */}
      <div
        className={`store-filter-drawer-scrim${filtersOpen ? " open" : ""}`}
        onClick={() => setFiltersOpen(false)}
        aria-hidden={!filtersOpen}
      />
      <aside
        className={`store-filter-drawer${filtersOpen ? " open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Filters"
        aria-hidden={!filtersOpen}
      >
        <div className="store-filter-drawer-header">
          <h3>Filters</h3>
          <button
            type="button"
            className="store-filter-drawer-close"
            onClick={() => setFiltersOpen(false)}
            aria-label="Close filters"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="store-filter-drawer-body">{renderFilterSidebar()}</div>
      </aside>
    </div>
  );
}
