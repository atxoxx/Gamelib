import { openUrl } from "@tauri-apps/plugin-opener";
import { useToast } from "../../context/ToastContext";
import { useGames } from "../../context/GameContext";
import { IconDownload, IconPlay } from "./icons";
import DownloadButton from "../DownloadButton";
import type { Game } from "../../types/game";

/**
 * GameLaunchActions
 *
 *  The button cluster on the hero overlay:
 *   - "Install via Steam" (only when the game is a Steam title
 *     that isn't installed)
 *   - "Launch Game" (disabled + pulsing dot when running)
 *   - The shared DownloadButton (magnet / direct / debrid flow)
 *
 *  Owns no local state; reads `isRunning` from the GameContext and
 *  calls `launchGame` to start the process. Errors during the
 *  Steam install hand-off are surfaced through the toast context
 *  so the rest of the app doesn't have to know about it.
 */

interface GameLaunchActionsProps {
  game: Game;
  onLaunch: () => void;
  size?: "sm" | "md";
}

export default function GameLaunchActions({
  game,
  onLaunch,
  size = "md",
}: GameLaunchActionsProps) {
  const { runningGameIds } = useGames();
  const { showToast } = useToast();
  const isRunning = runningGameIds.includes(game.id);

  const showInstall =
    !game.installed && game.platform === "Steam" && game.steamAppId;

  function handleInstall() {
    if (!game.steamAppId) return;
    openUrl(`steam://install/${game.steamAppId}`).catch((err) =>
      showToast(`Failed to open Steam install: ${err}`, "error")
    );
  }

  return (
    <div className={`game-launch-actions game-launch-actions--${size}`}>
      {showInstall && (
        <button
          className="game-launch-btn game-launch-btn--install"
          onClick={handleInstall}
        >
          <IconDownload size={16} />
          Install via Steam
        </button>
      )}
      <button
        className={`game-launch-btn ${isRunning ? "running" : ""}`}
        onClick={onLaunch}
        disabled={isRunning}
      >
        {isRunning ? (
          <>
            <span className="running-dot-pulse" />
            Running…
          </>
        ) : (
          <>
            <IconPlay size={16} />
            Launch Game
          </>
        )}
      </button>
      <DownloadButton
        gameName={game.name}
        gameId={game.id}
        steamAppId={game.steamAppId}
      />
    </div>
  );
}
