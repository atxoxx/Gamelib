import type { ReactNode } from "react";
import type { Game } from "../../types/game";
import { IconLayers, IconImage, IconUser } from "./icons";

/**
 * SpecsCard
 *
 *  Right-sidebar card for the IGDB "Modes / Themes / Perspectives"
 *  metadata. Each section gets a small icon-prefixed header and a
 *  flex-wrap row of rounded "pill" tags. The pill design uses a
 *  subtle accent-tinted hover state so the tags feel interactive
 *  even when they're not clickable (a future iteration can wire
 *  them to library filters).
 *
 *  Sections are rendered in a fixed visual order; sections with
 *  no data are silently dropped so the card never has an empty
 *  "Modes:" label with nothing underneath.
 */

interface SpecsCardProps {
  game: Game;
}

interface SpecGroup {
  label: string;
  icon: ReactNode;
  values: string[] | undefined;
}

export default function SpecsCard({ game }: SpecsCardProps) {
  const groups: SpecGroup[] = [
    { label: "Modes", icon: <IconLayers size={12} />, values: game.gameModes },
    { label: "Themes", icon: <IconImage size={12} />, values: game.themes },
    {
      label: "Perspectives",
      icon: <IconUser size={12} />,
      values: game.playerPerspectives,
    },
  ];
  const hasAny = groups.some((g) => g.values && g.values.length > 0);
  if (!hasAny) return null;

  return (
    <section className="game-section specs-card">
      <h2 className="game-section-title">
        <span className="game-section-title__icon" aria-hidden>
          <IconLayers size={16} />
        </span>
        Game Specs
      </h2>

      <div className="specs-groups">
        {groups.map((g) => {
          if (!g.values || g.values.length === 0) return null;
          return (
            <div className="specs-group" key={g.label}>
              <span className="specs-group__label">
                <span className="specs-group__icon" aria-hidden>
                  {g.icon}
                </span>
                {g.label}
              </span>
              <div className="specs-group__pills">
                {g.values.map((v) => (
                  <span className="spec-pill" key={v}>
                    {v}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
