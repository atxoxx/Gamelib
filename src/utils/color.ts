/**
 * Color utility — dynamic accent generation and hex/RGB helpers.
 *
 * Used by ThemeContext to auto-derive accent-adjacent colors
 * (hover, active, glow, soft) from a base accent hex so that
 * custom themes don't need to hand-tune every shade.
 */

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface AccentStates {
  base: string;
  hover: string;
  active: string;
  glow: string;
  soft: string;
}

/** Parse a 3- or 6-char hex string (with or without `#`) into RGB. */
export function hexToRgb(hex: string): RgbColor {
  let h = hex.replace("#", "");
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  const num = parseInt(h, 16);
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  };
}

/** Convert RGB object back to `#rrggbb` hex. */
export function rgbToHex({ r, g, b }: RgbColor): string {
  const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Lighten an RGB color by mixing it with white.
 * @param factor 0–1 where 0 = no change, 1 = full white.
 */
export function lighten(color: RgbColor, factor: number): RgbColor {
  const f = Math.min(1, Math.max(0, factor));
  return {
    r: color.r + (255 - color.r) * f,
    g: color.g + (255 - color.g) * f,
    b: color.b + (255 - color.b) * f,
  };
}

/**
 * Darken an RGB color by mixing it with black.
 * @param factor 0–1 where 0 = no change, 1 = full black.
 */
export function darken(color: RgbColor, factor: number): RgbColor {
  const f = Math.min(1, Math.max(0, factor));
  return {
    r: color.r * (1 - f),
    g: color.g * (1 - f),
    b: color.b * (1 - f),
  };
}

/**
 * Generate CSS-ready accent state tokens from a base hex color.
 *
 * Returns `color-mix()`-based strings for `hover`, `active`,
 * `glow`, and `soft`, which can be dropped directly into
 * CSS custom properties or inline styles.
 *
 * Also returns the base hex and an `rgb` object with
 * programmatically computed lighten/darken values for
 * canvas or dynamic style use.
 */
export function generateAccentStates(baseHex: string): {
  base: string;
  hover: string;
  active: string;
  glow: string;
  soft: string;
  /** JS-computed RGB equivalents (useful for canvas, inline style overrides). */
  js: { hover: string; active: string };
} {
  const rgb = hexToRgb(baseHex);

  return {
    base: baseHex,
    hover: `color-mix(in srgb, ${baseHex} 85%, white 15%)`,
    active: `color-mix(in srgb, ${baseHex} 70%, black 30%)`,
    glow: `color-mix(in srgb, ${baseHex} 25%, transparent)`,
    soft: `color-mix(in srgb, ${baseHex} 15%, var(--color-bg-secondary))`,
    js: {
      hover: rgbToHex(lighten(rgb, 0.15)),
      active: rgbToHex(darken(rgb, 0.3)),
    },
  };
}

/**
 * Compute relative luminance from RGB (sRGB, linearized).
 * Used for contrast-ratio calculations and determining whether
 * overlays should use light or dark text.
 */
export function luminance({ r, g, b }: RgbColor): number {
  const linearize = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
  );
}

/** WCAG AA contrast ratio between two hex colors (1–21). */
export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = luminance(hexToRgb(hex1));
  const l2 = luminance(hexToRgb(hex2));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Returns `#ffffff` or `#000000` depending on which has better
 * contrast against the given background hex.
 */
export function textColorFor(backgroundHex: string): "#ffffff" | "#000000" {
  return contrastRatio(backgroundHex, "#ffffff") >= 4.5
    ? "#ffffff"
    : "#000000";
}
