// gamepadUtils — pure helpers used by useGamepad's polling loop.
// ─────────────────────────────────────────────────────────────
//
// Lifted out of `useGamepad.ts` so the spatial-navigation geometry,
// virtual-mouse physics, and synthetic-event dispatchers can be
// unit-tested in isolation without React. The rAF loop itself
// stays in `useGamepad.ts` because its per-frame button-delta
// detection (`prevButtonsRef`) and ref-mutation patterns are
// tightly coupled and don't survive being split across hooks.
//
// Adding new constants? Add them next to the related function so
// the relationship between math and tuning lives in one place.

// ── Spatial-navigation geometry ─────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

/** Center of an element's bounding rect in viewport coords. */
export function center(el: HTMLElement): Point {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Angle from `from` to `to` in radians (atan2). */
export function angle(from: Point, to: Point): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/** Treat zero-area elements as not navigable. */
export function isVisible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** Squared distance helper. */
function distSquared(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export interface FocusableCandidate {
  element: HTMLElement;
  onActivate: () => void;
}

/**
 * Nearest-in-direction picker.
 *
 *   • Iterates all registered focusables.
 *   • Skips the current element and any zero-area element
 *     (collapsed menus, hidden modals).
 *   • Picks the one whose center-to-center angle from `current`
 *     falls within ±45° of `dirAngle` (45° tolerance means an
 *     8-way directional scan).
 *   • Among the in-cone candidates, picks the nearest by squared
 *     distance.
 *
 * Returned element is the closest "in the direction the user
 * pressed" — same heuristic the Xbox system UI uses for spatial
 * navigation.
 */
function findCandidate(
  cur: Point,
  current: HTMLElement,
  candidates: FocusableCandidate[],
  dirAngle: number,
  toleranceRad: number,
): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestDist = Infinity;

  for (const entry of candidates) {
    if (entry.element === current) continue;
    if (!isVisible(entry.element)) continue;

    const a = angle(cur, center(entry.element));

    // Normalize to (-π, π] for the shortest signed delta.
    let delta = a - dirAngle;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;

    if (Math.abs(delta) > toleranceRad) continue;

    // Weighted distance: penalize angular deviation to favor elements directly in line.
    // Weighted distance = distSquared * (1 + 2 * sin^2(delta))
    const dRaw = distSquared(cur, center(entry.element));
    const sinDelta = Math.sin(delta);
    const d = dRaw * (1.0 + 2.0 * sinDelta * sinDelta);

    if (d < bestDist) {
      bestDist = d;
      best = entry.element;
    }
  }

  return best;
}

/**
 * Nearest-in-direction picker.
 *
 *   • Iterates all registered focusables.
 *   • Skips the current element and any zero-area element
 *     (collapsed menus, hidden modals).
 *   • Performs a two-pass scan (first tight ±45° tolerance, then falling
 *     back to a wider ±85° tolerance if no candidates match) to avoid
 *     navigation getting stuck in complex grids.
 *   • Computes a weighted distance that penalizes angular deviation.
 *
 * Returned element is the closest "in the direction the user
 * pressed".
 */
export function nearestInDirection(
  current: HTMLElement,
  candidates: FocusableCandidate[],
  dirAngle: number,
): HTMLElement | null {
  const cur = center(current);

  // First pass: tight tolerance
  const tightMatch = findCandidate(cur, current, candidates, dirAngle, (Math.PI / 180) * 45);
  if (tightMatch) return tightMatch;

  // Second pass fallback: wide tolerance
  return findCandidate(cur, current, candidates, dirAngle, (Math.PI / 180) * 85);
}

// ── Virtual-mouse physics ───────────────────────────────────────

/** Past this fraction of stick deflection, the cursor starts moving. */
export const RIGHT_STICK_DEADZONE = 0.18;
/** Stick deflection below this is treated as zero for left stick too. */
export const STICK_DEADZONE = 0.2;

/** Cursor speed at the deadzone threshold (px/s). Slow & precise. */
export const VIRTUAL_MOUSE_MIN_SPEED = 250;
/** Cursor speed at full stick tilt (px/s). Fast cross-screen traverse. */
export const VIRTUAL_MOUSE_MAX_SPEED = 1800;

/**
 * Non-linear acceleration: speed = min + (max - min) * m^1.4.
 *
 * The 1.4 exponent gives a comfortable ramp so small stick deflection
 * is slow and precise (~250 px/s) and full tilt is fast
 * (~1800 px/s) without feeling twitchy in either regime.
 *
 * `m` is the magnitude in [0, 1] past the deadzone.
 */
export function virtualMouseSpeed(m: number): number {
  return (
    VIRTUAL_MOUSE_MIN_SPEED +
    (VIRTUAL_MOUSE_MAX_SPEED - VIRTUAL_MOUSE_MIN_SPEED) *
      Math.pow(Math.max(0, Math.min(1, m)), 1.4)
  );
}

/** Cap delta-time at 100 ms so a debugger pause can't teleport the cursor. */
export const MAX_FRAME_DT_SEC = 0.1;
/** First-frame Δt guess before the second poll tick has real timing. */
export const FIRST_FRAME_DT_MS = 16;

/** Trigger pulls past this fraction count as a press. */
export const TRIGGER_THRESHOLD = 0.4;

// ── Synthetic event dispatch ────────────────────────────────────

/**
 * Dispatch a synthetic MouseEvent on the topmost element at (x, y).
 * Used by the polling loop to translate gamepad inputs into click
 * events that the React tree already handles natively.
 */
export function dispatchMouse(
  type: "mousedown" | "mouseup" | "click" | "contextmenu" | "mousemove",
  x: number,
  y: number,
  button: number,
  leftDown = false,
  rightDown = false,
): void {
  if (typeof document === "undefined") return;
  const target = document.elementFromPoint(x, y);
  if (!target) return;

  let buttons = 0;
  if (leftDown) buttons |= 1;
  if (rightDown) buttons |= 2;

  if (type === "mousedown") {
    buttons |= (button === 0 ? 1 : button === 2 ? 2 : 0);
  } else if (type === "mouseup") {
    buttons &= ~(button === 0 ? 1 : button === 2 ? 2 : 0);
  }

  const init: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    button,
    buttons,
    clientX: x,
    clientY: y,
    screenX: x,
    screenY: y,
  };
  target.dispatchEvent(new MouseEvent(type, init));
}

/**
 * Dispatch a synthetic keyboard event to BOTH window and document.
 *
 * react-hotkeys, react-modal, dialog primitives, and Tauri-injected
 * keymaps split their listeners between window and document, so
 * firing on both is the only way to reliably reach every Escape
 * handler from a gamepad X button.
 */
export function dispatchKey(key: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }
  const init: KeyboardEventInit = {
    key,
    bubbles: true,
    cancelable: true,
  };
  for (const target of [window, document]) {
    target.dispatchEvent(new KeyboardEvent("keydown", init));
    target.dispatchEvent(new KeyboardEvent("keyup", init));
  }
}