import type { Game } from "../../types/game";
import { IconFileText, IconLink } from "./icons";

/**
 * AboutSection
 *
 *  Main-column "About" card. Renders the IGDB description with
 *  an optional "View on {metadataSource}" link at the bottom
 *  that deep-links to the IGDB/Steam page the data was sourced
 *  from. Renders nothing when there's no description so the
 *  overview doesn't have an empty card with just a title.
 */

interface AboutSectionProps {
  game: Game;
}

export default function AboutSection({ game }: AboutSectionProps) {
  if (!game.description) return null;
  return (
    <section className="game-section about-section">
      <h2 className="game-section-title">
        <span className="game-section-title__icon" aria-hidden>
          <IconFileText size={16} />
        </span>
        About
      </h2>
      <p className="game-description about-section__text">{game.description}</p>
      {game.metadataSource && game.metadataUrl && (
        <a
          className="metadata-source-link"
          href={game.metadataUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <IconLink size={14} />
          View on {game.metadataSource}
        </a>
      )}
    </section>
  );
}
