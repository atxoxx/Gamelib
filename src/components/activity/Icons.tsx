// Lightweight inline SVG icons for the Activity tab. Kept as named exports
// so callers can `import * as Icons from "./Icons"` and pick what they
// need. Each icon accepts the standard `size` prop (defaults to 13 to
// match the rest of the tab UI) and an optional `className` for theming.

import type { SVGProps } from "react";

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  /** Icon edge length in pixels. Defaults to 13 to match the tab UI density. */
  size?: number;
}

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function withDefaults(p: IconProps) {
  const { size = 13, className, ...rest } = p;
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    className,
    "aria-hidden": true,
    ...rest,
  };
}

export function LayoutDashboard({ size, className, ...rest }: IconProps) {
  return (
    <svg {...withDefaults({ size, className, ...rest })}>
      <rect x="3" y="3" width="7" height="9" />
      <rect x="14" y="3" width="7" height="5" />
      <rect x="14" y="12" width="7" height="9" />
      <rect x="3" y="16" width="7" height="5" />
    </svg>
  );
}

export function GanttChart({ size, className, ...rest }: IconProps) {
  return (
    <svg {...withDefaults({ size, className, ...rest })}>
      <rect x="3" y="4" width="18" height="3" rx="1" />
      <rect x="3" y="10" width="12" height="3" rx="1" />
      <rect x="3" y="16" width="16" height="3" rx="1" />
    </svg>
  );
}

export function History({ size, className, ...rest }: IconProps) {
  return (
    <svg {...withDefaults({ size, className, ...rest })}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" {...STROKE} />
      <polyline points="3 3 3 8 8 8" {...STROKE} />
      <polyline points="12 7 12 12 16 14" {...STROKE} />
    </svg>
  );
}

export function BarChart3({ size, className, ...rest }: IconProps) {
  return (
    <svg {...withDefaults({ size, className, ...rest })}>
      <path d="M3 3v18h18" {...STROKE} />
      <rect x="7" y="12" width="3" height="6" />
      <rect x="12" y="8" width="3" height="10" />
      <rect x="17" y="5" width="3" height="13" />
    </svg>
  );
}

export function Camera({ size, className, ...rest }: IconProps) {
  return (
    <svg {...withDefaults({ size, className, ...rest })}>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" {...STROKE} />
      <circle cx="12" cy="13" r="4" {...STROKE} />
    </svg>
  );
}

export function Download({ size, className, ...rest }: IconProps) {
  return (
    <svg {...withDefaults({ size, className, ...rest })}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" {...STROKE} />
      <polyline points="7 10 12 15 17 10" {...STROKE} />
      <line x1="12" y1="15" x2="12" y2="3" {...STROKE} />
    </svg>
  );
}

export function Filter({ size, className, ...rest }: IconProps) {
  return (
    <svg {...withDefaults({ size, className, ...rest })}>
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" {...STROKE} />
    </svg>
  );
}

export function TrendingUp({ size, className, ...rest }: IconProps) {
  return (
    <svg {...withDefaults({ size, className, ...rest })}>
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" {...STROKE} />
      <polyline points="17 6 23 6 23 12" {...STROKE} />
    </svg>
  );
}

export function Search({ size, className, ...rest }: IconProps) {
  return (
    <svg {...withDefaults({ size, className, ...rest })}>
      <circle cx="11" cy="11" r="8" {...STROKE} />
      <line x1="21" y1="21" x2="16.65" y2="16.65" {...STROKE} />
    </svg>
  );
}

export function ChevronDown({ size, className, ...rest }: IconProps) {
  return (
    <svg {...withDefaults({ size, className, ...rest })}>
      <polyline points="6 9 12 15 18 9" {...STROKE} />
    </svg>
  );
}

export function Trash({ size, className, ...rest }: IconProps) {
  return (
    <svg {...withDefaults({ size, className, ...rest })}>
      <polyline points="3 6 5 6 21 6" {...STROKE} />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" {...STROKE} />
    </svg>
  );
}

export function Cpu({ size, className, ...rest }: IconProps) {
  return (
    <svg {...withDefaults({ size, className, ...rest })}>
      <rect x="4" y="4" width="16" height="16" rx="2" {...STROKE} />
      <rect x="9" y="9" width="6" height="6" {...STROKE} />
      <line x1="9" y1="2" x2="9" y2="4" {...STROKE} />
      <line x1="15" y1="2" x2="15" y2="4" {...STROKE} />
      <line x1="9" y1="20" x2="9" y2="22" {...STROKE} />
      <line x1="15" y1="20" x2="15" y2="22" {...STROKE} />
      <line x1="20" y1="9" x2="22" y2="9" {...STROKE} />
      <line x1="20" y1="14" x2="22" y2="14" {...STROKE} />
      <line x1="2" y1="9" x2="4" y2="9" {...STROKE} />
      <line x1="2" y1="14" x2="4" y2="14" {...STROKE} />
    </svg>
  );
}

export function Gauge({ size, className, ...rest }: IconProps) {
  return (
    <svg {...withDefaults({ size, className, ...rest })}>
      <path d="M12 14l4-4" {...STROKE} />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" {...STROKE} />
    </svg>
  );
}

export function Activity({ size, className, ...rest }: IconProps) {
  return (
    <svg {...withDefaults({ size, className, ...rest })}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" {...STROKE} />
    </svg>
  );
}

export function Thermometer({ size, className, ...rest }: IconProps) {
  return (
    <svg {...withDefaults({ size, className, ...rest })}>
      <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" {...STROKE} />
    </svg>
  );
}

export function MemoryStick({ size, className, ...rest }: IconProps) {
  return (
    <svg {...withDefaults({ size, className, ...rest })}>
      <rect x="2" y="6" width="14" height="12" rx="1" {...STROKE} />
      <line x1="6" y1="6" x2="6" y2="18" {...STROKE} />
      <line x1="10" y1="6" x2="10" y2="18" {...STROKE} />
      <path d="M16 9h4v6h-4z" {...STROKE} />
      <line x1="20" y1="11" x2="20" y2="13" {...STROKE} />
    </svg>
  );
}
