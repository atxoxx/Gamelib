import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useGames } from "../context/GameContext";
import { useDensityContext } from "../context/DensityContext";
import { useToast } from "../context/ToastContext";
import { useLibraryFilters } from "../hooks/useLibraryFilters";
import LibraryFilterChips from "../components/library/LibraryFilterChips";
import LibraryFilterSidebar from "../components/library/LibraryFilterSidebar";
import DensityToggle from "../components/DensityToggle";
import type { Game } from "../types/game";

export default function LibraryPage() {
  const navigate = useNavigate();
  const { games, setSelectedGameId, runningGameIds, launchGame, removeGame } = useGames();
  const { showToast } = useToast();
  // Density is shared with Store/Wishlist via the lifted `DensityProvider` in
  // App.tsx, so toggling here also affects the rest of the app — the same
  // UX as the Store tab.
  const { density, setDensity } = useDensityContext();

  const {
    filters,
    filteredGames,
    availableGenres,
    availablePlatforms,
    setSearch,
    setGenres,
    setPlatforms,
    setYearRange,
    setRatingMin,
    setStatus,
    removeGenre,
    removePlatform,
    removeYear,
    removeRating,
    removeStatus,
    removeSearch,
    reset,
    hasFilters,
  } = useLibraryFilters(games);

  const [contextMenu, setContextMenu] = useState<{ game: Game; x: number; y: number } | null>(null);

  // Close context menu on left click anywhere
  useEffect(() => {
    function handleGlobalClick() {
      setContextMenu(null);
    }
    if (contextMenu) {
      document.addEventListener("click", handleGlobalClick);
      document.addEventListener("contextmenu", handleGlobalClick);
    }
    return () => {
      document.removeEventListener("click", handleGlobalClick);
      document.removeEventListener("contextmenu", handleGlobalClick);
    };
  }, [contextMenu]);

  // Truly empty: no games imported at all. Show the standard onboarding
  // empty state without a filter sidebar (filters would be useless).
  if (games.length === 0) {
    return (
      <div className="main-empty">
        <svg className="main-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
        <h2 className="main-empty-title">Your Game Library</h2>
        <p className="main-empty-subtitle">
          Import games using the + button in the sidebar to start building your collection.
        </p>
      </div>
    );
  }

  function handleCardClick(game: Game) {
    setSelectedGameId(game.id);
    navigate(`/library/${game.id}`);
  }

  function handleGameContextMenu(e: React.MouseEvent, game: Game) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      game,
      x: e.clientX,
      y: e.clientY,
    });
  }

  function handleLaunch(game: Game) {
    setContextMenu(null);
    launchGame(game);
  }

  function handleViewDetails(game: Game) {
    setContextMenu(null);
    setSelectedGameId(game.id);
    navigate(`/library/${game.id}`);
  }

  function handleRemove(game: Game) {
    setContextMenu(null);
    removeGame(game.id);
    showToast(`Removed ${game.name} from library`, "info");
  }

  return (
    <div className="library-grid">
      <div className="library-header">
        <h2 className="library-heading">
          Library ({hasFilters ? `${filteredGames.length} of ${games.length}` : games.length})
        </h2>
        <div className="library-density-toolbar" aria-label="Layout controls">
          <span className="library-density-toolbar-label">Density</span>
          <DensityToggle density={density} onChange={setDensity} />
        </div>
      </div>

      <LibraryFilterChips
        filters={filters}
        resultCount={filteredGames.length}
        onRemoveSearch={removeSearch}
        onRemoveGenre={removeGenre}
        onRemovePlatform={removePlatform}
        onRemoveYear={removeYear}
        onRemoveRating={removeRating}
        onRemoveStatus={removeStatus}
        onResetAll={reset}
      />

      <div className="library-layout">
        <LibraryFilterSidebar
          search={filters.search}
          selectedGenres={filters.genres}
          selectedPlatforms={filters.platforms}
          yearMin={filters.yearMin}
          yearMax={filters.yearMax}
          ratingMin={filters.ratingMin}
          status={filters.status}
          availableGenres={availableGenres}
          availablePlatforms={availablePlatforms}
          onSearchChange={setSearch}
          onGenresChange={setGenres}
          onPlatformsChange={setPlatforms}
          onYearRangeChange={setYearRange}
          onRatingMinChange={setRatingMin}
          onStatusChange={setStatus}
          onReset={reset}
        />

        <div className="library-main">
          {filteredGames.length === 0 ? (
            // Filters are active but the narrowed set is empty
            <div className="library-empty-filtered">
              <svg
                className="library-empty-filtered-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
              <p className="library-empty-filtered-title">No games match your filters</p>
              <p className="library-empty-filtered-subtitle">
                Try removing a filter or broadening your search.
              </p>
              <button className="library-empty-filtered-reset" onClick={reset}>
                Clear all filters
              </button>
            </div>
          ) : (
            <div className={`library-cards density-${density}`}>
              {filteredGames.map((game) => {
                const isRunning = runningGameIds.includes(game.id);
                return (
                  <div
                    key={game.id}
                    className={`library-card density-${density}${isRunning ? " running" : ""}`}
                    onClick={() => handleCardClick(game)}
                    onContextMenu={(e) => handleGameContextMenu(e, game)}
                  >
                    <div className="library-card-cover">
                      {game.coverArtUrl ? (
                        <img src={game.coverArtUrl} alt={game.name} />
                      ) : (
                        <div className="library-card-cover-placeholder">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                          </svg>
                        </div>
                      )}
                      {isRunning && (
                        <div className="library-card-running-badge">
                          <span className="running-badge-dot" />
                          Running
                        </div>
                      )}
                      <div className="library-card-playtime-badge">{game.playTime}</div>
                      <div className={`library-card-status-badge ${game.installed ? "installed" : "not-installed"}`}>
                        <span className={`library-card-status-dot ${game.installed ? "installed" : "not-installed"}`} />
                        {game.installed ? "Ready" : "Not Installed"}
                      </div>
                    </div>
                    <div className="library-card-body">
                      <h3 className="library-card-name" title={game.name}>{game.name}</h3>
                      <div className="library-card-meta-row">
                        <span className={`library-card-platform platform-${game.platform.toLowerCase()}`}>
                          {game.platform}
                        </span>
                        {(() => {
                          // Show the highest available rating so the badge
                          // matches the filter (`igdbRating ?? criticRating`).
                          // A user filtering by rating expects to see a
                          // badge on every card that matches.
                          const rating = game.igdbRating ?? game.criticRating;
                          if (rating == null || rating <= 0) return null;
                          const isCritic = game.igdbRating == null;
                          return (
                            <span
                              className="library-card-rating"
                              title={`${isCritic ? "Critic" : "IGDB"} Rating: ${Math.round(rating)}%`}
                            >
                              <svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                              {Math.round(rating)}%
                            </span>
                          );
                        })()}
                      </div>
                      {game.developer && (
                        <p className="library-card-developer" title={game.developer}>{game.developer}</p>
                      )}
                      {game.genres && game.genres.length > 0 && (
                        <div className="library-card-genres">
                          {game.genres.slice(0, 3).map((g) => (
                            <span key={g} className="library-card-genre-tag">{g}</span>
                          ))}
                        </div>
                      )}
                      {game.notes ? (
                        <p className="library-card-notes">{game.notes}</p>
                      ) : (
                        game.description ? (
                          <p className="library-card-notes">{game.description.slice(0, 80)}{game.description.length > 80 ? '...' : ''}</p>
                        ) : (
                          <p className="library-card-notes library-card-notes-empty">No notes</p>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          game={contextMenu.game}
          isRunning={runningGameIds.includes(contextMenu.game.id)}
          onLaunch={() => handleLaunch(contextMenu.game)}
          onViewDetails={() => handleViewDetails(contextMenu.game)}
          onRemove={() => handleRemove(contextMenu.game)}
        />
      )}
    </div>
  );
}

interface ContextMenuProps {
  x: number;
  y: number;
  game: Game;
  isRunning: boolean;
  onLaunch: () => void;
  onViewDetails: () => void;
  onRemove: () => void;
}

function ContextMenu({
  x,
  y,
  game,
  isRunning,
  onLaunch,
  onViewDetails,
  onRemove,
}: ContextMenuProps) {
  // Prevent menu overflow off the screen
  const menuWidth = 190;
  const menuHeight = 130;
  const adjustedX = window.innerWidth - x < menuWidth ? x - menuWidth : x;
  const adjustedY = window.innerHeight - y < menuHeight ? y - menuHeight : y;

  return (
    <div
      className="context-menu"
      style={{ left: adjustedX, top: adjustedY }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="context-menu-header">
        <span className="context-menu-title">{game.name}</span>
      </div>
      <button
        className="context-menu-item play-action"
        onClick={onLaunch}
        disabled={isRunning}
      >
        <svg viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        {isRunning ? "Running" : "Play Game"}
      </button>
      <button className="context-menu-item" onClick={onViewDetails}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        View Details
      </button>
      <div className="context-menu-separator" />
      <button className="context-menu-item remove-action" onClick={onRemove}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
        Remove from Library
      </button>
    </div>
  );
}
