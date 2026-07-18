import { createContext, useContext, type ReactNode } from "react";
import { useWishlist } from "../hooks/useWishlist";
import type { StoreGameSummary, WishlistEntry } from "../types/game";

/**
 * WishlistContext exposes the user's wishlist state plus toggle helpers
 * to any descendant component. Wraps `useWishlist` so deeply-nested cards
 * (in `StoreGameGrid`, `SnapRail`, `WishlistRail`) can read wishlisted
 * status and toggle entries without prop-drilling.
 *
 * The hook itself keeps React state as the source of truth and debounces
 * disk writes — the provider simply publishes the API.
 */
interface WishlistContextValue {
  /** All wishlisted entries, newest first (highest addedAt). */
  wishlist: WishlistEntry[];
  /** False until the on-disk cache has finished hydrating. */
  hydrated: boolean;
  /** O(1) membership check by IGDB slug. */
  isWishlisted: (slug: string) => boolean;
  /** Bidirectional: adds if absent, removes if present. */
  toggle: (game: StoreGameSummary) => void;
  /** Explicit remove — used by WishlistRail heart button. */
  remove: (slug: string) => void;
  /** Update or clear the free-text note on a wishlisted game. */
  setNote: (slug: string, note: string) => void;
  /** Bulk-remove every entry (used by the "Clear wishlist" action). */
  clear: () => void;
  /** Convenience: number of wishlisted games. */
  count: number;
}

const WishlistContext = createContext<WishlistContextValue | null>(null);

/**
 * The underlying Context object. Exported so deeply-nested consumers
 * (e.g. `StoreGameCard`) can read it directly with `useContext` and
 * gracefully fall back to defaults when no provider is mounted —
 * instead of throwing via `useWishlistContext`.
 */
export { WishlistContext };

export function WishlistProvider({
  value: externalValue,
  children,
}: {
  /** Optional explicit value. When omitted the provider falls back to its
   *  own `useWishlist()` invocation — useful when `StorePage` already holds
   *  the canonical state and wants to share it with deeply-nested cards
   *  without spawning a second hook instance. */
  value?: WishlistContextValue;
  children: ReactNode;
}) {
  const fallback = useWishlist();
  return (
    <WishlistContext.Provider value={externalValue ?? fallback}>
      {children}
    </WishlistContext.Provider>
  );
}

export function useWishlistContext(): WishlistContextValue {
  const ctx = useContext(WishlistContext);
  if (!ctx) {
    throw new Error("useWishlistContext must be used within a WishlistProvider");
  }
  return ctx;
}
