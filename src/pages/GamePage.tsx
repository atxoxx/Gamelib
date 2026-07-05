import { useEffect, useState, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import html2canvas from "html2canvas";
import { useGames } from "../context/GameContext";
import { useActivity } from "../context/ActivityContext";
import { useToast } from "../context/ToastContext";
import { type Game, type GameMetadataResult, type LaunchBoxImageResult, type GameSession, type SimilarGame, type ReleaseDateInfo, type IgdbReview, type LanguageSupportInfo, formatPlayTime, parsePlayTime, slugify } from "../types/game";
import BarChart from "../components/charts/BarChart";
import LineChart from "../components/charts/LineChart";
import WebLinksTab from "../components/WebLinksTab";
import ReviewsTab from "../components/ReviewsTab";
import { useProgressiveImage } from "../hooks/useProgressiveImages";


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

function getVideoEmbedUrl(url: string): string | null {
  if (!url) return null;

  // Build a list of acceptable parent hostnames for Twitch embeds.
  // Twitch's player rejects embeds whose `parent` doesn't match the embedding
  // page's hostname (causing error 1000 inside the player). We pass the actual
  // runtime hostname plus common Tauri / localhost fallbacks for robustness
  // across Tauri dev (`http://localhost:1420`), Tauri 2 prod (`tauri://localhost`),
  // and Tauri 1.x-style prod (`https://tauri.localhost`).
  const buildParents = (): string => {
    const hosts = new Set<string>(["localhost", "127.0.0.1", "tauri.localhost"]);
    if (typeof window !== "undefined" && window.location?.hostname) {
      hosts.add(window.location.hostname);
    }
    return Array.from(hosts)
      .map((h) => `parent=${encodeURIComponent(h)}`)
      .join("&");
  };

  // Twitch VOD: https://www.twitch.tv/videos/12345 (with optional ?t= timestamp)
  const twitchVod = url.match(/twitch\.tv\/videos\/(\d+)/i);
  if (twitchVod) {
    const t = url.match(/[?&]t=([0-9hms]+)/i);
    const time = t ? `&time=${t[1]}` : "";
    return `https://player.twitch.tv/?video=v${twitchVod[1]}${time}&${buildParents()}&autoplay=false`;
  }
  // Twitch clip: https://clips.twitch.tv/SLUG or https://www.twitch.tv/CHANNEL/clip/SLUG
  const twitchClip = url.match(/(?:clips\.twitch\.tv\/|twitch\.tv\/[^/]+\/clip\/)([A-Za-z0-9_-]+)/i);
  if (twitchClip) {
    return `https://clips.twitch.tv/embed?clip=${twitchClip[1]}&${buildParents()}`;
  }
  // Twitch live channel: https://www.twitch.tv/CHANNEL
  const twitchChannel = url.match(/^https?:\/\/(?:www\.)?twitch\.tv\/([a-zA-Z0-9_]+)\/?$/i);
  if (twitchChannel) {
    const ch = twitchChannel[1].toLowerCase();
    const reserved = new Set([
      "videos", "directory", "settings", "subs", "wallet", "drops",
      "prime", "turbo", "login", "signup", "about",
    ]);
    if (!reserved.has(ch)) {
      return `https://player.twitch.tv/?channel=${twitchChannel[1]}&${buildParents()}&autoplay=false`;
    }
  }
  // YouTube (unchanged)
  let id = "";
  if (url.includes("watch?v=")) {
    id = url.split("watch?v=")[1]?.split("&")[0] || "";
  } else if (url.includes("youtu.be/")) {
    id = url.split("youtu.be/")[1]?.split("?")[0] || "";
  } else if (url.includes("youtube.com/embed/")) {
    id = url.split("youtube.com/embed/")[1]?.split("?")[0] || "";
  } else {
    id = url;
  }
  return id ? `https://www.youtube.com/embed/${id}` : null;
}

function getVideoThumbnail(
  url: string
): { kind: "youtube"; src: string } | { kind: "twitch" } | null {
  if (!url) return null;
  if (/youtube\.com|youtu\.be/i.test(url)) {
    let ytId = "";
    if (url.includes("watch?v=")) ytId = url.split("watch?v=")[1]?.split("&")[0] || "";
    else if (url.includes("youtu.be/")) ytId = url.split("youtu.be/")[1]?.split("?")[0] || "";
    else if (url.includes("youtube.com/embed/")) ytId = url.split("youtube.com/embed/")[1]?.split("?")[0] || "";
    else ytId = url;
    if (ytId) return { kind: "youtube", src: `https://img.youtube.com/vi/${ytId}/mqdefault.jpg` };
  }
  // Twitch has no public thumbnail API without auth; surface a branded placeholder.
  if (/twitch\.tv|clips\.twitch\.tv/i.test(url)) {
    return { kind: "twitch" };
  }
  return null;
}

function RatingCircle({ score, label }: { score: number; label: string }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;
  
  const getColor = (s: number) => {
    if (s >= 75) return "#10b981"; // emerald
    if (s >= 50) return "#f59e0b"; // warning
    return "#ef4444"; // danger
  };
  
  return (
    <div className="rating-circle-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-xs)' }}>
      <div className="rating-circle-svg-wrap" style={{ position: 'relative', width: 68, height: 68 }}>
        <svg className="rating-circle-svg" viewBox="0 0 68 68" style={{ width: '100%', height: '100%' }}>
          <circle 
            className="rating-circle-bg" 
            cx="34" 
            cy="34" 
            r={radius} 
            stroke="var(--color-bg-tertiary)" 
            strokeWidth="4" 
            fill="transparent" 
          />
          <circle
            className="rating-circle-progress"
            cx="34"
            cy="34"
            r={radius}
            strokeWidth="4"
            stroke={getColor(score)}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            fill="transparent"
            transform="rotate(-90 34 34)"
            style={{ transition: 'stroke-dashoffset 0.8s ease' }}
          />
        </svg>
        <span 
          className="rating-circle-score" 
          style={{ 
            position: 'absolute', 
            top: '50%', 
            left: '50%', 
            transform: 'translate(-50%, -50%)', 
            fontSize: 'var(--font-size-md)', 
            fontWeight: 'bold',
            color: getColor(score) 
          }}
        >
          {score}
        </span>
      </div>
      <span className="rating-circle-label" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{label}</span>
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

function TimeToBeatRow({ label, targetSeconds, currentPlayTime }: { label: string, targetSeconds: number, currentPlayTime: string }) {
  const targetHours = Math.round(targetSeconds / 3600);
  const playTimeMinutes = parsePlayTime(currentPlayTime);
  const playTimeHours = playTimeMinutes / 60;
  
  const percentage = Math.min(100, Math.round((playTimeHours / targetHours) * 100));
  
  return (
    <div style={{ marginBottom: 'var(--space-sm)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-xs)', marginBottom: '4px' }}>
        <span style={{ fontWeight: '500', color: 'var(--color-text-primary)' }}>{label}</span>
        <span style={{ color: 'var(--color-text-muted)' }}>
          {Math.round(playTimeHours * 10) / 10}h / {targetHours}h ({percentage}%)
        </span>
      </div>
      <div className="progress-bar-bg" style={{ height: '6px', background: 'var(--color-bg-tertiary)', borderRadius: '3px', overflow: 'hidden', border: '1px solid var(--color-border)' }}>
        <div 
          className="progress-bar-fill" 
          style={{ 
            height: '100%', 
            width: `${percentage}%`, 
            background: percentage >= 100 ? 'linear-gradient(90deg, #10b981, #059669)' : 'linear-gradient(90deg, var(--color-accent), #818cf8)',
            borderRadius: '3px',
            transition: 'width 0.5s ease-in-out',
            boxShadow: percentage >= 100 ? '0 0 6px rgba(16, 185, 129, 0.4)' : '0 0 6px rgba(99, 102, 241, 0.4)'
          }} 
        />
      </div>
    </div>
  );
}

function SimilarGameCard({ sim, onClick }: { sim: SimilarGame; onClick: () => void }) {
  const [coverUrl, imgRef] = useProgressiveImage(sim.coverUrl || null);
  return (
    <div 
      className="similar-game-card" 
      onClick={onClick}
      style={{ cursor: 'pointer' }}
    >
      <div className="similar-game-cover-container" style={{ aspectRatio: '2/3', background: 'var(--color-bg-tertiary)', overflow: 'hidden', position: 'relative', borderRadius: 'var(--radius-md) var(--radius-md) 0 0' }}>
        {coverUrl ? (
          <img 
            ref={imgRef}
            src={coverUrl} 
            alt={sim.name} 
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            className="similar-game-cover"
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)' }}>No Cover</div>
        )}
      </div>
      <div style={{ padding: 'var(--space-sm)' }}>
        <h4 style={{ fontSize: '11px', fontWeight: '600', color: 'var(--color-text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: '1.3' }}>
          {sim.name}
        </h4>
      </div>
    </div>
  );
}

// Track which game IDs have already been auto-enriched to avoid repeat calls
const enrichedGameIds = new Set<string>();

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

  // Extended metadata edit states
  const [editDescription, setEditDescription] = useState(game.description || "");
  const [editDeveloper, setEditDeveloper] = useState(game.developer || "");
  const [editPublisher, setEditPublisher] = useState(game.publisher || "");
  const [editReleaseDate, setEditReleaseDate] = useState(game.releaseDate || "");
  const [editGenres, setEditGenres] = useState(game.genres ? game.genres.join(", ") : "");
  const [editStoryline, setEditStoryline] = useState(game.storyline || "");
  const [editIgdbRating, setEditIgdbRating] = useState(game.igdbRating || 0);
  const [editCriticRating, setEditCriticRating] = useState(game.criticRating || 0);
  const [editThemes, setEditThemes] = useState(game.themes ? game.themes.join(", ") : "");
  const [editGameModes, setEditGameModes] = useState(game.gameModes ? game.gameModes.join(", ") : "");
  const [editPlayerPerspectives, setEditPlayerPerspectives] = useState(game.playerPerspectives ? game.playerPerspectives.join(", ") : "");
  
  const [editScreenshots, setEditScreenshots] = useState<string[]>(game.screenshots || []);
  const [editVideos, setEditVideos] = useState<string[]>(game.videos || []);
  const [editWebsites, setEditWebsites] = useState<string[]>(game.websites || []);
  
  const [editMetadataSource, setEditMetadataSource] = useState(game.metadataSource || "");
  const [editMetadataUrl, setEditMetadataUrl] = useState(game.metadataUrl || "");

  // Track which image is being fetched
  const [fetchingImageKey, setFetchingImageKey] = useState<string | null>(null);

  // Lightbox & Video states
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [activeVideoUrl, setActiveVideoUrl] = useState<string | null>(null);

  // LaunchBox Image Browser state
  const [showImageBrowser, setShowImageBrowser] = useState(false);
  const [lbImages, setLbImages] = useState<LaunchBoxImageResult[]>([]);
  const [lbLoading, setLbLoading] = useState(false);
  const [lbSelectedCategory, setLbSelectedCategory] = useState<string>("all");
  const [lbApplyingUrl, setLbApplyingUrl] = useState<string | null>(null);

  // New IGDB fields edit states
  const [showIgdbMediaBrowser, setShowIgdbMediaBrowser] = useState(false);
  const [editTimeToBeatMain, setEditTimeToBeatMain] = useState(game.timeToBeat?.normally ? Math.round(game.timeToBeat.normally / 3600) : 0);
  const [editTimeToBeatExtra, setEditTimeToBeatExtra] = useState(game.timeToBeat?.hastily ? Math.round(game.timeToBeat.hastily / 3600) : 0);
  const [editTimeToBeatComple, setEditTimeToBeatComple] = useState(game.timeToBeat?.completely ? Math.round(game.timeToBeat.completely / 3600) : 0);
  const [, setEditSimilarGames] = useState<SimilarGame[]>(game.similarGames || []);
  const [, setEditReleases] = useState<ReleaseDateInfo[]>(game.releases || []);
  const [editIgdbReviews, setEditIgdbReviews] = useState<IgdbReview[]>(game.igdbReviews || []);
  
  const [editSimilarGamesText, setEditSimilarGamesText] = useState(game.similarGames ? game.similarGames.map(g => g.name).join(", ") : "");
  const [editReleasesText, setEditReleasesText] = useState(game.releases ? game.releases.map(r => `${r.platform} | ${r.dateStr} | ${r.region}`).join("\n") : "");
  const [editIgdbReviewsText, setEditIgdbReviewsText] = useState(game.igdbReviews ? JSON.stringify(game.igdbReviews, null, 2) : "");

  const [editCollection, setEditCollection] = useState(game.collection || "");
  const [editFranchise, setEditFranchise] = useState(game.franchise || "");
  const [editGameCategory, setEditGameCategory] = useState(game.gameCategory || "");
  const [editReleaseStatus, setEditReleaseStatus] = useState(game.releaseStatus || "");
  const [editLanguageSupports, setEditLanguageSupports] = useState<LanguageSupportInfo[]>(game.languageSupports || []);
  
  const [editAlternativeNamesText, setEditAlternativeNamesText] = useState(game.alternativeNames ? game.alternativeNames.join(", ") : "");
  const [editLanguageSupportsText, setEditLanguageSupportsText] = useState(game.languageSupports ? JSON.stringify(game.languageSupports, null, 2) : "");
  
  // Auto-enrich existing games that have metadata but are missing TTB/reviews
  const enrichmentStartedRef = useRef(false);
  useEffect(() => {
    // Only enrich once per game per session, and only for games with a path (local imports)
    if (enrichmentStartedRef.current) return;
    if (enrichedGameIds.has(game.id)) return;
    if (!game.path) return;
    // Only trigger if the game has some metadata but is missing IGDB enrichment
    const hasPartialMetadata = game.description || game.metadataSource;
    // Note: igdbReviews are no longer fetched from IGDB (the /v4/reviews
    // endpoint was removed upstream), so we only look at timeToBeat here.
    const missingEnrichment = !game.timeToBeat;
    if (!hasPartialMetadata || !missingEnrichment) return;

    enrichmentStartedRef.current = true;
    enrichedGameIds.add(game.id);

    invoke<GameMetadataResult[]>("search_game_metadata", { gameName: game.name })
      .then((results) => {
        if (results.length === 0) return;
        // Prefer the IGDB result so we pick up timeToBeat/criticRating/etc.
        const meta = results.find(r => r.sourceName === "IGDB" && r.timeToBeat) ?? results[0];
        // Only update the fields that are missing, don't overwrite existing data
        updateGame(game.id, {
          timeToBeat: meta.timeToBeat ?? undefined,
          igdbReviews: meta.igdbReviews ?? undefined,
          similarGames: meta.similarGames ?? undefined,
          releases: meta.releases ?? undefined,
          alternativeNames: meta.alternativeNames ?? undefined,
          collection: meta.collection ?? undefined,
          franchise: meta.franchise ?? undefined,
          gameCategory: meta.gameCategory ?? undefined,
          releaseStatus: meta.releaseStatus ?? undefined,
          languageSupports: meta.languageSupports ?? undefined,
        });
      })
      .catch((err) => console.error("Auto-enrichment failed:", err));
  }, [game.id, game.path, game.description, game.metadataSource, game.timeToBeat, updateGame]);

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
    
    // New fields
    setEditDescription(game.description || "");
    setEditDeveloper(game.developer || "");
    setEditPublisher(game.publisher || "");
    setEditReleaseDate(game.releaseDate || "");
    setEditGenres(game.genres ? game.genres.join(", ") : "");
    setEditStoryline(game.storyline || "");
    setEditIgdbRating(game.igdbRating || 0);
    setEditCriticRating(game.criticRating || 0);
    setEditThemes(game.themes ? game.themes.join(", ") : "");
    setEditGameModes(game.gameModes ? game.gameModes.join(", ") : "");
    setEditPlayerPerspectives(game.playerPerspectives ? game.playerPerspectives.join(", ") : "");
    
    setEditScreenshots(game.screenshots || []);
    setEditVideos(game.videos || []);
    setEditWebsites(game.websites || []);
    
    setEditTimeToBeatMain(game.timeToBeat?.normally ? Math.round(game.timeToBeat.normally / 3600) : 0);
    setEditTimeToBeatExtra(game.timeToBeat?.hastily ? Math.round(game.timeToBeat.hastily / 3600) : 0);
    setEditTimeToBeatComple(game.timeToBeat?.completely ? Math.round(game.timeToBeat.completely / 3600) : 0);
    setEditSimilarGames(game.similarGames || []);
    setEditReleases(game.releases || []);
    setEditIgdbReviews(game.igdbReviews || []);
    
    setEditSimilarGamesText(game.similarGames ? game.similarGames.map(g => g.name).join(", ") : "");
    setEditReleasesText(game.releases ? game.releases.map(r => `${r.platform} | ${r.dateStr} | ${r.region}`).join("\n") : "");
    setEditIgdbReviewsText(game.igdbReviews ? JSON.stringify(game.igdbReviews, null, 2) : "");
    
    setEditCollection(game.collection || "");
    setEditFranchise(game.franchise || "");
    setEditGameCategory(game.gameCategory || "");
    setEditReleaseStatus(game.releaseStatus || "");
    setEditLanguageSupports(game.languageSupports || []);
    setEditAlternativeNamesText(game.alternativeNames ? game.alternativeNames.join(", ") : "");
    setEditLanguageSupportsText(game.languageSupports ? JSON.stringify(game.languageSupports, null, 2) : "");

    setEditMetadataSource(game.metadataSource || "");
    setEditMetadataUrl(game.metadataUrl || "");
    
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
        gameName: editName.trim() || game.name,
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
          gameName: editName.trim() || game.name,
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

      // Update local edit states instead of updating the game directly
      setEditName(result.title || game.name);
      setEditDescription(result.description || "");
      setEditDeveloper(result.developer || "");
      setEditPublisher(result.publisher || "");
      setEditReleaseDate(result.releaseDate || "");
      setEditGenres(result.genres.length > 0 ? result.genres.join(", ") : "");
      setEditStoryline(result.storyline || "");
      setEditIgdbRating(result.igdbRating || 0);
      setEditCriticRating(result.criticRating || 0);
      setEditThemes(result.themes ? result.themes.join(", ") : "");
      setEditGameModes(result.gameModes ? result.gameModes.join(", ") : "");
      setEditPlayerPerspectives(result.playerPerspectives ? result.playerPerspectives.join(", ") : "");
      
      if (iconUrl) setEditIcon(iconUrl);
      if (coverUrl) setEditCover(coverUrl);
      if (finalBannerUrl) setEditHero(finalBannerUrl);
      if (logoUrl) setEditLogo(logoUrl);

      setEditScreenshots(result.screenshots || []);
      setEditVideos(result.videos || []);
      setEditWebsites(result.websites || []);
      
      setEditTimeToBeatMain(result.timeToBeat?.normally ? Math.round(result.timeToBeat.normally / 3600) : 0);
      setEditTimeToBeatExtra(result.timeToBeat?.hastily ? Math.round(result.timeToBeat.hastily / 3600) : 0);
      setEditTimeToBeatComple(result.timeToBeat?.completely ? Math.round(result.timeToBeat.completely / 3600) : 0);
      setEditSimilarGames(result.similarGames || []);
      setEditReleases(result.releases || []);
      setEditIgdbReviews(result.igdbReviews || []);
      
      setEditSimilarGamesText(result.similarGames ? result.similarGames.map(g => g.name).join(", ") : "");
      setEditReleasesText(result.releases ? result.releases.map(r => `${r.platform} | ${r.dateStr} | ${r.region}`).join("\n") : "");
      setEditIgdbReviewsText(result.igdbReviews ? JSON.stringify(result.igdbReviews, null, 2) : "");
      
      setEditCollection(result.collection || "");
      setEditFranchise(result.franchise || "");
      setEditGameCategory(result.gameCategory || "");
      setEditReleaseStatus(result.releaseStatus || "");
      setEditLanguageSupports(result.languageSupports || []);
      setEditAlternativeNamesText(result.alternativeNames ? result.alternativeNames.join(", ") : "");
      setEditLanguageSupportsText(result.languageSupports ? JSON.stringify(result.languageSupports, null, 2) : "");

      setEditMetadataSource(result.sourceName);
      setEditMetadataUrl(result.sourceUrl);

      showToast(`Autofilled metadata from ${result.sourceName}. Review and save!`, "success");
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

  async function handleApplyIgdbImage(imageUrl: string, slot: "icon" | "cover" | "hero" | "banner" | "logo") {
    setFetchingImageKey(slot);
    try {
      // Optimistically update instantly
      if (slot === "icon") setEditIcon(imageUrl);
      else if (slot === "cover") setEditCover(imageUrl);
      else if (slot === "hero" || slot === "banner") setEditHero(imageUrl);
      else if (slot === "logo") setEditLogo(imageUrl);
      
      const dataUrl: string | null = await invoke("download_image", { url: imageUrl });
      if (dataUrl) {
        if (slot === "icon") setEditIcon(dataUrl);
        else if (slot === "cover") setEditCover(dataUrl);
        else if (slot === "hero" || slot === "banner") setEditHero(dataUrl);
        else if (slot === "logo") setEditLogo(dataUrl);
        showToast(`Applied and saved image as ${slot}`, "success");
      } else {
        showToast("Failed to download image", "error");
      }
    } catch (err) {
      showToast(`Failed to apply image: ${err}`, "error");
    } finally {
      setFetchingImageKey(null);
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

    // Extended metadata
    const newDescription = editDescription.trim() || undefined;
    const newDeveloper = editDeveloper.trim() || undefined;
    const newPublisher = editPublisher.trim() || undefined;
    const newReleaseDate = editReleaseDate.trim() || undefined;
    const newGenres = editGenres ? editGenres.split(",").map(s => s.trim()).filter(Boolean) : undefined;
    const newStoryline = editStoryline.trim() || undefined;
    const newIgdbRating = editIgdbRating > 0 ? Number(editIgdbRating) : undefined;
    const newCriticRating = editCriticRating > 0 ? Number(editCriticRating) : undefined;
    const newThemes = editThemes ? editThemes.split(",").map(s => s.trim()).filter(Boolean) : undefined;
    const newGameModes = editGameModes ? editGameModes.split(",").map(s => s.trim()).filter(Boolean) : undefined;
    const newPlayerPerspectives = editPlayerPerspectives ? editPlayerPerspectives.split(",").map(s => s.trim()).filter(Boolean) : undefined;

    // Parse similar games — preserve existing id and coverUrl for re-ordered/renamed entries
    const existingSims = game.similarGames || [];
    const newSimilarGames = editSimilarGamesText.split(",")
      .map(s => s.trim())
      .filter(Boolean)
      .map((name, index) => {
        const existing = existingSims.find(g => g.name.toLowerCase() === name.toLowerCase());
        return { 
          id: existing ? existing.id : index, 
          name, 
          coverUrl: existing ? existing.coverUrl : undefined 
        };
      });

    const newReleases = editReleasesText.split("\n")
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const parts = line.split("|").map(p => p.trim());
        return {
          platform: parts[0] || "",
          dateStr: parts[1] || "",
          region: parts[2] || ""
        };
      })
      .filter(rel => rel.platform);

    let newIgdbReviews = editIgdbReviews.length > 0 ? editIgdbReviews : undefined;
    if (editIgdbReviewsText.trim()) {
      try {
        newIgdbReviews = JSON.parse(editIgdbReviewsText.trim());
      } catch (e) {
        // Warning will show, but we keep the current ones
      }
    }

    let newLanguageSupports = editLanguageSupports;
    if (editLanguageSupportsText.trim()) {
      try {
        newLanguageSupports = JSON.parse(editLanguageSupportsText.trim());
      } catch (e) {
        // keep current
      }
    }

    const newAlternativeNames = editAlternativeNamesText.split(",")
      .map(n => n.trim())
      .filter(Boolean);

    updateGame(game.id, {
      name: newName,
      platform: newPlatform,
      iconUrl: newIcon,
      coverArtUrl: newCover,
      bannerUrl: newHero,
      logoUrl: newLogo,
      notes: newNotes,
      description: newDescription,
      developer: newDeveloper,
      publisher: newPublisher,
      releaseDate: newReleaseDate,
      genres: newGenres,
      storyline: newStoryline,
      igdbRating: newIgdbRating,
      criticRating: newCriticRating,
      themes: newThemes,
      gameModes: newGameModes,
      playerPerspectives: newPlayerPerspectives,
      screenshots: editScreenshots.length > 0 ? editScreenshots : undefined,
      videos: editVideos.length > 0 ? editVideos : undefined,
      websites: editWebsites.length > 0 ? editWebsites : undefined,
      timeToBeat: {
        normally: editTimeToBeatMain > 0 ? editTimeToBeatMain * 3600 : undefined,
        hastily: editTimeToBeatExtra > 0 ? editTimeToBeatExtra * 3600 : undefined,
        completely: editTimeToBeatComple > 0 ? editTimeToBeatComple * 3600 : undefined,
      },
      similarGames: newSimilarGames.length > 0 ? newSimilarGames : undefined,
      releases: newReleases.length > 0 ? newReleases : undefined,
      igdbReviews: newIgdbReviews,
      alternativeNames: newAlternativeNames.length > 0 ? newAlternativeNames : undefined,
      collection: editCollection.trim() || undefined,
      franchise: editFranchise.trim() || undefined,
      gameCategory: editGameCategory.trim() || undefined,
      releaseStatus: editReleaseStatus.trim() || undefined,
      languageSupports: newLanguageSupports.length > 0 ? newLanguageSupports : undefined,
      metadataSource: editMetadataSource ? editMetadataSource : undefined,
      metadataUrl: editMetadataUrl ? editMetadataUrl : undefined,
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
                <p className="game-description" style={{ lineHeight: 1.6, color: 'var(--color-text-primary)' }}>{game.description}</p>
                {game.metadataSource && game.metadataUrl && (
                  <a
                    className="metadata-source-link"
                    href={game.metadataUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ marginTop: 'var(--space-md)', display: 'inline-flex', alignItems: 'center', gap: 'var(--space-xs)', color: 'var(--color-accent)', textDecoration: 'none', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                    View on {game.metadataSource}
                  </a>
                )}
              </section>
            )}

            {game.storyline && (
              <section className="game-section storyline-section">
                <h2 className="game-section-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                  Storyline
                </h2>
                <div className="storyline-quote-wrap" style={{ position: 'relative', paddingLeft: 'var(--space-lg)', borderLeft: '3px solid var(--color-accent)' }}>
                  <p className="game-storyline" style={{ fontStyle: 'italic', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>"{game.storyline}"</p>
                </div>
              </section>
            )}

            {game.screenshots && game.screenshots.length > 0 && (
              <section className="game-section screenshots-section">
                <h2 className="game-section-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  Screenshots ({game.screenshots.length})
                </h2>
                <div className="screenshots-carousel" style={{ display: 'flex', gap: 'var(--space-md)', overflowX: 'auto', paddingBottom: 'var(--space-sm)', scrollbarWidth: 'thin' }}>
                  {game.screenshots.map((src, index) => (
                    <div 
                      key={index} 
                      className="screenshot-item" 
                      onClick={() => setLightboxImage(src)} 
                      style={{ flexShrink: 0, width: 220, height: 124, borderRadius: 'var(--radius-md)', overflow: 'hidden', cursor: 'pointer', border: '1px solid var(--color-border)', transition: 'all var(--transition-fast)' }}
                    >
                      <img src={src} alt={`${game.name} Screenshot ${index + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform var(--transition-fast)' }} className="screenshot-img" />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {game.videos && game.videos.length > 0 && (
              <section className="game-section videos-section">
                <h2 className="game-section-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="23 7 16 12 23 17 23 7" />
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                  </svg>
                  Trailers & Videos
                </h2>
                {(() => {
                  const activeUrl = activeVideoUrl || game.videos[0];
                  const embedUrl = getVideoEmbedUrl(activeUrl);
                  return (
                    <div className="videos-container" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                      {embedUrl ? (
                        <div className="video-iframe-wrapper" style={{ position: 'relative', width: '100%', paddingBottom: '56.25%', height: 0, borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--color-border)' }}>
                          <iframe
                            src={embedUrl}
                            title={`${game.name} Video Trailer`}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
                          />
                        </div>
                      ) : (
                        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>Video link is invalid</p>
                      )}
                      {game.videos.length > 1 && (
                        <div className="video-selector-list" style={{ display: 'flex', gap: 'var(--space-sm)', overflowX: 'auto', paddingBottom: 'var(--space-xs)' }}>
                          {game.videos.map((url, idx) => {
                            const isSelected = activeUrl === url;
                            const thumb = getVideoThumbnail(url);
                            return (
                              <button
                                key={idx}
                                className={`video-selector-btn${isSelected ? " active" : ""}`}
                                onClick={() => setActiveVideoUrl(url)}
                                style={{
                                  flexShrink: 0,
                                  border: isSelected ? '2px solid var(--color-accent)' : '2px solid transparent',
                                  padding: 0,
                                  background: 'none',
                                  borderRadius: 'var(--radius-sm)',
                                  overflow: 'hidden',
                                  cursor: 'pointer',
                                  width: 96,
                                  height: 54,
                                  position: 'relative'
                                }}
                              >
                                {thumb?.kind === "youtube" ? (
                                  <>
                                    <img src={thumb.src} alt={`Trailer ${idx + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    <div className="video-selector-play-overlay" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)', opacity: isSelected ? 1 : 0.6, transition: 'opacity var(--transition-fast)' }}>
                                      <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 16, height: 16, color: '#fff' }}><polygon points="5 3 19 12 5 21 5 3" /></svg>
                                    </div>
                                  </>
                                ) : thumb?.kind === "twitch" ? (
                                  <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg, #9146ff 0%, #6441a5 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 18, height: 18, color: '#fff' }}>
                                      <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.714 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
                                    </svg>
                                  </div>
                                ) : (
                                  <span style={{ fontSize: 10, color: 'var(--color-text-primary)' }}>Trailer {idx + 1}</span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
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

            {/* Related Content section */}
            {(game.metadataUrl || game.metadataSource) && (
              <section className="game-section related-content-card">
                <h2 className="game-section-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                  Related Content
                </h2>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
                  {game.metadataUrl && (
                    <a 
                      href={game.metadataUrl} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="related-content-btn"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}>
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                      View on {game.metadataSource || 'Metadata Provider'}
                    </a>
                  )}
                  {game.platform === "Steam" && (
                    <a 
                      href={`https://steamcommunity.com/app/${game.path.match(/steam:\/\/run\/(\d+)/)?.[1] || game.path.match(/\/app\/(\d+)/)?.[1] || ''}`}
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="related-content-btn"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}>
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                      </svg>
                      Steam Community Hub
                    </a>
                  )}
                </div>
              </section>
            )}

            {/* Similar Games Section */}
            {game.similarGames && game.similarGames.length > 0 && (
              <section className="game-section similar-games-section" style={{ marginTop: 'var(--space-xl)' }}>
                <h2 className="game-section-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" />
                    <rect x="14" y="3" width="7" height="7" />
                    <rect x="14" y="14" width="7" height="7" />
                    <rect x="3" y="14" width="7" height="7" />
                  </svg>
                  Similar Games
                </h2>
                <div className="similar-games-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 'var(--space-lg)' }}>
                  {game.similarGames.slice(0, 6).map((sim) => (
                    <SimilarGameCard 
                      key={sim.id} 
                      sim={sim} 
                      onClick={() => navigate(`/store/${slugify(sim.name)}`)}
                    />
                  ))}
                </div>
              </section>
            )}

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
                {game.collection && (
                  <div className="info-item">
                    <span className="info-label">Series</span>
                    <span className="info-value">{game.collection}</span>
                  </div>
                )}
                {game.franchise && (
                  <div className="info-item">
                    <span className="info-label">Franchise</span>
                    <span className="info-value">{game.franchise}</span>
                  </div>
                )}
                {game.gameCategory && (
                  <div className="info-item">
                    <span className="info-label">Game Type</span>
                    <span className="info-value">{game.gameCategory}</span>
                  </div>
                )}
                {game.releaseStatus && (
                  <div className="info-item">
                    <span className="info-label">Release Status</span>
                    <span className="info-value">{game.releaseStatus}</span>
                  </div>
                )}
                {game.alternativeNames && game.alternativeNames.length > 0 && (
                  <div className="info-item" style={{ gridColumn: 'span 2' }}>
                    <span className="info-label">Also Known As</span>
                    <span className="info-value" style={{ display: 'block', fontSize: '11px', marginTop: '2px', color: 'var(--color-text-muted)', lineHeight: '1.4' }}>
                      {game.alternativeNames.join(", ")}
                    </span>
                  </div>
                )}
              </div>
              {game.genres && game.genres.length > 0 && (
                <div className="info-genres" style={{ marginTop: 'var(--space-md)', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
                  {game.genres.map((g) => (
                    <span key={g} className="metadata-genre-tag">{g}</span>
                  ))}
                </div>
              )}
            </section>

            {(game.igdbRating || game.criticRating) && (
              <section className="game-section ratings-card">
                <h2 className="game-section-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                  IGDB Ratings
                </h2>
                <div className="ratings-circle-wrap" style={{ display: 'flex', justifyContent: 'space-around', gap: 'var(--space-md)' }}>
                  {game.igdbRating && (
                    <RatingCircle score={Math.round(game.igdbRating)} label="Community" />
                  )}
                  {game.criticRating && (
                    <RatingCircle score={Math.round(game.criticRating)} label="Critics" />
                  )}
                </div>
                {(() => {
                  const breakdown = (() => {
                    let exceptional = 0, recommended = 0, meh = 0, skip = 0;
                    let total = 0;
                    if (game.igdbReviews && game.igdbReviews.length > 0) {
                      game.igdbReviews.forEach((r) => {
                        if (r.rating !== undefined) {
                          total++;
                          if (r.rating >= 90) exceptional++;
                          else if (r.rating >= 75) recommended++;
                          else if (r.rating >= 50) meh++;
                          else skip++;
                        }
                      });
                    }
                    if (total === 0) {
                      const base = game.igdbRating || 75;
                      const exp = Math.max(0, Math.round((base - 60) * 1.5));
                      const rec = Math.max(0, Math.round((base - 40) * 0.8));
                      const m = Math.max(0, Math.round((100 - base) * 0.6));
                      const sk = Math.max(0, 100 - (exp + rec + m));
                      return { exceptional: exp, recommended: rec, meh: m, skip: sk, total: 100 };
                    }
                    return {
                      exceptional: Math.round((exceptional / total) * 100),
                      recommended: Math.round((recommended / total) * 100),
                      meh: Math.round((meh / total) * 100),
                      skip: Math.round((skip / total) * 100),
                      total: 100
                    };
                  })();

                  const items = [
                    { label: "Exceptional", val: breakdown.exceptional, color: "#10b981" },
                    { label: "Recommended", val: breakdown.recommended, color: "#3b82f6" },
                    { label: "Meh", val: breakdown.meh, color: "#f59e0b" },
                    { label: "Skip", val: breakdown.skip, color: "#ef4444" },
                  ];

                  return (
                    <div style={{ marginTop: 'var(--space-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
                      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: '600' }}>Score Breakdown</span>
                      {items.map((item) => (
                        <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                          <span style={{ fontSize: '11px', width: '85px', color: 'var(--color-text-primary)' }}>{item.label}</span>
                          <div style={{ flex: 1, height: '6px', background: 'var(--color-bg-tertiary)', borderRadius: '3px', overflow: 'hidden' }}>
                            <div 
                              style={{ 
                                height: '100%', 
                                width: `${item.val}%`, 
                                background: item.color, 
                                borderRadius: '3px',
                                boxShadow: `0 0 4px ${item.color}`
                              }} 
                            />
                          </div>
                          <span style={{ fontSize: '11px', width: '30px', textAlign: 'right', color: 'var(--color-text-muted)' }}>{item.val}%</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </section>
            )}

            {(game.gameModes || game.themes || game.playerPerspectives) && (
              <section className="game-section specs-card">
                <h2 className="game-section-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                    <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                    <line x1="6" y1="6" x2="6.01" y2="6" />
                    <line x1="6" y1="18" x2="6.01" y2="18" />
                  </svg>
                  Game Specs
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                  {game.gameModes && game.gameModes.length > 0 && (
                    <div>
                      <span className="spec-label" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 'var(--space-xs)' }}>Modes</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
                        {game.gameModes.map((m) => <span key={m} className="spec-tag" style={{ background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-primary)' }}>{m}</span>)}
                      </div>
                    </div>
                  )}
                  {game.themes && game.themes.length > 0 && (
                    <div>
                      <span className="spec-label" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 'var(--space-xs)' }}>Themes</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
                        {game.themes.map((t) => <span key={t} className="spec-tag" style={{ background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-primary)' }}>{t}</span>)}
                      </div>
                    </div>
                  )}
                  {game.playerPerspectives && game.playerPerspectives.length > 0 && (
                    <div>
                      <span className="spec-label" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 'var(--space-xs)' }}>Perspectives</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
                        {game.playerPerspectives.map((p) => <span key={p} className="spec-tag" style={{ background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-primary)' }}>{p}</span>)}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {game.timeToBeat && (game.timeToBeat.normally || game.timeToBeat.completely || game.timeToBeat.hastily) && (
              <section className="game-section time-to-beat-card">
                <h2 className="game-section-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  Time to Beat
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                  {game.timeToBeat.normally !== undefined && game.timeToBeat.normally > 0 && (
                    <TimeToBeatRow 
                      label="Main Story" 
                      targetSeconds={game.timeToBeat.normally} 
                      currentPlayTime={game.playTime} 
                    />
                  )}
                  {game.timeToBeat.completely !== undefined && game.timeToBeat.completely > 0 && (
                    <TimeToBeatRow 
                      label="Completionist" 
                      targetSeconds={game.timeToBeat.completely} 
                      currentPlayTime={game.playTime} 
                    />
                  )}
                  {game.timeToBeat.hastily !== undefined && game.timeToBeat.hastily > 0 && (
                    <TimeToBeatRow
                      label="Rushed"
                      targetSeconds={game.timeToBeat.hastily}
                      currentPlayTime={game.playTime}
                    />
                  )}
                </div>
              </section>
            )}

            {game.releases && game.releases.length > 0 && (
              <section className="game-section releases-card">
                <h2 className="game-section-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  Releases
                </h2>
                <div className="releases-list" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)', maxHeight: '180px', overflowY: 'auto', paddingRight: '4px' }}>
                  {game.releases.map((rel, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
                      <span style={{ fontWeight: '500', color: 'var(--color-text-primary)' }}>{rel.platform}</span>
                      <span style={{ color: 'var(--color-text-muted)' }}>{rel.dateStr} ({rel.region})</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Languages Section */}
            {game.languageSupports && game.languageSupports.length > 0 && (
              <section className="game-section languages-section" style={{ marginTop: 'var(--space-xl)' }}>
                <h2 className="game-section-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    <line x1="9" y1="10" x2="15" y2="10" />
                    <line x1="9" y1="14" x2="13" y2="14" />
                  </svg>
                  Supported Languages
                </h2>
                {(() => {
                  const langMap: Record<string, { interface: boolean; audio: boolean; subtitles: boolean }> = {};
                  game.languageSupports.forEach(ls => {
                    if (!ls.language) return;
                    if (!langMap[ls.language]) {
                      langMap[ls.language] = { interface: false, audio: false, subtitles: false };
                    }
                    const type = ls.supportType ? ls.supportType.toLowerCase() : "";
                    if (type === "interface") langMap[ls.language].interface = true;
                    else if (type === "audio") langMap[ls.language].audio = true;
                    else if (type === "subtitles") langMap[ls.language].subtitles = true;
                  });

                  const languagesList = Object.keys(langMap).sort();

                  return (
                    <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-secondary)' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-sm)', textAlign: 'left' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'rgba(255,255,255,0.02)' }}>
                            <th style={{ padding: 'var(--space-sm) var(--space-md)', color: 'var(--color-text-muted)', fontWeight: '600' }}>Language</th>
                            <th style={{ padding: 'var(--space-sm) var(--space-md)', color: 'var(--color-text-muted)', fontWeight: '600', textAlign: 'center' }}>Interface</th>
                            <th style={{ padding: 'var(--space-sm) var(--space-md)', color: 'var(--color-text-muted)', fontWeight: '600', textAlign: 'center' }}>Audio</th>
                            <th style={{ padding: 'var(--space-sm) var(--space-md)', color: 'var(--color-text-muted)', fontWeight: '600', textAlign: 'center' }}>Subtitles</th>
                          </tr>
                        </thead>
                        <tbody>
                          {languagesList.map(lang => (
                            <tr key={lang} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                              <td style={{ padding: 'var(--space-sm) var(--space-md)', fontWeight: '500', color: 'var(--color-text-primary)' }}>{lang}</td>
                              <td style={{ padding: 'var(--space-sm) var(--space-md)', textAlign: 'center' }}>
                                {langMap[lang].interface ? (
                                  <span style={{ color: '#10b981', fontWeight: 'bold' }}>✓</span>
                                ) : (
                                  <span style={{ color: 'var(--color-text-muted)' }}>-</span>
                                )}
                              </td>
                              <td style={{ padding: 'var(--space-sm) var(--space-md)', textAlign: 'center' }}>
                                {langMap[lang].audio ? (
                                  <span style={{ color: '#10b981', fontWeight: 'bold' }}>✓</span>
                                ) : (
                                  <span style={{ color: 'var(--color-text-muted)' }}>-</span>
                                )}
                              </td>
                              <td style={{ padding: 'var(--space-sm) var(--space-md)', textAlign: 'center' }}>
                                {langMap[lang].subtitles ? (
                                  <span style={{ color: '#10b981', fontWeight: 'bold' }}>✓</span>
                                ) : (
                                  <span style={{ color: 'var(--color-text-muted)' }}>-</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </section>
            )}

          </div>
        </div>
      )}

      {activeTab === "reviews" && <ReviewsTab game={game} />}

      {activeTab === "activity" && <GameActivityTab game={game} />}

      {activeTab === "weblinks" && (
        <WebLinksTab
          game={game}
          visible={!editing && !showImageBrowser && !showIgdbMediaBrowser && !lightboxImage}
        />
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
                <div className="edit-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-name">Name</label>
                    <input id="edit-name" className="edit-input" type="text" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Game name" />
                  </div>
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-platform">Platform</label>
                    <input id="edit-platform" className="edit-input" type="text" value={editPlatform} onChange={(e) => setEditPlatform(e.target.value)} placeholder="e.g., Steam, GOG, Local" />
                  </div>
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-developer">Developer</label>
                    <input id="edit-developer" className="edit-input" type="text" value={editDeveloper} onChange={(e) => setEditDeveloper(e.target.value)} placeholder="Developer name" />
                  </div>
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-publisher">Publisher</label>
                    <input id="edit-publisher" className="edit-input" type="text" value={editPublisher} onChange={(e) => setEditPublisher(e.target.value)} placeholder="Publisher name" />
                  </div>
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-release-date">Release Date</label>
                    <input id="edit-release-date" className="edit-input" type="text" value={editReleaseDate} onChange={(e) => setEditReleaseDate(e.target.value)} placeholder="e.g., YYYY-MM-DD" />
                  </div>
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-genres">Genres</label>
                    <input id="edit-genres" className="edit-input" type="text" value={editGenres} onChange={(e) => setEditGenres(e.target.value)} placeholder="Action, Adventure, Shooter" />
                  </div>
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-themes">Themes</label>
                    <input id="edit-themes" className="edit-input" type="text" value={editThemes} onChange={(e) => setEditThemes(e.target.value)} placeholder="Sci-Fi, Survival, Sandbox" />
                  </div>
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-modes">Game Modes</label>
                    <input id="edit-modes" className="edit-input" type="text" value={editGameModes} onChange={(e) => setEditGameModes(e.target.value)} placeholder="Single player, Multiplayer, Co-op" />
                  </div>
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-perspectives">Player Perspectives</label>
                    <input id="edit-perspectives" className="edit-input" type="text" value={editPlayerPerspectives} onChange={(e) => setEditPlayerPerspectives(e.target.value)} placeholder="First person, Third person" />
                  </div>
                  <div className="edit-field-row">
                    <div className="edit-field">
                      <label className="edit-label" htmlFor="edit-igdb-rating">IGDB User Rating</label>
                      <input id="edit-igdb-rating" className="edit-input" type="number" min="0" max="100" value={editIgdbRating || ""} onChange={(e) => setEditIgdbRating(Number(e.target.value))} placeholder="0-100" />
                    </div>
                    <div className="edit-field">
                      <label className="edit-label" htmlFor="edit-critic-rating">IGDB Critic Rating</label>
                      <input id="edit-critic-rating" className="edit-input" type="number" min="0" max="100" value={editCriticRating || ""} onChange={(e) => setEditCriticRating(Number(e.target.value))} placeholder="0-100" />
                    </div>
                  </div>
                  
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-collection">Series</label>
                    <input id="edit-collection" className="edit-input" type="text" value={editCollection} onChange={(e) => setEditCollection(e.target.value)} placeholder="Series or Collection" />
                  </div>
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-franchise">Franchise</label>
                    <input id="edit-franchise" className="edit-input" type="text" value={editFranchise} onChange={(e) => setEditFranchise(e.target.value)} placeholder="Franchise name" />
                  </div>
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-game-category">Game Type</label>
                    <input id="edit-game-category" className="edit-input" type="text" value={editGameCategory} onChange={(e) => setEditGameCategory(e.target.value)} placeholder="e.g. Main Game, Expansion" />
                  </div>
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-release-status">Release Status</label>
                    <input id="edit-release-status" className="edit-input" type="text" value={editReleaseStatus} onChange={(e) => setEditReleaseStatus(e.target.value)} placeholder="e.g. Released, Alpha" />
                  </div>

                  <div className="edit-field-row" style={{ marginTop: 'var(--space-md)' }}>
                    <div className="edit-field">
                      <label className="edit-label" htmlFor="edit-hltb-main">HLTB Main Story (Hours)</label>
                      <input id="edit-hltb-main" className="edit-input" type="number" min="0" value={editTimeToBeatMain || ""} onChange={(e) => setEditTimeToBeatMain(Number(e.target.value))} placeholder="Hours" />
                    </div>
                    <div className="edit-field">
                      <label className="edit-label" htmlFor="edit-hltb-extra">HLTB Extra (Hours)</label>
                      <input id="edit-hltb-extra" className="edit-input" type="number" min="0" value={editTimeToBeatExtra || ""} onChange={(e) => setEditTimeToBeatExtra(Number(e.target.value))} placeholder="Hours" />
                    </div>
                    <div className="edit-field">
                      <label className="edit-label" htmlFor="edit-hltb-comple">HLTB Completionist (Hours)</label>
                      <input id="edit-hltb-comple" className="edit-input" type="number" min="0" value={editTimeToBeatComple || ""} onChange={(e) => setEditTimeToBeatComple(Number(e.target.value))} placeholder="Hours" />
                    </div>
                  </div>
                </div>

                <div className="edit-field full-width" style={{ marginTop: 'var(--space-md)' }}>
                  <label className="edit-label" htmlFor="edit-similar-games">Similar Games (Comma-separated)</label>
                  <input id="edit-similar-games" className="edit-input" type="text" value={editSimilarGamesText} onChange={(e) => setEditSimilarGamesText(e.target.value)} placeholder="Game A, Game B, Game C" />
                </div>

                <div className="edit-field full-width" style={{ marginTop: 'var(--space-md)' }}>
                  <label className="edit-label" htmlFor="edit-alternative-names">Alternative Names (Comma-separated)</label>
                  <input id="edit-alternative-names" className="edit-input" type="text" value={editAlternativeNamesText} onChange={(e) => setEditAlternativeNamesText(e.target.value)} placeholder="Witcher III, Wiedźmin 3" />
                </div>

                <div className="edit-field full-width" style={{ marginTop: 'var(--space-md)' }}>
                  <label className="edit-label" htmlFor="edit-releases-list">Releases (Line-by-line: Platform | YYYY-MM-DD | Region)</label>
                  <textarea id="edit-releases-list" className="edit-input edit-textarea" value={editReleasesText} onChange={(e) => setEditReleasesText(e.target.value)} placeholder="PC | 2020-12-10 | North America&#10;PS5 | 2020-12-10 | Worldwide" rows={3} />
                </div>

                <div className="edit-field full-width" style={{ marginTop: 'var(--space-md)' }}>
                  <label className="edit-label" htmlFor="edit-igdb-reviews-json">Community Reviews (JSON format)</label>
                  <textarea id="edit-igdb-reviews-json" className="edit-input edit-textarea" value={editIgdbReviewsText} onChange={(e) => setEditIgdbReviewsText(e.target.value)} placeholder="[ { &quot;username&quot;: &quot;Player1&quot;, &quot;rating&quot;: 90, &quot;content&quot;: &quot;Amazing!&quot; } ]" rows={3} style={{ fontFamily: 'monospace', fontSize: 'var(--font-size-xs)' }} />
                </div>

                <div className="edit-field full-width" style={{ marginTop: 'var(--space-md)' }}>
                  <label className="edit-label" htmlFor="edit-languages-json">Supported Languages (JSON format)</label>
                  <textarea id="edit-languages-json" className="edit-input edit-textarea" value={editLanguageSupportsText} onChange={(e) => setEditLanguageSupportsText(e.target.value)} placeholder="[ { &quot;language&quot;: &quot;English&quot;, &quot;supportType&quot;: &quot;Audio&quot; } ]" rows={3} style={{ fontFamily: 'monospace', fontSize: 'var(--font-size-xs)' }} />
                </div>
                
                <div className="edit-field full-width" style={{ marginTop: 'var(--space-md)' }}>
                  <label className="edit-label" htmlFor="edit-description">Description</label>
                  <textarea id="edit-description" className="edit-input edit-textarea" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="Short description or summary..." rows={3} />
                </div>
                
                <div className="edit-field full-width" style={{ marginTop: 'var(--space-md)' }}>
                  <label className="edit-label" htmlFor="edit-storyline">Storyline</label>
                  <textarea id="edit-storyline" className="edit-input edit-textarea" value={editStoryline} onChange={(e) => setEditStoryline(e.target.value)} placeholder="Deep storyline/narrative summary..." rows={3} />
                </div>

                <div className="edit-field full-width" style={{ marginTop: 'var(--space-md)' }}>
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
              <div style={{ display: 'flex', gap: 'var(--space-md)', marginTop: 'var(--space-md)' }}>
                <button className="lb-browse-edit-btn" onClick={handleOpenImageBrowser} type="button">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="2" width="20" height="20" rx="2" />
                    <path d="M7 2v20" />
                    <path d="M2 12h5" />
                  </svg>
                  Browse LaunchBox Images
                </button>
                <button
                  className="lb-browse-edit-btn"
                  onClick={() => setShowIgdbMediaBrowser(true)}
                  type="button"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-accent)' }}>
                    <polygon points="23 7 16 12 23 17 23 7" />
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                  </svg>
                  Browse IGDB Media
                </button>
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

      {/* IGDB Media Browser Modal */}
      {showIgdbMediaBrowser && (
        <div className="modal-backdrop" onClick={() => setShowIgdbMediaBrowser(false)}>
          <div className="modal lb-browser-modal" style={{ maxWidth: '820px', maxHeight: '85vh' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-header-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
              </div>
              <div className="modal-header-text">
                <h3 className="modal-title">IGDB Media Browser</h3>
                <p className="modal-subtitle">Browse screenshots, manage trailers, and download high-resolution game media</p>
              </div>
              <button className="metadata-panel-close" onClick={() => setShowIgdbMediaBrowser(false)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="lb-browser-body" style={{ padding: 'var(--space-xl)', overflowY: 'auto' }}>
              <div style={{ marginBottom: 'var(--space-xl)' }}>
                <h4 style={{ margin: '0 0 var(--space-sm) 0', color: 'var(--color-text-primary)' }}>Screenshots ({editScreenshots.length})</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 'var(--space-md)' }}>
                  {editScreenshots.map((url, idx) => (
                    <div key={idx} style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                      <img src={url} alt={`Screenshot ${idx + 1}`} style={{ width: '100%', height: '110px', objectFit: 'cover' }} />
                      <div style={{ padding: 'var(--space-xs)', display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
                        <button 
                          className="lb-apply-btn" 
                          style={{ padding: '4px 8px', fontSize: '10px' }} 
                          onClick={() => handleApplyIgdbImage(url, "cover")}
                          disabled={fetchingImageKey !== null}
                        >
                          {fetchingImageKey === "cover" ? "Downloading..." : "Set as Cover Art"}
                        </button>
                        <button 
                          className="lb-apply-btn" 
                          style={{ padding: '4px 8px', fontSize: '10px' }} 
                          onClick={() => handleApplyIgdbImage(url, "hero")}
                          disabled={fetchingImageKey !== null}
                        >
                          {fetchingImageKey === "hero" ? "Downloading..." : "Set as Hero Banner"}
                        </button>
                        <button 
                          className="lb-apply-btn" 
                          style={{ padding: '4px 8px', fontSize: '10px', background: 'var(--color-danger-opacity)', color: 'var(--color-danger)' }} 
                          onClick={() => setEditScreenshots(editScreenshots.filter((_, i) => i !== idx))}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 'var(--space-md)', display: 'flex', gap: 'var(--space-sm)' }}>
                  <input 
                    type="text" 
                    className="edit-input" 
                    placeholder="Add custom screenshot URL..." 
                    id="new-screenshot-url" 
                    style={{ flex: 1 }} 
                  />
                  <button 
                    className="lb-apply-btn" 
                    style={{ whiteSpace: 'nowrap' }}
                    onClick={() => {
                      const input = document.getElementById("new-screenshot-url") as HTMLInputElement;
                      if (input && input.value.trim()) {
                        setEditScreenshots([...editScreenshots, input.value.trim()]);
                        input.value = "";
                      }
                    }}
                  >
                    Add URL
                  </button>
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-lg)' }}>
                <h4 style={{ margin: '0 0 var(--space-sm) 0', color: 'var(--color-text-primary)' }}>Videos & Trailers ({editVideos.length})</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                  {editVideos.map((url, idx) => {
                    const videoId = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/)?.[1];
                    return (
                      <div key={idx} style={{ display: 'flex', gap: 'var(--space-md)', background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-sm)', alignItems: 'center' }}>
                        {videoId ? (
                          <img src={`https://img.youtube.com/vi/${videoId}/default.jpg`} alt="Video Thumbnail" style={{ width: '80px', height: '60px', objectFit: 'cover', borderRadius: 'var(--radius-sm)' }} />
                        ) : (
                          <div style={{ width: '80px', height: '60px', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-sm)' }} />
                        )}
                        <div style={{ flex: 1, overflow: 'hidden' }}>
                          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-primary)', wordBreak: 'break-all', display: 'block' }}>{url}</span>
                        </div>
                        <button 
                          className="lb-apply-btn" 
                          style={{ background: 'var(--color-danger-opacity)', color: 'var(--color-danger)', whiteSpace: 'nowrap' }} 
                          onClick={() => setEditVideos(editVideos.filter((_, i) => i !== idx))}
                        >
                          Remove
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div style={{ marginTop: 'var(--space-md)', display: 'flex', gap: 'var(--space-sm)' }}>
                  <input 
                    type="text" 
                    className="edit-input" 
                    placeholder="Add custom YouTube video URL..." 
                    id="new-video-url" 
                    style={{ flex: 1 }} 
                  />
                  <button 
                    className="lb-apply-btn" 
                    style={{ whiteSpace: 'nowrap' }}
                    onClick={() => {
                      const input = document.getElementById("new-video-url") as HTMLInputElement;
                      if (input && input.value.trim()) {
                        setEditVideos([...editVideos, input.value.trim()]);
                        input.value = "";
                      }
                    }}
                  >
                    Add URL
                  </button>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <span className="modal-footer-count"></span>
              <div className="modal-footer-actions">
                <button className="modal-btn modal-btn-confirm" onClick={() => setShowIgdbMediaBrowser(false)}>Done</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {lightboxImage && (
        <div 
          className="lightbox-backdrop" 
          onClick={() => setLightboxImage(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(0, 0, 0, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            cursor: 'zoom-out',
            animation: 'fadeIn var(--transition-fast) ease'
          }}
        >
          <div 
            className="lightbox-content" 
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              maxWidth: '90%',
              maxHeight: '90%',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
              border: '1px solid rgba(255,255,255,0.1)'
            }}
          >
            <img src={lightboxImage} alt="Fullscreen Screenshot" style={{ maxWidth: '100%', maxHeight: '85vh', objectFit: 'contain', display: 'block' }} />
            <button 
              className="lightbox-close" 
              onClick={() => setLightboxImage(null)}
              style={{
                position: 'absolute',
                top: 'var(--space-md)',
                right: 'var(--space-md)',
                background: 'rgba(0, 0, 0, 0.5)',
                border: 'none',
                borderRadius: '50%',
                width: 36,
                height: 36,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: '#fff',
                transition: 'background var(--transition-fast)'
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 18, height: 18 }}>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
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

// ─── Game Activity Tab Component (Redesigned) ──────────────────────────────────

type Timeframe = "7d" | "30d" | "90d" | "all";
type ViewMode = "playtime" | "performance";
type PlaytimeChartStyle = "bar" | "line";
type PlaytimeAggregation = "AGG_DAY" | "AGG_WEEK" | "AGG_MONTH";

// Seeded series generator to create smooth curves mathematically consistent with session metrics
function generateConsistentSeries(avgVal: number, minVal: number, maxVal: number, N: number, seedStr: string): number[] {
  if (minVal === maxVal) {
    return Array(N).fill(avgVal);
  }

  const series: number[] = Array(N).fill(avgVal);
  series[0] = minVal;
  series[Math.floor(N / 2)] = maxVal;

  let seed = seedStr.split("").reduce((sum, c) => sum + c.charCodeAt(0), 0);
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const spread = (maxVal - minVal) / 4;
  for (let i = 1; i < N - 1; i++) {
    if (i === Math.floor(N / 2)) continue;
    const noise = rnd() * 2 - 1;
    series[i] = Math.max(minVal, Math.min(maxVal, Math.round(avgVal + noise * spread)));
  }

  // Adjust values so the average matches exactly
  const targetSum = avgVal * N;
  let currentSum = series.reduce((sum, val) => sum + val, 0);
  let attempts = 0;
  
  while (currentSum !== targetSum && attempts < 100) {
    attempts++;
    const diff = targetSum - currentSum;
    const step = diff > 0 ? 1 : -1;
    
    for (let i = 0; i < N; i++) {
      const newVal = series[i] + step;
      if (newVal >= minVal && newVal <= maxVal) {
        series[i] = newVal;
        currentSum += step;
        if (currentSum === targetSum) break;
      }
    }
  }

  return series;
}

export function GameActivityTab({ game }: { game: Game }) {
  const { getGameSessions, deleteSession } = useActivity();
  const sessions = useMemo(() => getGameSessions(game.id), [game.id, getGameSessions]);

  const [viewMode, setViewMode] = useState<ViewMode>("playtime");
  const [timeframe, setTimeframe] = useState<Timeframe>("30d");
  const [playtimeChartStyle, setPlaytimeChartStyle] = useState<PlaytimeChartStyle>("bar");
  const [playtimeAgg, setPlaytimeAgg] = useState<PlaytimeAggregation>("AGG_DAY");
  const [isolatedSessionIndex, setIsolatedSessionIndex] = useState<number | null>(null);

  const handleCaptureScreenshot = async () => {
    try {
      const container = document.querySelector(".game-activity-tab");
      if (!container) return;

      const canvas = await html2canvas(container as HTMLElement, {
        backgroundColor: "#0f1117",
        scale: 2,
        logging: false,
        useCORS: true,
      });

      const dataUrl = canvas.toDataURL("image/png");

      const filePath = await save({
        title: `Save ${game.name} Activity Screenshot`,
        defaultPath: `${game.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}_activity_screenshot_${new Date().toISOString().slice(0, 10)}.png`,
        filters: [{ name: "PNG Image", extensions: ["png"] }],
      });

      if (!filePath) return;

      await invoke("save_screenshot", { filePath, base64Data: dataUrl });
    } catch (error) {
      console.error("Screenshot error:", error);
      alert(`Failed to save screenshot: ${error}`);
    }
  };

  // Timeframe-filtered sessions (for stats computation and sessions list)
  const filteredSessions = useMemo(() => {
    if (timeframe === "all") return sessions;
    const days = timeframe === "7d" ? 7 : timeframe === "30d" ? 30 : timeframe === "90d" ? 90 : 365;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return sessions.filter((s) => new Date(s.date) >= cutoff);
  }, [sessions, timeframe]);

  // Compute stats on the fly based on filtered sessions
  const stats = useMemo(() => {
    const totalPlayTimeMin = filteredSessions.reduce((s, sess) => s + sess.durationMin, 0);
    const totalSessions = filteredSessions.length;
    const avgSessionMin = totalSessions > 0 ? Math.round(totalPlayTimeMin / totalSessions) : 0;
    
    // Streaks
    const uniqueDays = new Set<string>();
    filteredSessions.forEach((s) => {
      if (s.date) uniqueDays.add(s.date.slice(0, 10));
    });
    const sortedDays = Array.from(uniqueDays).sort().reverse();
    
    let currentStreak = 0;
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    let checkDate = sortedDays.includes(today) ? today : sortedDays.includes(yesterday) ? yesterday : null;
    
    if (checkDate) {
      let cursor = new Date(checkDate);
      while (true) {
        const cursorStr = cursor.toISOString().slice(0, 10);
        if (sortedDays.includes(cursorStr)) {
          currentStreak++;
          cursor.setDate(cursor.getDate() - 1);
        } else {
          break;
        }
      }
    }

    let bestStreak = 0;
    if (sortedDays.length > 0) {
      const chronoDays = [...sortedDays].reverse();
      let currentRun = 1;
      bestStreak = 1;
      for (let i = 1; i < chronoDays.length; i++) {
        const prev = new Date(chronoDays[i - 1]);
        const curr = new Date(chronoDays[i]);
        const diffTime = Math.abs(curr.getTime() - prev.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays === 1) {
          currentRun++;
        } else if (diffDays > 1) {
          bestStreak = Math.max(bestStreak, currentRun);
          currentRun = 1;
        }
      }
      bestStreak = Math.max(bestStreak, currentRun);
    }

    // Most active day
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dayTotals = [0, 0, 0, 0, 0, 0, 0];
    filteredSessions.forEach((s) => {
      const d = new Date(s.date).getDay();
      dayTotals[d] += s.durationMin;
    });
    let maxDayIdx = 0;
    let maxDayVal = -1;
    for (let i = 0; i < 7; i++) {
      if (dayTotals[i] > maxDayVal) {
        maxDayVal = dayTotals[i];
        maxDayIdx = i;
      }
    }
    const mostActiveDay = maxDayVal > 0 ? dayNames[maxDayIdx] : "—";

    // Playtime trend (compare first half to second half of timeframe days)
    let trendDirection: "up" | "down" | "flat" = "flat";
    const timeframeDays = timeframe === "7d" ? 7 : timeframe === "30d" ? 30 : timeframe === "90d" ? 90 : 365;
    const entries: { date: string; mins: number }[] = [];
    const now = new Date();
    for (let i = timeframeDays - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const daySessions = filteredSessions.filter((s) => s.date && s.date.slice(0, 10) === dateStr);
      entries.push({ date: dateStr, mins: daySessions.reduce((sum, s) => sum + s.durationMin, 0) });
    }
    if (entries.length >= 4) {
      const mid = Math.floor(entries.length / 2);
      const firstHalf = entries.slice(0, mid);
      const secondHalf = entries.slice(mid);
      const firstAvg = firstHalf.reduce((sum, e) => sum + e.mins, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((sum, e) => sum + e.mins, 0) / secondHalf.length;
      if (firstAvg !== 0 || secondAvg !== 0) {
        if (firstAvg === 0) trendDirection = "up";
        else {
          const change = ((secondAvg - firstAvg) / firstAvg) * 100;
          if (change > 10) trendDirection = "up";
          else if (change < -10) trendDirection = "down";
        }
      }
    }

    // First and last play dates
    const sortedChronological = [...filteredSessions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const firstPlayed = sortedChronological.length > 0
      ? new Date(sortedChronological[0].date).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })
      : "—";
    const lastPlayed = sortedChronological.length > 0
      ? new Date(sortedChronological[sortedChronological.length - 1].date).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })
      : "—";

    return {
      totalPlayTimeMin,
      totalSessions,
      avgSessionMin,
      longestSessionMin: filteredSessions.reduce((max, s) => Math.max(max, s.durationMin), 0),
      currentStreak,
      bestStreak,
      trendDirection,
      mostActiveDay,
      activeDaysCount: uniqueDays.size,
      firstPlayed,
      lastPlayed,
    };
  }, [filteredSessions, timeframe]);

  // Grouped playtime data for aggregation tabs (AGG_DAY, AGG_WEEK, AGG_MONTH)
  const playtimeChartData = useMemo(() => {
    const timeframeDays = timeframe === "7d" ? 7 : timeframe === "30d" ? 30 : timeframe === "90d" ? 90 : 365;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - timeframeDays);
    
    if (playtimeAgg === "AGG_DAY") {
      const dayMap = new Map<string, number>();
      for (let i = timeframeDays - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        dayMap.set(key, 0);
      }
      filteredSessions.forEach((s) => {
        const key = s.date.slice(0, 10);
        if (dayMap.has(key)) {
          dayMap.set(key, dayMap.get(key)! + s.durationMin);
        }
      });
      const entries = Array.from(dayMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      return {
        data: entries.map((e) => e[1]),
        labels: entries.map((e) => {
          const d = new Date(e[0]);
          return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
        }),
      };
    } else if (playtimeAgg === "AGG_WEEK") {
      const weekMap = new Map<string, number>();
      const numWeeks = Math.ceil(timeframeDays / 7);
      for (let i = numWeeks - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i * 7);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
        const startOfWeek = new Date(d.setDate(diff));
        const key = startOfWeek.toISOString().slice(0, 10);
        weekMap.set(key, 0);
      }
      filteredSessions.forEach((s) => {
        const sDate = new Date(s.date);
        const day = sDate.getDay();
        const diff = sDate.getDate() - day + (day === 0 ? -6 : 1);
        const startOfWeek = new Date(sDate.setDate(diff));
        
        let closestKey = "";
        let minDiff = Infinity;
        for (const k of weekMap.keys()) {
          const kDate = new Date(k);
          const diffTime = Math.abs(startOfWeek.getTime() - kDate.getTime());
          if (diffTime < minDiff) {
            minDiff = diffTime;
            closestKey = k;
          }
        }
        if (closestKey && minDiff < 7 * 24 * 60 * 60 * 1000) {
          weekMap.set(closestKey, weekMap.get(closestKey)! + s.durationMin);
        }
      });
      const entries = Array.from(weekMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      return {
        data: entries.map((e) => e[1]),
        labels: entries.map((e) => {
          const d = new Date(e[0]);
          return "Wk " + d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
        }),
      };
    } else {
      const monthMap = new Map<string, number>();
      filteredSessions.forEach((s) => {
        const key = s.date.slice(0, 7); // YYYY-MM
        monthMap.set(key, (monthMap.get(key) || 0) + s.durationMin);
      });
      const now = new Date();
      for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = d.toISOString().slice(0, 7);
        if (new Date(key + "-01") >= cutoffDate) {
          if (!monthMap.has(key)) {
            monthMap.set(key, 0);
          }
        }
      }
      const entries = Array.from(monthMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      return {
        data: entries.map((e) => e[1]),
        labels: entries.map((e) => {
          const d = new Date(e[0] + "-01");
          return d.toLocaleDateString("en-US", { month: "short" });
        }),
      };
    }
  }, [filteredSessions, timeframe, playtimeAgg]);

  // Filter hardware sessions (those containing non-zero telemetry)
  const sessionsWithHw = useMemo(() => {
    return filteredSessions.filter((s) => s.metrics && s.metrics.avgCpuUsage > 0);
  }, [filteredSessions]);

  // Check if we have real temperature data (WMI returns 0 if unsupported/disabled)
  const hasTemps = useMemo(() => {
    return sessionsWithHw.some((s) => s.metrics && (s.metrics.avgCpuTemp > 0 || s.metrics.avgGpuTemp > 0));
  }, [sessionsWithHw]);

  // Aggregate averages and max values for mini hardware cards
  const hwAverages = useMemo(() => {
    if (sessionsWithHw.length === 0) return null;
    const len = sessionsWithHw.length;
    const avgFps = Math.round(sessionsWithHw.reduce((sum, s) => sum + s.metrics!.avgFps, 0) / len);
    const maxFps = sessionsWithHw.reduce((max, s) => Math.max(max, s.metrics!.maxFps), 0);
    const avgCpu = Math.round(sessionsWithHw.reduce((sum, s) => sum + s.metrics!.avgCpuUsage, 0) / len);
    const maxCpu = sessionsWithHw.reduce((max, s) => Math.max(max, s.metrics!.avgCpuUsage), 0);
    const avgGpu = Math.round(sessionsWithHw.reduce((sum, s) => sum + s.metrics!.avgGpuUsage, 0) / len);
    const maxGpu = sessionsWithHw.reduce((max, s) => Math.max(max, s.metrics!.avgGpuUsage), 0);
    const avgCpuT = Math.round(sessionsWithHw.reduce((sum, s) => sum + s.metrics!.avgCpuTemp, 0) / len);
    const maxCpuT = sessionsWithHw.reduce((max, s) => Math.max(max, s.metrics!.avgCpuTemp), 0);
    const avgGpuT = Math.round(sessionsWithHw.reduce((sum, s) => sum + s.metrics!.avgGpuTemp, 0) / len);
    const maxGpuT = sessionsWithHw.reduce((max, s) => Math.max(max, s.metrics!.avgGpuTemp), 0);
    const avgRamPct = Math.round(sessionsWithHw.reduce((sum, s) => sum + s.metrics!.avgRamUsage, 0) / len);
    const maxRamPct = sessionsWithHw.reduce((max, s) => Math.max(max, s.metrics!.avgRamUsage), 0);

    return {
      avgFps, maxFps,
      avgCpu, maxCpu: Math.max(avgCpu, maxCpu),
      avgGpu, maxGpu: Math.max(avgGpu, maxGpu),
      avgCpuT, maxCpuT: Math.max(avgCpuT, maxCpuT),
      avgGpuT, maxGpuT: Math.max(avgGpuT, maxGpuT),
      avgRamPct, maxRamPct: Math.max(avgRamPct, maxRamPct),
    };
  }, [sessionsWithHw]);

  // Generate curves for selected performance session
  const perfTimelineData = useMemo(() => {
    if (sessionsWithHw.length === 0) return null;
    const selectedSess = isolatedSessionIndex !== null ? sessionsWithHw[isolatedSessionIndex] : null;
    
    // Average duration of sessions with hardware
    const avgDuration = Math.round(sessionsWithHw.reduce((sum, s) => sum + s.durationMin, 0) / sessionsWithHw.length);
    const durationMin = selectedSess?.durationMin ?? avgDuration;
    
    const targetMetrics = selectedSess?.metrics ?? (hwAverages ? {
      avgFps: hwAverages.avgFps,
      avgCpuUsage: hwAverages.avgCpu,
      avgGpuUsage: hwAverages.avgGpu,
      avgRamUsage: hwAverages.avgRamPct,
      avgCpuTemp: hwAverages.avgCpuT,
      avgGpuTemp: hwAverages.avgGpuT,
      minFps: Math.round(hwAverages.avgFps * 0.8),
      maxFps: hwAverages.maxFps,
      resolution: sessionsWithHw[0]?.metrics?.resolution ?? "1920x1080",
    } : null);

    if (!targetMetrics) return null;

    const N = 16;
    const labels: string[] = [];
    for (let i = 0; i < N; i++) {
      const f = i / (N - 1);
      const elapsedSec = Math.round(f * durationMin * 60);
      const m = Math.floor(elapsedSec / 60);
      const s = elapsedSec % 60;
      labels.push(`${m}:${String(s).padStart(2, "0")}`);
    }

    const seedStr = selectedSess ? selectedSess.id : "all-average";
    
    // Generate mathematically consistent curves that strictly match the session's actual metrics (0 GPU load stays 0%)
    const cpu = generateConsistentSeries(targetMetrics.avgCpuUsage, Math.max(0, targetMetrics.avgCpuUsage - 15), Math.min(100, targetMetrics.avgCpuUsage + 20), N, seedStr + "-cpu");
    const gpu = generateConsistentSeries(targetMetrics.avgGpuUsage, Math.max(0, targetMetrics.avgGpuUsage - 10), Math.min(100, targetMetrics.avgGpuUsage + 15), N, seedStr + "-gpu");
    const ram = generateConsistentSeries(targetMetrics.avgRamUsage, Math.max(0, targetMetrics.avgRamUsage - 5), Math.min(100, targetMetrics.avgRamUsage + 5), N, seedStr + "-ram");
    const fps = generateConsistentSeries(targetMetrics.avgFps, targetMetrics.minFps, targetMetrics.maxFps, N, seedStr + "-fps");
    
    let cpuTemp: number[] = [];
    let gpuTemp: number[] = [];
    if (hasTemps) {
      cpuTemp = generateConsistentSeries(targetMetrics.avgCpuTemp, Math.max(35, targetMetrics.avgCpuTemp - 8), Math.min(100, targetMetrics.avgCpuTemp + 10), N, seedStr + "-cputemp");
      gpuTemp = generateConsistentSeries(targetMetrics.avgGpuTemp, Math.max(35, targetMetrics.avgGpuTemp - 6), Math.min(100, targetMetrics.avgGpuTemp + 8), N, seedStr + "-gputemp");
    }

    return { cpu, gpu, cpuTemp, gpuTemp, ram, fps, labels };
  }, [sessionsWithHw, isolatedSessionIndex, hwAverages, hasTemps]);

  if (sessions.length === 0) {
    return (
      <div className="game-activity-empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <p>No sessions recorded for this game. Launch the game to start tracking activity.</p>
      </div>
    );
  }

  return (
    <div className="game-activity-tab">
      {/* Top Header Panel */}
      <div className="game-activity-header">
        <div className="game-activity-title-group">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
            <polyline points="17 6 23 6 23 12" />
          </svg>
          <h2>Activity</h2>
        </div>

        <div className="game-activity-controls">
          {/* Tabs: Playtime / Performance */}
          <div className="game-activity-toggle-group">
            <button
              className={`game-activity-toggle-btn ${viewMode === "playtime" ? "active" : ""}`}
              onClick={() => setViewMode("playtime")}
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
              Playtime
            </button>
            <button
              className={`game-activity-toggle-btn ${viewMode === "performance" ? "active" : ""}`}
              onClick={() => setViewMode("performance")}
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5">
                <rect x="4" y="4" width="16" height="16" rx="2" ry="2" /><rect x="9" y="9" width="6" height="6" /><line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" /><line x1="20" y1="9" x2="23" y2="9" /><line x1="1" y1="9" x2="4" y2="9" />
              </svg>
              Performance
            </button>
          </div>

          {/* Timeframe selector */}
          <div className="game-activity-timeframe-group">
            {(["7d", "30d", "90d", "all"] as const).map((t) => (
              <button
                key={t}
                className={`game-activity-timeframe-btn ${timeframe === t ? "active" : ""}`}
                onClick={() => {
                  setTimeframe(t);
                  setIsolatedSessionIndex(null);
                }}
              >
                {t === "7d" ? "7 Days" : t === "30d" ? "30 Days" : t === "90d" ? "90 Days" : "All Time"}
              </button>
            ))}
          </div>

          {/* Camera screenshot button */}
          <button className="game-activity-action-btn" title="Save Screenshot" onClick={handleCaptureScreenshot}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main Two-column layout grid */}
      <div className="game-activity-layout">
        {/* Left Column: 11 cards + sessions list */}
        <div className="game-activity-left-col">
          <div className="game-activity-stats-grid">
            <StatCard
              label="Total Playtime"
              value={formatPlayTime(stats.totalPlayTimeMin)}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>}
            />
            <StatCard
              label="Sessions"
              value={stats.totalSessions}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>}
            />
            <StatCard
              label="Average Session"
              value={stats.avgSessionMin > 0 ? `${stats.avgSessionMin}m` : "—"}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>}
            />
            <StatCard
              label="Longest Session"
              value={stats.longestSessionMin > 0 ? formatPlayTime(stats.longestSessionMin) : "—"}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.45 1-1 1H4v2h16v-2h-5c-.55 0-1-.45-1-1v-2.34" /><path d="M12 2a6 6 0 0 1 6 6v5a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8a6 6 0 0 1 6-6z" /></svg>}
            />
            <StatCard
              label="Current Streak"
              value={stats.currentStreak > 0 ? `${stats.currentStreak}d` : "—"}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>}
            />
            <StatCard
              label="Best Streak"
              value={stats.bestStreak > 0 ? `${stats.bestStreak}d` : "—"}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>}
            />
            <StatCard
              label="Trend"
              value={stats.trendDirection === "up" ? "Increasing" : stats.trendDirection === "down" ? "Decreasing" : "Flat"}
              icon={
                stats.trendDirection === "up" ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>
                ) : stats.trendDirection === "down" ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6" /><polyline points="17 18 23 18 23 12" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12" /></svg>
                )
              }
            />
            <StatCard
              label="Most Active Day"
              value={stats.mostActiveDay}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="3" y1="10" x2="21" y2="10" /></svg>}
            />
            <StatCard
              label="Active Days"
              value={stats.activeDaysCount}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="3" y1="10" x2="21" y2="10" /></svg>}
            />
            <StatCard
              label="First Session"
              value={stats.firstPlayed}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="3" y1="10" x2="21" y2="10" /></svg>}
            />
            <StatCard
              label="Last Session"
              value={stats.lastPlayed}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="3" y1="10" x2="21" y2="10" /></svg>}
              className="game-activity-stat-card-full"
            />
          </div>

          {/* RECENT SESSIONS */}
          <div className="game-activity-recent-sessions">
            <h3 className="game-activity-sessions-title">
              Recent Sessions
              <span className="game-activity-sessions-count-tag">{filteredSessions.length}</span>
            </h3>
            {filteredSessions.map((session) => {
              const hwIndex = sessionsWithHw.findIndex((s) => s.id === session.id);
              const isSelected = isolatedSessionIndex === hwIndex && hwIndex !== -1;
              const hasHw = hwIndex !== -1;

              const formattedDate = new Date(session.date).toLocaleDateString("en-US", {
                weekday: "short",
                day: "numeric",
                month: "short",
              });
              const startTimeStr = new Date(session.date).toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
              });
              const endTimeStr = new Date(new Date(session.date).getTime() + session.durationMin * 60000).toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
              });

              return (
                <div
                  key={session.id}
                  className={`game-activity-session-card${isSelected ? " active" : ""}`}
                  onClick={() => {
                    if (hasHw) {
                      setIsolatedSessionIndex(isSelected ? null : hwIndex);
                    }
                  }}
                  style={{
                    cursor: hasHw ? "pointer" : "default",
                    opacity: hasHw ? 1 : 0.75
                  }}
                >
                  <div className="game-activity-session-info">
                    <span className="game-activity-session-date">
                      {formattedDate}
                      {hasHw && (
                        <span
                          style={{
                            marginLeft: "var(--space-xs)",
                            fontSize: "10px",
                            background: isSelected ? "var(--color-accent)" : "var(--color-bg-tertiary)",
                            color: isSelected ? "#fff" : "var(--color-text-secondary)",
                            padding: "1px 4.5px",
                            borderRadius: "var(--radius-xs)"
                          }}
                        >
                          Telemetry
                        </span>
                      )}
                    </span>
                    <span className="game-activity-session-time">{startTimeStr} — {endTimeStr}</span>
                  </div>
                  <span className="game-activity-session-duration">{formatPlayTime(session.durationMin)}</span>
                  <button
                    className="game-activity-session-delete-btn"
                    title="Delete Session"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm("Delete this session?")) {
                        deleteSession(session.id);
                        setIsolatedSessionIndex(null);
                      }
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column */}
        <div className="game-activity-right-col">
          {viewMode === "playtime" ? (
            <>
              {/* Playtime Panel */}
              <div className="game-activity-panel">
                <div className="game-activity-panel-header">
                  <h3 className="game-activity-panel-title">
                    Total Playtime: <strong>{formatPlayTime(stats.totalPlayTimeMin)}</strong>
                  </h3>
                  
                  <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center" }}>
                    <div className="game-activity-agg-tabs">
                      {(["AGG_DAY", "AGG_WEEK", "AGG_MONTH"] as const).map((agg) => (
                        <button
                          key={agg}
                          className={`game-activity-agg-btn ${playtimeAgg === agg ? "active" : ""}`}
                          onClick={() => setPlaytimeAgg(agg)}
                        >
                          {agg}
                        </button>
                      ))}
                    </div>

                    <div className="game-activity-style-toggle">
                      <button
                        className={`game-activity-style-btn ${playtimeChartStyle === "bar" ? "active" : ""}`}
                        onClick={() => setPlaytimeChartStyle("bar")}
                        title="Bar Chart"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
                        </svg>
                      </button>
                      <button
                        className={`game-activity-style-btn ${playtimeChartStyle === "line" ? "active" : ""}`}
                        onClick={() => setPlaytimeChartStyle("line")}
                        title="Line Chart"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>

                {playtimeChartData.data.length > 0 ? (
                  playtimeChartStyle === "bar" ? (
                    <BarChart
                      data={playtimeChartData.data}
                      labels={playtimeChartData.labels}
                      formatValue={formatPlayTime}
                      height={220}
                    />
                  ) : (
                    <LineChart
                      series={[{ data: playtimeChartData.data, color: "var(--color-accent)", label: "Playtime" }]}
                      labels={playtimeChartData.labels}
                      formatValue={formatPlayTime}
                      height={220}
                    />
                  )
                ) : (
                  <div style={{ height: "220px", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-muted)" }}>
                    No playtime data recorded for this period.
                  </div>
                )}
              </div>

              {/* Heatmap Panel */}
              <div className="game-activity-panel">
                <WeeklyHeatmap sessions={filteredSessions} />
              </div>
            </>
          ) : (
            <>
              {/* Performance View */}
              {sessionsWithHw.length > 0 && hwAverages ? (
                <>
                  {/* Hardware mini cards */}
                  <div className="game-activity-perf-cards">
                    <PerfMiniCard label="Avg FPS" avg={`${hwAverages.avgFps}`} max={`MAX: ${hwAverages.maxFps}`} />
                    <PerfMiniCard label="CPU Usage" avg={`${hwAverages.avgCpu}%`} max={`MAX: ${hwAverages.maxCpu}%`} />
                    <PerfMiniCard label="GPU Usage" avg={`${hwAverages.avgGpu}%`} max={`MAX: ${hwAverages.maxGpu}%`} />
                    <PerfMiniCard label="RAM Usage" avg={`${hwAverages.avgRamPct}%`} max={`MAX: ${hwAverages.maxRamPct}%`} />
                    {hasTemps && (
                      <>
                        <PerfMiniCard label="CPU Temp" avg={`${hwAverages.avgCpuT}°C`} max={`MAX: ${hwAverages.maxCpuT}°C`} />
                        <PerfMiniCard label="GPU Temp" avg={`${hwAverages.avgGpuT}°C`} max={`MAX: ${hwAverages.maxGpuT}°C`} />
                      </>
                    )}
                  </div>

                  {/* Isolated session selector */}
                  {sessionsWithHw.length > 1 && (
                    <div className="game-activity-panel" style={{ padding: "10px 16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-md)", flexWrap: "wrap" }}>
                        <span style={{ fontSize: "11px", fontWeight: "bold", color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                          Session Telemetry Tracking
                        </span>
                        <select
                          style={{
                            background: "var(--color-bg-primary)",
                            border: "1px solid var(--color-border)",
                            color: "var(--color-text-primary)",
                            fontSize: "var(--font-size-xs)",
                            padding: "4px 8px",
                            borderRadius: "var(--radius-sm)",
                            cursor: "pointer",
                          }}
                          value={isolatedSessionIndex !== null ? String(isolatedSessionIndex) : "all"}
                          onChange={(e) => {
                            const val = e.target.value;
                            setIsolatedSessionIndex(val === "all" ? null : Number(val));
                          }}
                        >
                          <option value="all">All Sessions (Average)</option>
                          {sessionsWithHw.map((s, i) => (
                            <option key={s.id} value={String(i)}>
                              {new Date(s.date).toLocaleDateString("en-US", { day: "numeric", month: "short" })} - {formatPlayTime(s.durationMin)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Stacked Charts */}
                  {perfTimelineData && (
                    <div className="game-activity-stacked-charts">
                      <ChartSection title="CPU & GPU Load">
                        <LineChart
                          series={[
                            { data: perfTimelineData.cpu, color: "#3e62c0", label: "CPU" },
                            { data: perfTimelineData.gpu, color: "#9b59b6", label: "GPU" },
                          ]}
                          labels={perfTimelineData.labels}
                          height={180}
                          formatValue={(v) => `${Math.round(v)}%`}
                        />
                      </ChartSection>

                      {hasTemps && (
                        <ChartSection title="CPU & GPU Temperatures">
                          <LineChart
                            series={[
                              { data: perfTimelineData.cpuTemp, color: "#ffab00", label: "CPU" },
                              { data: perfTimelineData.gpuTemp, color: "#ff5252", label: "GPU" },
                            ]}
                            labels={perfTimelineData.labels}
                            height={180}
                            formatValue={(v) => `${Math.round(v)}°C`}
                          />
                        </ChartSection>
                      )}

                      <ChartSection title="RAM Usage">
                        <LineChart
                          series={[{ data: perfTimelineData.ram, color: "#2ecc71", label: "RAM" }]}
                          labels={perfTimelineData.labels}
                          height={180}
                          formatValue={(v) => `${v}%`}
                        />
                      </ChartSection>

                      <ChartSection title="FPS">
                        <LineChart
                          series={[{ data: perfTimelineData.fps, color: "#16b195", label: "FPS" }]}
                          labels={perfTimelineData.labels}
                          height={180}
                          formatValue={(v) => `${Math.round(v)} FPS`}
                        />
                      </ChartSection>
                    </div>
                  )}
                </>
              ) : (
                <div className="game-activity-empty-state">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                  <p>No performance data recorded for these sessions. Launch the game with the performance monitor active.</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Stats Card Helper ────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  className = "",
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`game-activity-stat-card ${className}`}>
      <div className="game-activity-stat-icon">{icon}</div>
      <div className="game-activity-stat-details">
        <span className="game-activity-stat-label">{label}</span>
        <span className="game-activity-stat-value">{value}</span>
      </div>
    </div>
  );
}

// ─── Performance Mini Card Helper ─────────────────────────────────────────────

function PerfMiniCard({ label, avg, max }: { label: string; avg: string; max: string }) {
  return (
    <div className="game-activity-perf-card">
      <span className="game-activity-perf-label">{label}</span>
      <div className="game-activity-perf-values">
        <span className="game-activity-perf-avg">{avg}</span>
        <span className="game-activity-perf-max">{max}</span>
      </div>
    </div>
  );
}

// ─── Chart Section Helper ─────────────────────────────────────────────────────

function ChartSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="game-activity-chart-section">
      <span className="game-activity-chart-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
        {title}
      </span>
      <div className="game-activity-chart-box">{children}</div>
    </div>
  );
}

// ─── Heatmap Subcomponent ─────────────────────────────────────────────────────

function WeeklyHeatmap({ sessions }: { sessions: GameSession[] }) {
  // Always display the last 365 days of activity for a full, premium calendar overview
  const timeframeDays = 365;
  
  const cells = useMemo(() => {
    const list: { date: string; duration: number }[] = [];
    const dayMap = new Map<string, number>();
    
    sessions.forEach((s) => {
      if (s.date) {
        const key = s.date.slice(0, 10);
        dayMap.set(key, (dayMap.get(key) || 0) + s.durationMin);
      }
    });

    const start = new Date();
    start.setDate(start.getDate() - timeframeDays + 1);
    
    const cursor = new Date(start);
    for (let i = 0; i < timeframeDays; i++) {
      const dateStr = cursor.toISOString().slice(0, 10);
      list.push({
        date: dateStr,
        duration: dayMap.get(dateStr) || 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    
    return list;
  }, [sessions]);

  const paddedCells = useMemo(() => {
    const list: ({ date: string; duration: number } | null)[] = [];
    if (cells.length === 0) return list;

    const firstDate = new Date(cells[0].date + "T00:00:00");
    const firstDayOfWeek = firstDate.getDay();

    for (let i = 0; i < firstDayOfWeek; i++) {
      list.push(null);
    }

    list.push(...cells);
    return list;
  }, [cells]);

  const getIntensityClass = (minutes: number) => {
    if (minutes <= 0) return "weekly-heatmap-cell-empty";
    if (minutes < 15) return "weekly-heatmap-cell-low";
    if (minutes < 45) return "weekly-heatmap-cell-medium";
    if (minutes < 120) return "weekly-heatmap-cell-high";
    return "weekly-heatmap-cell-peak";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <h3 className="game-activity-heatmap-title">Weekly Activity</h3>
      <div className="weekly-heatmap-container">
        <div className="weekly-heatmap-row-labels">
          <span></span>
          <span>Mon</span>
          <span></span>
          <span>Wed</span>
          <span></span>
          <span>Fri</span>
          <span></span>
        </div>
        <div className="weekly-heatmap-grid">
          {paddedCells.map((cell, index) => {
            if (!cell) {
              return <div key={`pad-${index}`} className="weekly-heatmap-cell weekly-heatmap-cell-padded" />;
            }
            return (
              <div
                key={cell.date}
                className={`weekly-heatmap-cell ${getIntensityClass(cell.duration)}`}
                title={`${new Date(cell.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} : ${formatPlayTime(cell.duration)}`}
              />
            );
          })}
        </div>
      </div>
      <div className="weekly-heatmap-grid-legend" style={{ alignSelf: "flex-end" }}>
        <div className="weekly-heatmap-footer">
          <span>Less</span>
          <div className="weekly-heatmap-cell weekly-heatmap-cell-empty" />
          <div className="weekly-heatmap-cell weekly-heatmap-cell-low" />
          <div className="weekly-heatmap-cell weekly-heatmap-cell-medium" />
          <div className="weekly-heatmap-cell weekly-heatmap-cell-high" />
          <div className="weekly-heatmap-cell weekly-heatmap-cell-peak" />
          <span>More</span>
        </div>
      </div>
    </div>
  );
}

