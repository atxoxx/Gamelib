// Reusable screenshot/video thumbnail for the Community > Screenshots tab.
// Handles: favorite (star) toggle, video badge + <video> preview, lightbox
// open, and image error fallback. Used by both the Steam-grouped accordion
// and the flat manual-folder gallery so behavior stays consistent.

import { useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

const ImageIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
);

interface ScreenshotThumbProps {
  path: string;
  index: number;
  gameName: string;
  isFavorite: boolean;
  onToggleFavorite: (path: string) => void;
  onOpen: (index: number) => void;
}

export function ScreenshotThumb({
  path,
  index,
  gameName,
  isFavorite,
  onToggleFavorite,
  onOpen,
}: ScreenshotThumbProps) {
  const [failed, setFailed] = useState(false);
  const video = path.toLowerCase().endsWith(".mp4") ||
    path.toLowerCase().endsWith(".webm") ||
    path.toLowerCase().endsWith(".mov") ||
    path.toLowerCase().endsWith(".mkv");

  return (
    <div
      className="community-screenshot-thumb"
      onClick={() => onOpen(index)}
      role="button"
      tabIndex={0}
      aria-label={`${gameName} ${video ? "clip" : "screenshot"} ${index + 1}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(index);
        }
      }}
    >
      {!failed ? (
        video ? (
          <video
            src={convertFileSrc(path)}
            muted
            preload="metadata"
            onError={() => setFailed(true)}
          />
        ) : (
          <img
            src={convertFileSrc(path)}
            alt={`${gameName} ${index + 1}`}
            loading="lazy"
            onError={(e) => {
              const img = e.currentTarget;
              if (img.dataset.fallbackTried === "1") {
                setFailed(true);
                return;
              }
              img.dataset.fallbackTried = "1";
              invoke<string>("read_cover_image", { filePath: path })
                .then((dataUrl) => {
                  img.src = dataUrl;
                })
                .catch(() => setFailed(true));
            }}
          />
        )
      ) : (
        <div className="community-screenshot-fallback">{ImageIcon}</div>
      )}

      {video && !failed && (
        <span className="community-thumb-badge community-thumb-video">▶ Clip</span>
      )}

      <button
        type="button"
        className={`community-thumb-fav${isFavorite ? " active" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(path);
        }}
        aria-label={isFavorite ? "Remove favorite" : "Add favorite"}
        title={isFavorite ? "Remove favorite" : "Add favorite"}
      >
        {isFavorite ? "★" : "☆"}
      </button>
    </div>
  );
}
