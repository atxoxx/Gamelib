import { Button } from "../ui";

/**
 * Save-path selector. Shows the picked folder (+ a preview of the
 * game-nested subfolder the engine will actually write into) and a
 * "Change" button that opens the native folder picker.
 */
export function SavePathPicker({
  savePath,
  gameName,
  onPickPath,
}: {
  savePath: string | null;
  gameName: string;
  onPickPath: () => void;
}) {
  const safeGameFolder = gameName.replace(/[:*?"<>|\\/]/g, "").trim();
  const nested = savePath ? `${savePath}/${safeGameFolder}` : null;

  return (
    <div className="dl-save-path">
      <svg
        className="dl-save-path-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
      <span className={`dl-save-path-text${savePath ? "" : " placeholder"}`} title={savePath ?? ""}>
        {savePath ?? "No folder selected — pick where the download will be saved"}
      </span>
      <Button variant="secondary" size="sm" onClick={onPickPath}>
        {savePath ? "Change" : "Choose…"}
      </Button>
      {nested && (
        <span className="dl-save-path-nested" title={nested}>
          → {safeGameFolder}
        </span>
      )}
    </div>
  );
}
