// FocusRing — a floating animated ring that highlights the
// currently focused element in Big Screen Mode. Renders as a portal
// overlay that tracks the focused element's bounding rect and
// smoothly transitions between positions.
//
// PS5-inspired design: a rounded rectangle with a glowing accent
// border, subtle corner accents, and a pulsing shadow. The ring
// uses CSS transition on `left/top/width/height` with
// `var(--ease-bounce)` for a satisfying controller-navigation feel.
//
// Optimisation: the rAF loop compares the new bounding rect with
// the previous one and only calls setState when they differ,
// avoiding unnecessary re-renders on every frame.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GamepadState } from "../../hooks/useGamepad";

interface FocusRingProps {
  gamepad: GamepadState;
}

function rectsEqual(a: DOMRect | null, b: DOMRect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height
  );
}

export default function FocusRing({ gamepad }: FocusRingProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const prevRectRef = useRef<DOMRect | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    function update() {
      const el = gamepad.focusedElement;
      if (el) {
        const r = el.getBoundingClientRect();
        const pad = 6;
        const nextRect = {
          left: r.left - pad,
          top: r.top - pad,
          width: r.width + pad * 2,
          height: r.height + pad * 2,
        } as DOMRect;

        if (!rectsEqual(nextRect, prevRectRef.current)) {
          prevRectRef.current = nextRect;
          setRect(nextRect);
        }
      } else if (prevRectRef.current !== null) {
        prevRectRef.current = null;
        setRect(null);
      }
      rafRef.current = requestAnimationFrame(update);
    }

    rafRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafRef.current);
  }, [gamepad]);

  if (!rect) return null;

  return createPortal(
    <div
      className="focus-ring-overlay"
      style={{
        position: "fixed",
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        pointerEvents: "none",
        zIndex: 9000,
      }}
      aria-hidden="true"
    >
      <div className="focus-ring-glow" />
      <div className="focus-ring-corner focus-ring-corner--tl" />
      <div className="focus-ring-corner focus-ring-corner--tr" />
      <div className="focus-ring-corner focus-ring-corner--bl" />
      <div className="focus-ring-corner focus-ring-corner--br" />
    </div>,
    document.body,
  );
}
