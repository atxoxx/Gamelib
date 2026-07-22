import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useGames } from "../context/GameContext";
import { useBigScreen } from "../context/BigScreenContext";
import { useDensityContext } from "../context/DensityContext";
import { useToast } from "../context/ToastContext";
import {
  useLibraryFilters,
  type LibraryFilters,
  type LibraryStatus,
  type LibrarySort,
} from "../hooks/useLibraryFilters";
import type { Game, LibrarySource, PlayStatus } from "../types/game";
import LibraryFilterChips from "../components/library/LibraryFilterChips";
import LibraryFilterSidebar from "../components/library/LibraryFilterSidebar";
import LibraryHero from "../components/library/LibraryHero";
import LibrarySortMenu from "../components/library/LibrarySortMenu";
import RecentlyAddedRail from "../components/library/RecentlyAddedRail";
import ContinuePlayingRail from "../components/library/ContinuePlayingRail";
import LibraryEmptyState from "../components/library/LibraryEmptyState";
import LibraryGameCard from "../components/library/LibraryGameCard";
import BigScreenGameCard from "../components/library/BigScreenGameCard";
import BigScreenLibrary from "../components/library/BigScreenLibrary";
import DensityToggle from "../components/DensityToggle";

const VIRTUALIZE_THRESHOLD = 60;

