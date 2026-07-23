import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useGames } from "../../context/GameContext";
import { useToast } from "../../context/ToastContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import {
  type Game,
  type GameMetadataResult,
  type LaunchBoxImageResult,
  type SimilarGame,
  type ReleaseDateInfo,
  type IgdbReview,
  type LanguageSupportInfo,
  formatSize,
  type PlayStatus,
  PLAY_STATUS_DETAILS,
  extractSteamAppIdFromWebsites,
} from "../../types/game";
import { Button } from "../../components/ui";
import { EditImageSlot } from "./EditImageSlot";
import { TagInput } from "../../components/ui/TagInput";
import { ArrayEditor } from "../../components/ui/ArrayEditor";
import "./EditGameModal.css";

const GENRE_SUGGESTIONS = ["Action","Adventure","RPG","Shooter","Strategy","Puzzle","Platformer","Simulation","Sports","Racing","Fighting","Horror","Indie","Casual","MMO"];
const THEME_SUGGESTIONS = ["Sci-Fi","Fantasy","Horror","Open World","Sandbox","Survival","Story Rich","Atmospheric","Pixel Graphics","Post-Apocalyptic","Cyberpunk","Comedy"];
const MODE_SUGGESTIONS = ["Singleplayer","Multiplayer","Co-op","Online Co-Op","Split Screen","PvP","PvE","Massively Multiplayer"];
const PERSPECTIVE_SUGGESTIONS = ["First-Person","Third-Person","Top-Down","Side View","Isometric","Bird's-Eye","Text"];
const LANGUAGE_SUPPORT_TYPES = ["Audio","Subtitles","Interface"];

type EditTab = "details" | "media" | "advanced" | "launch";

interface EditGameModalProps {
  game: Game;
  onClose: () => void;
}

