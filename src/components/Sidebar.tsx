import { useState } from "react";

interface Game {
  id: string;
  name: string;
  platform: string;
  installed: boolean;
  playTime: string;
  iconUrl?: string;
}

export default function Sidebar() {
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);

  // Placeholder data
  const games: Game[] = [
    { id: "1", name: "The Witcher 3: Wild Hunt", platform: "Steam", installed: true, playTime: "142h" },
    { id: "2", name: "Cyberpunk 2077", platform: "GOG", installed: true, playTime: "89h" },
    { id: "3", name: "Hades II", platform: "Steam", installed: false, playTime: "0h" },
    { id: "4", name: "Elden Ring", platform: "Steam", installed: true, playTime: "210h" },
    { id: "5", name: "Baldur's Gate 3", platform: "GOG", installed: false, playTime: "0h" },
  ];

  const filters = ["All", "Installed", "Favorites", "Steam", "GOG", "Action", "RPG"];

  const filteredGames = games.filter((game) => {
    const matchesSearch = game.name.toLowerCase().includes(search.toLowerCase());
    if (!activeFilter || activeFilter === "All") return matchesSearch;
    if (activeFilter === "Installed") return matchesSearch && game.installed;
    if (activeFilter === "Favorites") return matchesSearch; // TODO: favorites logic
    if (activeFilter === "Steam" || activeFilter === "GOG") return matchesSearch && game.platform === activeFilter;
    return matchesSearch;
  });

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-search">
          <svg
            className="sidebar-search-icon"
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
          <input
            type="text"
            placeholder="Search games..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="sidebar-filters">
        {filters.map((filter) => (
          <button
            key={filter}
            className={`sidebar-filter-btn${activeFilter === filter ? " active" : ""}`}
            onClick={() => setActiveFilter(activeFilter === filter ? null : filter)}
          >
            {filter}
          </button>
        ))}
      </div>

      <hr className="sidebar-divider" />

      <div className="sidebar-list-header">
        <span>Games</span>
        <span className="sidebar-list-count">{filteredGames.length}</span>
      </div>

      <div className="sidebar-list">
        {filteredGames.length === 0 ? (
          <div className="sidebar-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            <p>No games found</p>
            <button>+ Import Games</button>
          </div>
        ) : (
          filteredGames.map((game) => (
            <div
              key={game.id}
              className={`sidebar-game-item${selectedGameId === game.id ? " active" : ""}`}
              onClick={() => setSelectedGameId(game.id)}
            >
              <div className="sidebar-game-icon">
                {game.iconUrl ? (
                  <img src={game.iconUrl} alt={game.name} />
                ) : (
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    opacity={0.3}
                  >
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                )}
              </div>
              <div className="sidebar-game-info">
                <div className="sidebar-game-name">{game.name}</div>
                <div className="sidebar-game-meta">
                  {game.platform} · {game.playTime}
                </div>
              </div>
              <div
                className={`sidebar-game-status ${game.installed ? "installed" : "not-installed"}`}
              />
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
