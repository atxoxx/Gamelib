// usePrefersReducedMotion — reactive `prefers-reduced-motion: reduce`
// media-query hook.
//
// Reads the OS setting on mount and subscribes to `change` events so
// the value updates live if the user flips the OS preference while the
// app is open. Returns `false` on SSR / browsers without matchMedia
// (defensive — current app is Tauri-only, but a future web build
// shouldn't crash).
//
// Phase 5 polish will consume this hook to gate Ken Burns, parallax,
// focus-ring pulse, virtual-cursor idle breathing, and any other
// auto-playing animation. The seam is added in PR 1 so Phase 5 ships
// as pure CSS/behavioral tweaks without touching the component tree.

import { useEffect, useState } from "react";

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    // addEventListener is the modern API; the deprecated
    // `addListener` form still works on older WebKit. We only need
    // the modern one — Tauri runs on a recent WebView.
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return reduced;
}