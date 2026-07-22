import { useFriendsPlaying } from "../../hooks/useFriendsPlaying";
import { IconUsers } from "../game/icons";

/**
 * FriendsPlayingStrip
 *
 * Compact "friends in this game" affordance for the hero. Surfaces
 * friends whose live status names the game plus anyone in an active
 * session for it. Renders nothing when nobody is playing, so it can
 * be dropped into either hero without a guards at the call site.
 */

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export interface FriendsPlayingStripProps {
  gameName?: string;
  gameId?: string | number;
  /** Called when the session pill is clicked (e.g. open the session). */
  onOpenSession?: (sessionId: string) => void;
  className?: string;
}

export default function FriendsPlayingStrip({
  gameName,
  gameId,
  onOpenSession,
  className,
}: FriendsPlayingStripProps) {
  const { playingNow, sessions, avatars, count } = useFriendsPlaying(gameName, gameId);

  if (count === 0) return null;

  const showAvatars = avatars.slice(0, 4);
  const overflow = count - showAvatars.length;

  return (
    <div
      className={`friends-playing${className ? ` ${className}` : ""}`}
      title={`${count} friend${count === 1 ? "" : "s"} playing`}
    >
      <div className="friends-playing__avatars" aria-hidden="true">
        {showAvatars.map((a, i) =>
          a.src ? (
            <img
              key={i}
              className="friends-playing__avatar"
              src={a.src}
              alt=""
              style={{ zIndex: showAvatars.length - i }}
            />
          ) : (
            <span
              key={i}
              className="friends-playing__avatar friends-playing__avatar--initials"
              style={{ zIndex: showAvatars.length - i }}
            >
              {initials(a.name)}
            </span>
          )
        )}
        {overflow > 0 && (
          <span className="friends-playing__avatar friends-playing__avatar--more">
            +{overflow}
          </span>
        )}
      </div>

      <span className="friends-playing__label">
        <IconUsers size={12} />
        {playingNow.length > 0
          ? `${playingNow.length} playing now`
          : `${count} in this game`}
      </span>

      {sessions.length > 0 && onOpenSession && (
        <button
          type="button"
          className="friends-playing__session"
          onClick={() => onOpenSession(sessions[0].id)}
        >
          Join session
        </button>
      )}
    </div>
  );
}
