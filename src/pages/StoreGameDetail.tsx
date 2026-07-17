import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useGames } from "../context/GameContext";
import { useToast } from "../context/ToastContext";
import { useBigScreen } from "../context/BigScreenContext";
import BigScreenStoreGamePage from "../components/store/BigScreenStoreGamePage";
import type { GameMetadataResult, IgdbReview, Game } from "../types/game";
import { useSizeUnit } from "../hooks/useSizeUnit";
import { Button } from "../components/ui";
import WebLinksTab from "../components/WebLinksTab";
import ReviewsTab from "../components/ReviewsTab";
import DownloadButton from "../components/DownloadButton";
import CrackWatchCard from "../components/CrackWatchCard";
import ProtonDBCard from "../components/ProtonDBCard";
import SteamPlayerCount from "../components/SteamPlayerCount";
import GameRelationsCard from "../components/GameRelationsCard";
import {
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
  SystemRequirementsCard,
} from "../components/game";


/* ------------------------------------------------------------------ */
/*  States                                                             */
/* ------------------------------------------------------------------ */

function StoreGameLoading() {
  return (
    <div className="game-page">
      <div className="game-hero" style={{ background: 'var(--color-bg-tertiary)', height: 240, borderRadius: 'var(--radius-lg)', opacity: 0.5 }} />
      <div style={{ display: 'flex', gap: 'var(--space-xl)', marginTop: 'var(--space-xl)' }}>
        <div style={{ flex: 2, height: 300, background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-lg)', opacity: 0.5 }} />
        <div style={{ flex: 1, height: 300, background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-lg)', opacity: 0.5 }} />
      </div>
      <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--color-text-muted)' }}>
        <div className="store-spinner" style={{ margin: '0 auto var(--space-md) auto' }} />
        Loading game details...
      </div>
    </div>
  );
}

function StoreGameError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const navigate = useNavigate();
  return (
    <div className="main-empty">
      <svg className="main-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <h2 className="main-empty-title">Failed to load game</h2>
      <p className="main-empty-subtitle">{message}</p>
      <div style={{ display: 'flex', gap: 'var(--space-md)', marginTop: 'var(--space-md)' }}>
        <Button variant="ghost" size="sm" onClick={onRetry}>Try Again</Button>
        <Button variant="ghost" size="sm" onClick={() => navigate("/store")}>Back to Store</Button>
      </div>
    </div>
  );
}

function StoreGameNotFound() {
  const navigate = useNavigate();
  return (
    <div className="main-empty">
      <svg className="main-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
      </svg>
      <h2 className="main-empty-title">Game Not Found</h2>
      <p className="main-empty-subtitle">This game could not be found on IGDB.</p>
      <Button variant="ghost" size="sm" onClick={() => navigate("/store")}>Back to Store</Button>
    </div>
  );
}


/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

type Tab = "overview" | "reviews" | "weblinks";

