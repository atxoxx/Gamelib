import { useState } from "react";
import { KpiTile } from "../ui";
import { type Game, PLAY_STATUS_DETAILS } from "../../types/game";
import { useGames } from "../../context/GameContext";
import { useSteamAppId } from "../../hooks/useSteamAppId";
import SteamPlayerCount from "../SteamPlayerCount";
import GameStatusDropdown from "./GameStatusDropdown";
import GameLaunchActions from "./GameLaunchActions";
import { IconClock, IconPlatform, IconUsers } from "./icons";

/**
 * GameHero
 *
 *  The compact banner at the top of the Game page. Layout:
 *
 *  ┌──────────────────────────────────────────────────────┐
 *  │  Banner (compact, clamp 120-180px tall)              │
 *  │  ┌──────────────┐                       ┌──────────┐ │
 *  │  │ Players Now  │   KPI overlay          │  Status  │ │
 *  │  │ Play Time    │   (bottom-right,       │  KPI     │ │
 *  │  │              │    glass tiles)        │          │ │
 *  │  └──────────────┘                        └──────────┘ │
 *  └──────────────────────────────────────────────────────┘
 *  ┌──────────────────────────────────────────────────────┐
 *  │ Logo / Title          Steam · 20h 38m · 10 Jul    ▶ L │
 *  │  (left)                (meta middle)     Launch (R) │
 *  └──────────────────────────────────────────────────────┘
 *
 *  The TopBar (`.game-top-bar`) above the hero in `GamePage.tsx`
 *  owns the Return-to-Library / Edit / Remove affordances. This
 *  keeps the hero compact and avoids duplicate controls inside the
 *  banner.
 *
 *  Steam player count
 *  ──────────────────
 *  The "Players Now" KPI tile is gated on `useSteamAppId`, which
 *  resolves `game.steamAppId` for non-Steam games (manual imports,
 *  games added from the Store, Epic-synced, GOG-synced) via a
 *  one-shot Steam store-search fallback. The resolved appid is
 *  persisted back onto `game.steamAppId` so subsequent library
 *  loads skip the lookup; the tile "just appears" for every game
 *  Steam has a matching entry for.
 */

interface GameHeroProps {
  game: Game;
  onLaunch: () => void;
}

function formatHeroPlayTime(playTime: string): string {
  if (!playTime) return "0h";
  return playTime;
}

export default function GameHero({ game, onLaunch }: GameHeroProps) {
  const { updateGame } = useGames();
  // useSteamAppId resolves `game.steamAppId` for non-Steam games
  // via a one-shot Steam store-search fallback. Persists the
  // resolution back onto the row, so the next time this game is
  // loaded the badge is instant.
  const { appId: steamAppId } = useSteamAppId(game);
  const [bannerErrored, setBannerErrored] = useState(false);

  const addedDate = new Date(game.addedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const showCoverFallback = !game.bannerUrl && !game.coverArtUrl;

  return (
    <div className="game-hero game-hero--compact">
      <div className="game-hero__banner">
        {game.bannerUrl && (
          <div
            className="game-banner-bg"
            style={{ backgroundImage: `url(${game.bannerUrl})` }}
          />
        )}

        <div className="game-banner">
          {!bannerErrored && (game.bannerUrl || game.coverArtUrl) ? (
            <img
              src={game.bannerUrl || game.coverArtUrl}
              alt={game.name}
              className="game-cover-img"
              onError={() => setBannerErrored(true)}
            />
          ) : showCoverFallback ? (
            <svg
              width="64"
              height="64"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              opacity={0.2}
            >
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          ) : null}
        </div>

        {/* KPI overlay: glass tiles that surface the most-glanced
            stats right on the banner. The "Players Now" tile now
            follows the resolved appid from `useSteamAppId` so it
            works on manual imports / Store-added / Epic / GOG rows
            the moment the hook finds a Steam match for the name. */}
        <div className="game-hero__kpis">
          {steamAppId != null ? (
            <KpiTile
              glass
              size="sm"
              label="Players Now"
              icon={<IconUsers size={12} />}
              value={<SteamPlayerCount appId={steamAppId} />}
              intent="accent"
            />
          ) : null}
          <KpiTile
            glass
            size="sm"
            label="Play Time"
            icon={<IconClock size={12} />}
            value={formatHeroPlayTime(game.playTime)}
            subtext={game.installed ? "Installed" : "Not installed"}
            intent={game.installed ? "success" : "default"}
          />
          <KpiTile
            glass
            size="sm"
            label="Status"
            icon={
              <span
                className="status-dot"
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor:
                    PLAY_STATUS_DETAILS[game.playStatus || "backlog"].color,
                  boxShadow: `0 0 6px ${
                    PLAY_STATUS_DETAILS[game.playStatus || "backlog"].color
                  }`,
                }}
              />
            }
            value={
              <span className="game-hero__status-value">
                {PLAY_STATUS_DETAILS[game.playStatus || "backlog"].label}
              </span>
            }
            trailing={
              <GameStatusDropdown
                game={game}
                onChange={(status) => updateGame(game.id, { playStatus: status })}
              />
            }
            intent={
              game.playStatus === "playing"
                ? "success"
                : game.playStatus === "completed"
                  ? "info"
                  : game.playStatus === "on_hold"
                    ? "warning"
                    : game.playStatus === "abandoned"
                      ? "danger"
                      : "default"
            }
          />
        </div>
      </div>

      {/* Single row below the banner: logo/title (left) + meta
          (middle) + launch actions (right). No stacked blocks. */}
      <div className="game-hero__info-row">
        <div className="game-hero__title-block">
          {game.logoUrl ? (
            <img
              src={game.logoUrl}
              alt={game.name}
              className="game-hero-logo"
            />
          ) : (
            <h1 className="game-hero-title">{game.name}</h1>
          )}
        </div>
        <div className="game-hero-meta">
          <span className="game-hero-meta-item">
            <IconPlatform size={12} />
            {game.platform}
          </span>
          <span className="game-hero-meta-dot" />
          <span>Play time: {game.playTime}</span>
          <span className="game-hero-meta-dot" />
          <span>Added {addedDate}</span>
        </div>
        <div className="game-hero__actions">
          <GameLaunchActions game={game} onLaunch={onLaunch} size="sm" />
        </div>
      </div>
    </div>
  );
}
