// BigScreenHeroBackground — PS5-style auto-cycling parallax
// background for BigScreenGamePage's hero.
//
//   ┌─────────────────────────────────────────────────────┐
//   │   ◀ back                                            │
//   │                                                     │
//   │      [BG slide A]      ← cross-fade ↔   [BG slide B]│
//   │                                                     │
//   │   [Logo + subtitle]              [▶ Play] [Trailer] │
//   └─────────────────────────────────────────────────────┘
//
// Decision ladder (in order):
//   1. videos[0] present → muted-autoplay video as the bg layer.
//   2. screenshots.length >= 2 AND motion allowed → Ken-Burns
//      parallax cycle with cross-fade between two stacked slides.
//   3. screenshots.length === 1 → render that one shot statically
//      (still get a slow Ken-Burns scale if motion is allowed —
//      single image, no cross-fade needed).
//   4. bannerUrl present → static banner.
//   5. coverArtUrl present → static cover.
//   6. otherwise → empty (parent's gradient `bg-tertiary` shows).
//
// prefers-reduced-motion
// ──────────────────────
// Cycle is disabled; renders the first screenshot (or banner /
// cover) statically with NO transform. CSS also gates the keyframe
// animations with the matching media query as a belt-and-suspenders
// guard against the JS side racing.
//
// Performance
// ────────────
// Each slide is a real `<img>` mounted in the DOM with
// `loading="lazy"` so the browser preloads the next slide naturally
// as soon as React unmounts the previous one. No `<link rel="prefetch">`
// needed. Both slides live in the DOM during the cross-fade so the
// target image is already decoded + painted before opacity flips,
// preventing a one-frame FOUC.
//
// Pause-on-focus (deferred)
// ─────────────────────────
// Cycle runs continuously. We considered pausing on `data-focused`
// inside the hero-actions row to give the player time to read the
// hero before the BG flips, but the cycle interval (14s) is long
// enough that it never feels rushed. If feedback proves otherwise,
// add a `paused` prop and have the parent bubble focus state.

import { useEffect, useMemo, useState } from "react";

interface BigScreenHeroBackgroundProps {
  bannerUrl?: string;
  coverArtUrl?: string;
  /** Ordered list of screenshot URLs (typically 16:9 IGDB art). */
  screenshots?: string[];
  /** Ordered list of video URLs — e.g. YouTube embeds or MP4 trailers. */
  videos?: string[];
  /** Total per-slide cycle duration in ms. Defaults to 14000. */
  cycleMs?: number;
  /** Cross-fade duration in ms. Defaults to 1500. */
  fadeMs?: number;
}

const DEFAULT_CYCLE_MS = 14000;
const DEFAULT_FADE_MS = 1500;

/**
 * Detect whether a URL points to a directly-playable video file.
 * Excludes YouTube / Twitch / Vimeo link URLs because a regular
 * `<video>` element can't play those (they're web pages, not
 * streamable files). When a game's `videos` array contains only
 * YouTube IDs from the IGDB scrape, we'll fall through to the
 * screenshot cycle instead of rendering an empty `<video>`.
 *
 * Matching is case-insensitive and tolerates a trailing query
 * separator (`?...`) or fragment (`#...`) so redirected CDN URLs
 * like `https://cdn.example/trailer.mp4?token=abc` still match.
 */
function isDirectVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m3u8)(\?|#|$)/i.test(url);
}

