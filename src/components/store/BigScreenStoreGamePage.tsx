import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { Game } from "../../types/game";
import { useFocusable } from "../../hooks/useFocusable";
import { useGamepad } from "../../hooks/GamepadProvider";
import { useSteamAppId } from "../../hooks/useSteamAppId";
import SteamPlayerCount from "../SteamPlayerCount";
import DownloadModal from "../DownloadModal";
import BigScreenHeroBackground from "../game/BigScreenHeroBackground";
import SpecsCard from "../game/SpecsCard";
import ReleasesCard from "../game/ReleasesCard";
import LanguagesSection from "../game/LanguagesSection";
import ScreenshotsSection from "../game/ScreenshotsSection";
import VideosSection from "../game/VideosSection";
import StorylineSection from "../game/StorylineSection";
import AboutSection from "../game/AboutSection";
import SystemRequirementsCard from "../game/SystemRequirementsCard";
import RatingsKpiCard from "../game/RatingsKpiCard";
import TimeToBeatCard from "../game/TimeToBeatCard";
import CrackWatchCard from "../CrackWatchCard";
import GameRelationsCard from "../GameRelationsCard";
import ReviewsTab from "../ReviewsTab";
import WebLinksTab from "../WebLinksTab";
import BigScreenPill from "../bigscreen/BigScreenPill";
import BigScreenMetaStrip from "../bigscreen/BigScreenMetaStrip";
import BigScreenLightbox from "../bigscreen/BigScreenLightbox";
import BigScreenTabBar, { type TabDef } from "../bigscreen/BigScreenTabBar";
import BigScreenTabPanel from "../bigscreen/BigScreenTabPanel";
import { extractYear } from "../bigscreen/bigscreenFormat";

interface BigScreenStoreGamePageProps {
  game: Game;
  onBack: () => void;
  onAddToLibrary: () => void;
  adding: boolean;
  isInLibrary: boolean;
  libraryGameId?: string;
}

type StorePageTab = "overview" | "media" | "specs" | "more";

const STORE_PAGE_TABS: TabDef<StorePageTab>[] = [
  { id: "overview", label: "Overview", icon: <OverviewIcon /> },
  { id: "media", label: "Media", icon: <MediaIcon /> },
  { id: "specs", label: "Specs", icon: <SpecsIcon /> },
  { id: "more", label: "More", icon: <MoreIcon /> },
];

