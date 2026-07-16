// useGamepad — pure-TypeScript hook that polls the Gamepad API via
// requestAnimationFrame. Handles:
//
//   • Spatial navigation (D-pad / left stick → registered focusables
//     selected by center+angular proximity with ±45° tolerance).
//   • Face buttons (A/B/X/Y) for activate / back / Escape / virtual-
//     mouse toggle.
//   • Bumpers (LB/RB) → cycle BigScreenNav tabs.
//   • Triggers (LT/RT) → press-and-hold left/right mouse for click-
//     and-drag interactions.
//   • Stick clicks (L3/R3) → hide cursor / recenter cursor.
//   • Virtual mouse pointer (right stick → on-screen cursor with
//     non-linear acceleration + deadzone), used alongside spatial
//     navigation so non-focusable surfaces (sliders, drag handles,
//     custom controls) remain reachable from the couch.
//
// This file is deliberately `.ts` (no JSX). The React context
// provider that wraps this hook lives in `./GamepadProvider.tsx`.
//
// Consumers:
//   • `useGamepad()` from `./GamepadProvider` returns the shared
//     singleton state: `{ connected, focusedElement, registerAction,
//     virtualMouse, toggleVirtualMouse, recenterVirtualMouse,
//     registerTabCycler }`.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  nearestInDirection,
  dispatchMouse,
  dispatchKey,
  virtualMouseSpeed,
  RIGHT_STICK_DEADZONE,
  STICK_DEADZONE,
  TRIGGER_THRESHOLD,
  MAX_FRAME_DT_SEC,
  FIRST_FRAME_DT_MS,
} from "./gamepad/gamepadUtils";

// ── Types ───────────────────────────────────────────────────────

export interface FocusableEntry {
  element: HTMLElement;
  onActivate: () => void;
}

export interface VirtualMouseState {
  /** User has the cursor visible (stick motion or Y-toggle). */
  visible: boolean;
  /** Viewport X position of the cursor (px). */
  x: number;
  /** Viewport Y position of the cursor (px). */
  y: number;
  /** RT analog trigger is past the click threshold. */
  leftDown: boolean;
  /** LT analog trigger is past the click threshold. */
  rightDown: boolean;
  /** Right stick reported motion in the last frame (drives fade). */
  moving: boolean;
  /** performance.now() of last stick motion. Drives idle fade. */
  lastInputMs: number;
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
  /** Virtual mouse pointer state (driven by right stick + triggers). */
  virtualMouse: VirtualMouseState;
  /** Toggle the virtual mouse cursor (Y button or programmatic). */
  toggleVirtualMouse: () => void;
  /** Recenter the virtual cursor to viewport center (R3 / programmatic). */
  recenterVirtualMouse: () => void;
  /**
   * Register a BigScreenNav tab cycler (LB/RB). The handler is
   * invoked with 'forward' on RB press and 'back' on LB press.
   * Returns an unregister function. Only one cycler is active at a
   * time — last-registered wins.
   */
  registerTabCycler: (
    fn: (direction: "forward" | "back") => void,
  ) => () => void;
}

// ── Constants ───────────────────────────────────────────────────
// Loop-level constants stay here (per-frame, not math-tuning):
const DIR_COOLDOWN = 150;

// ── Hook ────────────────────────────────────────────────────────

/**
 * Internal hook used by GamepadProvider. Exported so GamepadProvider
 * can consume it, but external consumers should use `useGamepad()`
 * from `./GamepadProvider` to get the shared singleton state.
 */
