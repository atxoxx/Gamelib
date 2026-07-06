// Self-contained "Download" trigger + modal.
//
// Renders a button that opens a `DownloadModal` on click. Owns its
// own open/close state so callers don't have to manage modal
// plumbing themselves — they just drop in `<DownloadButton
// gameName={…} gameId={…} />` next to their existing actions.
//
// The button has two visual variants:
//
//   * "default" — neutral outline button, sits next to "Launch Game"
//                  in the GamePage hero
//   * "prominent" — accent-tinted button, used as the primary CTA
//                  on a not-yet-added StoreGameDetail card

import { useState, type CSSProperties } from "react";
import DownloadModal from "./DownloadModal";

export interface DownloadButtonProps {
  gameName: string;
  gameId?: string;
  steamAppId?: number;
  /** Visual style. Default = "default". */
  variant?: "default" | "prominent";
  /** Optional label override. Default = "Download". */
  label?: string;
  /** Extra inline style. Useful for grid placement. */
  style?: CSSProperties;
  /** Optional className. */
  className?: string;
}

export default function DownloadButton({
  gameName,
  gameId,
  steamAppId,
  variant = "default",
  label = "Download",
  style,
  className,
}: DownloadButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={`game-download-btn game-download-btn--${variant}${className ? ` ${className}` : ""}`}
        onClick={() => setOpen(true)}
        style={style}
        title="Find a download source"
        aria-label="Open download sources"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        {label}
      </button>
      {open && (
        <DownloadModal
          gameName={gameName}
          gameId={gameId}
          steamAppId={steamAppId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
