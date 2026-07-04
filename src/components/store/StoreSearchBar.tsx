import { useRef, useEffect } from "react";

interface StoreSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
}

export default function StoreSearchBar({
  value,
  onChange,
  visible,
}: StoreSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the input when it becomes visible
  useEffect(() => {
    if (visible && inputRef.current) {
      inputRef.current.focus();
    }
  }, [visible]);

  if (!visible) return null;

  return (
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
  );
}
