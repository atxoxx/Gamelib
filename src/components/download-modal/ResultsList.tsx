import type { SortKey, DisplayMatch } from "./types";
import { ResultRow } from "./ResultRow";

export function ResultsList({
  matches,
  selectedId,
  onSelect,
  showWeakMatches,
  onToggleWeak,
  isDownloaded,
  sortBy,
  onSortChange,
}: {
  matches: DisplayMatch[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  showWeakMatches: boolean;
  onToggleWeak: () => void;
  isDownloaded: (title: string) => boolean;
  sortBy: SortKey;
  onSortChange: (sortBy: SortKey) => void;
}) {
  if (matches.length === 0) {
    return (
      <div className="dl-results-empty">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <p>No matches found in your sources</p>
        <p className="dl-results-empty-hint">
          Add more sources in <strong>Settings → Download Sources</strong>, or
          verify that one of your enabled sources actually lists this game. The
          expected JSON format is <code>{`{ title, fileSize, uris }`}</code>.
        </p>
      </div>
    );
  }

  // Keep the high-confidence matches (>= 0.4) always visible; collapse
  // the weaker ones behind a toggle so a wall of "Possible" results
  // doesn't bury the good hit. `realIndex` maps back into `matches`.
  const visible = matches
    .map((match, realIndex) => ({ match, realIndex }))
    .filter(({ match }) => showWeakMatches || match.matchScore >= 0.4);
  const weakCount = matches.filter((m) => m.matchScore < 0.4).length;

  return (
    <div>
      <div className="dl-results-header">
        <span className="dl-results-header-title">Sources</span>
        <label className="dl-sort">
          <span className="dl-sort-label">Sort</span>
          <select
            className="dl-sort-select"
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value as SortKey)}
            aria-label="Sort results"
          >
            <option value="date">Date (newest)</option>
            <option value="source">Source</option>
            <option value="relevance">Relevance</option>
          </select>
        </label>
      </div>

      <div className="dl-results-list">
        {visible.map(({ match, realIndex }) => (
          <ResultRow
            key={match.id ?? `${match.sourceId}-${realIndex}`}
            match={match}
            selected={selectedId === (match.id ?? null)}
            onSelect={onSelect}
            isDownloaded={isDownloaded}
          />
        ))}
      </div>

      {weakCount > 0 && (
        <button
          type="button"
          className="dl-toggle-weak"
          onClick={onToggleWeak}
          aria-expanded={showWeakMatches}
        >
          {showWeakMatches
            ? "Hide weaker matches"
            : `Show ${weakCount} weaker match${weakCount !== 1 ? "es" : ""}`}
        </button>
      )}
    </div>
  );
}
