import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { StoreGameSummary } from "../../types/game";

interface HeroFeatureProps {
  /** Called when the user clicks "View" on a featured game. */
  onCardClick?: (game: StoreGameSummary) => void;
}

const HERO_ROTATE_MS = 6000;
const HERO_FETCH_LIMIT = 12;
const HERO_POOL_SIZE = 3; // pick the top 3 to rotate through

/**
 * HeroFeature: full-width banner that auto-rotates through the top 3 trending
 * IGDB games. Used at the top of the Discover landing.
 *
 * - Fetches 12 trending games on mount.
 * - Picks the top 3 by highest hype.
 * - Auto-advances every 6 s (pauses on hover).
 * - Click "View →" → navigates to /store/{slug}.
 *
 * If the trending list is empty, the component renders nothing.
 */
export default function HeroFeature({ onCardClick }: HeroFeatureProps) {
  const navigate = useNavigate();

  const [pool, setPool] = useState<StoreGameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  // ── Fetch trending top 12 once on mount ────────────────────────────
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const results = await invoke<StoreGameSummary[]>(
          "fetch_store_games",
          {
            category: "trending",
            offset: 0,
            limit: HERO_FETCH_LIMIT,
          }
        );

        if (!cancelled) {
          // Pick top 3 with covers for the rotation
          const top3 = results
            .filter((g) => g.coverUrl)
            .slice(0, HERO_POOL_SIZE);
          setPool(top3);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("HeroFeature fetch failed:", err);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // ── Auto-rotate every HERO_ROTATE_MS (paused on hover) ─────────────
  // Also respect prefers-reduced-motion: never auto-rotate, and self-stop
  // the interval mid-flight if the user flips the preference on while we
  // are rotating. CSS animations and skeletons are already gated by the
  // same media query in store-discover.css; this effect covers the
  // JS-driven rotation in both directions without listener/closure churn.
  useEffect(() => {
    if (paused || pool.length <= 1) return;

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) return;

    const id = window.setInterval(() => {
      // Self-stop if reduced-motion was enabled since the interval started
      // (e.g., user toggled OS settings mid-session).
      if (mq.matches) return;
      setActiveIdx((idx) => (idx + 1) % pool.length);
    }, HERO_ROTATE_MS);

    return () => window.clearInterval(id);
  }, [paused, pool.length]);

  const active = pool[activeIdx];

  const year = useMemo(() => {
    if (!active?.firstReleaseDate) return null;
    const d = new Date(active.firstReleaseDate);
    return Number.isNaN(d.getTime()) ? null : d.getFullYear();
  }, [active]);

  const handleView = useCallback(() => {
    if (!active) return;
    if (onCardClick) {
      onCardClick(active);
    } else {
      navigate(`/store/${active.slug}`);
    }
  }, [active, onCardClick, navigate]);

  // ── Skeleton while loading ─────────────────────────────────────────
  if (loading) {
    return (
      <div
        className="store-hero store-hero-loading"
        aria-busy="true"
        aria-label="Loading featured games"
      >
        <div className="store-hero-shimmer" />
        <div className="store-hero-content">
          <div className="store-hero-eyebrow store-hero-eyebrow-skeleton">
            <span className="store-hero-shimmer-line short" />
          </div>
          <div className="store-hero-shimmer-line title" />
          <div className="store-hero-shimmer-line subtitle" />
          <div className="store-hero-shimmer-line subtitle short" />
        </div>
      </div>
    );
  }

  if (!pool.length || !active) {
    return null;
  }

  const backdrop = active.coverUrl ?? "";

  return (
    <div
      className="store-hero"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      role="region"
      aria-label="Featured trending games"
    >
      {/* Backdrop image with blur + heavy darken */}
      <div
        className="store-hero-bg"
        style={{ backgroundImage: `url(${backdrop})` }}
        aria-hidden="true"
      />
      <div className="store-hero-veil" aria-hidden="true" />

      {/* Sharp foreground cover so the actual game art is visible.
          Sits on top of the blurred backdrop + veil; positioned absolute
          in the lower-right of the hero pane so the left-aligned text
          doesn't overlap.

          No `key={active.id}` here on purpose: keying would unmount and
          remount on every rotation tick, re-firing the cover-in
          animation. We want a calm in-place `<img src>` swap instead
          (cross-fade only on the backdrop, which is a CSS background). */}
      {active.coverUrl && (
        <img
          className="store-hero-cover"
          src={active.coverUrl}
          alt={active.name}
          loading="lazy"
        />
      )}

      <div className="store-hero-content">
        <span className="store-hero-eyebrow">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          Featured Today
        </span>

        <h1 className="store-hero-title">{active.name}</h1>

        <div className="store-hero-meta">
          {year && <span>{year}</span>}
          {active.genres.length > 0 && (
            <>
              <span className="store-hero-meta-dot" />
              <span>{active.genres.slice(0, 3).join(" · ")}</span>
            </>
          )}
          {active.platforms.length > 0 && (
            <>
              <span className="store-hero-meta-dot" />
              <span>{active.platforms.slice(0, 3).join(" · ")}</span>
            </>
          )}
        </div>

        <div className="store-hero-actions">
          {active.rating != null && (
            <span className="store-hero-rating">
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                width="14"
                height="14"
                aria-hidden="true"
              >
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              {Math.round(active.rating)}
            </span>
          )}

          <button
            type="button"
            className="store-hero-cta"
            onClick={handleView}
          >
            View {active.name}
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
        </div>
      </div>

      {/* Rotation dot indicators */}
      {pool.length > 1 && (
        <div className="store-hero-dots" aria-hidden="true">
          {pool.map((g, i) => (
            <button
              key={g.id + "-" + i}
              type="button"
              className={`store-hero-dot${i === activeIdx ? " active" : ""}`}
              aria-label={`Show featured game ${i + 1}: ${g.name}`}
              aria-pressed={i === activeIdx}
              onClick={() => setActiveIdx(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