export default function LibraryPage() {
  const navigate = useNavigate();
  const { games, setSelectedGameId, runningGameIds, launchGame, removeGame } = useGames();
  const { showToast } = useToast();
  const { isBigScreen } = useBigScreen();
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
    setPlayStatus,
    setSort,
    removeGenre,
    removePlatform,
    removeYear,
    removeRating,
    removeStatus,
    removePlayStatus,
    removeSearch,
    removeSource,
    reset,
    hasFilters,
  } = useLibraryFilters(games);

  const [contextMenu, setContextMenu] = useState<{ game: Game; x: number; y: number } | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener("click", close);
    document.addEventListener("contextmenu", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("contextmenu", close);
    };
  }, [contextMenu]);

  const isLibraryEmpty = games.length === 0;

  const handleCardClick = useCallback(
    (game: Game) => {
      setSelectedGameId(game.id);
      navigate(`/library/${game.id}`);
    },
    [navigate, setSelectedGameId]
  );

  const handleGameContextMenu = useCallback((e: React.MouseEvent, game: Game) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ game, x: e.clientX, y: e.clientY });
  }, []);

  const handleLaunch = useCallback(
    (game: Game) => {
      setContextMenu(null);
      launchGame(game);
    },
    [launchGame]
  );

  const handleViewDetails = useCallback(
    (game: Game) => {
      setContextMenu(null);
      setSelectedGameId(game.id);
      navigate(`/library/${game.id}`);
    },
    [navigate, setSelectedGameId]
  );

  const handleRemove = useCallback(
    (game: Game) => {
      setContextMenu(null);
      removeGame(game.id);
      showToast(`Removed ${game.name} from library`, "info");
    },
    [removeGame, showToast]
  );

  const runningSet = useMemo(() => runningGameIds, [runningGameIds]);

  // Editorial mode: when the library is small enough to render without
  // virtualization (and not in a list/compact view), promote the first
  // card to a wide "feature" tile to create visual rhythm — a curated
  // feel instead of a uniform wall of equal cards.
  const editorial = !isBigScreen && density !== "list" && density !== "compact";

  const renderCard = useCallback(
    (game: Game, index: number) => {
      if (isBigScreen) {
        return <BigScreenGameCard key={game.id} game={game} onClick={() => handleCardClick(game)} />;
      }
      const featured = editorial && index === 0 && !!game.coverArtUrl;
      return (
        <LibraryGameCard
          key={game.id}
          game={game}
          density={density}
          isRunning={runningSet.includes(game.id)}
          onClick={() => handleCardClick(game)}
          onContextMenu={(e) => handleGameContextMenu(e, game)}
          onLaunch={handleLaunch}
          className={`animate-fade-in stagger-${Math.min(index + 1, 8)}${featured ? " lib-card--featured" : ""}`}
        />
      );
    },
    [isBigScreen, density, editorial, runningSet, handleCardClick, handleGameContextMenu, handleLaunch]
  );

  const sidebarProps = {
    search: filters.search,
    selectedGenres: filters.genres,
    selectedPlatforms: filters.platforms,
    yearMin: filters.yearMin,
    yearMax: filters.yearMax,
    ratingMin: filters.ratingMin,
    status: filters.status as LibraryStatus,
    playStatus: filters.playStatus as PlayStatus | "all",
    availableGenres,
    availablePlatforms,
    source: filters.source as LibrarySource,
    sort: filters.sort as LibrarySort,
    onSearchChange: setSearch,
    onGenresChange: setGenres,
    onPlatformsChange: setPlatforms,
    onYearRangeChange: setYearRange,
    onRatingMinChange: setRatingMin,
    onStatusChange: setStatus,
    onPlayStatusChange: setPlayStatus,
    onSourceChange: setSource,
    onSortChange: setSort,
    onReset: reset,
  };

  return (
    <div className={`lib-page${isBigScreen ? " lib-page--bigscreen" : ""}`}>
      {isBigScreen && !isLibraryEmpty ? (
        <BigScreenLibrary
          filteredGames={filteredGames}
          totalGames={games.length}
          onSelectGame={handleCardClick}
          filters={filters}
          availableGenres={availableGenres}
          availablePlatforms={availablePlatforms}
          setSearch={setSearch}
          setGenres={setGenres}
          setPlatforms={setPlatforms}
          setStatus={setStatus}
          setSource={setSource}
          setSort={setSort}
          reset={reset}
        />
      ) : (
        <>
          <LibraryHero games={games} />

          {!isLibraryEmpty && <ContinuePlayingRail games={games} onCardClick={handleCardClick} />}

          {!isLibraryEmpty && games.length >= 4 && (
            <RecentlyAddedRail games={games} onCardClick={handleCardClick} />
          )}

          <div className="lib-toolbar">
            <div className="lib-toolbar-title">
              <h2>
                {isLibraryEmpty
                  ? "Your Games"
                  : `Library (${
                      hasFilters ? `${filteredGames.length} of ${games.length}` : games.length
                    })`}
              </h2>
              {!isLibraryEmpty && hasFilters && (
                <span className="lib-toolbar-count">
                  {filteredGames.length} result{filteredGames.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>

            {!isLibraryEmpty && !isBigScreen && (
              <div className="lib-toolbar-controls">
                <div className="lib-search">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    type="text"
                    value={filters.search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search your library..."
                    aria-label="Search library"
                  />
                </div>
                <LibrarySortMenu value={filters.sort} onChange={setSort} />
                <div className="lib-toolbar-group" role="radiogroup" aria-label="Layout density">
                  <DensityToggle density={density} onChange={setDensity} />
                </div>
              </div>
            )}
          </div>

          {!isLibraryEmpty && (
            <LibraryFilterChips
              filters={filters as LibraryFilters}
              resultCount={filteredGames.length}
              onRemoveSearch={removeSearch}
              onRemoveGenre={removeGenre}
              onRemovePlatform={removePlatform}
              onRemoveYear={removeYear}
              onRemoveRating={removeRating}
              onRemoveStatus={removeStatus}
              onRemovePlayStatus={removePlayStatus}
              onRemoveSource={removeSource}
              onResetAll={reset}
            />
          )}

          {isLibraryEmpty ? (
            <LibraryEmptyState />
          ) : (
            <div className="lib-layout">
              {!isBigScreen && (
                <div className={`lib-rail-wrap${sidebarCollapsed ? " collapsed" : ""}`}>
                  <button
                    type="button"
                    className="lib-rail-toggle-btn"
                    onClick={() => setSidebarCollapsed((c) => !c)}
                    aria-label={sidebarCollapsed ? "Expand filters" : "Collapse filters"}
                    aria-expanded={!sidebarCollapsed}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <line x1="4" y1="21" x2="4" y2="14" />
                      <line x1="4" y1="10" x2="4" y2="3" />
                      <line x1="12" y1="21" x2="12" y2="12" />
                      <line x1="12" y1="8" x2="12" y2="3" />
                      <line x1="20" y1="21" x2="20" y2="16" />
                      <line x1="20" y1="12" x2="20" y2="3" />
                      <line x1="1" y1="14" x2="7" y2="14" />
                      <line x1="9" y1="8" x2="15" y2="8" />
                      <line x1="17" y1="16" x2="23" y2="16" />
                    </svg>
                  </button>
                  {!sidebarCollapsed && <LibraryFilterSidebar {...sidebarProps} />}
                </div>
              )}

              <div className="lib-main">
                {filteredGames.length === 0 ? (
                  <div className="lib-filtered-empty">
                    <svg className="lib-filtered-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      <line x1="8" y1="11" x2="14" y2="11" />
                    </svg>
                    <p className="lib-filtered-empty-title">No games match your filters</p>
                    <p className="lib-filtered-empty-subtitle">Try removing a filter or broadening your search.</p>
                    <button type="button" className="lib-filtered-empty-reset" onClick={reset}>
                      Clear all filters
                    </button>
                  </div>
                ) : (
                  <VirtualGrid items={filteredGames} density={density} isBigScreen={isBigScreen} editorial={editorial} renderItem={renderCard} />
                )}
              </div>
            </div>
          )}

          {contextMenu && (
            <ContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              game={contextMenu.game}
              isRunning={runningSet.includes(contextMenu.game.id)}
              onLaunch={() => handleLaunch(contextMenu.game)}
              onViewDetails={() => handleViewDetails(contextMenu.game)}
              onRemove={() => handleRemove(contextMenu.game)}
            />
          )}
        </>
      )}
    </div>
  );
}

interface VirtualGridProps {
  items: Game[];
  density: string;
  isBigScreen: boolean;
  editorial?: boolean;
  renderItem: (game: Game, index: number) => React.ReactNode;
}

function VirtualGrid({ items, density, isBigScreen, editorial, renderItem }: VirtualGridProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const [containerW, setContainerW] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const useVirtual = items.length > VIRTUALIZE_THRESHOLD;

  useEffect(() => {
    if (!useVirtual) return;
    const el = scrollRef.current;
    if (!el) return;

    const scroller: Window = window;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      setViewportH(rect.height);
      setContainerW(rect.width);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);

    const computeScrollTop = () => {
      const elTop = el.getBoundingClientRect().top;
      setScrollTop(Math.max(0, -elTop));
    };
    computeScrollTop();

    scroller.addEventListener("scroll", computeScrollTop, { passive: true });
    return () => {
      ro.disconnect();
      scroller.removeEventListener("scroll", computeScrollTop);
    };
  }, [useVirtual]);

  const rowHeight =
    density === "compact" ? 220 : density === "cinematic" ? 420 : density === "list" ? 96 : 340;
  const gap = density === "compact" ? 12 : density === "cinematic" ? 24 : 16;

  if (!useVirtual) {
    return (
      <div
        className={`lib-cards density-${density}${isBigScreen ? " bigscreen-cards" : ""}${editorial ? " lib-cards--editorial" : ""}`}
      >
        {items.map((g, i) => renderItem(g, i))}
      </div>
    );
  }

  const minCol =
    density === "compact" ? 130 : density === "cinematic" ? 240 : density === "list" ? 99999 : 180;
  const cols = density === "list" ? 1 : Math.max(1, Math.floor((containerW + gap) / (minCol + gap)));

  const rowCount = Math.ceil(items.length / cols);
  const totalHeight = rowCount * rowHeight + (rowCount - 1) * gap;

  const overscan = 2;
  const rowStride = rowHeight + gap;
  const firstRow = Math.max(0, Math.floor(scrollTop / rowStride) - overscan);
  const visibleRows = Math.ceil(viewportH / rowStride) + overscan * 2;
  const lastRow = Math.min(rowCount - 1, firstRow + visibleRows);

  const visible: React.ReactNode[] = [];
  for (let r = firstRow; r <= lastRow; r++) {
    const start = r * cols;
    const rowItems = items.slice(start, start + cols);
    rowItems.forEach((g, i) => visible.push(renderItem(g, start + i)));
  }

  return (
    <div className="lib-grid-scroll" ref={scrollRef}>
      <div className="lib-grid-spacer" style={{ height: totalHeight }}>
        <div
          className={`lib-cards density-${density}${isBigScreen ? " bigscreen-cards" : ""} lib-cards--virtual`}
          style={{ transform: `translateY(${firstRow * rowStride}px)` }}
        >
          {visible}
        </div>
      </div>
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

function ContextMenu({ x, y, game, isRunning, onLaunch, onViewDetails, onRemove }: ContextMenuProps) {
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
      <button className="context-menu-item play-action" onClick={onLaunch} disabled={isRunning}>
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
