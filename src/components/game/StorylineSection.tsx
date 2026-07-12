import type { Game } from "../../types/game";
import { IconShield } from "./icons";

/**
 * StorylineSection
 *
 *  Main-column "Storyline" card. Renders the IGDB storyline as a
 *  styled blockquote with a left accent bar. The full quote is
 *  italicized and de-emphasized (muted color) so it reads as
 *  flavor text rather than primary content.
 */

interface StorylineSectionProps {
  game: Game;
}

export default function StorylineSection({ game }: StorylineSectionProps) {
  if (!game.storyline) return null;
  return (
    <section className="game-section storyline-section">
      <h2 className="game-section-title">
        <span className="game-section-title__icon" aria-hidden>
          <IconShield size={16} />
        </span>
        Storyline
      </h2>
      <blockquote className="storyline-quote">
        "{game.storyline}"
      </blockquote>
    </section>
  );
}
