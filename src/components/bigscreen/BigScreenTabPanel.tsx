// BigScreenTabPanel — per-tab scroll container.
//
// Why not a render-prop / children-as-function
// ────────────────────────────────────────────
// The component owns its own scroll state and absolutely-positioned
// inactive state. Children are plain JSX so the parent can pass any
// existing section component (`<ScreenshotsSection game={game} />`,
// etc.) without wrapping it.
//
// Inactive-vs-active architecture
// ────────────────────────────────
// The CSS (see bigscreen.css) gives inactive panels
//   position: absolute; inset: 0; opacity: 0; pointer-events: none;
// and active panels
//   position: relative; opacity: 1; pointer-events: auto;
// Both states set `overflow-y: auto` so scrolling within a tab is
// preserved across tab switches (inactive panels aren't unmounted).
// The relative-positioned active panel owns the layout box so the
// scroll-region parent has correct height.
//
// Accessibility
// ─────────────
// • `role="tabpanel"` ties the panel to the corresponding tab in
//   the `BigScreenTabBar` (linked via `id` / `aria-labelledby`).
// • `aria-hidden={!isActive}` hides inactive panels from screen
//   readers — they're still in the DOM for scroll preservation but
//   not announced.
// • `data-tab-id` is a JS-readable mirror of `aria-labelledby`'s
//   suffix; consumers can use it for focus-restoration logic in
//   Phase 5 polish.

import type { ReactNode } from "react";

export interface BigScreenTabPanelProps {
  /** Unique tab id matching the `TabDef<T>.id` used in the TabBar. */
  tabId: string;
  /** The currently active tab id. Compared against `tabId`. */
  activeTab: string;
  /** Panel content. Renders whether or not the panel is active so
   *  scroll position is preserved across tab switches. */
  children: ReactNode;
  /** Optional className passthrough for context-specific tweaks. */
  className?: string;
}

export default function BigScreenTabPanel({
  tabId,
  activeTab,
  children,
  className,
}: BigScreenTabPanelProps) {
  const isActive = activeTab === tabId;
  return (
    <div
      role="tabpanel"
      id={`bigscreen-tabpanel-${tabId}`}
      aria-labelledby={`bigscreen-tab-${tabId}`}
      aria-hidden={!isActive}
      data-tab-id={tabId}
      data-active={isActive ? "true" : "false"}
      className={[
        "bigscreen-tab-panel",
        isActive ? "active" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}