export default function StoreGameDetail() {
  const { gameSlug } = useParams<{ gameSlug: string }>();
  const navigate = useNavigate();
  const { games, addStoreGame } = useGames();
  const { showToast } = useToast();
  const { unit: sizeUnit } = useSizeUnit();
  const { isBigScreen } = useBigScreen();

  const [data, setData] = useState<GameMetadataResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [logoFailed, setLogoFailed] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // Extract Steam app id from websites
  const steamAppId = useMemo(() => {
    if (!data?.websites) return undefined;
    for (const url of data.websites) {
      const match = url.match(/store\.steampowered\.com\/app\/(\d+)/i);
      if (match) return parseInt(match[1], 10);
    }
    return undefined;
  }, [data]);

  // Build a rich Game object from the IGDB metadata so the shared
  // game components (InfoKpiCard, RatingsKpiCard, etc.) can render
  // the same cards they render on the library GamePage.
  const mockGame = useMemo((): Game | null => {
    if (!data) return null;
    return {
      id: `store-${data.title}`,
      name: data.title,
      path: "",
      platform: data.sourceName === "Steam" ? "Steam" : "IGDB",
      installed: false,
      playTime: "0h",
      addedAt: Date.now(),

      // ── Images ──────────────────────────────────────────────
      coverArtUrl: data.images.cover ?? undefined,
      bannerUrl: data.images.hero ?? data.images.banner ?? data.images.cover ?? undefined,
      logoUrl: data.images.logo ?? undefined,
      iconUrl: data.images.icon ?? undefined,

      // ── Metadata ────────────────────────────────────────────
      description: data.description ?? undefined,
      developer: data.developer ?? undefined,
      publisher: data.publisher ?? undefined,
      releaseDate: data.releaseDate ?? undefined,
      genres: data.genres.length > 0 ? data.genres : undefined,
      storyline: data.storyline ?? undefined,
      igdbRating: data.igdbRating ?? undefined,
      criticRating: data.criticRating ?? undefined,
      themes: data.themes?.length ? data.themes : undefined,
      gameModes: data.gameModes?.length ? data.gameModes : undefined,
      playerPerspectives: data.playerPerspectives?.length ? data.playerPerspectives : undefined,
      screenshots: data.screenshots?.length ? data.screenshots : undefined,
      videos: data.videos?.length ? data.videos : undefined,
      websites: data.websites?.length ? data.websites : undefined,
      timeToBeat: data.timeToBeat ?? undefined,
      similarGames: data.similarGames?.length ? data.similarGames : undefined,
      releases: data.releases?.length ? data.releases : undefined,
      igdbReviews: data.igdbReviews ?? undefined,
      alternativeNames: data.alternativeNames?.length ? data.alternativeNames : undefined,
      collection: data.collection ?? undefined,
      collectionId: data.collectionId,
      franchise: data.franchise ?? undefined,
      gameCategory: data.gameCategory ?? undefined,
      releaseStatus: data.releaseStatus ?? undefined,
      languageSupports: data.languageSupports?.length ? data.languageSupports : undefined,

      // ── Source ──────────────────────────────────────────────
      metadataSource: data.sourceName,
      metadataUrl: data.sourceUrl,
      steamAppId,

      // ── Library defaults ────────────────────────────────────
      playStatus: "backlog",
    };
  }, [data, steamAppId]);

  // Abort-safe fetch
  const fetchData = useCallback(() => {
    if (!gameSlug) return;
    setLoading(true);
    setError(null);

    invoke<GameMetadataResult | null>("get_store_game_detail", { slug: gameSlug })
      .then((result) => {
        if (!mountedRef.current) return;
        if (result) setData(result);
        else setData(null);
      })
      .catch((err) => {
        if (!mountedRef.current) return;
        setError(String(err));
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  }, [gameSlug]);

  useEffect(() => {
    setData(null);
    setActiveTab("overview");
    setLogoFailed(false);
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Check if already in library
  const existingInLibrary = useMemo(() => {
    if (!data) return null;
    const norm = data.title.toLowerCase().trim();
    return games.find((g) => g.name.toLowerCase().trim() === norm) ?? null;
  }, [data, games]);

  const handleReviewsFetched = useCallback(
    (reviews: IgdbReview[], _source: string) => {
      setData((prev) => (prev ? { ...prev, igdbReviews: reviews } : prev));
    },
    []
  );

  const handleAddToLibrary = async () => {
    if (!data || adding) return;
    setAdding(true);
    try {
      await addStoreGame(data);
    } catch (err) {
      showToast(`Failed to add game: ${err}`, "error");
    } finally {
      setAdding(false);
    }
  };

  // ── Render states ──────────────────────────────────────────────
  if (loading) return <StoreGameLoading />;
  if (error) return <StoreGameError message={error} onRetry={fetchData} />;
  if (!data || !mockGame) return <StoreGameNotFound />;

  const isInLibrary = !!existingInLibrary;
  const libraryGameId = existingInLibrary?.id;
  const releaseYear = data.releaseDate
    ? new Date(data.releaseDate).getFullYear()
    : null;

  if (isBigScreen && mockGame) {
    return (
      <BigScreenStoreGamePage
        game={mockGame}
        onBack={() => navigate("/store")}
        onAddToLibrary={handleAddToLibrary}
        adding={adding}
        isInLibrary={isInLibrary}
        libraryGameId={libraryGameId}
      />
    );
  }

  return (
    <div className="game-page">
      {/* ── Breadcrumb ──────────────────────────────────────────── */}
      <div className="game-top-bar">
        <button className="game-back-link" onClick={() => navigate("/store")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Store
        </button>
      </div>

      {/* ── Hero — same structure as GameHero but store-specific actions ── */}
      <div className="game-hero game-hero--compact">
        <div className="game-hero__banner">
          {(data.images.hero || data.images.banner) && (
            <div
              className="game-banner-bg"
              style={{ backgroundImage: `url(${data.images.hero ?? data.images.banner})` }}
            />
          )}

          {/* Live Steam player count badge */}
          <div className="hero-player-count">
            <SteamPlayerCount appId={steamAppId} />
          </div>

          <div className="game-banner">
            {(data.images.hero ?? data.images.banner ?? data.images.cover) ? (
              <img
                src={data.images.hero ?? data.images.banner ?? data.images.cover ?? ""}
                alt={data.title}
                className="game-cover-img"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity={0.2}>
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            )}
          </div>
        </div>

        {/* Info row below banner: logo/title + meta + actions */}
        <div className="game-hero__info-row">
          <div className="game-hero__title-block">
            {data.images.logo && !logoFailed ? (
              <img
                src={data.images.logo}
                alt={data.title}
                className="game-hero-logo"
                onError={() => setLogoFailed(true)}
              />
            ) : (
              <h1 className="game-hero-title">{data.title}</h1>
            )}
          </div>
          <div className="game-hero-meta">
            {data.developer && (
              <>
                <span>{data.developer}</span>
                <span className="game-hero-meta-dot" />
              </>
            )}
            {data.publisher && (
              <>
                <span>{data.publisher}</span>
                <span className="game-hero-meta-dot" />
              </>
            )}
            {releaseYear && (
              <>
                <span>{releaseYear}</span>
                <span className="game-hero-meta-dot" />
              </>
            )}
            <span>{data.sourceName}</span>
          </div>
          <div className="game-hero__actions" style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center", flexWrap: "wrap" }}>
            {isInLibrary ? (
              <button
                className="game-launch-btn"
                onClick={() => navigate(`/library/${libraryGameId}`)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18 }}>
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                View in Library
              </button>
            ) : (
              <>
                <button className="store-add-btn" onClick={handleAddToLibrary} disabled={adding}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  {adding ? "Adding..." : "Add to Library"}
                </button>
                <DownloadButton
                  gameName={data.title}
                  steamAppId={steamAppId}
                  variant="prominent"
                  label="Find Download"
                />
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────── */}
      <div className="game-tabs">
        {(["overview", "reviews", "weblinks"] as Tab[]).map((tab) => (
          <button
            key={tab}
            className={`game-tab ${activeTab === tab ? "active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* ── Overview ─────────────────────────────────────────────── */}
      {activeTab === "overview" && (
        <div className="game-content-grid">
          <div className="game-main-col">
            <AboutSection game={mockGame} />
            <SystemRequirementsCard steamAppId={steamAppId ?? null} />
            <StorylineSection game={mockGame} />
            <ScreenshotsSection
              game={mockGame}
              onOpen={(src) => setLightboxImage(src)}
            />
            <VideosSection game={mockGame} />

            {/* Game Relations Card — IGDB + library cross-ref */}
            <GameRelationsCard
              mode="store"
              currentGame={data}
              similarGames={data.similarGames}
              collectionId={data.collectionId}
              collectionName={data.collection}
            />
          </div>

          <div className="game-side-col">
            <InfoKpiCard game={mockGame} sizeUnit={sizeUnit} hideStatus />
            <RatingsKpiCard game={mockGame} />
            <SpecsCard game={mockGame} />
            <TimeToBeatCard game={mockGame} />
            <ReleasesCard game={mockGame} />
            <CrackWatchCard gameName={data.title} />
            <ProtonDBCard steamAppId={steamAppId} />
            <LanguagesSection game={mockGame} />
          </div>
        </div>
      )}

      {/* ── Reviews ───────────────────────────────────────────────── */}
      {activeTab === "reviews" && (
        <ReviewsTab game={mockGame} onReviewsFetched={handleReviewsFetched} />
      )}

      {/* ── Weblinks ──────────────────────────────────────────────── */}
      {activeTab === "weblinks" && (
        <WebLinksTab game={mockGame} visible={!lightboxImage} />
      )}

      {/* ── Lightbox ──────────────────────────────────────────────── */}
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
