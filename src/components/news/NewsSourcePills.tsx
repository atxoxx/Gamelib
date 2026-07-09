interface NewsSourcePillsProps {
  sourceNames: string[];
  activeSource: string | null;
  articleCount: number;
  onSourceChange: (source: string | null) => void;
}

export default function NewsSourcePills({
  sourceNames,
  activeSource,
  articleCount,
  onSourceChange,
}: NewsSourcePillsProps) {
  if (sourceNames.length === 0) return null;

  return (
    <div className="news-source-pills" role="tablist" aria-label="Filter by news source">
      <button
        type="button"
        role="tab"
        aria-selected={activeSource === null}
        className={`news-source-pill all-pill${activeSource === null ? " active" : ""}`}
        onClick={() => onSourceChange(null)}
      >
        All
        <span className="news-source-pill-count">{articleCount}</span>
      </button>

      {sourceNames.map((name) => (
        <button
          key={name}
          type="button"
          role="tab"
          aria-selected={activeSource === name}
          className={`news-source-pill${activeSource === name ? " active" : ""}`}
          onClick={() =>
            onSourceChange(activeSource === name ? null : name)
          }
        >
          {name}
        </button>
      ))}
    </div>
  );
}
