import type { StoreGameSummary, WishlistEntry } from "../../types/game";
import StoreGameCard from "./StoreGameCard";

interface WishlistRailProps {
  wishlist: WishlistEntry[];
  onCardClick: (game: StoreGameSummary) => void;
  /**
   * Optional CTA invoked when the user clicks "Browse trending games"
   * inside the empty-state placeholder. Typically wired to
   * `handleSeeAll("trending")` from `StorePage` so the empty wishlist
   * rail still gives the user a path forward.
   */
  onBrowseTrending?: () => void;
}

/**
 * WishlistRail: horizontal rail of wishlisted games. Reads from the cached
 * `useWishlist` data — no IGDB fetch required. Each card exposes a heart
 * button so the user can remove items straight from the rail (the
 * underlying toggle is supplied by the surrounding `WishlistProvider`).
 *
 * When the wishlist is empty we render a prominent placeholder with a
 * "Browse trending games" CTA so the feature stays discoverable from
 * the Discover landing and users have a clear next action.
 */
export default function WishlistRail({
  wishlist,
  onCardClick,
  onBrowseTrending,
}: WishlistRailProps) {
  const isEmpty = !wishlist || wishlist.length === 0;

  return (
    <section className="store-rail" aria-label="Your wishlist">
      <header className="store-rail-header">
        <h3 className="store-rail-title">
          <span className="store-rail-badge" aria-hidden="true">
            ❤️
          </span>
          Your Wishlist
          <span className="store-rail-count">
            {isEmpty ? "Empty" : `${wishlist.length} game${wishlist.length !== 1 ? "s" : ""}`}
          </span>
        </h3>
      </header>

      {isEmpty ? (
        <div
          className="store-rail-empty-state"
          role="status"
          aria-live="polite"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
          <div className="store-rail-empty-content">
            <strong>Your wishlist is empty</strong>
            <p>
              Tap the heart on any game to save it here. Wishlisted games
              are stored locally on your device.
            </p>
            {onBrowseTrending && (
              <button
                type="button"
                className="store-rail-empty-cta"
                onClick={onBrowseTrending}
              >
                Browse trending games
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="store-rail-track">
          {wishlist.map((entry) => (
            <div key={entry.slug} className="store-rail-card-snap">
              <StoreGameCard
                game={entry}
                density="cozy"
                wishlisted
                onClick={onCardClick}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
