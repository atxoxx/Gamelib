import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useGamepad } from "../hooks/GamepadProvider";
import { useFocusable } from "../hooks/useFocusable";
import { useBigScreen } from "../hooks/useBigScreen";

// ── Icons ────────────────────────────────────────────────────────

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function StoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function PowerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
      <line x1="12" y1="2" x2="12" y2="12" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

// ── Tabs Definition ──────────────────────────────────────────────

interface HeaderTab {
  path: string;
  label: string;
  icon: React.ReactNode;
}

const tabs: HeaderTab[] = [
  { path: "/activity", label: "Home", icon: <HomeIcon /> },
  { path: "/library", label: "Library", icon: <LibraryIcon /> },
  { path: "/store", label: "Store", icon: <StoreIcon /> },
  { path: "/settings", label: "System", icon: <SettingsIcon /> },
];

export function getActiveTabPath(pathname: string): string {
  if (pathname.startsWith("/library")) return "/library";
  if (
    pathname.startsWith("/store") ||
    pathname.startsWith("/deals") ||
    pathname.startsWith("/wishlist")
  ) {
    return "/store";
  }
  if (
    pathname.startsWith("/settings") ||
    pathname.startsWith("/storage") ||
    pathname.startsWith("/downloads") ||
    pathname.startsWith("/achievements")
  ) {
    return "/settings";
  }
  return "/activity"; // Default to Home
}

function HeaderTabItem({
  tab,
  active,
  onActivate,
}: {
  tab: HeaderTab;
  active: boolean;
  onActivate: () => void;
}) {
  const focusable = useFocusable(onActivate);
  return (
    <NavLink
      to={tab.path}
      className={`bigscreen-header-tab ${active ? "active" : ""}`}
      {...focusable}
      aria-label={tab.label}
      title={tab.label}
    >
      <span className="bigscreen-header-tab-icon">{tab.icon}</span>
      <span className="bigscreen-header-tab-label">{tab.label}</span>
    </NavLink>
  );
}

export default function BigScreenHeader({
  onOpenSearch,
}: {
  onOpenSearch?: () => void;
}) {
  const gamepad = useGamepad();
  const navigate = useNavigate();
  const location = useLocation();
  const { setBigScreen } = useBigScreen();

  const [timeString, setTimeString] = useState("");

  // Live clock
  useEffect(() => {
    const updateTime = () => {
      const d = new Date();
      setTimeString(
        d.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000 * 30);
    return () => clearInterval(interval);
  }, []);

  // LB / RB: Cycle main tabs
  useEffect(() => {
    return gamepad.registerTabCycler((direction) => {
      const activePath = getActiveTabPath(location.pathname);
      const currentIndex = tabs.findIndex((t) => t.path === activePath);
      const baseIndex = currentIndex < 0 ? 0 : currentIndex;
      const nextIndex =
        direction === "forward"
          ? (baseIndex + 1) % tabs.length
          : (baseIndex - 1 + tabs.length) % tabs.length;
      navigate(tabs[nextIndex].path);
    });
  }, [gamepad, location.pathname, navigate]);

  const handleExit = () => {
    setBigScreen(false);
  };

  const focusableExit = useFocusable(handleExit);
  const focusableSearch = useFocusable(() => onOpenSearch?.());

  return (
    <header className="bigscreen-header" role="banner">
      <div className="bigscreen-header-left">
        {/* Brand */}
        <div className="bigscreen-header-logo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
            <polygon points="12 2 2 22 22 22" />
          </svg>
          <span className="bigscreen-header-logo-text">GAMELIB</span>
        </div>

        {/* Primary Tabs */}
        <nav className="bigscreen-header-tabs" role="navigation" aria-label="Main sections">
          {tabs.map((tab) => {
            const activePath = getActiveTabPath(location.pathname);
            const isActive = activePath === tab.path;
            return (
              <HeaderTabItem
                key={tab.path}
                tab={tab}
                active={isActive}
                onActivate={() => navigate(tab.path)}
              />
            );
          })}
        </nav>
      </div>

      <div className="bigscreen-header-right">
        {/* Search */}
        <button
          type="button"
          className="bigscreen-header-tab bigscreen-header-tab--system bigscreen-header-tab--search"
          {...focusableSearch}
          aria-label="Search"
          title="Search ( / )"
        >
          <span className="bigscreen-header-tab-icon">
            <SearchIcon />
          </span>
        </button>

        {/* Power / Exit */}
        <button
          type="button"
          className="bigscreen-header-tab bigscreen-header-tab--system bigscreen-header-tab--exit"
          {...focusableExit}
          aria-label="Exit Big Screen"
          title="Exit Big Screen"
        >
          <span className="bigscreen-header-tab-icon">
            <PowerIcon />
          </span>
        </button>

        {/* Clock & Profile */}
        <div className="bigscreen-header-clock">{timeString}</div>

        <div className="bigscreen-header-profile" aria-label="Profile">
          <div className="bigscreen-header-avatar">
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
            </svg>
          </div>
        </div>
      </div>
    </header>
  );
}