export default function BigScreenStoreGamePage({
  game,
  onBack,
  onAddToLibrary,
  adding,
  isInLibrary,
  libraryGameId,
}: BigScreenStoreGamePageProps) {
  const gamepad = useGamepad();
  const navigate = useNavigate();

  // Steam appid resolution
  const { appId: steamAppId } = useSteamAppId(game);
  const resolvedSteamAppId =
    typeof steamAppId === "number" ? steamAppId : game.steamAppId ?? null;

  // Tab + Lightbox state
  const [activeTab, setActiveTab] = useState<StorePageTab>("overview");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);

  // Bumper tab cycling
  useEffect(() => {
    return gamepad.registerTabCycler((direction) => {
      if (lightbox) return;
      setActiveTab((prev) => {
        const idx = STORE_PAGE_TABS.findIndex((t) => t.id === prev);
        const nextIdx =
          direction === "forward"
            ? (idx + 1) % STORE_PAGE_TABS.length
            : (idx - 1 + STORE_PAGE_TABS.length) % STORE_PAGE_TABS.length;
        return STORE_PAGE_TABS[nextIdx].id;
      });
    });
  }, [gamepad.registerTabCycler, lightbox]);

  const focusableBack = useFocusable(onBack);
  const focusableAction = useFocusable(() => {
    if (isInLibrary && libraryGameId) {
      navigate(`/library/${libraryGameId}`);
    } else {
      onAddToLibrary();
    }
  });

  const focusableTrailer = useFocusable(() => {
    if (!game.videos || game.videos.length === 0) return;
    setLightbox(game.videos[0]);
  });

  const focusableDownload = useFocusable(() => setDownloadOpen(true));

  const releaseYear = extractYear(game.releaseDate);
  const rating = game.igdbRating ?? game.criticRating;

  return (
    <div className="bigscreen-gamepage">
      {/* ── Hero (pauses on Overview) ── */}
      <section className="bigscreen-gamepage-hero" aria-label={`${game.name} banner`}>
        <BigScreenHeroBackground
          bannerUrl={game.bannerUrl}
          coverArtUrl={game.coverArtUrl}
          screenshots={game.screenshots}
          videos={game.videos}
          paused={activeTab === "overview"}
        />
        <div className="bigscreen-gamepage-hero-mask" aria-hidden />
        <div className="bigscreen-gamepage-hero-glow" aria-hidden />

        <div className="bigscreen-gamepage-hero-content">
          <button
            type="button"
            className="bigscreen-gamepage-hero-back"
            {...focusableBack}
            aria-label="Back to store"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden width="22" height="22">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            <span>Store</span>
          </button>

          <div className="bigscreen-gamepage-hero-info">
            {game.logoUrl ? (
              <img src={game.logoUrl} alt={game.name} className="bigscreen-gamepage-hero-logo" />
            ) : (
              <h1 className="bigscreen-gamepage-hero-title">{game.name}</h1>
            )}
            <div className="bigscreen-gamepage-hero-subtitle-row">
              {game.developer && (
                <span className="bigscreen-gamepage-hero-subtitle">{game.developer}</span>
              )}
              {releaseYear && <span className="bigscreen-gamepage-hero-subtitle-dot" />}
              {releaseYear && (
                <span className="bigscreen-gamepage-hero-subtitle">{releaseYear}</span>
              )}
            </div>
          </div>

          <div className="bigscreen-gamepage-hero-actions">
            <button
              type="button"
              className="bigscreen-details-btn bigscreen-details-btn--primary"
              {...focusableAction}
              disabled={adding}
            >
              {isInLibrary ? (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>In Library</span>
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  <span>{adding ? "Adding..." : "Add to Library"}</span>
                </>
              )}
            </button>

            {!isInLibrary && (
              <button
                type="button"
                className="bigscreen-details-btn bigscreen-details-btn--secondary"
                {...focusableDownload}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20" aria-hidden>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>Find Download</span>
              </button>
            )}

            {game.videos && game.videos.length > 0 && (
              <button
                type="button"
                className="bigscreen-details-btn bigscreen-details-btn--secondary"
                {...focusableTrailer}
                aria-label="Watch trailer"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden width="20" height="20">
                  <polygon points="6 4 20 12 6 20 6 4" />
                </svg>
                <span>Trailer</span>
              </button>
            )}

            {downloadOpen && (
              <DownloadModal
                gameName={game.name}
                steamAppId={resolvedSteamAppId || undefined}
                onClose={() => setDownloadOpen(false)}
              />
            )}
          </div>
        </div>
      </section>

      {/* ── Metadata pills ── */}
      <BigScreenMetaStrip aria-label="Game metadata" className="bigscreen-gamepage-meta-strip">
        <BigScreenPill tone="accent" size="md">
          {game.platform}
        </BigScreenPill>
        {resolvedSteamAppId != null && (
          <BigScreenPill tone="muted" size="md">
            <SteamPlayerCount appId={resolvedSteamAppId} className="bigscreen-steam-players" /> on Steam
          </BigScreenPill>
        )}
        {rating != null && rating > 0 && (
          <BigScreenPill tone="muted" size="md" icon={
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden width="14" height="14">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          }>
            {Math.round(rating)}% rating
          </BigScreenPill>
        )}
      </BigScreenMetaStrip>

      {/* ── Tab bar ── */}
      <BigScreenTabBar
        tabs={STORE_PAGE_TABS}
        activeTab={activeTab}
        onActivate={setActiveTab}
        ariaLabel="Store game details sections"
      />

      {/* ── Scroll regions ── */}
      <div className="bigscreen-gamepage-tab-scroll-region">
        <BigScreenTabPanel tabId="overview" activeTab={activeTab}>
          <div className="bigscreen-gamepage-overview">
            <StorylineSection game={game} />
            <AboutSection game={game} />
          </div>
        </BigScreenTabPanel>

        <BigScreenTabPanel tabId="media" activeTab={activeTab}>
          <div className="bigscreen-gamepage-media">
            <ScreenshotsSection game={game} onOpen={setLightbox} />
            <VideosSection game={game} />
          </div>
        </BigScreenTabPanel>

        <BigScreenTabPanel tabId="specs" activeTab={activeTab}>
          <div className="bigscreen-gamepage-specs">
            <div className="bigscreen-gamepage-2col" data-cols="2">
              <SpecsCard game={game} />
              <ReleasesCard game={game} />
            </div>
            <div className="bigscreen-gamepage-2col" data-cols="2">
              <TimeToBeatCard game={game} />
              <RatingsKpiCard game={game} />
            </div>
            <LanguagesSection game={game} />
            <SystemRequirementsCard steamAppId={resolvedSteamAppId} />
            <CrackWatchCard gameName={game.name} />
          </div>
        </BigScreenTabPanel>

        <BigScreenTabPanel tabId="more" activeTab={activeTab}>
          <div className="bigscreen-gamepage-more">
            <GameRelationsCard
              mode="store"
              currentGame={game}
              similarGames={game.similarGames}
              collectionId={game.collectionId}
              collectionName={game.collection}
            />
            <ReviewsTab game={game} />
            <WebLinksTab game={game} visible={true} />
          </div>
        </BigScreenTabPanel>
      </div>

      <BigScreenLightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

// ── Tab icons ──

function OverviewIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden width="18" height="18">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function MediaIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden width="18" height="18">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

function SpecsIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden width="18" height="18">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function MoreIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden width="18" height="18">
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  );
}
