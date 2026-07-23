import { Fragment, useState, type CSSProperties } from "react";
import { KpiTile } from "../ui";
import { type Game, PLAY_STATUS_DETAILS } from "../../types/game";
import { useGames } from "../../context/GameContext";
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
 *  Shared, presentational hero used by BOTH the Library game page and the
 *  Store detail page (normal / desktop mode — BigScreen has its own hero).
 *  Unifying the two through this one component keeps the banner, floating
 *  cover, glass KPI strip and info-row layout perfectly consistent.
 *
 *  Two usage modes:
 *   - Library game page: pass `game` (the full Game) — play time, status
 *     dropdown, achievements and the launch cluster are all derived from it.
 *   - Store detail page: pass explicit `name` / `coverUrl` / `bannerUrl` /
 *     `logoUrl` / `steamAppId` / `eyebrow` / `metaItems` / `actions`. The
 *     library-only KPIs simply don't render.
 */

interface GameHeroProps {
  /** Full library game — drives the Library game-page variant. */
  game?: Game;
  /** Launch handler (Library game page). */
  onLaunch?: () => void;

  /* ── Store / explicit overrides ────────────────────────────── */
  name?: string;
  coverUrl?: string | null;
  bannerUrl?: string | null;
  logoUrl?: string | null;
  videoUrl?: string | null;
  /** Source image for the per-game accent tint (defaults to cover/banner). */
  accentSrc?: string | null;
  /** Small label above the logo/title (e.g. "GameLib Store"). */
  eyebrow?: React.ReactNode;
  /** Resolved Steam app id for the "Players Now" KPI. */
  steamAppId?: number | null;
  /** Info-row meta fragments (Store). Library derives its own when omitted. */
  metaItems?: React.ReactNode[];
  /** Right-aligned action cluster (Store). Library uses <GameLaunchActions>. */
  actions?: React.ReactNode;
  /** Friends-playing strip target (defaults to the game when present). */
  friends?: { gameName: string; gameId: string } | null;
  /** Banner height profile. Defaults to "cinematic" for Library, "compact" for Store. */
  variant?: "cinematic" | "compact";
}

function formatHeroPlayTime(playTime: string): string {
  if (!playTime) return "0h";
  return playTime;
}

