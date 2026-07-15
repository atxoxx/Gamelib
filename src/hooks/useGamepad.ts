// useGamepad — pure-TypeScript hook that polls the Gamepad API via
// requestAnimationFrame, maps D-pad / left analog stick to spatial
// navigation across registered focusable elements, and maps A/B
// buttons to activate/back.
//
// This file is deliberately `.ts` (no JSX). The React context
// provider that wraps this hook lives in `./GamepadProvider.tsx`.
// The split keeps all codebase imports as bare specifiers with no
// extension, matching every other import in the project.
//
// Consumers call `registerAction(el, onActivate)` to add a
// focusable element. The hook applies `data-focused="true"` to
// the currently focused element so CSS can style it.
//
// Spatial navigation: when the user presses a direction, the hook
// computes the nearest registered element in that direction using
// getBoundingClientRect() center-point distance, with a ±45°
// angular tolerance so diagonal presses don't snap to far-off
// elements.
//
// Debounce: 150ms cooldown between direction changes. A button
// fires immediately on rising edge.

import { useCallback, useEffect, useRef, useState } from "react";

// ── Types ───────────────────────────────────────────────────────

export interface FocusableEntry {
  element: HTMLElement;
  onActivate: () => void;
}

export interface GamepadState {
  /** Whether at least one gamepad is connected. */
  connected: boolean;
  /** The currently focused element, or null if nothing is focused. */
  focusedElement: HTMLElement | null;
  /**
   * Register a focusable element. Returns an unregister function.
   */
  registerAction: (element: HTMLElement, onActivate: () => void) => () => void;
}

// ── Internal helpers ────────────────────────────────────────────

