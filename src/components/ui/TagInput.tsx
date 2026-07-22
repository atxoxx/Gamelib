import { useState, useRef, type KeyboardEvent } from "react";

interface TagInputProps {
  id?: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** Optional pool of suggestions to surface as quick-add chips. */
  suggestions?: string[];
  ariaLabel?: string;
}

/**
 * Accessible chip editor: type a value and press Enter or comma to add it,
 * click the × (or press Backspace on an empty field) to remove the last one.
 * Replaces the old comma-separated text inputs for list-style fields.
 */
export function TagInput({
  id,
  value,
  onChange,
  placeholder,
  suggestions = [],
  ariaLabel,
}: TagInputProps) {
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addToken = (raw: string) => {
    const token = raw.trim();
    if (!token) return;
    if (value.some((v) => v.toLowerCase() === token.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...value, token]);
    setDraft("");
  };

  const removeAt = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addToken(draft);
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      e.preventDefault();
      removeAt(value.length - 1);
    }
  };

  const available = suggestions
    .filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()))
    .slice(0, 8);

  return (
    <div className={`tag-input${focused ? " is-focused" : ""}`}>
      <div
        className="tag-input-field"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag, i) => (
          <span key={`${tag}-${i}`} className="tag-chip">
            <span className="tag-chip-label">{tag}</span>
            <button
              type="button"
              className="tag-chip-remove"
              aria-label={`Remove ${tag}`}
              onClick={(e) => {
                e.stopPropagation();
                removeAt(i);
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          className="tag-input-control"
          type="text"
          value={draft}
          placeholder={value.length === 0 ? placeholder : ""}
          aria-label={ariaLabel}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setFocused(false);
            if (draft.trim()) addToken(draft);
          }}
          onFocus={() => setFocused(true)}
        />
      </div>
      {focused && available.length > 0 && (
        <div className="tag-input-suggestions">
          {available.map((s) => (
            <button
              key={s}
              type="button"
              className="tag-suggestion"
              onClick={() => addToken(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
