import { useContext, type MouseEvent } from "react";
import { useProgressiveImage } from "../../hooks/useProgressiveImages";
import { useCrackWatch } from "../../context/CrackWatchContext";
import { usePrice } from "../../context/PriceContext";
import { WishlistContext } from "../../context/WishlistContext";
import { DensityContext } from "../../context/DensityContext";
import type { StoreGameSummary, ViewDensity } from "../../types/game";

interface StoreGameCardProps {
  game: StoreGameSummary;
  onClick: (game: StoreGameSummary) => void;
  /**
   * Layout density override. When omitted, falls back to the user's
   * `DensityContext` preference, then to "cozy". `SnapRail` passes
   * `density="cozy"` explicitly so rail heights stay predictable
   * regardless of user choice.
   */
  density?: ViewDensity;
  /**
   * Whether the heart icon is filled. Props override the context lookup,
   * which is useful when a parent (e.g. `WishlistRail`) knows for certain
   * that every card in a list is wishlisted.
   */
  wishlisted?: boolean;
  /**
   * Heart click handler. When omitted, falls back to the
   * `WishlistContext` toggle — clicking the heart add/removes the game
   * without any extra plumbing at the call site.
   *
   * Click events stop propagation so they don't also fire `onClick`.
   */
  onToggleWishlist?: (game: StoreGameSummary, event: MouseEvent) => void;
  /** When true, render an "In Library" badge on the cover. */
  inLibrary?: boolean;
  /** When true, hide this game from the store ("Not Interested"). */
  onHide?: (game: StoreGameSummary, event: MouseEvent) => void;
  /** Add this game to the compare tray. */
  onCompare?: (game: StoreGameSummary, event: MouseEvent) => void;
  /** Bulk-select mode: render a selection checkbox and reflect state. */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (game: StoreGameSummary, event: MouseEvent) => void;
}

/** Rating badge colors — emerald for high, amber for mid, red for low. */
function ratingColor(score: number): string {
  if (score >= 75) return "#10b981";
  if (score >= 50) return "#f59e0b";
  return "#ef4444";
}

