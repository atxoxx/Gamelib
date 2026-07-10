import type { ReactNode } from "react";

interface StatCardProps {
  /** Big numeric or formatted value displayed prominently. */
  value: string | number;
  /** Short label below the value (e.g. "Total Games"). */
  label: string;
  /** Optional small caption below the label (e.g. "75% of library"). */
  subtext?: string;
  /** Icon rendered inside a circular badge above the value. */
  icon: ReactNode;
  /** Accent color variant — drives the icon-badge tint. */
  tone?: "accent" | "success" | "info" | "warning";
  /** Stagger delay (ms) for the entry animation; pass 0 for the first card. */
  delayMs?: number;
}

/**
 * Single glassmorphism stat tile rendered inside the library hero.
 * Designed to look at home next to the existing theme tokens — the
 * backdrop-filter + subtle top border creates the modern "PS5 / Apple"
 * glass rim highlight without competing with the page content.
 *
 * Layout (horizontal strip): [icon] [value, flex:1] [label / subtext
 * column, right-aligned]. Reading top-to-bottom isn't possible any
 * more — the row reads left-to-right instead, with the value as the
 * visual anchor next to the icon and the label/subtext parked on the
 * trailing edge. The CSS for `.library-stat-card` enforces the row
 * direction; the `.library-stat-card-text` wrapper exists because the
 * label + optional subtext need to share an alignment side WITHOUT
 * sitting inline with the value (otherwise long values collide with
 * long labels on narrow viewports).
 *
 * The `tone` prop swaps the icon badge hue (the default accent color
 * is fine for most stats; success/info/warning let us semantically
 * differentiate cards like "Installed" (success) vs "Recently Added"
 * (info) without hardcoding colors.
 */
export default function StatCard({
  value,
  label,
  subtext,
  icon,
  tone = "accent",
  delayMs = 0,
}: StatCardProps) {
  return (
    <div
      className={`library-stat-card library-stat-card--${tone}`}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="library-stat-card-icon">{icon}</div>
      <div className="library-stat-card-value" title={String(value)}>{value}</div>
      <div className="library-stat-card-text">
        <div className="library-stat-card-label">{label}</div>
        {subtext && <div className="library-stat-card-subtext">{subtext}</div>}
      </div>
    </div>
  );
}
