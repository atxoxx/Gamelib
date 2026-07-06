import type { SortKey } from "./utils";

interface Props {
  value: SortKey;
  onChange: (next: SortKey) => void;
}

// Pure dropdown. The StoragePage owns the active sort key; this
// component is presentational and re-uses the same option labels
// everywhere (Phase-5 spec requirement: Largest first is the locked
// default; dropdown exposes Name / Platform / Last detected).
export function StorageSortSelect({ value, onChange }: Props) {
  return (
    <label className="storage__sort">
      <span className="storage__sort-label">Sort by</span>
      <select
        className="storage__sort-select"
        value={value}
        onChange={(e) => onChange(e.target.value as SortKey)}
      >
        <option value="size:desc">Size: Largest first</option>
        <option value="name:asc">Name (A {"->"} Z)</option>
        <option value="platform:asc">Platform</option>
        <option value="detectedAt:desc">Last detected</option>
      </select>
    </label>
  );
}
