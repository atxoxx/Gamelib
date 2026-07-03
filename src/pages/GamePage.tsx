import { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useGames } from "../context/GameContext";
import { useActivity } from "../context/ActivityContext";
import { useToast } from "../context/ToastContext";
import { type Game, type GameMetadataResult, type LaunchBoxImageResult, type ActivityStats, type GameSession, type SessionMetrics, formatPlayTime, buildSessionMetricsSeries } from "../types/game";
import BarChart from "../components/charts/BarChart";
import LineChart from "../components/charts/LineChart";

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
  const { updateGame, removeGame, runningGameIds, launchGame } = useGames();
  const isRunning = runningGameIds.includes(game.id);

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

  // Reviews state
  const [rating, setRating] = useState(game.rating || 0);
  const [reviewInput, setReviewInput] = useState(game.reviewText || "");
  const [reviewText, setReviewText] = useState(game.reviewText || "");
  const [isEditingReview, setIsEditingReview] = useState(false);

  // LaunchBox Image Browser state
  const [showImageBrowser, setShowImageBrowser] = useState(false);
  const [lbImages, setLbImages] = useState<LaunchBoxImageResult[]>([]);
  const [lbLoading, setLbLoading] = useState(false);
  const [lbSelectedCategory, setLbSelectedCategory] = useState<string>("all");
  const [lbApplyingUrl, setLbApplyingUrl] = useState<string | null>(null);

  // Sync state when game changes
  useEffect(() => {
    setRating(game.rating || 0);
    setReviewInput(game.reviewText || "");
    setReviewText(game.reviewText || "");
    setIsEditingReview(false);
  }, [game.id, game.rating, game.reviewText]);

  function handleLaunch() {
    launchGame(game);
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


  /** Handle the "Fetch from Web" button for a specific image type. */
  async function handleFetchImage(key: "icon" | "cover" | "hero" | "logo") {
    setFetchingImageKey(key);
    try {
      // Find remote image URL from results
      let results = metadataResults;
      if (results.length === 0) {
        const freshResults: GameMetadataResult[] = await invoke("search_game_metadata", {
          gameName: game.name,
        });
        results = freshResults;
        setMetadataResults(results);
      }

      if (results.length > 0) {
        const imageUrl = results[0].images[key];
        if (imageUrl) {
          // Optimistically update instantly
          if (key === "icon") setEditIcon(imageUrl);
          else if (key === "cover") setEditCover(imageUrl);
          else if (key === "hero") setEditHero(imageUrl);
          else if (key === "logo") setEditLogo(imageUrl);

          // Download in background
          const dataUrl: string | null = await invoke("download_image", { url: imageUrl });
          if (dataUrl) {
            if (key === "icon") setEditIcon(dataUrl);
            else if (key === "cover") setEditCover(dataUrl);
            else if (key === "hero") setEditHero(dataUrl);
            else if (key === "logo") setEditLogo(dataUrl);
            showToast(`Fetched and saved ${key} image`, "success");
            return;
          }
        }
      }
      showToast(`No ${key} image found in metadata`, "info");
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

  // ─── LaunchBox Image Browser Handlers ───────────────────────────────────────

  async function handleOpenImageBrowser() {
    setShowImageBrowser(true);
    setLbSelectedCategory("all");
    if (lbImages.length > 0) return; // already loaded
    setLbLoading(true);
    try {
      const images: LaunchBoxImageResult[] = await invoke("search_launchbox_images", {
        gameName: game.name,
      });
      setLbImages(images);
      if (images.length === 0) {
        showToast("No images found on LaunchBox", "info");
      }
    } catch (err) {
      showToast(`LaunchBox image search failed: ${err}`, "error");
    } finally {
      setLbLoading(false);
    }
  }

  async function handleApplyLbImage(imageUrl: string, slot: "icon" | "cover" | "hero" | "banner" | "logo") {
    setLbApplyingUrl(imageUrl);
    try {
      // Optimistically update instantly
      if (editing) {
        if (slot === "icon") setEditIcon(imageUrl);
        else if (slot === "cover") setEditCover(imageUrl);
        else if (slot === "hero" || slot === "banner") setEditHero(imageUrl);
        else if (slot === "logo") setEditLogo(imageUrl);
      } else {
        const update: Record<string, string | undefined> = {};
        if (slot === "icon") update.iconUrl = imageUrl;
        else if (slot === "cover") update.coverArtUrl = imageUrl;
        else if (slot === "hero" || slot === "banner") update.bannerUrl = imageUrl;
        else if (slot === "logo") update.logoUrl = imageUrl;
        updateGame(game.id, update);
      }

      // Download in background
      const dataUrl: string | null = await invoke("download_image", { url: imageUrl });
      if (dataUrl) {
        if (editing) {
          if (slot === "icon") setEditIcon(dataUrl);
          else if (slot === "cover") setEditCover(dataUrl);
          else if (slot === "hero" || slot === "banner") setEditHero(dataUrl);
          else if (slot === "logo") setEditLogo(dataUrl);
        } else {
          const update: Record<string, string | undefined> = {};
          if (slot === "icon") update.iconUrl = dataUrl;
          else if (slot === "cover") update.coverArtUrl = dataUrl;
          else if (slot === "hero" || slot === "banner") update.bannerUrl = dataUrl;
          else if (slot === "logo") update.logoUrl = dataUrl;
          updateGame(game.id, update);
        }
        showToast(`Applied and saved image as ${slot}`, "success");
      } else {
        showToast("Failed to download image", "error");
      }
    } catch (err) {
      showToast(`Failed to apply image: ${err}`, "error");
    } finally {
      setLbApplyingUrl(null);
    }
  }

  function getLbCategories(): string[] {
    const cats = new Set(lbImages.map((i) => i.category));
    return Array.from(cats);
  }

  function getFilteredLbImages(): LaunchBoxImageResult[] {
    if (lbSelectedCategory === "all") return lbImages;
    return lbImages.filter((i) => i.category === lbSelectedCategory);
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

  function handleSaveReview() {
    updateGame(game.id, {
      rating: rating > 0 ? rating : undefined,
      reviewText: reviewInput.trim() || undefined,
    });
    setReviewText(reviewInput.trim());
    setIsEditingReview(false);
    showToast("Review saved", "success");
  }

  function handleDeleteReview() {
    updateGame(game.id, {
      rating: undefined,
      reviewText: undefined,
    });
    setRating(0);
    setReviewText("");
    setReviewInput("");
    setIsEditingReview(false);
    showToast("Review deleted", "info");
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
            <button
              className={`game-launch-btn${isRunning ? " running" : ""}`}
              onClick={handleLaunch}
              disabled={isRunning}
            >
              {isRunning ? (
                <>
                  <span className="running-dot-pulse" />
                  Running...
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  Launch Game
                </>
              )}
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

            {/* LaunchBox Metadata Card */}
            <section className="game-section lb-card">
              <h2 className="game-section-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="20" height="20" rx="2" />
                  <path d="M7 2v20" />
                  <path d="M2 12h5" />
                  <path d="M2 7h5" />
                  <path d="M2 17h5" />
                </svg>
                LaunchBox
              </h2>
              {game.metadataSource === "LaunchBox" && game.metadataUrl ? (
                <div className="lb-card-content">
                  <a className="lb-card-link" href={game.metadataUrl} target="_blank" rel="noopener noreferrer">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                    View on LaunchBox DB
                  </a>
                  <button className="lb-card-browse-btn" onClick={handleOpenImageBrowser} type="button">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                    Browse Images
                  </button>
                </div>
              ) : (
                <div className="lb-card-content">
                  <p className="lb-card-desc">Search LaunchBox Games Database for box art, banners, logos, screenshots, and more.</p>
                  <button className="lb-card-browse-btn" onClick={handleOpenImageBrowser} type="button">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    Search LaunchBox Images
                  </button>
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {activeTab === "reviews" && (
        <div className="game-section">
          <h2 className="game-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Player Review
          </h2>

          {(!reviewText && !rating && !isEditingReview) || isEditingReview ? (
            <div className="review-writer">
              <h3>{isEditingReview ? "Edit your review" : "Rate and review this game"}</h3>
              <div className="review-stars-select">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    className={`star-select-btn${star <= rating ? " selected" : ""}`}
                    onClick={() => setRating(star)}
                    type="button"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  </button>
                ))}
              </div>
              <textarea
                className="edit-input edit-textarea"
                value={reviewInput}
                onChange={(e) => setReviewInput(e.target.value)}
                placeholder="Write your review here..."
                rows={4}
              />
              <div className="review-writer-actions">
                {isEditingReview && (
                  <button
                    className="game-edit-btn game-edit-cancel"
                    onClick={() => {
                      setRating(game.rating || 0);
                      setReviewInput(game.reviewText || "");
                      setIsEditingReview(false);
                    }}
                  >
                    Cancel
                  </button>
                )}
                <button
                  className="game-edit-btn game-edit-save"
                  onClick={handleSaveReview}
                  disabled={rating === 0 && !reviewInput.trim()}
                >
                  Save Review
                </button>
              </div>
            </div>
          ) : (
            <div className="user-review-card">
              <div className="user-review-header">
                <div className="user-review-avatar">
                  <span>ME</span>
                </div>
                <div className="user-review-meta">
                  <div className="user-review-name">
                    You <span className="verified-badge">Verified Player</span>
                  </div>
                  <div className="user-review-stars">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <svg
                        key={star}
                        className={`review-star-icon${star <= rating ? " active" : ""}`}
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                    ))}
                  </div>
                </div>
                <div className="user-review-actions">
                  <button
                    className="review-action-btn"
                    onClick={() => setIsEditingReview(true)}
                    title="Edit Review"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  <button
                    className="review-action-btn review-delete"
                    onClick={handleDeleteReview}
                    title="Delete Review"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </div>
              {reviewText && <p className="user-review-text">{reviewText}</p>}
            </div>
          )}
        </div>
      )}

      {activeTab === "activity" && <GameActivityTab game={game} />}

      {activeTab === "weblinks" && (
        <div className="game-section">
          <h2 className="game-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            External Web Resources
          </h2>
          <div className="weblinks-grid">
            <a
              href={`https://store.steampowered.com/search/?term=${encodeURIComponent(game.name)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="weblink-card"
            >
              <div className="weblink-icon steam">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2A10 10 0 0 0 2.13 11.28l5.86 2.43a3.5 3.5 0 0 1 6.55.8l5.34-1.8A10 10 0 0 0 12 2zm-3.5 13.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" />
                </svg>
              </div>
              <div className="weblink-info">
                <h4>Steam Store</h4>
                <p>View community hub, reviews, guides and patch notes on Steam.</p>
              </div>
              <svg className="weblink-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </a>
            <a
              href={`https://www.gog.com/en/games?query=${encodeURIComponent(game.name)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="weblink-card"
            >
              <div className="weblink-icon gog">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="12" r="10" />
                </svg>
              </div>
              <div className="weblink-info">
                <h4>GOG Store</h4>
                <p>Check DRM-free listings, manuals, and classic downloads on GOG.</p>
              </div>
              <svg className="weblink-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </a>
            <a
              href={`https://www.pcgamingwiki.com/w/index.php?search=${encodeURIComponent(game.name)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="weblink-card"
            >
              <div className="weblink-icon pcwiki">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                </svg>
              </div>
              <div className="weblink-info">
                <h4>PCGamingWiki</h4>
                <p>Fix graphics issues, frame rate limits, support wide resolutions, and edit config files.</p>
              </div>
              <svg className="weblink-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </a>
            <a
              href={`https://www.youtube.com/results?search_query=${encodeURIComponent(game.name)}+game+trailer`}
              target="_blank"
              rel="noopener noreferrer"
              className="weblink-card"
            >
              <div className="weblink-icon youtube">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M23.498 6.163a3.003 3.003 0 0 0-2.11-2.11C19.517 3.545 12 3.545 12 3.545s-7.517 0-9.388.508a3.003 3.003 0 0 0-2.11 2.11C0 8.033 0 12 0 12s0 3.967.502 5.837a3.003 3.003 0 0 0 2.11 2.11c1.871.508 9.388.508 9.388.508s7.517 0 9.388-.508a3.002 3.002 0 0 0 2.11-2.11C24 15.967 24 12 24 12s0-3.967-.502-5.837zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                </svg>
              </div>
              <div className="weblink-info">
                <h4>YouTube Media</h4>
                <p>Search game trailers, reviews, Let's Plays, walkthroughs, and visual guides.</p>
              </div>
              <svg className="weblink-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </a>
          </div>
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
              <button className="lb-browse-edit-btn" onClick={handleOpenImageBrowser} type="button">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="20" height="20" rx="2" />
                  <path d="M7 2v20" />
                  <path d="M2 12h5" />
                </svg>
                Browse LaunchBox Images
              </button>
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

      {/* LaunchBox Image Browser Modal */}
      {showImageBrowser && (
        <div className="modal-backdrop" onClick={() => setShowImageBrowser(false)}>
          <div className="modal lb-browser-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-header-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="20" height="20" rx="2" />
                  <path d="M7 2v20" />
                  <path d="M2 12h5" />
                  <path d="M2 7h5" />
                  <path d="M2 17h5" />
                </svg>
              </div>
              <div className="modal-header-text">
                <h3 className="modal-title">LaunchBox Image Browser</h3>
                <p className="modal-subtitle">Browse and apply images from LaunchBox Games Database for {game.name}</p>
              </div>
              <button className="metadata-panel-close" onClick={() => setShowImageBrowser(false)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Category filter tabs */}
            <div className="lb-category-tabs">
              <button
                className={`lb-cat-tab ${lbSelectedCategory === "all" ? "active" : ""}`}
                onClick={() => setLbSelectedCategory("all")}
              >
                All ({lbImages.length})
              </button>
              {getLbCategories().map((cat) => (
                <button
                  key={cat}
                  className={`lb-cat-tab ${lbSelectedCategory === cat ? "active" : ""}`}
                  onClick={() => setLbSelectedCategory(cat)}
                >
                  {cat} ({lbImages.filter((i) => i.category === cat).length})
                </button>
              ))}
            </div>

            <div className="lb-browser-body">
              {lbLoading ? (
                <div className="metadata-loading">
                  <div className="metadata-spinner" />
                  <p>Searching LaunchBox for "{game.name}"...</p>
                </div>
              ) : lbImages.length === 0 ? (
                <div className="metadata-empty">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  <p>No images found. Try editing the game name and searching again.</p>
                </div>
              ) : (
                <div className="lb-image-grid">
                  {getFilteredLbImages().map((img, idx) => (
                    <div key={idx} className="lb-image-card">
                      <div className="lb-image-thumb">
                        <img src={img.url} alt={`${img.category} ${img.region || ""}`} loading="lazy" />
                      </div>
                      <div className="lb-image-info">
                        <span className="lb-image-category">{img.category}</span>
                        <span className="lb-image-meta">
                          {img.region && <span className="lb-image-region">{img.region}</span>}
                          {img.resolution && <span className="lb-image-res">{img.resolution}</span>}
                        </span>
                      </div>
                      <div className="lb-image-actions">
                        <button
                          className="lb-apply-btn"
                          onClick={() => handleApplyLbImage(img.url, "icon")}
                          disabled={lbApplyingUrl === img.url}
                        >
                          {lbApplyingUrl === img.url ? "..." : "Icon"}
                        </button>
                        <button
                          className="lb-apply-btn"
                          onClick={() => handleApplyLbImage(img.url, "cover")}
                          disabled={lbApplyingUrl === img.url}
                        >
                          {lbApplyingUrl === img.url ? "..." : "Cover"}
                        </button>
                        <button
                          className="lb-apply-btn"
                          onClick={() => handleApplyLbImage(img.url, "hero")}
                          disabled={lbApplyingUrl === img.url}
                        >
                          {lbApplyingUrl === img.url ? "..." : "Hero"}
                        </button>
                        <button
                          className="lb-apply-btn"
                          onClick={() => handleApplyLbImage(img.url, "logo")}
                          disabled={lbApplyingUrl === img.url}
                        >
                          {lbApplyingUrl === img.url ? "..." : "Logo"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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

// ─── Game Activity Tab Component ──────────────────────────────────────────────

type GameActivitySubTab = "overview" | "performance" | "sessions";

function GameActivityTab({ game }: { game: Game }) {
  const { getGameSessions, getGameStats } = useActivity();
  const sessions = useMemo(() => getGameSessions(game.id), [game.id, getGameSessions]);
  const stats = useMemo(() => getGameStats(game.id), [game.id, getGameStats]);
  const [subTab, setSubTab] = useState<GameActivitySubTab>("overview");

  // Get the most recent session with real metrics (no synthetic time-series)
  const latestMetrics = useMemo(() => {
    const withMetrics = sessions
      .filter((s) => s.metrics)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return withMetrics.length > 0 ? withMetrics[0].metrics! : null;
  }, [sessions]);

  if (sessions.length === 0) {
    return (
      <div className="game-section">
        <h2 className="game-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          Activity
        </h2>
        <div className="timeline-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <p>No activity logged yet. Launch the game to start recording sessions.</p>
        </div>
      </div>
    );
  }

  const sessionsWithMetrics = sessions.filter((s) => s.metrics);

  return (
    <div className="game-activity-tab">
      {/* Sub-tab navigation */}
      <div className="game-activity-subtabs">
        {([
          ["overview", "Overview"],
          ["performance", "Performance"],
          ["sessions", "Sessions"],
        ] as [GameActivitySubTab, string][]).map(([tab, label]) => (
          <button
            key={tab}
            className={`game-activity-subtab ${subTab === tab ? "active" : ""}`}
            onClick={() => setSubTab(tab)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="game-activity-content">
        {subTab === "overview" && (
          <ActivityOverview
            stats={stats}
            sessionsWithMetrics={sessionsWithMetrics}
            latestMetrics={latestMetrics}
          />
        )}
        {subTab === "performance" && (
          <ActivityPerformance sessions={sessions} />
        )}
        {subTab === "sessions" && <ActivitySessions sessions={sessions} />}
      </div>
    </div>
  );
}

// ─── Sub-component: Overview ──────────────────────────────────────────────────

function ActivityOverview({
  stats,
  sessionsWithMetrics,
  latestMetrics,
}: {
  stats: ActivityStats;
  sessionsWithMetrics: GameSession[];
  latestMetrics: SessionMetrics | null;
}) {
  return (
    <div className="game-activity-overview">
      {/* Summary stat cards */}
      <div className="activity-stat-cards game-activity-cards">
        <div className="activity-stat-card">
          <div className="activity-stat-icon" style={{ color: "var(--color-accent)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <div className="activity-stat-info">
            <span className="activity-stat-label">Sessions</span>
            <span className="activity-stat-value">{stats.totalSessions}</span>
          </div>
        </div>
        <div className="activity-stat-card">
          <div className="activity-stat-icon" style={{ color: "var(--color-success)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div className="activity-stat-info">
            <span className="activity-stat-label">Total Play Time</span>
            <span className="activity-stat-value">{formatPlayTime(stats.totalPlayTimeMin)}</span>
          </div>
        </div>
        <div className="activity-stat-card">
          <div className="activity-stat-icon" style={{ color: "var(--color-info)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <div className="activity-stat-info">
            <span className="activity-stat-label">Avg Session</span>
            <span className="activity-stat-value">{formatPlayTime(stats.avgSessionMin)}</span>
          </div>
        </div>
        {sessionsWithMetrics.length > 0 && (
          <>
            <div className="activity-stat-card">
              <div className="activity-stat-icon" style={{ color: "var(--color-warning)" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="20" height="20" rx="2" /><path d="M7 2v20" /><path d="M17 2v20" /><path d="M2 12h20" />
                </svg>
              </div>
              <div className="activity-stat-info">
                <span className="activity-stat-label">Avg FPS</span>
                <span className="activity-stat-value">{stats.avgFpsAll}</span>
              </div>
            </div>
            <div className="activity-stat-card">
              <div className="activity-stat-icon" style={{ color: "#ff6d00" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              </div>
              <div className="activity-stat-info">
                <span className="activity-stat-label">Avg RAM</span>
                <span className="activity-stat-value">{latestMetrics?.avgRamUsage ?? "-"}%</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Session History bar chart */}
      <section className="game-section" style={{ marginBottom: 0 }}>
        <h2 className="game-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
          </svg>
          Session History
        </h2>
        <BarChart
          data={stats.dailyAvg}
          labels={stats.dailyLabels}
          formatValue={(v) => formatPlayTime(v)}
          height={200}
        />
      </section>
    </div>
  );
}

// ─── Sub-component: Performance ───────────────────────────────────────────────

function ActivityPerformance({
  sessions,
}: {
  sessions: GameSession[];
}) {
  // Real per-session metric series — one data point per recorded session
  const series = useMemo(() => buildSessionMetricsSeries(sessions), [sessions]);
  const hasMetrics = series.fps.length > 0;
  const hasTemps = series.gpuTemp.some((t) => t > 0) || series.cpuTemp.some((t) => t > 0);

  if (!hasMetrics) {
    return (
      <div className="activity-empty" style={{ padding: "var(--space-2xl) var(--space-lg)" }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
        <p>No performance data yet. Launch the game and play for at least a few minutes to record metrics.</p>
      </div>
    );
  }

  return (
    <div className="game-activity-performance">
      {/* Per-session trend charts (real measurements, one point per session) */}
      <div className="activity-charts-grid">
        <section className="activity-section">
          <h2 className="activity-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            FPS Over Time
          </h2>
          <LineChart
            series={[{ data: series.fps, color: "var(--color-accent)", label: "Avg FPS" }]}
            labels={series.labels}
            height={200}
            formatValue={(v) => `${Math.round(v)} FPS`}
          />
        </section>

        <section className="activity-section">
          <h2 className="activity-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="2" /><path d="M7 2v20" /><path d="M17 2v20" /><path d="M2 12h20" />
            </svg>
            CPU & GPU Load Over Time
          </h2>
          <LineChart
            series={[
              { data: series.gpu, color: "var(--color-success)", label: "GPU" },
              { data: series.cpu, color: "var(--color-info)", label: "CPU" },
            ]}
            labels={series.labels}
            height={200}
            formatValue={(v) => `${Math.round(v)}%`}
          />
        </section>

        <section className="activity-section">
          <h2 className="activity-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            RAM Usage Over Time
          </h2>
          <LineChart
            series={[{ data: series.ram, color: "#e040fb", label: "RAM" }]}
            labels={series.labels}
            height={200}
            formatValue={(v) => `${Math.round(v)}%`}
          />
        </section>

        <section className="activity-section">
          <h2 className="activity-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" />
            </svg>
            Temperature Over Time
          </h2>
          {hasTemps ? (
            <LineChart
              series={[
                { data: series.gpuTemp, color: "#ff5252", label: "GPU Temp" },
                { data: series.cpuTemp, color: "#ffab00", label: "CPU Temp" },
              ]}
              labels={series.labels}
              height={200}
              formatValue={(v) => `${Math.round(v)}°C`}
            />
          ) : (
            <div className="activity-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" />
              </svg>
              <p>Temperature data is not available. WMI thermal sensors are not currently supported.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ─── Sub-component: Sessions ──────────────────────────────────────────────────

function ActivitySessions({ sessions }: { sessions: GameSession[] }) {
  return (
    <div className="game-activity-sessions">
      <section className="game-section">
        <h2 className="game-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          Session Timeline
        </h2>
        <div className="game-session-list">
          {sessions.slice(0, 25).map((session) => (
            <div key={session.id} className="game-session-item">
              <div className="game-session-dot" />
              <div className="game-session-content">
                <div className="game-session-header">
                  <span className="game-session-date">
                    {new Date(session.date).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="game-session-duration">{formatPlayTime(session.durationMin)}</span>
                </div>
                {session.metrics && (
                  <div className="game-session-metrics">
                    <span className="activity-metric-tag">{session.metrics.avgFps} FPS</span>
                    <span className="activity-metric-tag">GPU {session.metrics.avgGpuUsage}%</span>
                    <span className="activity-metric-tag">CPU {session.metrics.avgCpuUsage}%</span>
                    <span className="activity-metric-tag">RAM {session.metrics.avgRamUsage}%</span>
                    <span className="activity-metric-tag">{session.metrics.resolution}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
