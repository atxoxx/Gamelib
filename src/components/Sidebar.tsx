import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useGames } from "../context/GameContext";
import { useToast } from "../context/ToastContext";
import { useLibraryFilters } from "../hooks/useLibraryFilters";
import { gameNameFromPath, type Game, type GameMetadataResult } from "../types/game";
import ImportModal, { type ExeInfo } from "./ImportModal";
import SidebarFilterPopover from "./SidebarFilterPopover";

export default function Sidebar() {
  const navigate = useNavigate();
  const { games, selectedGameId, setSelectedGameId, removeGame, runningGameIds, launchGame, importLocalGames } =
    useGames();
  const { showToast } = useToast();

  // Full filter system for the sidebar game list. Reuses the same hook
  // the Library page uses, so search + status + genres + platforms +
  // release year + rating all narrow the list in real time. The
  // popover exposes everything except search (which lives in the
  // sidebar itself).
  const {
    filters: filterState,
    filteredGames,
    availableGenres,
    availablePlatforms,
    setSearch,
    setGenres,
    setPlatforms,
    setYearRange,
    setRatingMin,
    setStatus,
    reset,
  } = useLibraryFilters(games);

  // Count of active advanced facets (everything except the always-visible
  // search). Drives BOTH the filter button's `active` class and its badge
  // so the two visuals stay in sync — typing in the sidebar search alone
  // shouldn't turn the button purple with no badge to justify it. The
  // search field itself is the visual indicator that search is active.
  const advancedFilterCount =
    (filterState.status !== "all" ? 1 : 0) +
    (filterState.genres.length > 0 ? 1 : 0) +
    (filterState.platforms.length > 0 ? 1 : 0) +
    (filterState.yearMin != null || filterState.yearMax != null ? 1 : 0) +
    (filterState.ratingMin != null ? 1 : 0);

  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showFilterPopover, setShowFilterPopover] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ game: Game; x: number; y: number } | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [scannedExes, setScannedExes] = useState<ExeInfo[]>([]);

  const importMenuRef = useRef<HTMLDivElement>(null);
  const importBtnRef = useRef<HTMLButtonElement>(null);
  // Ref to the filter icon button — passed to `SidebarFilterPopover` so
  // the popover can anchor itself next to the button and so its
  // click-outside detector doesn't treat clicks on the icon as
  // "outside" (which would race against the parent's toggle state).
  const filterBtnRef = useRef<HTMLButtonElement>(null);

  // Close import menu and context menu on outside click. The filter
  // popover manages its own dismissal (click anywhere outside the
  // popover OR the anchor, plus Escape) so the sidebars listen for
  // everything else.
  useEffect(() => {
    function handleClick() {
      setShowImportMenu(false);
      setContextMenu(null);
    }
    if (showImportMenu || contextMenu) {
      document.addEventListener("mousedown", handleClick);
    }
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showImportMenu, contextMenu]);

  async function handleImportExe() {
    setShowImportMenu(false);
    try {
      const filePath = await open({
        multiple: false,
        directory: false,
        title: "Select Game Executable",
        filters: [{ name: "Executable", extensions: ["exe"] }],
      });
      if (filePath && typeof filePath === "string") {
        const existing = games.find((g) => g.path.toLowerCase().trim() === filePath.toLowerCase().trim());
        if (existing) {
          showToast(`${gameNameFromPath(filePath)} is already in your library`, "info");
          return;
        }
        setScannedExes([{ path: filePath, size: 0, modifiedAt: Math.round(Date.now() / 1000) }]);
        setShowImportModal(true);
      }
    } catch (err) {
      console.error("Failed to import exe:", err);
    }
  }

  async function handleImportFolder() {
    setShowImportMenu(false);
    try {
      const folderPath = await open({
        multiple: false,
        directory: true,
        title: "Select Folder to Scan for Games",
      });
      if (folderPath && typeof folderPath === "string") {
        const exes: ExeInfo[] = await invoke("scan_folder_for_exes", {
          folderPath,
        });
        if (exes.length === 0) {
          showToast("No executable files found in the selected folder", "info");
          return;
        }
        // Deduplicate against existing games before showing modal
        const existingPaths = new Set(games.map((g) => g.path.toLowerCase()));
        const newExes = exes.filter(
          (exe) => !existingPaths.has(exe.path.toLowerCase())
        );
        if (newExes.length === 0) {
          showToast("All executables in this folder are already in your library", "info");
          return;
        }
        setScannedExes(newExes);
        setShowImportModal(true);
      }
    } catch (err) {
      console.error("Failed to import folder:", err);
    }
  }

  async function handleConfirmImport(imports: { path: string; metadata: GameMetadataResult | null }[]) {
    setShowImportModal(false);
    await importLocalGames(imports);
  }

  function handleGameContextMenu(e: React.MouseEvent, game: Game) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ game, x: e.clientX, y: e.clientY });
  }

  function handleLaunchFromContextMenu(game: Game) {
    setContextMenu(null);
    launchGame(game);
  }

  function handleViewDetailsFromContextMenu(game: Game) {
    setContextMenu(null);
    setSelectedGameId(game.id);
    navigate(`/library/${game.id}`);
  }

  function handleRemoveFromContextMenu(game: Game) {
    removeGame(game.id);
    setContextMenu(null);
    showToast(`Removed ${game.name}`, "info");
  }

  function handleGameClick(game: Game) {
    setSelectedGameId(game.id);
    navigate(`/library/${game.id}`);
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-search-row">
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
              value={filterState.search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/*
            Filter icon button. Sits to the right of the search input at
            the same height so the two controls feel like a unified
            toolbar. Shows a count badge (active-facets only, not search)
            and a glowing accent border whenever any advanced filter is
            active, so the user can tell at a glance that the list is
            being narrowed. Uses `aria-haspopup="dialog"` (not
            `aria-pressed`) because it opens a modal rather than toggling
            state.
          */}
          <button
            ref={filterBtnRef}
            className={`sidebar-filter-btn${advancedFilterCount > 0 ? " active" : ""}`}
            aria-label="Filter games"
            aria-haspopup="dialog"
            aria-expanded={showFilterPopover}
            onClick={() => setShowFilterPopover((v) => !v)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            {advancedFilterCount > 0 && (
              <span className="sidebar-filter-count">{advancedFilterCount}</span>
            )}
          </button>
        </div>

        <div className="sidebar-import-wrapper">
          <button
            ref={importBtnRef}
            className="sidebar-import-btn"
            title="Import games"
            onClick={() => setShowImportMenu((v) => !v)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ width: 16, height: 16 }}
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span style={{ marginLeft: "var(--space-sm)", fontSize: "var(--font-size-sm)", fontWeight: "var(--font-weight-medium)" }}>Import Games</span>
          </button>

          {showImportMenu && (
            <div ref={importMenuRef} className="sidebar-import-menu" onMouseDown={(e) => e.stopPropagation()}>
              <button
                className="sidebar-import-option"
                onClick={handleImportExe}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="12" y1="18" x2="12" y2="12" />
                  <line x1="9" y1="15" x2="15" y2="15" />
                </svg>
                <div className="sidebar-import-option-text">
                  <span className="sidebar-import-option-title">
                    Import Game EXE
                  </span>
                  <span className="sidebar-import-option-desc">
                    Add a single game executable
                  </span>
                </div>
              </button>
              <button
                className="sidebar-import-option"
                onClick={handleImportFolder}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  <line x1="12" y1="11" x2="12" y2="17" />
                  <line x1="9" y1="14" x2="15" y2="14" />
                </svg>
                <div className="sidebar-import-option-text">
                  <span className="sidebar-import-option-title">
                    Import Folder
                  </span>
                  <span className="sidebar-import-option-desc">
                    Scan folder for all executables
                  </span>
                </div>
              </button>
            </div>
          )}
        </div>
      </div>

      <hr className="sidebar-divider" />

      <div className="sidebar-list-header">
        <span>Games</span>
        <span className="sidebar-list-count">{filteredGames.length}</span>
      </div>

      <div className="sidebar-list">
        {filteredGames.length === 0 ? (
          <div className="sidebar-empty">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            <p>{games.length === 0 ? "No games imported yet" : "No games found"}</p>
            {games.length === 0 && (
              <button onClick={() => setShowImportMenu(true)}>
                + Import Games
              </button>
            )}
          </div>
        ) : (
          filteredGames.map((game) => (
            <div
              key={game.id}
              className={`sidebar-game-item${selectedGameId === game.id ? " active" : ""}`}
              onClick={() => handleGameClick(game)}
              onContextMenu={(e) => handleGameContextMenu(e, game)}
            >
              <div className="sidebar-game-icon">
                {game.iconUrl ? (
                  <img src={game.iconUrl} alt={game.name} />
                ) : game.coverArtUrl ? (
                  <img src={game.coverArtUrl} alt={game.name} />
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
                className={`sidebar-game-status ${runningGameIds.includes(game.id) ? "running" : game.installed ? "installed" : "not-installed"}`}
              />
            </div>
          ))
        )}
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          game={contextMenu.game}
          isRunning={runningGameIds.includes(contextMenu.game.id)}
          onLaunch={() => handleLaunchFromContextMenu(contextMenu.game)}
          onViewDetails={() => handleViewDetailsFromContextMenu(contextMenu.game)}
          onRemove={() => handleRemoveFromContextMenu(contextMenu.game)}
        />
      )}

      {showImportModal && (
        <ImportModal
          exeInfos={scannedExes}
          onConfirm={handleConfirmImport}
          onCancel={() => setShowImportModal(false)}
        />
      )}

      {showFilterPopover && (
        <SidebarFilterPopover
          anchorRef={filterBtnRef}
          status={filterState.status}
          selectedGenres={filterState.genres}
          selectedPlatforms={filterState.platforms}
          yearMin={filterState.yearMin}
          yearMax={filterState.yearMax}
          ratingMin={filterState.ratingMin}
          availableGenres={availableGenres}
          availablePlatforms={availablePlatforms}
          totalGames={games.length}
          filteredCount={filteredGames.length}
          onStatusChange={setStatus}
          onGenresChange={setGenres}
          onPlatformsChange={setPlatforms}
          onYearRangeChange={setYearRange}
          onRatingMinChange={setRatingMin}
          onReset={reset}
          onClose={() => setShowFilterPopover(false)}
        />
      )}
    </aside>
  );
}

interface SidebarContextMenuProps {
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
}: SidebarContextMenuProps) {
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
