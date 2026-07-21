import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useWishlistContext } from "../../context/WishlistContext";
import { useFocusable } from "../../hooks/useFocusable";
import { useGamepad } from "../../hooks/GamepadProvider";
import BigScreenStoreRail from "./BigScreenStoreRail";
import BigScreenPill from "../bigscreen/BigScreenPill";
import BigScreenTabBar, { type TabDef } from "../bigscreen/BigScreenTabBar";
import type { StoreGameSummary } from "../../types/game";
import type { DealItem } from "../../types/deals";

type StoreTab = "trending" | "deals" | "wishlist";

const STORE_TABS: TabDef<StoreTab>[] = [
  { id: "trending", label: "Discover" },
  { id: "deals", label: "Deals" },
  { id: "wishlist", label: "Wishlist" },
];

export default function BigScreenStore() {
  const gamepad = useGamepad();
  const navigate = useNavigate();
  const location = useLocation();
  const { wishlist } = useWishlistContext();

  const initialTab = useMemo<StoreTab>(() => {
    const path = location.pathname;
    if (path.startsWith("/wishlist")) return "wishlist";
    if (path.startsWith("/deals")) return "deals";
    return "trending";
  }, [location.pathname]);

  const [activeTab, setActiveTab] = useState<StoreTab>(initialTab);

  // Sync activeTab when URL pathname changes
  useEffect(() => {
    const path = location.pathname;
    if (path.startsWith("/wishlist")) {
      setActiveTab("wishlist");
    } else if (path.startsWith("/deals")) {
      setActiveTab("deals");
    } else if (path.startsWith("/store")) {
      setActiveTab("trending");
    }
  }, [location.pathname]);

  const handleSelectTab = useCallback(
    (tabId: StoreTab) => {
      setActiveTab(tabId);
      if (tabId === "wishlist") {
        navigate("/wishlist");
      } else if (tabId === "deals") {
        navigate("/deals");
      } else {
        navigate("/store");
      }
    },
    [navigate]
  );

  // Trending state
  const [trending, setTrending] = useState<StoreGameSummary[]>([]);
  const [popular, setPopular] = useState<StoreGameSummary[]>([]);
  const [top, setTop] = useState<StoreGameSummary[]>([]);
  const [comingSoon, setComingSoon] = useState<StoreGameSummary[]>([]);
  const [loadingTrending, setLoadingTrending] = useState(true);

  // Deals state
  const [deals, setDeals] = useState<DealItem[]>([]);
  const [loadingDeals, setLoadingDeals] = useState(false);

  const [selectedGame, setSelectedGame] = useState<StoreGameSummary | null>(null);
  const [activeRailId, setActiveRailId] = useState<string>("trending");

  // Fetch Trending categories
  useEffect(() => {
    let active = true;
    const fetchTrending = async () => {
      setLoadingTrending(true);
      try {
        const fetchCat = (cat: string) =>
          invoke<StoreGameSummary[]>("fetch_store_games", {
            category: cat,
            offset: 0,
            limit: 12,
          });

        const [tr, pop, tp, cs] = await Promise.all([
          fetchCat("trending"),
          fetchCat("popular"),
          fetchCat("top"),
          fetchCat("coming_soon"),
        ]);

        if (active) {
          setTrending(tr);
          setPopular(pop);
          setTop(tp);
          setComingSoon(cs);
          if (tr[0] && !selectedGame) setSelectedGame(tr[0]);
        }
      } catch (err) {
        console.error("Failed to load trending storefront:", err);
      } finally {
        if (active) setLoadingTrending(false);
      }
    };
    fetchTrending();
    return () => {
      active = false;
    };
  }, []);

  // Fetch Deals
  useEffect(() => {
    if (activeTab !== "deals") return;
    let active = true;
    const fetchDealsList = async () => {
      setLoadingDeals(true);
      try {
        const data = await invoke<DealItem[]>("fetch_isthereanydeal_deals", {
          filters: {
            platform: null,
            minDiscount: null,
            store: null,
          },
        });
        if (active) {
          setDeals(data);
        }
      } catch (err) {
        console.error("Failed to load deals:", err);
      } finally {
        if (active) setLoadingDeals(false);
      }
    };
    fetchDealsList();
    return () => {
      active = false;
    };
  }, [activeTab]);

  // Sync selected game on load or when trending list changes
  useEffect(() => {
    if (!selectedGame && trending[0]) {
      setSelectedGame(trending[0]);
    }
  }, [trending, selectedGame]);

  // Spatial navigation watcher for backdrop sync in trending tab
  const trendingGamesMap = useMemo(() => {
    const map = new Map<string, StoreGameSummary>();
    for (const list of [trending, popular, top, comingSoon]) {
      for (const g of list) map.set(String(g.id), g);
    }
    return map;
  }, [trending, popular, top, comingSoon]);

  // Keep selectedGame reference fresh from trending list
  const featuredGame = useMemo(() => {
    if (!selectedGame) return null;
    return trendingGamesMap.get(String(selectedGame.id)) ?? selectedGame;
  }, [trendingGamesMap, selectedGame]);

  useEffect(() => {
    if (activeTab !== "trending") return;
    const el = gamepad.focusedElement;
    if (!el) return;
    const id = el.getAttribute("data-game-id");
    if (id) {
      const game = trendingGamesMap.get(id);
      if (game && game.id !== selectedGame?.id) {
        setSelectedGame(game);
      }
      
      const railEl = el.closest("[data-rail-id]");
      if (railEl) {
        const rId = railEl.getAttribute("data-rail-id");
        if (rId) {
          setActiveRailId(rId);
        }
      }
    }
  }, [gamepad.focusedElement, trendingGamesMap, selectedGame, activeTab]);

  // LB/RB tab switcher
  useEffect(() => {
    return gamepad.registerTabCycler((direction) => {
      const currentIndex = STORE_TABS.findIndex((t) => t.id === activeTab);
      const baseIndex = currentIndex < 0 ? 0 : currentIndex;
      const nextIndex =
        direction === "forward"
          ? (baseIndex + 1) % STORE_TABS.length
          : (baseIndex - 1 + STORE_TABS.length) % STORE_TABS.length;
      handleSelectTab(STORE_TABS[nextIndex].id);
    }, 1);
  }, [gamepad, activeTab, handleSelectTab]);

  const handleCardClick = useCallback(
    (game: StoreGameSummary) => {
      navigate(`/store/${game.slug}`);
    },
    [navigate]
  );

  const handleDetails = useCallback(() => {
    if (featuredGame) {
      handleCardClick(featuredGame);
    }
  }, [featuredGame, handleCardClick]);

  const detailsFocusable = useFocusable(handleDetails);

  const renderDetailsPane = (railId: string) => {
    if (activeRailId !== railId) return null;
    return (
      <section className="bigscreen-dashboard-details-pane animate-fade-in" aria-label="Game info" style={{ padding: "0 64px 24px 64px" }}>
        <div className="bigscreen-details-pane-content">
          {featuredGame ? (
            <>
              <div className="bigscreen-details-logo-area">
                {featuredGame.logoUrl ? (
                  <img
                    src={featuredGame.logoUrl}
                    alt={featuredGame.name}
                    className="bigscreen-gamepage-hero-logo"
                    width={480}
                    height={140}
                  />
                ) : (
                  <h1 className="bigscreen-gamepage-hero-title">{featuredGame.name}</h1>
                )}
              </div>

              <div className="bigscreen-details-meta">
                {featuredGame.rating && (
                  <BigScreenPill tone="accent" size="sm">
                    Score: {Math.round(featuredGame.rating)}
                  </BigScreenPill>
                )}
                {featuredGame.genres && featuredGame.genres.slice(0, 2).map((g: string) => (
                  <BigScreenPill key={g} tone="muted" size="sm">
                    {g}
                  </BigScreenPill>
                ))}
              </div>

              {featuredGame.summary && (
                <p className="bigscreen-details-description">
                  {featuredGame.summary.length > 200
                    ? `${featuredGame.summary.substring(0, 200)}...`
                    : featuredGame.summary}
                </p>
              )}

              <div className="bigscreen-details-actions">
                <button
                  type="button"
                  className="bigscreen-details-btn bigscreen-details-btn--primary"
                  {...detailsFocusable}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  <span>Store Details</span>
                </button>
              </div>
            </>
          ) : (
            <div className="bigscreen-details-placeholder">
              <h2 className="bigscreen-details-title">Welcome to GameLib Store</h2>
              <p className="bigscreen-details-description">
                Browse trending, popular, and coming soon games.
              </p>
            </div>
          )}
        </div>
      </section>
    );
  };

  return (
    <div className="bigscreen-store-dashboard">
      {/* Dynamic full-bleed backdrop (only on trending page for premium vibes) */}
      {activeTab === "trending" && (
        <div className="bigscreen-dashboard-backdrop-container">
          {featuredGame && featuredGame.coverUrl && (
            <img
              key={featuredGame.id}
              src={featuredGame.coverUrl}
              alt=""
              className="bigscreen-dashboard-backdrop-img animate-fade-in"
              style={{ opacity: 1 }}
            />
          )}
          <div className="bigscreen-dashboard-backdrop-overlay" />
        </div>
      )}

      {/* Main scrolling wrapper */}
      <div className="bigscreen-dashboard-scrollable-content">
        {/* Navigation tabs */}
        <div className="bigscreen-store-tabs-wrapper">
          <BigScreenTabBar
            tabs={STORE_TABS}
            activeTab={activeTab}
            onActivate={handleSelectTab}
          />
        </div>

        {/* Categories Panel */}
        <div className="bigscreen-store-panel-content">
          {activeTab === "trending" && (
            <div className="store-trending-panel">
              {loadingTrending ? (
                <div className="store-tab-loading">
                  <div className="store-spinner" />
                  <span>Loading Discover Storefront...</span>
                </div>
              ) : (
                <>
                  {/* Rails */}
                  <div className="store-rails-group">
                    <>
                      {renderDetailsPane("trending")}
                      <BigScreenStoreRail
                        railId="trending"
                        title="Trending"
                        games={trending}
                        onCardClick={handleCardClick}
                      />
                    </>
                    <>
                      {renderDetailsPane("popular")}
                      <BigScreenStoreRail
                        railId="popular"
                        title="Popular Now"
                        games={popular}
                        onCardClick={handleCardClick}
                      />
                    </>
                    <>
                      {renderDetailsPane("top")}
                      <BigScreenStoreRail
                        railId="top"
                        title="Top Critic Scores"
                        games={top}
                        onCardClick={handleCardClick}
                      />
                    </>
                    <>
                      {renderDetailsPane("coming-soon")}
                      <BigScreenStoreRail
                        railId="coming-soon"
                        title="Coming Soon"
                        games={comingSoon}
                        onCardClick={handleCardClick}
                      />
                    </>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === "deals" && (
            <div className="store-deals-panel">
              {loadingDeals ? (
                <div className="store-tab-loading">
                  <div className="store-spinner" />
                  <span>Scanning active gaming deals...</span>
                </div>
              ) : (
                <div className="store-deals-grid">
                  {deals.map((deal: DealItem) => {
                    const dealProps = useFocusable(() => {
                      if (deal.storeUrl) {
                        invoke("open_folder", { path: deal.storeUrl }).catch((err) =>
                          console.error("Failed to open deal URL:", err)
                        );
                      }
                    });
                    return (
                      <div
                        key={deal.id}
                        className="bigscreen-game-card store-deal-card"
                        {...dealProps}
                      >
                        <div className="bigscreen-game-card-cover">
                          {deal.thumbnail ? (
                            <img src={deal.thumbnail} alt={deal.gameTitle} loading="lazy" />
                          ) : (
                            <div className="bigscreen-game-card-cover-placeholder">🛒</div>
                          )}
                          <div className="deal-discount-badge">-{deal.discountPercent}%</div>
                        </div>
                        <div className="bigscreen-store-card-details">
                          <h4 className="deal-game-title">{deal.gameTitle}</h4>
                          <div className="deal-price-row">
                            <span className="deal-price-new">€{deal.dealPrice.toFixed(2)}</span>
                          </div>
                          <div className="deal-store-tag">{deal.storeName}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === "wishlist" && (
            <div className="store-wishlist-panel">
              {wishlist.length === 0 ? (
                <div className="wishlist-empty-state">
                  <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" width="64" height="64" opacity="0.3">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                  <h3>Your Wishlist is empty</h3>
                  <p>Add games to your wishlist in store or search tabs to track them here.</p>
                </div>
              ) : (
                <div className="store-wishlist-grid">
                  {wishlist.map((item) => {
                    const wishProps = useFocusable(() => {
                      navigate(`/store/${item.slug}`);
                    });
                    return (
                      <div
                        key={item.slug}
                        className="bigscreen-game-card store-wishlist-card"
                        {...wishProps}
                      >
                        <div className="bigscreen-game-card-cover">
                          {item.coverUrl ? (
                            <img src={item.coverUrl} alt={item.name} loading="lazy" />
                          ) : (
                            <div className="bigscreen-game-card-cover-placeholder">❤️</div>
                          )}
                        </div>
                        <div className="bigscreen-store-card-details">
                          <h4 className="deal-game-title">{item.name}</h4>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