function center(el: HTMLElement): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function angle(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

function isVisible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function nearestInDirection(
  current: HTMLElement,
  candidates: FocusableEntry[],
  dirAngle: number,
): HTMLElement | null {
  const cur = center(current);
  const tol = (Math.PI / 180) * 45;

  let best: HTMLElement | null = null;
  let bestDist = Infinity;

  for (const entry of candidates) {
    if (entry.element === current) continue;
    if (!isVisible(entry.element)) continue;

    const a = angle(cur, center(entry.element));

    let delta = a - dirAngle;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;

    if (Math.abs(delta) > tol) continue;

    const d = dist2(cur, center(entry.element));
    if (d < bestDist) {
      bestDist = d;
      best = entry.element;
    }
  }

  return best;
}

// ── Constants ───────────────────────────────────────────────────
const STICK_DEADZONE = 0.5;
const DIR_COOLDOWN = 150;

// ── Hook ────────────────────────────────────────────────────────

/**
 * Internal hook used by GamepadProvider. Exported so GamepadProvider
 * can consume it, but external consumers should use `useGamepadCtx()`
 * from `./GamepadProvider` to get the shared singleton state.
 */
export function useGamepadInternal(enabled: boolean): GamepadState {
  const entriesRef = useRef<FocusableEntry[]>([]);
  const focusedRef = useRef<HTMLElement | null>(null);
  const [connected, setConnected] = useState(false);
  const [focusedElement, setFocusedElement] = useState<HTMLElement | null>(null);
  const lastDirTimeRef = useRef(0);
  const prevAxesRef = useRef<{ h: number; v: number }>({ h: 0, v: 0 });
  const prevButtonsRef = useRef<{ a: boolean; b: boolean }>({ a: false, b: false });

  // ── Register / unregister ─────────────────────────────────────
  const registerAction = useCallback(
    (element: HTMLElement, onActivate: () => void): (() => void) => {
      const entry: FocusableEntry = { element, onActivate };
      entriesRef.current.push(entry);

      if (!focusedRef.current) {
        focusedRef.current = element;
        element.setAttribute("data-focused", "true");
        setFocusedElement(element);
      }

      return () => {
        entriesRef.current = entriesRef.current.filter(
          (e) => e.element !== element,
        );
        element.removeAttribute("data-focused");
        if (focusedRef.current === element) {
          focusedRef.current = entriesRef.current[0]?.element ?? null;
          if (focusedRef.current) {
            focusedRef.current.setAttribute("data-focused", "true");
          }
          setFocusedElement(focusedRef.current);
        }
      };
    },
    [],
  );

  // ── Polling loop ──────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return;
    }

    let rafId: number;

    function poll() {
      const gamepads = navigator.getGamepads();
      const gp = gamepads[0];

      if (!gp || !gp.connected) {
        if (connected) setConnected(false);
        rafId = requestAnimationFrame(poll);
        return;
      }

      if (!connected) setConnected(true);
      const now = performance.now();

      let h = 0;
      let v = 0;

      if (gp.buttons[12]?.pressed) v = -1;
      if (gp.buttons[13]?.pressed) v = 1;
      if (gp.buttons[14]?.pressed) h = -1;
      if (gp.buttons[15]?.pressed) h = 1;

      if (Math.abs(gp.axes[0]) > STICK_DEADZONE) h = gp.axes[0];
      if (Math.abs(gp.axes[1]) > STICK_DEADZONE) v = gp.axes[1];

      const prevH = prevAxesRef.current.h;
      const prevV = prevAxesRef.current.v;

      const hRising =
        Math.abs(h) > STICK_DEADZONE &&
        Math.abs(prevH) <= STICK_DEADZONE;
      const vRising =
        Math.abs(v) > STICK_DEADZONE &&
        Math.abs(prevV) <= STICK_DEADZONE;
      const dPadUsed =
        gp.buttons[12]?.pressed ||
        gp.buttons[13]?.pressed ||
        gp.buttons[14]?.pressed ||
        gp.buttons[15]?.pressed;

      const canNavigate = now - lastDirTimeRef.current > DIR_COOLDOWN;

      if (canNavigate && focusedRef.current) {
        const entries = entriesRef.current;
        if (entries.length > 1) {
          let dirH = 0;
          let dirV = 0;

          if (dPadUsed) {
            if (gp.buttons[12]?.pressed) dirV = -1;
            if (gp.buttons[13]?.pressed) dirV = 1;
            if (gp.buttons[14]?.pressed) dirH = -1;
            if (gp.buttons[15]?.pressed) dirH = 1;
          } else if (hRising || vRising) {
            dirH = Math.sign(h);
            dirV = Math.sign(v);
          }

          if (dirH !== 0 || dirV !== 0) {
            const dirAngle = Math.atan2(dirV, dirH);
            const next = nearestInDirection(
              focusedRef.current,
              entries,
              dirAngle,
            );
            if (next && next !== focusedRef.current) {
              focusedRef.current.removeAttribute("data-focused");
              focusedRef.current = next;
              next.setAttribute("data-focused", "true");
              next.scrollIntoView({ block: "nearest", behavior: "smooth" });
              setFocusedElement(next);
              lastDirTimeRef.current = now;
            }
          }
        }
      }

      prevAxesRef.current = { h, v };

      // ── A button (index 0) → activate ───────────────────────
      const aPressed = gp.buttons[0]?.pressed ?? false;
      if (aPressed && !prevButtonsRef.current.a && focusedRef.current) {
        const entry = entriesRef.current.find(
          (e) => e.element === focusedRef.current,
        );
        if (entry) {
          entry.onActivate();
        }
      }
      prevButtonsRef.current.a = aPressed;

      // ── B button (index 1) → back ───────────────────────────
      const bPressed = gp.buttons[1]?.pressed ?? false;
      if (bPressed && !prevButtonsRef.current.b) {
        if (typeof window !== "undefined" && window.history.length > 1) {
          window.history.back();
        }
      }
      prevButtonsRef.current.b = bPressed;

      rafId = requestAnimationFrame(poll);
    }

    rafId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafId);
  }, [enabled, connected]);

  // ── Cleanup ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      for (const entry of entriesRef.current) {
        entry.element.removeAttribute("data-focused");
      }
    };
  }, []);

  return { connected, focusedElement, registerAction };
}
