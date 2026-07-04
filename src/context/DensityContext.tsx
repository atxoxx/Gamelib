import { createContext, useContext, type ReactNode } from "react";
import { useViewDensity } from "../hooks/useViewDensity";
import type { ViewDensity } from "../types/game";

/**
 * DensityContext publishes the user's chosen Store card density so cards
 * nested deep in the grid can render the right layout variant without
 * prop-drilling from `StorePage`.
 *
 * Consumers that need a forced override (e.g. `SnapRail` always renders
 * a tight grid of compact cards regardless of user preference) pass
 * `density="cozy"` explicitly to `StoreGameCard`. Props take precedence
 * over context; if neither is set, the card defaults to its own
 * compact-friendly default ("cozy").
 */
interface DensityContextValue {
  density: ViewDensity;
  setDensity: (next: ViewDensity) => void;
}

const DensityContext = createContext<DensityContextValue | null>(null);

/**
 * The underlying Context object. Exported so deeply-nested consumers
 * (e.g. `StoreGameCard`) can read it directly with `useContext` and
 * gracefully fall back to defaults when no provider is mounted —
 * instead of throwing via `useDensityContext`.
 */
export { DensityContext };

export function DensityProvider({
  value: externalValue,
  children,
}: {
  /** Optional explicit value. When omitted the provider falls back to its
   *  own `useViewDensity()` invocation — useful when `StorePage` already
   *  holds the canonical state and wants to share it with deeply-nested
   *  cards without spawning a second hook instance. */
  value?: DensityContextValue;
  children: ReactNode;
}) {
  const fallback = useViewDensity();
  return (
    <DensityContext.Provider value={externalValue ?? fallback}>
      {children}
    </DensityContext.Provider>
  );
}

export function useDensityContext(): DensityContextValue {
  const ctx = useContext(DensityContext);
  if (!ctx) {
    throw new Error("useDensityContext must be used within a DensityProvider");
  }
  return ctx;
}
