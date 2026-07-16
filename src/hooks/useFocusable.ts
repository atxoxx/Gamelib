// useFocusable — register an element with the Big Screen focus
// registry so spatial navigation (D-pad / left stick) can land on
// it and the A button activates `onActivate`.
//
// Replaces the old `useBigScreenHook().focusableProps(...)` factory.
// As a hook (not a factory), each focusable element gets its own
// ref + cleanup pair, which means:
//
//   • Refs are STABLE across renders — React doesn't re-run
//     cleanup+register every parent render (the old factory
//     recreated the callback every render and thrashed the
//     focus registry).
//   • `onActivate` is read through a ref, so callers can pass a
//     fresh closure each render (typical for inline handlers) and
//     the focus registry still points at the latest version.
//
// Usage:
//
//   const playProps = useFocusable(handlePlay);
//   <button {...playProps}>Play</button>
//
// Or, for elements with their own ref (rare — most callers should
// just spread `useFocusable`'s return value), `useFocusableRef` is
// the lower-level primitive that exposes the callback directly.

import { useCallback, useRef } from "react";
import { useGamepad } from "./GamepadProvider";

export interface FocusableProps {
  /** Callback ref. Spreads onto the focusable element. */
  ref: (el: HTMLElement | null) => void;
  /** Always `0` so the element joins the natural tab order. */
  tabIndex: number;
  /** WAI-ARIA role hint — controller-driven pickers use this. */
  role: "option";
  /** Mouse / keyboard fallback (the virtual cursor also uses it). */
  onClick: () => void;
}

/**
 * Register a focusable element with the Big Screen spatial-nav
 * focus registry.
 *
 * The returned object is stable across renders as long as the
 * `registerAction` reference is stable (it is — it's a `useCallback`
 * with `[]` deps in `useGamepad`). This is the key fix over the
 * old `focusableProps` factory, which returned a fresh object every
 * call and forced a register/unregister cycle every render.
 */
export function useFocusable(onActivate: () => void): FocusableProps {
  const { registerAction } = useGamepad();

  // Keep `onActivate` fresh without making it a hook dep — the
  // closure always reads the latest value via this ref.
  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;

  // Hold the unregister fn from `registerAction` so the ref
  // callback can clean up on unmount or element swap.
  const cleanupRef = useRef<(() => void) | null>(null);

  const refCallback = useCallback(
    (el: HTMLElement | null) => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      if (el) {
        cleanupRef.current = registerAction(
          el,
          () => onActivateRef.current(),
        );
      }
    },
    [registerAction],
  );

  return {
    ref: refCallback,
    tabIndex: 0,
    role: "option" as const,
    onClick: () => onActivateRef.current(),
  };
}