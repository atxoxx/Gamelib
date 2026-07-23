/**
 * Download options card: auto-extract toggle and (for torrents) the
 * "choose files" toggle. Grouped into a single tidy surface so the
 * main flow stays focused on picking a source.
 */
export function OptionsSection({
  autoExtract,
  onAutoExtract,
  chooseFiles,
  onChooseFiles,
  isDirect,
}: {
  autoExtract: boolean;
  onAutoExtract: (v: boolean) => void;
  chooseFiles: boolean;
  onChooseFiles: (v: boolean) => void;
  isDirect: boolean;
}) {
  return (
    <div className="dl-options-card">
      <div className="dl-options-card-title">Options</div>

      <label className="dl-switch-row">
        <span className="dl-switch-label">
          Auto extract archives and delete after extraction
        </span>
        <span className="dl-switch">
          <input
            type="checkbox"
            checked={autoExtract}
            onChange={(e) => onAutoExtract(e.target.checked)}
          />
          <span className="dl-switch-track" aria-hidden>
            <span className="dl-switch-thumb" />
          </span>
        </span>
      </label>

      {!isDirect && (
        <label className="dl-switch-row">
          <span className="dl-switch-label">Choose files to download</span>
          <span className="dl-switch">
            <input
              type="checkbox"
              checked={chooseFiles}
              onChange={(e) => onChooseFiles(e.target.checked)}
            />
            <span className="dl-switch-track" aria-hidden>
              <span className="dl-switch-thumb" />
            </span>
          </span>
        </label>
      )}
    </div>
  );
}
