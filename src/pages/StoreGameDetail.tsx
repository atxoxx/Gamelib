import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useGames } from "../context/GameContext";
import { useToast } from "../context/ToastContext";
import type { GameMetadataResult, IgdbReview, SimilarGame } from "../types/game";
import { slugify } from "../types/game";
import { useProgressiveImage } from "../hooks/useProgressiveImages";
import { Button } from "../components/ui";
import WebLinksTab from "../components/WebLinksTab";
import ReviewsTab from "../components/ReviewsTab";
import DownloadButton from "../components/DownloadButton";
import CrackWatchCard from "../components/CrackWatchCard";
import type { Game } from "../types/game";


/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */


function getVideoEmbedUrl(url: string): string | null {
  if (!url) return null;

  // Build a list of acceptable parent hostnames for Twitch embeds.
  // Twitch's player rejects embeds whose `parent` doesn't match the embedding
  // page's hostname (causing error 1000 inside the player). We pass the actual
  // runtime hostname plus common Tauri / localhost fallbacks for robustness
  // across Tauri dev (`http://localhost:1420`), Tauri 2 prod (`tauri://localhost`),
  // and Tauri 1.x-style prod (`https://tauri.localhost`).
  const buildParents = (): string => {
    const hosts = new Set<string>(["localhost", "127.0.0.1", "tauri.localhost"]);
    if (typeof window !== "undefined" && window.location?.hostname) {
      hosts.add(window.location.hostname);
    }
    return Array.from(hosts)
      .map((h) => `parent=${encodeURIComponent(h)}`)
      .join("&");
  };

  // Twitch VOD: https://www.twitch.tv/videos/12345 (with optional ?t= timestamp)
  const twitchVod = url.match(/twitch\.tv\/videos\/(\d+)/i);
  if (twitchVod) {
    const t = url.match(/[?&]t=([0-9hms]+)/i);
    const time = t ? `&time=${t[1]}` : "";
    return `https://player.twitch.tv/?video=v${twitchVod[1]}${time}&${buildParents()}&autoplay=false`;
  }
  // Twitch clip: https://clips.twitch.tv/SLUG or https://www.twitch.tv/CHANNEL/clip/SLUG
  const twitchClip = url.match(/(?:clips\.twitch\.tv\/|twitch\.tv\/[^/]+\/clip\/)([A-Za-z0-9_-]+)/i);
  if (twitchClip) {
    return `https://clips.twitch.tv/embed?clip=${twitchClip[1]}&${buildParents()}`;
  }
  // Twitch live channel: https://www.twitch.tv/CHANNEL
  const twitchChannel = url.match(/^https?:\/\/(?:www\.)?twitch\.tv\/([a-zA-Z0-9_]+)\/?$/i);
  if (twitchChannel) {
    const ch = twitchChannel[1].toLowerCase();
    const reserved = new Set([
      "videos", "directory", "settings", "subs", "wallet", "drops",
      "prime", "turbo", "login", "signup", "about",
    ]);
    if (!reserved.has(ch)) {
      return `https://player.twitch.tv/?channel=${twitchChannel[1]}&${buildParents()}&autoplay=false`;
    }
  }
  // YouTube (unchanged)
  let id = "";
  if (url.includes("watch?v=")) {
    id = url.split("watch?v=")[1]?.split("&")[0] || "";
  } else if (url.includes("youtu.be/")) {
    id = url.split("youtu.be/")[1]?.split("?")[0] || "";
  } else if (url.includes("youtube.com/embed/")) {
    id = url.split("youtube.com/embed/")[1]?.split("?")[0] || "";
  } else {
    id = url;
  }
  return id ? `https://www.youtube.com/embed/${id}` : null;
}

function getVideoThumbnail(
  url: string
): { kind: "youtube"; src: string } | { kind: "twitch" } | null {
  if (!url) return null;
  if (/youtube\.com|youtu\.be/i.test(url)) {
    let ytId = "";
    if (url.includes("watch?v=")) ytId = url.split("watch?v=")[1]?.split("&")[0] || "";
    else if (url.includes("youtu.be/")) ytId = url.split("youtu.be/")[1]?.split("?")[0] || "";
    else if (url.includes("youtube.com/embed/")) ytId = url.split("youtube.com/embed/")[1]?.split("?")[0] || "";
    else ytId = url;
    if (ytId) return { kind: "youtube", src: `https://img.youtube.com/vi/${ytId}/mqdefault.jpg` };
  }
  // Twitch has no public thumbnail API without auth; surface a branded placeholder.
  if (/twitch\.tv|clips\.twitch\.tv/i.test(url)) {
    return { kind: "twitch" };
  }
  return null;
}

