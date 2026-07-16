// BigScreenPill — single status / metadata pill used by the
// Big Screen hero (Game page meta strip) and the Library Spotlight.
//
// Extracted from inline JSX that previously duplicated between
// `BigScreenSpotlight.tsx` and `BigScreenGamePage.tsx`. The two
// call sites had slightly different sizes (Spotlight is compact,
// Game page is the larger "TV reading distance" variant), so the
// `size` prop keeps both behaviors without unifying the visuals.

import type { ReactNode } from "react";

export type BigScreenPillTone =
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "muted"
  | "info";

export type BigScreenPillSize = "sm" | "md";

export interface BigScreenPillProps {
  /**
   * Predefined tone token — maps to a CSS class that uses the
   * theme's accent / success / warning / danger / muted / info
   * variables for background + border + text. Pick this when you
   * have a known semantic color (e.g. "Ready to play" → success).
   */
  tone?: BigScreenPillTone;
  /**
   * Custom hex / rgb / hsl color string for dynamic tones (e.g.
   * `PLAY_STATUS_DETAILS[game.playStatus].color`). When set,
   * `tone` is ignored and `color-mix` is used to tint the
   * background + border off this color.
   */
  customColor?: string;
  /**
   * Visual size. "sm" matches the compact Spotlight pills
   * (4 × 10 padding, 13 px font), "md" matches the Game page meta
   * strip (6 × 14 padding, 14 px font). Defaults to "md".
   */
  size?: BigScreenPillSize;
  /**
   * Show a small filled dot in the tone color, left of the label.
   * Used by the "Running" and play-status pills.
   */
  dot?: boolean;
  /**
   * Small leading icon (clock, star, platform glyph, etc.).
   * Sits in a fixed-width slot to the left of the label so
   * pill heights stay consistent.
   */
  icon?: ReactNode;
  /** Pill label. */
  children: ReactNode;
  /** Optional className passthrough for context-specific tweaks. */
  className?: string;
}

/**
 * Render a pill. When `customColor` is set, the background and
 * border are tinted off that color (mirroring the previous inline
 * `color-mix(... 18% / 35%)` math). When `tone` is set, the CSS
 * class handles theming. When `dot` is true and `customColor` is
 * provided, the dot picks up that color too (otherwise it falls
 * through to currentColor).
 */
export default function BigScreenPill({
  tone = "accent",
  customColor,
  size = "md",
  dot = false,
  icon,
  children,
  className,
}: BigScreenPillProps) {
  const toneClass = customColor ? "" : `bigscreen-pill--${tone}`;
  const sizeClass = `bigscreen-pill--${size}`;
  const dotStyle = customColor ? { background: customColor } : undefined;
  const toneStyle = customColor
    ? {
        background: `color-mix(in srgb, ${customColor} 18%, transparent)`,
        color: customColor,
        borderColor: `color-mix(in srgb, ${customColor} 35%, transparent)`,
      }
    : undefined;

  return (
    <span
      className={[
        "bigscreen-pill",
        sizeClass,
        toneClass,
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={toneStyle}
    >
      {icon ? (
        <span className="bigscreen-pill-icon" aria-hidden>
          {icon}
        </span>
      ) : null}
      {dot ? (
        <span
          className="bigscreen-pill-dot"
          style={dotStyle}
          aria-hidden
        />
      ) : null}
      <span className="bigscreen-pill-label">{children}</span>
    </span>
  );
}