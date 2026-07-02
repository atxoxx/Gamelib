import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useGames } from "../context/GameContext";
import { useToast } from "../context/ToastContext";
import type { Game } from "../types/game";

function GameNotFound() {
  const navigate = useNavigate();
  return (
    <div className="main-empty">
      <svg
        className="main-empty-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
      <h2 className="main-empty-title">Game Not Found</h2>
      <p className="main-empty-subtitle">
        This game could not be found. It may have been removed or the link is
        invalid.
      </p>
      <button className="game-back-btn" onClick={() => navigate("/library")}>
        Back to Library
      </button>
    </div>
  );
}

function GameDetail({ game }: { game: Game }) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { updateGame, removeGame } = useGames();

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(game.name);
  const [editPlatform, setEditPlatform] = useState(game.platform);
  const [editCover, setEditCover] = useState(game.coverArtUrl || "");

  function handleLaunch() {
    invoke("launch_game", { gameId: game.id, gamePath: game.path })
      .then(() => showToast(`Launched ${game.name}`, "success"))
      .catch((err: string) => showToast(err, "error"));
  }

  function handleBack() {
    navigate("/library");
  }

  function startEditing() {
    setEditName(game.name);
    setEditPlatform(game.platform);
    setEditCover(game.coverArtUrl || "");
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
  }

  function handleDelete() {
    removeGame(game.id);
    navigate("/library");
    showToast(`Removed ${game.name}`, "info");
  }

  async function handlePickCover() {
    try {
      const filePath = await open({
        multiple: false,
        directory: false,
        title: "Select Cover Art",
        filters: [
          { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] },
        ],
      });
      if (filePath && typeof filePath === "string") {
        const dataUrl: string = await invoke("read_cover_image", {
          filePath,
        });
        setEditCover(dataUrl);
      }
    } catch (err) {
      showToast("Failed to load cover image", "error");
    }
  }

  function handleRemoveCover() {
    setEditCover("");
  }

  function saveEdits() {
    const newName = editName.trim() || game.name;
    const newPlatform = editPlatform.trim() || game.platform;
    const newCover = editCover || undefined;

    // Skip save if nothing changed
    if (
      newName === game.name &&
      newPlatform === game.platform &&
      newCover === game.coverArtUrl
    ) {
      setEditing(false);
      return;
    }

    updateGame(game.id, {
      name: newName,
      platform: newPlatform,
      coverArtUrl: newCover,
    });
    setEditing(false);
    showToast("Game updated", "success");
  }

  const displayName = editing ? editName : game.name;
  const displayPlatform = editing ? editPlatform : game.platform;
  const displayCover = editing ? editCover : game.coverArtUrl;

  const addedDate = new Date(game.addedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="game-page">
      {/* Breadcrumb / Actions */}
      <div className="game-top-bar">
        <button className="game-back-link" onClick={handleBack}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Library
        </button>

        <div className="game-top-actions">
          {editing ? (
            <>
              <button
                className="game-edit-btn game-edit-cancel"
                onClick={cancelEditing}
              >
                Cancel
              </button>
              <button
                className="game-edit-btn game-edit-save"
                onClick={saveEdits}
              >
                Save Changes
              </button>
            </>
          ) : (
            <>
              <button className="game-edit-btn" onClick={startEditing}>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                Edit
              </button>
              {showDeleteConfirm ? (
                <>
                  <span className="delete-confirm-text">Are you sure?</span>
                  <button
                    className="game-edit-btn game-edit-danger"
                    onClick={handleDelete}
                  >
                    Delete
                  </button>
                  <button
                    className="game-edit-btn game-edit-cancel"
                    onClick={() => setShowDeleteConfirm(false)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  className="game-edit-btn game-delete-btn"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  Remove
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Hero Section */}
      <div className="game-hero">
        <div className="game-banner">
          {displayCover ? (
            <img
              src={displayCover}
              alt={game.name}
              className="game-cover-img"
            />
          ) : (
            <svg
              width="64"
              height="64"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              opacity={0.2}
            >
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          )}
        </div>
        <div className="game-hero-overlay">
          <div className="game-hero-info">
            <h1 className="game-hero-title">{displayName}</h1>
            <div className="game-hero-meta">
              <span>{displayPlatform}</span>
              <span className="game-hero-meta-dot" />
              <span>Play time: {game.playTime}</span>
              <span className="game-hero-meta-dot" />
              <span>Added {addedDate}</span>
            </div>
          </div>
          {!editing && (
            <button className="game-launch-btn" onClick={handleLaunch}>
              <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Launch Game
            </button>
          )}
        </div>
      </div>

      {/* Edit Form */}
      {editing && (
        <section className="game-section game-edit-section">
          <h2 className="game-section-title">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Edit Metadata
          </h2>

          <div className="edit-form">
            <div className="edit-field">
              <label className="edit-label" htmlFor="edit-name">
                Name
              </label>
              <input
                id="edit-name"
                className="edit-input"
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Game name"
              />
            </div>

            <div className="edit-field">
              <label className="edit-label" htmlFor="edit-platform">
                Platform
              </label>
              <input
                id="edit-platform"
                className="edit-input"
                type="text"
                value={editPlatform}
                onChange={(e) => setEditPlatform(e.target.value)}
                placeholder="e.g., Steam, GOG, Local"
              />
            </div>

            <div className="edit-field">
              <label className="edit-label">Cover Art</label>
              <div className="edit-cover-row">
                {editCover && (
                  <div className="edit-cover-preview">
                    <img src={editCover} alt="Cover preview" />
                  </div>
                )}
                <div className="edit-cover-actions">
                  <button
                    className="game-edit-btn"
                    onClick={handlePickCover}
                    type="button"
                  >
                    {editCover ? "Change Image" : "Choose Image"}
                  </button>
                  {editCover && (
                    <button
                      className="game-edit-btn game-edit-cancel"
                      onClick={handleRemoveCover}
                      type="button"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Content Grid */}
      <div className="game-content-grid">
        <div className="game-main-col">
          <section className="game-section">
            <h2 className="game-section-title">
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
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              Details
            </h2>
            <p className="game-description">
              <strong>Executable Path:</strong>{" "}
              <code className="game-path">{game.path}</code>
            </p>
          </section>
        </div>

        <div className="game-side-col">
          <section className="game-section">
            <h2 className="game-section-title">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              Info
            </h2>
            <div className="info-grid">
              <div className="info-item">
                <span className="info-label">Platform</span>
                <span className="info-value">{game.platform}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Status</span>
                <span className="info-value">
                  {game.installed ? "Installed" : "Not Installed"}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">Play Time</span>
                <span className="info-value">{game.playTime}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Added</span>
                <span className="info-value">{addedDate}</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function GamePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const { getGame, setSelectedGameId } = useGames();

  useEffect(() => {
    if (gameId) {
      setSelectedGameId(gameId);
    }
  }, [gameId, setSelectedGameId]);

  const game = gameId ? getGame(gameId) : undefined;

  if (!game) {
    return <GameNotFound />;
  }

  return <GameDetail key={game.id} game={game} />;
}
