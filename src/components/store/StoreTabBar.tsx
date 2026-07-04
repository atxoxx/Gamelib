import type { StoreCategory } from "../../types/game";

/**
 * Synthetic "mode" tabs that are not real IGDB categories:
 *   - `discover`  → Switchpad-style landing (hero + rails)
 *   - `search`    → debounced live IGDB search
 *
 * Listed alongside the real `StoreCategory` values so a single tab strip
 * drives every state the Store page can be in.
 */
export type StoreModeTab = StoreCategory | "discover" | "search";

interface TabDef {
  key: StoreModeTab;
  label: string;
  icon?: React.ReactNode;
}

function DiscoverIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2 L13.5 8.5 L20 10 L13.5 11.5 L12 18 L10.5 11.5 L4 10 L10.5 8.5 Z" />
      <circle cx="18" cy="18" r="2" />
      <circle cx="6" cy="6" r="1.5" />
    </svg>
  );
}

const TABS: TabDef[] = [
  { key: "discover", label: "Discover", icon: <DiscoverIcon /> },
  { key: "trending", label: "Trending" },
  { key: "popular", label: "Popular" },
  { key: "top", label: "Top Rated" },
  { key: "coming_soon", label: "Coming Soon" },
  { key: "new_releases", label: "New Releases" },
  { key: "all", label: "All Games" },
  { key: "search", label: "Search" },
];

interface StoreTabBarProps {
  activeTab: StoreModeTab;
  onTabChange: (tab: StoreModeTab) => void;
}

export default function StoreTabBar({ activeTab, onTabChange }: StoreTabBarProps) {
  return (
    <div className="store-tab-bar">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          className={`store-tab${activeTab === tab.key ? " active" : ""}`}
          onClick={() => onTabChange(tab.key)}
        >
          {tab.key === "search" && (
            <svg
              className="store-tab-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          )}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
