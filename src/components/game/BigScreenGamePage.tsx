// BigScreenGamePage — PS5 single-page Game Hub for Big Screen mode.
//
// One tall scrolling page. No tabs. PS5 visual:
//   ┌──────────────────────────────────────────────────┐
//   │   Banner background (full-bleed)                 │
//   │   Game logo                          ▶ PLAY       │
//   │   Subtitle line                     Details  ⋯   │
//   └──────────────────────────────────────────────────┘
//   ┌── Metadata strip ─────────────────────────────────┐
//   │ [Platform] [Status] [Playtime] [Players] [Rating]│
//   └──────────────────────────────────────────────────┘
//   ┌── Storyline (one big block quote) ─────────────────┐
//   └──────────────────────────────────────────────────┘
//   ┌── About / Description ────────────────────────────┐
//   └──────────────────────────────────────────────────┘
//   ┌── Screenshots ────────────────────────────────────┐
//   │   [shot][shot][shot][shot][shot]──▶               │
//   └──────────────────────────────────────────────────┘
//   ┌── Specs ─────────┐  ┌── Releases ──────────────────┐
//   │ Modes, Themes…  │  │ Platform · date · region…    │
//   └─────────────────┘  └─────────────────────────────┘
//   ┌── Languages ──────────────────────────────────────┐
//   │ Language | Interface | Audio | Subtitles          │
//   └──────────────────────────────────────────────────┘
//   ┌── More (Explore) ─────────────────────────────────┐
//   │ Reviews · Activity · Achievements · Web Links     │
//   └──────────────────────────────────────────────────┘
//
// Composition: reuses existing components (ScreenshotsSection,
// SpecsCard, ReleasesCard, LanguagesSection, StorylineSection)
// where they already handle the data shape. New code lives in
// the hero + metadata strip + "More" grid.
//
// Accessibility: the Play button uses the BigScreenProvider's
// focusableProps helper so D-pad spatial nav lands on it from the
// rail of any sibling (e.g. the BigScreenLibrary). Other
// interactive elements (Details, More cards) register via the
// same helper.

import { useMemo, useState } from "react";
import type { Game } from "../../types/game";
import { useGames } from "../../context/GameContext";
import { useBigScreenHook } from "../../hooks/useBigScreen";
import { useSteamAppId } from "../../hooks/useSteamAppId";
import { PLAY_STATUS_DETAILS } from "../../types/game";
import SteamPlayerCount from "../SteamPlayerCount";
import GameLaunchActions from "./GameLaunchActions";
import BigScreenHeroBackground from "./BigScreenHeroBackground";
import SpecsCard from "./SpecsCard";
import ReleasesCard from "./ReleasesCard";
import LanguagesSection from "./LanguagesSection";
import ScreenshotsSection from "./ScreenshotsSection";
import StorylineSection from "./StorylineSection";
import AboutSection from "./AboutSection";

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

