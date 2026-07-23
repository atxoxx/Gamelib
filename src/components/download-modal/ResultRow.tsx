import type { DisplayMatch } from "./types";

export function ResultRow({
  match,
  selected,
  onSelect,
  isDownloaded,
}: {
  match: DisplayMatch;
  selected: boolean;
  onSelect: (id: string) => void;
  isDownloaded: (title: string) => boolean;
}) {
  const score = match.matchScore;
  const scoreLabel =
    score >= 0.8 ? "High match" : score >= 0.4 ? "Partial match" : "Possible";

  return (
    <button
      type="button"
      className={`dl-result-row${selected ? " selected" : ""}`}
      onClick={() => onSelect(match.id)}
      aria-pressed={selected}
    >
      <div className="dl-result-info">
        <div className="dl-result-title">
          <span className="dl-result-title-text">{match.title}</span>
          <span className="dl-result-badges">
            {match.isNew && (
              <span className="dl-badge dl-badge-new" title="Newly added source">
                NEW
              </span>
            )}
            {isDownloaded(match.title) && (
              <span className="dl-badge dl-badge-downloaded" title="Already downloaded">
                Downloaded
              </span>
            )}
          </span>
        </div>
        <div className="dl-result-meta">
          <span className="dl-result-source">{match.sourceName}</span>
          <span>·</span>
          <span>{match.fileSize || "Unknown size"}</span>
          {match.uploadDate && (
            <>
              <span>·</span>
              <span>{match.uploadDate}</span>
            </>
          )}
          <span className={`dl-result-score ${score >= 0.8 ? "high" : ""}`}>
            {scoreLabel} ({(score * 100).toFixed(0)}%)
          </span>
        </div>
      </div>
      <div className="dl-result-actions" aria-hidden>
        {selected ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ width: 18, height: 18 }}
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ width: 18, height: 18, opacity: 0.4 }}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        )}
      </div>
    </button>
  );
}
