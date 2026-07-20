// BigScreenTabBar — generic horizontal tab bar with LB/RB bumper
// hints, used as the tab navigation surface in PS5-style tabbed
// Game pages (Overview | Media | Specs | More).
//
// Why generic
// ───────────
// The same component powers the Big Screen Game page's tabs and
// (later) any other tabbed surface (Wishlist detail, Store detail).
// Each consumer defines its own tab id literal union, and the
// bar's `activeTab` + `onActivate` callbacks preserve end-to-end
// type safety — no stringly-typed `onActivate: (id: string)` casts
// at the call site.
//
// Accessibility
// ─────────────
// • `role="tablist"` on the container.
// • Each tab is `<button role="tab" aria-selected={isActive}>`.
// • A single `aria-label` describes the entire tablist (defaults to
//   "Tabs"). Individual tabs are labelled by their visible label.
// • Decorative LB/RB hints are `aria-hidden` so screen readers
//   don't announce "left bumper right bumper" on every focus move.
//
// Visual design
// ─────────────
// • Sticky horizontal flex row, sits directly below the hero.
// • Active tab gets an accent color + a 3px bottom indicator dot.
// • Focused tab (gamepad D-pad nav) gets the global focus ring
//   stroke (3px, themed via `--bigscreen-focus-ring-stroke`).
// • LB/RB chevron icons are decorative pseudo-elements on the
//   container — purely visual affordances; the actual input
//   handling is via `useGamepad().registerTabCycler` in the parent.
//   (PR 2's nav-tab scroller chevron precedent lives next door.)

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useFocusable } from "../../hooks/useFocusable";

export interface TabDef<T extends string> {
  /** Stable id used for `activeTab` + `onActivate` discrimination. */
  id: T;
  /** Visible label, rendered inside the tab button. */
  label: string;
  /** Optional leading icon (16-20 px SVG recommended). */
  icon?: ReactNode;
}

export interface BigScreenTabBarProps<T extends string> {
  tabs: TabDef<T>[];
  activeTab: T;
  /** Invoked when a tab is activated (click / A button on focused). */
  onActivate: (id: T) => void;
  /** Accessible label for the tablist. Defaults to "Tabs". */
  ariaLabel?: string;
  /** Optional className passthrough for context-specific tweaks. */
  className?: string;
}

export default function BigScreenTabBar<T extends string>({
  tabs,
  activeTab,
  onActivate,
  ariaLabel = "Tabs",
  className,
}: BigScreenTabBarProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const activeEl = containerRef.current.querySelector(
      `#bigscreen-tab-${activeTab}`
    ) as HTMLElement | null;
    if (activeEl) {
      activeEl.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  }, [activeTab]);

  return (
    <div
      ref={containerRef}
      className={["bigscreen-tab-bar", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      role="tablist"
      aria-label={ariaLabel}
    >
      {/* Decorative LB chevron — visual affordance only. */}
      <span className="bigscreen-tab-bar-bumper bigscreen-tab-bar-bumper--lb" aria-hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <span>LB</span>
      </span>

      <div className="bigscreen-tab-bar-tabs">
        {tabs.map((tab) => (
          <BigScreenTabBarButton
            key={tab.id}
            tab={tab}
            isActive={activeTab === tab.id}
            onActivate={() => onActivate(tab.id)}
          />
        ))}
      </div>

      {/* Decorative RB chevron — visual affordance only. */}
      <span className="bigscreen-tab-bar-bumper bigscreen-tab-bar-bumper--rb" aria-hidden>
        <span>RB</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </span>
    </div>
  );
}

function BigScreenTabBarButton<T extends string>({
  tab,
  isActive,
  onActivate,
}: {
  tab: TabDef<T>;
  isActive: boolean;
  onActivate: () => void;
}) {
  // useFocusable reads the latest onActivate via a ref so the
  // parent's stale-closure footgun is eliminated. We destructure
  // rather than spreading so we can override the default "button"
  // role with role="tab" — spreading would TS-error on the
  // duplicate-key warning even though the later value wins.
  const { ref, tabIndex, onClick } = useFocusable(onActivate);
  return (
    <button
      type="button"
      role="tab"
      id={`bigscreen-tab-${tab.id}`}
      aria-selected={isActive}
      aria-controls={`bigscreen-tabpanel-${tab.id}`}
      ref={ref}
      tabIndex={tabIndex}
      onClick={onClick}
      className={["bigscreen-tab-bar-tab", isActive ? "active" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      {tab.icon ? (
        <span className="bigscreen-tab-bar-tab-icon" aria-hidden>
          {tab.icon}
        </span>
      ) : null}
      <span className="bigscreen-tab-bar-tab-label">{tab.label}</span>
    </button>
  );
}