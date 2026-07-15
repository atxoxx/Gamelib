// BigScreenSpotlight — left-side focal panel for BigScreenMode
// library. Shows the currently-focused game's cover, name, summary,
// status, and a large Play button (focusable). Mirrors PS5/Steam
// Big Picture behavior where the spotlight updates to reflect
// whichever game card the user has highlighted.
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
// the `focusableProps` helper from `useBigScreenHook` so spatial nav
// can land on them. Their action handlers are passed in from the
// parent so the Spotlight owns no game state — same pattern as the
// desktop GameHero's GameLaunchActions.

import { useCallback } from "react";
import type { Game } from "../../types/game";
import { useBigScreenHook } from "../../hooks/useBigScreen";
import { useGames } from "../../context/GameContext";
import { PLAY_STATUS_DETAILS } from "../../types/game";
import SteamPlayerCount from "../SteamPlayerCount";

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

const PLACEHOLDER_COVER_CLASS = "bigscreen-spotlight-cover--placeholder";

export default function BigScreenSpotlight({
  game,
  steamAppId,
  onPlay,
  onDetails,
}: BigScreenSpotlightProps) {
  const { runningGameIds } = useGames();
  const { focusableProps } = useBigScreenHook();
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

  // Register focusable buttons. The `useCallback` keys on `game?.id`
  // so the focus listener reattaches when the spotlight target
  // changes — without this, navigating from one game to another
  // would keep Play pointing at the previous game's `handlePlay`.
  const playProps = focusableProps(handlePlay);
  const detailsProps = focusableProps(handleDetails);

  // ── Empty placeholder ────────────────────────────────────────
  if (!game) {
    return (
      <section
        className="bigscreen-spotlight bigscreen-spotlight--empty"
        aria-label="Featured game"
        data-empty="true"
      >
        <div className="bigscreen-spotlight-glow" aria-hidden />
        <div className={`bigscreen-spotlight-cover ${PLACEHOLDER_COVER_CLASS}`}>
          <div className="bigscreen-spotlight-cover-placeholder">
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
          </div>
        </div>
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

      <div className="bigscreen-spotlight-cover">
        {coverUrl ? (
          <img src={coverUrl} alt={game.name} loading="lazy" />
        ) : (
          <div className={`bigscreen-spotlight-cover-placeholder`}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              aria-hidden
            >
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
        )}
        {isRunning && (
          <span
            className="bigscreen-spotlight-running-dot"
            title="Running"
            aria-label="This game is currently running"
          />
        )}
      </div>

      <div className="bigscreen-spotlight-meta">
        <div className="bigscreen-spotlight-pills">
          <span className="bigscreen-spotlight-pill bigscreen-spotlight-pill--platform">
            {game.platform}
          </span>
          <span
            className="bigscreen-spotlight-pill"
            style={{
              background: `color-mix(in srgb, ${status.color} 18%, transparent)`,
              color: status.color,
              borderColor: `color-mix(in srgb, ${status.color} 35%, transparent)`,
            }}
          >
            <span
              className="bigscreen-spotlight-pill-dot"
              style={{ background: status.color }}
            />
            {status.label}
          </span>
          {resolvedSteamAppId != null && (
            <span className="bigscreen-spotlight-pill bigscreen-spotlight-pill--players">
              <SteamPlayerCount appId={resolvedSteamAppId} />
            </span>
          )}
          {releaseYear != null && (
            <span className="bigscreen-spotlight-pill">{releaseYear}</span>
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

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

function extractYear(date: string | undefined): number | null {
  if (!date) return null;
  // ISO `YYYY-MM-DD` is the most common shape; fall back to the
  // first 4-digit run for free-form strings like "Q4 2025".
  const m = date.match(/(19|20)\d{2}/);
  return m ? Number.parseInt(m[0], 10) : null;
}

function formatLastPlayed(ts: number): string {
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return "Just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

/**
 * Sentinel Game object passed to `useSteamAppId` when the
 * spotlight's game slot is empty. The hook only reads `.id` /
 * `.name` / `.steamAppId`, so a minimal shape avoids an early
 * `undefined` branch on every render. We never persist this object
 * — the hook should treat it as a "no current target" signal and
 * skip the Steam round-trip.
 */
// (Moved to BigScreenLibrary — single-owner of the hook call.)
