import type { Game } from "../../types/game";
import { IconImage } from "./icons";
import { useBigScreen } from "../../context/BigScreenContext";
import { useFocusable } from "../../hooks/useFocusable";
import { useRef } from "react";

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
  const carouselRef = useRef<HTMLDivElement | null>(null);

  if (!game.screenshots || game.screenshots.length === 0) return null;

  // Scroll the strip by roughly one viewport of thumbnails. Disabled
  // state is derived from scroll position so the arrows hide when
  // there's nothing further to scroll.
  const scrollBy = (dir: 1 | -1) => {
    const el = carouselRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

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
      <div className="carousel-wrap">
        <button
          type="button"
          className="carousel-arrow carousel-arrow--prev"
          aria-label="Scroll screenshots left"
          onClick={() => scrollBy(-1)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="screenshots-carousel" ref={carouselRef}>
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
        <button
          type="button"
          className="carousel-arrow carousel-arrow--next"
          aria-label="Scroll screenshots right"
          onClick={() => scrollBy(1)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    </section>
  );
}
