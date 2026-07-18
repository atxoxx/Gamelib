import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDensityContext } from "../../context/DensityContext";
import { useToast } from "../../context/ToastContext";
import type {
  DealItem,
  DealsFilters,
  GamePassFilters,
  GamePassGame,
  Giveaway,
} from "../../types/deals";
import { Button } from "../../components/ui";
import "./DealsPage.css";

/**
 * DealsPage — /deals
 *
 * Three stacked sub-tabs:
 *   1. Xbox GamePass — pulls `fetch_gamepass_catalog` (Rust HTTP fetch
 *      of the public Microsoft GamePass catalog).
 *   2. IsThereAnyDeal — pulls `fetch_isthereanydeal_deals` (Rust HTML
 *      scrape of isthereanydeal.com/ homepage, no API key required).
 *   3. Free Games — pulls `fetch_giveaways` (Rust HTML scrape of
 *      isthereanydeal.com/giveaways/ plus each bundle's detail page,
 *      no API key required).
 *
 * Filter state is local to this page (per-tab). The user's chosen
 * `ViewDensity` (compact / cozy / cinematic) is read from
 * `DensityContext` and applied to all grids, matching the Store page
 * pattern. URL opening is delegated to the existing Tauri opener
 * plugin, so clicks open in the system default browser.
 */

type SubTab = "gamepass" | "isthereanydeal" | "giveaways";

interface GamePassFiltersState {
  region: string;
  categories: string[];
  platform: string;
}

interface DealsFiltersState {
  platform: string;
  minDiscount: number;
  store: string;
}

const GP_REGIONS: { code: string; label: string }[] = [
  { code: "US", label: "United States" },
  { code: "UK", label: "United Kingdom" },
  { code: "CA", label: "Canada" },
  { code: "AU", label: "Australia" },
  { code: "DE", label: "Germany" },
  { code: "FR", label: "France" },
  { code: "JP", label: "Japan" },
  { code: "BR", label: "Brazil" },
  { code: "MX", label: "Mexico" },
];

const GP_CATEGORIES = [
  "Action & adventure",
  "RPG",
  "Shooter",
  "Strategy",
  "Sports & racing",
  "Platformer",
  "Puzzle & trivia",
  "Simulation",
  "Fighting",
  "Family & kids",
  "Card & board",
  "Music",
];

const GP_PLATFORMS = [
  { value: "all", label: "All platforms" },
  { value: "xbox", label: "Xbox console" },
  { value: "pc", label: "PC" },
  { value: "cloud", label: "Cloud gaming" },
];

const DEAL_PLATFORMS = [
  { value: "all", label: "All platforms" },
  { value: "steam", label: "Steam" },
  { value: "epic", label: "Epic Games Store" },
  { value: "gog", label: "GOG" },
  { value: "humble", label: "Humble Store" },
];

const DEAL_DISCOUNTS = [
  { value: 0, label: "Any discount" },
  { value: 25, label: "25% or more" },
  { value: 50, label: "50% or more" },
  { value: 75, label: "75% or more" },
  { value: 90, label: "90% or more" },
];

const DEAL_STORES = [
  { value: "all", label: "All stores" },
  { value: "steam", label: "Steam" },
  { value: "gog", label: "GOG" },
  { value: "epic", label: "Epic Games Store" },
  { value: "humble", label: "Humble Store" },
  { value: "fanatical", label: "Fanatical" },
  { value: "greenmangaming", label: "Green Man Gaming" },
];

function formatPrice(price: number): string {
  if (!Number.isFinite(price)) return "—";
  return `€${price.toFixed(2)}`;
}

function buildGamePassPayload(
  filters: GamePassFiltersState,
): GamePassFilters {
  return {
    region: filters.region,
    categories: filters.categories.length > 0 ? filters.categories : null,
    platform: filters.platform === "all" ? null : filters.platform,
  };
}

function buildDealsPayload(filters: DealsFiltersState): DealsFilters {
  return {
    platform: filters.platform === "all" ? null : filters.platform,
    minDiscount: filters.minDiscount > 0 ? filters.minDiscount : null,
    store: filters.store === "all" ? null : filters.store,
  };
}

