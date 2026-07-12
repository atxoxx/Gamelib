import type { Game } from "../../types/game";
import { IconImage } from "./icons";

/**
 * ScreenshotsSection
 *
 *  Main-column screenshots carousel. Renders a horizontally
 *  scrolling strip of fixed-size cards; clicking one opens the
 *  lightbox (managed by the parent). Uses a thin scrollbar so
 *  the strip doesn't visually compete with the screenshots
 *  themselves.
 */

interface ScreenshotsSectionProps {
  game: Game;
  onOpen: (src: string) => void;
}

export default function ScreenshotsSection({
  game,
  onOpen,
}: ScreenshotsSectionProps) {
  if (!game.screenshots || game.screenshots.length === 0) return null;
  return (
    <section className="game-section screenshots-section">
      <h2 className="game-section-title">
        <span className="game-section-title__icon" aria-hidden>
          <IconImage size={16} />
        </span>
        Screenshots
        <span className="game-section-title__count">
          {game.screenshots.length}
        </span>
      </h2>
      <div className="screenshots-carousel">
        {game.screenshots.map((src, index) => (
          <div
            key={index}
            className="screenshot-item"
            onClick={() => onOpen(src)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen(src);
              }
            }}
            aria-label={`Open screenshot ${index + 1}`}
          >
            <img
              src={src}
              alt={`${game.name} Screenshot ${index + 1}`}
              className="screenshot-img"
              loading="lazy"
            />
          </div>
        ))}
      </div>
    </section>
  );
}
