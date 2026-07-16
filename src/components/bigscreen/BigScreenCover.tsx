// BigScreenCover — cover image with running-game indicator.
//
// Used by `BigScreenSpotlight` for the large focal cover. Owns the
// running-dot overlay (previously inlined as a sibling `<span>`)
// and the placeholder fallback when the URL is missing. Custom
// placeholder icons can be supplied for distinct visual states
// (e.g. an empty library uses a monitor icon, a "no cover art for
// this game" uses a lightning bolt).

import type { ReactNode } from "react";

export interface BigScreenCoverProps {
  /** Primary image URL. `undefined` renders the placeholder. */
  url?: string;
  /** Alt text for the image. Required when `url` is set. */
  alt: string;
  /** Show a pulsing running indicator in the top-right corner. */
  isRunning?: boolean;
  /** CSS aspect-ratio string. Defaults to "16 / 9". */
  aspectRatio?: string;
  /**
   * Custom placeholder node rendered when `url` is undefined.
   * Defaults to a lightning-bolt icon (matches the previous
   * inlined behavior). Pass a different node for an empty-library
   * sentinel.
   */
  placeholderIcon?: ReactNode;
  /** Optional className passthrough. */
  className?: string;
}

const DefaultPlaceholderIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

export default function BigScreenCover({
  url,
  alt,
  isRunning = false,
  aspectRatio = "16 / 9",
  placeholderIcon = DefaultPlaceholderIcon,
  className,
}: BigScreenCoverProps) {
  return (
    <div
      className={["bigscreen-cover", className ?? ""].filter(Boolean).join(" ")}
      style={{ aspectRatio }}
    >
      {url ? (
        <img src={url} alt={alt} loading="lazy" />
      ) : (
        <div className="bigscreen-cover-placeholder">{placeholderIcon}</div>
      )}
      {isRunning ? (
        <span
          className="bigscreen-cover-running-dot"
          title="Running"
          aria-label="This game is currently running"
        />
      ) : null}
    </div>
  );
}