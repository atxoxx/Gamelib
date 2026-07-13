import { useEffect, useState, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import html2canvas from "html2canvas";
import { prepareClonedDocumentForCanvasCapture } from "../utils/color";
import { useGames, NO_IGDB_MATCH_SOURCE } from "../context/GameContext";
import { useActivity } from "../context/ActivityContext";
import { useToast } from "../context/ToastContext";
import { type Game, type GameMetadataResult, type LaunchBoxImageResult, type GameSession, type SimilarGame, type ReleaseDateInfo, type IgdbReview, type LanguageSupportInfo, formatPlayTime, formatSize, type PlayStatus, PLAY_STATUS_DETAILS } from "../types/game";
import { useSizeUnit } from "../hooks/useSizeUnit";
import BarChart from "../components/charts/BarChart";
import LineChart from "../components/charts/LineChart";
import WebLinksTab from "../components/WebLinksTab";
import ReviewsTab from "../components/ReviewsTab";
import CrackWatchCard from "../components/CrackWatchCard";
import AchievementsTab from "../components/AchievementsTab";
import GameRelationsCard from "../components/GameRelationsCard";
import {
  GameHero,
  InfoKpiCard,
  RatingsKpiCard,
  SpecsCard,
  TimeToBeatCard,
  ReleasesCard,
  LanguagesSection,
  AboutSection,
  StorylineSection,
  ScreenshotsSection,
  VideosSection,
} from "../components/game";
import { Button, ConfirmModal } from "../components/ui";
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

// Video URL helpers (`getVideoEmbedUrl`, `getVideoThumbnail`) now live in
// `../components/game/video` so the Store GameDetail page can reuse them.
// The VideosSection component imports them directly; GamePage no longer
// needs a local alias because the videos JSX has been extracted too.

// The old `RatingCircle` SVG component has been replaced by the
// `KpiTile` + `RatingsKpiCard` design (see `../components/game/RatingsKpiCard`).
// The 68px circle ring has been replaced with a 36px bold number that reads
// at a glance, intent-tinted by the same success/warning/danger threshold.
void null; // placeholder to keep this section marker stable

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
      <Button variant="ghost" size="sm" onClick={() => navigate("/library")}>
        Back to Library
      </Button>
    </div>
  );
}

// The old `TimeToBeatRow` helper has moved to
// `../components/game/shared` and is rendered by `TimeToBeatCard`.
// The new card wraps it in a 3-column KPI grid for an at-a-glance read.
void null; // placeholder to keep this section marker stable

// Track which game IDs have already been auto-enriched in this GameDetail
// mount to avoid repeat calls when enrichment-triggered state updates
// re-fire the useEffect below. Cross-mount dedupe is handled by the
// session-scoped `enrichedThisSession` Set inside GameContext — no need
// for a parallel module-scoped Set here anymore.

