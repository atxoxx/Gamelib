import { useMemo, useState } from "react";

/**
 * HeroTrailer
 *
 * Cinematic video layer for the hero banners. Two rendering modes:
 *   - Big-screen / `autoplay`: muted, looping, inline (no controls) —
 *     sits behind the hero text as ambient motion.
 *   - Interactive (default, desktop): a poster + play button. Clicking
 *     swaps in the real player (YouTube iframe or native <video>).
 *
 * Always respects `prefers-reduced-motion` — no autoplay, static poster.
 * The hero's still art (`poster`) is used as the frame so the layout
 * never collapses when there is no video or playback is idle.
 */

type Parsed =
  | { kind: "youtube"; id: string }
  | { kind: "file"; src: string }
  | null;

function parseSource(raw: string | null | undefined): Parsed {
  if (!raw) return null;
  const url = raw.trim();
  const yt = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/i
  );
  if (yt) return { kind: "youtube", id: yt[1] };
  if (/^[\w-]{11}$/.test(url)) return { kind: "youtube", id: url };
  if (/\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url)) return { kind: "file", src: url };
  return null;
}

function youtubeEmbed(id: string, autoplay: boolean, mute: boolean): string {
  const params = new URLSearchParams({
    autoplay: autoplay ? "1" : "0",
    mute: mute ? "1" : "0",
    loop: "1",
    playlist: id,
    rel: "0",
    modestbranding: "1",
    playsinline: "1",
  });
  return `https://www.youtube.com/embed/${id}?${params.toString()}`;
}

export interface HeroTrailerProps {
  /** A single video URL or YouTube ID. */
  src?: string | null;
  /** Still frame shown before playback / when idle (banner/cover). */
  poster?: string | null;
  /** Big-screen behavior: muted ambient autoplay loop. */
  autoplay?: boolean;
  className?: string;
}

export default function HeroTrailer({
  src,
  poster,
  autoplay = false,
  className,
}: HeroTrailerProps) {
  const parsed = useMemo(() => parseSource(src), [src]);
  const [activated, setActivated] = useState(false);

  const reduceMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );

  if (!parsed) return null;

  const shouldAutoplay = autoplay && !reduceMotion;
  const playing = shouldAutoplay || activated;

  if (parsed.kind === "file") {
    return (
      <div className={`hero-trailer${className ? ` ${className}` : ""}`} aria-hidden={!playing}>
        <video
          className="hero-trailer__video"
          src={parsed.src}
          poster={poster ?? undefined}
          autoPlay={shouldAutoplay}
          muted
          loop
          playsInline
          controls={activated && !shouldAutoplay}
          onClick={() => !shouldAutoplay && setActivated(true)}
        />
        {!playing && (
          <button
            type="button"
            className="hero-trailer__play"
            aria-label="Play trailer"
            onClick={() => setActivated(true)}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </button>
        )}
      </div>
    );
  }

  // YouTube
  return (
    <div className={`hero-trailer${className ? ` ${className}` : ""}`} aria-hidden={!playing}>
      {playing ? (
        <iframe
          className="hero-trailer__video"
          src={youtubeEmbed(parsed.id, true, shouldAutoplay)}
          title="Game trailer"
          frameBorder={0}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <>
          {poster && (
            <img className="hero-trailer__poster" src={poster} alt="" aria-hidden="true" />
          )}
          <button
            type="button"
            className="hero-trailer__play"
            aria-label="Play trailer"
            onClick={() => setActivated(true)}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}
