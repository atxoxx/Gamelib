interface StoreBulkBarProps {
  selectedCount: number;
  /** Total games available to select in the current view. */
  totalCount: number;
  onSelectAll: () => void;
  onClear: () => void;
  onWishlistAll: () => void;
  onHideAll: () => void;
  onAddAll: () => void;
  onExit: () => void;
  /** True while a bulk add-to-library operation is running. */
  addingAll?: boolean;
}

/**
 * StoreBulkBar: sticky action bar shown while bulk-select mode is active.
 * Surfaces select-all / clear plus bulk wishlist / hide / add-to-library
 * for the current selection.
 */
export default function StoreBulkBar({
  selectedCount,
  totalCount,
  onSelectAll,
  onClear,
  onWishlistAll,
  onHideAll,
  onAddAll,
  onExit,
  addingAll = false,
}: StoreBulkBarProps) {
  const none = selectedCount === 0;
  return (
    <div className="store-bulk-bar" role="toolbar" aria-label="Bulk actions">
      <div className="store-bulk-bar-info">
        <span className="store-bulk-count">{selectedCount} selected</span>
        <button type="button" className="store-bulk-link" onClick={onSelectAll}>
          Select all ({totalCount})
        </button>
        <button
          type="button"
          className="store-bulk-link"
          onClick={onClear}
          disabled={none}
        >
          Clear
        </button>
      </div>

      <div className="store-bulk-bar-actions">
        <button type="button" className="store-bulk-action" onClick={onWishlistAll} disabled={none}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
          Wishlist
        </button>
        <button type="button" className="store-bulk-action" onClick={onHideAll} disabled={none}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
          Hide
        </button>
        <button type="button" className="store-bulk-action primary" onClick={onAddAll} disabled={none || addingAll}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {addingAll ? "Adding…" : "Add to library"}
        </button>
        <button type="button" className="store-bulk-exit" onClick={onExit} aria-label="Exit bulk select">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
