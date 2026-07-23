import StoreSearchBar from "./StoreSearchBar";
import StoreSortDropdown from "./StoreSortDropdown";
import DensityToggle from "../DensityToggle";
import type { StoreCatalogue } from "../../hooks/useStoreCatalogue";

interface StoreHeaderProps {
  catalogue: StoreCatalogue;
}

/**
 * Hydra-style sticky top bar for the Store catalogue: prominent search,
 * live result count, sort dropdown, density toggle, and the Select /
 * Filters triggers. Keeping it as its own component keeps `StorePage`
 * a thin composition root.
 */
export default function StoreHeader({ catalogue: c }: StoreHeaderProps) {
  return (
    <header className="store-header">
      <div className="store-header-top">
        <div className="store-header-brand">
          <span className="brand-eyebrow">Store</span>
          <h2 className="brand-text">{c.resultsTitle}</h2>
          <span className="store-toolbar-count">
            {c.sourceFilterChipCount !== undefined
              ? c.sourceFilterChipCount
              : c.displayedGames.length}{" "}
            game{c.displayedGames.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="store-header-search">
          <StoreSearchBar
            value={c.searchQuery}
            onChange={c.setSearchQuery}
            visible
            recentSearches={c.recentSearches}
            onRemoveRecent={c.removeRecentSearch}
            onPickSuggestion={c.onCardClick}
          />
        </div>

        <div className="store-header-actions">
          <StoreSortDropdown value={c.sort} onChange={c.setSort} />

          {c.hiddenCount > 0 && (
            <button
              type="button"
              className={`store-toolbar-toggle${c.showHidden ? " active" : ""}`}
              onClick={() => c.setShowHidden(!c.showHidden)}
              title={c.showHidden ? "Hide dismissed games" : "Show dismissed games"}
            >
              {c.showHidden ? "Hide dismissed" : `Show hidden (${c.hiddenCount})`}
            </button>
          )}

          <button
            type="button"
            className={`store-toolbar-toggle${c.bulkMode ? " active" : ""}`}
            onClick={() => {
              c.setBulkMode(!c.bulkMode);
              c.clearSelection();
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
            className={`store-filter-trigger${c.activeFilterCount > 0 ? " has-active" : ""}`}
            onClick={() => c.setFiltersOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={c.filtersOpen}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="7" y1="12" x2="17" y2="12" />
              <line x1="10" y1="18" x2="14" y2="18" />
            </svg>
            Filters
            {c.activeFilterCount > 0 && (
              <span className="store-filter-trigger-badge">{c.activeFilterCount}</span>
            )}
          </button>

          <div className="store-density-toolbar" aria-label="Layout controls">
            <DensityToggle density={c.density} onChange={c.setDensity} />
          </div>
        </div>
      </div>
    </header>
  );
}