export default function BigScreenHeroBackground({
  bannerUrl,
  coverArtUrl,
  screenshots,
  videos,
  cycleMs = DEFAULT_CYCLE_MS,
  fadeMs = DEFAULT_FADE_MS,
}: BigScreenHeroBackgroundProps) {
  // Reduce-motion gate. We compute once on mount and never update —
  // if the user changes the OS setting mid-session we'd need a
  // matchMedia change listener, but that's a rare jump and a hard
  // page refresh is acceptable.
  const reducedMotion = useMemo(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // Pick the active source. Memoized so the cycle doesn't re-decide
  // when an unrelated prop changes.
  //
  // Ladder (top-down, video is preferred):
  //   • direct playable video file (mp4/webm/mov/m3u8)  → muted auto-loop
  //   • 2+ screenshots AND motion allowed                → Ken-Burns cycle
  //   • 1 screenshot (always, motion or not)             → single-shot
  //     (single-static still; keyframe disabled if reduced motion)
  //   • bannerUrl                                        → static banner
  //   • coverArtUrl                                      → static cover
  //   • nothing                                          → empty
  //
  // YouTube/Twitch-style video URLs are treated like other
  // `videos[]` entries but they're NOT direct video files, so
  // `isDirectVideoUrl` rejects them and we fall through to the
  // screenshot ladder. The "Explore → Trailers" card in
  // BigScreenGamePage still opens the chosen video in a lightbox
  // iframe where the URL actually plays.
  const mode = useMemo(() => {
    if (
      !reducedMotion &&
      videos &&
      videos.length > 0 &&
      isDirectVideoUrl(videos[0])
    ) {
      return "video" as const;
    }
    if (screenshots && screenshots.length >= 2) return "cycle" as const;
    if (screenshots && screenshots.length >= 1) return "single-shot" as const;
    if (bannerUrl) return "banner" as const;
    if (coverArtUrl) return "cover" as const;
    return "empty" as const;
  }, [reducedMotion, videos, screenshots, bannerUrl, coverArtUrl]);

  if (mode === "video") {
    return <VideoBackground src={videos![0]} />;
  }

  if (mode === "cycle") {
    return (
      <CycleBackground
        shots={screenshots!}
        cycleMs={cycleMs}
        fadeMs={fadeMs}
      />
    );
  }

  if (mode === "single-shot") {
    return <CycleBackground shots={screenshots!.slice(0, 1)} cycleMs={cycleMs} fadeMs={fadeMs} reducedMotion />;
  }

  if (mode === "banner") {
    return <StaticBackground url={bannerUrl!} />;
  }

  if (mode === "cover") {
    return <StaticBackground url={coverArtUrl!} />;
  }

  return null;
}

// ── Video ────────────────────────────────────────────────────

function VideoBackground({ src }: { src: string }) {
  return (
    <div className="bigscreen-gamepage-hero-bg-video" aria-hidden>
      <video
        src={src}
        autoPlay
        muted
        loop
        playsInline
        // The hero is above-the-fold and the entire BG layer is
        // expected to be visible immediately on mount. `auto`
        // preloads the whole file so the first paint already shows
        // motion; a 1–2 MB trailer is fine.
        preload="auto"
      />
    </div>
  );
}

// ── Cycle ────────────────────────────────────────────────────

interface CycleBackgroundProps {
  shots: string[];
  cycleMs: number;
  fadeMs: number;
  /** When true (or shots.length < 2), render a single static image
   *  with a no-op cross-fade. The CSS keyframes are still applied
   *  but the JS doesn't advance the index. */
  reducedMotion?: boolean;
}

function CycleBackground({
  shots,
  cycleMs,
  fadeMs,
  reducedMotion = false,
}: CycleBackgroundProps) {
  // `current` = the slide currently at full opacity.
  // `next`    = the slide we're about to fade in over `current`.
  // We render BOTH at all times during transition so the next
  // image is already decoded before its opacity flips.
  const [current, setCurrent] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (reducedMotion || shots.length < 2) return;
    // Tick is `cycleMs` (per-slide budget). The first `fadeMs` are
    // the cross-fade — once that's done, we advance `current` by
    // 1 so the now-visible slide becomes the new "current".
    const id = window.setInterval(() => {
      setFading(true);
      window.setTimeout(() => {
        setCurrent((i) => (i + 1) % shots.length);
        setFading(false);
      }, fadeMs);
    }, cycleMs);
    return () => {
      window.clearInterval(id);
    };
  }, [shots.length, cycleMs, fadeMs]);
  // `reducedMotion` is intentionally omitted from the deps array:
  // the value is the stable result of `useMemo(() => matchMedia(…), [])`
  // captured at mount (see top of this component), so including it
  // here would only add noise without changing re-run behavior. An OS
  // setting change mid-session isn't expected to re-evaluate — if it
  // ever needs to, wire a `matchMedia.addEventListener('change', …)`
  // here rather than pessimistically re-deriving on every render.

  const nextIndex = (current + 1) % shots.length;

  // ── Single static slide (no cycle) ──────────────────────
  if (shots.length === 1) {
    return (
      <div className="bigscreen-gamepage-hero-bg-cycle" aria-hidden>
        <div className="bigscreen-gamepage-hero-bg-slide bigscreen-gamepage-hero-bg-slide--even bigscreen-gamepage-hero-bg-slide--visible">
          <img src={shots[0]} alt="" />
        </div>
      </div>
    );
  }

  return (
    <div className="bigscreen-gamepage-hero-bg-cycle" aria-hidden>
      <div
        className={
          "bigscreen-gamepage-hero-bg-slide " +
          (current % 2 === 0
            ? "bigscreen-gamepage-hero-bg-slide--even"
            : "bigscreen-gamepage-hero-bg-slide--odd") +
          " " +
          (fading
            ? "bigscreen-gamepage-hero-bg-slide--fading"
            : "bigscreen-gamepage-hero-bg-slide--visible")
        }
      >
        <img src={shots[current]} alt="" />
      </div>
      <div
        className={
          "bigscreen-gamepage-hero-bg-slide " +
          (nextIndex % 2 === 0
            ? "bigscreen-gamepage-hero-bg-slide--even"
            : "bigscreen-gamepage-hero-bg-slide--odd") +
          " " +
          (fading
            ? "bigscreen-gamepage-hero-bg-slide--visible"
            : "bigscreen-gamepage-hero-bg-slide--fading")
        }
      >
        <img src={shots[nextIndex]} alt="" />
      </div>
    </div>
  );
}

// ── Static fallback ─────────────────────────────────────────

function StaticBackground({ url }: { url: string }) {
  return (
    <div
      className="bigscreen-gamepage-hero-bg-static"
      style={{ backgroundImage: `url(${url})` }}
      aria-hidden
    />
  );
}
