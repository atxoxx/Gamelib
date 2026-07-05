/**
 * TypeScript types for the Deals tab.
 *
 * Mirrors the Rust structs in `src-tauri/src/deals.rs`. Field names follow
 * the camelCase serialization emitted by `#[serde(rename_all = "camelCase")]`
 * on the Rust side, so they line up 1:1 with the `invoke<T>()` return shape.
 */

/** A single Xbox GamePass catalog title. Returned by `fetch_gamepass_catalog`. */
export interface GamePassGame {
  /** Stable product id from the Microsoft catalog. */
  id: string;
  /** Human-readable title. */
  title: string;
  /** Short marketing blurb (may be missing for older entries). */
  description?: string | null;
  /** Square/poster image URL (RemoteSauce ImageItem URL). */
  coverImage?: string | null;
  /** Primary developer name (split from the catalog's combined string). */
  developer?: string | null;
  /** Primary publisher name (split from the catalog's combined string). */
  publisher?: string | null;
  /** Genre / category names ("Action", "RPG", etc.). */
  categories: string[];
  /** Platform names ("Xbox", "PC"). */
  platforms: string[];
  /** ISO date string for the original release. */
  releaseDate?: string | null;
  /** Big ProductId from the catalog (used to build the Xbox store deeplink). */
  productId?: string | null;
  /** Convenience deeplink straight to the Xbox store page for the title. */
  deeplink?: string | null;
}

/** A single deal row from IsThereAnyDeal. Returned by `fetch_isthereanydeal_deals`. */
export interface DealItem {
  /** Internal deal id (the ITAD link UUID). */
  id: string;
  /** Game title as it appears in the deal. */
  gameTitle: string;
  /** Store display name ("Steam", "Humble Store", "GreenManGaming"). */
  storeName: string;
  /** Direct purchase URL on the store — opened in the system browser. */
  storeUrl: string;
  /** Current price in EUR after discount. The original price is not
   * exposed by the ITAD homepage scrape, so there's no separate
   * `normalPrice` field. */
  dealPrice: number;
  /** Discount percentage (0–100). */
  discountPercent: number;
  /** ISO 8601 timestamp when the deal expires. Always `null` from
   * the homepage scrape — the frontend hides the "Ends" badge. */
  expiration?: string | null;
  /** Platform name. Always "Windows" from the homepage scrape. */
  platform: string;
  /** Square thumbnail. Always `null` from the homepage scrape —
   * the frontend shows the fallback icon. */
  thumbnail?: string | null;
}

/** Filters for `fetch_gamepass_catalog`. Empty/null fields mean "no filter". */
export interface GamePassFilters {
  /** ISO 3166-1 alpha-2 region code, e.g. "US", "UK". Defaults to "US". */
  region?: string | null;
  /** Category names; only games matching at least one are returned. */
  categories?: string[] | null;
  /** Platform filter ("xbox" | "pc" | "cloud" | "all"). */
  platform?: string | null;
}

/** Filters for `fetch_isthereanydeal_deals`. Empty/null fields mean "no filter". */
export interface DealsFilters {
  /** Kept for API compatibility but ignored by the backend — the
   * ITAD homepage doesn't expose per-deal platform info, so there's
   * nothing to filter on. */
  platform?: string | null;
  /** Minimum discount %, 0 means no minimum. */
  minDiscount?: number | null;
  /** "all" or a specific store id. */
  store?: string | null;
}

/** A single free-game giveaway (one game inside a bundle).
 * Returned by `fetch_giveaways`. */
export interface Giveaway {
  /** Composite id (`"{bundleId}-{gameId}"`). */
  id: string;
  /** Individual game title. */
  title: string;
  /** Parent bundle title (e.g. "Humble Summer Bundle") for context. */
  bundleTitle: string;
  /** Cover image URL. `null` when the bundle page doesn't expose
   * an image for this game — the frontend shows a fallback icon. */
  imageUrl?: string | null;
  /** Storefront display name (e.g. "Humble Bundle", "Fanatical"). */
  storeName: string;
  /** Direct claim URL — the per-game URL when present, otherwise
   * the parent bundle's tracking URL. */
  dealUrl: string;
  /** 18+ flag inherited from the parent bundle. */
  isMature: boolean;
  /** ISO 8601 expiration timestamp. `null` when no expiry is set. */
  expiry?: string | null;
}
