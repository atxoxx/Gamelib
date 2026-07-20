import type { StoreGameSummary } from "../../types/game";

interface StoreCompareTrayProps {
  games: StoreGameSummary[];
  onRemove: (slug: string) => void;
  onClear: () => void;
  onOpen: () => void;
}

/**
 * StoreCompareTray: a docked strip showing the games the user has pinned
 * for comparison (max 3). Clicking "Compare" opens the side-by-side modal.
 */
export default function StoreCompareTray({
  games,
  onRemove,
  onClear,
  onOpen,
}: StoreCompareTrayProps) {
  if (games.length === 0) return null;

  return (
    <div className="store-compare-tray" role="region" aria-label="Compare tray">
      <span className="store-compare-tray-label">Compare ({games.length}/3)</span>
      <div className="store-compare-tray-items">
        {games.map((g) => (
          <span key={g.slug} className="store-compare-chip" title={g.name}>
            {g.coverUrl && (
              <img src={g.coverUrl} alt="" className="store-compare-chip-thumb" />
            )}
            <span className="store-compare-chip-name">{g.name}</span>
            <button
              type="button"
              className="store-compare-chip-remove"
              onClick={() => onRemove(g.slug)}
              aria-label={`Remove ${g.name} from compare`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </span>
        ))}
      </div>
      <div className="store-compare-tray-actions">
        <button
          type="button"
          className="store-compare-open"
          onClick={onOpen}
          disabled={games.length < 2}
        >
          Compare
        </button>
        <button type="button" className="store-compare-clear" onClick={onClear}>
          Clear
        </button>
      </div>
    </div>
  );
}