export default function BigScreenGamePage({
  game,
  onBack,
  onEdit,
  onRemove,
}: BigScreenGamePageProps) {
  const { runningGameIds, launchGame } = useGames();
  const { focusableProps } = useBigScreenHook();
  // Steam appid resolution for the player-count badge. Identical
  // pattern to the desktop hero: falls back to a one-shot Steam
  // name lookup for non-Steam titles and persists the resolved
  // appid back onto `game.steamAppId` via updateGame.
  const { appId: steamAppId } = useSteamAppId(game);
  const resolvedSteamAppId =
    typeof steamAppId === "number" ? steamAppId : game.steamAppId ?? null;
  const isRunning = runningGameIds.includes(game.id);
  const status = PLAY_STATUS_DETAILS[game.playStatus || "backlog"];

  // Screenshot lightbox state. We use the same fullscreen overlay
  // pattern as desktop GamePage so a screenshot tap opens an
  // in-place modal without bouncing out of Big Screen Mode.
  const [lightbox, setLightbox] = useState<string | null>(null);

  const focusableBack = focusableProps(onBack);
  const focusableEdit = focusableProps(onEdit);
  const focusableRemove = focusableProps(onRemove);
  const focusableTrailer = focusableProps(() => {
    if (!game.videos || game.videos.length === 0) return;
    setLightbox(game.videos[0]);
  });

  const releaseYear = useMemo(() => {
    if (!game.releaseDate) return null;
    const m = game.releaseDate.match(/(19|20)\d{2}/);
    return m ? Number.parseInt(m[0], 10) : null;
  }, [game.releaseDate]);

  const rating = game.igdbRating ?? game.criticRating;

  return (
    <div className="bigscreen-gamepage">
      {/* ── Hero ───────────────────────────────────────────── */}
      <section
        className="bigscreen-gamepage-hero"
        aria-label={`${game.name} banner`}
      >
        {/* Auto-cycling parallax background. Picks video > cycle >
            * static > empty based on what the game has. See
            * ./BigScreenHeroBackground.tsx for the ladder. */}
        <BigScreenHeroBackground
          bannerUrl={game.bannerUrl}
          coverArtUrl={game.coverArtUrl}
          screenshots={game.screenshots}
          videos={game.videos}
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
            <GameLaunchActions
              game={game}
              onLaunch={() => launchGame(game)}
              size="md"
            />
            {game.videos && game.videos.length > 0 && (
              <button
                type="button"
                className="bigscreen-gamepage-hero-btn"
                {...focusableTrailer}
                aria-label="Watch trailer"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden
                  width="20"
                  height="20"
                >
                  <polygon points="6 4 20 12 6 20 6 4" />
                </svg>
                <span>Trailer</span>
              </button>
            )}
            <button
              type="button"
              className="bigscreen-gamepage-hero-btn"
              {...focusableEdit}
              aria-label="Edit game details"
            >
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
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
              </svg>
              <span>Edit</span>
            </button>
            <button
              type="button"
              className="bigscreen-gamepage-hero-btn bigscreen-gamepage-hero-btn--danger"
              {...focusableRemove}
              aria-label="Remove from library"
              disabled={isRunning}
            >
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
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              <span>Remove</span>
            </button>
          </div>
        </div>
      </section>

      {/* ── Metadata strip ────────────────────────────────── */}
      <section className="bigscreen-gamepage-meta-strip" aria-label="Game metadata">
        <span className="bigscreen-gamepage-meta-pill bigscreen-gamepage-meta-pill--platform">
          {game.platform}
        </span>
        <span
          className="bigscreen-gamepage-meta-pill"
          style={{
            background: `color-mix(in srgb, ${status.color} 18%, transparent)`,
            color: status.color,
            borderColor: `color-mix(in srgb, ${status.color} 35%, transparent)`,
          }}
        >
          <span
            className="bigscreen-gamepage-meta-dot"
            style={{ background: status.color }}
          />
          {status.label}
        </span>
        <span className="bigscreen-gamepage-meta-pill">
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
          {game.playTime || "0h"}
        </span>
        {resolvedSteamAppId != null && (
          <span className="bigscreen-gamepage-meta-pill">
            <SteamPlayerCount appId={resolvedSteamAppId} /> playing now
          </span>
        )}
        {rating != null && rating > 0 && (
          <span className="bigscreen-gamepage-meta-pill">
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden
              width="14"
              height="14"
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            {Math.round(rating)}%{" "}
            {game.igdbRating != null ? "IGDB" : "Critic"}
          </span>
        )}
        {game.installed ? (
          <span className="bigscreen-gamepage-meta-pill bigscreen-gamepage-meta-pill--ready">
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
            Ready to play
          </span>
        ) : (
          <span className="bigscreen-gamepage-meta-pill bigscreen-gamepage-meta-pill--absent">
            Not installed
          </span>
        )}
        {isRunning && (
          <span className="bigscreen-gamepage-meta-pill bigscreen-gamepage-meta-pill--running">
            <span
              className="bigscreen-gamepage-meta-dot"
              style={{ background: "var(--color-success)" }}
            />
            Running
          </span>
        )}
      </section>

      {/* ── Storyline / About (existing components) ────────── */}
      <StorylineSection game={game} />
      <AboutSection game={game} />

      {/* ── Screenshots rail ───────────────────────────────── */}
      <ScreenshotsSection game={game} onOpen={setLightbox} />

      {/* ── Two-column grid: Specs + Releases ──────────────── */}
      <div className="bigscreen-gamepage-2col" data-cols="2">
        <SpecsCard game={game} />
        <ReleasesCard game={game} />
      </div>

      {/* ── Languages ─────────────────────────────────────── */}
      <LanguagesSection game={game} />

      {/* ── More (Explore) ─────────────────────────────────── */}
      {(game.igdbReviews?.length ||
        game.steamAchievements?.length ||
        game.websites?.length) && (
        <MoreSection game={game} />
      )}

      {/* ── Lightbox ───────────────────────────────────────── */}
      {/* ── Lightbox ───────────────────────────────────────── */}
      {lightbox && (
        <div
          className="bigscreen-gamepage-lightbox-mask"
          role="dialog"
          aria-modal="true"
          aria-label="Preview"
          onClick={() => setLightbox(null)}
        >
          {/* Inner frame stops click-propagation so clicking the
           *  image/video itself doesn't dismiss the preview — only
           *  the surrounding dim backdrop does. ──────────────── */}
          <div
            className="bigscreen-gamepage-lightbox-frame"
            onClick={(e) => e.stopPropagation()}
          >
            {isVideoUrl(lightbox) ? (
              <video src={lightbox} controls autoPlay />
            ) : (
              <img
                src={lightbox}
                alt="Fullscreen preview"
                style={{
                  maxWidth: "100%",
                  maxHeight: "85vh",
                  objectFit: "contain",
                  display: "block",
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────

function MoreSection({ game }: { game: Game }) {
  const { focusableProps } = useBigScreenHook();
  const reviewsCount = game.igdbReviews?.length ?? 0;
  const achievementsCount = game.steamAchievements?.length ?? 0;
  const websitesCount = game.websites?.length ?? 0;

  const cards: Array<{ title: string; subtitle: string; icon: React.ReactNode }> =
    [];
  if (reviewsCount > 0) {
    cards.push({
      title: "Reviews",
      subtitle: `${reviewsCount} review${reviewsCount === 1 ? "" : "s"}`,
      icon: <ReviewsIcon />,
    });
  }
  if (achievementsCount > 0) {
    cards.push({
      title: "Achievements",
      subtitle: `${achievementsCount} unlock${
        achievementsCount === 1 ? "" : "s"
      }`,
      icon: <TrophyIcon />,
    });
  }
  if (websitesCount > 0) {
    cards.push({
      title: "Web Links",
      subtitle: `${websitesCount} site${websitesCount === 1 ? "" : "s"}`,
      icon: <LinkIcon />,
    });
  }

  if (cards.length === 0) return null;

  // Single shared drill-in handler. Each card knows its "label" so
  // the desktop GamePage can decide which tab to land on. The
  // current implementation re-uses the regular GamePage and lets
  // the user pick a tab from its strip — the label is informational
  // only and broadcast on the drill-in event so future leap-into
  // logic (e.g. focus the Reviews tab directly) has the context.
  const handleDrillIn = useMemo(() => {
    return (_label: string) => () => {
      window.dispatchEvent(new CustomEvent("gamelib:drill-in"));
    };
  }, []);

  return (
    <section className="bigscreen-gamepage-more" aria-label="Explore more">
      <h2 className="bigscreen-gamepage-section-title">Explore</h2>
      <div className="bigscreen-gamepage-more-grid">
        {cards.map((c) => (
          <button
            key={c.title}
            type="button"
            className="bigscreen-gamepage-more-card"
            {...focusableProps(handleDrillIn(c.title))}
          >
            <span className="bigscreen-gamepage-more-card-icon" aria-hidden>
              {c.icon}
            </span>
            <span className="bigscreen-gamepage-more-card-title">
              {c.title}
            </span>
            <span className="bigscreen-gamepage-more-card-subtitle">
              {c.subtitle}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov)(\?|$)/.test(url);
}

function ReviewsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="22"
      height="22"
      aria-hidden
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="22"
      height="22"
      aria-hidden
    >
      <circle cx="12" cy="8" r="6" />
      <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="22"
      height="22"
      aria-hidden
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
