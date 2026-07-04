import { useNavigate } from "react-router-dom";
import StoreGameCard from "../components/store/StoreGameCard";
import { useWishlistContext } from "../context/WishlistContext";
import type { StoreGameSummary } from "../types/game";

/**
 * WishlistPage: dedicated tab mounted at `/wishlist` (between Library and
 * Activity in TopNav). Reads its state from the lifted `WishlistProvider`
 * that wraps `<Routes>` in `App.tsx`, so the same wishlist state tree is
 * shared with `StorePage`'s cards. Users can:
 *
 *   - See all wishlisted games in a grid.
 *   - Toggle hearts to remove items directly from this page.
 *   - Empty state offers a path back to the Store browse if list is empty.
 *
 * Density is read from `DensityContext` (also lifted), so toggling the
 * density in the Store page updates this page automatically.
 */
export default function WishlistPage() {
  const navigate = useNavigate();
  const { wishlist, hydrated, toggle } = useWishlistContext();

  const handleCardClick = (game: StoreGameSummary) => {
    navigate(`/store/${game.slug}`);
  };

  const handleBrowseStore = () => {
    navigate("/store");
  };

  return (
    <div className="wishlist-page">
      <header className="wishlist-page-header">
        <div className="wishlist-page-title-row">
          <span className="wishlist-page-icon" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </span>
          <h1 className="wishlist-page-title">Your Wishlist</h1>
          <span className="wishlist-page-count">
            {wishlist.length === 0
              ? "Empty"
              : `${wishlist.length} game${wishlist.length !== 1 ? "s" : ""}`}
          </span>
        </div>
        <p className="wishlist-page-subtitle">
          Games you've saved to revisit later. Tap the heart on any card to
          remove it. Wishlist data is stored locally on your device.
        </p>
      </header>

      {wishlist.length === 0 ? (
        <div className="wishlist-empty" role="status" aria-live="polite">
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
          {hydrated ? (
            <>
              <strong>No games in your wishlist yet</strong>
              <p>
                Tap the heart on any game in the Store to add it here. We'll
                keep it safe on this device.
              </p>
              <button
                type="button"
                className="wishlist-empty-cta"
                onClick={handleBrowseStore}
              >
                Browse the Store
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
            </>
          ) : (
            <p>Loading your wishlist…</p>
          )}
        </div>
      ) : (
        <div className="wishlist-page-grid">
          {wishlist.map((entry) => (
            <StoreGameCard
              key={entry.slug}
              game={entry}
              wishlisted
              onClick={handleCardClick}
              onToggleWishlist={(game) => toggle(game)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
