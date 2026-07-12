import { useEffect, useState } from "react";
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
  const { runningGameIds, forceCloseGame } = useGames();
  const { showToast } = useToast();
  const isRunning = runningGameIds.includes(game.id);
  // In-flight flag for the destructive action. Set when the user
  // clicks "Force Close" and held until the running indicator
  // clears (which happens via the `game-exited` event arriving on
  // the next render tick). Lets us:
  //   1. Disable the button so a frantic spam-click doesn't fire
  //      N parallel `force_close_game` IPCs that each try to grab
  //      the watcher mutex.
  //   2. Surface a "Closing…" status so the user has feedback the
  //      click registered before the underlying OS process dies.
  const [isClosing, setIsClosing] = useState(false);

  // Reset the in-flight flag once the running indicator has cleared.
  // Listening to `isRunning` (not the click) means we never race the
  //    game-exited event — if the kill fails outright and the watcher
  //    entry sticks around, the flag stays true and the button stays
  //    disabled, which is the safe fallback.
  useEffect(() => {
    if (!isRunning) {
      setIsClosing(false);
    }
  }, [isRunning]);

  function handleForceClose() {
    if (isRunning) {
      setIsClosing(true);
      forceCloseGame(game);
    }
  }

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
      {isRunning ? (
        // Running state — surfaces both a passive status pill and a
        // destructive action button. Splitting them keeps "Running…" as
        // pure informational feedback (still disabled + pulsing dot)
        // while the adjacent "Force Close" carries the click affordance.
        // The force-close action terminates the process and records the
        // session via the same `game-exited` path as a natural exit.
        <>
          <button className="game-launch-btn running" disabled>
            <span className="running-dot-pulse" />
            Running…
          </button>
          <button
            className="game-launch-btn game-launch-btn--force-close"
            onClick={handleForceClose}
            disabled={isClosing}
            title={isClosing ? `Closing ${game.name}…` : `Force close ${game.name}`}
            aria-label={`Force close ${game.name}`}
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="6" y="6" width="12" height="12" rx="1.5" />
            </svg>
            {isClosing ? "Closing…" : "Force Close"}
          </button>
        </>
      ) : (
        <button
          className="game-launch-btn"
          onClick={onLaunch}
        >
          <IconPlay size={16} />
          Launch Game
        </button>
      )}
      <DownloadButton
        gameName={game.name}
        gameId={game.id}
        steamAppId={game.steamAppId}
      />
    </div>
  );
}
