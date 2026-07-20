import { useRef, useEffect, useState } from "react";
import { useSearchSuggestions } from "../../hooks/useSearchSuggestions";
import { STORE_POPULAR_SEARCHES, type StoreGameSummary } from "../../types/game";

interface StoreSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  /** Recent queries (most-recent first) for the empty-state suggestions. */
  recentSearches?: string[];
  /** Remove a single recent search entry. */
  onRemoveRecent?: (query: string) => void;
  /** Navigate directly to a suggested game (bypasses full search). */
  onPickSuggestion?: (game: StoreGameSummary) => void;
}

export default function StoreSearchBar({
  value,
  onChange,
  visible,
  recentSearches = [],
  onRemoveRecent,
  onPickSuggestion,
}: StoreSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);

  const { suggestions, loading } = useSearchSuggestions(value);

  // Auto-focus the input when it becomes visible.
  useEffect(() => {
    if (visible && inputRef.current) {
      inputRef.current.focus();
    }
  }, [visible]);

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!focused) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [focused]);

  if (!visible) return null;

  const trimmed = value.trim();
  const showSuggestions = focused && trimmed.length >= 2;
  const showEmptyState =
    focused && trimmed.length < 2 && (recentSearches.length > 0 || STORE_POPULAR_SEARCHES.length > 0);

  return (
    <div className="store-search-bar-wrap" ref={rootRef}>
      <div className="store-search-bar">
        <svg
          className="store-search-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          className="store-search-input"
          placeholder="Search IGDB for games..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
        />
        {value && (
          <button
            className="store-search-clear"
            onClick={() => onChange("")}
            aria-label="Clear search"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {showSuggestions && (
        <div className="store-search-dropdown" role="listbox">
          {loading && suggestions.length === 0 ? (
            <div className="store-search-dropdown-loading">Searching…</div>
          ) : suggestions.length === 0 ? (
            <div className="store-search-dropdown-empty">No quick matches</div>
          ) : (
            suggestions.map((g) => (
              <button
                key={g.id}
                type="button"
                role="option"
                className="store-search-suggestion"
                onClick={() => {
                  if (onPickSuggestion) onPickSuggestion(g);
                  setFocused(false);
                }}
              >
                {g.coverUrl ? (
                  <img src={g.coverUrl} alt="" className="store-search-suggestion-thumb" />
                ) : (
                  <span className="store-search-suggestion-thumb placeholder" />
                )}
                <span className="store-search-suggestion-name">{g.name}</span>
                {g.firstReleaseDate && (
                  <span className="store-search-suggestion-year">
                    {new Date(g.firstReleaseDate).getFullYear()}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}

      {showEmptyState && (
        <div className="store-search-dropdown">
          {recentSearches.length > 0 && (
            <div className="store-search-section">
              <div className="store-search-section-title">Recent searches</div>
              {recentSearches.map((q) => (
                <div key={q} className="store-search-recent-row">
                  <button
                    type="button"
                    className="store-search-recent"
                    onClick={() => {
                      onChange(q);
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" />
                      <polyline points="12 7 12 12 15 14" />
                    </svg>
                    {q}
                  </button>
                  {onRemoveRecent && (
                    <button
                      type="button"
                      className="store-search-recent-remove"
                      onClick={() => onRemoveRecent(q)}
                      aria-label={`Remove recent search ${q}`}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="store-search-section">
            <div className="store-search-section-title">Popular searches</div>
            <div className="store-search-popular-chips">
              {STORE_POPULAR_SEARCHES.map((q) => (
                <button
                  key={q}
                  type="button"
                  className="store-search-popular-chip"
                  onClick={() => onChange(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
