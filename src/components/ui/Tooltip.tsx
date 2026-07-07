import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type TooltipPlacement = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  /** The element that triggers the tooltip on hover/focus. */
  children: ReactNode;
  /** Tooltip content. */
  content: ReactNode;
  /** Preferred placement (flips top↔bottom if no room). */
  placement?: TooltipPlacement;
  /** Delay before showing, in ms. */
  delay?: number;
  /** Max width for the tooltip bubble. */
  maxWidth?: number;
}

const TOOLTIP_ID = "ui-tooltip-active";

export function Tooltip({
  children,
  content,
  placement = "top",
  delay = 400,
  maxWidth = 240,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [flipped, setFlipped] = useState<TooltipPlacement>(placement);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Clean up pending timer on unmount
  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Default: position above
      let x = rect.left + rect.width / 2;
      let y = rect.top - 8;
      let actualPlacement = placement;

      // Simple flip logic — prefer the chosen placement, fall back to opposite
      const spaceAbove = rect.top;
      if (placement === "top" && spaceAbove < 64) {
        actualPlacement = "bottom";
        y = rect.bottom + 8;
      }

      setFlipped(actualPlacement);
      setPos({ x, y });
      setVisible(true);
    }, delay);
  }, [placement, delay]);

  const hide = useCallback(() => {
    clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  const tooltip = visible ? (
    <div
      className={`ui-tooltip ui-tooltip--${flipped}`}
      style={{
        left: pos.x,
        top: pos.y,
        maxWidth,
      }}
      role="tooltip"
      id={TOOLTIP_ID}
    >
      <div className="ui-tooltip__arrow" />
      <div className="ui-tooltip__content">{content}</div>
    </div>
  ) : null;

  return (
    <>
      <span
        ref={triggerRef}
        className="ui-tooltip__trigger"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        aria-describedby={visible ? TOOLTIP_ID : undefined}
      >
        {children}
      </span>
      {createPortal(tooltip, document.body)}
    </>
  );
}
