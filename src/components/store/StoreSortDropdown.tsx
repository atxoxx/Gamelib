import { useEffect, useRef, useState } from "react";
import {
  STORE_SORTS,
  STORE_SORT_LABELS,
  type StoreSort,
} from "../../types/game";

interface StoreSortDropdownProps {
  value: StoreSort;
  onChange: (next: StoreSort) => void;
}

/**
 * StoreSortDropdown: a compact "Sort: {label} ▼" control for the store
 * toolbar. Persistent across every category view (not just All Games) so
 * the store follows the common convention users expect.
 *
 * Purely presentational — the actual IGDB re-fetch is driven by
 * `useStoreGames.setSort`.
 */
export default function StoreSortDropdown({
  value,
  onChange,
}: StoreSortDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside-click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="store-sort" ref={rootRef}>
      <button
        type="button"
        className={`store-sort-trigger${value !== "default" ? " has-active" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
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
          <line x1="6" y1="12" x2="18" y2="12" />
          <line x1="9" y1="18" x2="15" y2="18" />
        </svg>
        <span className="store-sort-label">
          Sort: {STORE_SORT_LABELS[value]}
        </span>
        <svg
          className="store-sort-chevron"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <ul className="store-sort-menu" role="listbox">
          {STORE_SORTS.map((s) => (
            <li key={s} role="option" aria-selected={s === value}>
              <button
                type="button"
                className={`store-sort-option${s === value ? " active" : ""}`}
                onClick={() => {
                  onChange(s);
                  setOpen(false);
                }}
              >
                {STORE_SORT_LABELS[s]}
                {s === value && (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
