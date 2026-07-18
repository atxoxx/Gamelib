import type { Game } from "../../types/game";
import { IconImage } from "./icons";
import { useBigScreen } from "../../context/BigScreenContext";
import { useFocusable } from "../../hooks/useFocusable";

interface ScreenshotsSectionProps {
  game: Game;
  onOpen: (src: string) => void;
}

function BigScreenScreenshotItem({
  src,
  onOpen,
  index,
  name,
}: {
  src: string;
  onOpen: (src: string) => void;
  index: number;
  name: string;
}) {
  const focusProps = useFocusable(() => onOpen(src));
  return (
    <div
      className="screenshot-item"
      {...focusProps}
      aria-label={`Open screenshot ${index + 1}`}
    >
      <img
        src={src}
        alt={`${name} Screenshot ${index + 1}`}
        className="screenshot-img"
        loading="lazy"
      />
    </div>
  );
}

export default function ScreenshotsSection({
  game,
  onOpen,
}: ScreenshotsSectionProps) {
  const { isBigScreen } = useBigScreen();

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
        {game.screenshots.map((src, index) => {
          if (isBigScreen) {
            return (
              <BigScreenScreenshotItem
                key={index}
                src={src}
                index={index}
                name={game.name}
                onOpen={onOpen}
              />
            );
          }
          return (
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
          );
        })}
      </div>
    </section>
  );
}
