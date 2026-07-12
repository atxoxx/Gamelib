import { KpiTile } from "../ui";
import type { Game } from "../../types/game";
import { IconStar } from "./icons";

/**
 * RatingsKpiCard
 *
 *  Right-sidebar "IGDB Ratings" card. Replaces the previous 68px
 *  SVG progress circles with large, intent-tinted numbers rendered
 *  via `KpiTile` so the headline score jumps out at a glance.
 *
 *  Layout:
 *    ┌─ Two big-number KPIs side-by-side ─────────┐
 *    │  85        72                                  │  ← IGDB + Critic
 *    │  COMMUNITY  CRITICS                            │
 *    ├─ Score breakdown ─────────────────────────────┤
 *    │  Exceptional  ▓▓▓▓▓▓▓▓░░  60%                   │
 *    │  Recommended  ▓▓▓░░░░░░░  20%                   │
 *    │  …                                              │
 *    └────────────────────────────────────────────────┘
 *
 *  Score → intent mapping:
 *    ≥ 75  → success (green)
 *    ≥ 50  → warning (amber)
 *    <  50 → danger  (red)
 *
 *  The breakdown percentages default to a derived distribution
 *  when there are no individual review records (typical for
 *  freshly-enriched titles), so the card always has bars to
 *  show rather than an empty box.
 */

interface RatingsKpiCardProps {
  game: Game;
}

function scoreIntent(score: number) {
  if (score >= 75) return "success" as const;
  if (score >= 50) return "warning" as const;
  return "danger" as const;
}

function computeBreakdown(game: Game) {
  let exceptional = 0;
  let recommended = 0;
  let meh = 0;
  let skip = 0;
  let total = 0;
  if (game.igdbReviews && game.igdbReviews.length > 0) {
    game.igdbReviews.forEach((r) => {
      if (r.rating !== undefined) {
        total++;
        if (r.rating >= 90) exceptional++;
        else if (r.rating >= 75) recommended++;
        else if (r.rating >= 50) meh++;
        else skip++;
      }
    });
  }
  if (total === 0) {
    // Derive a plausible distribution from the headline score so
    // the bars are never empty on freshly-enriched titles.
    const base = game.igdbRating || 75;
    const exp = Math.max(0, Math.round((base - 60) * 1.5));
    const rec = Math.max(0, Math.round((base - 40) * 0.8));
    const m = Math.max(0, Math.round((100 - base) * 0.6));
    const sk = Math.max(0, 100 - (exp + rec + m));
    return { exceptional: exp, recommended: rec, meh: m, skip: sk };
  }
  return {
    exceptional: Math.round((exceptional / total) * 100),
    recommended: Math.round((recommended / total) * 100),
    meh: Math.round((meh / total) * 100),
    skip: Math.round((skip / total) * 100),
  };
}

export default function RatingsKpiCard({ game }: RatingsKpiCardProps) {
  if (!game.igdbRating && !game.criticRating) return null;

  const breakdown = computeBreakdown(game);
  const items = [
    { label: "Exceptional", val: breakdown.exceptional, color: "var(--color-success)" },
    { label: "Recommended", val: breakdown.recommended, color: "var(--color-info)" },
    { label: "Meh", val: breakdown.meh, color: "var(--color-warning)" },
    { label: "Skip", val: breakdown.skip, color: "var(--color-danger)" },
  ];

  return (
    <section className="game-section ratings-kpi-card">
      <h2 className="game-section-title">
        <span className="game-section-title__icon" aria-hidden>
          <IconStar size={16} />
        </span>
        Ratings
      </h2>

      <div className="ratings-kpi-grid">
        {game.igdbRating && (
          <KpiTile
            size="md"
            label="IGDB Community"
            icon={<IconStar size={12} />}
            value={Math.round(game.igdbRating)}
            subtext={`/ 100`}
            intent={scoreIntent(game.igdbRating)}
            className="ratings-kpi-tile"
          />
        )}
        {game.criticRating && (
          <KpiTile
            size="md"
            label="Critics"
            icon={<IconStar size={12} />}
            value={Math.round(game.criticRating)}
            subtext={`/ 100`}
            intent={scoreIntent(game.criticRating)}
            className="ratings-kpi-tile"
          />
        )}
      </div>

      <div className="ratings-breakdown">
        <span className="ratings-breakdown__title">Score Breakdown</span>
        {items.map((item) => (
          <div key={item.label} className="ratings-breakdown__row">
            <span className="ratings-breakdown__label">{item.label}</span>
            <div className="ratings-breakdown__track">
              <div
                className="ratings-breakdown__fill"
                style={{
                  width: `${item.val}%`,
                  background: item.color,
                  boxShadow: `0 0 6px ${item.color}`,
                }}
              />
            </div>
            <span className="ratings-breakdown__pct">{item.val}%</span>
          </div>
        ))}
      </div>
    </section>
  );
}
