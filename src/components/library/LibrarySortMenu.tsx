import { useEffect, useRef, useState } from "react";
import {
  SORT_OPTIONS,
  SORT_LABELS,
  type LibrarySort,
} from "../../hooks/useLibraryFilters";

interface LibrarySortMenuProps {
  value: LibrarySort;
  onChange: (sort: LibrarySort) => void;
  className?: string;
}

const SORT_ICONS: Record<LibrarySort, React.ReactNode> = {
  alphabetical: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6h16" />
      <path d="M4 12h10" />
      <path d="M4 18h7" />
    </svg>
  ),
  date_added: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
    </svg>
  ),
  most_played: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  rating: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
};

/**
 * LibrarySortMenu: a compact dropdown that lets the user reorder the
 * library grid. Themskinned to match the existing density toolbar /
 * segmented controls so it reads as one surface. Closes on outside
 * click and on Escape for keyboard parity.
 */
export default function LibrarySortMenu({
  value,
  onChange,
  className,
}: LibrarySortMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={`library-sort-menu${className ? " " + className : ""}`}
    >
      <button
        type="button"
        className={`library-sort-trigger${open ? " open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title="Sort library"
      >
        <span className="library-sort-trigger-icon" aria-hidden="true">
          {SORT_ICONS[value]}
        </span>
        <span className="library-sort-trigger-label">
          {SORT_LABELS[value]}
        </span>
        <svg className="library-sort-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <ul className="library-sort-list" role="listbox" aria-label="Sort order">
          {SORT_OPTIONS.map((opt) => (
            <li key={opt} role="option" aria-selected={opt === value}>
              <button
                type="button"
                className={`library-sort-option${opt === value ? " active" : ""}`}
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                }}
              >
                <span className="library-sort-option-icon" aria-hidden="true">
                  {SORT_ICONS[opt]}
                </span>
                <span>{SORT_LABELS[opt]}</span>
                {opt === value && (
                  <svg className="library-sort-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
