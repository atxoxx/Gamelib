import StoreFilterSidebar from "./StoreFilterSidebar";
import type { StoreCatalogue } from "../../hooks/useStoreCatalogue";

interface StoreFilterPanelProps {
  catalogue: StoreCatalogue;
}

/**
 * Wraps `StoreFilterSidebar` in both the inline (wide-viewport) rail and
 * the slide-over drawer (compact widths), so the filter UI isn't
 * duplicated. The drawer is opened via the header "Filters" trigger.
 */
export default function StoreFilterPanel({ catalogue: c }: StoreFilterPanelProps) {
  const renderSidebar = () => (
    <StoreFilterSidebar
      selectedGenres={c.selectedGenres}
      selectedPlatforms={c.selectedPlatforms}
      yearMin={c.yearMin}
      yearMax={c.yearMax}
      ratingMin={c.ratingMin}
      selectedSourceIds={c.selectedSourceIds}
      onGenresChange={c.setSelectedGenres}
      onPlatformsChange={c.setSelectedPlatforms}
      onYearRangeChange={c.setYearRange}
      onRatingMinChange={c.setRatingMin}
      onSourcesChange={c.setSelectedSourceIds}
      onApply={() => {
        c.applyFilters();
        c.setFiltersOpen(false);
      }}
      onReset={c.resetFilters}
    />
  );

  return (
    <>
      {/* Inline rail on wide viewports with a collapse toggle. */}
      <div className={`store-filter-rail${c.filtersCollapsed ? " collapsed" : ""}`}>
        <button
          type="button"
          className={`store-filter-rail-toggle${c.activeFilterCount > 0 ? " active" : ""}`}
          onClick={() => c.setFiltersCollapsed(!c.filtersCollapsed)}
          aria-label={c.filtersCollapsed ? "Show filters" : "Hide filters"}
          aria-expanded={!c.filtersCollapsed}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="7" y1="12" x2="17" y2="12" />
            <line x1="10" y1="18" x2="14" y2="18" />
          </svg>
        </button>
        {!c.filtersCollapsed && (
          <div className="store-layout-inline-sidebar">{renderSidebar()}</div>
        )}
      </div>

      {/* Slide-over drawer for compact widths. */}
      <div
        className={`store-filter-drawer-scrim${c.filtersOpen ? " open" : ""}`}
        onClick={() => c.setFiltersOpen(false)}
        aria-hidden={!c.filtersOpen}
      />
      <aside
        className={`store-filter-drawer${c.filtersOpen ? " open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Filters"
        aria-hidden={!c.filtersOpen}
      >
        <div className="store-filter-drawer-header">
          <h3>Filters</h3>
          <button
            type="button"
            className="store-filter-drawer-close"
            onClick={() => c.setFiltersOpen(false)}
            aria-label="Close filters"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="store-filter-drawer-body">{renderSidebar()}</div>
      </aside>
    </>
  );
}
