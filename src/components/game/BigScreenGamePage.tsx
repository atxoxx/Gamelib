// BigScreenGamePage — PS5 tabbed Game Hub for Big Screen mode.
//
// Phase 3 PR 3a replaces the previous single-page scroll with a
// 4-tab layout (Overview | Media | Specs | More) and bumper-cycled
// navigation. The hero stays fixed at the top across all tabs;
// each tab owns its own scroll region.
//
//   ┌──────────────────────────────────────────────────┐
//   │   Banner background (full-bleed, paused on Overview)
//   │   Game logo / title              ▶ PLAY
//   │   Subtitle line                  Trailer · Edit · Remove
//   └──────────────────────────────────────────────────┘
//   ┌── Metadata strip (pills) ─────────────────────────┐
//   │ [Platform] [Status] [Playtime] [Players] [Rating]
//   └──────────────────────────────────────────────────┘
//   ┌── Tab bar (LB / [Overview][Media][Specs][More] / RB) ─┐
//   └──────────────────────────────────────────────────┘
//   ┌── Tab panel (scrolls; only one is active at a time) ──┐
//   │  Overview: Storyline · About · SystemReqs · ...
//   │  Media:    empty placeholder (PR 3b)
//   │  Specs:    empty placeholder (PR 3b)
//   │  More:     empty placeholder (PR 3c)
//   └──────────────────────────────────────────────────┘
//
// Bumper wiring: `useGamepad().registerTabCycler(...)` overrides
// BigScreenNav's tab cycler while this page is mounted. The
// unregister fn runs on unmount so the nav cycler reclaims LB/RB
// when the user leaves the Game Hub.
//
// Per-tab scroll regions: the TabPanel component owns the
// absolute/relative CSS that keeps inactive panels in the DOM
// (preserves scroll) while not participating in layout. Only the
// active panel owns the layout box.
//
// Paused hero: `paused={activeTab === "overview"}` keeps the
// Ken-Burns / cross-fade cycle frozen on the landing tab so the
// user has time to read the cover, title, and meta strip. The
// cycle resumes on Media/Specs/More where the user is focused on
// tab content.

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Game } from "../../types/game";
import { useGames } from "../../context/GameContext";
import { useFocusable } from "../../hooks/useFocusable";
import { useGamepad } from "../../hooks/GamepadProvider";
import { useSteamAppId } from "../../hooks/useSteamAppId";
import { PLAY_STATUS_DETAILS } from "../../types/game";
import SteamPlayerCount from "../SteamPlayerCount";
import { openUrl } from "@tauri-apps/plugin-opener";
import DownloadModal from "../DownloadModal";
import BigScreenHeroBackground from "./BigScreenHeroBackground";
import SpecsCard from "./SpecsCard";
import ReleasesCard from "./ReleasesCard";
import LanguagesSection from "./LanguagesSection";
import ScreenshotsSection from "./ScreenshotsSection";
import VideosSection from "./VideosSection";
import StorylineSection from "./StorylineSection";
import AboutSection from "./AboutSection";
import SystemRequirementsCard from "./SystemRequirementsCard";
import RatingsKpiCard from "./RatingsKpiCard";
import TimeToBeatCard from "./TimeToBeatCard";
import CrackWatchCard from "../CrackWatchCard";
import GameRelationsCard from "../GameRelationsCard";
import ReviewsTab from "../ReviewsTab";
import AchievementsTab from "../AchievementsTab";
import WebLinksTab from "../WebLinksTab";
import { GameActivityTab } from "./GameActivityTab";
import BigScreenPill from "../bigscreen/BigScreenPill";
import BigScreenMetaStrip from "../bigscreen/BigScreenMetaStrip";
import BigScreenLightbox from "../bigscreen/BigScreenLightbox";
import BigScreenTabBar, {
  type TabDef,
} from "../bigscreen/BigScreenTabBar";
import BigScreenTabPanel from "../bigscreen/BigScreenTabPanel";
import { extractYear } from "../bigscreen/bigscreenFormat";