export function EditGameModal({ game, onClose }: EditGameModalProps) {
  const { showToast } = useToast();
  const { updateGame } = useGames();
  const { unit: sizeUnit } = useSizeUnit();

  const [editTab, setEditTab] = useState<EditTab>("details");

  // ── Core identity ─────────────────────────────────────────────
  const [editName, setEditName] = useState(game.name);
  const [editPlatform, setEditPlatform] = useState(game.platform);
  const [editPlayStatus, setEditPlayStatus] = useState<PlayStatus>(game.playStatus || "backlog");
  const [editDeveloper, setEditDeveloper] = useState(game.developer || "");
  const [editPublisher, setEditPublisher] = useState(game.publisher || "");
  const [editReleaseDate, setEditReleaseDate] = useState(game.releaseDate || "");
  const [editDescription, setEditDescription] = useState(game.description || "");
  const [editStoryline, setEditStoryline] = useState(game.storyline || "");
  const [editNotes, setEditNotes] = useState(game.notes || "");

  // ── Ratings & catalog (chip/array fields) ─────────────────────
  const [editIgdbRating, setEditIgdbRating] = useState(game.igdbRating || 0);
  const [editCriticRating, setEditCriticRating] = useState(game.criticRating || 0);
  const [editGenres, setEditGenres] = useState<string[]>(game.genres || []);
  const [editThemes, setEditThemes] = useState<string[]>(game.themes || []);
  const [editGameModes, setEditGameModes] = useState<string[]>(game.gameModes || []);
  const [editPlayerPerspectives, setEditPlayerPerspectives] = useState<string[]>(game.playerPerspectives || []);
  const [editTimeToBeatMain, setEditTimeToBeatMain] = useState(game.timeToBeat?.normally ? Math.round(game.timeToBeat.normally / 3600) : 0);
  const [editTimeToBeatExtra, setEditTimeToBeatExtra] = useState(game.timeToBeat?.hastily ? Math.round(game.timeToBeat.hastily / 3600) : 0);
  const [editTimeToBeatComple, setEditTimeToBeatComple] = useState(game.timeToBeat?.completely ? Math.round(game.timeToBeat.completely / 3600) : 0);
  const [editSimilarGamesNames, setEditSimilarGamesNames] = useState<string[]>(
    game.similarGames ? game.similarGames.map((g) => g.name) : []
  );
  const [editCollection, setEditCollection] = useState(game.collection || "");
  const [editFranchise, setEditFranchise] = useState(game.franchise || "");
  const [editGameCategory, setEditGameCategory] = useState(game.gameCategory || "");
  const [editReleaseStatus, setEditReleaseStatus] = useState(game.releaseStatus || "");
  const [editAlternativeNames, setEditAlternativeNames] = useState<string[]>(game.alternativeNames || []);

  // ── Images ────────────────────────────────────────────────────
  const [editIcon, setEditIcon] = useState(game.iconUrl || "");
  const [editCover, setEditCover] = useState(game.coverArtUrl || "");
  const [editHero, setEditHero] = useState(game.bannerUrl || "");
  const [editLogo, setEditLogo] = useState(game.logoUrl || "");
  const [editScreenshots, setEditScreenshots] = useState<string[]>(game.screenshots || []);
  const [editVideos, setEditVideos] = useState<string[]>(game.videos || []);
  const [editWebsites, setEditWebsites] = useState<string[]>(game.websites || []);

  // ── Advanced data ─────────────────────────────────────────────
  const [editSizeBytes, setEditSizeBytes] = useState<number | undefined>(game.sizeBytes);
  const [editSizeRootPath, setEditSizeRootPath] = useState<string | undefined>(game.sizeRootPath);
  const [detectingSize, setDetectingSize] = useState(false);
  const [editMetadataSource, setEditMetadataSource] = useState(game.metadataSource || "");
  const [editMetadataUrl, setEditMetadataUrl] = useState(game.metadataUrl || "");
  const [editReleases, setEditReleases] = useState<ReleaseDateInfo[]>(game.releases || []);
  const [editIgdbReviews, setEditIgdbReviews] = useState<IgdbReview[]>(game.igdbReviews || []);
  const [editLanguageSupports, setEditLanguageSupports] = useState<LanguageSupportInfo[]>(game.languageSupports || []);

  // ── Launch options ────────────────────────────────────────────
  const [editPath, setEditPath] = useState(game.path || "");
  const [editLaunchArguments, setEditLaunchArguments] = useState(game.launchArguments || "");
  const [editRunAsAdmin, setEditRunAsAdmin] = useState(game.runAsAdmin || false);

  // ── Metadata search ───────────────────────────────────────────
  const [fetchingMetadata, setFetchingMetadata] = useState(false);
  const [metadataResults, setMetadataResults] = useState<GameMetadataResult[]>([]);
  const [showMetadataPanel, setShowMetadataPanel] = useState(false);
  const [applyingMetadata, setApplyingMetadata] = useState(false);

  // ── Image browsers ────────────────────────────────────────────
  const [showImageBrowser, setShowImageBrowser] = useState(false);
  const [lbImages, setLbImages] = useState<LaunchBoxImageResult[]>([]);
  const [lbLoading, setLbLoading] = useState(false);
  const [lbSelectedCategory, setLbSelectedCategory] = useState<string>("all");
  const [lbApplyingUrl, setLbApplyingUrl] = useState<string | null>(null);
  const [showIgdbMediaBrowser, setShowIgdbMediaBrowser] = useState(false);
  const [fetchingImageKey, setFetchingImageKey] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ─── Metadata handlers ──────────────────────────────────────────
  async function handleFetchMetadata() {
    setFetchingMetadata(true);
    setMetadataResults([]);
    setShowMetadataPanel(true);
    try {
      const results: GameMetadataResult[] = await invoke("search_game_metadata", {
        gameName: editName.trim() || game.name,
      });
      setMetadataResults(results);
      if (results.length === 0) showToast("No metadata found for this game", "info");
    } catch (err) {
      showToast(`Failed to search metadata: ${err}`, "error");
    } finally {
      setFetchingMetadata(false);
    }
  }

  async function handleFetchImage(key: "icon" | "cover" | "hero" | "logo") {
    setFetchingImageKey(key);
    try {
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
          if (key === "icon") setEditIcon(imageUrl);
          else if (key === "cover") setEditCover(imageUrl);
          else if (key === "hero") setEditHero(imageUrl);
          else if (key === "logo") setEditLogo(imageUrl);

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
      const imageKeys = ["icon", "cover", "hero", "banner", "logo"] as const;
      const imageEntries = imageKeys
        .map((key) => [key, result.images[key]] as const)
        .filter(([, url]) => url != null);
      const urls = imageEntries.map(([, url]) => url!);

      let imageDataUrls: (string | null)[] = [];
      if (urls.length > 0) imageDataUrls = await invoke("fetch_game_images", { urls });

      const downloaded: Record<string, string | undefined> = {};
      imageEntries.forEach(([key], idx) => {
        downloaded[key] = imageDataUrls[idx] ?? undefined;
      });

      const iconUrl = downloaded.icon;
      const coverUrl = downloaded.cover || game.coverArtUrl;
      const heroUrl = downloaded.hero;
      const bannerUrl = downloaded.banner;
      const logoUrl = downloaded.logo;
      const finalBannerUrl = bannerUrl ?? heroUrl ?? undefined;

      setEditName(result.title || game.name);
      setEditDescription(result.description || "");
      setEditDeveloper(result.developer || "");
      setEditPublisher(result.publisher || "");
      setEditReleaseDate(result.releaseDate || "");
      setEditGenres(result.genres || []);
      setEditStoryline(result.storyline || "");
      setEditIgdbRating(result.igdbRating || 0);
      setEditCriticRating(result.criticRating || 0);
      setEditThemes(result.themes || []);
      setEditGameModes(result.gameModes || []);
      setEditPlayerPerspectives(result.playerPerspectives || []);

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
      setEditSimilarGamesNames(result.similarGames ? result.similarGames.map((g) => g.name) : []);
      setEditReleases(result.releases || []);
      setEditIgdbReviews(result.igdbReviews || []);
      setEditLanguageSupports(result.languageSupports || []);

      setEditCollection(result.collection || "");
      setEditFranchise(result.franchise || "");
      setEditGameCategory(result.gameCategory || "");
      setEditReleaseStatus(result.releaseStatus || "");
      setEditAlternativeNames(result.alternativeNames || []);

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
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
      });
      if (filePath && typeof filePath === "string") {
        const dataUrl: string = await invoke("read_cover_image", { filePath });
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

  // ─── LaunchBox browser ──────────────────────────────────────────
  async function handleOpenImageBrowser() {
    setShowImageBrowser(true);
    setLbSelectedCategory("all");
    if (lbImages.length > 0) return;
    setLbLoading(true);
    try {
      const images: LaunchBoxImageResult[] = await invoke("search_launchbox_images", { gameName: game.name });
      setLbImages(images);
      if (images.length === 0) showToast("No images found on LaunchBox", "info");
    } catch (err) {
      showToast(`LaunchBox image search failed: ${err}`, "error");
    } finally {
      setLbLoading(false);
    }
  }

  async function handleApplyLbImage(imageUrl: string, slot: "icon" | "cover" | "hero" | "banner" | "logo") {
    setLbApplyingUrl(imageUrl);
    try {
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
      setLbApplyingUrl(null);
    }
  }

  async function handleApplyIgdbImage(imageUrl: string, slot: "icon" | "cover" | "hero" | "banner" | "logo") {
    setFetchingImageKey(slot);
    try {
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
    return Array.from(new Set(lbImages.map((i) => i.category)));
  }
  function getFilteredLbImages(): LaunchBoxImageResult[] {
    if (lbSelectedCategory === "all") return lbImages;
    return lbImages.filter((i) => i.category === lbSelectedCategory);
  }

  // ─── Size & executable ─────────────────────────────────────────
  async function openFolderAndDetectSize() {
    if (detectingSize) return;
    setDetectingSize(true);
    try {
      const picked = await open({ directory: true, multiple: false, title: "Select game folder" });
      if (!picked || Array.isArray(picked)) return;
      const folder = picked as string;
      const result = await invoke<{ sizeBytes: number; rootPath: string }>("detect_game_size", {
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

  async function handlePickExecutable() {
    try {
      const filePath = await open({
        multiple: false,
        directory: false,
        title: "Select Game Executable",
        filters: [
          { name: "Executables", extensions: ["exe", "bat", "lnk", "cmd"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (filePath && typeof filePath === "string") setEditPath(filePath);
    } catch (err) {
      showToast("Failed to select executable", "error");
    }
  }

  // ─── Save ───────────────────────────────────────────────────────
  function saveEdits() {
    const newName = editName.trim() || game.name;
    const newPlatform = editPlatform.trim() || game.platform;
    const newIcon = editIcon || undefined;
    const newSizeBytes = editSizeBytes;
    const newSizeRootPath = editSizeRootPath;
    const newSizeDetectedAt = editSizeBytes != null ? new Date().toISOString() : undefined;
    const newCover = editCover || undefined;
    const newHero = editHero || undefined;
    const newLogo = editLogo || undefined;
    const newNotes = editNotes.trim() || undefined;

    const newDescription = editDescription.trim() || undefined;
    const newDeveloper = editDeveloper.trim() || undefined;
    const newPublisher = editPublisher.trim() || undefined;
    const newReleaseDate = editReleaseDate.trim() || undefined;
    const newGenres = editGenres.length > 0 ? editGenres : undefined;
    const newStoryline = editStoryline.trim() || undefined;
    const newIgdbRating = editIgdbRating > 0 ? Number(editIgdbRating) : undefined;
    const newCriticRating = editCriticRating > 0 ? Number(editCriticRating) : undefined;
    const newThemes = editThemes.length > 0 ? editThemes : undefined;
    const newGameModes = editGameModes.length > 0 ? editGameModes : undefined;
    const newPlayerPerspectives = editPlayerPerspectives.length > 0 ? editPlayerPerspectives : undefined;

    const existingSims = game.similarGames || [];
    const newSimilarGames: SimilarGame[] = editSimilarGamesNames
      .map((name, index) => {
        const existing = existingSims.find((g) => g.name.toLowerCase() === name.toLowerCase());
        return {
          id: existing ? existing.id : index,
          name,
          coverUrl: existing ? existing.coverUrl : undefined,
        };
      });

    const newReleases = editReleases.filter((r) => r.platform);
    const newIgdbReviews = editIgdbReviews.length > 0 ? editIgdbReviews : undefined;
    const newLanguageSupports = editLanguageSupports.length > 0 ? editLanguageSupports : undefined;
    const newAlternativeNames = editAlternativeNames.filter(Boolean);

    // Steam identity: derive the appid from the (possibly freshly
    // applied) IGDB websites list when the game doesn't already have
    // one, so manually added exe/batch games get a STORED Steam id
    // the moment metadata is applied — reviews, Hydra user reviews,
    // ProtonDB and Steam deep links then read it off the row.
    const newSteamAppId =
      game.steamAppId ?? extractSteamAppIdFromWebsites(editWebsites) ?? undefined;

    updateGame(game.id, {
      name: newName,
      platform: newPlatform,
      steamAppId: newSteamAppId,
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
      languageSupports: newLanguageSupports,
      metadataSource: editMetadataSource ? editMetadataSource : undefined,
      metadataUrl: editMetadataUrl ? editMetadataUrl : undefined,
      path: editPath.trim() || undefined,
      launchArguments: editLaunchArguments.trim() || undefined,
      runAsAdmin: editRunAsAdmin || undefined,
      playStatus: editPlayStatus,
    });
    onClose();
    showToast("Game updated", "success");
  }

  const tabs: { key: EditTab; label: string; icon: ReactNode }[] = [
    { key: "details", label: "Details", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><line x1="10" y1="9" x2="8" y2="9" /></svg> },
    { key: "media", label: "Media & Images", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg> },
    { key: "advanced", label: "Advanced", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg> },
    { key: "launch", label: "Launch", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg> },
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal edit-modal" onClick={(e) => e.stopPropagation()}>
        {/* Live preview header */}
        <div className="edit-modal-preview">
          <div className="edit-modal-preview-art">
            <div className="edit-preview-hero" style={editHero ? { backgroundImage: `url(${editHero})` } : undefined}>
              {!editHero && <span className="edit-preview-hero-ph">Hero</span>}
            </div>
            <div className="edit-preview-cover" style={editCover ? { backgroundImage: `url(${editCover})` } : undefined}>
              {!editCover && <span>Cover</span>}
            </div>
            {editIcon && <img className="edit-preview-icon" src={editIcon} alt="icon" />}
          </div>
          <div className="edit-modal-preview-meta">
            <span className="edit-preview-eyebrow">{editPlatform || "Platform"} · {PLAY_STATUS_DETAILS[editPlayStatus].label}</span>
            <h3 className="edit-preview-title">{editName || game.name}</h3>
            {(editDeveloper || editPublisher) && (
              <p className="edit-preview-sub">
                {[editDeveloper, editPublisher].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          <div className="edit-modal-preview-actions">
            <Button
              variant="primary"
              size="sm"
              onClick={handleFetchMetadata}
              disabled={fetchingMetadata}
              isLoading={fetchingMetadata}
              leftIcon={
                !fetchingMetadata ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                ) : undefined
              }
            >
              {fetchingMetadata ? "Searching..." : "Fetch Metadata"}
            </Button>
            <button className="metadata-panel-close" onClick={onClose} aria-label="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="edit-modal-tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={editTab === tab.key}
              className={`edit-modal-tab ${editTab === tab.key ? "active" : ""}`}
              onClick={() => setEditTab(tab.key)}
            >
              <span className="edit-modal-tab-icon">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        <div className="edit-modal-body">
          {/* ── DETAILS ── */}
          {editTab === "details" && (
            <div className="edit-form">
              {showMetadataPanel && (
                <div className="metadata-panel">
                  <div className="metadata-panel-header">
                    <h3>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                      Metadata Search Results
                    </h3>
                    <button className="metadata-panel-close" onClick={() => setShowMetadataPanel(false)} aria-label="Close results">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
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
                              leftIcon={!applyingMetadata ? (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>) : undefined}
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

              <fieldset className="edit-fieldset">
                <legend className="edit-fieldset-legend">Core Identity</legend>
                <div className="edit-form-grid">
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-name">Name</label>
                    <input id="edit-name" className="edit-input" type="text" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Game name" />
                  </div>
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-play-status">Play Status</label>
                    <select id="edit-play-status" className="edit-input" value={editPlayStatus} onChange={(e) => setEditPlayStatus(e.target.value as PlayStatus)}>
                      {Object.entries(PLAY_STATUS_DETAILS).map(([key, details]) => (
                        <option key={key} value={key}>{details.label}</option>
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
                <div className="edit-field full-width" style={{ marginTop: "var(--space-md)" }}>
                  <label className="edit-label" htmlFor="edit-description">Description</label>
                  <textarea id="edit-description" className="edit-input edit-textarea" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="Short description or summary..." rows={3} />
                </div>
              </fieldset>

              <fieldset className="edit-fieldset">
                <legend className="edit-fieldset-legend">Ratings &amp; Engagement</legend>
                <div className="edit-form-grid">
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-igdb-rating">IGDB User Rating</label>
                    <input id="edit-igdb-rating" className="edit-input" type="number" min={0} max={100} value={editIgdbRating || ""} onChange={(e) => setEditIgdbRating(Number(e.target.value))} placeholder="0-100" />
                  </div>
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-critic-rating">IGDB Critic Rating</label>
                    <input id="edit-critic-rating" className="edit-input" type="number" min={0} max={100} value={editCriticRating || ""} onChange={(e) => setEditCriticRating(Number(e.target.value))} placeholder="0-100" />
                  </div>
                </div>
                <div className="edit-form-grid" style={{ marginTop: "var(--space-md)" }}>
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-genres">Genres</label>
                    <TagInput id="edit-genres" value={editGenres} onChange={setEditGenres} placeholder="Add a genre, press Enter" suggestions={GENRE_SUGGESTIONS} ariaLabel="Genres" />
                  </div>
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-themes">Themes</label>
                    <TagInput id="edit-themes" value={editThemes} onChange={setEditThemes} placeholder="Add a theme, press Enter" suggestions={THEME_SUGGESTIONS} ariaLabel="Themes" />
                  </div>
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-modes">Game Modes</label>
                    <TagInput id="edit-modes" value={editGameModes} onChange={setEditGameModes} placeholder="Add a mode, press Enter" suggestions={MODE_SUGGESTIONS} ariaLabel="Game Modes" />
                  </div>
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-perspectives">Player Perspectives</label>
                    <TagInput id="edit-perspectives" value={editPlayerPerspectives} onChange={setEditPlayerPerspectives} placeholder="Add a perspective, press Enter" suggestions={PERSPECTIVE_SUGGESTIONS} ariaLabel="Player Perspectives" />
                  </div>
                </div>
                <div className="edit-form-grid" style={{ marginTop: "var(--space-md)" }}>
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-hltb-main">HLTB Main (h)</label>
                    <input id="edit-hltb-main" className="edit-input" type="number" min={0} value={editTimeToBeatMain || ""} onChange={(e) => setEditTimeToBeatMain(Number(e.target.value))} placeholder="Hours" />
                  </div>
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-hltb-extra">HLTB Extra (h)</label>
                    <input id="edit-hltb-extra" className="edit-input" type="number" min={0} value={editTimeToBeatExtra || ""} onChange={(e) => setEditTimeToBeatExtra(Number(e.target.value))} placeholder="Hours" />
                  </div>
                  <div className="edit-field">
                    <label className="edit-label" htmlFor="edit-hltb-comple">HLTB Completionist (h)</label>
                    <input id="edit-hltb-comple" className="edit-input" type="number" min={0} value={editTimeToBeatComple || ""} onChange={(e) => setEditTimeToBeatComple(Number(e.target.value))} placeholder="Hours" />
                  </div>
                </div>
              </fieldset>

              <fieldset className="edit-fieldset">
                <legend className="edit-fieldset-legend">Catalog &amp; Tagging</legend>
                <div className="edit-form-grid">
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
                <div className="edit-field full-width" style={{ marginTop: "var(--space-md)" }}>
                  <label className="edit-label" htmlFor="edit-similar-games">Similar Games</label>
                  <TagInput id="edit-similar-games" value={editSimilarGamesNames} onChange={setEditSimilarGamesNames} placeholder="Add a similar game, press Enter" ariaLabel="Similar Games" />
                </div>
                <div className="edit-field full-width" style={{ marginTop: "var(--space-md)" }}>
                  <label className="edit-label" htmlFor="edit-alternative-names">Alternative Names</label>
                  <TagInput id="edit-alternative-names" value={editAlternativeNames} onChange={setEditAlternativeNames} placeholder="Add an alias, press Enter" ariaLabel="Alternative Names" />
                </div>
                <div className="edit-field full-width" style={{ marginTop: "var(--space-md)" }}>
                  <label className="edit-label" htmlFor="edit-storyline">Storyline</label>
                  <textarea id="edit-storyline" className="edit-input edit-textarea" value={editStoryline} onChange={(e) => setEditStoryline(e.target.value)} placeholder="Deep storyline/narrative summary..." rows={3} />
                </div>
                <div className="edit-field full-width" style={{ marginTop: "var(--space-md)" }}>
                  <label className="edit-label" htmlFor="edit-notes">Notes</label>
                  <textarea id="edit-notes" className="edit-input edit-textarea" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Personal notes about this game..." rows={3} />
                </div>
              </fieldset>
            </div>
          )}

          {/* ── MEDIA ── */}
          {editTab === "media" && (
            <div className="edit-form">
              <h4 className="edit-modal-section-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
                Images
              </h4>
              <div className="edit-images-grid">
                <EditImageSlot label="Icon" subtitle="Sidebar" imageUrl={editIcon} previewSize={{ w: 64, h: 64 }} isFetching={fetchingImageKey === "icon"} onChooseFile={() => handlePickImage("icon")} onFetchWeb={() => handleFetchImage("icon")} onRemove={() => handleRemoveImage("icon")} />
                <EditImageSlot label="Cover Art" subtitle="Library cards" imageUrl={editCover} previewSize={{ w: 120, h: 160 }} isFetching={fetchingImageKey === "cover"} onChooseFile={() => handlePickImage("cover")} onFetchWeb={() => handleFetchImage("cover")} onRemove={() => handleRemoveImage("cover")} />
                <EditImageSlot label="Hero Banner" subtitle="Game page top" imageUrl={editHero} previewSize={{ w: 240, h: 100 }} isFetching={fetchingImageKey === "hero"} onChooseFile={() => handlePickImage("hero")} onFetchWeb={() => handleFetchImage("hero")} onRemove={() => handleRemoveImage("hero")} />
                <EditImageSlot label="Logo" subtitle="Title image" imageUrl={editLogo} previewSize={{ w: 200, h: 60 }} isFetching={fetchingImageKey === "logo"} onChooseFile={() => handlePickImage("logo")} onFetchWeb={() => handleFetchImage("logo")} onRemove={() => handleRemoveImage("logo")} />
              </div>
              <div className="edit-media-browser-row">
                <Button variant="secondary" size="sm" onClick={handleOpenImageBrowser} leftIcon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="2" /><path d="M7 2v20" /><path d="M2 12h5" /></svg>}>
                  Browse LaunchBox Images
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setShowIgdbMediaBrowser(true)} leftIcon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-accent)" }}><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>}>
                  Browse IGDB Media
                </Button>
              </div>

              <UrlListEditor
                title="Screenshots"
                items={editScreenshots}
                onChange={setEditScreenshots}
                placeholder="Add custom screenshot URL..."
                emptyText="No screenshots yet."
                primaryActions={(url) => (
                  <>
                    <button className="lb-apply-btn" onClick={() => handleApplyIgdbImage(url, "cover")} disabled={fetchingImageKey !== null}>Set as Cover</button>
                    <button className="lb-apply-btn" onClick={() => handleApplyIgdbImage(url, "hero")} disabled={fetchingImageKey !== null}>Set as Hero</button>
                  </>
                )}
              />

              <UrlListEditor
                title="Videos & Trailers"
                items={editVideos}
                onChange={setEditVideos}
                placeholder="Add custom YouTube video URL..."
                emptyText="No videos yet."
                thumbnail={(url) => {
                  const videoId = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/)?.[1];
                  return videoId ? `https://img.youtube.com/vi/${videoId}/default.jpg` : undefined;
                }}
              />

              <UrlListEditor
                title="Websites"
                items={editWebsites}
                onChange={setEditWebsites}
                placeholder="Add official website or wiki URL..."
                emptyText="No websites yet."
              />
            </div>
          )}

          {/* ── ADVANCED ── */}
          {editTab === "advanced" && (
            <div className="edit-form">
              <div className="edit-field full-width" data-storage-row>
                <label className="edit-label">Size</label>
                <div className="size-edit-row">
                  <input className="edit-input size-readonly" type="text" readOnly value={editSizeBytes != null ? formatSize(editSizeBytes, sizeUnit) : "Not set"} placeholder="Not set" />
                  <button type="button" className="edit-btn edit-btn-secondary" onClick={openFolderAndDetectSize} disabled={detectingSize}>{detectingSize ? "Detecting..." : "Auto-detect"}</button>
                  <button type="button" className="edit-btn edit-btn-ghost" onClick={clearSize} disabled={editSizeBytes == null}>Clear</button>
                </div>
                {editSizeRootPath && <span className="size-edit-hint" title={editSizeRootPath}>{editSizeRootPath}</span>}
              </div>

              <div className="edit-form-grid">
                <div className="edit-field">
                  <label className="edit-label" htmlFor="edit-metadata-source">Metadata Source</label>
                  <input id="edit-metadata-source" className="edit-input" type="text" value={editMetadataSource} onChange={(e) => setEditMetadataSource(e.target.value)} placeholder="e.g., IGDB, Steam" />
                </div>
                <div className="edit-field">
                  <label className="edit-label" htmlFor="edit-metadata-url">Metadata URL</label>
                  <input id="edit-metadata-url" className="edit-input" type="text" value={editMetadataUrl} onChange={(e) => setEditMetadataUrl(e.target.value)} placeholder="https://..." />
                </div>
              </div>

              <div className="edit-field full-width" style={{ marginTop: "var(--space-lg)" }}>
                <label className="edit-label">Releases</label>
                <ArrayEditor<ReleaseDateInfo>
                  value={editReleases}
                  onChange={setEditReleases}
                  createEmpty={() => ({ platform: "", dateStr: "", region: "" })}
                  addLabel="Add release"
                  emptyText="No release entries yet."
                  columns={[
                    { key: "platform", label: "Platform", placeholder: "PC", width: "40%" },
                    { key: "dateStr", label: "Date", placeholder: "YYYY-MM-DD", width: "30%" },
                    { key: "region", label: "Region", placeholder: "Worldwide", width: "30%" },
                  ]}
                />
              </div>

              <div className="edit-field full-width" style={{ marginTop: "var(--space-lg)" }}>
                <label className="edit-label">Community Reviews</label>
                <ArrayEditor<IgdbReview>
                  value={editIgdbReviews}
                  onChange={setEditIgdbReviews}
                  createEmpty={() => ({ username: "", rating: undefined, content: "" })}
                  addLabel="Add review"
                  emptyText="No reviews yet."
                  columns={[
                    { key: "username", label: "Username", placeholder: "Player1", width: "28%" },
                    { key: "rating", label: "Rating", type: "number", placeholder: "0-100", width: "18%" },
                    { key: "content", label: "Content", type: "textarea", placeholder: "Amazing!", width: "54%" },
                  ]}
                />
              </div>

              <div className="edit-field full-width" style={{ marginTop: "var(--space-lg)" }}>
                <label className="edit-label">Supported Languages</label>
                <ArrayEditor<LanguageSupportInfo>
                  value={editLanguageSupports}
                  onChange={setEditLanguageSupports}
                  createEmpty={() => ({ language: "", supportType: "" })}
                  addLabel="Add language"
                  emptyText="No languages yet."
                  columns={[
                    { key: "language", label: "Language", placeholder: "English", width: "55%" },
                    { key: "supportType", label: "Support", type: "select", options: LANGUAGE_SUPPORT_TYPES, width: "45%" },
                  ]}
                />
              </div>
            </div>
          )}

          {/* ── LAUNCH ── */}
          {editTab === "launch" && (
            <div className="edit-form">
              <div className="edit-field full-width">
                <label className="edit-label" htmlFor="edit-path">Executable Path</label>
                <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                  <input id="edit-path" className="edit-input" type="text" value={editPath} onChange={(e) => setEditPath(e.target.value)} placeholder="Path to game executable" style={{ flex: 1 }} />
                  <button type="button" className="edit-btn edit-btn-secondary" onClick={handlePickExecutable} style={{ whiteSpace: "nowrap" }}>Browse...</button>
                </div>
              </div>
              <div className="edit-field full-width" style={{ marginTop: "var(--space-md)" }}>
                <label className="edit-label" htmlFor="edit-launch-arguments">Launch Arguments</label>
                <input id="edit-launch-arguments" className="edit-input" type="text" value={editLaunchArguments} onChange={(e) => setEditLaunchArguments(e.target.value)} placeholder="e.g. -windowed -novid -dev" />
                <span className="size-edit-hint">Custom command-line parameters passed directly to the executable on startup.</span>
              </div>
              <div className="edit-field full-width" style={{ marginTop: "var(--space-lg)" }}>
                <label className="checkbox-container" style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", cursor: "pointer", userSelect: "none" }}>
                  <input type="checkbox" checked={editRunAsAdmin} onChange={(e) => setEditRunAsAdmin(e.target.checked)} style={{ width: "18px", height: "18px", accentColor: "var(--color-accent)", cursor: "pointer" }} />
                  <span style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: "var(--color-text-primary)" }}>Run as Administrator</span>
                </label>
                <span className="size-edit-hint" style={{ display: "block", marginTop: "4px", marginLeft: "26px" }}>Elevate process privileges using Windows UAC when launching.</span>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <span className="modal-footer-count">
            {editTab === "details" && "Core identity, ratings, catalog & tagging"}
            {editTab === "media" && "Artwork, screenshots, videos & links"}
            {editTab === "advanced" && "Size, sources & structured data"}
            {editTab === "launch" && "How this game launches"}
          </span>
          <div className="modal-footer-actions">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={saveEdits}>Save Changes</Button>
          </div>
        </div>
      </div>

      {/* LaunchBox Image Browser */}
      {showImageBrowser && (
        <div className="modal-backdrop" onClick={() => setShowImageBrowser(false)}>
          <div className="modal lb-browser-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-header-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="2" /><path d="M7 2v20" /><path d="M2 12h5" /><path d="M2 7h5" /><path d="M2 17h5" /></svg>
              </div>
              <div className="modal-header-text">
                <h3 className="modal-title">LaunchBox Image Browser</h3>
                <p className="modal-subtitle">Browse and apply images from LaunchBox Games Database for {game.name}</p>
              </div>
              <button className="metadata-panel-close" onClick={() => setShowImageBrowser(false)} aria-label="Close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="lb-category-tabs">
              <button className={`lb-cat-tab ${lbSelectedCategory === "all" ? "active" : ""}`} onClick={() => setLbSelectedCategory("all")}>All ({lbImages.length})</button>
              {getLbCategories().map((cat) => (
                <button key={cat} className={`lb-cat-tab ${lbSelectedCategory === cat ? "active" : ""}`} onClick={() => setLbSelectedCategory(cat)}>{cat} ({lbImages.filter((i) => i.category === cat).length})</button>
              ))}
            </div>
            <div className="lb-browser-body">
              {lbLoading ? (
                <div className="metadata-loading"><div className="metadata-spinner" /><p>Searching LaunchBox for "{game.name}"...</p></div>
              ) : lbImages.length === 0 ? (
                <div className="metadata-empty">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
                  <p>No images found. Try editing the game name and searching again.</p>
                </div>
              ) : (
                <div className="lb-image-grid">
                  {getFilteredLbImages().map((img, idx) => (
                    <div key={idx} className="lb-image-card">
                      <div className="lb-image-thumb"><img src={img.url} alt={`${img.category} ${img.region || ""}`} loading="lazy" /></div>
                      <div className="lb-image-info">
                        <span className="lb-image-category">{img.category}</span>
                        <span className="lb-image-meta">
                          {img.region && <span className="lb-image-region">{img.region}</span>}
                          {img.resolution && <span className="lb-image-res">{img.resolution}</span>}
                        </span>
                      </div>
                      <div className="lb-image-actions">
                        {(["icon", "cover", "hero", "logo"] as const).map((slot) => (
                          <button key={slot} className="lb-apply-btn" onClick={() => handleApplyLbImage(img.url, slot)} disabled={lbApplyingUrl === img.url}>{lbApplyingUrl === img.url ? "..." : slot[0].toUpperCase() + slot.slice(1)}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* IGDB Media Browser */}
      {showIgdbMediaBrowser && (
        <div className="modal-backdrop" onClick={() => setShowIgdbMediaBrowser(false)}>
          <div className="modal lb-browser-modal" style={{ maxWidth: "820px", maxHeight: "85vh" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-header-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
              </div>
              <div className="modal-header-text">
                <h3 className="modal-title">IGDB Media Browser</h3>
                <p className="modal-subtitle">Browse screenshots, manage trailers, and download high-resolution game media</p>
              </div>
              <button className="metadata-panel-close" onClick={() => setShowIgdbMediaBrowser(false)} aria-label="Close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="lb-browser-body" style={{ padding: "var(--space-xl)", overflowY: "auto" }}>
              <div style={{ marginBottom: "var(--space-xl)" }}>
                <h4 style={{ margin: "0 0 var(--space-sm) 0", color: "var(--color-text-primary)" }}>Screenshots ({editScreenshots.length})</h4>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "var(--space-md)" }}>
                  {editScreenshots.map((url, idx) => (
                    <div key={idx} style={{ background: "var(--color-bg-secondary)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                      <img src={url} alt={`Screenshot ${idx + 1}`} style={{ width: "100%", height: "110px", objectFit: "cover" }} />
                      <div style={{ padding: "var(--space-xs)", display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
                        <button className="lb-apply-btn" style={{ padding: "4px 8px", fontSize: "10px" }} onClick={() => handleApplyIgdbImage(url, "cover")} disabled={fetchingImageKey !== null}>{fetchingImageKey === "cover" ? "Downloading..." : "Set as Cover Art"}</button>
                        <button className="lb-apply-btn" style={{ padding: "4px 8px", fontSize: "10px" }} onClick={() => handleApplyIgdbImage(url, "hero")} disabled={fetchingImageKey !== null}>{fetchingImageKey === "hero" ? "Downloading..." : "Set as Hero Banner"}</button>
                        <button className="lb-apply-btn" style={{ padding: "4px 8px", fontSize: "10px", background: "var(--color-danger-opacity)", color: "var(--color-danger)" }} onClick={() => setEditScreenshots(editScreenshots.filter((_, i) => i !== idx))}>Remove</button>
                      </div>
                    </div>
                  ))}
                </div>
                <UrlAddRow placeholder="Add custom screenshot URL..." onAdd={(v) => setEditScreenshots([...editScreenshots, v])} />
              </div>
              <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: "var(--space-lg)" }}>
                <h4 style={{ margin: "0 0 var(--space-sm) 0", color: "var(--color-text-primary)" }}>Videos & Trailers ({editVideos.length})</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
                  {editVideos.map((url, idx) => {
                    const videoId = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/)?.[1];
                    return (
                      <div key={idx} style={{ display: "flex", gap: "var(--space-md)", background: "var(--color-bg-secondary)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", padding: "var(--space-sm)", alignItems: "center" }}>
                        {videoId ? <img src={`https://img.youtube.com/vi/${videoId}/default.jpg`} alt="Video Thumbnail" style={{ width: "80px", height: "60px", objectFit: "cover", borderRadius: "var(--radius-sm)" }} /> : <div style={{ width: "80px", height: "60px", background: "var(--color-bg-tertiary)", borderRadius: "var(--radius-sm)" }} />}
                        <div style={{ flex: 1, overflow: "hidden" }}><span style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-primary)", wordBreak: "break-all", display: "block" }}>{url}</span></div>
                        <button className="lb-apply-btn" style={{ background: "var(--color-danger-opacity)", color: "var(--color-danger)", whiteSpace: "nowrap" }} onClick={() => setEditVideos(editVideos.filter((_, i) => i !== idx))}>Remove</button>
                      </div>
                    );
                  })}
                </div>
                <UrlAddRow placeholder="Add custom YouTube video URL..." onAdd={(v) => setEditVideos([...editVideos, v])} />
              </div>
            </div>
            <div className="modal-footer">
              <span className="modal-footer-count"></span>
              <div className="modal-footer-actions"><Button variant="primary" onClick={() => setShowIgdbMediaBrowser(false)}>Done</Button></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Small inline helpers for media lists ──────────────────────────────
function UrlListEditor({
  title,
  items,
  onChange,
  placeholder,
  emptyText,
  thumbnail,
  primaryActions,
}: {
  title: string;
  items: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  emptyText: string;
  thumbnail?: (url: string) => string | undefined;
  primaryActions?: (url: string) => ReactNode;
}) {
  return (
    <div className="url-list-editor">
      <h4 className="edit-modal-section-title">{title} ({items.length})</h4>
      {items.length === 0 ? (
        <p className="array-editor-empty">{emptyText}</p>
      ) : (
        <div className="url-list">
          {items.map((url, idx) => {
            const thumb = thumbnail?.(url);
            return (
              <div key={idx} className="url-list-row">
                {thumb ? <img className="url-list-thumb" src={thumb} alt="" /> : <div className="url-list-thumb url-list-thumb--empty" />}
                <span className="url-list-url">{url}</span>
                {primaryActions?.(url)}
                <button className="lb-apply-btn url-list-remove" onClick={() => onChange(items.filter((_, i) => i !== idx))}>Remove</button>
              </div>
            );
          })}
        </div>
      )}
      <UrlAddRow placeholder={placeholder} onAdd={(v) => onChange([...items, v])} />
    </div>
  );
}

function UrlAddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (url: string) => void }) {
  const [val, setVal] = useState("");
  return (
    <div className="url-add-row">
      <input className="edit-input" type="text" value={val} placeholder={placeholder} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && val.trim()) { onAdd(val.trim()); setVal(""); } }} />
      <button className="lb-apply-btn" onClick={() => { if (val.trim()) { onAdd(val.trim()); setVal(""); } }}>Add</button>
    </div>
  );
}
