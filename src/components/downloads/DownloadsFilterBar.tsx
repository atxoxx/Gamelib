// Search / status-filter / sort bar for the Downloads page.
//
// Sits above the Active section (next to the bulk-action toolbar)
// and lets the user narrow a large download list. All state is
// controlled by the parent (DownloadsPage) so the same query and
// sort apply consistently to both the Active and History lists.
//
// The status pills use coarse, human-meaningful buckets (see
// `matchesStatusFilter` in types/download.ts) rather than raw
// `DownloadStatus.kind` values, so "Downloading" also surfaces
// queued / fetching-metadata downloads that the user thinks of as
// "in progress".

import type {
  DownloadSort,
  DownloadStatusFilter,
} from "../../types/download";

interface StatusPill {
  value: DownloadStatusFilter;
  label: string;
  count: number;
}

interface DownloadsFilterBarProps {
  query: string;
  onQueryChange: (value: string) => void;
  statusFilter: DownloadStatusFilter;
  onStatusFilterChange: (value: DownloadStatusFilter) => void;
  sort: DownloadSort;
  onSortChange: (value: DownloadSort) => void;
  /** Per-bucket counts, used to render the pill badges. */
  counts: Record<DownloadStatusFilter, number>;
}

const SORT_OPTIONS: { value: DownloadSort; label: string }[] = [
  { value: "added-desc", label: "Newest first" },
  { value: "added-asc", label: "Oldest first" },
  { value: "name-asc", label: "Name (A–Z)" },
  { value: "size-desc", label: "Largest first" },
  { value: "progress-desc", label: "Most complete" },
  { value: "speed-desc", label: "Fastest first" },
];

export default function DownloadsFilterBar({
  query,
  onQueryChange,
  statusFilter,
  onStatusFilterChange,
  sort,
  onSortChange,
  counts,
}: DownloadsFilterBarProps) {
  const pills: StatusPill[] = [
    { value: "all", label: "All", count: counts.all },
    { value: "downloading", label: "Active", count: counts.downloading },
    { value: "paused", label: "Paused", count: counts.paused },
    { value: "completed", label: "Completed", count: counts.completed },
    { value: "error", label: "Errored", count: counts.error },
  ];

  return (
    <div className="dl-filters" role="search">
      <div className="dl-filters-search">
        <svg
          className="dl-filters-search-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          className="dl-filters-search-input"
          type="text"
          placeholder="Search downloads…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          aria-label="Search downloads by name or source"
        />
        {query && (
          <button
            className="dl-filters-search-clear"
            onClick={() => onQueryChange("")}
            aria-label="Clear search"
            title="Clear search"
            type="button"
          >
            ×
          </button>
        )}
      </div>

      <div
        className="dl-filters-pills"
        role="group"
        aria-label="Filter downloads by status"
      >
        {pills.map((pill) => (
          <button
            key={pill.value}
            type="button"
            className={`dl-filters-pill${statusFilter === pill.value ? " active" : ""}`}
            onClick={() => onStatusFilterChange(pill.value)}
            aria-pressed={statusFilter === pill.value}
          >
            {pill.label}
            {pill.count > 0 && (
              <span className="dl-filters-pill-count">{pill.count}</span>
            )}
          </button>
        ))}
      </div>

      <div className="dl-filters-sort">
        <label className="dl-filters-sort-label" htmlFor="dl-sort-select">
          Sort
        </label>
        <select
          id="dl-sort-select"
          className="dl-filters-sort-select"
          value={sort}
          onChange={(e) => onSortChange(e.target.value as DownloadSort)}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
