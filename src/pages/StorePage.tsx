import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useStoreGames } from "../hooks/useStoreGames";
import { useStoreSourceAvailability } from "../hooks/useStoreSourceAvailability";
import { useDensityContext } from "../context/DensityContext";
import { useSources } from "../context/SourceContext";
import { useWishlistContext } from "../context/WishlistContext";
import { useToast } from "../context/ToastContext";
import { useGames } from "../context/GameContext";
import { CrackWatchProvider } from "../context/CrackWatchContext";
import { PriceProvider } from "../context/PriceContext";
import { useLibraryIndex } from "../hooks/useLibraryIndex";
import { useHiddenGames } from "../hooks/useHiddenGames";
import { useRecentlyViewed } from "../hooks/useRecentlyViewed";
import { useRecentSearches } from "../hooks/useRecentSearches";
import { useStorePresets } from "../hooks/useStorePresets";
import StoreTabBar from "../components/store/StoreTabBar";
import type { StoreModeTab } from "../components/store/StoreTabBar";
import StoreSearchBar from "../components/store/StoreSearchBar";
import StoreGameGrid from "../components/store/StoreGameGrid";
import StoreFilterChips from "../components/store/StoreFilterChips";
import StoreFilterSidebar from "../components/store/StoreFilterSidebar";
import StoreDiscover from "../components/store/StoreDiscover";
import StoreSortDropdown from "../components/store/StoreSortDropdown";
import StorePresetBar from "../components/store/StorePresetBar";
import StoreBulkBar from "../components/store/StoreBulkBar";
import StoreCompareTray from "../components/store/StoreCompareTray";
import StoreCompareModal from "../components/store/StoreCompareModal";
import DensityToggle from "../components/DensityToggle";
import type { GameMetadataResult, StoreGameSummary, StoreCategory } from "../types/game";
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
  const wishlist = useWishlistContext();
  const { showToast } = useToast();
  const { addStoreGame } = useGames();

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
    sort,
    setSort,
  } = useStoreGames();

  // ── New feature hooks (declared before any early return to keep
  //    hook order stable). ────────────────────────────────────────────
  const libraryIndex = useLibraryIndex();
  const hiddenGames = useHiddenGames();
  const recentlyViewed = useRecentlyViewed();
  const recentSearches = useRecentSearches();
  const presets = useStorePresets();

  // Reveal hidden ("Not Interested") games toggle.
  const [showHidden, setShowHidden] = useState(false);

  // Bulk-select mode + selection set (by slug).
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set());

  // Compare tray (up to 3 pinned store games).
  const [compareGames, setCompareGames] = useState<StoreGameSummary[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [addingAll, setAddingAll] = useState(false);

  // Handlers
  const handleCardClick = useCallback(
    (game: StoreGameSummary) => {
      recentlyViewed.record(game);
      navigate(`/store/${game.slug}`);
    },
    [navigate, recentlyViewed]
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

  // Collapse state for the inline filter rail on wide viewports — mirrors
  // the library's `lib-rail-toggle-btn` so the filter panel can be hidden
  // or shown with a single tap without leaving the page.
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);

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

  // Apply the "Not Interested" hidden filter on top of the source-narrowed
  // list. Hidden games are removed by default; the toolbar toggle
  // (`showHidden`) reveals them again for un-hiding.
  const displayedGames = useMemo(() => {
    if (showHidden || hiddenGames.count === 0) return visibleGames;
    return visibleGames.filter((g) => !hiddenGames.hiddenSet.has(g.slug));
  }, [visibleGames, showHidden, hiddenGames.hiddenSet, hiddenGames.count]);

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

  // Persist committed searches (debounced) for the recent-searches
  // empty state. We record the trimmed query ~1s after typing stops so
  // partial keystrokes ("eld", "elde") don't clutter the history.
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) return;
    const t = setTimeout(() => recentSearches.record(q), 1000);
    return () => clearTimeout(t);
  }, [searchQuery, recentSearches]);

  // Global "/" shortcut: focus the store search (unless already typing in
  // a field). Opens the search tab if it isn't active yet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      e.preventDefault();
      setSearchActive(true);
      setIsDiscover(false);
      // Focus after the search bar mounts/renders.
      setTimeout(() => {
        const input = document.querySelector<HTMLInputElement>(".store-search-input");
        input?.focus();
      }, 0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  // ── Hide / bulk / compare / preset handlers ───────────────────────
  const handleHide = useCallback(
    (game: StoreGameSummary) => {
      hiddenGames.hide(game.slug);
    },
    [hiddenGames]
  );

  const handleToggleSelect = useCallback((game: StoreGameSummary) => {
    setSelectedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(game.slug)) next.delete(game.slug);
      else next.add(game.slug);
      return next;
    });
  }, []);

  const selectedGames = useMemo(
    () => displayedGames.filter((g) => selectedSlugs.has(g.slug)),
    [displayedGames, selectedSlugs]
  );

  const clearSelection = useCallback(() => setSelectedSlugs(new Set()), []);

  const handleAddCompare = useCallback((game: StoreGameSummary) => {
    setCompareGames((prev) => {
      if (prev.some((g) => g.slug === game.slug)) return prev;
      if (prev.length >= 3) return prev;
      return [...prev, game];
    });
  }, []);

  const handleRemoveCompare = useCallback((slug: string) => {
    setCompareGames((prev) => prev.filter((g) => g.slug !== slug));
  }, []);

  // ── Bulk actions ─────────────────────────────────────────────────
  const selectAllVisible = useCallback(() => {
    setSelectedSlugs(new Set(displayedGames.map((g) => g.slug)));
  }, [displayedGames]);

  const handleWishlistAll = useCallback(() => {
    let added = 0;
    selectedGames.forEach((g) => {
      if (!wishlist.isWishlisted(g.slug)) {
        wishlist.toggle(g);
        added += 1;
      }
    });
    showToast(`Added ${added} game${added !== 1 ? "s" : ""} to wishlist`, "success");
    clearSelection();
  }, [selectedGames, wishlist, showToast, clearSelection]);

  const handleHideAll = useCallback(() => {
    const count = selectedGames.length;
    selectedGames.forEach((g) => hiddenGames.hide(g.slug));
    showToast(`Hid ${count} game${count !== 1 ? "s" : ""}`, "info");
    clearSelection();
  }, [selectedGames, hiddenGames, showToast, clearSelection]);

  const handleAddAll = useCallback(async () => {
    if (addingAll || selectedGames.length === 0) return;
    setAddingAll(true);
    let added = 0;
    let skipped = 0;
    try {
      for (const g of selectedGames) {
        // Skip games already in library.
        if (libraryIndex.isInLibrary(g)) {
          skipped += 1;
          continue;
        }
        try {
          const detail = await invoke<GameMetadataResult | null>(
            "get_store_game_detail",
            { slug: g.slug }
          );
          if (detail) {
            await addStoreGame(detail);
            added += 1;
          }
        } catch {
          // Continue on individual failure — bulk should be resilient.
        }
      }
      const parts: string[] = [];
      if (added > 0) parts.push(`added ${added}`);
      if (skipped > 0) parts.push(`skipped ${skipped} already owned`);
      showToast(
        parts.length > 0
          ? `Library: ${parts.join(", ")}`
          : "No games were added",
        added > 0 ? "success" : "info"
      );
    } finally {
      setAddingAll(false);
      clearSelection();
    }
  }, [addingAll, selectedGames, libraryIndex, addStoreGame, showToast, clearSelection]);

  // Save the current facet + source + sort combination as a preset.
  const handleSavePreset = useCallback(
    (name: string) => {
      presets.save({
        name,
        genres: selectedGenres,
        platforms: selectedPlatforms,
        yearMin,
        yearMax,
        ratingMin,
        sourceIds: selectedSourceIds,
        sort,
      });
    },
    [presets, selectedGenres, selectedPlatforms, yearMin, yearMax, ratingMin, selectedSourceIds, sort]
  );

  // Restore a saved preset: hydrate the facet state, prune dead sources,
  // set the sort, then re-fetch.
  const handleApplyPreset = useCallback(
    (id: string) => {
      const preset = presets.presets.find((p) => p.id === id);
      if (!preset) return;
      setSelectedGenres(preset.genres);
      setSelectedPlatforms(preset.platforms);
      setYearMin(preset.yearMin);
      setYearMax(preset.yearMax);
      setRatingMin(preset.ratingMin);
      setSelectedSourceIds(preset.sourceIds.filter((sid) => enabledSourceIds.has(sid)));
      setIsDiscover(false);
      setSearchActive(false);
      setSort(preset.sort);
      applyFilters({
        genres: preset.genres,
        platforms: preset.platforms,
        yearMin: preset.yearMin,
        yearMax: preset.yearMax,
        ratingMin: preset.ratingMin,
      });
    },
    [presets.presets, enabledSourceIds, setSort, applyFilters]
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
    <CrackWatchProvider>
    <PriceProvider>
    <div className="store-page">
      <StoreTabBar activeTab={activeTab} onTabChange={handleTabChange} />

      <StoreSearchBar
        value={searchQuery}
        onChange={handleSearchChange}
        visible={searchActive || isSearching}
        recentSearches={recentSearches.searches}
        onRemoveRecent={recentSearches.remove}
        onPickSuggestion={handleCardClick}
      />

      {isDiscover ? (
        <StoreDiscover
          onCardClick={handleCardClick}
          onSeeAll={handleSeeAll}
          recentlyViewed={recentlyViewed.items}
          isInLibrary={libraryIndex.isInLibrary}
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
              <StoreSortDropdown value={sort} onChange={setSort} />

              {hiddenGames.count > 0 && (
                <button
                  type="button"
                  className={`store-toolbar-toggle${showHidden ? " active" : ""}`}
                  onClick={() => setShowHidden((v) => !v)}
                  title={showHidden ? "Hide dismissed games" : "Show dismissed games"}
                >
                  {showHidden ? "Hide dismissed" : `Show hidden (${hiddenGames.count})`}
                </button>
              )}

              <button
                type="button"
                className={`store-toolbar-toggle${bulkMode ? " active" : ""}`}
                onClick={() => {
                  setBulkMode((v) => !v);
                  clearSelection();
                }}
                title="Select multiple games"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="9 11 12 14 22 4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
                Select
              </button>

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
            <StorePresetBar
              presets={presets.presets}
              canSave={activeFilterCount > 0 || sort !== "default"}
              onApply={handleApplyPreset}
              onRemove={presets.remove}
              onSave={handleSavePreset}
            />
          )}

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

          {/* Inline filter rail on wide viewports, with a collapse toggle
              (mirrors the library's `lib-rail-toggle-btn`). The slide-over
              drawer (below) handles compact widths. */}
          <div className="store-layout">
            <div className={`store-filter-rail${filtersCollapsed ? " collapsed" : ""}`}>
              <button
                type="button"
                className={`store-filter-rail-toggle${activeFilterCount > 0 ? " active" : ""}`}
                onClick={() => setFiltersCollapsed((c) => !c)}
                aria-label={filtersCollapsed ? "Show filters" : "Hide filters"}
                aria-expanded={!filtersCollapsed}
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
              </button>
              {!filtersCollapsed && (
                <div className="store-layout-inline-sidebar">{renderFilterSidebar()}</div>
              )}
            </div>

            <div className="store-main">
              {isSearching && searchQuery && !loading && (
                <p className="store-search-results-label">
                  Results for "<strong>{searchQuery}</strong>"
                  {displayedGames.length > 0 && <> — {displayedGames.length} game{displayedGames.length !== 1 ? "s" : ""}</>}
                </p>
              )}

              <StoreGameGrid
                games={displayedGames}
                loading={loading}
                error={error}
                hasMore={hasMore}
                onLoadMore={loadMore}
                onCardClick={handleCardClick}
                isSourceFilterActive={isSourceFilterActive}
                isSourceCheckPending={sourceChecksPending > 0}
                isInLibrary={libraryIndex.isInLibrary}
                onHide={handleHide}
                onCompare={handleAddCompare}
                bulkMode={bulkMode}
                selectedSlugs={selectedSlugs}
                onToggleSelect={handleToggleSelect}
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

      {/* Bulk-select action bar (docked bottom) — only in bulk mode. */}
      {bulkMode && !isDiscover && (
        <StoreBulkBar
          selectedCount={selectedSlugs.size}
          totalCount={displayedGames.length}
          onSelectAll={selectAllVisible}
          onClear={clearSelection}
          onWishlistAll={handleWishlistAll}
          onHideAll={handleHideAll}
          onAddAll={handleAddAll}
          onExit={() => {
            setBulkMode(false);
            clearSelection();
          }}
          addingAll={addingAll}
        />
      )}

      {/* Compare tray (docked bottom) + modal. Hidden in bulk mode to
          avoid two stacked docks. */}
      {!bulkMode && (
        <StoreCompareTray
          games={compareGames}
          onRemove={handleRemoveCompare}
          onClear={() => setCompareGames([])}
          onOpen={() => setCompareOpen(true)}
        />
      )}

      {compareOpen && compareGames.length >= 2 && (
        <StoreCompareModal
          games={compareGames}
          onClose={() => setCompareOpen(false)}
          onOpenGame={(g) => {
            setCompareOpen(false);
            handleCardClick(g);
          }}
        />
      )}
    </div>
    </PriceProvider>
    </CrackWatchProvider>
  );
}
