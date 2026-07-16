// BigScreenNav — PS5-inspired bottom navigation bar for Big Screen
// Mode. Displays all tabs as horizontally-scrollable icon buttons
// with a glass background, top-edge accent glow bar, and controller
// focus support via the shared GamepadProvider context.
//
// Navigation uses react-router-dom's useNavigate() for clean,
// direct routing rather than DOM querySelector tricks. Bumpers
// (LB / RB) cycle through tabs directly via the GamepadProvider's
// tab-cycler registration so users can hop tabs without having to
// spatially navigate the full bar.
//
// As of PR 1, this file uses the leaner `useGamepad()` hook (was
// `useGamepadCtx`) and the new `useFocusable` hook (was the inline
// `makeFocusable` factory that recreated closures per render).

import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useGamepad } from "../hooks/GamepadProvider";
import { useFocusable } from "../hooks/useFocusable";
import { useEffect } from "react";

// ── Tab icons ──────────────────────────────────────────────────

function StoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function WishlistIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function DealsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 7h-3a2 2 0 0 1-2-2V3" />
      <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" />
      <path d="M9 7H4a2 2 0 0 0-2 2v1" />
      <path d="M14 14l-3 3-3-3" />
      <path d="M11 17V7" />
    </svg>
  );
}

function ActivityIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function AchievementsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="6" />
      <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function StorageIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="12" x2="2" y2="12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
      <line x1="6" y1="16" x2="6.01" y2="16" />
      <line x1="10" y1="16" x2="10.01" y2="16" />
    </svg>
  );
}

function NewsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 11a9 9 0 0 1 9 9" />
      <path d="M4 4a16 16 0 0 1 16 16" />
      <circle cx="5" cy="19" r="1" />
    </svg>
  );
}

function CommunityIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function PluginsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

interface BigScreenTab {
  path: string;
  label: string;
  icon: React.ReactNode;
}

const tabs: BigScreenTab[] = [
  { path: "/store", label: "Store", icon: <StoreIcon /> },
  { path: "/library", label: "Library", icon: <LibraryIcon /> },
  { path: "/wishlist", label: "Wishlist", icon: <WishlistIcon /> },
  { path: "/deals", label: "Deals", icon: <DealsIcon /> },
  { path: "/activity", label: "Activity", icon: <ActivityIcon /> },
  { path: "/achievements", label: "Achievements", icon: <AchievementsIcon /> },
  { path: "/downloads", label: "Downloads", icon: <DownloadIcon /> },
  { path: "/storage", label: "Storage", icon: <StorageIcon /> },
  { path: "/news", label: "News", icon: <NewsIcon /> },
  { path: "/community", label: "Community", icon: <CommunityIcon /> },
  { path: "/plugins", label: "Plugins", icon: <PluginsIcon /> },
  { path: "/settings", label: "Settings", icon: <SettingsIcon /> },
];

/**
 * Single tab renderer. Kept as a small component so each tab can
 * call `useFocusable()` with its own stable ref callback — the
 * alternative (mapping over tabs in the parent and spreading the
 * same factory result) would force a per-render ref churn.
 */
function BigScreenNavTab({
  tab,
  active,
  onActivate,
}: {
  tab: BigScreenTab;
  active: boolean;
  onActivate: () => void;
}) {
  const focusable = useFocusable(onActivate);
  return (
    <NavLink
      to={tab.path}
      className={`bigscreen-nav-tab${active ? " active" : ""}`}
      {...focusable}
      aria-label={tab.label}
    >
      <span className="bigscreen-nav-tab-icon">{tab.icon}</span>
      <span className="bigscreen-nav-tab-label">{tab.label}</span>
    </NavLink>
  );
}

export default function BigScreenNav() {
  const gamepad = useGamepad();
  const navigate = useNavigate();
  const location = useLocation();

  // ── LB / RB: cycle tabs directly ─────────────────────────────
  // Bumpers skip the spatial-nav scan and jump straight to the next
  // / previous tab in declared order. Wrap-around so RB past the
  // last tab returns to the first (the bottom-nav is a one-dimensional
  // list — wrap is more intuitive than end-stop). Updates `location`
  // via `navigate()` so the BigScreenNav's active-indicator
  // re-renders against the new route.
  useEffect(() => {
    return gamepad.registerTabCycler((direction) => {
      const currentIndex = tabs.findIndex((t) =>
        location.pathname.startsWith(t.path),
      );
      const baseIndex = currentIndex < 0 ? 0 : currentIndex;
      const nextIndex =
        direction === "forward"
          ? (baseIndex + 1) % tabs.length
          : (baseIndex - 1 + tabs.length) % tabs.length;
      navigate(tabs[nextIndex].path);
    });
  }, [gamepad, location.pathname, navigate]);

  return (
    <nav className="bigscreen-nav" role="navigation" aria-label="Main navigation">
      <div className="bigscreen-nav-glow" />
      <div className="bigscreen-nav-tabs">
        {tabs.map((tab) => {
          const isActive = location.pathname.startsWith(tab.path);
          return (
            <BigScreenNavTab
              key={tab.path}
              tab={tab}
              active={isActive}
              onActivate={() => navigate(tab.path)}
            />
          );
        })}
      </div>
    </nav>
  );
}