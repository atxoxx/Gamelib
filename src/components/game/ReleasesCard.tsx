import type { Game } from "../../types/game";
import { IconCalendar } from "./icons";

/**
 * ReleasesCard
 *
 *  Right-sidebar card for the IGDB release list. Each entry is a
 *  single row: platform on the left (strong), date + region on
 *  the right (muted). Scrollable when there are many entries so
 *  long lists don't blow the page out.
 *
 *  Only the entries with a non-empty `platform` are rendered.
 *  Mirrors the original behavior where releases are parsed from
 *  "platform | date | region" lines and can be partial.
 */

interface ReleasesCardProps {
  game: Game;
}

export default function ReleasesCard({ game }: ReleasesCardProps) {
  if (!game.releases || game.releases.length === 0) return null;

  return (
    <section className="game-section releases-card">
      <h2 className="game-section-title">
        <span className="game-section-title__icon" aria-hidden>
          <IconCalendar size={16} />
        </span>
        Releases
        <span className="game-section-title__count">
          {game.releases.length}
        </span>
      </h2>

      <div className="releases-list">
        {game.releases.map((rel, idx) => (
          <div className="releases-row" key={`${rel.platform}-${idx}`}>
            <span className="releases-row__platform">{rel.platform}</span>
            <span className="releases-row__meta">
              {rel.dateStr}
              {rel.region ? (
                <span className="releases-row__region"> · {rel.region}</span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
