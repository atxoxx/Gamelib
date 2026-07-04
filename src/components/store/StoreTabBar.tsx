import type { StoreCategory } from "../../types/game";

interface TabDef {
  key: StoreCategory | "search";
  label: string;
}

const TABS: TabDef[] = [
  { key: "trending", label: "Trending" },
  { key: "popular", label: "Popular" },
  { key: "top", label: "Top Rated" },
  { key: "all", label: "All Games" },
  { key: "search", label: "Search" },
];

interface StoreTabBarProps {
  activeTab: StoreCategory | "search";
  onTabChange: (tab: StoreCategory | "search") => void;
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
