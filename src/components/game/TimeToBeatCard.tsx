import { KpiTile } from "../ui";
import type { Game } from "../../types/game";
import { IconClock, IconStar } from "./icons";
import { TimeToBeatRow } from "./shared";

/**
 * TimeToBeatCard
 *
 *  Right-sidebar card showing the IGDB-reported "time to beat"
 *  milestones. Renders as a 3-column row of small KPI tiles
 *  (Main / Completionist / Rushed) on top, with a per-row
 *  progress bar below each so the user can see at a glance how
 *  far their playtime has carried them.
 *
 *  The KPI tile surfaces the headline number (e.g. "12h"); the
 *  progress bar below visualizes the fraction of that target
 *  already played. Together they answer "how long is this game
 *  and how much of it have I done?" in a single glance.
 */

interface TimeToBeatCardProps {
  game: Game;
}

interface TierRow {
  label: "Main Story" | "Completionist" | "Rushed";
  seconds: number;
  intent: "default" | "accent" | "info";
  icon: typeof IconClock;
}

function formatHours(seconds: number): string {
  return `${Math.round(seconds / 3600)}h`;
}

export default function TimeToBeatCard({ game }: TimeToBeatCardProps) {
  const ttb = game.timeToBeat;
  if (!ttb) return null;
  const hasAny =
    (ttb.normally && ttb.normally > 0) ||
    (ttb.completely && ttb.completely > 0) ||
    (ttb.hastily && ttb.hastily > 0);
  if (!hasAny) return null;

  const tiers: TierRow[] = [];
  if (ttb.normally !== undefined && ttb.normally > 0) {
    tiers.push({
      label: "Main Story",
      seconds: ttb.normally,
      intent: "accent",
      icon: IconStar,
    });
  }
  if (ttb.completely !== undefined && ttb.completely > 0) {
    tiers.push({
      label: "Completionist",
      seconds: ttb.completely,
      intent: "info",
      icon: IconStar,
    });
  }
  if (ttb.hastily !== undefined && ttb.hastily > 0) {
    tiers.push({
      label: "Rushed",
      seconds: ttb.hastily,
      intent: "default",
      icon: IconClock,
    });
  }

  return (
    <section className="game-section time-to-beat-card">
      <h2 className="game-section-title">
        <span className="game-section-title__icon" aria-hidden>
          <IconClock size={16} />
        </span>
        Time to Beat
      </h2>

      <div className="ttb-kpi-grid">
        {tiers.map((t) => {
          const Icon = t.icon;
          return (
            <KpiTile
              key={t.label}
              size="sm"
              label={t.label}
              icon={<Icon size={12} />}
              value={formatHours(t.seconds)}
              intent={t.intent}
            />
          );
        })}
      </div>

      <div className="ttb-progress-list">
        {tiers.map((t) => (
          <TimeToBeatRow
            key={t.label}
            label={t.label}
            targetSeconds={t.seconds}
            currentPlayTime={game.playTime}
          />
        ))}
      </div>
    </section>
  );
}
