import type { SVGProps } from "react";

/**
 * Inline icon set for the Game page overview cards.
 *
 * All icons follow the same Feather/Solar style (24x24 viewBox,
 * 1.5px stroke, currentColor) so they read as a coherent set
 * across cards. Adding a new icon: drop a const here that mirrors
 * the prop signature below.
 *
 * Icons are designed to be visually balanced at 14-18px display
 * size — the parent component controls final sizing.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function BaseIcon({
  size = 16,
  children,
  ...props
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconPlatform({ size, ...p }: IconProps) {
  return (
    <BaseIcon size={size} {...p}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </BaseIcon>
  );
}

export function IconCheck({ size, ...p }: IconProps) {
  return (
    <BaseIcon size={size} {...p}>
      <polyline points="20 6 9 17 4 12" />
    </BaseIcon>
  );
}

export function IconX({ size, ...p }: IconProps) {
  return (
    <BaseIcon size={size} {...p}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </BaseIcon>
  );
}

export function IconClock({ size, ...p }: IconProps) {
  return (
    <BaseIcon size={size} {...p}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </BaseIcon>
  );
}

export function IconCalendar({ size, ...p }: IconProps) {
  return (
    <BaseIcon size={size} {...p}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </BaseIcon>
  );
}

export function IconHardDrive({ size, ...p }: IconProps) {
  return (
    <BaseIcon size={size} {...p}>
      <line x1="22" y1="12" x2="2" y2="12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
      <line x1="6" y1="16" x2="6.01" y2="16" />
      <line x1="10" y1="16" x2="10.01" y2="16" />
    </BaseIcon>
  );
}

export function IconUser({ size, ...p }: IconProps) {
  return (
    <BaseIcon size={size} {...p}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </BaseIcon>
  );
}

export function IconUsers({ size, ...p }: IconProps) {
  return (
    <BaseIcon size={size} {...p}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </BaseIcon>
  );
}

export function IconBuilding({ size, ...p }: IconProps) {
  return (
    <BaseIcon size={size} {...p}>
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01" />
    </BaseIcon>
  );
}

export function IconBookOpen({ size, ...p }: IconProps) {
  return (
    <BaseIcon size={size} {...p}>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </BaseIcon>
  );
}

export function IconCollection({ size, ...p }: IconProps) {
  return (
    <BaseIcon size={size} {...p}>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </BaseIcon>
  );
}

export function IconStar({ size, ...p }: IconProps) {
  return (
    <BaseIcon size={size} {...p}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </BaseIcon>
  );
}

export function IconLayers({ size, ...p }: IconProps) {
  return (
    <BaseIcon size={size} {...p}>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </BaseIcon>
  );
}

export function IconImage({ size, ...p }: IconProps) {
  return (
    <BaseIcon size={size} {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </BaseIcon>
  );
}

export function IconVideo({ size, ...p }: IconProps) {
  return (
    <BaseIcon size={size} {...p}>
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" />
    </BaseIcon>
  );
}

export function IconFileText({ size, ...p }: IconProps) {
  return (
    <BaseIcon size={size} {...p}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </BaseIcon>
  );
}

export function IconLink({ size, ...p }: IconProps) {
  return (
    <BaseIcon size={size} {...p}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </BaseIcon>
  );
}

export function IconShield({ size, ...p }: IconProps) {
  return (
    <BaseIcon size={size} {...p}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </BaseIcon>
  );
}

export function IconGlobe({ size, ...p }: IconProps) {
  return (
    <BaseIcon size={size} {...p}>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </BaseIcon>
  );
}

export function IconTrendUp({ size, ...p }: IconProps) {
  return (
    <BaseIcon size={size} {...p}>
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </BaseIcon>
  );
}

export function IconInfo({ size, ...p }: IconProps) {
  return (
    <BaseIcon size={size} {...p}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </BaseIcon>
  );
}

export function IconPlay({ size, ...p }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      {...p}
    >
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

export function IconDownload({ size, ...p }: IconProps) {
  return (
    <BaseIcon size={size} {...p}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </BaseIcon>
  );
}

export function IconTag({ size, ...p }: IconProps) {
  return (
    <BaseIcon size={size} {...p}>
      <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </BaseIcon>
  );
}

/**
 * Folder glyph used by the executable-path click target inside the
 * InfoKpiCard. Paired with IconExternalLink to nudge the user toward
 * "click to open in OS file manager" rather than "click to launch".
 */
export function IconFolder({ size, ...p }: IconProps) {
  return (
    <BaseIcon size={size} {...p}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </BaseIcon>
  );
}

/**
 * External-link arrow (northeast). Slides into view on hover behind
 * the path text to telegraph "this leaves the app" without forcing
 * the user to read a label.
 */
export function IconExternalLink({ size, ...p }: IconProps) {
  return (
    <BaseIcon size={size} {...p}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </BaseIcon>
  );
}
