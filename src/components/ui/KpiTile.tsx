import type { HTMLAttributes, ReactNode } from "react";

/**
 * KpiTile — single-metric dashboard tile used across the Game page
 * overview (info card hero stats, ratings, time-to-beat, etc.).
 *
 * Anatomy:
 *   ┌─────────────────────────────┐
 *   │  [icon]  LABEL        ▢  │  ← header (muted, uppercase)
 *   │                             │
 *   │      85%                    │  ← value (big, intent-tinted)
 *   │  1,247 reviews              │  ← subtext (muted)
 *   │  [▓▓▓▓▓▓▓▓░░░]              │  ← optional footer (bar / sparkline)
 *   └─────────────────────────────┘
 *
 * Variants:
 *   - `size="sm"` : compact (used in dense grids like 3-col Time to Beat)
 *   - `size="md"` : default (most overview cards)
 *   - `size="lg"` : hero stat (used on the hero overlay)
 *
 * Intents:
 *   - `default` : neutral text
 *   - `accent`  : brand accent
 *   - `success` : positive (high rating, completed)
 *   - `warning` : mid (mixed reviews, on hold)
 *   - `danger`  : negative (low rating, abandoned)
 *
 * All values tint via the existing semantic tokens so every theme
 * (dark/light/nord/cyberpunk/emerald/dracula) gets a sensible
 * color without bespoke CSS per tile.
 */

type KpiSize = "sm" | "md" | "lg";
type KpiIntent = "default" | "accent" | "success" | "warning" | "danger" | "info";

export interface KpiTileProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Small uppercase label rendered in the header row. */
  label: ReactNode;
  /** The headline value (number, status, label). Renders big. */
  value: ReactNode;
  /** Optional subtext shown below the value. */
  subtext?: ReactNode;
  /** Optional leading icon (rendered next to the label). */
  icon?: ReactNode;
  /** Optional trailing element in the header (e.g. a badge, a chevron). */
  trailing?: ReactNode;
  /** Optional footer content (bar, sparkline, trend). */
  footer?: ReactNode;
  /** Tints the value text and any accent-colored child. */
  intent?: KpiIntent;
  /** Tile size; controls padding and font scale. */
  size?: KpiSize;
  /** Glass variant — translucent, blurs whatever sits behind it
   *  (useful when overlaying the hero banner). */
  glass?: boolean;
  /** Optional content above the header (e.g. a small chart). */
  topSlot?: ReactNode;
}

const intentClass: Record<KpiIntent, string> = {
  default: "kpi-tile--intent-default",
  accent: "kpi-tile--intent-accent",
  success: "kpi-tile--intent-success",
  warning: "kpi-tile--intent-warning",
  danger: "kpi-tile--intent-danger",
  info: "kpi-tile--intent-info",
};

const sizeClass: Record<KpiSize, string> = {
  sm: "kpi-tile--sm",
  md: "kpi-tile--md",
  lg: "kpi-tile--lg",
};

export function KpiTile({
  label,
  value,
  subtext,
  icon,
  trailing,
  footer,
  intent = "default",
  size = "md",
  glass = false,
  topSlot,
  className,
  ...props
}: KpiTileProps) {
  return (
    <div
      className={[
        "kpi-tile",
        intentClass[intent],
        sizeClass[size],
        glass ? "kpi-tile--glass" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {topSlot && <div className="kpi-tile__top">{topSlot}</div>}
      <div className="kpi-tile__header">
        <span className="kpi-tile__label">
          {icon && <span className="kpi-tile__icon" aria-hidden>{icon}</span>}
          {label}
        </span>
        {trailing && <span className="kpi-tile__trailing">{trailing}</span>}
      </div>
      <div className="kpi-tile__value">{value}</div>
      {subtext && <div className="kpi-tile__subtext">{subtext}</div>}
      {footer && <div className="kpi-tile__footer">{footer}</div>}
    </div>
  );
}
