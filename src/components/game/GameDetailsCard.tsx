import type { Game } from "../../types/game";
import { IconFileText } from "./icons";

/**
 * GameDetailsCard
 *
 *  Main-column card with the "under the hood" file info. The
 *  executable path is the headline; clicking the copy button
 *  copies the absolute path to the clipboard so users can paste
 *  it into file managers / scripts / chat.
 *
 *  Renders nothing for games without a known path (e.g. some
 *  store-imported titles that don't ship the local exe).
 */

interface GameDetailsCardProps {
  game: Game;
}

export default function GameDetailsCard({ game }: GameDetailsCardProps) {
  if (!game.path) return null;

  function copyPath() {
    if (!game.path) return;
    navigator.clipboard
      .writeText(game.path)
      .catch((err) => console.warn("clipboard write failed", err));
  }

  return (
    <section className="game-section game-details-card">
      <h2 className="game-section-title">
        <span className="game-section-title__icon" aria-hidden>
          <IconFileText size={16} />
        </span>
        Details
      </h2>
      <div className="game-details-card__path">
        <span className="game-details-card__path-label">Executable Path</span>
        <code className="game-path" onClick={copyPath} title="Click to copy">
          {game.path}
        </code>
      </div>
    </section>
  );
}
