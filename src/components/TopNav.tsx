import { NavLink } from "react-router-dom";
import { useActiveDownloadCount } from "../context/DownloadContext";

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

const tabs: Tab[] = [
  { path: "/store", label: "Store", icon: <StoreIcon /> },
  { path: "/library", label: "Library", icon: <LibraryIcon /> },
  { path: "/wishlist", label: "Wishlist", icon: <WishlistIcon /> },
  { path: "/deals", label: "Deals", icon: <DealsIcon /> },
  { path: "/activity", label: "Activity", icon: <ActivityIcon /> },
  { path: "/storage", label: "Storage", icon: <StorageIcon /> },
  { path: "/community", label: "Community", icon: <CommunityIcon /> },
  { path: "/plugins", label: "Plugins", icon: <PluginsIcon /> },
];

export default function TopNav() {
  const activeDownloads = useActiveDownloadCount();
  return (
    <nav className="topnav">
      <div className="topnav-left">
        <div className="topnav-logo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          Gamelib
        </div>
        <div className="topnav-tabs">
          {tabs.map((tab) => (
            <NavLink
              key={tab.path}
              to={tab.path}
              className={({ isActive }) =>
                `topnav-tab${isActive ? " active" : ""}`
              }
            >
              {tab.icon}
              {tab.label}
            </NavLink>
          ))}
        </div>
      </div>

      {/* Contextual actions live on the far right (system-style actions
       *  like Settings, Profile). Icon-only so they don't compete
       *  with the primary nav for attention. The gear button picks up
       *  the same `active` treatment as the regular tabs so the user
       *  still sees where they are. */}
      <div className="topnav-right">
        {activeDownloads > 0 && (
          <span
            className="topnav-download-indicator"
            title={`${activeDownloads} active download${activeDownloads === 1 ? "" : "s"} — see the floating progress panel`}
            aria-label={`${activeDownloads} active downloads`}
            role="status"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span className="topnav-download-indicator-count">
              {activeDownloads}
            </span>
          </span>
        )}
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
    </nav>
  );
}
