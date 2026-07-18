import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  StoreGameSummary,
  WishlistCache,
  WishlistEntry,
} from "../types/game";

const SAVE_DEBOUNCE_MS = 500;

/**
 * useWishlist: client-of-truth state for the user's wishlist, mirrored to
 * `<app_data>/wishlist_cache.json` via Tauri commands.
 *
 * - Loads from disk once on mount, populating `entries` and flipping the
 *   `hydrated` flag. The flag prevents the debounced save from firing
 *   before hydration completes (which would overwrite disk with `{}`).
 * - `toggle(game)` updates React state synchronously (optimistic UI),
 *   then schedules a debounced disk save after SAVE_DEBOUNCE_MS.
 * - On unmount the pending save is flushed immediately to avoid losing the
 *   last toggle.
 *
 * The disk cache stores the full `StoreGameSummary` payload alongside
 * `addedAt`, so the wishlist rail renders instantly on next launch without
 * re-querying IGDB.
 */
export function useWishlist() {
  const [entriesBySlug, setEntriesBySlug] = useState<
    Record<string, WishlistEntry>
  >({});
  const [hydrated, setHydrated] = useState(false);

  // Ref mirrors the latest entries so flush-on-unmount and the debounced
  // save flush use the current snapshot, not a stale closure.
  const entriesRef = useRef(entriesBySlug);
  useEffect(() => {
    entriesRef.current = entriesBySlug;
  }, [entriesBySlug]);

  // Debounced save machinery.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratedRef = useRef(false);
  useEffect(() => {
    hydratedRef.current = hydrated;
  }, [hydrated]);

  // Gate on the *first* post-hydration effect run so we don't pointlessly
  // rewrite the on-disk file with the exact bytes we just loaded from it.
  // Set to true at the moment loading completes; the debounced-save effect
  // consumes this flag on its first run after `hydrated` flips true.
  const justHydratedRef = useRef(false);

  // `flushSave` is stable: it reads from refs to always get the latest.
  const flushSave = useCallback(() => {
    saveTimerRef.current = null;
    if (!hydratedRef.current) return;
    const payload: WishlistCache = { entries: entriesRef.current };
    invoke<string>("save_wishlist", { data: JSON.stringify(payload) }).catch(
      (err) => {
        console.error("Failed to save wishlist:", err);
      }
    );
  }, []);

  // Hydrate from disk on mount. On unmount, flush any pending write.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await invoke<string>("load_wishlist");
        if (!cancelled && raw) {
          const parsed = JSON.parse(raw) as Partial<WishlistCache>;
          if (parsed && parsed.entries && typeof parsed.entries === "object") {
            setEntriesBySlug(parsed.entries);
          }
        }
      } catch (err) {
        console.error("Failed to load wishlist:", err);
      } finally {
        if (!cancelled) {
          // Mark for the debounced-save effect to skip its next run so
          // we don't rewrite the file with the bytes we just loaded.
          justHydratedRef.current = true;
          setHydrated(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        flushSave(); // ensure last toggle isn't lost
      }
    };
  }, [flushSave]);

  // Debounced save on every entries change after hydration completes.
  // Skips the first run after hydration to avoid a pointless rewrite of
  // the disk file with the just-loaded contents.
  useEffect(() => {
    if (!hydrated) return;
    if (justHydratedRef.current) {
      justHydratedRef.current = false;
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  }, [entriesBySlug, hydrated, flushSave]);

  const toggle = useCallback((game: StoreGameSummary) => {
    setEntriesBySlug((prev) => {
      const next = { ...prev };
      if (next[game.slug]) {
        delete next[game.slug];
      } else {
        next[game.slug] = { ...game, addedAt: Date.now() };
      }
      return next;
    });
  }, []);

  const remove = useCallback((slug: string) => {
    setEntriesBySlug((prev) => {
      if (!prev[slug]) return prev;
      const next = { ...prev };
      delete next[slug];
      return next;
    });
  }, []);

  /** Update or clear the free-text note attached to a wishlisted game.
   *  Persists through the same debounced save path as `toggle`/`remove`. */
  const setNote = useCallback((slug: string, note: string) => {
    setEntriesBySlug((prev) => {
      const existing = prev[slug];
      if (!existing) return prev;
      const next = { ...prev };
      if (note.trim().length === 0) {
        // Drop the field entirely when emptied to keep the payload clean.
        const { note: _omit, ...rest } = existing;
        next[slug] = rest;
      } else {
        next[slug] = { ...existing, note: note.trim() };
      }
      return next;
    });
  }, []);

  /** Bulk-remove every entry. Used by the "Clear wishlist" action. */
  const clear = useCallback(() => {
    setEntriesBySlug({});
  }, []);

  const isWishlisted = useCallback(
    (slug: string) => Boolean(entriesBySlug[slug]),
    [entriesBySlug]
  );

  // Latest wishlist sorted by addedAt desc (newest first).
  const wishlist: WishlistEntry[] = Object.values(entriesBySlug).sort(
    (a, b) => b.addedAt - a.addedAt
  );

  return {
    wishlist,
    hydrated,
    isWishlisted,
    toggle,
    remove,
    setNote,
    clear,
    count: wishlist.length,
  };
}
