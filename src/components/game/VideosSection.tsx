import { useState } from "react";
import type { Game } from "../../types/game";
import { IconVideo } from "./icons";
import { getVideoEmbedUrl, getVideoThumbnail } from "./video";

/**
 * VideosSection
 *
 *  Main-column "Trailers & Videos" card. Embeds the active video
 *  in a 16:9 iframe and renders a horizontally-scrolling strip of
 *  thumbnails below when there's more than one. Clicking a thumb
 *  swaps the embed.
 *
 *  The thumbnail generation helpers (`getVideoEmbedUrl`,
 *  `getVideoThumbnail`) live in `./video` so the same logic can
 *  be reused by the Store GameDetail page without forking.
 */

interface VideosSectionProps {
  game: Game;
}

export default function VideosSection({ game }: VideosSectionProps) {
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  if (!game.videos || game.videos.length === 0) return null;

  const current = activeUrl || game.videos[0];
  const embedUrl = getVideoEmbedUrl(current);

  return (
    <section className="game-section videos-section">
      <h2 className="game-section-title">
        <span className="game-section-title__icon" aria-hidden>
          <IconVideo size={16} />
        </span>
        Trailers &amp; Videos
        <span className="game-section-title__count">{game.videos.length}</span>
      </h2>

      <div className="videos-container">
        {embedUrl ? (
          <div className="video-iframe-wrapper">
            <iframe
              src={embedUrl}
              title={`${game.name} Video Trailer`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : (
          <p className="videos-empty">Video link is invalid</p>
        )}

        {game.videos.length > 1 && (
          <div className="video-selector-list">
            {game.videos.map((url, idx) => {
              const isSelected = current === url;
              const thumb = getVideoThumbnail(url);
              return (
                <button
                  key={idx}
                  className={`video-selector-btn ${isSelected ? "active" : ""}`}
                  onClick={() => setActiveUrl(url)}
                  aria-label={`Play trailer ${idx + 1}`}
                  aria-pressed={isSelected}
                >
                  {thumb?.kind === "youtube" ? (
                    <>
                      <img
                        src={thumb.src}
                        alt={`Trailer ${idx + 1}`}
                        className="video-selector-img"
                      />
                      <span className="video-selector-play-overlay">
                        <svg
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          width="16"
                          height="16"
                        >
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                      </span>
                    </>
                  ) : thumb?.kind === "twitch" ? (
                    <span className="video-selector-twitch">
                      <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="18"
                        height="18"
                      >
                        <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.714 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
                      </svg>
                    </span>
                  ) : (
                    <span className="video-selector-fallback">
                      Trailer {idx + 1}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
