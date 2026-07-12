import { extractSteamAppId, type Game } from "../../types/game";
import { IconLink, IconUsers } from "./icons";

/**
 * RelatedContentCard
 *
 *  Main-column "Related Content" card. Renders the IGDB / metadata
 *  source link and (for Steam titles) a deep-link to the Steam
 *  Community Hub. The Steam appid is extracted from the game's
 *  path with a `steam://run/<id>` regex; titles without a parseable
 *  appid are skipped silently so the card never renders a broken
 *  link.
 */

interface RelatedContentCardProps {
  game: Game;
}

export default function RelatedContentCard({ game }: RelatedContentCardProps) {
  const steamAppId =
    typeof game.steamAppId === "number" ? game.steamAppId : extractSteamAppId(game.path);

  if (!game.metadataUrl && !game.metadataSource && !steamAppId) return null;

  return (
    <section className="game-section related-content-card">
      <h2 className="game-section-title">
        <span className="game-section-title__icon" aria-hidden>
          <IconLink size={16} />
        </span>
        Related Content
      </h2>
      <div className="related-content-links">
        {game.metadataUrl && (
          <a
            href={game.metadataUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="related-content-btn"
          >
            <IconLink size={14} />
            View on {game.metadataSource || "Metadata Provider"}
          </a>
        )}
        {steamAppId && (
          <a
            href={`https://steamcommunity.com/app/${steamAppId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="related-content-btn"
          >
            <IconUsers size={14} />
            Steam Community Hub
          </a>
        )}
      </div>
    </section>
  );
}
