// BigScreenSpotlight — left-side focal panel for BigScreenMode
// library. Shows the currently-focused game's cover, name, summary,
// status, and a large Play button (focusable). Mirrors PS5/Steam
// Big Picture behavior where the spotlight updates to reflect
// whichever game card the user has highlighted.
//
// As of PR 2, the status / metadata pill row uses the shared
// `BigScreenPill` component (was inline JSX). The cover, running
// indicator, and placeholder fall back through `BigScreenCover`.
// Format helpers (`truncate`, `extractYear`) live in
// `../bigscreen/bigscreenFormat.ts`.
//
// Visibility
// ──────────
// The spotlight is rendered when at least one game exists in the
// library. When the library is empty, LibraryPage renders the
// existing LibraryEmptyState instead of this component — so this
// component doesn't have to special-case the empty path.
//
// Focus registration
// ──────────────────
// The Play and Details buttons register with the GamepadProvider via
// `useFocusable` so spatial nav can land on them. Their action
// handlers are passed in from the parent so the Spotlight owns no
// game state — same pattern as the desktop GameHero's
// GameLaunchActions.

import { useCallback } from "react";
import type { Game } from "../../types/game";
import { useGames } from "../../context/GameContext";
import { useFocusable } from "../../hooks/useFocusable";
import { PLAY_STATUS_DETAILS } from "../../types/game";
import SteamPlayerCount from "../SteamPlayerCount";
import BigScreenPill from "../bigscreen/BigScreenPill";
import BigScreenCover from "../bigscreen/BigScreenCover";
import {
  truncate,
  extractYear,
  formatLastPlayed,
} from "../bigscreen/bigscreenFormat";

interface BigScreenSpotlightProps {
  /**
   * The game currently featured in the spotlight. Driven by the
   * parent's focus-watcher (which inspects `gamepad.focusedElement`
   * for the `data-game-id` attribute on the focused card and emits
   * the matching Game). If `null`, the spotlight renders a
   * low-pressure "select a game to see details here" placeholder.
   */
  game: Game | null;
  /**
   * Steam AppID for the featured game, if the parent has resolved
   * one (via `useSteamAppId`). Used to power the live player-count
   * badge. `null` when there's no Steam row yet — non-Steam titles
   * still render without a badge.
   */
  steamAppId: number | null;
  /**
   * Invoked when the user activates the spotlight's Play button
   * (A button / mouse click while Play is focused). The parent
   * typically calls `launchGame(game)` here.
   */
  onPlay: (game: Game) => void;
  /**
   * Invoked when the user activates the spotlight's Details button.
   * The parent usually navigates to `/library/:gameId`.
   */
  onDetails: (game: Game) => void;
}

/** Monitor icon for the empty-library placeholder cover. */
const EmptyStatePlaceholderIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.2"
    aria-hidden
  >
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