function handleImgError(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  img.style.display = "none";
}

function RatingCircle({ score, label }: { score: number; label: string }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  const getColor = (s: number) => {
    if (s >= 75) return "#10b981";
    if (s >= 50) return "#f59e0b";
    return "#ef4444";
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-xs)' }}>
      <div style={{ position: 'relative', width: 68, height: 68 }}>
        <svg viewBox="0 0 68 68" style={{ width: '100%', height: '100%' }}>
          <circle cx="34" cy="34" r={radius} stroke="var(--color-bg-tertiary)" strokeWidth="4" fill="transparent" />
          <circle cx="34" cy="34" r={radius} strokeWidth="4" stroke={getColor(score)}
            strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
            strokeLinecap="round" fill="transparent"
            transform="rotate(-90 34 34)"
            style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
        </svg>
        <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          fontSize: 'var(--font-size-md)', fontWeight: 'bold', color: getColor(score) }}>{score}</span>
      </div>
      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  States                                                             */
/* ------------------------------------------------------------------ */

function StoreGameLoading() {
  return (
    <div className="game-page">
      <div className="game-hero" style={{ background: 'var(--color-bg-tertiary)', height: 240, borderRadius: 'var(--radius-lg)', opacity: 0.5 }} />
      <div style={{ display: 'flex', gap: 'var(--space-xl)', marginTop: 'var(--space-xl)' }}>
        <div style={{ flex: 2, height: 300, background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-lg)', opacity: 0.5 }} />
        <div style={{ flex: 1, height: 300, background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-lg)', opacity: 0.5 }} />
      </div>
      <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--color-text-muted)' }}>
        <div className="store-spinner" style={{ margin: '0 auto var(--space-md) auto' }} />
        Loading game details...
      </div>
    </div>
  );
}

function StoreGameError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const navigate = useNavigate();
  return (
    <div className="main-empty">
      <svg className="main-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <h2 className="main-empty-title">Failed to load game</h2>
      <p className="main-empty-subtitle">{message}</p>
      <div style={{ display: 'flex', gap: 'var(--space-md)', marginTop: 'var(--space-md)' }}>
        <Button variant="ghost" size="sm" onClick={onRetry}>Try Again</Button>
        <Button variant="ghost" size="sm" onClick={() => navigate("/store")}>Back to Store</Button>
      </div>
    </div>
  );
}

function StoreGameNotFound() {
  const navigate = useNavigate();
  return (
    <div className="main-empty">
      <svg className="main-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
      </svg>
      <h2 className="main-empty-title">Game Not Found</h2>
      <p className="main-empty-subtitle">This game could not be found on IGDB.</p>
      <Button variant="ghost" size="sm" onClick={() => navigate("/store")}>Back to Store</Button>
    </div>
  );
}

