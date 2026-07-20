import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { StoreGameSummary } from "../../types/game";
import SteamPlayerCount from "../SteamPlayerCount";

interface StoreHeroProps {
  /** Called when the user clicks "View" on a featured game. */
  onCardClick?: (game: StoreGameSummary) => void;
}

const HERO_ROTATE_MS = 6000;
const HERO_FETCH_LIMIT = 12;
const HERO_POOL_SIZE = 5; // preload a wider pool; rotate through it

/**
 * StoreHero: full-width auto-rotating banner of top trending IGDB games.
 *
 * Modernized Discover hero:
 * - Preloads a wider pool (up to 5) and cross-fades between slides.
 * - Pauses on hover/focus, and exposes explicit prev/next + dot controls.
 * - Full keyboard support (Left/Right/Enter/Space) for accessible nav.
 * - A thin progress bar visualizes the autoplay countdown.
 * - Respects `prefers-reduced-motion` (no auto-rotation, no progress sweep).
 * - Memoized so unrelated Store re-renders don't re-fetch the trending pool.
 */
function StoreHero({ onCardClick }: StoreHeroProps) {
  const navigate = useNavigate();

  const [pool, setPool] = useState<StoreGameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const results = await invoke<StoreGameSummary[]>("fetch_store_games", {
          category: "trending",
          offset: 0,
          limit: HERO_FETCH_LIMIT,
        });
        if (!cancelled) {
          const top = results
            .filter((g) => g.coverUrl)
            .slice(0, HERO_POOL_SIZE);
          setPool(top);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("StoreHero fetch failed:", err);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const reduceMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );

  // ── Auto-rotation + progress sweep ─────────────────────────────────
  useEffect(() => {
    if (paused || reduceMotion || pool.length <= 1) return;
    const start = performance.now();

    let raf = 0;
    const tick = (now: number) => {
      const elapsed = now - start;
      const pct = Math.min(100, (elapsed / HERO_ROTATE_MS) * 100);
      setProgress(pct);
      if (elapsed >= HERO_ROTATE_MS) {
        setActiveIdx((idx) => (idx + 1) % pool.length);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(raf);
  }, [paused, reduceMotion, pool.length, activeIdx]);

  const goTo = useCallback((idx: number) => {
    setActiveIdx(((idx % pool.length) + pool.length) % pool.length);
    setProgress(0);
  }, [pool.length]);

  const next = useCallback(() => goTo(activeIdx + 1), [goTo, activeIdx]);
  const prev = useCallback(() => goTo(activeIdx - 1), [goTo, activeIdx]);

  const active = pool[activeIdx];

  const pad2 = useCallback((n: number) => String(n).padStart(2, "0"), []);

  const steamAppId = useMemo(() => {
    if (!active?.websites) return undefined;
    for (const url of active.websites) {
      const match = url.match(/store\.steampowered\.com\/app\/(\d+)/i);
      if (match) {
        const id = parseInt(match[1], 10);
        if (Number.isFinite(id)) return id;
      }
    }
    return undefined;
  }, [active]);

  const year = useMemo(() => {
    if (!active?.firstReleaseDate) return null;
    const d = new Date(active.firstReleaseDate);
    return Number.isNaN(d.getTime()) ? null : d.getFullYear();
  }, [active]);

  const handleView = useCallback(() => {
    if (!active) return;
    if (onCardClick) onCardClick(active);
    else navigate(`/store/${active.slug}`);
  }, [active, onCardClick, navigate]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleView();
      }
    },
    [next, prev, handleView]
  );

  // ── Skeleton ───────────────────────────────────────────────────────
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

  if (!pool.length || !active) return null;

  const backdrop = active.coverUrl ?? "";

  return (
    <div
      className="store-hero"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="region"
      aria-roledescription="carousel"
      aria-label="Featured trending games"
    >
      <div
        className="store-hero-bg"
        style={{ backgroundImage: `url(${backdrop})` }}
        aria-hidden="true"
      />
      <div className="store-hero-veil" aria-hidden="true" />
      <div className="store-hero-shine" aria-hidden="true" />

      {/* Slide index — elegant "01 / 05" counter top-left */}
      {pool.length > 1 && (
        <div className="store-hero-index" aria-hidden="true">
          <span className="store-hero-index-current">{pad2(activeIdx + 1)}</span>
          <span className="store-hero-index-sep" />
          <span className="store-hero-index-total">{pad2(pool.length)}</span>
        </div>
      )}

      <div className="store-hero-player-count">
        <SteamPlayerCount appId={steamAppId} />
      </div>

      {active.coverUrl && (
        <div className="store-hero-poster" aria-hidden="true">
          <img
            key={active.id}
            className="store-hero-cover"
            src={active.coverUrl}
            alt={active.name}
            loading="lazy"
          />
        </div>
      )}

      <div className="store-hero-content">
        <span className="store-hero-eyebrow">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          Featured Today
        </span>

        <h1 className="store-hero-title">{active.name}</h1>

        {active.genres.length > 0 && (
          <div className="store-hero-tags">
            {active.genres.slice(0, 3).map((g) => (
              <span key={g} className="store-hero-tag">{g}</span>
            ))}
          </div>
        )}

        <div className="store-hero-meta">
          {year && <span>{year}</span>}
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

          <button type="button" className="store-hero-cta" onClick={handleView}>
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

      {/* Prev / Next controls */}
      {pool.length > 1 && (
        <>
          <button
            type="button"
            className="store-hero-nav store-hero-nav-prev"
            onClick={prev}
            aria-label="Previous featured game"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button
            type="button"
            className="store-hero-nav store-hero-nav-next"
            onClick={next}
            aria-label="Next featured game"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </>
      )}

      {/* Thin accent hairline at the very bottom edge */}
      <div className="store-hero-accent-line" aria-hidden="true" />

      {/* Autoplay progress bar */}
      {pool.length > 1 && !reduceMotion && (
        <div className="store-hero-progress" aria-hidden="true">
          <span
            className="store-hero-progress-bar"
            style={{ width: `${paused ? 0 : progress}%` }}
          />
        </div>
      )}

      {/* Dot indicators */}
      {pool.length > 1 && (
        <div className="store-hero-dots" role="tablist" aria-label="Featured games">
          {pool.map((g, i) => (
            <button
              key={g.id + "-" + i}
              type="button"
              role="tab"
              aria-selected={i === activeIdx}
              aria-label={`Show featured game ${i + 1}: ${g.name}`}
              className={`store-hero-dot${i === activeIdx ? " active" : ""}`}
              onClick={() => goTo(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(StoreHero);
