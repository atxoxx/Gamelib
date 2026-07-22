import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useGames, NO_IGDB_MATCH_SOURCE } from "../context/GameContext";
import { useToast } from "../context/ToastContext";
import { useBigScreen } from "../context/BigScreenContext";
import BigScreenGamePage from "../components/game/BigScreenGamePage";
import { EditGameModal } from "../components/game/EditGameModal";
import { useSizeUnit } from "../hooks/useSizeUnit";
import { type Game } from "../types/game";
import WebLinksTab from "../components/WebLinksTab";
import ReviewsTab from "../components/ReviewsTab";
import CrackWatchCard from "../components/CrackWatchCard";
import ProtonDBCard from "../components/ProtonDBCard";
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
  SystemRequirementsCard,
} from "../components/game";
import { GameActivityTab } from "../components/game/GameActivityTab";
import { Button, ConfirmModal } from "../components/ui";


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
  const { launchGame, enrichGameMetadata, removeGame } = useGames();
  const { unit: sizeUnit } = useSizeUnit();
  // Confirm-remove flow state. Clicking the Remove button in the
  // top bar opens the ConfirmModal; only on confirm do we actually
  // wipe the game (matches the destructive-action discipline used
  // by the IGDB / downloads tabs, vs. the silent toast path the
  // sidebar right-click uses).
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "reviews" | "activity" | "weblinks" | "achievements">("overview");

  // Metadata fetching state
  const [editing, setEditing] = useState(false);



  // Lightbox & Video states
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  // Fullscreen screenshot viewer: Esc closes; ←/→ step through the
  // game's screenshot gallery while open. Handlers attach only while
  // an image is shown so they don't swallow keys elsewhere.
  const lightboxIndex = useMemo(() => {
    if (!lightboxImage || !game.screenshots) return -1;
    return game.screenshots.indexOf(lightboxImage);
  }, [lightboxImage, game.screenshots]);

  const stepLightbox = useCallback(
    (dir: 1 | -1) => {
      if (!game.screenshots || game.screenshots.length === 0) return;
      const list = game.screenshots;
      const current = lightboxIndex < 0 ? 0 : lightboxIndex;
      const next = (current + dir + list.length) % list.length;
      setLightboxImage(list[next]);
    },
    [lightboxIndex, game.screenshots]
  );

  useEffect(() => {
    if (!lightboxImage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxImage(null);
      else if (e.key === "ArrowLeft") stepLightbox(-1);
      else if (e.key === "ArrowRight") stepLightbox(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxImage, stepLightbox]);


  
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

      {/* Tabs — sticky bar with an animated sliding indicator.
          The indicator span reads --tab-indicator-left / --width
          set imperatively from the measured active button so it
          slides between tab positions. Hidden until measured. */}
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
            <SystemRequirementsCard steamAppId={game.steamAppId ?? null} />
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
            <div className="side-group">
              <InfoKpiCard
                game={game}
                sizeUnit={sizeUnit}
                onEditSize={() => setEditing(true)}
              />
              <RatingsKpiCard game={game} />
              <TimeToBeatCard game={game} />
            </div>
            <div className="side-group">
              <SpecsCard game={game} />
              <ProtonDBCard steamAppId={game.steamAppId} />
              <CrackWatchCard gameName={game.name} appId={game.steamAppId} />
            </div>
            <div className="side-group">
              <ReleasesCard game={game} />
              <LanguagesSection game={game} />
            </div>
          </div>
        </div>
      )}

      {activeTab === "reviews" && <ReviewsTab game={game} />}

      {activeTab === "activity" && <GameActivityTab game={game} />}

      {activeTab === "weblinks" && (
        <WebLinksTab
          game={game}
          visible={!editing && !lightboxImage}
        />
      )}

      {activeTab === "achievements" && <AchievementsTab game={game} />}

      {/* Edit Modal */}
       {editing && <EditGameModal game={game} onClose={() => setEditing(false)} />}
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
          <button
            className="lightbox-nav lightbox-nav--prev"
            aria-label="Previous screenshot"
            onClick={(e) => { e.stopPropagation(); stepLightbox(-1); }}
            style={{
              position: 'fixed',
              left: 'var(--space-xl)',
              top: '50%',
              transform: 'translateY(-50%)',
              width: 44, height: 44,
              borderRadius: '50%',
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(0,0,0,0.5)',
              color: '#fff',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background var(--transition-fast)',
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 20, height: 20 }}>
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
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
            {game.screenshots && game.screenshots.length > 1 && (
              <div
                className="lightbox-counter"
                style={{
                  position: 'absolute',
                  bottom: 'var(--space-md)',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'rgba(0,0,0,0.6)',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '4px 12px',
                  borderRadius: 'var(--radius-full)',
                  letterSpacing: '0.4px',
                }}
              >
                {(lightboxIndex < 0 ? 1 : lightboxIndex + 1)} / {game.screenshots.length}
              </div>
            )}
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
          <button
            className="lightbox-nav lightbox-nav--next"
            aria-label="Next screenshot"
            onClick={(e) => { e.stopPropagation(); stepLightbox(1); }}
            style={{
              position: 'fixed',
              right: 'var(--space-xl)',
              top: '50%',
              transform: 'translateY(-50%)',
              width: 44, height: 44,
              borderRadius: '50%',
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(0,0,0,0.5)',
              color: '#fff',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background var(--transition-fast)',
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 20, height: 20 }}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
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
  const { isBigScreen } = useBigScreen();
  const navigate = useNavigate();

  useEffect(() => {
    if (gameId) {
      setSelectedGameId(gameId);
    }
  }, [gameId, setSelectedGameId]);

  const game = gameId ? getGame(gameId) : undefined;

  // Big Screen Mode: back navigates to the library grid; edit and
  // remove navigate back as well since Big Screen doesn't surface
  // inline modals for those flows — the user can complete the
  // action on the next desktop visit.
  const handleBack = useCallback(() => {
    navigate("/library");
  }, [navigate]);

  // Stub edit/remove — Big Screen can't open desktop modals inline,
  // so we just bounce back to the library. A future PR can add
  // inline Big Screen edit/remove flows.
  const handleBigScreenEdit = useCallback(() => {
    navigate("/library");
  }, [navigate]);

  const handleBigScreenRemove = useCallback(() => {
    navigate("/library");
  }, [navigate]);

  if (!game) {
    return <GameNotFound />;
  }

  // When Big Screen Mode is active, render the PS5 tabbed Game Page
  // with full hero, metadata strip, and 4-tab layout (Overview,
  // Media, Specs, More). BigScreenGamePage owns its own hero,
  // metadata strip, tab bar, and per-tab scroll regions.
  if (isBigScreen) {
    return (
      <BigScreenGamePage
        game={game}
        onBack={handleBack}
        onEdit={handleBigScreenEdit}
        onRemove={handleBigScreenRemove}
      />
    );
  }

  return <GameDetail key={game.id} game={game} />;
}

