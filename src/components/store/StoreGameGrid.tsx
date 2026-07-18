import { useRef, useEffect, useCallback, useContext } from "react";
import StoreGameCard from "./StoreGameCard";
import { Button } from "../ui";
import { DensityContext } from "../../context/DensityContext";
import type { StoreGameSummary } from "../../types/game";

interface StoreGameGridProps {
  games: StoreGameSummary[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  onLoadMore: () => void;
  onCardClick: (game: StoreGameSummary) => void;
  /**
   * True when the user has enabled the per-source download filter.
   * Used to swap the generic empty-state copy for a source-filter-
   * specific message ("No games match your selected sources") so the
   * cause of an empty result is obvious.
   */
  isSourceFilterActive?: boolean;
  /**
   * True while at least one (game, source) availability check is
   * still in flight. Drives the "checking…" subtitle on the source-
   * filter empty state so users know the list may grow.
   */
  isSourceCheckPending?: boolean;
}

/** Card skeleton placeholder shown while the initial batch loads. */
function CardSkeleton({ list = false }: { list?: boolean }) {
  return (
    <div className={`store-game-card store-game-card-skeleton${list ? " store-game-card-list" : ""}`}>
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
  isSourceFilterActive = false,
  isSourceCheckPending = false,
}: StoreGameGridProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const density = useContext(DensityContext)?.density ?? "cozy";
  const isList = density === "list";

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
        <Button variant="secondary" size="sm" onClick={onLoadMore}>
          Try Again
        </Button>
      </div>
    );
  }

  // ── Empty state (after loading completes) ──────────────────────────────
  // Distinguish the source-filter empty state from the generic one so
  // the cause of an empty result is self-explanatory — users otherwise
  // wonder whether they broke the search, hit a rate limit, or whether
  // the source filter is just being strict.
  if (!loading && games.length === 0) {
    if (isSourceFilterActive) {
      return (
        <div className="store-empty">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <h3>No games match your selected sources</h3>
          <p>
            {isSourceCheckPending
              ? "Still checking the rest of the page — listing may grow in a moment."
              : "Try removing a source from the sidebar — the filter uses a strict AND-intersection, so a game must appear in every checked source to be shown."}
          </p>
        </div>
      );
    }
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
      <div className={`store-game-grid${isList ? " density-list" : ""}`}>
        {Array.from({ length: 12 }).map((_, i) => (
          <CardSkeleton key={i} list={isList} />
        ))}
      </div>
    );
  }

  // ── Game grid ──────────────────────────────────────────────────────────
  return (
    <div className={`store-game-grid${isList ? " density-list" : ""}`}>
      {games.map((game, i) => (
        <div
          key={game.id}
          className="store-game-cell"
          style={{ animationDelay: `${Math.min(i, 24) * 28}ms` }}
        >
          <StoreGameCard game={game} onClick={onCardClick} />
        </div>
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
