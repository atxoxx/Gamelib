import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { StoreGameSummary, StoreCategory } from "../../types/game";
import StoreGameCard from "./StoreGameCard";

// Module-level in-flight cache for `fetch_store_games` calls keyed by
// `${category}:${limit}`. React 18 StrictMode runs each effect's mount
// phase twice in development, so without this dedup the 5 Discover rails
// would issue 10 simultaneous backend calls (one per strictmount +
// real mount). Sharing the Promise means both effects render the same
// result from a single backend round-trip, which keeps the IGDB permit
// semaphore from starving under the strict-mount burst (8-permit cap ×
// 10 simultaneous = 2 calls forced into the cumulative-sleep queue).
const inflightStoreFetches = new Map<string, Promise<StoreGameSummary[]>>();

interface SnapRailProps {
  /** Display heading (e.g. "Trending", "Coming Soon"). */
  title: string;
  /** IGDB category to fetch — passed to `fetch_store_games`. */
  category: StoreCategory;
  /** Number of games to load (default 12). */
  limit?: number;
  /** Called when a game card is clicked. */
  onCardClick: (game: StoreGameSummary) => void;
  /** Called when the user clicks the "See all →" link. */
  onSeeAll: (category: StoreCategory) => void;
  /** Optional accent emoji shown next to the title. */
  badge?: string;
}

/**
 * SnapRail: a horizontal scroller that shows a slice of games from a
 * single IGDB category. Reused across the Discover landing for Trending,
 * Popular, Top, Coming Soon, and New Releases rails.
 *
 * - Fetches games on mount via the existing `fetch_store_games` Tauri
 *   command and renders them as `StoreGameCard`s.
 * - Loading state shows 6 skeleton cards.
 * - Empty state hides the entire rail.
 * - Pointer-driven horizontal scrolling (matches web store conventions).
 */
export default function SnapRail({
  title,
  category,
  limit = 12,
  onCardClick,
  onSeeAll,
  badge,
}: SnapRailProps) {
  const [games, setGames] = useState<StoreGameSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  // ── Fetch on mount and when category changes ───────────────────────
  // React StrictMode fires this useEffect twice in dev mode. The dedup
  // cache at module scope (above the component) makes the second copy
  // `await` the first's Promise instead of issuing a duplicate invoke,
  // so backend load doesn't double per rail.
  useEffect(() => {
    let cancelled = false;
    const cacheKey = `${category}:${limit}`;
    (async () => {
      try {
        let pending = inflightStoreFetches.get(cacheKey);
        if (!pending) {
          pending = invoke<StoreGameSummary[]>(
            "fetch_store_games",
            {
              category,
              offset: 0,
              limit,
            }
          ).finally(() => {
            inflightStoreFetches.delete(cacheKey);
          });
          inflightStoreFetches.set(cacheKey, pending);
        }
        const results = await pending;
        if (!cancelled) {
          setGames(results);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
          setGames([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [category, limit]);

  // ── Pointer-driven horizontal scroll (mouse-wheel h-scroll) ────────
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      // Only hijack when the user is scrolling vertically with a horizontal
      // intent (deltaY dominant). Also skip if Trackpad horizontal scroll
      // (deltaX is significant).
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      // Don't hijack if the user is already at the rail edges
      if (
        (el.scrollLeft <= 0 && e.deltaY < 0) ||
        (el.scrollLeft >= el.scrollWidth - el.clientWidth - 1 && e.deltaY > 0)
      ) {
        return;
      }
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ── Render rail state (loading skeleton / error banner / empty / list)
  //
  // Previously this branch silently returned `null` on either an errored-out
  // fetch OR a legitimately empty result. That made IGDB / Twitch token
  // failures completely invisible to the user: every SnapRail just
  // disappeared from the Discover landing and the user was left staring at
  // what looked like a fully-rendered page with no rails and no obvious
  // signal that anything was wrong. Show the error inline instead so the
  // problem is at least visible during debugging.
  if (games !== null && games.length === 0) {
    if (error) {
      return (
        <section
          className="store-rail store-rail-error"
          aria-label={`${title} rail (error)`}
        >
          <header className="store-rail-header">
            <h3 className="store-rail-title">
              {badge && <span className="store-rail-badge">{badge}</span>}
              {title}
            </h3>
          </header>
          <p
            className="store-rail-error-message"
            style={{
              padding: "0.75rem 1rem",
              margin: "0.5rem 0",
              borderRadius: "var(--radius-md, 6px)",
              background: "rgba(220, 50, 50, 0.12)",
              border: "1px solid rgba(220, 50, 50, 0.35)",
              fontSize: "0.85rem",
              fontFamily: "var(--font-mono, monospace)",
              color: "var(--text-error, #fca5a5)",
              wordBreak: "break-word",
            }}
          >
            ⚠️ Failed to load:{" "}
            {error.length > 240 ? error.slice(0, 240) + "…" : error}
          </p>
        </section>
      );
    }
    return null;
  }

  return (
    <section className="store-rail" aria-label={`${title} rail`}>
      <header className="store-rail-header">
        <h3 className="store-rail-title">
          {badge && <span className="store-rail-badge">{badge}</span>}
          {title}
        </h3>

        <button
          type="button"
          className="store-rail-see-all"
          onClick={() => onSeeAll(category)}
          aria-label={`See all ${title}`}
        >
          See all
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </header>

      <div ref={trackRef} className="store-rail-track">
        {games === null && !error
          ? Array.from({ length: 6 }).map((_, i) => (
              <div
                key={"skel-" + i}
                className="store-rail-card-skeleton"
                aria-hidden="true"
              >
                <div className="store-rail-shimmer" />
              </div>
            ))
          : games?.map((game) => (
              <div key={game.id} className="store-rail-card-snap">
                {/* SnapRail forces density=\"cozy\" so rail heights stay
                    predictable regardless of user's density setting. */}
                <StoreGameCard
                  game={game}
                  onClick={onCardClick}
                  density="cozy"
                />
              </div>
            ))}
      </div>
    </section>
  );
}
