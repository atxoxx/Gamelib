interface EditImageSlotProps {
  label: string;
  subtitle: string;
  imageUrl: string;
  previewSize: { w: number; h: number };
  isFetching: boolean;
  onChooseFile: () => void;
  onFetchWeb: () => void;
  onRemove: () => void;
}

/** Reusable image slot used in the Edit Game modal's Media tab. */
export function EditImageSlot({
  label,
  subtitle,
  imageUrl,
  previewSize,
  isFetching,
  onChooseFile,
  onFetchWeb,
  onRemove,
}: EditImageSlotProps) {
  return (
    <div className="edit-image-slot">
      <div className="edit-image-slot-header">
        <span className="edit-image-slot-label">{label}</span>
        <span className="edit-image-slot-subtitle">{subtitle}</span>
      </div>
      <div
        className="edit-image-slot-preview"
        style={{ width: previewSize.w, height: previewSize.h }}
      >
        {imageUrl ? (
          <img src={imageUrl} alt={label} />
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            opacity={0.2}
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        )}
      </div>
      <div className="edit-image-slot-actions">
        <button
          className="game-edit-btn edit-img-btn"
          onClick={onChooseFile}
          type="button"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          File
        </button>
        <button
          className="game-edit-btn edit-img-btn edit-img-fetch"
          onClick={onFetchWeb}
          type="button"
          disabled={isFetching}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          {isFetching ? "..." : "Fetch"}
        </button>
        {imageUrl && (
          <button
            className="game-edit-btn edit-img-btn edit-img-remove"
            onClick={onRemove}
            type="button"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