export default function GameHero({
  game,
  onLaunch,
  name: nameProp,
  coverUrl: coverProp,
  bannerUrl: bannerProp,
  logoUrl: logoProp,
  videoUrl: videoProp,
  accentSrc: accentProp,
  eyebrow,
  steamAppId: steamAppIdProp,
  metaItems,
  actions,
  friends: friendsProp,
  variant: variantProp,
}: GameHeroProps) {
  const { updateGame } = useGames();

  const isGame = !!game;
  const name = game?.name ?? nameProp ?? "";
  const coverUrl = game?.coverArtUrl ?? coverProp ?? null;
  const bannerUrl = game?.bannerUrl ?? bannerProp ?? null;
  const logoUrl = game?.logoUrl ?? logoProp ?? null;
  const videoUrl = game?.videos && game.videos.length ? game.videos[0] : videoProp ?? null;
  const accentSrc = accentProp ?? coverUrl ?? bannerUrl ?? null;
  const steamAppId = steamAppIdProp ?? null;

  const [bannerErrored, setBannerErrored] = useState(false);
  const [coverErrored, setCoverErrored] = useState(false);
  const [logoErrored, setLogoErrored] = useState(false);
  const gameAccent = useGameAccent(accentSrc || undefined);

  const addedDate = game
    ? new Date(game.addedAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  const ambientSrc = bannerUrl || coverUrl || null;

  // Achievement progress (Steam-synced, Library only).
  const achievements = game?.steamAchievements;
  const achUnlocked = achievements?.filter((a) => a.achieved).length ?? 0;
  const achTotal = achievements?.length ?? 0;
  const achPercent = achTotal > 0 ? Math.round((achUnlocked / achTotal) * 100) : null;

  const statusKey = game?.playStatus || "backlog";

  const variant = variantProp ?? (isGame ? "cinematic" : "compact");
  const heroClassName = [
    "game-hero",
    `game-hero--${variant}`,
    isGame ? "" : "game-hero--store",
  ]
    .filter(Boolean)
    .join(" ");

  const showCover = !!coverUrl && !coverErrored;
  const friends = friendsProp ?? (isGame ? { gameName: game.name, gameId: game.id } : null);

  // ── Info-row meta ────────────────────────────────────────────
  const metaRow = isGame ? (
    <>
      <span className="game-hero-meta-item">
        <IconPlatform size={12} />
        {game!.platform}
      </span>
      <span className="game-hero-meta-dot" />
      <span>Play time: {game!.playTime}</span>
      {addedDate && (
        <>
          <span className="game-hero-meta-dot" />
          <span>Added {addedDate}</span>
        </>
      )}
    </>
  ) : (
    (metaItems ?? []).map((item, i) => (
      <Fragment key={i}>
        <span className="game-hero-meta-item">{item}</span>
        {i < (metaItems?.length ?? 0) - 1 && <span className="game-hero-meta-dot" />}
      </Fragment>
    ))
  );

  return (
    <div
      className={heroClassName}
      style={gameAccent ? ({ "--game-accent": gameAccent } as CSSProperties) : undefined}
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
        {videoUrl ? (
          <HeroTrailer
            className="game-hero__trailer"
            src={videoUrl}
            poster={bannerUrl || coverUrl || undefined}
          />
        ) : bannerUrl && !bannerErrored ? (
          <img
            src={bannerUrl}
            alt={name}
            className="game-cover-img"
            onError={() => setBannerErrored(true)}
          />
        ) : coverUrl && !bannerErrored ? (
          <img
            src={coverUrl}
            alt={name}
            className="game-cover-img"
            onError={() => setBannerErrored(true)}
          />
        ) : (
          <svg
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            opacity={0.2}
            aria-hidden="true"
          >
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        )}

        {/* Floating cover (2:3) overlapping the banner's bottom edge. */}
        {showCover && (
          <div className="game-hero__cover" aria-hidden="true">
            <img
              src={coverUrl!}
              alt=""
              className="game-hero__cover-img"
              onError={() => setCoverErrored(true)}
            />
          </div>
        )}

        {/* Glass KPI strip — the most-glanced stats right on the banner.
            Each tile is gated on data availability so the Store hero shows
            only "Players Now" while the Library hero shows the full set. */}
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
          {isGame && (
            <KpiTile
              glass
              size="sm"
              label="Play Time"
              icon={<IconClock size={12} />}
              value={formatHeroPlayTime(game!.playTime)}
              subtext={game!.installed ? "Installed" : "Not installed"}
              intent={game!.installed ? "success" : "default"}
            />
          )}
          {isGame && (
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
                  game={game!}
                  onChange={(status) => updateGame(game!.id, { playStatus: status })}
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
          )}
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

      {/* Info row: eyebrow + logo/title (left) + meta (mid) + actions (right). */}
      <div className={`game-hero__info-row${showCover ? " game-hero__info-row--with-cover" : ""}`}>
        <div className="game-hero__title-block">
          {eyebrow && <span className="game-hero__eyebrow">{eyebrow}</span>}
          {logoUrl && !logoErrored ? (
            <img
              src={logoUrl}
              alt={name}
              className="game-hero-logo"
              onError={() => setLogoErrored(true)}
            />
          ) : (
            <h1 className="game-hero-title">{name}</h1>
          )}
          {friends && (
            <FriendsPlayingStrip gameName={friends.gameName} gameId={friends.gameId} />
          )}
        </div>
        <div className="game-hero-meta">{metaRow}</div>
        <div className="game-hero__actions">
          {actions ??
            (isGame ? <GameLaunchActions game={game!} onLaunch={onLaunch!} size="sm" /> : null)}
        </div>
      </div>
    </div>
  );
}
