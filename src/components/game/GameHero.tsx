import { useState } from "react";
import { KpiTile } from "../ui";
import { type Game, PLAY_STATUS_DETAILS } from "../../types/game";
import { useGames } from "../../context/GameContext";
import { useSteamAppId } from "../../hooks/useSteamAppId";
import { useGameAccent } from "../../hooks/useGameAccent";
import SteamPlayerCount from "../SteamPlayerCount";
import GameStatusDropdown from "./GameStatusDropdown";
import GameLaunchActions from "./GameLaunchActions";
import HeroTrailer from "../hero/HeroTrailer";
import FriendsPlayingStrip from "../hero/FriendsPlayingStrip";
import { IconClock, IconPlatform, IconShield, IconUsers } from "./icons";

/**
 * GameHero
 *
 *  The cinematic banner at the top of the Game page. Layout:
 *
 *  ┌──────────────────────────────────────────────────────────┐
 *  │  Cinematic banner (clamp 320–460px)                        │
 *  │   · ambient blur + optional muted trailer (big-screen)    │
 *  │   · floating 2:3 cover overlapping the bottom edge        │
 *  │   · glass KPI strip (bottom-right): Players / Time /      │
 *  │     Status / Rating / Time-to-beat / Achievements         │
 *  └──────────────────────────────────────────────────────────┘
 *  ┌──────────────────────────────────────────────────────────┐
 *  │ Logo / Title      Friends playing        ▶ Launch         │
 *  │ Steam · 20h 38m · 10 Jul                                │
 *  └──────────────────────────────────────────────────────────┘
 *
 *  The TopBar (`.game-top-bar`) above the hero in `GamePage.tsx`
 *  owns the Return-to-Library / Edit / Remove affordances.
 *
 *  Steam player count + achievement progress
 *  ───────────────────────────────────────────
 *  The "Players Now" tile is gated on `useSteamAppId`, which resolves
 *  `game.steamAppId` for non-Steam games. The "Achievements" tile is
 *  gated on `game.steamAchievements` (synced Steam data).
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
  const { appId: steamAppId } = useSteamAppId(game);
  const [bannerErrored, setBannerErrored] = useState(false);
  const gameAccent = useGameAccent(game.coverArtUrl || game.bannerUrl);

  const addedDate = new Date(game.addedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const trailerSrc = game.videos && game.videos.length ? game.videos[0] : null;
  const showCoverFallback = !game.bannerUrl && !game.coverArtUrl && !trailerSrc;
  const ambientSrc = game.bannerUrl || game.coverArtUrl || null;

  // Achievement progress (Steam-synced, if present).
  const achievements = game.steamAchievements;
  const achUnlocked = achievements?.filter((a) => a.achieved).length ?? 0;
  const achTotal = achievements?.length ?? 0;
  const achPercent = achTotal > 0 ? Math.round((achUnlocked / achTotal) * 100) : null;

  const statusKey = game.playStatus || "backlog";

  return (
    <div
      className="game-hero game-hero--cinematic"
      style={gameAccent ? ({ "--game-accent": gameAccent } as React.CSSProperties) : undefined}
    >
      <div className="game-hero__banner">
        {ambientSrc && (
          <div
            className="game-hero__ambient"
            style={{ backgroundImage: `url(${ambientSrc})` }}
            aria-hidden="true"
          />
        )}

        {/* Main banner visual: trailer when available, else the still
            banner image. Both carry the same poster art so the layout
            is stable whether or not a trailer is wired up. */}
        {trailerSrc ? (
          <HeroTrailer
            className="game-hero__trailer"
            src={trailerSrc}
            poster={game.bannerUrl || game.coverArtUrl}
          />
        ) : game.bannerUrl ? (
          <div
            className="game-banner-bg"
            style={{ backgroundImage: `url(${game.bannerUrl})` }}
          />
        ) : null}

        {!trailerSrc && !bannerErrored && (game.bannerUrl || game.coverArtUrl) ? (
          <img
            src={game.bannerUrl || game.coverArtUrl}
            alt={game.name}
            className="game-cover-img"
            onError={() => setBannerErrored(true)}
          />
        ) : !trailerSrc && showCoverFallback ? (
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

        {/* Floating cover (2:3) overlapping the banner's bottom edge. */}
        {game.coverArtUrl && !bannerErrored && (
          <div className="game-hero__cover" aria-hidden="true">
            <img src={game.coverArtUrl} alt="" className="game-hero__cover-img" />
          </div>
        )}

        {/* Glass KPI strip — the most-glanced stats right on the banner. */}
        <div className="game-hero__kpis">
          {steamAppId != null && (
            <KpiTile
              glass
              size="sm"
              label="Players Now"
              icon={<IconUsers size={12} />}
              value={<SteamPlayerCount appId={steamAppId} />}
              intent="accent"
            />
          )}
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
                  backgroundColor: PLAY_STATUS_DETAILS[statusKey].color,
                  boxShadow: `0 0 6px ${PLAY_STATUS_DETAILS[statusKey].color}`,
                }}
              />
            }
            value={
              <span className="game-hero__status-value">
                {PLAY_STATUS_DETAILS[statusKey].label}
              </span>
            }
            trailing={
              <GameStatusDropdown
                game={game}
                onChange={(status) => updateGame(game.id, { playStatus: status })}
              />
            }
            intent={
              statusKey === "playing"
                ? "success"
                : statusKey === "completed"
                  ? "info"
                  : statusKey === "on_hold"
                    ? "warning"
                    : statusKey === "abandoned"
                      ? "danger"
                      : "default"
            }
          />
          {achPercent != null && (
            <KpiTile
              glass
              size="sm"
              label="Achievements"
              icon={<IconShield size={12} />}
              value={`${achPercent}%`}
              subtext={`${achUnlocked}/${achTotal}`}
              intent={achPercent >= 100 ? "success" : "default"}
            />
          )}
        </div>
      </div>

      {/* Info row: logo/title (left) + friends (mid) + launch (right). */}
      <div className={`game-hero__info-row${game.coverArtUrl && !bannerErrored ? " game-hero__info-row--with-cover" : ""}`}>
        <div className="game-hero__title-block">
          {game.logoUrl ? (
            <img
              src={game.logoUrl}
              alt={game.name}
              className="game-hero-logo"
              width={300}
              height={90}
            />
          ) : (
            <h1 className="game-hero-title">{game.name}</h1>
          )}
          <FriendsPlayingStrip gameName={game.name} gameId={game.id} />
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