export default function BigScreenSpotlight({
  game,
  steamAppId,
  onPlay,
  onDetails,
}: BigScreenSpotlightProps) {
  const { runningGameIds } = useGames();
  // Steam look-up lives in BigScreenLibrary so the spotlight stays
  // purely presentational and we don't burn a Steam round-trip when
  // no game is focused. The resolved appid is passed down via the
  // `steamAppId` prop; right now we just trust it.
  const resolvedSteamAppId =
    typeof steamAppId === "number" ? steamAppId : game?.steamAppId ?? null;
  const isRunning = game ? runningGameIds.includes(game.id) : false;

  const handlePlay = useCallback(() => {
    if (!game) return;
    onPlay(game);
  }, [game, onPlay]);

  const handleDetails = useCallback(() => {
    if (!game) return;
    onDetails(game);
  }, [game, onDetails]);

  // Register focusable buttons. `useFocusable` reads the latest
  // callback via a ref, so the focus listener auto-updates when the
  // spotlight target swaps — no `game?.id` dep tracking needed.
  const playProps = useFocusable(handlePlay);
  const detailsProps = useFocusable(handleDetails);

  // ── Empty placeholder ────────────────────────────────────────
  if (!game) {
    return (
      <section
        className="bigscreen-spotlight bigscreen-spotlight--empty"
        aria-label="Featured game"
        data-empty="true"
      >
        <div className="bigscreen-spotlight-glow" aria-hidden />
        <BigScreenCover
          alt=""
          aspectRatio="16 / 9"
          placeholderIcon={EmptyStatePlaceholderIcon}
          className="bigscreen-spotlight-cover bigscreen-spotlight-cover--placeholder"
        />
        <div className="bigscreen-spotlight-meta">
          <h2 className="bigscreen-spotlight-title">Welcome to your library</h2>
          <p className="bigscreen-spotlight-subtitle">
            Highlight any game on the right to see its cover, summary,
            and a quick Play button here.
          </p>
        </div>
      </section>
    );
  }

  // ── Featured game ────────────────────────────────────────────
  const status = PLAY_STATUS_DETAILS[game.playStatus || "backlog"];
  const coverUrl = game.bannerUrl || game.coverArtUrl;
  const releaseYear = extractYear(game.releaseDate);

  return (
    <section
      className="bigscreen-spotlight"
      aria-label={`Featured game: ${game.name}`}
    >
      <div className="bigscreen-spotlight-glow" aria-hidden />

      <BigScreenCover
        url={coverUrl}
        alt={game.name}
        isRunning={isRunning}
        aspectRatio="16 / 9"
        className="bigscreen-spotlight-cover"
      />

      <div className="bigscreen-spotlight-meta">
        <div className="bigscreen-spotlight-pills">
          <BigScreenPill tone="accent" size="sm">
            {game.platform}
          </BigScreenPill>
          <BigScreenPill
            tone="muted"
            size="sm"
            dot
            customColor={status.color}
          >
            {status.label}
          </BigScreenPill>
          {resolvedSteamAppId != null && (
            <BigScreenPill tone="info" size="sm">
              <SteamPlayerCount appId={resolvedSteamAppId} />
            </BigScreenPill>
          )}
          {releaseYear != null && (
            <BigScreenPill tone="muted" size="sm">
              {releaseYear}
            </BigScreenPill>
          )}
        </div>

        <h2 className="bigscreen-spotlight-title">{game.name}</h2>

        {game.developer && (
          <p className="bigscreen-spotlight-developer">
            by {game.developer}
          </p>
        )}

        {game.description && (
          <p className="bigscreen-spotlight-description">
            {truncate(game.description, 220)}
          </p>
        )}

        <div className="bigscreen-spotlight-actions">
          <button
            type="button"
            className="bigscreen-spotlight-btn bigscreen-spotlight-btn--play"
            {...playProps}
            disabled={isRunning}
            aria-label={isRunning ? `Resume ${game.name}` : `Play ${game.name}`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden
              width="22"
              height="22"
            >
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            <span>{isRunning ? "Running" : "Play"}</span>
          </button>
          <button
            type="button"
            className="bigscreen-spotlight-btn bigscreen-spotlight-btn--details"
            {...detailsProps}
            aria-label={`Open ${game.name} details`}
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
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span>Details</span>
          </button>
        </div>

        <div className="bigscreen-spotlight-stats">
          <SpotlightStat label="Play time" value={game.playTime || "—"} />
          <SpotlightStat
            label="Last played"
            value={
              game.lastPlayed
                ? formatLastPlayed(game.lastPlayed)
                : "Never"
            }
          />
          <SpotlightStat
            label="Genres"
            value={
              game.genres && game.genres.length > 0
                ? game.genres.slice(0, 2).join(" · ")
                : "—"
            }
          />
        </div>
      </div>
    </section>
  );
}

function SpotlightStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="bigscreen-spotlight-stat">
      <span className="bigscreen-spotlight-stat-label">{label}</span>
      <span className="bigscreen-spotlight-stat-value">{value}</span>
    </div>
  );
}