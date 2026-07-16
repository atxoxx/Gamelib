// BigScreenLibrary — PS5 / Steam Big-Picture-style library page
// for Big Screen Mode. Two-column layout:
//
//   ┌────────────────┬──────────────────────────────────────┐
//   │                │   Continue Playing                  │
//   │   Spotlight    │   ┌──┐ ┌──┐ ┌──┐ ┌──┐ ───────────▶  │
//   │   (focal game  │   └──┘ └──┘ └──┘ └──┘                │
//   │    panel)      │   Recently Added                     │
//   │   ┌──────────┐ │   ┌──┐ ┌──┐ ┌──┐ ┌──┐ ───────────▶  │
//   │   │   cover  │ │   └──┘ └──┘ └──┘ └──┘                │
//   │   │ Play  ⚙  │ │   All Games                          │
//   │   └──────────┘ │   ┌──┐ ┌──┐ ┌──┐ ┌──┐ ───────────▶  │
//   │                │   └──┘ └──┘ └──┘ └──┘                │
//  40%              │             60%                        │
//   └────────────────┴──────────────────────────────────────┘
//
// Navigation: D-pad Left/Right moves within a rail; D-pad Up/Down
// jumps between Spotlight and the rails; A activates the focused
// card (game-click in rails, Play in Spotlight).
//
// Spotlight ↔ rail sync: each BigScreenGameCard emits its gameId via
// the `data-game-id` attribute. The BigScreenRail's focus-watcher
// inspects the GamepadProvider's `focusedElement`, picks up the
// attribute, and bubbles the matching Game back up via
// `onFocusedGameChange`. This component tracks that and re-renders
// the Spotlight accordingly — so highlighting ANY card with the
// D-pad updates the Spotlight panel.
//
// Steam fallback: useSteamAppId lives here so the spotlight is
// purely presentational and we only burn Steam round-trips for the
// focused game (the dominant UX case — non-focused games don't
// fetch their badges until they enter the spotlight).

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Game } from "../../types/game";
import { useGames } from "../../context/GameContext";
import { useSteamAppId } from "../../hooks/useSteamAppId";
import BigScreenSpotlight from "./BigScreenSpotlight";
import BigScreenRail from "./BigScreenRail";

interface BigScreenLibraryProps {
  /** All games in the library (already filtered). */
  filteredGames: Game[];
  /** Total library size (pre-filter), used in subtitles + counts. */
  totalGames: number;
  /** Invoked when a card or the Spotlight Play button activates. */
  onSelectGame: (game: Game) => void;
}

const PlayIcon = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <polygon points="6 4 20 12 6 20 6 4" />
  </svg>
);
const RecentIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const GridIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

export default function BigScreenLibrary({
  filteredGames,
  totalGames,
  onSelectGame,
}: BigScreenLibraryProps) {
  const { launchGame } = useGames();

  // ── Compute each rail's contents ────────────────────────────
  // Each rail's memo is keyed on `filteredGames` so toggling
  // filters (search/genre/source) updates the rails in lockstep
  // with the desktop Library page. The "Continue" rail is sorted
  // by `lastPlayed` desc; "Recently Added" by `addedAt` desc;
  // "All Games" follows the existing library sort (assumed
  // already applied upstream via `useLibraryFilters`).
  const continuePlaying = useMemo(() => {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    return filteredGames
      .filter((g) => (g.lastPlayed ?? 0) >= cutoff)
      .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
      .slice(0, 12);
  }, [filteredGames]);

  const recentlyAdded = useMemo(() => {
    return [...filteredGames]
      .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
      .slice(0, 12);
  }, [filteredGames]);

  // ── Featured game state ─────────────────────────────────────
  // Start with the most-recently-played game so a first-mount
  // user sees a populated spotlight. Once any rail's card grabs
  // focus (D-pad, click) the spotlight updates.
  const [featuredGame, setFeaturedGame] = useState<Game | null>(() => {
    return continuePlaying[0] ?? recentlyAdded[0] ?? filteredGames[0] ?? null;
  });

  // ── Spotlight ↔ rail sync ─────────────────────────────────
  // A single callback is shared across all 3 rails — each rail's
  // internal focus-watcher only fires when one of ITS cards gains
  // focus (it filters by its own DOM subtree via the
  // `scrollRef.current.contains` check in BigScreenRail), so a
  // spotlight update from rail-A never accidentally reflects a
  // card that lives in rail-B.
  const handleFocusedGameChange = useCallback((g: Game | null) => {
    setFeaturedGame(g);
  }, []);

  // ── Steam resolution for the featured game ──────────────────
  // useSteamAppId already short-circuits on `null` / `undefined`
  // (its `if (!game) return;` guard at the top of the resolve
  // effect skips the Steam round-trip when no game is focused).
  // Passing `featuredGame` directly removes the need for the
  // EMPTY_GAME sentinel that PR 1 used to satisfy the hook's
  // `Game` (not `Game | null`) signature.
  const { appId: featuredSteamAppId } = useSteamAppId(featuredGame);
  const resolvedSteamAppId =
    typeof featuredSteamAppId === "number"
      ? featuredSteamAppId
      : featuredGame?.steamAppId ?? null;

  // ── Play / Details handlers ─────────────────────────────────
  const handlePlay = useCallback(
    (game: Game) => {
      launchGame(game);
    },
    [launchGame],
  );

  const handleDetails = useCallback(
    (game: Game) => {
      onSelectGame(game);
    },
    [onSelectGame],
  );

  // If the user changes filters and the currently-focused game is
  // no longer in the filtered set, fall back to the first available
  // remaining game so the spotlight doesn't show ghost metadata.
  useEffect(() => {
    if (!featuredGame) return;
    if (filteredGames.some((g) => g.id === featuredGame.id)) return;
    setFeaturedGame(continuePlaying[0] ?? recentlyAdded[0] ?? filteredGames[0] ?? null);
  }, [filteredGames, featuredGame, continuePlaying, recentlyAdded]);

  return (
    <div className="bigscreen-library">
      <BigScreenSpotlight
        game={featuredGame}
        steamAppId={resolvedSteamAppId}
        onPlay={handlePlay}
        onDetails={handleDetails}
      />

      <div className="bigscreen-library-rails">
        <BigScreenRail
          title="Continue Playing"
          icon={PlayIcon}
          games={continuePlaying}
          emptyLabel="Play a game to start tracking sessions — they'll show up here."
          onCardClick={onSelectGame}
          onFocusedGameChange={handleFocusedGameChange}
        />
        <BigScreenRail
          title="Recently Added"
          icon={RecentIcon}
          games={recentlyAdded}
          emptyLabel="No newly added games — import one in the sidebar to get started."
          onCardClick={onSelectGame}
          onFocusedGameChange={handleFocusedGameChange}
        />
        <BigScreenRail
          title={`Library · ${totalGames}`}
          icon={GridIcon}
          games={filteredGames.slice(0, 24)}
          emptyLabel="No games yet — import games from the sidebar to fill your library."
          onCardClick={onSelectGame}
          onFocusedGameChange={handleFocusedGameChange}
        />
      </div>
    </div>
  );
}
