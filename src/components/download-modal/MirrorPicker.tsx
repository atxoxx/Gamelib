import { hostLabelForUri } from "./helpers";

/**
 * Mirror / hoster selector. Renders each mirror URI as a compact,
 * scannable hostname chip (e.g. "mega.nz", "1fichier.com") instead
 * of a raw-URI dropdown, so the user can compare sources at a glance.
 * Hidden entirely when there is only one mirror.
 */
export function MirrorPicker({
  uris,
  selectedMirrorIdx,
  onChange,
}: {
  uris: string[];
  selectedMirrorIdx: number;
  onChange: (idx: number) => void;
}) {
  if (uris.length <= 1) return null;

  return (
    <div className="dl-mirror-chips" role="radiogroup" aria-label="Select mirror or hoster">
      {uris.map((uri, idx) => {
        const hoster = hostLabelForUri(uri, idx);
        const selected = idx === selectedMirrorIdx;
        return (
          <button
            key={idx}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`dl-mirror-chip${selected ? " selected" : ""}`}
            onClick={() => onChange(idx)}
            title={uri}
          >
            {hoster}
          </button>
        );
      })}
    </div>
  );
}
