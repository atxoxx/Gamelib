import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useGames } from "../context/GameContext";
import { useToast } from "../context/ToastContext";
import { gameNameFromPath, type Game } from "../types/game";
import ImportModal, { type ExeInfo } from "./ImportModal";

export default function Sidebar() {
  const navigate = useNavigate();
  const { games, selectedGameId, addGame, addGames, setSelectedGameId, removeGame } =
    useGames();
  const { showToast } = useToast();

  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ gameId: string; x: number; y: number } | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [scannedExes, setScannedExes] = useState<ExeInfo[]>([]);

  const importMenuRef = useRef<HTMLDivElement>(null);
  const importBtnRef = useRef<HTMLButtonElement>(null);

  // Close import menu and context menu on outside click
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

  const filters = ["All", "Installed"];

  const filteredGames = games.filter((game) => {
    const matchesSearch = game.name.toLowerCase().includes(search.toLowerCase());
    if (!activeFilter || activeFilter === "All") return matchesSearch;
    if (activeFilter === "Installed") return matchesSearch && game.installed;
    return matchesSearch;
  });

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
        addGame({
          id: "",
          name: gameNameFromPath(filePath),
          path: filePath,
          platform: "Local",
          installed: true,
          playTime: "0h",
          addedAt: Date.now(),
        });
        showToast(`Imported ${gameNameFromPath(filePath)}`, "success");
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

  function handleConfirmImport(selectedPaths: string[]) {
    setShowImportModal(false);
    const importedGames = selectedPaths.map((exePath) => ({
      id: "",
      name: gameNameFromPath(exePath),
      path: exePath,
      platform: "Local",
      installed: true,
      playTime: "0h",
      addedAt: Date.now(),
    }));
    addGames(importedGames);
    showToast(`Imported ${importedGames.length} game${importedGames.length !== 1 ? "s" : ""}`, "success");
  }

  function handleGameContextMenu(e: React.MouseEvent, game: Game) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ gameId: game.id, x: e.clientX, y: e.clientY });
  }

  function handleRemoveFromContextMenu() {
    if (!contextMenu) return;
    const game = games.find((g) => g.id === contextMenu.gameId);
    removeGame(contextMenu.gameId);
    setContextMenu(null);
    if (game) showToast(`Removed ${game.name}`, "info");
  }

  function handleGameClick(game: Game) {
    setSelectedGameId(game.id);
    navigate(`/library/${game.id}`);
  }

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
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
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

      <div className="sidebar-filters">
        {filters.map((filter) => (
          <button
            key={filter}
            className={`sidebar-filter-btn${activeFilter === filter ? " active" : ""}`}
            onClick={() =>
              setActiveFilter(activeFilter === filter ? null : filter)
            }
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
                {game.coverArtUrl ? (
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
                className={`sidebar-game-status ${game.installed ? "installed" : "not-installed"}`}
              />
            </div>
          ))
        )}
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onRemove={handleRemoveFromContextMenu}
        />
      )}

      {showImportModal && (
        <ImportModal
          exeInfos={scannedExes}
          onConfirm={handleConfirmImport}
          onCancel={() => setShowImportModal(false)}
        />
      )}
    </aside>
  );
}

/* Inline context menu */
function ContextMenu({ x, y, onRemove }: { x: number; y: number; onRemove: () => void }) {
  return (
    <div className="context-menu" style={{ left: x, top: y }} onMouseDown={(e) => e.stopPropagation()}>
      <button className="context-menu-item" onClick={onRemove}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
        Remove from Library
      </button>
    </div>
  );
}