export function useGamepadInternal(enabled: boolean): GamepadState {
  const entriesRef = useRef<FocusableEntry[]>([]);
  const focusedRef = useRef<HTMLElement | null>(null);
  const [connected, setConnected] = useState(false);
  const [focusedElement, setFocusedElement] = useState<HTMLElement | null>(
    null,
  );

  // ── Virtual mouse references ─────────────────────────────────
  const virtualMouseRef = useRef<VirtualMouseState>({
    visible: false,
    x: typeof window !== "undefined" ? window.innerWidth / 2 : 0,
    y: typeof window !== "undefined" ? window.innerHeight / 2 : 0,
    leftDown: false,
    rightDown: false,
    moving: false,
    lastInputMs: 0,
  });
  const lastPublishedVMRef = useRef<VirtualMouseState>(virtualMouseRef.current);
  const [virtualMouse, setVirtualMouse] = useState<VirtualMouseState>(
    () => virtualMouseRef.current,
  );

  // Tab cycler subscription (BigScreenNav uses this for LB/RB).
  const tabCyclerRef = useRef<
    ((direction: "forward" | "back") => void) | null
  >(null);

  // ── Polling-loop state refs ────────────────────────────────
  const lastDirTimeRef = useRef(0);
  const prevLeftAxesRef = useRef<{ h: number; v: number }>({ h: 0, v: 0 });
  const prevRightAxesRef = useRef<{ h: number; v: number }>({ h: 0, v: 0 });
  const prevButtonsRef = useRef<{
    a: boolean;
    b: boolean;
    x: boolean;
    y: boolean;
    lb: boolean;
    rb: boolean;
    rt: boolean;
    lt: boolean;
    r3: boolean;
    l3: boolean;
  }>({
    a: false,
    b: false,
    x: false,
    y: false,
    lb: false,
    rb: false,
    rt: false,
    lt: false,
    r3: false,
    l3: false,
  });
  const lastFrameTimeRef = useRef(0);

  // ── Register / unregister focusables ───────────────────────
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

  // ── Toggle virtual cursor visibility (Y button or programmatic) ─
  const toggleVirtualMouse = useCallback(() => {
    const cur = virtualMouseRef.current;
    cur.visible = !cur.visible;
    if (cur.visible) cur.lastInputMs = performance.now();
  }, []);

  // ── Recenter virtual cursor (R3 button or programmatic) ─────
  const recenterVirtualMouse = useCallback(() => {
    const cur = virtualMouseRef.current;
    cur.x = window.innerWidth / 2;
    cur.y = window.innerHeight / 2;
    cur.lastInputMs = performance.now();
    if (!cur.visible) cur.visible = true;
  }, []);

  // ── Register tab cycler for BigScreenNav LB/RB ─────────────
  const registerTabCycler = useCallback(
    (fn: (direction: "forward" | "back") => void): (() => void) => {
      tabCyclerRef.current = fn;
      return () => {
        if (tabCyclerRef.current === fn) tabCyclerRef.current = null;
      };
    },
    [],
  );

  // ── Polling loop ────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return;
    }

    // Reset the per-frame timestamp so the FIRST rAF tick after a
    // reconnect (or initial mount) computes a sensible Δt. Without
    // this, `lastFrameTimeRef.current` retains a stale timestamp
    // and `dtMs` becomes a large value that a single frame would
    // then cap at MAX_FRAME_DT_SEC — teleporting the cursor ~180px
    // on the first frame after reconnect.
    lastFrameTimeRef.current = 0;

    let rafId: number;

    function publishVirtualMouse(force = false): void {
      const cur = virtualMouseRef.current;
      const prev = lastPublishedVMRef.current;
      if (
        force ||
        prev.visible !== cur.visible ||
        prev.x !== cur.x ||
        prev.y !== cur.y ||
        prev.leftDown !== cur.leftDown ||
        prev.rightDown !== cur.rightDown ||
        prev.moving !== cur.moving
      ) {
        lastPublishedVMRef.current = cur;
        setVirtualMouse({ ...cur });
      }
    }

    function poll(timestamp: number) {
      const gamepads = navigator.getGamepads();
      const gp = gamepads[0];

      // ── Disconnect cleanup ─────────────────────────────────
      if (!gp || !gp.connected) {
        if (connected) {
          setConnected(false);
          const cur = virtualMouseRef.current;
          if (cur.leftDown) {
            dispatchMouse("mouseup", cur.x, cur.y, 0);
          }
          if (cur.rightDown) {
            dispatchMouse("mouseup", cur.x, cur.y, 2);
          }
          cur.visible = false;
          cur.leftDown = false;
          cur.rightDown = false;
          cur.moving = false;
          publishVirtualMouse();
        }
        lastFrameTimeRef.current = timestamp;
        rafId = requestAnimationFrame(poll);
        return;
      }

      if (!connected) setConnected(true);

      // Δt for frame-rate-independent stick motion. Capped so a
      // stall (debugger / tab switch) doesn't fly the cursor
      // across the screen.
      const dtMs = lastFrameTimeRef.current
        ? timestamp - lastFrameTimeRef.current
        : FIRST_FRAME_DT_MS;
      lastFrameTimeRef.current = timestamp;
      const dtSec = Math.min(dtMs / 1000, MAX_FRAME_DT_SEC);
      const now = performance.now();

      // ── LEFT STICK / D-PAD → spatial navigation ────────────
      let leftH = 0;
      let leftV = 0;
      if (gp.buttons[12]?.pressed) leftV = -1;
      if (gp.buttons[13]?.pressed) leftV = 1;
      if (gp.buttons[14]?.pressed) leftH = -1;
      if (gp.buttons[15]?.pressed) leftH = 1;
      if (Math.abs(gp.axes[0]) > STICK_DEADZONE) leftH = gp.axes[0];
      if (Math.abs(gp.axes[1]) > STICK_DEADZONE) leftV = gp.axes[1];

      const prevLeftH = prevLeftAxesRef.current.h;
      const prevLeftV = prevLeftAxesRef.current.v;
      const hRising =
        Math.abs(leftH) > STICK_DEADZONE &&
        Math.abs(prevLeftH) <= STICK_DEADZONE;
      const vRising =
        Math.abs(leftV) > STICK_DEADZONE &&
        Math.abs(prevLeftV) <= STICK_DEADZONE;
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
            dirH = Math.sign(leftH);
            dirV = Math.sign(leftV);
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
      prevLeftAxesRef.current = { h: leftH, v: leftV };

      const vm = virtualMouseRef.current;

      // ── RIGHT STICK → virtual cursor movement ───────────────
      // Non-linear acceleration combines both axes for a single
      // magnitude so a diagonal push doesn't compound into faster
      // movement than a straight push.
      const rightH = gp.axes[2] ?? 0;
      const rightV = gp.axes[3] ?? 0;
      const magH = Math.abs(rightH) - RIGHT_STICK_DEADZONE;
      const magV = Math.abs(rightV) - RIGHT_STICK_DEADZONE;
      let vx = 0;
      let vy = 0;

      if (magH > 0 || magV > 0) {
        const normH = magH / (1 - RIGHT_STICK_DEADZONE);
        const normV = magV / (1 - RIGHT_STICK_DEADZONE);
        const m = Math.min(1, Math.sqrt(normH * normH + normV * normV));
        const speed = virtualMouseSpeed(m);
        vx = Math.sign(rightH) * speed;
        vy = Math.sign(rightV) * speed;
      }

      if (vx !== 0 || vy !== 0) {
        // Auto-reveal cursor on first stick motion after a Y-toggle-off.
        if (!vm.visible) vm.visible = true;
        vm.moving = true;
        vm.lastInputMs = now;
        vm.x = Math.max(0, Math.min(window.innerWidth, vm.x + vx * dtSec));
        vm.y = Math.max(
          0,
          Math.min(window.innerHeight, vm.y + vy * dtSec),
        );
      } else {
        vm.moving = false;
      }
      prevRightAxesRef.current = { h: rightH, v: rightV };

      // ── A button (index 0) → click at cursor (if visible) or ──
      //    activate focused element (legacy mode).
      const aPressed = gp.buttons[0]?.pressed ?? false;
      if (aPressed && !prevButtonsRef.current.a) {
        if (vm.visible) {
          const el = document.elementFromPoint(vm.x, vm.y);
          if (el) {
            dispatchMouse("mousedown", vm.x, vm.y, 0);
            dispatchMouse("mouseup", vm.x, vm.y, 0);
            dispatchMouse("click", vm.x, vm.y, 0);
          }
          vm.lastInputMs = now;
        } else if (focusedRef.current) {
          const entry = entriesRef.current.find(
            (e) => e.element === focusedRef.current,
          );
          if (entry) entry.onActivate();
        }
      }
      prevButtonsRef.current.a = aPressed;

      // ── B button (index 1) → history.back ─────────────────
      const bPressed = gp.buttons[1]?.pressed ?? false;
      if (bPressed && !prevButtonsRef.current.b) {
        if (window.history.length > 1) window.history.back();
      }
      prevButtonsRef.current.b = bPressed;

      // ── X button (index 2) → keyboard Escape ───────────────
      // Closes dialogs/popovers/modals that listen for Escape, even
      // when the cursor can't easily reach their corner X button.
      const xPressed = gp.buttons[2]?.pressed ?? false;
      if (xPressed && !prevButtonsRef.current.x) {
        dispatchKey("Escape");
      }
      prevButtonsRef.current.x = xPressed;

      // ── Y button (index 3) → toggle virtual cursor visibility
      const yPressed = gp.buttons[3]?.pressed ?? false;
      if (yPressed && !prevButtonsRef.current.y) {
        vm.visible = !vm.visible;
        vm.lastInputMs = now;
      }
      prevButtonsRef.current.y = yPressed;

      // ── LB (button 4) → BigScreenNav cycle back ────────────
      const lbPressed = gp.buttons[4]?.pressed ?? false;
      if (lbPressed && !prevButtonsRef.current.lb) {
        tabCyclerRef.current?.("back");
      }
      prevButtonsRef.current.lb = lbPressed;

      // ── RB (button 5) → BigScreenNav cycle forward ─────────
      const rbPressed = gp.buttons[5]?.pressed ?? false;
      if (rbPressed && !prevButtonsRef.current.rb) {
        tabCyclerRef.current?.("forward");
      }
      prevButtonsRef.current.rb = rbPressed;

      // ── LT (button 6) → hold right mouse button ────────────
      // Triggers are analog: value 0..1. Use the value field when
      // present so analog-actuated clicks (light tap → right click)
      // also fire. Falls back to `pressed` boolean for digital-only
      // controllers (e.g. 8BitDo SN30).
      const ltRaw = gp.buttons[6]?.value ?? (gp.buttons[6]?.pressed ? 1 : 0);
      const ltPressed = ltRaw > TRIGGER_THRESHOLD;
      if (ltPressed && !prevButtonsRef.current.lt) {
        if (vm.visible) {
          dispatchMouse("mousedown", vm.x, vm.y, 2);
          dispatchMouse("contextmenu", vm.x, vm.y, 2);
          vm.rightDown = true;
          vm.lastInputMs = now;
        }
      } else if (!ltPressed && prevButtonsRef.current.lt) {
        if (vm.visible && vm.rightDown) {
          dispatchMouse("mouseup", vm.x, vm.y, 2);
          vm.rightDown = false;
        }
      }
      prevButtonsRef.current.lt = ltPressed;

      // ── RT (button 7) → hold left mouse button ─────────────
      const rtRaw = gp.buttons[7]?.value ?? (gp.buttons[7]?.pressed ? 1 : 0);
      const rtPressed = rtRaw > TRIGGER_THRESHOLD;
      if (rtPressed && !prevButtonsRef.current.rt) {
        if (vm.visible) {
          dispatchMouse("mousedown", vm.x, vm.y, 0);
          vm.leftDown = true;
          vm.lastInputMs = now;
        }
      } else if (!rtPressed && prevButtonsRef.current.rt) {
        if (vm.visible && vm.leftDown) {
          dispatchMouse("mouseup", vm.x, vm.y, 0);
          vm.leftDown = false;
        }
      }
      prevButtonsRef.current.rt = rtPressed;

      // ── R3 (right-stick click, varies 10/11) → recenter ─────
      const r3Pressed =
        gp.buttons[10]?.pressed || gp.buttons[11]?.pressed || false;
      if (r3Pressed && !prevButtonsRef.current.r3) {
        vm.x = window.innerWidth / 2;
        vm.y = window.innerHeight / 2;
        vm.lastInputMs = now;
        if (!vm.visible) vm.visible = true;
      }
      prevButtonsRef.current.r3 = r3Pressed;

      // ── L3 (left-stick click, button 9) → hide cursor ───────
      // Releases any held mouse buttons so drag operations don't
      // get stuck if the user hides the cursor mid-drag.
      const l3Pressed = gp.buttons[9]?.pressed ?? false;
      if (l3Pressed && !prevButtonsRef.current.l3) {
        if (vm.leftDown) dispatchMouse("mouseup", vm.x, vm.y, 0);
        if (vm.rightDown) dispatchMouse("mouseup", vm.x, vm.y, 2);
        vm.leftDown = false;
        vm.rightDown = false;
        vm.visible = false;
      }
      prevButtonsRef.current.l3 = l3Pressed;

      publishVirtualMouse();
      rafId = requestAnimationFrame(poll);
    }

    rafId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafId);
  }, [enabled, connected]);

  // ── Cleanup ────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      for (const entry of entriesRef.current) {
        entry.element.removeAttribute("data-focused");
      }
    };
  }, []);

  return {
    connected,
    focusedElement,
    registerAction,
    virtualMouse,
    toggleVirtualMouse,
    recenterVirtualMouse,
    registerTabCycler,
  };
}

// Tuning constants and types live in `./gamepad/gamepadUtils` and
// are imported by name from there when a consumer needs them — no
// re-exports here to avoid a second import surface.