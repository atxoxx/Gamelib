import { useEffect } from "react";
import type { StoreGameSummary } from "../../types/game";

interface StoreCompareModalProps {
  games: StoreGameSummary[];
  onClose: () => void;
  onOpenGame: (game: StoreGameSummary) => void;
}

function releaseYear(g: StoreGameSummary): string {
  return g.firstReleaseDate
    ? String(new Date(g.firstReleaseDate).getFullYear())
    : "—";
}

/**
 * StoreCompareModal: side-by-side comparison of 2–3 pinned store games.
 * Shows cover, rating, release, genres, and platforms in aligned rows so
 * users can weigh titles without hopping between detail pages.
 */
export default function StoreCompareModal({
  games,
  onClose,
  onOpenGame,
}: StoreCompareModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows: { label: string; render: (g: StoreGameSummary) => string }[] = [
    { label: "Rating", render: (g) => (g.rating != null ? `${Math.round(g.rating)}/100` : "—") },
    {
      label: "Critics",
      render: (g) => (g.aggregatedRating != null ? `${Math.round(g.aggregatedRating)}/100` : "—"),
    },
    { label: "Released", render: releaseYear },
    { label: "Genres", render: (g) => (g.genres?.length ? g.genres.join(", ") : "—") },
    { label: "Platforms", render: (g) => (g.platforms?.length ? g.platforms.join(", ") : "—") },
    { label: "Ratings count", render: (g) => String(g.totalRatingCount ?? 0) },
  ];

  return (
    <div className="store-compare-modal-scrim" onClick={onClose}>
      <div
        className="store-compare-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Compare games"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="store-compare-modal-header">
          <h2>Compare</h2>
          <button
            type="button"
            className="store-compare-modal-close"
            onClick={onClose}
            aria-label="Close comparison"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div
          className="store-compare-grid"
          style={{ gridTemplateColumns: `120px repeat(${games.length}, 1fr)` }}
        >
          <div className="store-compare-corner" />
          {games.map((g) => (
            <div key={g.slug} className="store-compare-col-head">
              {g.coverUrl && (
                <img src={g.coverUrl} alt="" className="store-compare-col-cover" />
              )}
              <button
                type="button"
                className="store-compare-col-name"
                onClick={() => onOpenGame(g)}
              >
                {g.name}
              </button>
            </div>
          ))}

          {rows.map((row) => (
            <div key={row.label} className="store-compare-row-contents">
              <div className="store-compare-row-label">{row.label}</div>
              {games.map((g) => (
                <div key={g.slug + row.label} className="store-compare-cell">
                  {row.render(g)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
