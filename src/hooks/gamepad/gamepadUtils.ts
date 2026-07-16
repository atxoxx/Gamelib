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

/** Treat zero-area elements as not navigable. */
export function isVisible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

export interface FocusableCandidate {
  element: HTMLElement;
  onActivate: () => void;
}

/** Viewport rectangle helper (used to deprioritize off-screen items). */
function viewportRect(): { top: number; bottom: number; left: number; right: number } {
  return {
    top: 0,
    left: 0,
    bottom: typeof window !== "undefined" ? window.innerHeight : Infinity,
    right: typeof window !== "undefined" ? window.innerWidth : Infinity,
  };
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
 *   • Among the in-cone candidates, picks the nearest by a weighted
 *     distance that penalizes angular deviation AND cross-axis
 *     offset, so an element that is mostly "above" is clearly
 *     preferred over one that is mostly "up-and-way-to-the-right"
 *     when pressing UP — this is what keeps navigation from
 *     drifting sideways in dense grids.
 *   • Off-screen candidates are scored with a large penalty but
 *     still reachable as a last resort, so the focus never gets
 *     permanently stuck when every on-screen candidate has been
 *     exhausted.
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
  viewport: { top: number; bottom: number; left: number; right: number },
): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestDist = Infinity;

  // Unit vector for the pressed direction — used to compute how far
  // the candidate lies *along* the press axis vs. how far it strays
  // *across* it (cross-axis error).
  const dirX = Math.cos(dirAngle);
  const dirY = Math.sin(dirAngle);

  for (const entry of candidates) {
    if (entry.element === current) continue;
    if (!isVisible(entry.element)) continue;

    const c = center(entry.element);

    // Vector from current center to candidate center.
    const dx = c.x - cur.x;
    const dy = c.y - cur.y;

    // Skip candidates that are actually *behind* the press direction
    // (dot product <= 0 means no forward progress). This prevents
    // wrapping back to the element you just came from.
    const forward = dx * dirX + dy * dirY;
    if (forward <= 0) continue;

    const a = Math.atan2(dy, dx);

    // Normalize to (-π, π] for the shortest signed delta.
    let delta = a - dirAngle;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;

    if (Math.abs(delta) > toleranceRad) continue;

    // Cross-axis (perpendicular) offset — strongly penalized so a
    // press of UP lands on the nearest card *above*, not a far
    // diagonal one.
    const cross = Math.abs(dx * -dirY + dy * dirX);
    const sinDelta = Math.sin(delta);

    // Base distance along the forward axis.
    const dForward = Math.max(1, forward);

    // Weighted cost: prefer short forward distance + tight angle +
    // small cross-axis error. The cross-axis term is the key fix
    // for sideways drift in rails/grids.
    let cost = dForward * (1.0 + 2.0 * sinDelta * sinDelta) + cross * 1.5;

    // Large penalty for candidates fully outside the viewport so
    // on-screen items win, but off-screen targets remain reachable.
    const r = entry.element.getBoundingClientRect();
    const offscreen =
      r.bottom < viewport.top ||
      r.top > viewport.bottom ||
      r.right < viewport.left ||
      r.left > viewport.right;
    if (offscreen) cost += 1_000_000;

    if (cost < bestDist) {
      bestDist = cost;
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
 *   • Computes a weighted distance that penalizes both angular
 *     deviation and cross-axis offset.
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
  const viewport = viewportRect();

  // First pass: tight tolerance, on-screen + off-screen allowed.
  const tightMatch = findCandidate(
    cur,
    current,
    candidates,
    dirAngle,
    (Math.PI / 180) * 45,
    viewport,
  );
  if (tightMatch) return tightMatch;

  // Second pass fallback: wide tolerance (helps in sparse layouts
  // where nothing lands in the tight cone).
  return findCandidate(
    cur,
    current,
    candidates,
    dirAngle,
    (Math.PI / 180) * 85,
    viewport,
  );
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