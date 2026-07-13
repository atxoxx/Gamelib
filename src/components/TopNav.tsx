import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useActiveDownloadCount } from "../context/DownloadContext";
import WindowControls from "./WindowControls";

/**
 * Mouse-event guard: an interactive element is anything the user
 * would EXPECT to receive their own click without the title-bar
 * doing something else. Buttons, links (NavLinks render `<a>`),
 * elements that are tagged as buttons via ARIA, and form fields
 * all qualify. If a double-click lands inside one of these we
 * don't toggle maximize — the user is interacting with that
 * control, not the empty drag region. Anchor matching collapses
 * the whole interactive subtree (e.g. a tab icon inside the
 * `<a>`) without us having to touch the SVG `<line>` it contains.
 */
function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  // "no-drag" on the children stops a window-drag from starting,
  // but onDoubleClick still bubbles — so we still want this guard
  // for any future control. "a[href]" (vs just "a") keeps hover-only
  // anchors without `href` from blocking the user; role="tab/menuitem"
  // covers ARIA-tagged controls; contenteditable="true" covers any
  // future rich-text editor embedded in the chrome; the rest are the
  // straight DOM form/control tags.
  return target.closest(
    'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [contenteditable="true"], input, select, textarea'
  ) !== null;
}

function LibraryIcon() {
  return (
    <svg
      className="topnav-tab-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function StoreIcon() {
  return (
    <svg
      className="topnav-tab-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  );
}

function CommunityIcon() {
  return (
    <svg
      className="topnav-tab-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      className="topnav-tab-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function PluginsIcon() {
  return (
    <svg
      className="topnav-tab-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

interface Tab {
  path: string;
  label: string;
  icon: React.ReactNode;
}

function ActivityIcon() {
  return (
    <svg
      className="topnav-tab-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function WishlistIcon() {
  return (
    <svg
      className="topnav-tab-icon"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function DealsIcon() {
  // Tag-with-down-arrow icon: a price tag with an inward-pointing
  // arrow, signaling "discount/deal" at a glance. Matches the inline
  // icon style used by every other tab in this file.
  return (
    <svg
      className="topnav-tab-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 7h-3a2 2 0 0 1-2-2V3" />
      <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" />
      <path d="M9 7H4a2 2 0 0 0-2 2v1" />
      <path d="M14 14l-3 3-3-3" />
      <path d="M11 17V7" />
    </svg>
  );
}

function StorageIcon() {
  // Hard-drive icon: a rectangular drive with a small activity dot,
  // mirroring the inline icon style of every other tab in this file.
  return (
    <svg
      className="topnav-tab-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="22" y1="12" x2="2" y2="12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
      <line x1="6" y1="16" x2="6.01" y2="16" />
      <line x1="10" y1="16" x2="10.01" y2="16" />
    </svg>
  );
}

function NewsIcon() {
  return (
    <svg
      className="topnav-tab-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 11a9 9 0 0 1 9 9" />
      <path d="M4 4a16 16 0 0 1 16 16" />
      <circle cx="5" cy="19" r="1" />
    </svg>
  );
}

function DownloadIcon() {
  // Down-into-tray icon, matches the inline icon style of every
  // other tab button in this file.
  return (
    <svg
      className="topnav-tab-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function AchievementsIcon() {
  return (
    <svg
      className="topnav-tab-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="8" r="6" />
      <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
    </svg>
  );
}

function MoreDotsIcon() {
  // Three horizontal dots — the universal "more options" affordance.
  // Rendered as filled discs (overriding the SVG's stroked defaults
  // via the .topnav-more-icon CSS rule) so the affordance reads as
  // a "menu/dots" cue that matches the chevron next to it.
  return (
    <svg
      className="topnav-more-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      className="topnav-more-chevron"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// ── Tab grouping ────────────────────────────────────────────────────────
//
// When this app grew past the 5-tab sweet spot, we started hitting
// diminishing returns on cognitive overload — 11 primary tabs forced
// the user to mentally rank against every other destination before
// clicking anything. We split into two tiers:
//
//   • **primaryTabs** (6): the user-facing surfaces that map to a
//     primary action — Library (own), Store (browse), Activity
//     (history), Wishlist (intent), Deals (browse-with-price),
//     Community (discover). All are reachable in one click from
//     any other page.
//   • **moreTabs** (5): utility/status surfaces used less often —
//     Downloads, Storage, News, Achievements, Plugins. Reachable via
//     the "More" button + dropdown.
//
// Both tiers share the same `.topnav-tab` styling inline and the
// `.topnav-more-menu-item` styling (mirror of the inline tab) for
// the dropdown items, so the affordance reads identically between
// surfaces and a muscle-memory hop from Library to Storage takes
// the same amount of time.
const primaryTabs: Tab[] = [
  { path: "/library", label: "Library", icon: <LibraryIcon /> },
  { path: "/store", label: "Store", icon: <StoreIcon /> },
  { path: "/activity", label: "Activity", icon: <ActivityIcon /> },
  { path: "/wishlist", label: "Wishlist", icon: <WishlistIcon /> },
  { path: "/deals", label: "Deals", icon: <DealsIcon /> },
  { path: "/community", label: "Community", icon: <CommunityIcon /> },
];

const moreTabs: Tab[] = [
  { path: "/downloads", label: "Downloads", icon: <DownloadIcon /> },
  { path: "/storage", label: "Storage", icon: <StorageIcon /> },
  { path: "/news", label: "News", icon: <NewsIcon /> },
  { path: "/achievements", label: "Achievements", icon: <AchievementsIcon /> },
  { path: "/plugins", label: "Plugins", icon: <PluginsIcon /> },
];

export default function TopNav() {
  const activeDownloads = useActiveDownloadCount();
  const location = useLocation();

  // More-menu open state. Trigger button and dropdown are siblings
  // inside .topnav-more-wrapper so the dropdown can self-position
  // absolutely below the button via the wrapper's `position: relative`.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const moreId = useId();

  // Highlight the More button when ANY of its contained tabs is the
  // current route — this keeps the active indicator consistent with
  // the inline-tab treatment so muscle-memory navigation works
  // identically whether the destination is inline or behind More.
  const isMoreTabActive = moreTabs.some((tab) =>
    location.pathname.startsWith(tab.path),
  );

  // Click outside + Escape close the More menu. Both handlers are
  // attached only while `moreOpen` is true so we don't accumulate
  // listeners across navigations. The Escape handler restores focus
  // to the trigger button so keyboard users don't get stranded.
  //
  // Renders the menu only while open (rather than mounting then
  // `display:none`-ing) — this matches the DownloadPopover pattern
  // and avoids paying animation cost for a dropdown that's hidden.
  // We use `globalThis.MouseEvent` to disambiguate from React's
  // imported `MouseEvent` (the titlebar handler imports React's
  // form for the JSX event type).
  useEffect(() => {
    if (!moreOpen) return;
    const onMouseDown = (e: globalThis.MouseEvent) => {
      const target = e.target as Node | null;
      const inMenu = moreMenuRef.current?.contains(target ?? null);
      const inTrigger = moreBtnRef.current?.contains(target ?? null);
      if (!inMenu && !inTrigger) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMoreOpen(false);
        moreBtnRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  // Close More when the route changes — a NavLink click should not
  // leave the dropdown floating after navigation. Doing this in an
  // effect rather than inline-onClick means route changes from
  // outside (back/forward, programmatic nav) also collapse the menu.
  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  // Double-click the drag region → toggle maximize. This restores
  // the standard Windows title-bar behavior that
  // `decorations: false` removes.
  //
  // We listen on the topnav <nav> itself (the only DOM element
  // with the entire drag region) so a user double-clicking the
  // empty space between tabs and the window controls gets the
  // expected "grow to fullscreen" gesture. The handler skips
  // events whose target is inside an interactive child — the
  // `-webkit-app-region: no-drag` rule on those children stops
  // a *drag* from starting, but `onDoubleClick` still bubbles, so
  // without this filter a double-click on a tab would both fire
  // navigate and toggle maximize.
  const handleTitleBarDoubleClick = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      if (isInteractiveTarget(e.target)) return;
      // `.catch(() => {})` swallows the "no Tauri bridge" rejection
      // during `npm run dev` so an unhandled-rejection warning doesn't
      // clutter the dev console. The verbs here are OS-level only and
      // throw identically when the bridge is absent, so swallowing is
      // the right trade-off. (For app-side actions we surface failures
      // via ToastContext.) Memoized so the handler reference stays
      // stable across renders.
      getCurrentWindow().toggleMaximize().catch(() => {});
    },
    [],
  );

  return (
    <nav
      className="topnav"
      aria-label="Main navigation"
      onDoubleClick={handleTitleBarDoubleClick}
    >
      <div className="topnav-left">
        <div className="topnav-logo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          Gamelib
        </div>

        {/*
          The primary tabs sit inside `.topnav-tabs` (with
          `role="tablist"`) so screen readers and keyboard users
          can navigate them as a tab group. The More wrapper that
          follows is a SIBLING of `.topnav-tabs`, not a child —
          putting it inside the tablist would violate the ARIA
          spec, which requires every direct child of a tablist to
          have `role="tab"`, and would also let long tab lists
          scroll the More button off-screen. Sibling positioning
          keeps More anchored next to the strip on every window
          width. */}
        <div className="topnav-tabs" role="tablist">
          {primaryTabs.map((tab) => {
            const isActive = location.pathname.startsWith(tab.path);
            return (
              <NavLink
                key={tab.path}
                to={tab.path}
                className={`topnav-tab hover-lift${isActive ? " active" : ""}`}
                aria-current={isActive ? "page" : undefined}
                role="tab"
                aria-selected={isActive ? "true" : "false"}
              >
                {tab.icon}
                {tab.label}
              </NavLink>
            );
          })}
        </div>

        {/* More button + dropdown. Sibling of `.topnav-tabs` (see
         *  the comment block above for the ARIA/sibling-positioning
         *  rationale). Active state highlights whenever any
         *  contained tab is the current route, so the user always
         *  knows they're "in" the More group from the chrome
         *  alone. The active-downloads count lifts onto this
         *  button next to the label so users still see the
         *  live-status signal even though the former downloads
         *  popover was demoted into regular navigation as part
         *  of the IA consolidation. */}
        <div className="topnav-more-wrapper">
          <button
            ref={moreBtnRef}
            type="button"
            className={`topnav-more hover-lift${isMoreTabActive ? " active" : ""}`}
            onClick={() => setMoreOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            aria-controls={moreId}
            title="More navigation"
          >
            <span className="topnav-more-label-row">
              <MoreDotsIcon />
              <span>More</span>
              {activeDownloads > 0 && (
                <span
                  className="topnav-more-badge-inline"
                  role="status"
                  aria-label={`${activeDownloads} active downloads`}
                >
                  {activeDownloads}
                </span>
              )}
            </span>
            <ChevronDownIcon />
          </button>
          {moreOpen && (
            <div
              id={moreId}
              className="topnav-more-menu"
              ref={moreMenuRef}
              role="menu"
              aria-label="More navigation"
            >
              {moreTabs.map((tab) => {
                const isActive = location.pathname.startsWith(tab.path);
                return (
                  <NavLink
                    key={tab.path}
                    to={tab.path}
                    className={`topnav-more-menu-item${isActive ? " active" : ""}`}
                    role="menuitem"
                    aria-current={isActive ? "page" : undefined}
                  >
                    <span className="topnav-more-menu-icon">
                      {tab.icon}
                    </span>
                    <span className="topnav-more-menu-label">
                      {tab.label}
                    </span>
                    {tab.path === "/downloads" && activeDownloads > 0 && (
                      <span className="topnav-more-menu-count">
                        {activeDownloads}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right cluster: bundles .topnav-right (page actions:
       *  settings) and .topnav-window-chrome (min/max/close + the
       *  vertical divider). We render them inside a single flex
       *  unit because the parent `.topnav` uses
       *  `justify-content: space-between` and would otherwise
       *  distribute equal space on both sides of the middle child,
       *  pushing .topnav-right into the geometric center of the
       *  topnav on wide windows (large empty gap between settings
       *  and the divider). With the cluster wrapper, .topnav has
       *  only two children — `.topnav-left` on the left, this
       *  cluster on the right — and the inner members stay flush
       *  regardless of window width.
       *
       *  Note: the previous Downloads popover+button lived here.
       *  It moved into the "More" dropdown as part of the IA
       *  consolidation; users navigate to /downloads for the
       *  full live UI, and the active-downloads count is surfaced
       *  on the More button itself so the live signal is
       *  preserved. See the primaryTabs/moreTabs comment above
       *  for the full reasoning. */}
      <div className="topnav-right-cluster">
        {/* Page actions live on the far right (system-style
         *  actions like Settings). Icon-only so they don't
         *  compete with the primary nav for attention. The
         *  Settings button uses NavLink so the "active"
         *  treatment matches the regular tabs. */}
        <div className="topnav-right">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `topnav-btn topnav-btn-settings${isActive ? " active" : ""}`
            }
            aria-label="Settings"
            title="Settings"
          >
            <SettingsIcon />
          </NavLink>
        </div>

        {/* Custom window controls (min / max / close) — see
         *  `./WindowControls.tsx` for the implementation. They live
         *  INSIDE `.topnav-right-cluster` so the divider on
         *  `.topnav-window-chrome`'s left edge renders flush against
         *  the settings cog, no wide-window drift to the geometric
         *  center of the row. */}
        <div className="topnav-window-chrome">
          <WindowControls />
        </div>
      </div>
    </nav>
  );
}
