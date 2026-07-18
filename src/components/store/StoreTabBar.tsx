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

function TrendingIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 17 9 11 13 15 21 7" />
      <polyline points="14 7 21 7 21 14" />
    </svg>
  );
}

function PopularIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2l2.6 6.3L21 9.2l-5 4.3L17.5 21 12 17.3 6.5 21 8 13.5l-5-4.3 6.4-.9z" />
    </svg>
  );
}

function TopRatedIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 21V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v13" />
      <path d="M6 13h12" />
      <path d="M9 5.5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1.5" />
    </svg>
  );
}

function ComingSoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <circle cx="12" cy="15" r="1.5" />
    </svg>
  );
}

function NewReleasesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </svg>
  );
}

function AllGamesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

const TABS: TabDef[] = [
  { key: "discover", label: "Discover", icon: <DiscoverIcon /> },
  { key: "trending", label: "Trending", icon: <TrendingIcon /> },
  { key: "popular", label: "Popular", icon: <PopularIcon /> },
  { key: "top", label: "Top Rated", icon: <TopRatedIcon /> },
  { key: "coming_soon", label: "Coming Soon", icon: <ComingSoonIcon /> },
  { key: "new_releases", label: "New", icon: <NewReleasesIcon /> },
  { key: "all", label: "All Games", icon: <AllGamesIcon /> },
  { key: "search", label: "Search", icon: <SearchIcon /> },
];

interface StoreTabBarProps {
  activeTab: StoreModeTab;
  onTabChange: (tab: StoreModeTab) => void;
}

export default function StoreTabBar({ activeTab, onTabChange }: StoreTabBarProps) {
  return (
    <div className="store-tab-bar" role="tablist" aria-label="Store sections">
      {TABS.map((tab) => {
        const active = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            role="tab"
            aria-selected={active}
            className={`store-tab${active ? " active" : ""}`}
            onClick={() => onTabChange(tab.key)}
          >
            <span className="store-tab-icon">{tab.icon}</span>
            <span className="store-tab-label">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
