import { useRef, useEffect, useCallback } from "react";
import StoreGameCard from "./StoreGameCard";
import type { StoreGameSummary } from "../../types/game";

interface StoreGameGridProps {
  games: StoreGameSummary[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  onLoadMore: () => void;
  onCardClick: (game: StoreGameSummary) => void;
}

/** Card skeleton placeholder shown while the initial batch loads. */
function CardSkeleton() {
  return (
    <div className="store-game-card store-game-card-skeleton">
      <div className="store-card-cover">
        <div className="store-card-cover-skeleton" />
      </div>
      <div className="store-card-body">
        <div className="skeleton-line skeleton-title" />
        <div className="skeleton-line skeleton-subtitle" />
        <div className="skeleton-line skeleton-subtitle short" />
      </div>
    </div>
  );
}

export default function StoreGameGrid({
  games,
  loading,
  error,
  hasMore,
  onLoadMore,
  onCardClick,
}: StoreGameGridProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  // ── Infinite scroll: observe sentinel div ─────────────────────────────
  const handleIntersect = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0].isIntersecting && hasMore && !loading) {
        onLoadMore();
      }
    },
    [hasMore, loading, onLoadMore]
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(handleIntersect, {
      rootMargin: "300px",
    });
    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [handleIntersect]);

  // ── Error state ────────────────────────────────────────────────────────
  if (error && games.length === 0) {
    return (
      <div className="store-empty">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <h3>Failed to load games</h3>
        <p>{error}</p>
        <button className="store-retry-btn" onClick={onLoadMore}>
          Try Again
        </button>
      </div>
    );
  }

  // ── Empty state (after loading completes) ──────────────────────────────
  if (!loading && games.length === 0) {
    return (
      <div className="store-empty">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
        <h3>No games found</h3>
        <p>Try adjusting your search or browse a different category.</p>
      </div>
    );
  }

  // ── Initial loading (no games yet) — skeleton grid ────────────────────
  if (loading && games.length === 0) {
    return (
      <div className="store-game-grid">
        {Array.from({ length: 12 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    );
  }

  // ── Game grid ──────────────────────────────────────────────────────────
  return (
    <div className="store-game-grid">
      {games.map((game) => (
        <StoreGameCard key={game.id} game={game} onClick={onCardClick} />
      ))}

      {/* Sentinel div for infinite scroll */}
      <div ref={sentinelRef} className="store-sentinel" />

      {/* Loading more indicator */}
      {loading && games.length > 0 && (
        <div className="store-loading-more">
          <div className="store-spinner" />
          <span>Loading more games...</span>
        </div>
      )}

      {/* End-of-list message */}
      {!hasMore && games.length > 0 && (
        <p className="store-end-message">
          You've reached the end of the list.
        </p>
      )}
    </div>
  );
}
