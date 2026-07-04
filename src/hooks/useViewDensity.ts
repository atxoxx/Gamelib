import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_DENSITY,
  VIEW_DENSITY_STORAGE_KEY,
  type ViewDensity,
} from "../types/game";

/**
 * useViewDensity: user-toggleable card layout density.
 *
 * - Reads from localStorage on first render (safe synchronous init for SPAs).
 * - Persists every change back to localStorage via an effect.
 * - Subscribes to the `storage` event so settings changed in another tab
 *   (e.g., a future Settings page) update this tab live.
 * - Falls back to DEFAULT_DENSITY when the stored value is missing or invalid.
 *
 * localStorage access is wrapped in try/catch because private-browsing modes
 * and some sandboxed contexts throw on read/write.
 */
export function useViewDensity(): {
  density: ViewDensity;
  setDensity: (next: ViewDensity) => void;
} {
  const [density, setDensityState] = useState<ViewDensity>(() => {
    try {
      const raw = localStorage.getItem(VIEW_DENSITY_STORAGE_KEY);
      if (raw === "compact" || raw === "cozy" || raw === "cinematic") {
        return raw;
      }
    } catch {
      // localStorage may be unavailable in this environment.
    }
    return DEFAULT_DENSITY;
  });

  // Persist on every change.
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_DENSITY_STORAGE_KEY, density);
    } catch {
      // localStorage may throw in private browsing modes.
    }
  }, [density]);

  // Cross-tab sync via the browser `storage` event.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== VIEW_DENSITY_STORAGE_KEY || !e.newValue) return;
      const next = e.newValue;
      if (next === "compact" || next === "cozy" || next === "cinematic") {
        setDensityState(next);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // setDensity is wrapped so state and storage update synchronously —
  // prevents races with unmount-flush paths in callers like useWishlist.
  const setDensity = useCallback((next: ViewDensity) => {
    setDensityState(next);
    try {
      localStorage.setItem(VIEW_DENSITY_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  return { density, setDensity };
}
