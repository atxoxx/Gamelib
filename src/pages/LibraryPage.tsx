import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useGames } from "../context/GameContext";
import { useToast } from "../context/ToastContext";
import type { Game } from "../types/game";

export default function LibraryPage() {
  const navigate = useNavigate();
  const { games, setSelectedGameId, runningGameIds, launchGame, removeGame } = useGames();
  const { showToast } = useToast();

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
      <h2 className="library-heading">Library ({games.length})</h2>
      <div className="library-cards">
        {games.map((game) => {
          const isRunning = runningGameIds.includes(game.id);
          return (
            <div
              key={game.id}
              className={`library-card${isRunning ? " running" : ""}`}
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
                <span className={`library-card-platform platform-${game.platform.toLowerCase()}`}>
                  {game.platform}
                </span>
                {game.notes ? (
                  <p className="library-card-notes">{game.notes}</p>
                ) : (
                  <p className="library-card-notes library-card-notes-empty">
                    No notes
                  </p>
                )}
              </div>
            </div>
          );
        })}
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
