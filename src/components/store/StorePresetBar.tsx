import { useState } from "react";
import type { StoreFilterPreset } from "../../types/game";

interface StorePresetBarProps {
  presets: StoreFilterPreset[];
  /** True when there is a live filter combination worth saving. */
  canSave: boolean;
  onApply: (id: string) => void;
  onRemove: (id: string) => void;
  onSave: (name: string) => void;
}

/**
 * StorePresetBar: a compact strip of saved filter presets plus a
 * "Save current" action. Lets power users snapshot and restore a full
 * browse configuration (facets + sources + sort) in one click.
 */
export default function StorePresetBar({
  presets,
  canSave,
  onApply,
  onRemove,
  onSave,
}: StorePresetBarProps) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  const commit = () => {
    const trimmed = name.trim();
    if (trimmed) onSave(trimmed);
    setName("");
    setNaming(false);
  };

  if (presets.length === 0 && !canSave) return null;

  return (
    <div className="store-preset-bar" aria-label="Filter presets">
      <span className="store-preset-bar-label">Presets:</span>

      {presets.map((p) => (
        <span key={p.id} className="store-preset-chip">
          <button
            type="button"
            className="store-preset-chip-apply"
            onClick={() => onApply(p.id)}
            title={`Apply preset "${p.name}"`}
          >
            {p.name}
          </button>
          <button
            type="button"
            className="store-preset-chip-remove"
            onClick={() => onRemove(p.id)}
            aria-label={`Delete preset ${p.name}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </span>
      ))}

      {naming ? (
        <span className="store-preset-namer">
          <input
            autoFocus
            type="text"
            className="store-preset-name-input"
            placeholder="Preset name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setName("");
                setNaming(false);
              }
            }}
          />
          <button type="button" className="store-preset-save-confirm" onClick={commit}>
            Save
          </button>
        </span>
      ) : (
        canSave && (
          <button
            type="button"
            className="store-preset-save"
            onClick={() => setNaming(true)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            Save current
          </button>
        )
      )}
    </div>
  );
}