export default function StoreGameCard({
  game,
  onClick,
  density: densityProp,
  wishlisted: wishlistedProp,
  onToggleWishlist: onToggleWishlistProp,
  inLibrary = false,
  onHide,
  onCompare,
  selectable = false,
  selected = false,
  onToggleSelect,
}: StoreGameCardProps) {
  // Read defaults from context. Both can be null when the page hasn't
  // been wrapped in the provider (e.g. during isolated testing), so we
  // null-coalesce gracefully throughout.
  const wishlistCtx = useContext(WishlistContext);
  const densityCtx = useContext(DensityContext);

  // Resolve effective values: prop overrides context overrides default.
  const density: ViewDensity =
    densityProp ?? densityCtx?.density ?? "cozy";
  const wishlisted: boolean =
    wishlistedProp ?? wishlistCtx?.isWishlisted(game.slug) ?? false;

  // Resolve the heart handler. Prop wins; otherwise fall back to the
  // context's `toggle` (which is bidirectional: add if absent, remove if
  // present). The wrapper ignores the MouseEvent because the context
  // signature doesn't take one — that's fine for a click handler.
  const onToggleWishlist =
    onToggleWishlistProp ??
    (wishlistCtx
      ? (g: StoreGameSummary) => {
          wishlistCtx.toggle(g);
        }
      : undefined);

  // ── CrackWatch (batched via context — one round-trip per grid page) ────
  const crackStatus = useCrackWatch(game.name);

  // ── Price (batched via context — CheapShark cheapest deal) ─────────────
  const price = usePrice(game.name);

  const [coverUrl, imgRef] = useProgressiveImage(game.coverUrl);

  // Compact mode: cover-only. Cinematic mode: 1–3 genres shown.
  const showBody = density !== "compact";
  const genresToShow = density === "cinematic" ? 3 : 2;

  // Heart icon should render whenever a toggle path exists — either from
  // props or from the wishlist context.
  const showHeart = Boolean(onToggleWishlist);

  return (
    <div
      className={`store-game-card density-${density}${density === "list" ? " store-game-card-list" : ""}${selected ? " selected" : ""}`}
      onClick={(e) => {
        if (selectable && onToggleSelect) {
          onToggleSelect(game, e);
        } else {
          onClick(game);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (selectable && onToggleSelect) {
            onToggleSelect(game, e as unknown as MouseEvent);
          } else {
            onClick(game);
          }
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`${game.name}${game.rating != null ? `, rated ${Math.round(game.rating)} out of 100` : ""}${inLibrary ? ", in your library" : ""}`}
      data-density={density}
      data-wishlisted={wishlisted ? "true" : "false"}
    >
      <div className="store-card-cover">
        {selectable && (
          <span
            className={`store-card-select${selected ? " checked" : ""}`}
            aria-hidden="true"
          >
            {selected && (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </span>
        )}

        {coverUrl ? (
          <img ref={imgRef} src={coverUrl} alt={game.name} loading="lazy" />
        ) : (
          <div className="store-card-cover-skeleton">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              opacity={0.3}
            >
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
        )}

        {game.rating != null && (
          <span
            className="store-card-rating"
            style={{ background: ratingColor(game.rating) }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              width="10"
              height="10"
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            {Math.round(game.rating)}
          </span>
        )}

        {crackStatus && (
          <span
            className={`store-card-cw-badge${crackStatus.isCracked ? " cw-cracked" : " cw-uncracked"}`}
            title={crackStatus.isCracked ? "Cracked" : "Uncracked"}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              width="10"
              height="10"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            {crackStatus.isCracked ? "CRACKED" : "UNCRACKED"}
          </span>
        )}

        {inLibrary && (
          <span className="store-card-inlib" title="In your library">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              width="10"
              height="10"
              aria-hidden="true"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            In Library
          </span>
        )}

        {onHide && (
          <button
            type="button"
            className="store-card-hide"
            aria-label={`Hide ${game.name}`}
            title="Not interested"
            onClick={(e) => {
              e.stopPropagation();
              onHide(game, e);
            }}
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
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          </button>
        )}

        {onCompare && (
          <button
            type="button"
            className="store-card-compare"
            aria-label={`Add ${game.name} to compare`}
            title="Add to compare"
            onClick={(e) => {
              e.stopPropagation();
              onCompare(game, e);
            }}
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
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
            </svg>
          </button>
        )}

        {showHeart && (
          <button
            type="button"
            className={`store-card-heart${wishlisted ? " active" : ""}`}
            aria-label={
              wishlisted
                ? `Remove ${game.name} from wishlist`
                : `Add ${game.name} to wishlist`
            }
            aria-pressed={wishlisted}
            onClick={(e) => {
              // Prevent the outer card onClick from firing and navigating.
              e.stopPropagation();
              onToggleWishlist!(game, e);
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill={wishlisted ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
        )}
      </div>

      {showBody && (
        <div className="store-card-body">
          <h3 className="store-card-name" title={game.name}>
            {game.name}
          </h3>

          {(game.genres?.length ?? 0) > 0 && (
            <div className="store-card-genres">
              {game.genres.slice(0, genresToShow).map((g) => (
                <span key={g} className="store-card-genre">
                  {g}
                </span>
              ))}
            </div>
          )}

          <div className="store-card-platforms">
            {(game.platforms?.length ?? 0) > 0
              ? game.platforms.slice(0, 3).join(" · ")
              : game.firstReleaseDate
                ? new Date(game.firstReleaseDate).getFullYear()
                : ""}
          </div>

          {price && price.salePrice != null && (
            <div className="store-card-price">
              {price.isOnSale && price.discountPercent > 0 && (
                <span className="store-card-price-discount">
                  -{price.discountPercent}%
                </span>
              )}
              <span className="store-card-price-now">
                ${price.salePrice.toFixed(2)}
              </span>
              {price.isOnSale && price.normalPrice != null && (
                <span className="store-card-price-was">
                  ${price.normalPrice.toFixed(2)}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