function GameDetail({ game }: { game: Game }) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { updateGame, launchGame, enrichGameMetadata, removeGame } = useGames();
  // Confirm-remove flow state. Clicking the Remove button in the
  // top bar opens the ConfirmModal; only on confirm do we actually
  // wipe the game (matches the destructive-action discipline used
  // by the IGDB / downloads tabs, vs. the silent toast path the
  // sidebar right-click uses).
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "reviews" | "activity" | "weblinks" | "achievements">("overview");

  // Metadata fetching state
  const [fetchingMetadata, setFetchingMetadata] = useState(false);
  const [metadataResults, setMetadataResults] = useState<GameMetadataResult[]>([]);
  const [showMetadataPanel, setShowMetadataPanel] = useState(false);
  const [applyingMetadata, setApplyingMetadata] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editTab, setEditTab] = useState<"metadata" | "media" | "data" | "launch">("metadata");
  const [editPath, setEditPath] = useState(game.path || "");
  const [editLaunchArguments, setEditLaunchArguments] = useState(game.launchArguments || "");
  const [editRunAsAdmin, setEditRunAsAdmin] = useState(game.runAsAdmin || false);
  const [editName, setEditName] = useState(game.name);
  const [editPlatform, setEditPlatform] = useState(game.platform);
  const [editIcon, setEditIcon] = useState(game.iconUrl || "");
  const [editCover, setEditCover] = useState(game.coverArtUrl || "");
  const [editHero, setEditHero] = useState(game.bannerUrl || "");
  const [editLogo, setEditLogo] = useState(game.logoUrl || "");
  const [editNotes, setEditNotes] = useState(game.notes || "");

  // Size (Storage tab) -- display-only here; bytes are computed by the Rust
  // detect_game_size command (see src-tauri/src/size.rs).
  const [editSizeBytes, setEditSizeBytes] = useState<number | undefined>(game.sizeBytes);
  const [editSizeRootPath, setEditSizeRootPath] = useState<string | undefined>(game.sizeRootPath);
  const [editPlayStatus, setEditPlayStatus] = useState<PlayStatus>(game.playStatus || "backlog");
  // (Play status dropdown state moved to `GameStatusDropdown`. The
  // GamePage now just passes `game` + an `onChange` callback into
  // `<GameHero />`, which composes the dropdown in the hero overlay.)

  const [detectingSize, setDetectingSize] = useState(false);
  // Respects the user's GB/GiB preference from Settings > Hardware; persisted
  // across relaunches by the hook (localStorage key `gamelib_size_unit_v1`).
  const { unit: sizeUnit } = useSizeUnit();

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
  
    // Lazily enrich game metadata on mount. Steam-synced games arrive with only
  // a Steam CDN cover image (no IGDB data), so we trigger the full IGDB
  // enrichment the first time the user opens such a game's GamePage. Also
  // covers legacy games that still depend on the previous enrichment path.
  //
  // enrichedGameIds (module-scoped, declared above GameDetail) prevents
  // repeat fetches across repeated navigations within the same SPA session.
  // The per-mount  guards within a single lifecycle.
  // Sentinel  records a previous
  // failed IGDB lookup so we don't re-attempt on every GamePage visit.
  // (Play status dropdown state lives inside `GameStatusDropdown`
  // now, so we don't need to reset it here on game-id change.)

    const enrichmentStartedRef = useRef(false);
  useEffect(() => {
    if (enrichmentStartedRef.current) return;
    if (game.metadataSource === NO_IGDB_MATCH_SOURCE) return;
    if (!game.name) return;
    const hasDescription = !!game.description;
    const missingTTB = !game.timeToBeat;
    // Also re-enrich if any of the 5 relation-relevant fields are
    // missing. The standalone Similar Games section was removed in
    // favor of the GameRelationsCard, which needs at least one of
    // collection / franchise / developer / publisher / genres to
    // build any group. A partially-enriched game (has description +
    // timeToBeat but no relation fields) would otherwise skip
    // enrichment and silently produce an empty Game Relations card.
    const hasCollection = !!game.collection;
    const hasDeveloper = !!game.developer;
    const hasPublisher = !!game.publisher;
    const hasGenres = !!(game.genres && game.genres.length > 0);
    // `franchise` is intentionally NOT in this list: many legitimate
    // one-off games (e.g. indie titles) have no IGDB franchise, and
    // IGDB will never fill it in. Requiring it would cause the
    // auto-enrichment to re-fire on every GamePage visit for those
    // games, and the empty field would never become non-empty.
    const hasAllRelationFields =
      hasCollection && hasDeveloper && hasPublisher && hasGenres;
    // Also re-enrich when a game has a collection NAME but no
    // collection ID. The name is populated by the existing merge
    // path, but the ID is a separate field that the GameRelationsCard
    // needs to fetch "other games in this collection" from IGDB.
    // Without this gate, a game with a collection name but a missing
    // ID would skip enrichment forever and the "Other in this
    // collection" group would never appear.
    const missedCollectionId =
      !!game.collection && game.collectionId === undefined;
    if (
      hasDescription &&
      !missingTTB &&
      hasAllRelationFields &&
      !missedCollectionId
    )
      return;

    enrichmentStartedRef.current = true;
    // enrichGameMetadata is wrapped in silent useCallback; the only
    // user-visible signal it ran is the description/covers/grades
    // appearing in the JSX. A loading pill is a nice-to-have
    // follow-up.
    enrichGameMetadata(game.id, game.name, game.steamAppId).catch(
      (err) => console.error("Auto-enrichment failed:", err)
    );
  }, [
    game.id,
    game.name,
    game.steamAppId,
    game.description,
    game.timeToBeat,
    game.metadataSource,
    game.collection,
    game.collectionId,
    game.developer,
    game.publisher,
    game.genres,
    enrichGameMetadata,
  ]);

  function handleLaunch() {
    launchGame(game);
  }

  function handleBack() {
    navigate("/library");
  }

  function handleEditRequest() {
    setEditing(true);
  }

  function handleRemoveRequest() {
    setShowRemoveConfirm(true);
  }

  function handleCancelRemove() {
    setShowRemoveConfirm(false);
  }

  function handleConfirmRemove() {
    removeGame(game.id);
    showToast(`Removed ${game.name}`, "info");
    // Navigate immediately so we don't render the "Game Not Found"
    // empty state for the about-to-be-deleted game for a single tick.
    // GameDetail is keyed by game.id (see the parent GamePage render),
    // so navigate() unmounts this component for free — no need to
    // also call setShowRemoveConfirm(false).
    navigate("/library");
  }

  function cancelEditing() {
    setEditing(false);
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

  async function handlePickExecutable() {
    try {
      const filePath = await open({
        multiple: false,
        directory: false,
        title: "Select Game Executable",
        filters: [
          { name: "Executables", extensions: ["exe", "bat", "lnk", "cmd"] },
          { name: "All Files", extensions: ["*"] }
        ],
      });
      if (filePath && typeof filePath === "string") {
        setEditPath(filePath);
      }
    } catch (err) {
      showToast("Failed to select executable", "error");
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

  // Pick a folder, walk it, and write the resulting byte total into
  // edit state. Reuses the Rust detect_game_size command with the
  // chosen folder supplied as rootOverride.
  async function openFolderAndDetectSize() {
    if (detectingSize) return;
    setDetectingSize(true);
    try {
      const picked = await open({
        directory: true,
        multiple: false,
        title: "Select game folder",
      });
      if (!picked || Array.isArray(picked)) return;
      const folder = picked as string;
      const result = await invoke<{
        sizeBytes: number;
        rootPath: string;
      }>("detect_game_size", {
        exePath: "",
        gameName: (editName || game.name || "").trim(),
        rootOverride: folder,
      });
      setEditSizeBytes(result.sizeBytes);
      setEditSizeRootPath(result.rootPath);
      showToast(`Detected ${formatSize(result.sizeBytes, sizeUnit)}`, "success");
    } catch (err) {
      console.error("detect_game_size failed", err);
      showToast(`Could not read folder size: ${err}`, "error");
    } finally {
      setDetectingSize(false);
    }
  }

  function clearSize() {
    setEditSizeBytes(undefined);
    setEditSizeRootPath(undefined);
  }

  function saveEdits() {
    const newName = editName.trim() || game.name;
    const newPlatform = editPlatform.trim() || game.platform;
    const newIcon = editIcon || undefined;
    // Size: stamp sizeDetectedAt when a non-empty value is present,
    // clear it whenever the user removes the size.
    const newSizeBytes = editSizeBytes;
    const newSizeRootPath = editSizeRootPath;
    const newSizeDetectedAt = editSizeBytes != null
      ? new Date().toISOString()
      : undefined;
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
      sizeBytes: newSizeBytes,
      sizeRootPath: newSizeRootPath,
      sizeDetectedAt: newSizeDetectedAt,
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
      path: editPath.trim() || undefined,
      launchArguments: editLaunchArguments.trim() || undefined,
      runAsAdmin: editRunAsAdmin || undefined,
      playStatus: editPlayStatus,
    });
    setEditing(false);
    showToast("Game updated", "success");
  }

  return (
    <div className="game-page">
      {/* Top bar above the hero: "Return to Library" back link on the
          left (mirrors the same `.game-top-bar` + `.game-back-link`
          pattern used by StoreGameDetail), and Edit + Remove actions
          on the right. Edit opens the existing modal; Remove opens a
          ConfirmModal (matches the destructive-action discipline used
          elsewhere, vs. the silent toast path the sidebar uses). */}
      <div className="game-top-bar">
        <button
          className="game-back-link"
          onClick={handleBack}
          aria-label="Return to library"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Return to Library
        </button>
        <div className="game-top-bar__actions">
          <button
            type="button"
            className="game-edit-btn"
            onClick={handleEditRequest}
            aria-label={`Edit ${game.name}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Edit
          </button>
          <button
            type="button"
            className="game-edit-btn game-edit-btn-danger"
            onClick={handleRemoveRequest}
            aria-label={`Remove ${game.name} from library`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            Remove
          </button>
        </div>
      </div>

      <GameHero game={game} onLaunch={handleLaunch} />

      {/* Tabs */}
      <div className="game-tabs">
        {(["overview", "reviews", "activity", "achievements", "weblinks"] as const).map((tab) => (
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
            <AboutSection game={game} />
            <StorylineSection game={game} />
            <ScreenshotsSection
              game={game}
              onOpen={(src) => setLightboxImage(src)}
            />
            <VideosSection game={game} />

            {/* Game Relations Card — library-local + IGDB relations.
                Renders below the standalone Similar Games section per
                the design decision (both cards are kept side-by-side:
                the standalone section is a thin IGDB-similar rail, this
                is the broader relations surface). The card silently
                renders nothing when no groups have content. */}
            <GameRelationsCard
              mode="library"
              currentGame={game}
              currentGameId={game.id}
              similarGames={game.similarGames}
              collectionId={game.collectionId}
              collectionName={game.collection}
            />
          </div>

          <div className="game-side-col">
            <InfoKpiCard
              game={game}
              sizeUnit={sizeUnit}
              onEditSize={() => setEditing(true)}
            />
            <RatingsKpiCard game={game} />
            <SpecsCard game={game} />
            <TimeToBeatCard game={game} />
            <ReleasesCard game={game} />
            <CrackWatchCard gameName={game.name} />
            <LanguagesSection game={game} />
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

      {activeTab === "achievements" && <AchievementsTab game={game} />}

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
              <Button
                variant="primary" size="sm"
                onClick={handleFetchMetadata}
                disabled={fetchingMetadata}
                isLoading={fetchingMetadata}
                style={{ marginRight: 'var(--space-sm)' }}
                leftIcon={
                  !fetchingMetadata ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                  ) : undefined
                }
              >
                {fetchingMetadata ? "Searching..." : "Fetch Metadata"}
              </Button>
              <button className="metadata-panel-close" onClick={cancelEditing}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="edit-modal-tabs">
              {(["metadata", "media", "data", "launch"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`edit-modal-tab ${editTab === tab ? "active" : ""}`}
                  onClick={() => setEditTab(tab)}
                >
                  {tab === "metadata" && "Metadata"}
                  {tab === "media" && "Media & Images"}
                  {tab === "data" && "Additional Data"}
                  {tab === "launch" && "Launch Options"}
                </button>
              ))}
            </div>

            <div className="edit-modal-body">
              {/* Metadata Results (inside modal) */}
              {editTab === "metadata" && showMetadataPanel && (
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
                            <Button variant="primary" size="sm" disabled={applyingMetadata} isLoading={applyingMetadata} onClick={() => handleApplyMetadata(result)}
                              leftIcon={
                                !applyingMetadata ? (
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                                ) : undefined
                              }
                            >
                              Apply Metadata
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 1: METADATA */}
              {editTab === "metadata" && (
                <div className="edit-form">
                  {/* The 15+ flat inputs that used to render as a
                   * single wall are now grouped into three
                   * semantically-labelled fieldsets. Native
                   * <fieldset> + <legend> so screen readers
                   * announce each group as a labelled landmark
                   * when users tab into the modal. The grouping
                   * follows perceptual chunks (Identity /
                   * Ratings / Catalog) rather than file read
                   * order so the user's mental model lines up
                   * with the form. */}
                  <fieldset className="edit-fieldset">
                    <legend className="edit-fieldset-legend">Core Identity</legend>
                    <div className="edit-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                      <div className="edit-field">
                        <label className="edit-label" htmlFor="edit-name">Name</label>
                        <input id="edit-name" className="edit-input" type="text" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Game name" />
                      </div>
                      <div className="edit-field">
                        <label className="edit-label" htmlFor="edit-play-status">Play Status</label>
                        <select
                          id="edit-play-status"
                          className="edit-input"
                          value={editPlayStatus}
                          onChange={(e) => setEditPlayStatus(e.target.value as PlayStatus)}
                        >
                          {Object.entries(PLAY_STATUS_DETAILS).map(([key, details]) => (
                            <option key={key} value={key}>
                              {details.label}
                            </option>
                          ))}
                        </select>
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
                    </div>
                    <div className="edit-field full-width" style={{ marginTop: 'var(--space-md)' }}>
                      <label className="edit-label" htmlFor="edit-description">Description</label>
                      <textarea id="edit-description" className="edit-input edit-textarea" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="Short description or summary..." rows={3} />
                    </div>
                  </fieldset>

                  <fieldset className="edit-fieldset">
                    <legend className="edit-fieldset-legend">Ratings &amp; Engagement</legend>
                    <div className="edit-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
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
                          <label className="edit-label" htmlFor="edit-hltb-main">HLTB Main (h)</label>
                          <input id="edit-hltb-main" className="edit-input" type="number" min="0" value={editTimeToBeatMain || ""} onChange={(e) => setEditTimeToBeatMain(Number(e.target.value))} placeholder="Hours" />
                        </div>
                        <div className="edit-field">
                          <label className="edit-label" htmlFor="edit-hltb-extra">HLTB Extra (h)</label>
                          <input id="edit-hltb-extra" className="edit-input" type="number" min="0" value={editTimeToBeatExtra || ""} onChange={(e) => setEditTimeToBeatExtra(Number(e.target.value))} placeholder="Hours" />
                        </div>
                        <div className="edit-field">
                          <label className="edit-label" htmlFor="edit-hltb-comple">HLTB Completionist (h)</label>
                          <input id="edit-hltb-comple" className="edit-input" type="number" min="0" value={editTimeToBeatComple || ""} onChange={(e) => setEditTimeToBeatComple(Number(e.target.value))} placeholder="Hours" />
                        </div>
                      </div>
                    </div>
                  </fieldset>

                  <fieldset className="edit-fieldset">
                    <legend className="edit-fieldset-legend">Catalog &amp; Tagging</legend>
                    <div className="edit-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
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
                      <label className="edit-label" htmlFor="edit-storyline">Storyline</label>
                      <textarea id="edit-storyline" className="edit-input edit-textarea" value={editStoryline} onChange={(e) => setEditStoryline(e.target.value)} placeholder="Deep storyline/narrative summary..." rows={3} />
                    </div>

                    <div className="edit-field full-width" style={{ marginTop: 'var(--space-md)' }}>
                      <label className="edit-label" htmlFor="edit-notes">Notes</label>
                      <textarea id="edit-notes" className="edit-input edit-textarea" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Personal notes about this game..." rows={3} />
                    </div>
                  </fieldset>
                </div>
              )}

              {/* TAB 2: MEDIA */}
              {editTab === "media" && (
                <div>
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
                    <Button variant="secondary" size="sm" onClick={handleOpenImageBrowser} leftIcon={
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="2" width="20" height="20" rx="2" />
                        <path d="M7 2v20" />
                        <path d="M2 12h5" />
                      </svg>
                    }>
                      Browse LaunchBox Images
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowIgdbMediaBrowser(true)}
                      leftIcon={
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-accent)' }}>
                        <polygon points="23 7 16 12 23 17 23 7" />
                        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                      </svg>
                      }>
                      Browse IGDB Media
                    </Button>
                  </div>
                </div>
              )}

              {/* TAB 3: ADDITIONAL DATA */}
              {editTab === "data" && (
                <div className="edit-form">
                  <div className="edit-field full-width" data-storage-row>
                    <label className="edit-label">Size</label>
                    <div className="size-edit-row">
                      <input
                        className="edit-input size-readonly"
                        type="text"
                        readOnly
                        value={editSizeBytes != null ? formatSize(editSizeBytes, sizeUnit) : "Not set"}
                        placeholder="Not set"
                      />
                      <button
                        type="button"
                        className="edit-btn edit-btn-secondary"
                        onClick={openFolderAndDetectSize}
                        disabled={detectingSize}
                        title="Pick a folder and recalculate size"
                      >
                        {detectingSize ? "Detecting..." : "Auto-detect"}
                      </button>
                      <button
                        type="button"
                        className="edit-btn edit-btn-ghost"
                        onClick={clearSize}
                        disabled={editSizeBytes == null}
                      >
                        Clear
                      </button>
                    </div>
                    {editSizeRootPath && (
                      <span className="size-edit-hint" title={editSizeRootPath}>
                        {editSizeRootPath}
                      </span>
                    )}
                  </div>

                  <div className="edit-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                    <div className="edit-field">
                      <label className="edit-label" htmlFor="edit-metadata-source">Metadata Source</label>
                      <input id="edit-metadata-source" className="edit-input" type="text" value={editMetadataSource} onChange={(e) => setEditMetadataSource(e.target.value)} placeholder="e.g., IGDB, Steam" />
                    </div>
                    <div className="edit-field">
                      <label className="edit-label" htmlFor="edit-metadata-url">Metadata URL</label>
                      <input id="edit-metadata-url" className="edit-input" type="text" value={editMetadataUrl} onChange={(e) => setEditMetadataUrl(e.target.value)} placeholder="https://..." />
                    </div>
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
                </div>
              )}

              {/* TAB 4: LAUNCH OPTIONS */}
              {editTab === "launch" && (
                <div className="edit-form">
                  <div className="edit-field full-width">
                    <label className="edit-label" htmlFor="edit-path">Executable Path</label>
                    <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                      <input
                        id="edit-path"
                        className="edit-input"
                        type="text"
                        value={editPath}
                        onChange={(e) => setEditPath(e.target.value)}
                        placeholder="Path to game executable"
                        style={{ flex: 1 }}
                      />
                      <button
                        type="button"
                        className="edit-btn edit-btn-secondary"
                        onClick={handlePickExecutable}
                        style={{ whiteSpace: 'nowrap' }}
                      >
                        Browse...
                      </button>
                    </div>
                  </div>

                  <div className="edit-field full-width" style={{ marginTop: 'var(--space-md)' }}>
                    <label className="edit-label" htmlFor="edit-launch-arguments">Launch Arguments</label>
                    <input
                      id="edit-launch-arguments"
                      className="edit-input"
                      type="text"
                      value={editLaunchArguments}
                      onChange={(e) => setEditLaunchArguments(e.target.value)}
                      placeholder="e.g. -windowed -novid -dev"
                    />
                    <span className="size-edit-hint">
                      Custom command-line parameters passed directly to the executable on startup.
                    </span>
                  </div>

                  <div className="edit-field full-width" style={{ marginTop: 'var(--space-lg)' }}>
                    <label className="checkbox-container" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer', userSelect: 'none' }}>
                      <input
                        type="checkbox"
                        checked={editRunAsAdmin}
                        onChange={(e) => setEditRunAsAdmin(e.target.checked)}
                        style={{
                          width: '18px',
                          height: '18px',
                          accentColor: 'var(--color-accent)',
                          cursor: 'pointer'
                        }}
                      />
                      <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text-primary)' }}>
                        Run as Administrator
                      </span>
                    </label>
                    <span className="size-edit-hint" style={{ display: 'block', marginTop: '4px', marginLeft: '26px' }}>
                      Elevate process privileges using Windows UAC when launching.
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <span className="modal-footer-count"></span>
              <div className="modal-footer-actions">
                <Button variant="secondary" onClick={cancelEditing}>Cancel</Button>
                <Button variant="primary" onClick={saveEdits}>Save Changes</Button>
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
                <Button variant="primary" onClick={() => setShowIgdbMediaBrowser(false)}>Done</Button>
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

      {/* Confirm modal for the destructive Remove top-bar action.
          Rendered through the same Portal-based ConfirmModal used
          elsewhere in the app so the Cancel / Delete focus order,
          Escape handling, and backdrop click are consistent. */}
      <ConfirmModal
        open={showRemoveConfirm}
        title={`Remove ${game.name} from library?`}
        message="This removes the game's metadata, cover, and tracked play time from GameLib. Your installed files on disk are not touched; you can re-import the game later if you change your mind."
        confirmLabel="Remove"
        cancelLabel="Keep"
        onConfirm={handleConfirmRemove}
        onCancel={handleCancelRemove}
      />
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
  // Toast feedback for screenshot success / error — GameActivityTab is
  // a sibling component to GameDetail, so its own useToast() (rather
  // than the one inside GameDetail) is in scope here.
  const { showToast } = useToast();
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

      // Capture the *entire* activity view in height, not just the
      // currently-visible portion. scrollHeight reflects the full
      // rendered tab including content below the fold; passing it as
      // both `height` and `windowHeight` lets html2canvas paint the
      // complete layout in one pass instead of just viewport-clipped
      // pixels.
      const fullHeight = (container as HTMLElement).scrollHeight;
      const fullWidth = (container as HTMLElement).scrollWidth;

      const canvas = await html2canvas(container as HTMLElement, {
        backgroundColor: "#0f1117",
        scale: 2,
        logging: false,
        useCORS: true,
        width: fullWidth,
        height: fullHeight,
        windowWidth: fullWidth,
        windowHeight: fullHeight,
        // html2canvas 1.4.1 doesn't understand CSS Color Module L4
        // `color-mix(in srgb, …)` and throws "Attempting to parse an
        // unsupported color function 'color'". The project uses
        // color-mix in 170+ rules, so we rewrite every `color-mix()`
        // in the clone to a literal rgb() / rgba() before html2canvas
        // reads computed styles (see src/utils/color.ts).
        onclone: prepareClonedDocumentForCanvasCapture,
      });

      const dataUrl = canvas.toDataURL("image/png");

      const filePath = await save({
        title: `Save ${game.name} Activity Screenshot`,
        defaultPath: `${game.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}_activity_screenshot_${new Date().toISOString().slice(0, 10)}.png`,
        filters: [{ name: "PNG Image", extensions: ["png"] }],
      });

      if (!filePath) return;

      await invoke("save_screenshot", { filePath, base64Data: dataUrl });
      showToast("Activity screenshot saved", "success");
    } catch (error) {
      console.error("Screenshot error:", error);
      showToast(`Failed to save screenshot: ${error}`, "error");
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

  // Filter hardware sessions (those containing non-zero telemetry).
  // Note: FPS-sanitized sessions whose avgFps collapsed to 0 are kept here
  // because their CPU/GPU/RAM/temp data is still valid for the other perf
  // charts. The empty-FPS sample is filtered at series-build time below
  // so only the FPS chart sees the gap, not CPU/GPU/RAM.
  const sessionsWithHw = useMemo(() => {
    return filteredSessions.filter((s) => s.metrics && s.metrics.avgCpuUsage > 0);
  }, [filteredSessions]);

  // Check if we have real temperature data (WMI returns 0 if unsupported/disabled)
  const hasTemps = useMemo(() => {
    return sessionsWithHw.some((s) => s.metrics && (s.metrics.avgCpuTemp > 0 || s.metrics.avgGpuTemp > 0));
  }, [sessionsWithHw]);

  // Aggregate averages and max values for mini hardware cards.
  //
  // Historical session data here is already sanitized by
  // ActivityContext on localStorage load (see sanitizeSessionMetrics in
  // src/types/game.ts) so the fps fields land in [0, SANE_MAX_FPS] and
  // min<=avg<=max. Defensive clamps below are harmless if a future Rust
  // build slips a poisoned value past the context layer.

  const hwAverages = useMemo(() => {
    if (sessionsWithHw.length === 0) return null;
    const len = sessionsWithHw.length;
    // Match the centralised sanitizeSessionMetrics semantics: poisoned
    // values (anything > 1000 FPS) collapse to 0 so the chart emits the
    // honest "no FPS data" All-zero series instead of silently capping
    // a bogus reading at 1000. Defence-in-depth only — in healthy code
    // paths ActivityContext already pre-sanitises, so this just makes
    // clampFps's behaviour identical to the global helper.
    const clampFps = (v: number) => {
      if (!Number.isFinite(v) || v < 0 || v > 1000) return 0;
      return Math.round(v);
    };
    const avgFps = Math.round(sessionsWithHw.reduce((sum, s) => sum + clampFps(s.metrics!.avgFps), 0) / len);
    const maxFps = sessionsWithHw.reduce((max, s) => Math.max(max, clampFps(s.metrics!.maxFps)), 0);
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
    // FPS: when avgFps is 0 (no real RTSS/MAHM samples survived sanitisation,
    // e.g. legacy session with poisoned FPS fields that all dropped to 0)
    // emit an all-zero series so the FPS chart renders an honest "no FPS data"
    // flat line instead of interpolating an artificial num. > 1000 cap that
    // would break again.
    const fps = targetMetrics.avgFps > 0
      ? generateConsistentSeries(targetMetrics.avgFps, targetMetrics.minFps, targetMetrics.maxFps, N, seedStr + "-fps")
      : new Array(N).fill(0);
    
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
    <>
    {/* Player activity (24h sparkline) now lives inside the Steam
        stats popover (SteamPlayerCountPopover + SteamPlayerActivityCompact).
        The activity tab is focused on playtime + sessions. */}
      <div className="game-activity-empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <p>No sessions recorded for this game. Launch the game to start tracking activity.</p>
      </div>
    </>
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
                          {agg.replace(/^AGG_/, "").replace(/^./, (c) => c.toUpperCase())}
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
                          // Fixed 0-100 % scale so 30% always reads as
                          // 30% of the chart's vertical extent, instead
                          // of being stretched to fit just this session's
                          // data range. Without these the axis collapses
                          // to e.g. 0-30% and a slow session visually
                          // looks identical to a maxed-out one.
                          minY={0}
                          maxY={100}
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
                          // Same rationale as CPU & GPU Load above —
                          // RAM is reported as a percentage of system
                          // memory so it must share the 0-100 axis or
                          // the curve position has no meaning across
                          // sessions.
                          minY={0}
                          maxY={100}
                          formatValue={(v) => `${v}%`}
                        />
                      </ChartSection>

                      <ChartSection title="FPS">
                        <LineChart
                          series={[{ data: perfTimelineData.fps, color: "#16b195", label: "FPS" }]}
                          labels={perfTimelineData.labels}
                          height={180}
                          // minY=0 so FPS never renders negative even if a
                          // session slips through with a tiny negative
                          // value (e.g. uninitialised sensor). maxY stays
                          // dynamic — the input data is already sanitised
                          // to <= 1000 FPS upstream, so the chart can't
                          // reach the legacy u32::MAX auto-scale that
                          // produced the 0x33/0x66/0x99/0xCC/0xFF banding.
                          minY={0}
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

