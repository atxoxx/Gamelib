import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useGames } from "../context/GameContext";
import { useToast } from "../context/ToastContext";
import type { Game, GameMetadataResult } from "../types/game";

/** Inline reusable image slot for the edit form. */
function EditImageSlot({
  label,
  subtitle,
  imageUrl,
  previewSize,
  isFetching,
  onChooseFile,
  onFetchWeb,
  onRemove,
}: {
  label: string;
  subtitle: string;
  imageUrl: string;
  previewSize: { w: number; h: number };
  isFetching: boolean;
  onChooseFile: () => void;
  onFetchWeb: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="edit-image-slot">
      <div className="edit-image-slot-header">
        <span className="edit-image-slot-label">{label}</span>
        <span className="edit-image-slot-subtitle">{subtitle}</span>
      </div>
      <div
        className="edit-image-slot-preview"
        style={{ width: previewSize.w, height: previewSize.h }}
      >
        {imageUrl ? (
          <img src={imageUrl} alt={label} />
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            opacity={0.2}
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        )}
      </div>
      <div className="edit-image-slot-actions">
        <button
          className="game-edit-btn edit-img-btn"
          onClick={onChooseFile}
          type="button"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          File
        </button>
        <button
          className="game-edit-btn edit-img-btn edit-img-fetch"
          onClick={onFetchWeb}
          type="button"
          disabled={isFetching}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          {isFetching ? "..." : "Fetch"}
        </button>
        {imageUrl && (
          <button
            className="game-edit-btn edit-img-btn edit-img-remove"
            onClick={onRemove}
            type="button"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

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
  const [activeTab, setActiveTab] = useState<"overview" | "reviews" | "activity" | "weblinks">("overview");

  // Metadata fetching state
  const [fetchingMetadata, setFetchingMetadata] = useState(false);
  const [metadataResults, setMetadataResults] = useState<GameMetadataResult[]>([]);
  const [showMetadataPanel, setShowMetadataPanel] = useState(false);
  const [applyingMetadata, setApplyingMetadata] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(game.name);
  const [editPlatform, setEditPlatform] = useState(game.platform);
  const [editIcon, setEditIcon] = useState(game.iconUrl || "");
  const [editCover, setEditCover] = useState(game.coverArtUrl || "");
  const [editHero, setEditHero] = useState(game.bannerUrl || "");
  const [editLogo, setEditLogo] = useState(game.logoUrl || "");
  const [editNotes, setEditNotes] = useState(game.notes || "");

  // Track which image is being fetched
  const [fetchingImageKey, setFetchingImageKey] = useState<string | null>(null);

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
    setEditIcon(game.iconUrl || "");
    setEditCover(game.coverArtUrl || "");
    setEditHero(game.bannerUrl || "");
    setEditLogo(game.logoUrl || "");
    setEditNotes(game.notes || "");
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

  async function handleFetchMetadata() {
    setFetchingMetadata(true);
    setMetadataResults([]);
    setShowMetadataPanel(true);
    try {
      const results: GameMetadataResult[] = await invoke("search_game_metadata", {
        gameName: game.name,
      });
      setMetadataResults(results);
      if (results.length === 0) {
        showToast("No metadata found for this game", "info");
      }
    } catch (err) {
      showToast(`Failed to search metadata: ${err}`, "error");
    } finally {
      setFetchingMetadata(false);
    }
  }

  /** Fetch a single image from a metadata result by image key. */
  async function fetchImageFromMetadata(
    imageKey: "icon" | "cover" | "hero" | "banner" | "logo"
  ): Promise<string | undefined> {
    // If we already have metadata results cached, use them
    let results = metadataResults;
    if (results.length === 0) {
      // Search metadata first
      const freshResults: GameMetadataResult[] = await invoke("search_game_metadata", {
        gameName: game.name,
      });
      results = freshResults;
      setMetadataResults(results);
    }
    if (results.length === 0) return undefined;

    const imageUrl = results[0].images[imageKey];
    if (!imageUrl) return undefined;

    const dataUrl: string | null = await invoke("download_image", { url: imageUrl });
    return dataUrl ?? undefined;
  }

  /** Handle the "Fetch from Web" button for a specific image type. */
  async function handleFetchImage(key: "icon" | "cover" | "hero" | "logo") {
    setFetchingImageKey(key);
    try {
      const dataUrl = await fetchImageFromMetadata(key);
      if (dataUrl) {
        if (key === "icon") setEditIcon(dataUrl);
        else if (key === "cover") setEditCover(dataUrl);
        else if (key === "hero") setEditHero(dataUrl);
        else if (key === "logo") setEditLogo(dataUrl);
        showToast(`Fetched ${key} image`, "success");
      } else {
        showToast(`No ${key} image found in metadata`, "info");
      }
    } catch (err) {
      showToast(`Failed to fetch image: ${err}`, "error");
    } finally {
      setFetchingImageKey(null);
    }
  }

  async function handleApplyMetadata(result: GameMetadataResult) {
    setApplyingMetadata(true);
    try {
      // Build an ordered list of [key, url] pairs for images that exist
      const imageKeys = ["icon", "cover", "hero", "banner", "logo"] as const;
      const imageEntries = imageKeys
        .map((key) => [key, result.images[key]] as const)
        .filter(([, url]) => url != null);

      const urls = imageEntries.map(([, url]) => url!);

      // Download all images in parallel via the backend
      let imageDataUrls: (string | null)[] = [];
      if (urls.length > 0) {
        imageDataUrls = await invoke("fetch_game_images", { urls });
      }

      // Build a lookup: key → base64 data URL
      const downloaded: Record<string, string | undefined> = {};
      imageEntries.forEach(([key], idx) => {
        downloaded[key] = imageDataUrls[idx] ?? undefined;
      });

      const iconUrl = downloaded.icon;
      const coverUrl = downloaded.cover || game.coverArtUrl;
      const heroUrl = downloaded.hero;
      const bannerUrl = downloaded.banner;
      const logoUrl = downloaded.logo;

      // Use hero as banner fallback if no dedicated banner was downloaded
      const finalBannerUrl = bannerUrl ?? heroUrl ?? undefined;

      // Single updateGame call
      updateGame(game.id, {
        name: result.title || game.name,
        description: result.description ?? undefined,
        developer: result.developer ?? undefined,
        publisher: result.publisher ?? undefined,
        releaseDate: result.releaseDate ?? undefined,
        genres: result.genres.length > 0 ? result.genres : undefined,
        iconUrl: iconUrl ?? undefined,
        coverArtUrl: coverUrl,
        bannerUrl: finalBannerUrl,
        logoUrl: logoUrl ?? undefined,
        metadataSource: result.sourceName,
        metadataUrl: result.sourceUrl,
      });

      showToast(`Applied metadata from ${result.sourceName}`, "success");
      setShowMetadataPanel(false);
    } catch (err) {
      showToast(`Failed to apply metadata: ${err}`, "error");
    } finally {
      setApplyingMetadata(false);
    }
  }

  async function handlePickImage(key: "icon" | "cover" | "hero" | "logo") {
    try {
      const filePath = await open({
        multiple: false,
        directory: false,
        title: `Select ${key.charAt(0).toUpperCase() + key.slice(1)} Image`,
        filters: [
          { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] },
        ],
      });
      if (filePath && typeof filePath === "string") {
        const dataUrl: string = await invoke("read_cover_image", {
          filePath,
        });
        if (key === "icon") setEditIcon(dataUrl);
        else if (key === "cover") setEditCover(dataUrl);
        else if (key === "hero") setEditHero(dataUrl);
        else if (key === "logo") setEditLogo(dataUrl);
      }
    } catch (err) {
      showToast("Failed to load image", "error");
    }
  }

  function handleRemoveImage(key: "icon" | "cover" | "hero" | "logo") {
    if (key === "icon") setEditIcon("");
    else if (key === "cover") setEditCover("");
    else if (key === "hero") setEditHero("");
    else if (key === "logo") setEditLogo("");
  }

  function saveEdits() {
    const newName = editName.trim() || game.name;
    const newPlatform = editPlatform.trim() || game.platform;
    const newIcon = editIcon || undefined;
    const newCover = editCover || undefined;
    const newHero = editHero || undefined;
    const newLogo = editLogo || undefined;
    const newNotes = editNotes.trim() || undefined;

    if (
      newName === game.name &&
      newPlatform === game.platform &&
      newIcon === game.iconUrl &&
      newCover === game.coverArtUrl &&
      newHero === game.bannerUrl &&
      newLogo === game.logoUrl &&
      newNotes === game.notes
    ) {
      setEditing(false);
      return;
    }

    updateGame(game.id, {
      name: newName,
      platform: newPlatform,
      iconUrl: newIcon,
      coverArtUrl: newCover,
      bannerUrl: newHero,
      logoUrl: newLogo,
      notes: newNotes,
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
        </div>
      </div>

      {/* Hero Section */}
      <div className="game-hero">
        {game.bannerUrl && (
          <div
            className="game-banner-bg"
            style={{ backgroundImage: `url(${game.bannerUrl})` }}
          />
        )}
        <div className="game-banner">
          {(game.bannerUrl || displayCover) ? (
            <img
              src={game.bannerUrl || displayCover}
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
            {game.logoUrl ? (
              <img
                src={game.logoUrl}
                alt={game.name}
                className="game-hero-logo"
              />
            ) : (
              <h1 className="game-hero-title">{displayName}</h1>
            )}
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

      {/* Tabs */}
      <div className="game-tabs">
        {(["overview", "reviews", "activity", "weblinks"] as const).map((tab) => (
          <button
            key={tab}
            className={`game-tab ${activeTab === tab ? "active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "overview" && (
        <div className="game-content-grid">
          <div className="game-main-col">
            {game.description && (
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
                  </svg>
                  About
                </h2>
                <p className="game-description">{game.description}</p>
                {game.metadataSource && game.metadataUrl && (
                  <a
                    className="metadata-source-link"
                    href={game.metadataUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                    View on {game.metadataSource}
                  </a>
                )}
              </section>
            )}
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
                {game.developer && (
                  <div className="info-item">
                    <span className="info-label">Developer</span>
                    <span className="info-value">{game.developer}</span>
                  </div>
                )}
                {game.publisher && (
                  <div className="info-item">
                    <span className="info-label">Publisher</span>
                    <span className="info-value">{game.publisher}</span>
                  </div>
                )}
                {game.releaseDate && (
                  <div className="info-item">
                    <span className="info-label">Released</span>
                    <span className="info-value">{game.releaseDate}</span>
                  </div>
                )}
              </div>
              {game.genres && game.genres.length > 0 && (
                <div className="info-genres">
                  {game.genres.map((g) => (
                    <span key={g} className="metadata-genre-tag">{g}</span>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {activeTab === "reviews" && (
        <div className="game-section game-tab-placeholder">
          <h2 className="game-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Reviews
          </h2>
          <p className="game-tab-placeholder-text">No reviews yet.</p>
        </div>
      )}

      {activeTab === "activity" && (
        <div className="game-section game-tab-placeholder">
          <h2 className="game-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            Activity
          </h2>
          <p className="game-tab-placeholder-text">No recent activity.</p>
        </div>
      )}

      {activeTab === "weblinks" && (
        <div className="game-section game-tab-placeholder">
          <h2 className="game-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            Web Links
          </h2>
          <p className="game-tab-placeholder-text">No links added yet.</p>
        </div>
      )}

      {/* Edit Modal */}
      {editing && (
        <div className="modal-backdrop" onClick={cancelEditing}>
          <div className="modal edit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-header-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </div>
              <div className="modal-header-text">
                <h3 className="modal-title">Edit Game</h3>
                <p className="modal-subtitle">
                  Customize metadata and images for {game.name}
                </p>
              </div>
              <button
                className="game-edit-btn metadata-fetch-btn"
                onClick={handleFetchMetadata}
                disabled={fetchingMetadata}
                style={{ marginRight: 'var(--space-sm)' }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                {fetchingMetadata ? "Searching..." : "Fetch Metadata"}
              </button>
              <button className="metadata-panel-close" onClick={cancelEditing}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="edit-modal-body">
              {/* Metadata Results (inside modal) */}
              {showMetadataPanel && (
                <div className="metadata-panel">
                  <div className="metadata-panel-header">
                    <h3>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                      Metadata Search Results
                    </h3>
                    <button className="metadata-panel-close" onClick={() => setShowMetadataPanel(false)}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                  <div className="metadata-panel-body">
                    {fetchingMetadata ? (
                      <div className="metadata-loading"><div className="metadata-spinner" /><p>Searching for "{game.name}"...</p></div>
                    ) : metadataResults.length === 0 ? (
                      <div className="metadata-empty">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                        <p>No results found. Try a different search term or edit the game name.</p>
                      </div>
                    ) : (
                      <div className="metadata-results">
                        {metadataResults.map((result, idx) => (
                          <div key={idx} className="metadata-result-card">
                            <div className="metadata-result-header">
                              <span className="metadata-result-source">{result.sourceName}</span>
                              <a href={result.sourceUrl} target="_blank" rel="noopener noreferrer" className="metadata-result-link" title="Open source page">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                              </a>
                            </div>
                            <div className="metadata-result-title">{result.title}</div>
                            {result.description && <p className="metadata-result-desc">{result.description}</p>}
                            <div className="metadata-result-details">
                              {result.developer && <span><strong>Dev:</strong> {result.developer}</span>}
                              {result.publisher && <span><strong>Pub:</strong> {result.publisher}</span>}
                              {result.releaseDate && <span><strong>Released:</strong> {result.releaseDate}</span>}
                            </div>
                            {result.genres.length > 0 && (
                              <div className="metadata-result-genres">{result.genres.map((g) => <span key={g} className="metadata-genre-tag">{g}</span>)}</div>
                            )}
                            <button className="metadata-apply-btn" disabled={applyingMetadata} onClick={() => handleApplyMetadata(result)}>
                              {applyingMetadata ? 'Applying...' : (<><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>Apply Metadata</>)}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="edit-form">
                <div className="edit-field">
                  <label className="edit-label" htmlFor="edit-name">Name</label>
                  <input id="edit-name" className="edit-input" type="text" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Game name" />
                </div>
                <div className="edit-field">
                  <label className="edit-label" htmlFor="edit-platform">Platform</label>
                  <input id="edit-platform" className="edit-input" type="text" value={editPlatform} onChange={(e) => setEditPlatform(e.target.value)} placeholder="e.g., Steam, GOG, Local" />
                </div>
                <div className="edit-field">
                  <label className="edit-label" htmlFor="edit-notes">Notes</label>
                  <textarea id="edit-notes" className="edit-input edit-textarea" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Personal notes about this game..." rows={3} />
                </div>
              </div>

              <h4 className="edit-modal-section-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                Images
              </h4>
              <div className="edit-images-grid">
                <EditImageSlot label="Icon" subtitle="Sidebar" imageUrl={editIcon} previewSize={{ w: 64, h: 64 }} isFetching={fetchingImageKey === "icon"} onChooseFile={() => handlePickImage("icon")} onFetchWeb={() => handleFetchImage("icon")} onRemove={() => handleRemoveImage("icon")} />
                <EditImageSlot label="Cover Art" subtitle="Library cards" imageUrl={editCover} previewSize={{ w: 120, h: 160 }} isFetching={fetchingImageKey === "cover"} onChooseFile={() => handlePickImage("cover")} onFetchWeb={() => handleFetchImage("cover")} onRemove={() => handleRemoveImage("cover")} />
                <EditImageSlot label="Hero Banner" subtitle="Game page top" imageUrl={editHero} previewSize={{ w: 240, h: 100 }} isFetching={fetchingImageKey === "hero"} onChooseFile={() => handlePickImage("hero")} onFetchWeb={() => handleFetchImage("hero")} onRemove={() => handleRemoveImage("hero")} />
                <EditImageSlot label="Logo" subtitle="Title image" imageUrl={editLogo} previewSize={{ w: 200, h: 60 }} isFetching={fetchingImageKey === "logo"} onChooseFile={() => handlePickImage("logo")} onFetchWeb={() => handleFetchImage("logo")} onRemove={() => handleRemoveImage("logo")} />
              </div>
            </div>

            <div className="modal-footer">
              <span className="modal-footer-count"></span>
              <div className="modal-footer-actions">
                <button className="modal-btn modal-btn-cancel" onClick={cancelEditing}>Cancel</button>
                <button className="modal-btn modal-btn-confirm" onClick={saveEdits}>Save Changes</button>
              </div>
            </div>
          </div>
        </div>
      )}
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
