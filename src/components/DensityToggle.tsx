import type { ReactNode } from "react";
import type { ViewDensity } from "../types/game";

interface DensityToggleProps {
  density: ViewDensity;
  onChange: (density: ViewDensity) => void;
  /** Optional className for the outer container. */
  className?: string;
}

interface DensityOption {
  value: ViewDensity;
  ariaLabel: string;
  /** Inline SVG icon. */
  icon: ReactNode;
}

const OPTIONS: DensityOption[] = [
  {
    value: "compact",
    ariaLabel: "Compact card density",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <rect x="3" y="3" width="7" height="7" rx="1.2" />
        <rect x="14" y="3" width="7" height="7" rx="1.2" />
        <rect x="3" y="14" width="7" height="7" rx="1.2" />
        <rect x="14" y="14" width="7" height="7" rx="1.2" />
      </svg>
    ),
  },
  {
    value: "cozy",
    ariaLabel: "Cozy card density (default)",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="8" height="11" rx="1.2" />
        <rect x="13" y="3" width="8" height="11" rx="1.2" />
        <rect x="3" y="16" width="8" height="5" rx="1" />
        <rect x="13" y="16" width="8" height="5" rx="1" />
      </svg>
    ),
  },
  {
    value: "cinematic",
    ariaLabel: "Cinematic card density (large)",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <rect x="2" y="4" width="20" height="14" rx="2" />
      </svg>
    ),
  },
  {
    value: "list",
    ariaLabel: "List view with small preview",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <rect x="3" y="4" width="6" height="6" rx="1" />
        <line x1="12" y1="6" x2="21" y2="6" />
        <line x1="12" y1="9" x2="21" y2="9" />
        <rect x="3" y="14" width="6" height="6" rx="1" />
        <line x1="12" y1="16" x2="21" y2="16" />
        <line x1="12" y1="19" x2="21" y2="19" />
      </svg>
    ),
  },
];

/**
 * DensityToggle: segmented 3-button control that switches the Store page
 * card layout between Compact, Cozy, and Cinematic.
 *
 * Plays a radio role so screen readers announce the group state. The
 * currently active button is highlighted via accent color.
 */
export default function DensityToggle({
  density,
  onChange,
  className,
}: DensityToggleProps) {
  return (
    <div
      className={`store-density-toggle${className ? " " + className : ""}`}
      role="radiogroup"
      aria-label="Store card density"
    >
      {OPTIONS.map((opt) => {
        const active = density === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={opt.ariaLabel}
            title={opt.ariaLabel}
            className={`store-density-btn${active ? " active" : ""}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.icon}
          </button>
        );
      })}
    </div>
  );
}
