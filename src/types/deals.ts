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
  /** Internal deal id (store + game). */
  id: string;
  /** Game title as it appears in the deal. */
  gameTitle: string;
  /** Store display name ("Steam", "Humble Store", "GreenManGaming"). */
  storeName: string;
  /** Direct purchase URL on the store — opened in the system browser. */
  storeUrl: string;
  /** Pre-discount price in USD. */
  normalPrice: number;
  /** Current price in USD after discount. */
  dealPrice: number;
  /** Discount percentage (0–100). */
  discountPercent: number;
  /** ISO 8601 timestamp when the deal expires (when known). */
  expiration?: string | null;
  /** Platform name ("Steam", "GOG", "PC"). */
  platform: string;
  /** Square thumbnail (when available). */
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
  /** "all" or a specific platform name. */
  platform?: string | null;
  /** Minimum discount %, 0 means no minimum. */
  minDiscount?: number | null;
  /** "all" or a specific store id. */
  store?: string | null;
}