/// Pick a stable accent color for a storefront so the fallback
/// image tile (shown when ITAD doesn't expose a cover) still reads
/// as a distinct, branded card.
function storeTint(storeName: string): string {
  const palette: Record<string, string> = {
    "Humble Bundle": "#ff3e1b",
    Fanatical: "#ff9800",
    IndieGala: "#ffb4e0",
    GOG: "#b6883a",
    Steam: "#1b2838",
    Epic: "#2a2a72",
  };
  for (const key of Object.keys(palette)) {
    if (storeName.toLowerCase().includes(key.toLowerCase())) {
      return palette[key];
    }
  }
  return "#3a4a63";
}

import { useBigScreen } from "../../context/BigScreenContext";
import BigScreenStore from "../../components/store/BigScreenStore";

export default function DealsPage() {
  const { isBigScreen } = useBigScreen();
  if (isBigScreen) {
    return <BigScreenStore />;
  }
  const { density } = useDensityContext();
  const { showToast } = useToast();

  const [activeSubTab, setActiveSubTab] = useState<SubTab>("gamepass");

  const [gpFilters, setGpFilters] = useState<GamePassFiltersState>({
    region: "US",
    categories: [],
    platform: "all",
  });
  const [gpGames, setGpGames] = useState<GamePassGame[]>([]);
  const [gpLoading, setGpLoading] = useState(false);
  const [gpError, setGpError] = useState<string | null>(null);
  const [gpEmpty, setGpEmpty] = useState(false);

  const [dealFilters, setDealFilters] = useState<DealsFiltersState>({
    platform: "all",
    minDiscount: 0,
    store: "all",
  });
  const [deals, setDeals] = useState<DealItem[]>([]);
  const [dealsLoading, setDealsLoading] = useState(false);
  const [dealsError, setDealsError] = useState<string | null>(null);
  const [dealsEmpty, setDealsEmpty] = useState(false);

  const [giveaways, setGiveaways] = useState<Giveaway[]>([]);
  const [giveawaysLoading, setGiveawaysLoading] = useState(false);
  const [giveawaysError, setGiveawaysError] = useState<string | null>(null);
  const [giveawaysEmpty, setGiveawaysEmpty] = useState(false);

  const gpRequestId = useRef(0);
  const dealsRequestId = useRef(0);
  const giveawaysRequestId = useRef(0);

  const [gpReloadNonce, setGpReloadNonce] = useState(0);
  const [dealsReloadNonce, setDealsReloadNonce] = useState(0);
  const [giveawaysReloadNonce, setGiveawaysReloadNonce] = useState(0);

  const loadGamePass = useCallback(async () => {
    const myRequest = ++gpRequestId.current;
    setGpLoading(true);
    setGpError(null);
    setGpEmpty(false);
    try {
      const result = await invoke<GamePassGame[]>("fetch_gamepass_catalog", {
        filters: buildGamePassPayload(gpFilters),
      });
      if (myRequest !== gpRequestId.current) return;
      setGpGames(result);
      setGpEmpty(result.length === 0);
    } catch (err) {
      if (myRequest !== gpRequestId.current) return;
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "Failed to load GamePass catalog.";
      setGpError(message);
      setGpGames([]);
    } finally {
      if (myRequest === gpRequestId.current) setGpLoading(false);
    }
  }, [gpFilters]);

  const loadDeals = useCallback(async () => {
    const myRequest = ++dealsRequestId.current;
    setDealsLoading(true);
    setDealsError(null);
    setDealsEmpty(false);
    try {
      const result = await invoke<DealItem[]>("fetch_isthereanydeal_deals", {
        filters: buildDealsPayload(dealFilters),
      });
      if (myRequest !== dealsRequestId.current) return;
      setDeals(result);
      setDealsEmpty(result.length === 0);
    } catch (err) {
      if (myRequest !== dealsRequestId.current) return;
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "Failed to load deals.";
      setDealsError(message);
      setDeals([]);
    } finally {
      if (myRequest === dealsRequestId.current) setDealsLoading(false);
    }
  }, [dealFilters]);

  const loadGiveaways = useCallback(async () => {
    const myRequest = ++giveawaysRequestId.current;
    setGiveawaysLoading(true);
    setGiveawaysError(null);
    setGiveawaysEmpty(false);
    try {
      const result = await invoke<Giveaway[]>("fetch_giveaways");
      if (myRequest !== giveawaysRequestId.current) return;
      setGiveaways(result);
      setGiveawaysEmpty(result.length === 0);
    } catch (err) {
      if (myRequest !== giveawaysRequestId.current) return;
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "Failed to load giveaways.";
      setGiveawaysError(message);
      setGiveaways([]);
    } finally {
      if (myRequest === giveawaysRequestId.current)
        setGiveawaysLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSubTab === "gamepass") {
      void loadGamePass();
    }
  }, [activeSubTab, loadGamePass, gpReloadNonce]);

  useEffect(() => {
    if (activeSubTab === "isthereanydeal") {
      void loadDeals();
    }
  }, [activeSubTab, loadDeals, dealsReloadNonce]);

  useEffect(() => {
    if (activeSubTab === "giveaways") {
      void loadGiveaways();
    }
  }, [activeSubTab, loadGiveaways, giveawaysReloadNonce]);

  const handleOpenUrl = useCallback(
    async (url: string | null | undefined) => {
      if (!url) return;
      try {
        await invoke<void>("open_deal_url", { url });
      } catch (err) {
        console.error("Failed to open URL:", err);
        const message =
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : "Could not open link in browser";
        showToast(message, "error");
      }
    },
    [showToast],
  );

  const toggleCategory = (category: string) => {
    setGpFilters((prev) => ({
      ...prev,
      categories: prev.categories.includes(category)
        ? prev.categories.filter((c) => c !== category)
        : [...prev.categories, category],
    }));
  };

  return (
    <div className="deals-page">
      <header className="deals-page-header">
        <h1 className="deals-page-title">
          <span className="deals-page-title-icon" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 7h-3a2 2 0 0 1-2-2V3" />
              <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" />
              <path d="M9 7H4a2 2 0 0 0-2 2v1" />
              <path d="M14 14l-3 3-3-3" />
              <path d="M11 17V7" />
            </svg>
          </span>
          Deals
        </h1>
        <p className="deals-page-subtitle">
          Browse the Xbox GamePass catalog, the best current deals across PC
          stores, and free game giveaways — all in one place. Click any
          card to jump straight to its source.
        </p>
      </header>

      <div className="deals-subtabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeSubTab === "gamepass"}
          className={`deals-subtab ${activeSubTab === "gamepass" ? "active" : ""}`}
          onClick={() => setActiveSubTab("gamepass")}
        >
          <span className="deals-subtab-icon" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <line x1="7" y1="12" x2="11" y2="12" />
              <line x1="9" y1="10" x2="9" y2="14" />
              <line x1="15" y1="10" x2="17" y2="14" />
              <line x1="17" y1="10" x2="15" y2="14" />
            </svg>
          </span>
          Xbox GamePass
          {gpGames.length > 0 && !gpLoading && (
            <span className="deals-subtab-badge">{gpGames.length}</span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSubTab === "isthereanydeal"}
          className={`deals-subtab ${activeSubTab === "isthereanydeal" ? "active" : ""}`}
          onClick={() => setActiveSubTab("isthereanydeal")}
        >
          <span className="deals-subtab-icon" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </span>
          IsThereAnyDeal
          {deals.length > 0 && !dealsLoading && (
            <span className="deals-subtab-badge">{deals.length}</span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSubTab === "giveaways"}
          className={`deals-subtab ${activeSubTab === "giveaways" ? "active" : ""}`}
          onClick={() => setActiveSubTab("giveaways")}
        >
          <span className="deals-subtab-icon" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 12 20 22 4 22 4 12" />
              <rect x="2" y="7" width="20" height="5" />
              <line x1="12" y1="22" x2="12" y2="7" />
              <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
              <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
            </svg>
          </span>
          Free Games
          {giveaways.length > 0 && !giveawaysLoading && (
            <span className="deals-subtab-badge">{giveaways.length}</span>
          )}
        </button>
      </div>

      {activeSubTab === "gamepass" && (
        <section className="deals-section" aria-label="Xbox GamePass">
          <div className="deals-filters">
            <div className="deals-filter-group">
              <label htmlFor="gp-region">Region</label>
              <select
                id="gp-region"
                className="deals-filter-select"
                value={gpFilters.region}
                onChange={(e) =>
                  setGpFilters((prev) => ({ ...prev, region: e.target.value }))
                }
              >
                {GP_REGIONS.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label} ({r.code})
                  </option>
                ))}
              </select>
            </div>

            <div className="deals-filter-group">
              <label htmlFor="gp-platform">Platform</label>
              <select
                id="gp-platform"
                className="deals-filter-select"
                value={gpFilters.platform}
                onChange={(e) =>
                  setGpFilters((prev) => ({
                    ...prev,
                    platform: e.target.value,
                  }))
                }
              >
                {GP_PLATFORMS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="deals-filter-group" style={{ flex: "2 1 280px" }}>
              <label>Categories</label>
              <div className="deals-category-chips">
                {GP_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    className={`deals-category-chip ${
                      gpFilters.categories.includes(cat) ? "active" : ""
                    }`}
                    onClick={() => toggleCategory(cat)}
                    aria-pressed={gpFilters.categories.includes(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <Button
              variant="secondary"
              size="sm"
              isLoading={gpLoading}
              onClick={() => setGpReloadNonce((n) => n + 1)}
              title="Refresh GamePass catalog"
              leftIcon={
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
              }
            >
              Refresh
            </Button>
          </div>

          {gpLoading && (
            <div className="deals-loading" role="status" aria-live="polite">
              <div className="deals-loading-spinner" />
              <span>Loading GamePass catalog…</span>
            </div>
          )}

          {!gpLoading && gpError && (
            <div className="deals-error" role="alert">
              <svg
                className="deals-error-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{gpError}</span>
            </div>
          )}

          {!gpLoading && !gpError && gpEmpty && (
            <div className="deals-empty" role="status">
              <svg
                className="deals-empty-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <span>
                No GamePass titles matched these filters. Try a different
                region or clear some categories.
              </span>
            </div>
          )}

          {!gpLoading && !gpError && gpGames.length > 0 && (
            <div className={`deals-grid density-${density}`}>
              {gpGames.map((game) => (
                <article key={game.id} className="deals-gamepass-card">
                  <div className="deals-gamepass-card-image-wrap">
                    {game.coverImage ? (
                      <img
                        className="deals-gamepass-card-image"
                        src={game.coverImage}
                        alt={game.title}
                        loading="lazy"
                      />
                    ) : (
                      <div className="deals-gamepass-card-image-fallback">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect x="2" y="3" width="20" height="14" rx="2" />
                          <line x1="8" y1="21" x2="16" y2="21" />
                          <line x1="12" y1="17" x2="12" y2="21" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="deals-gamepass-card-body">
                    <h3 className="deals-gamepass-card-title">{game.title}</h3>
                    {game.developer && (
                      <div className="deals-gamepass-card-company">
                        {game.developer}
                      </div>
                    )}
                    {game.description && (
                      <p className="deals-gamepass-card-desc">
                        {game.description}
                      </p>
                    )}
                    {game.categories.length > 0 && (
                      <div className="deals-gamepass-card-meta">
                        {game.categories.slice(0, 3).map((cat) => (
                          <span key={cat} className="deals-gamepass-card-tag">
                            {cat}
                          </span>
                        ))}
                      </div>
                    )}
                    {game.publisher && (
                      <div className="deals-gamepass-card-company deals-gamepass-card-company--muted">
                        Published by {game.publisher}
                      </div>
                    )}
                    {game.deeplink && (
                      <button
                        type="button"
                        className="deals-gamepass-card-link"
                        onClick={() => handleOpenUrl(game.deeplink)}
                      >
                        View on Xbox
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {activeSubTab === "isthereanydeal" && (
        <section className="deals-section" aria-label="IsThereAnyDeal">
          <div className="deals-filters">
            <div className="deals-filter-group">
              <label htmlFor="deal-platform">Platform</label>
              <select
                id="deal-platform"
                className="deals-filter-select"
                value={dealFilters.platform}
                onChange={(e) =>
                  setDealFilters((prev) => ({
                    ...prev,
                    platform: e.target.value,
                  }))
                }
              >
                {DEAL_PLATFORMS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="deals-filter-group">
              <label htmlFor="deal-store">Store</label>
              <select
                id="deal-store"
                className="deals-filter-select"
                value={dealFilters.store}
                onChange={(e) =>
                  setDealFilters((prev) => ({ ...prev, store: e.target.value }))
                }
              >
                {DEAL_STORES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="deals-filter-group">
              <label htmlFor="deal-discount">Min discount</label>
              <select
                id="deal-discount"
                className="deals-filter-select"
                value={dealFilters.minDiscount}
                onChange={(e) =>
                  setDealFilters((prev) => ({
                    ...prev,
                    minDiscount: Number(e.target.value),
                  }))
                }
              >
                {DEAL_DISCOUNTS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>

            <Button
              variant="secondary"
              size="sm"
              isLoading={dealsLoading}
              onClick={() => setDealsReloadNonce((n) => n + 1)}
              title="Refresh deals"
              leftIcon={
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
              }
            >
              Refresh
            </Button>
          </div>

          {dealsLoading && (
            <div className="deals-loading" role="status" aria-live="polite">
              <div className="deals-loading-spinner" />
              <span>Loading current deals…</span>
            </div>
          )}

          {!dealsLoading && dealsError && (
            <div className="deals-error" role="alert">
              <svg
                className="deals-error-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{dealsError}</span>
            </div>
          )}

          {!dealsLoading && !dealsError && dealsEmpty && (
            <div className="deals-empty" role="status">
              <svg
                className="deals-empty-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="12" y1="1" x2="12" y2="23" />
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
              <span>
                No current deals matched these filters. Lower the minimum
                discount or try another store.
              </span>
            </div>
          )}

          {!dealsLoading && !dealsError && deals.length > 0 && (
            <div className={`deals-grid density-${density}`}>
              {deals.map((deal) => {
                const discountClass =
                  deal.discountPercent >= 90
                    ? "mega"
                    : deal.discountPercent >= 75
                      ? "large"
                      : "";
                const expiry = deal.expiration
                  ? new Date(deal.expiration).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : null;
                return (
                  <article
                    key={deal.id}
                    className="deals-deal-card"
                    role="button"
                    tabIndex={0}
                    onClick={() => handleOpenUrl(deal.storeUrl)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        void handleOpenUrl(deal.storeUrl);
                      }
                    }}
                    aria-label={`Open deal for ${deal.gameTitle} on ${deal.storeName}`}
                  >
                    {deal.thumbnail ? (
                      <div className="deals-deal-card-image-wrap">
                        <img
                          className="deals-deal-card-image"
                          src={deal.thumbnail}
                          alt={deal.gameTitle}
                          loading="lazy"
                        />
                      </div>
                    ) : (
                      <div className="deals-deal-card-image-wrap">
                        <div className="deals-deal-card-image-fallback">
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <line x1="12" y1="1" x2="12" y2="23" />
                            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                          </svg>
                        </div>
                      </div>
                    )}

                    <span
                      className={`deals-deal-card-discount-corner ${discountClass}`}
                    >
                      -{deal.discountPercent}%
                    </span>

                    <div className="deals-deal-card-body">
                      <h3 className="deals-deal-card-title">
                        {deal.gameTitle}
                      </h3>
                      <div className="deals-deal-card-price">
                        <span className="deals-deal-card-current">
                          {formatPrice(deal.dealPrice)}
                        </span>
                      </div>
                      <div className="deals-deal-card-meta">
                        <span className="deals-deal-card-meta-item">
                          <span className="deals-deal-card-store">
                            {deal.storeName}
                          </span>
                        </span>
                        <span className="deals-deal-card-meta-item">
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <rect x="2" y="3" width="20" height="14" rx="2" />
                            <line x1="8" y1="21" x2="16" y2="21" />
                            <line x1="12" y1="17" x2="12" y2="21" />
                          </svg>
                          {deal.platform}
                        </span>
                        {expiry && (
                          <span className="deals-deal-card-expiry deals-deal-card-meta-item">
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <circle cx="12" cy="12" r="10" />
                              <polyline points="12 6 12 12 16 14" />
                            </svg>
                            Ends {expiry}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="deals-deal-card-overlay">
                      <span className="deals-deal-card-cta">
                        Open Deal
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {activeSubTab === "giveaways" && (
        <section className="deals-section" aria-label="Free Games">
          <div className="deals-filters">
            <div className="deals-filters-info">
              <span>
                Individual free games currently live on IsThereAnyDeal.
                Click any card to open its claim page in your browser.
              </span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              isLoading={giveawaysLoading}
              onClick={() => setGiveawaysReloadNonce((n) => n + 1)}
              title="Refresh giveaways"
              leftIcon={
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
              }
            >
              Refresh
            </Button>
          </div>

          {giveawaysLoading && (
            <div className="deals-loading" role="status" aria-live="polite">
              <div className="deals-loading-spinner" />
              <span>Loading free games…</span>
            </div>
          )}

          {!giveawaysLoading && giveawaysError && (
            <div className="deals-error" role="alert">
              <svg
                className="deals-error-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{giveawaysError}</span>
            </div>
          )}

          {!giveawaysLoading && !giveawaysError && giveawaysEmpty && (
            <div className="deals-empty" role="status">
              <svg
                className="deals-empty-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="20 12 20 22 4 22 4 12" />
                <rect x="2" y="7" width="20" height="5" />
                <line x1="12" y1="22" x2="12" y2="7" />
              </svg>
              <span>
                No free games available right now. Check back later or hit
                refresh to retry.
              </span>
            </div>
          )}

          {!giveawaysLoading && !giveawaysError && giveaways.length > 0 && (
            <div className={`deals-grid density-${density}`}>
              {giveaways.map((giveaway) => {
                const expiry = giveaway.expiry
                  ? new Date(giveaway.expiry).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : null;
                return (
                  <article
                    key={giveaway.id}
                    className="deals-giveaway-card"
                  >
                    <div className="deals-giveaway-card-image-wrap">
                      {giveaway.imageUrl ? (
                        <img
                          className="deals-giveaway-card-image"
                          src={giveaway.imageUrl}
                          alt={giveaway.title}
                          loading="lazy"
                        />
                      ) : (
                        <div
                          className="deals-giveaway-card-image-fallback"
                          style={{
                            background: storeTint(giveaway.storeName),
                          }}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="20 12 20 22 4 22 4 12" />
                            <rect x="2" y="7" width="20" height="5" />
                            <line x1="12" y1="22" x2="12" y2="7" />
                          </svg>
                        </div>
                      )}
                      <span className="deals-giveaway-card-free-badge">
                        FREE
                      </span>
                      {giveaway.isMature && (
                        <span className="deals-giveaway-card-mature-badge">
                          18+
                        </span>
                      )}
                    </div>
                    <div className="deals-giveaway-card-body">
                      <h3 className="deals-giveaway-card-title">
                        {giveaway.title}
                      </h3>
                      {giveaway.bundleTitle &&
                        giveaway.bundleTitle !== giveaway.title && (
                          <div className="deals-giveaway-card-bundle">
                            {giveaway.bundleTitle}
                          </div>
                        )}
                      <div className="deals-giveaway-card-meta">
                        <span className="deals-giveaway-card-store">
                          {giveaway.storeName}
                        </span>
                        {expiry && (
                          <span className="deals-giveaway-card-expiry">
                            Ends {expiry}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="deals-giveaway-card-cta"
                        onClick={() => handleOpenUrl(giveaway.dealUrl)}
                      >
                        Get it free
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