function SimilarGameCard({ sim, onClick }: { sim: SimilarGame; onClick: () => void }) {
  const [coverUrl, imgRef] = useProgressiveImage(sim.coverUrl || null);
  return (
    <div 
      className="similar-game-card" 
      onClick={onClick}
      style={{ cursor: 'pointer' }}
    >
      <div className="similar-game-cover-container" style={{ aspectRatio: '2/3', background: 'var(--color-bg-tertiary)', overflow: 'hidden', position: 'relative', borderRadius: 'var(--radius-md) var(--radius-md) 0 0' }}>
        {coverUrl ? (
          <img 
            ref={imgRef}
            src={coverUrl} 
            alt={sim.name} 
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            className="similar-game-cover"
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)' }}>No Cover</div>
        )}
      </div>
      <div style={{ padding: 'var(--space-sm)' }}>
        <h4 style={{ fontSize: '11px', fontWeight: '600', color: 'var(--color-text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: '1.3' }}>
          {sim.name}
        </h4>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

type Tab = "overview" | "reviews" | "weblinks";

export default function StoreGameDetail() {
  const { gameSlug } = useParams<{ gameSlug: string }>();
  const navigate = useNavigate();
  const { games, addStoreGame } = useGames();
  const { showToast } = useToast();

  const [data, setData] = useState<GameMetadataResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [activeVideoUrl, setActiveVideoUrl] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const mockGame = useMemo((): Game | null => {
    if (!data) return null;
    return {
      id: `store-${data.title}`,
      name: data.title,
      path: "",
      platform: data.sourceName === "Steam" ? "Steam" : "IGDB",
      installed: false,
      playTime: "0h",
      addedAt: Date.now(),
      metadataUrl: data.sourceUrl,
      metadataSource: data.sourceName,
      websites: data.websites ?? [],
      igdbReviews: data.igdbReviews ?? undefined,
      igdbRating: data.igdbRating ?? undefined,
    };
  }, [data]);

  // Abort-safe fetch (cleans up on unmount or slug change)
  const fetchData = useCallback(() => {
    if (!gameSlug) return;
    setLoading(true);
    setError(null);

    invoke<GameMetadataResult | null>("get_store_game_detail", { slug: gameSlug })
      .then((result) => {
        if (!mountedRef.current) return;
        if (result) setData(result);
        else setData(null);
      })
      .catch((err) => {
        if (!mountedRef.current) return;
        setError(String(err));
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  }, [gameSlug]);

  useEffect(() => {
    setData(null);
    setActiveTab("overview");
    setActiveVideoUrl(null);
    setLogoFailed(false);
    fetchData();
  }, [fetchData]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Check if this game is already in the library (by name)
  const existingInLibrary = useMemo(() => {
    if (!data) return null;
    const norm = data.title.toLowerCase().trim();
    return games.find((g) => g.name.toLowerCase().trim() === norm) ?? null;
  }, [data, games]);

  // Callback for ReviewsTab to update our local state when it fetches reviews.
  const handleReviewsFetched = useCallback(
    (reviews: IgdbReview[], _source: string) => {
      setData((prev) => (prev ? { ...prev, igdbReviews: reviews } : prev));
    },
    []
  );

  const handleAddToLibrary = async () => {
    if (!data || adding) return;
    setAdding(true);
    try {
      await addStoreGame(data);
    } catch (err) {
      showToast(`Failed to add game: ${err}`, "error");
    } finally {
      setAdding(false);
    }
  };

  // ── Render states ─────────────────────────────────────────────────────
  if (loading) return <StoreGameLoading />;
  if (error) return <StoreGameError message={error} onRetry={fetchData} />;
  if (!data) return <StoreGameNotFound />;

  const isInLibrary = !!existingInLibrary;
  const libraryGameId = existingInLibrary?.id;

  const releaseYear = data.releaseDate
    ? new Date(data.releaseDate).getFullYear()
    : null;

  return (
    <div className="game-page">
      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <div className="game-top-bar">
        <button className="game-back-link" onClick={() => navigate("/store")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Store
        </button>
      </div>

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <div className="game-hero">
        {(data.images.hero || data.images.banner) && (
          <div className="game-banner-bg" style={{ backgroundImage: `url(${data.images.hero ?? data.images.banner})` }} />
        )}
        <div className="game-banner">
          {(data.images.hero ?? data.images.banner ?? data.images.cover) ? (
            <img
              src={data.images.hero ?? data.images.banner ?? data.images.cover ?? ""}
              alt={data.title}
              className="game-cover-img"
              onError={handleImgError}
            />
          ) : (
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity={0.2}>
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          )}
        </div>
        <div className="game-hero-overlay">
          <div className="game-hero-info">
            {data.images.logo && !logoFailed ? (
              <img
                src={data.images.logo}
                alt={data.title}
                className="game-hero-logo"
                onError={() => setLogoFailed(true)}
              />
            ) : (
              <h1 className="game-hero-title">{data.title}</h1>
            )}
            <div className="game-hero-meta">
              {data.developer && <><span>{data.developer}</span><span className="game-hero-meta-dot" /></>}
              {data.publisher && <><span>{data.publisher}</span><span className="game-hero-meta-dot" /></>}
              {releaseYear && <><span>{releaseYear}</span><span className="game-hero-meta-dot" /></>}
              <span>Source: {data.sourceName}</span>
            </div>
          </div>
          {isInLibrary ? (
            <button
              className="game-launch-btn"
              style={{ background: 'var(--color-text-muted)', boxShadow: 'none', cursor: 'pointer' }}
              onClick={() => navigate(`/library/${libraryGameId}`)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18 }}>
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              View in Library
            </button>          ) : (
            <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center", flexWrap: "wrap" }}>
              <button className="store-add-btn" onClick={handleAddToLibrary} disabled={adding}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                {adding ? "Adding..." : "Add to Library"}
              </button>
              <DownloadButton
                gameName={data.title}
                variant="prominent"
                label="Find Download"
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────── */}
      <div className="game-tabs">
        {(["overview", "reviews", "weblinks"] as Tab[]).map((tab) => (
          <button key={tab} className={`game-tab${activeTab === tab ? " active" : ""}`} onClick={() => setActiveTab(tab)}>
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* ── Overview ──────────────────────────────────────────────────── */}
      {activeTab === "overview" && (
        <div className="game-content-grid">
          <div className="game-main-col">
            {data.description && (
              <section className="game-section">
                <h2 className="game-section-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
                  About
                </h2>
                <p className="game-description">{data.description}</p>
                {data.sourceUrl && (
                  <a className="metadata-source-link" href={data.sourceUrl} target="_blank" rel="noopener noreferrer">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                    View on {data.sourceName}
                  </a>
                )}
              </section>
            )}

            {data.storyline && (
              <section className="game-section">
                <h2 className="game-section-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                  Storyline
                </h2>
                <div style={{ position: 'relative', paddingLeft: 'var(--space-lg)', borderLeft: '3px solid var(--color-accent)' }}>
                  <p style={{ fontStyle: 'italic', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>"{data.storyline}"</p>
                </div>
              </section>
            )}

            {data.screenshots && data.screenshots.length > 0 && (
              <section className="game-section screenshots-section">
                <h2 className="game-section-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
                  Screenshots ({data.screenshots.length})
                </h2>
                <div className="screenshots-carousel" style={{ display: 'flex', gap: 'var(--space-md)', overflowX: 'auto', paddingBottom: 'var(--space-sm)' }}>
                  {data.screenshots.map((src, i) => (
                    <div key={i} className="screenshot-item" onClick={() => setLightboxImage(src)} style={{ flexShrink: 0, width: 220, height: 124, borderRadius: 'var(--radius-md)', overflow: 'hidden', cursor: 'pointer', border: '1px solid var(--color-border)', transition: 'all var(--transition-fast)' }}>
                      <img src={src} alt={`${data.title} Screenshot ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform var(--transition-fast)' }} className="screenshot-img" />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {data.videos && data.videos.length > 0 && (
              <section className="game-section videos-section">
                <h2 className="game-section-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="23 7 16 12 23 17 23 7" />
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                  </svg>
                  Trailers & Videos
                </h2>
                {(() => {
                  const activeUrl = activeVideoUrl || data.videos[0];
                  const embedUrl = getVideoEmbedUrl(activeUrl);
                  return (
                    <div className="videos-container" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                      {embedUrl ? (
                        <div className="video-iframe-wrapper" style={{ position: 'relative', width: '100%', paddingBottom: '56.25%', height: 0, borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--color-border)' }}>
                          <iframe
                            src={embedUrl}
                            title={`${data.title} Video Trailer`}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
                          />
                        </div>
                      ) : (
                        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>Video link is invalid</p>
                      )}
                      {data.videos.length > 1 && (
                        <div className="video-selector-list" style={{ display: 'flex', gap: 'var(--space-sm)', overflowX: 'auto', paddingBottom: 'var(--space-xs)' }}>
                          {data.videos.map((url, idx) => {
                            const thumb = getVideoThumbnail(url);
                            const isActive = url === activeUrl;
                            return (
                              <div
                                key={idx}
                                className={`video-selector-item${isActive ? " active" : ""}`}
                                onClick={() => setActiveVideoUrl(url)}
                                style={{
                                  flexShrink: 0,
                                  width: 120,
                                  height: 68,
                                  borderRadius: 'var(--radius-sm)',
                                  overflow: 'hidden',
                                  cursor: 'pointer',
                                  border: isActive ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                                  position: 'relative',
                                  transition: 'all var(--transition-fast)'
                                }}
                              >
                                {thumb?.kind === "youtube" ? (
                                  <img src={thumb.src} alt="Video thumbnail" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : thumb?.kind === "twitch" ? (
                                  <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg, #9146ff 0%, #6441a5 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 22, height: 22, color: '#fff' }}>
                                      <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.714 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
                                    </svg>
                                  </div>
                                ) : (
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--color-bg-tertiary)', color: 'var(--color-text-muted)', fontSize: '10px' }}>Video {idx + 1}</div>
                                )}
                                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 18, height: 18, color: '#fff' }}>
                                    <polygon points="5 3 19 12 5 21 5 3" />
                                  </svg>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </section>
            )}

            {data.similarGames && data.similarGames.length > 0 && (
              <section className="game-section similar-games-section" style={{ marginTop: 'var(--space-xl)' }}>
                <h2 className="game-section-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" />
                    <rect x="14" y="3" width="7" height="7" />
                    <rect x="14" y="14" width="7" height="7" />
                    <rect x="3" y="14" width="7" height="7" />
                  </svg>
                  Similar Games
                </h2>
                <div className="similar-games-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 'var(--space-lg)' }}>
                  {data.similarGames.slice(0, 6).map((sim) => (
                    <SimilarGameCard 
                      key={sim.id} 
                      sim={sim} 
                      onClick={() => navigate(`/store/${slugify(sim.name)}`)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>

          <div className="game-side-col">
            <section className="game-section">
              <h2 className="game-section-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
                Info
              </h2>
              <div className="info-grid">
                <div className="info-item"><span className="info-label">Source</span><span className="info-value">{data.sourceName}</span></div>
                {data.developer && <div className="info-item"><span className="info-label">Developer</span><span className="info-value">{data.developer}</span></div>}
                {data.publisher && <div className="info-item"><span className="info-label">Publisher</span><span className="info-value">{data.publisher}</span></div>}
                {data.releaseDate && <div className="info-item"><span className="info-label">Released</span><span className="info-value">{data.releaseDate}</span></div>}
                {data.collection && <div className="info-item"><span className="info-label">Series</span><span className="info-value">{data.collection}</span></div>}
                {data.franchise && <div className="info-item"><span className="info-label">Franchise</span><span className="info-value">{data.franchise}</span></div>}
                {data.gameCategory && <div className="info-item"><span className="info-label">Game Type</span><span className="info-value">{data.gameCategory}</span></div>}
                {data.releaseStatus && <div className="info-item"><span className="info-label">Release Status</span><span className="info-value">{data.releaseStatus}</span></div>}
                {data.alternativeNames && data.alternativeNames.length > 0 && (
                  <div className="info-item" style={{ gridColumn: 'span 2' }}>
                    <span className="info-label">Also Known As</span>
                    <span className="info-value" style={{ display: 'block', fontSize: '11px', marginTop: '2px', color: 'var(--color-text-muted)', lineHeight: '1.4' }}>
                      {data.alternativeNames.join(", ")}
                    </span>
                  </div>
                )}
              </div>
              {data.genres.length > 0 && (
                <div className="info-genres" style={{ marginTop: 'var(--space-md)', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
                  {data.genres.map((g) => <span key={g} className="metadata-genre-tag">{g}</span>)}
                </div>
              )}
            </section>

            {(data.igdbRating || data.criticRating) && (
              <section className="game-section ratings-card">
                <h2 className="game-section-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                  IGDB Ratings
                </h2>
                <div className="ratings-circle-wrap" style={{ display: 'flex', justifyContent: 'space-around', gap: 'var(--space-md)' }}>
                  {data.igdbRating && <RatingCircle score={Math.round(data.igdbRating)} label="Community" />}
                  {data.criticRating && <RatingCircle score={Math.round(data.criticRating)} label="Critics" />}
                </div>
                {(() => {
                  const breakdown = (() => {
                    let exceptional = 0, recommended = 0, meh = 0, skip = 0;
                    let total = 0;
                    if (data.igdbReviews && data.igdbReviews.length > 0) {
                      data.igdbReviews.forEach((r) => {
                        if (r.rating !== undefined) {
                          total++;
                          if (r.rating >= 90) exceptional++;
                          else if (r.rating >= 75) recommended++;
                          else if (r.rating >= 50) meh++;
                          else skip++;
                        }
                      });
                    }
                    if (total === 0) {
                      const base = data.igdbRating || 75;
                      const exp = Math.max(0, Math.round((base - 60) * 1.5));
                      const rec = Math.max(0, Math.round((base - 40) * 0.8));
                      const m = Math.max(0, Math.round((100 - base) * 0.6));
                      const sk = Math.max(0, 100 - (exp + rec + m));
                      return { exceptional: exp, recommended: rec, meh: m, skip: sk, total: 100 };
                    }
                    return {
                      exceptional: Math.round((exceptional / total) * 100),
                      recommended: Math.round((recommended / total) * 100),
                      meh: Math.round((meh / total) * 100),
                      skip: Math.round((skip / total) * 100),
                      total: 100
                    };
                  })();

                  const items = [
                    { label: "Exceptional", val: breakdown.exceptional, color: "#10b981" },
                    { label: "Recommended", val: breakdown.recommended, color: "#3b82f6" },
                    { label: "Meh", val: breakdown.meh, color: "#f59e0b" },
                    { label: "Skip", val: breakdown.skip, color: "#ef4444" },
                  ];

                  return (
                    <div style={{ marginTop: 'var(--space-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
                      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: '600' }}>Score Breakdown</span>
                      {items.map((item) => (
                        <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                          <span style={{ fontSize: '11px', width: '85px', color: 'var(--color-text-primary)' }}>{item.label}</span>
                          <div style={{ flex: 1, height: '6px', background: 'var(--color-bg-tertiary)', borderRadius: '3px', overflow: 'hidden' }}>
                            <div 
                              style={{ 
                                height: '100%', 
                                width: `${item.val}%`, 
                                background: item.color, 
                                borderRadius: '3px',
                                boxShadow: `0 0 4px ${item.color}`
                              }} 
                            />
                          </div>
                          <span style={{ fontSize: '11px', width: '30px', textAlign: 'right', color: 'var(--color-text-muted)' }}>{item.val}%</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </section>
            )}

            {(data.gameModes || data.themes || data.playerPerspectives) && (
              <section className="game-section">
                <h2 className="game-section-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="8" rx="2" /><rect x="2" y="14" width="20" height="8" rx="2" /><line x1="6" y1="6" x2="6.01" y2="6" /><line x1="6" y1="18" x2="6.01" y2="18" /></svg>
                  Game Specs
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                  {data.gameModes && data.gameModes.length > 0 && (
                    <div>
                      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 'var(--space-xs)' }}>Modes</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
                        {data.gameModes.map((m) => <span key={m} className="spec-tag" style={{ background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-primary)' }}>{m}</span>)}
                      </div>
                    </div>
                  )}
                  {data.themes && data.themes.length > 0 && (
                    <div>
                      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 'var(--space-xs)' }}>Themes</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
                        {data.themes.map((t) => <span key={t} className="spec-tag" style={{ background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-primary)' }}>{t}</span>)}
                      </div>
                    </div>
                  )}
                  {data.playerPerspectives && data.playerPerspectives.length > 0 && (
                    <div>
                      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 'var(--space-xs)' }}>Perspectives</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
                        {data.playerPerspectives.map((p) => <span key={p} className="spec-tag" style={{ background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-primary)' }}>{p}</span>)}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {data.timeToBeat && (
              <section className="game-section">
                <h2 className="game-section-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                  Time to Beat
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                  {data.timeToBeat.normally && <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-primary)' }}>Main Story: <strong>{Math.round(data.timeToBeat.normally / 3600)}h</strong></div>}
                  {data.timeToBeat.hastily && <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-primary)' }}>Rushed: <strong>{Math.round(data.timeToBeat.hastily / 3600)}h</strong></div>}
                  {data.timeToBeat.completely && <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-primary)' }}>Completionist: <strong>{Math.round(data.timeToBeat.completely / 3600)}h</strong></div>}
                </div>
              </section>
            )}

            {data.releases && data.releases.length > 0 && (
              <section className="game-section">
                <h2 className="game-section-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                  Releases
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)', maxHeight: 180, overflowY: 'auto' }}>
                  {data.releases.map((rel, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
                      <span style={{ fontWeight: '500', color: 'var(--color-text-primary)' }}>{rel.platform}</span>
                      <span style={{ color: 'var(--color-text-muted)' }}>{rel.dateStr} ({rel.region})</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* CrackWatch Status */}
            <CrackWatchCard gameName={data.title} />

            {/* Languages Section */}
            {data.languageSupports && data.languageSupports.length > 0 && (
              <section className="game-section languages-section" style={{ marginTop: 'var(--space-xl)' }}>
                <h2 className="game-section-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    <line x1="9" y1="10" x2="15" y2="10" />
                    <line x1="9" y1="14" x2="13" y2="14" />
                  </svg>
                  Supported Languages
                </h2>
                {(() => {
                  const langMap: Record<string, { interface: boolean; audio: boolean; subtitles: boolean }> = {};
                  data.languageSupports.forEach(ls => {
                    if (!ls.language) return;
                    if (!langMap[ls.language]) {
                      langMap[ls.language] = { interface: false, audio: false, subtitles: false };
                    }
                    const type = ls.supportType ? ls.supportType.toLowerCase() : "";
                    if (type === "interface") langMap[ls.language].interface = true;
                    else if (type === "audio") langMap[ls.language].audio = true;
                    else if (type === "subtitles") langMap[ls.language].subtitles = true;
                  });

                  const languagesList = Object.keys(langMap).sort();

                  return (
                    <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-secondary)' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-sm)', textAlign: 'left' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'rgba(255,255,255,0.02)' }}>
                            <th style={{ padding: 'var(--space-sm) var(--space-md)', color: 'var(--color-text-muted)', fontWeight: '600' }}>Language</th>
                            <th style={{ padding: 'var(--space-sm) var(--space-md)', color: 'var(--color-text-muted)', fontWeight: '600', textAlign: 'center' }}>Interface</th>
                            <th style={{ padding: 'var(--space-sm) var(--space-md)', color: 'var(--color-text-muted)', fontWeight: '600', textAlign: 'center' }}>Audio</th>
                            <th style={{ padding: 'var(--space-sm) var(--space-md)', color: 'var(--color-text-muted)', fontWeight: '600', textAlign: 'center' }}>Subtitles</th>
                          </tr>
                        </thead>
                        <tbody>
                          {languagesList.map(lang => (
                            <tr key={lang} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                              <td style={{ padding: 'var(--space-sm) var(--space-md)', fontWeight: '500', color: 'var(--color-text-primary)' }}>{lang}</td>
                              <td style={{ padding: 'var(--space-sm) var(--space-md)', textAlign: 'center' }}>
                                {langMap[lang].interface ? (
                                  <span style={{ color: '#10b981', fontWeight: 'bold' }}>✓</span>
                                ) : (
                                  <span style={{ color: 'var(--color-text-muted)' }}>-</span>
                                )}
                              </td>
                              <td style={{ padding: 'var(--space-sm) var(--space-md)', textAlign: 'center' }}>
                                {langMap[lang].audio ? (
                                  <span style={{ color: '#10b981', fontWeight: 'bold' }}>✓</span>
                                ) : (
                                  <span style={{ color: 'var(--color-text-muted)' }}>-</span>
                                )}
                              </td>
                              <td style={{ padding: 'var(--space-sm) var(--space-md)', textAlign: 'center' }}>
                                {langMap[lang].subtitles ? (
                                  <span style={{ color: '#10b981', fontWeight: 'bold' }}>✓</span>
                                ) : (
                                  <span style={{ color: 'var(--color-text-muted)' }}>-</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </section>
            )}

          </div>
        </div>
      )}

      {/* ── Reviews ────────────────────────────────────────────────────── */}
      {activeTab === "reviews" && mockGame && (
        <ReviewsTab game={mockGame} onReviewsFetched={handleReviewsFetched} />
      )}

      {/* ── Weblinks ───────────────────────────────────────────────────── */}
      {activeTab === "weblinks" && mockGame && (
        <WebLinksTab game={mockGame} visible={!lightboxImage} />
      )}

      {lightboxImage && (
        <div 
          className="lightbox-backdrop" 
          onClick={() => setLightboxImage(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(0, 0, 0, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            cursor: 'zoom-out',
            animation: 'fadeIn var(--transition-fast) ease'
          }}
        >
          <div 
            className="lightbox-content" 
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              maxWidth: '90%',
              maxHeight: '90%',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
              border: '1px solid rgba(255,255,255,0.1)'
            }}
          >
            <img src={lightboxImage} alt="Fullscreen Screenshot" style={{ maxWidth: '100%', maxHeight: '85vh', objectFit: 'contain', display: 'block' }} />
            <button 
              className="lightbox-close" 
              onClick={() => setLightboxImage(null)}
              style={{
                position: 'absolute',
                top: 'var(--space-md)',
                right: 'var(--space-md)',
                background: 'rgba(0, 0, 0, 0.5)',
                border: 'none',
                borderRadius: '50%',
                width: 36,
                height: 36,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: '#fff',
                transition: 'background var(--transition-fast)'
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 18, height: 18 }}>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
