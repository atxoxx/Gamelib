// BigScreenMetaStrip — flex-wrap row of BigScreenPill instances.
//
// Owns no game data and renders no semantic structure of its own —
// callers wrap it in a `<section aria-label="...">` if the strip
// needs structural meaning. (BigScreenGamePage wraps it; the
// Library Spotlight uses it without the section because the
// surrounding section already provides the landmark.)

import type { ReactNode } from "react";

export interface BigScreenMetaStripProps {
  children: ReactNode;
  /** Optional className passthrough. */
  className?: string;
  /** Optional inline style passthrough. */
  style?: React.CSSProperties;
  /** Accessible label for the surrounding strip (e.g. "Game metadata"). */
  ariaLabel?: string;
}

export default function BigScreenMetaStrip({
  children,
  className,
  style,
  ariaLabel,
}: BigScreenMetaStripProps) {
  return (
    <div
      className={["bigscreen-meta-strip", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      style={style}
      role="group"
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
}