interface BigScreenGamePageProps {
  /** The currently-viewed game. Page is mounted only when this is defined. */
  game: Game;
  /** Navigate to /library to "Exit Big Screen Mode" via Back. */
  onBack: () => void;
  /** Open the existing edit modal (preserves desktop parity). */
  onEdit: () => void;
  /** Open the confirm-remove flow (preserves desktop parity). */
  onRemove: () => void;
}

type GamePageTab = "overview" | "media" | "specs" | "more";

const GAME_PAGE_TABS: TabDef<GamePageTab>[] = [
  { id: "overview", label: "Overview", icon: <OverviewIcon /> },
  { id: "media", label: "Media", icon: <MediaIcon /> },
  { id: "specs", label: "Specs", icon: <SpecsIcon /> },
  { id: "more", label: "More", icon: <MoreIcon /> },
];

export default function BigScreenGamePage({
  game,
  onBack,
  onEdit,
  onRemove,
}: BigScreenGamePageProps) {
  const { runningGameIds, launchGame, forceCloseGame } = useGames();
  const gamepad = useGamepad();
  // Steam appid resolution for the player-count badge. Identical
  // pattern to the desktop hero: falls back to a one-shot Steam
  // name lookup for non-Steam titles and persists the resolved
  // appid back onto `game.steamAppId` via updateGame.
  const { appId: steamAppId } = useSteamAppId(game);
  const resolvedSteamAppId =
    typeof steamAppId === "number" ? steamAppId : game.steamAppId ?? null;
  const isRunning = runningGameIds.includes(game.id);
  const status = PLAY_STATUS_DETAILS[game.playStatus || "backlog"];

  // Tab state + lightbox state.
  const [activeTab, setActiveTab] = useState<GamePageTab>("overview");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  // Reset isClosing when game stops running
  useEffect(() => {
    if (!isRunning) {
      setIsClosing(false);
    }
  }, [isRunning]);

  // Bumper-cycled tab navigation (LB / RB). `registerTabCycler`
  // returns an unregister function that runs on unmount, restoring
  // BigScreenNav's LB/RB behavior when the user leaves the Game
  // Hub. While the lightbox is open we ignore bumper presses so
  // the user can't cycle tabs while a fullscreen preview is up.
  useEffect(() => {
    return gamepad.registerTabCycler((direction) => {
      if (lightbox) return;
      setActiveTab((prev) => {
        const idx = GAME_PAGE_TABS.findIndex((t) => t.id === prev);
        const nextIdx =
          direction === "forward"
            ? (idx + 1) % GAME_PAGE_TABS.length
            : (idx - 1 + GAME_PAGE_TABS.length) % GAME_PAGE_TABS.length;
        return GAME_PAGE_TABS[nextIdx].id;
      });
    });
  }, [gamepad.registerTabCycler, lightbox]);

  const handlePlay = () => {
    launchGame(game);
  };

  const handleForceClose = () => {
    if (isRunning) {
      setIsClosing(true);
      forceCloseGame(game);
    }
  };

  const showInstall =
    !game.installed && game.platform === "Steam" && game.steamAppId;

  const handleInstall = () => {
    if (!game.steamAppId) return;
    openUrl(`steam://install/${game.steamAppId}`).catch((err) =>
      console.warn("Failed to open Steam install:", err)
    );
  };

  const focusablePlay = useFocusable(handlePlay);
  const focusableForceClose = useFocusable(handleForceClose);
  const focusableInstall = useFocusable(handleInstall);
  const focusableDownload = useFocusable(() => setDownloadOpen(true));
  const focusableBack = useFocusable(onBack);
  const focusableEdit = useFocusable(onEdit);
  const focusableRemove = useFocusable(onRemove);
  const focusableTrailer = useFocusable(() => {
    if (!game.videos || game.videos.length === 0) return;
    setLightbox(game.videos[0]);
  });

  const releaseYear = extractYear(game.releaseDate);
  const rating = game.igdbRating ?? game.criticRating;

  return (
    <div className="bigscreen-gamepage">
      {/* ── Hero (always visible, pauses on Overview) ────────── */}
      <section
        className="bigscreen-gamepage-hero"
        aria-label={`${game.name} banner`}
      >
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
            aria-label="Back to library"
            title="Back to library"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              width="22"
              height="22"
            >
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <span>Library</span>
          </button>

          <div className="bigscreen-gamepage-hero-info">
            {game.logoUrl ? (
              <img
                src={game.logoUrl}
                alt={game.name}
                className="bigscreen-gamepage-hero-logo"
              />
            ) : (
              <h1 className="bigscreen-gamepage-hero-title">{game.name}</h1>
            )}
            <div className="bigscreen-gamepage-hero-subtitle-row">
              {game.developer && (
                <span className="bigscreen-gamepage-hero-subtitle">
                  {game.developer}
                </span>
              )}
              {releaseYear && (
                <span className="bigscreen-gamepage-hero-subtitle-dot" />
              )}
              {releaseYear && (
                <span className="bigscreen-gamepage-hero-subtitle">
                  {releaseYear}
                </span>
              )}
            </div>
          </div>

          <div className="bigscreen-gamepage-hero-actions">
            {showInstall && (
              <button
                type="button"
                className="bigscreen-details-btn bigscreen-details-btn--primary"
                {...focusableInstall}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20" aria-hidden>
                  <polyline points="8 17 12 21 16 17" />
                  <line x1="12" y1="12" x2="12" y2="21" />
                  <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29" />
                </svg>
                <span>Install via Steam</span>
              </button>
            )}

            {!showInstall && (
              isRunning ? (
                <>
                  <button
                    type="button"
                    className="bigscreen-details-btn bigscreen-details-btn--primary"
                    disabled
                  >
                    <span className="bigscreen-game-card-running-dot" style={{ position: "relative", top: 0, right: 0, marginRight: 8 }} />
                    <span>Running</span>
                  </button>
                  <button
                    type="button"
                    className="bigscreen-details-btn bigscreen-details-btn--danger"
                    {...focusableForceClose}
                    disabled={isClosing}
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <rect x="6" y="6" width="12" height="12" rx="1.5" />
                    </svg>
                    <span>{isClosing ? "Closing…" : "Force Close"}</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="bigscreen-details-btn bigscreen-details-btn--primary"
                  {...focusablePlay}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden>
                    <polygon points="6 4 20 12 6 20 6 4" />
                  </svg>
                  <span>Play</span>
                </button>
              )
            )}

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

            <button
              type="button"
              className="bigscreen-details-btn bigscreen-details-btn--secondary"
              {...focusableEdit}
              aria-label="Edit game details"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden width="18" height="18">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              <span>Edit</span>
            </button>

            <button
              type="button"
              className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-gamepage-hero-btn--danger"
              {...focusableRemove}
              aria-label="Remove from library"
              disabled={isRunning}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden width="18" height="18">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              <span>Remove</span>
            </button>

            {downloadOpen && (
              <DownloadModal
                gameName={game.name}
                gameId={game.id}
                steamAppId={game.steamAppId}
                onClose={() => setDownloadOpen(false)}
              />
            )}
          </div>
        </div>
      </section>

      {/* ── Metadata strip (pills) ───────────────────────────── */}
      <BigScreenMetaStrip
        aria-label="Game metadata"
        className="bigscreen-gamepage-meta-strip"
      >
        <BigScreenPill tone="accent" size="md">
          {game.platform}
        </BigScreenPill>
        <BigScreenPill
          tone="muted"
          size="md"
          dot
          customColor={status.color}
        >
          {status.label}
        </BigScreenPill>
        <BigScreenPill
          tone="muted"
          size="md"
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              width="14"
              height="14"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          }
        >
          {game.playTime || "0h"}
        </BigScreenPill>
        {resolvedSteamAppId != null && (
          <BigScreenPill tone="muted" size="md">
            <SteamPlayerCount appId={resolvedSteamAppId} className="bigscreen-steam-players" /> on Steam
          </BigScreenPill>
        )}
        {rating != null && rating > 0 && (
          <BigScreenPill
            tone="muted"
            size="md"
            icon={
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden
                width="14"
                height="14"
              >
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            }
          >
            {Math.round(rating)}%{" "}
            {game.igdbRating != null ? "IGDB" : "Critic"}
          </BigScreenPill>
        )}
        {game.installed ? (
          <BigScreenPill
            tone="success"
            size="md"
            icon={
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
                width="14"
                height="14"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            }
          >
            Ready to play
          </BigScreenPill>
        ) : (
          <BigScreenPill tone="muted" size="md">
            Not installed
          </BigScreenPill>
        )}
        {isRunning && (
          <BigScreenPill tone="success" size="md" dot>
            Running
          </BigScreenPill>
        )}
      </BigScreenMetaStrip>

      {/* ── Tab bar (LB / [tabs] / RB) ───────────────────────── */}
      <BigScreenTabBar
        tabs={GAME_PAGE_TABS}
        activeTab={activeTab}
        onActivate={setActiveTab}
        ariaLabel="Game page sections"
      />

      {/* ── Per-tab scroll region ───────────────────────────── */}
      <div className="bigscreen-gamepage-tab-scroll-region">
        <BigScreenTabPanel tabId="overview" activeTab={activeTab}>
        <BigScreenGamePageOverview game={game} />
        </BigScreenTabPanel>
        <BigScreenTabPanel tabId="media" activeTab={activeTab}>
          <BigScreenGamePageMedia
            game={game}
            onOpenLightbox={setLightbox}
          />
        </BigScreenTabPanel>
        <BigScreenTabPanel tabId="specs" activeTab={activeTab}>
          <BigScreenGamePageSpecs game={game} />
        </BigScreenTabPanel>
        <BigScreenTabPanel tabId="more" activeTab={activeTab}>
          <BigScreenGamePageMore game={game} />
        </BigScreenTabPanel>
      </div>

      {/* ── Lightbox (portal-rendered) ──────────────────────── */}
      <BigScreenLightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

// ─── Overview tab content ────────────────────────────────────────
//
// PR 3a keeps the existing Overview sections (Storyline, About,
// SystemRequirements, Screenshots, the 2-col Specs + Releases row,
// Languages, plus the GameRelationsCard that's now wired in) as
// the canonical Overview landing content. PR 3b will rearrange
// some of these into Media (screenshots) and Specs (cards).

function BigScreenGamePageOverview({
  game,
}: {
  game: Game;
}) {
  return (
    <div className="bigscreen-gamepage-overview">
      {/* Prose-only landing: the narrative story + the description.
       *  Screenshots and data cards moved to Media / Specs tabs in
       *  PR 3b; SystemRequirementsCard moved to Specs (where power
       *  users look first). */}
      <StorylineSection game={game} />
      <AboutSection game={game} />
    </div>
  );
}

// ─── Media tab content ────────────────────────────────────────────
//
// PR 3b fills in the Media tab. Screenshots (with lightbox) +
// Videos (IGDB / YouTube embeds). ScreenshotsSection.onOpen bubbles
// the clicked screenshot URL up to the parent BigScreenGamePage
// where the lightbox state lives, so the click handler survives
// tab switches.

function BigScreenGamePageMedia({
  game,
  onOpenLightbox,
}: {
  game: Game;
  onOpenLightbox: (src: string) => void;
}) {
  return (
    <div className="bigscreen-gamepage-media">
      <ScreenshotsSection game={game} onOpen={onOpenLightbox} />
      <VideosSection game={game} />
    </div>
  );
}

// ─── Specs tab content ─────────────────────────────────────────────
//
// PR 3b fills in the Specs tab. Power-user "data dump": spec cards,
// releases, languages, system requirements, plus the crackwatch
// status, time-to-beat, and ratings KPI cards. Layout is a mix of
// 2-col grids for compact cards and full-width rows for tables /
// language lists.

function BigScreenGamePageSpecs({ game }: { game: Game }) {
  return (
    <div className="bigscreen-gamepage-specs">
      {/* Two-column: SpecsCard + ReleasesCard. */}
      <div className="bigscreen-gamepage-2col" data-cols="2">
        <SpecsCard game={game} />
        <ReleasesCard game={game} />
      </div>

      {/* Two-column: TimeToBeatCard + RatingsKpiCard. */}
      <div className="bigscreen-gamepage-2col" data-cols="2">
        <TimeToBeatCard game={game} />
        <RatingsKpiCard game={game} />
      </div>

      {/* Languages (full-width table). */}
      <LanguagesSection game={game} />

      {/* System Requirements (Steam pc_requirements). Auto-hides
       *  when Steam has no appid for the title. */}
      <SystemRequirementsCard
        steamAppId={
          typeof game.steamAppId === "number" ? game.steamAppId : null
        }
      />

      {/* CrackWatch status (cracked / uncracked / denuvo). */}
      <CrackWatchCard gameName={game.name} />
    </div>
  );
}

// ─── More tab content ────────────────────────────────────────────
//
// PR 3c fills in the More tab by directly reusing the four desktop
// tab components (ReviewsTab, AchievementsTab, GameActivityTab,
// WebLinksTab) plus the GameRelationsCard that moved out of
// Overview. The components are mounted inside `.bigscreen-gamepage-more`
// (see bigscreen.css) which sets the TV-scale padding/spacing
// without forking the desktop implementations.
//
// `WebLinksTab` accepts a `visible?: boolean` prop the desktop uses
// to suppress the embedded webview when modals are open. Big Screen
// has no modals on this tab so we pass `visible={true}`.
//
// `GameActivityTab` is exported from `src/pages/GamePage.tsx` rather
// than its own module. Importing across the components→pages
// boundary is a known wart — a future cleanup PR can extract it
// to `src/components/activity/GameActivityTab.tsx`.

function BigScreenGamePageMore({ game }: { game: Game }) {
  return (
    <div className="bigscreen-gamepage-more">
      {/* Top: relations card (collection / developer / publisher /
       *  franchise / similar). Acts as the "explore further" entry
       *  point above the data-heavy tab content. */}
      <GameRelationsCard
        mode="library"
        currentGame={game}
        currentGameId={game.id}
        similarGames={game.similarGames}
        collectionId={game.collectionId}
        collectionName={game.collection}
      />

      {/* Reviews aggregator (Steam / Metacritic / OpenCritic / RAWG). */}
      <ReviewsTab game={game} />

      {/* Steam achievements with rarity distribution. */}
      <AchievementsTab game={game} />

      {/* Activity dashboard (sessions, playtime charts). */}
      <GameActivityTab game={game} />

      {/* External links (store, ProtonDB, PCGamingWiki, etc.).
       *  visible={true} — no Big Screen modal masking. */}
      <WebLinksTab game={game} visible={true} />
    </div>
  );
}

// (EmptyTabPlaceholder was removed in PR 3b — all four tabs now
// render real content. If a future "no data" inner state needs
// to be shared across tabs, reintroduce it here.)

// ─── Tab icons (inline SVGs, no icon library dependency) ─────────

function OverviewIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      width="18"
      height="18"
    >
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function MediaIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      width="18"
      height="18"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

function SpecsIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      width="18"
      height="18"
    >
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
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      width="18"
      height="18"
    >
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  );
}