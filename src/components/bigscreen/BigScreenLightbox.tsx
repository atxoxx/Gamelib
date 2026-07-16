// BigScreenLightbox — portal-based fullscreen preview overlay.
//
// Used by `BigScreenGamePage` for screenshot / video preview. Renders
// nothing when `src` is `null`. Click-outside-the-frame dismisses
// the preview; click-on-the-frame swallows propagation so users
// can interact with the media without dismissing.
//
// Decoupled from the page-level `<ScreenshotsSection>` so future
// callers (e.g. a future Wishlist detail view) can reuse the same
// preview surface without re-implementing the modal pattern.

import { createPortal } from "react-dom";
import { isVideoUrl } from "./bigscreenFormat";

export interface BigScreenLightboxProps {
  /** URL of the image / video to preview. `null` = closed. */
  src: string | null;
  /** Invoked when the user dismisses the preview. */
  onClose: () => void;
  /** Accessible label for the dialog. Defaults to "Preview". */
  ariaLabel?: string;
}

export default function BigScreenLightbox({
  src,
  onClose,
  ariaLabel = "Preview",
}: BigScreenLightboxProps) {
  if (typeof document === "undefined") return null;
  if (!src) return null;

  return createPortal(
    <div
      className="bigscreen-lightbox-mask"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={onClose}
    >
      {/* Inner frame swallows click-propagation so a click on the
       *  media itself doesn't dismiss the preview. */}
      <div
        className="bigscreen-lightbox-frame"
        onClick={(e) => e.stopPropagation()}
      >
        {isVideoUrl(src) ? (
          <video src={src} controls autoPlay />
        ) : (
          <img
            src={src}
            alt="Fullscreen preview"
            style={{
              maxWidth: "100%",
              maxHeight: "85vh",
              objectFit: "contain",
              display: "block",
            }}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}