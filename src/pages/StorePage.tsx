import { useBigScreen } from "../context/BigScreenContext";
import { useSources } from "../context/SourceContext";
import { CrackWatchProvider } from "../context/CrackWatchContext";
import { PriceProvider } from "../context/PriceContext";
import { useStoreCatalogue } from "../hooks/useStoreCatalogue";
import StoreHeader from "../components/store/StoreHeader";
import StoreFilterPanel from "../components/store/StoreFilterPanel";
import StoreFeaturedHero from "../components/store/StoreFeaturedHero";
import StoreFilterChips from "../components/store/StoreFilterChips";
import StoreGameGrid from "../components/store/StoreGameGrid";
import StorePresetBar from "../components/store/StorePresetBar";
import StoreBulkBar from "../components/store/StoreBulkBar";
import StoreCompareTray from "../components/store/StoreCompareTray";
import StoreCompareModal from "../components/store/StoreCompareModal";
import BigScreenStore from "../components/store/BigScreenStore";
import "../styles/page-store.css";

/**
 * StorePage — Hydra-inspired single searchable catalogue.
 *
 * The page is intentionally thin: all browse state and behavior live in
 * `useStoreCatalogue`, and the presentational pieces (header, filter
 * panel, grid, bars) are composed here. There are no category tabs —
 * sorting, filtering, and search drive one unified grid.
 */
export default function StorePage() {
  const { isBigScreen } = useBigScreen();
  const c = useStoreCatalogue();
  const { sources } = useSources();

  if (isBigScreen) {
    return <BigScreenStore />;
  }

  const onRemoveGenre = (g: string) =>
    c.setSelectedGenres(c.selectedGenres.filter((x) => x !== g));
  const onRemovePlatform = (p: string) =>
    c.setSelectedPlatforms(c.selectedPlatforms.filter((x) => x !== p));
  const onRemoveSource = (s: string) =>
    c.setSelectedSourceIds(c.selectedSourceIds.filter((x) => x !== s));

  const canSavePreset = c.activeFilterCount > 0 || c.sort !== "default";

  return (
    <CrackWatchProvider>
    <PriceProvider>
    <div className="store-page">
      <StoreHeader catalogue={c} />

      {c.activeFilterCount > 0 && (
        <StoreFilterChips
          selectedGenres={c.selectedGenres}
          selectedPlatforms={c.selectedPlatforms}
          yearMin={c.yearMin}
          yearMax={c.yearMax}
          ratingMin={c.ratingMin}
          selectedSourceIds={c.selectedSourceIds}
          sources={sources}
          sourceChecksPending={c.sourceChecksPending}
          onRemoveGenre={onRemoveGenre}
          onRemovePlatform={onRemovePlatform}
          onRemoveYear={() => c.setYearRange(null, null)}
          onRemoveRating={() => c.setRatingMin(null)}
          onRemoveSource={onRemoveSource}
          resultCount={c.sourceFilterChipCount ?? c.displayedGames.length}
        />
      )}

      {(c.presets.length > 0 || canSavePreset) && (
        <StorePresetBar
          presets={c.presets}
          canSave={canSavePreset}
          onApply={c.applyPreset}
          onRemove={c.removePreset}
          onSave={c.savePreset}
        />
      )}

      <StoreFeaturedHero onPickGame={c.onCardClick} />

      <div className="store-layout">
        <StoreFilterPanel catalogue={c} />

        <div className="store-main">
          <StoreGameGrid
            games={c.displayedGames}
            loading={c.loading}
            error={c.error}
            hasMore={c.hasMore}
            onLoadMore={c.loadMore}
            onCardClick={c.onCardClick}
            isSourceFilterActive={c.isSourceFilterActive}
            isSourceCheckPending={c.sourceChecksPending > 0}
            isInLibrary={c.isInLibrary}
            onHide={c.onHide}
            onCompare={c.addCompare}
            bulkMode={c.bulkMode}
            selectedSlugs={c.selectedSlugs}
            onToggleSelect={c.toggleSelect}
          />
        </div>
      </div>

      {c.bulkMode && (
        <StoreBulkBar
          selectedCount={c.selectedSlugs.size}
          totalCount={c.displayedGames.length}
          onSelectAll={c.selectAllVisible}
          onClear={c.clearSelection}
          onWishlistAll={c.wishlistAll}
          onHideAll={c.hideAll}
          onAddAll={c.addAll}
          onExit={() => {
            c.setBulkMode(false);
            c.clearSelection();
          }}
          addingAll={c.addingAll}
        />
      )}

      {!c.bulkMode && (
        <StoreCompareTray
          games={c.compareGames}
          onRemove={c.removeCompare}
          onClear={c.clearCompare}
          onOpen={() => c.setCompareOpen(true)}
        />
      )}

      {c.compareOpen && c.compareGames.length >= 2 && (
        <StoreCompareModal
          games={c.compareGames}
          onClose={() => c.setCompareOpen(false)}
          onOpenGame={(g) => {
            c.setCompareOpen(false);
            c.onCardClick(g);
          }}
        />
      )}
    </div>
    </PriceProvider>
    </CrackWatchProvider>
  );
}
