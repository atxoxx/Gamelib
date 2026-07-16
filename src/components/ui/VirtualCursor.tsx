// VirtualCursor — portal-based overlay that renders the on-screen
// virtual mouse pointer driven by the right stick. Renders only when
// the cursor is visible (auto-shown by stick motion, toggled by Y,
// hidden by L3 or gamepad disconnect).
//
// Design choices for ergonomics:
//   • 24×24 px pointer SVG with a 4 px hot-spot ring so users know
//     where the "click" lands even at a glance.
//   • Gentle breathing pulse when idle (opacity 0.7 → 0.85 → 0.7)
//     so the cursor is locatable without being noisy.
//   • Idle fade: opacity drops to 0.45 after 2.5 s of inactiv ity so
//     the cursor doesn't visually compete with on-screen content
//     while the user is reading.
//   • Drag indicator: an outer ring fills to 60 % opacity while RT/LT
//     is held, providing tactile feedback that a click-and-drag is
//     in flight.
//   • `pointer-events: none` so the cursor never swallows real mouse
//     events; clicks are dispatched programmatically from the
//     polling loop.
//
// Reduced motion: the breathing pulse is suppressed when the user
// has prefers-reduced-motion enabled.

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { GamepadState } from "../../hooks/useGamepad";

interface VirtualCursorProps {
  gamepad: GamepadState;
}

const IDLE_FADE_MS = 2500;
const MIN_OPACITY = 0.45;
const IDLE_BREATH_OPACITY = 0.85;
const ACTIVE_OPACITY = 1.0;
const DRAG_OPACITY = 0.7;

/**
 * Smooth cursor motion via rAF. The state value comes from the
 * polling loop at 60 Hz (or whatever the display refresh is), so
 * interpolation isn't strictly needed — but we rAF-update anyway so
 * the position can track sub-frame changes (window resize, etc.)
 * without forcing a VirtualCursor re-render at every poll tick.
 *
 * The visual transform is `translate3d(x, y, 0)` which the GPU
 * composes without invalidating layout. Coupled with the smooth CSS
 * transition on the `<div class="virtual-cursor">` element, the
 * motion feels continuous even though the poll only updates state.
 */
export default function VirtualCursor({ gamepad }: VirtualCursorProps) {
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const lastRenderRef = useRef<{ x: number; y: number; ts: number }>({
    x: -1,
    y: -1,
    ts: 0,
  });

  // Idle fade tracking — separate from x/y because we want the
  // breathing idle pulse to keep ticking on the render thread even
  // when the cursor hasn't moved.
  const fadeRef = useRef<number>(0); // 1.0 = full opacity, 0 = min

  useEffect(() => {
    let rafId: number;

    function tick() {
      const cur = gamepad.virtualMouse;
      if (!cur.visible || typeof document === "undefined") {
        rafId = requestAnimationFrame(tick);
        return;
      }

      // ── Cursor position update via transform ────────────────
      const el = cursorRef.current;
      if (el) {
        if (
          cur.x !== lastRenderRef.current.x ||
          cur.y !== lastRenderRef.current.y
        ) {
          el.style.transform = `translate3d(${cur.x - 4}px, ${cur.y - 3}px, 0)`;
          lastRenderRef.current = { x: cur.x, y: cur.y, ts: performance.now() };
        }
        // ── Opacity (idle fade + drag indicator) ─────────────
        const now = performance.now();
        const idleMs = now - cur.lastInputMs;
        const isDragging = cur.leftDown || cur.rightDown;

        let target: number;
        if (isDragging || cur.moving) {
          target = ACTIVE_OPACITY;
        } else if (idleMs < IDLE_FADE_MS) {
          // Gentle breathing pulse when recently active but not moving.
          target = IDLE_BREATH_OPACITY;
        } else {
          target = MIN_OPACITY;
        }

        // Smooth the opacity change over ~120 ms for a soft transition.
        const prev = fadeRef.current;
        const next = prev + (target - prev) * 0.18;
        fadeRef.current = next;
        el.style.opacity = String(next);

        // Drag ring pulse — toggles a secondary class for the
        // outer ring's animated glow during click-and-drag.
        el.classList.toggle("virtual-cursor--dragging", isDragging);
        if (isDragging) el.style.setProperty("--drag-opacity", String(DRAG_OPACITY));
      }

      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [gamepad]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={cursorRef}
      className="virtual-cursor"
      style={{ opacity: 0 }}
      aria-hidden="true"
    >
      <div className="virtual-cursor-body" />
      <div className="virtual-cursor-hot" />
      <div className="virtual-cursor-ring virtual-cursor-ring--drag" />
    </div>,
    document.body,
  );
}
