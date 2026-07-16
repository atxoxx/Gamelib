import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFocusable } from "../../hooks/useFocusable";

interface BigScreenSearchOverlayProps {
  open: boolean;
  onClose: () => void;
}

const SearchIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const CloseIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

/**
 * BigScreenSearchOverlay: full-screen "press to search" modal for Big
 * Screen Mode. Launched from the header search button (or the `/` key).
 *
 * Gamepad model:
 *  - The text input is wrapped in `useFocusable` so D-pad / left-stick
 *    navigation and the A button still work; the X button (Escape) and
 *    the header's close affordance both close it.
 *  - Typing is done with the on-screen virtual cursor (right stick) or
 *    a physical keyboard when one is attached to the TV box.
 *  - Submitting (Enter or the View button) navigates to the Store with
 *    the query pre-filled via the `?q=` URL param (StorePage reads it).
 */
export default function BigScreenSearchOverlay({
  open,
  onClose,
}: BigScreenSearchOverlayProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputFocusable = useFocusable(() => inputRef.current?.focus());

  // Merge the focusable's callback ref (registers with the Big Screen
  // nav registry) with a local ref so we can still imperatively focus.
  const setInputRef = useCallback(
    (el: HTMLInputElement | null) => {
      inputRef.current = el;
      (inputFocusable.ref as (node: HTMLElement | null) => void)(el);
    },
    [inputFocusable],
  );

  useEffect(() => {
    if (open) {
      // Defer focus so the entrance animation has painted and the
      // gamepad registry has the input registered.
      const id = window.setTimeout(() => inputRef.current?.focus(), 60);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query]);

  if (!open) return null;

  function submit() {
    const q = query.trim();
    if (!q) {
      onClose();
      return;
    }
    navigate(`/store?q=${encodeURIComponent(q)}`);
    onClose();
  }

  return (
    <div className="bigscreen-search-overlay" role="dialog" aria-modal="true" aria-label="Search the store">
      <div className="bigscreen-search-scrim" onClick={onClose} />
      <div className="bigscreen-search-panel">
        <div className="bigscreen-search-field">
          <span className="bigscreen-search-field-icon" aria-hidden="true">
            {SearchIcon}
          </span>
          <input
            ref={setInputRef}
            className="bigscreen-search-input"
            type="text"
            placeholder="Search the store…"
            value={query}
            tabIndex={inputFocusable.tabIndex}
            role={inputFocusable.role}
            onClick={inputFocusable.onClick}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search the store"
          />
          {query && (
            <button
              type="button"
              className="bigscreen-search-clear"
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
            >
              {CloseIcon}
            </button>
          )}
        </div>

        <div className="bigscreen-search-actions">
          <button
            type="button"
            className="bigscreen-search-btn bigscreen-search-btn--primary"
            onClick={submit}
          >
            Search
          </button>
          <button
            type="button"
            className="bigscreen-search-btn"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>

        <p className="bigscreen-search-hint">
          Press <kbd>Enter</kbd> to search · <kbd>Esc</kbd> to close
        </p>
      </div>
    </div>
  );
}
