import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useGames, NO_IGDB_MATCH_SOURCE } from "../context/GameContext";
import { useDensityContext } from "../context/DensityContext";
import { useToast } from "../context/ToastContext";
import { useLibraryFilters } from "../hooks/useLibraryFilters";
import LibraryFilterChips from "../components/library/LibraryFilterChips";
import LibraryFilterSidebar from "../components/library/LibraryFilterSidebar";
import LibraryHero from "../components/library/LibraryHero";
import RecentlyAddedRail from "../components/library/RecentlyAddedRail";
import ContinuePlayingRail from "../components/library/ContinuePlayingRail";
import LibraryEmptyState from "../components/library/LibraryEmptyState";
import DensityToggle from "../components/DensityToggle";
import { Card, Badge, Button } from "../components/ui";
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
    setSource,
    setSort,
    removeGenre,
    removePlatform,
    removeYear,
    removeRating,
    removeStatus,
    removeSearch,
    removeSource,
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

  // Truly empty: no games imported at all. Show the hero above and a
  // rich 3-card empty state below. The hero still renders (with the
  // "0 games" stats) because greeting + CTA buttons are still useful
  // onboarding entry points.
  const isLibraryEmpty = games.length === 0;

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
      <LibraryHero games={games} />

      {/* Recently Added rail: skipped entirely when the library is empty
          (the rail would be blank) or when there are fewer than 4 games
          (the rail duplicates the main grid). */}
      {!isLibraryEmpty && games.length >= 4 && (
        <RecentlyAddedRail
          games={games}
          onCardClick={handleCardClick}
        />
      )}

      {/* Continue Playing rail: surfaces games the user has launched
          in the last 14 days. Sits BELOW Recently Added per the spec.
          The component self-gates on `recent.length >= 1` so we don't
          need a length check here. */}
      {!isLibraryEmpty && (
        <ContinuePlayingRail
          games={games}
          onCardClick={handleCardClick}
        />
      )}

      <div className="library-header">
        <h2 className="library-heading">
          {isLibraryEmpty
            ? "Your Games"
            : `Library (${
                hasFilters ? `${filteredGames.length} of ${games.length}` : games.length
              })`}
        </h2>
        {!isLibraryEmpty && (
          <div className="library-density-toolbar" aria-label="Layout controls">
            <span className="library-density-toolbar-label">Density</span>
            <DensityToggle density={density} onChange={setDensity} />
          </div>
        )}
      </div>

      {!isLibraryEmpty && (
        <LibraryFilterChips
          filters={filters}
          resultCount={filteredGames.length}
          onRemoveSearch={removeSearch}
          onRemoveGenre={removeGenre}
          onRemovePlatform={removePlatform}
          onRemoveYear={removeYear}
          onRemoveRating={removeRating}
          onRemoveStatus={removeStatus}
          onRemoveSource={removeSource}
          onResetAll={reset}
        />
      )}

      {isLibraryEmpty ? (
        <LibraryEmptyState />
      ) : (
        <div className="library-layout">
          <LibraryFilterSidebar
            search={filters.search}
            selectedGenres={filters.genres}
            selectedPlatforms={filters.platforms}
            yearMin={filters.yearMin}
            yearMax={filters.yearMax}
            ratingMin={filters.ratingMin}
            status={filters.status}
            source={filters.source}
            sort={filters.sort}
            availableGenres={availableGenres}
            availablePlatforms={availablePlatforms}
            onSearchChange={setSearch}
            onGenresChange={setGenres}
            onPlatformsChange={setPlatforms}
            onYearRangeChange={setYearRange}
            onRatingMinChange={setRatingMin}
            onStatusChange={setStatus}
            onSourceChange={setSource}
            onSortChange={setSort}
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
                <Button variant="primary" onClick={reset}>
                  Clear all filters
                </Button>
              </div>
            ) : (
              <div className={`library-cards density-${density}`}>
                {filteredGames.map((game, index) => (
                  <LibraryGameCard
                    key={game.id}
                    game={game}
                    density={density}
                    isRunning={runningGameIds.includes(game.id)}
                    onClick={() => handleCardClick(game)}
                    onContextMenu={(e) => handleGameContextMenu(e, game)}
                    className={`animate-fade-in stagger-${Math.min(index + 1, 8)}`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

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

/**
 * Library game card with two auto-fetch paths for missing / broken
 * covers:
 *
 *  1. A per-card `IntersectionObserver` fires `enrichGameMetadata`
 *     when a placeholder card scrolls into view. The Rust semaphore
 *     (`igdb_acquire()`) enforces 4 req/s, so any number of cards
 *     becoming visible simultaneously still won't queue-request IGDB
 *     past the rate limit. The session dedupe inside
 *     `enrichGameMetadata` (see GameContext) prevents any single
 *     gameId firing twice within an SPA session.
 *
 *  2. An `onError` fallback chain on the cover `<img>` element
 *     resolves 404 Steam CDN URLs (`library_600x900_2x` →
 *     `library_600x900` → `header.jpg`) without a network round-trip,
 *     and clears `coverArtUrl` once all fallbacks fail — clearing
 *     re-renders the placeholder *and* re-arms the observer above to
 *     scrape a non-Steam cover.
 *
 * Extracted from the inline `filteredGames.map(...)` body so the
 * hooks (`useRef`, `useEffect`) needed for the observer can attach
 * to a stable node instead of being recreated on every parent render.
 */
function LibraryGameCard({
  game,
  density,
  isRunning,
  onClick,
  onContextMenu,
  className,
}: {
  game: Game;
  density: string;
  isRunning: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  className?: string;
}) {
  const { updateGame, enrichGameMetadata } = useGames();
  const coverRef = useRef<HTMLDivElement | null>(null);

  const installed = game.installed;
  const platform = game.platform.toLowerCase();

  // Auto-enrich criteria — short-circuits the observer setup so we
  // don't spam IGDB for games we already know are unmatched.
  const canAutoFetchCover =
    !game.coverArtUrl &&
    game.metadataSource !== NO_IGDB_MATCH_SOURCE &&
    !!game.name;

  // Set up the IntersectionObserver. We disconnect immediately on
  // first intersect — the session-scoped `enrichedThisSession` Set
  // inside `enrichGameMetadata` makes any concurrent second attempt
  // a no-op. The effect re-arms whenever `canAutoFetchCover` flips
  // (e.g. user manually clears the cover via the edit modal and
  // scrolls back), so the loop is self-healing.
  useEffect(() => {
    if (!canAutoFetchCover || !coverRef.current) return;
    const node = coverRef.current;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        enrichGameMetadata(game.id, game.name, game.steamAppId).catch(
          (err) =>
            console.warn(
              `Auto-cover fetch failed for ${game.name}:`,
              err
            )
        );
      },
      { rootMargin: "300px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [canAutoFetchCover, game.id, game.name, game.steamAppId, enrichGameMetadata]);

  return (
    <Card
      variant="surface"
      elevation="1"
      hoverLift
      className={`library-card density-${density}${isRunning ? " running" : ""}${className ? ` ${className}` : ""}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <div className="library-card-cover" ref={coverRef}>
        {game.coverArtUrl ? (
          <img
            src={game.coverArtUrl}
            alt={game.name}
            onError={(e) => {
              const img = e.currentTarget;
              // Steam CDN fallback chain for synced games whose
              // library_600x900_2x.jpg 404s (older titles, mods,
              // niche releases). On every onError we walk to the
              // next SIMPLER Steam URL; the chain is unambiguous
              // because each step replaces `img.src` with a string
              // that no longer contains the previous step's marker
              // (e.g. "library_600x900_2x" is NOT a substring of
              // "library_600x900"), so we don't need a
              // `dataset.fallback` state flag. Once ALL Steam
              // fallbacks fail, we clear `coverArtUrl` — that
              // re-renders the placeholder AND flips
              // `canAutoFetchCover` back to `true`, so the observer
              // above re-arms and scrapes IGDB / LaunchBox for a
              // real cover on the next intersection.
              const appId = game.steamAppId;
              if (appId) {
                if (img.src.includes("library_600x900_2x")) {
                  img.src = `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`;
                  return;
                }
                if (img.src.includes("library_600x900")) {
                  img.src = `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`;
                  return;
                }
              }
              console.warn(
                `Cover image failed for ${game.name}, falling back to placeholder`
              );
              updateGame(game.id, { coverArtUrl: undefined });
            }}
          />
        ) : (
          <div className="library-card-cover-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
        )}
        {isRunning && (
          <Badge variant="success" size="sm" dot className="library-card-running-badge">Running</Badge>
        )}
        <Badge variant="accent" size="sm" className="library-card-playtime-badge">{game.playTime}</Badge>
        <Badge
          variant={installed ? "success" : "default"}
          size="sm"
          dot
          className={`library-card-status-badge ${installed ? "installed" : "not-installed"}`}
        >
          {installed ? "Ready" : "Not Installed"}
        </Badge>
      </div>
      <div className="library-card-body">
        <h3 className="library-card-name" title={game.name}>{game.name}</h3>
        <div className="library-card-meta-row">
          <Badge variant="info" size="sm" className={`library-card-platform platform-${platform}`}>
            {game.platform}
          </Badge>
          {(() => {
            const rating = game.igdbRating ?? game.criticRating;
            if (rating == null || rating <= 0) return null;
            return (
              <Badge variant="accent" size="sm" className="library-card-rating" title={`${game.igdbRating != null ? "IGDB" : "Critic"} Rating: ${Math.round(rating)}%`}>
                <svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10" style={{ marginRight: 3 }}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                {Math.round(rating)}%
              </Badge>
            );
          })()}
        </div>
        {game.developer && (
          <p className="library-card-developer" title={game.developer}>{game.developer}</p>
        )}
        {game.genres && game.genres.length > 0 && (
          <div className="library-card-genres">
            {game.genres.slice(0, 3).map((g) => (
              <Badge key={g} variant="default" size="sm" className="library-card-genre-tag">{g}</Badge>
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
    </Card>
  );
}
