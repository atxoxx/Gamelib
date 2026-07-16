import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { StoreGameSummary } from "../../types/game";
import { useFocusable } from "../../hooks/useFocusable";
import BigScreenStoreRail from "./BigScreenStoreRail";
import BigScreenPill from "../bigscreen/BigScreenPill";

interface BigScreenStoreProps {
  onCardClick: (game: StoreGameSummary) => void;
}

const StoreIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20">
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
    <polyline points="17 6 23 6 23 12" />
  </svg>
);

const DetailsIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

export default function BigScreenStore({ onCardClick }: BigScreenStoreProps) {
  const [trending, setTrending] = useState<StoreGameSummary[]>([]);
  const [popular, setPopular] = useState<StoreGameSummary[]>([]);
  const [top, setTop] = useState<StoreGameSummary[]>([]);
  const [comingSoon, setComingSoon] = useState<StoreGameSummary[]>([]);
  const [newReleases, setNewReleases] = useState<StoreGameSummary[]>([]);

  const [loading, setLoading] = useState(true);
  const [featuredGame, setFeaturedGame] = useState<StoreGameSummary | null>(null);

  // Fetch all rails concurrently on mount
  useEffect(() => {
    let active = true;
    const fetchAll = async () => {
      setLoading(true);
      try {
        const fetchCat = (cat: string) =>
          invoke<StoreGameSummary[]>("fetch_store_games", {
            category: cat,
            offset: 0,
            limit: 12,
          });

        const [tr, pop, tp, cs, nr] = await Promise.all([
          fetchCat("trending"),
          fetchCat("popular"),
          fetchCat("top"),
          fetchCat("coming_soon"),
          fetchCat("new_releases"),
        ]);

        if (active) {
          setTrending(tr);
          setPopular(pop);
          setTop(tp);
          setComingSoon(cs);
          setNewReleases(nr);

          const initial = tr[0] || pop[0] || tp[0] || null;
          setFeaturedGame(initial);
        }
      } catch (err) {
        console.error("Failed to load store categories:", err);
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchAll();
    return () => {
      active = false;
    };
  }, []);

  const handleFocusedGameChange = useCallback((g: StoreGameSummary | null) => {
    if (g) setFeaturedGame(g);
  }, []);

  const handleDetails = useCallback(() => {
    if (featuredGame) {
      onCardClick(featuredGame);
    }
  }, [featuredGame, onCardClick]);

  const detailsFocusable = useFocusable(handleDetails);

  // Sync featuredGame with lists when rails update
  useEffect(() => {
    if (!featuredGame) return;
    const allStoreGames = [...trending, ...popular, ...top, ...comingSoon, ...newReleases];
    const updated = allStoreGames.find((g) => g.id === featuredGame.id);
    if (updated && updated !== featuredGame) {
      setFeaturedGame(updated);
    }
  }, [trending, popular, top, comingSoon, newReleases, featuredGame]);

  if (loading) {
    return (
      <div className="bigscreen-store-dashboard bigscreen-store-dashboard--loading">
        <div className="store-spinner" />
        <span>Loading store categories...</span>
      </div>
    );
  }

  // Fallback backdrop image or banner
  const backdropUrl = featuredGame?.coverUrl
    ? featuredGame.coverUrl.replace("cover_big", "screenshot_huge").replace("co_svg", "screenshot_huge")
    : "";

  return (
    <div className="bigscreen-store-dashboard">
      {/* ── Dynamic Backdrop ── */}
      <div className="bigscreen-dashboard-backdrop-container">
        {featuredGame && backdropUrl && (
          <img
            key={featuredGame.id}
            src={backdropUrl}
            alt=""
            className="bigscreen-dashboard-backdrop-img animate-fade-in"
            onError={(e) => {
              // fallback to regular cover if screenshot_huge fails
              if (featuredGame?.coverUrl) {
                e.currentTarget.src = featuredGame.coverUrl;
              }
            }}
          />
        )}
        <div className="bigscreen-dashboard-backdrop-overlay" />
      </div>

      <div className="bigscreen-dashboard-scrollable-content">
        {/* ── Spotlight Featured Details ── */}
        {featuredGame && (
          <section className="bigscreen-dashboard-details-pane" aria-label="Featured item details">
            <div className="bigscreen-details-pane-content">
              <span className="bigscreen-store-tag">SPOTLIGHT</span>
              <h2 className="bigscreen-details-title">{featuredGame.name}</h2>

              <div className="bigscreen-details-meta">
                {featuredGame.rating != null && (
                  <BigScreenPill tone="accent" size="sm">
                    ★ {Math.round(featuredGame.rating)} Rating
                  </BigScreenPill>
                )}
                {featuredGame.platforms.length > 0 && (
                  <BigScreenPill tone="muted" size="sm">
                    {featuredGame.platforms.slice(0, 2).join(" / ")}
                  </BigScreenPill>
                )}
                {featuredGame.firstReleaseDate && (
                  <BigScreenPill tone="muted" size="sm">
                    {new Date(featuredGame.firstReleaseDate).getFullYear()}
                  </BigScreenPill>
                )}
              </div>

              {featuredGame.genres.length > 0 && (
                <div className="bigscreen-details-genres" style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
                  {featuredGame.genres.slice(0, 3).map((genre) => (
                    <span key={genre} className="store-card-genre" style={{ background: "rgba(255,255,255,0.08)", padding: "4px 8px", borderRadius: "4px", fontSize: "12px", color: "var(--color-text-secondary)" }}>
                      {genre}
                    </span>
                  ))}
                </div>
              )}

              <div className="bigscreen-details-actions" style={{ marginTop: "24px" }}>
                <button
                  type="button"
                  className="bigscreen-details-btn bigscreen-details-btn--primary"
                  {...detailsFocusable}
                >
                  {DetailsIcon}
                  <span>View Details</span>
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ── Category Rails ── */}
        <div className="bigscreen-store-rails" style={{ marginTop: "40px" }}>
          {trending.length > 0 && (
            <BigScreenStoreRail
              title="Trending Now"
              icon={StoreIcon}
              games={trending}
              onCardClick={onCardClick}
              onFocusedGameChange={handleFocusedGameChange}
            />
          )}

          {popular.length > 0 && (
            <BigScreenStoreRail
              title="Most Popular"
              icon={StoreIcon}
              games={popular}
              onCardClick={onCardClick}
              onFocusedGameChange={handleFocusedGameChange}
            />
          )}

          {top.length > 0 && (
            <BigScreenStoreRail
              title="Top Critics"
              icon={StoreIcon}
              games={top}
              onCardClick={onCardClick}
              onFocusedGameChange={handleFocusedGameChange}
            />
          )}

          {comingSoon.length > 0 && (
            <BigScreenStoreRail
              title="Coming Soon"
              icon={StoreIcon}
              games={comingSoon}
              onCardClick={onCardClick}
              onFocusedGameChange={handleFocusedGameChange}
            />
          )}

          {newReleases.length > 0 && (
            <BigScreenStoreRail
              title="New Releases"
              icon={StoreIcon}
              games={newReleases}
              onCardClick={onCardClick}
              onFocusedGameChange={handleFocusedGameChange}
            />
          )}
        </div>
      </div>
    </div>
  );
}
