import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  PLAY_STATUS_DETAILS,
  type Game,
  type PlayStatus,
} from "../../types/game";

/**
 * GameStatusDropdown
 *
 *  The interactive "Backlog / Playing / …" pill on the hero meta
 *  row. Click to open, click-outside / Esc to close, the menu is
 *  portaled into document.body so it escapes the `.game-hero`
 *  `overflow: hidden` clip applied for the rounded banner corners.
 *
 *  Position is recomputed from the button's bounding rect on open,
 *  scroll, and resize. A rAF coalesce keeps a fast scroll from
 *  re-rendering the entire tree for pages that aren't actively
 *  scrolling.
 *
 *  State is local to this component — the parent just provides
 *  `game` and an `onChange` callback. The parent's `updateGame`
 *  is called inside `handleSelect`.
 */

interface GameStatusDropdownProps {
  game: Game;
  onChange: (status: PlayStatus) => void;
}

export default function GameStatusDropdown({
  game,
  onChange,
}: GameStatusDropdownProps) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const positionRafRef = useRef<number | null>(null);

  const current = game.playStatus || "backlog";
  const details = PLAY_STATUS_DETAILS[current];

  function recomputeMenuPosition() {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setMenuPosition((prev) => {
      const next = {
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      };
      if (
        prev &&
        prev.top === next.top &&
        prev.left === next.left &&
        prev.width === next.width
      ) {
        return prev;
      }
      return next;
    });
  }

  function scheduleReposition() {
    if (positionRafRef.current != null) return;
    positionRafRef.current = requestAnimationFrame(() => {
      positionRafRef.current = null;
      recomputeMenuPosition();
    });
  }

  // Close the dropdown when navigating between games; otherwise the
  // portaled menu stays anchored to the previous game's button rect
  // and floats in space pointing at the new game.
  useEffect(() => {
    setOpen(false);
    setMenuPosition(null);
  }, [game.id]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (dropdownRef.current && dropdownRef.current.contains(target)) return;
      setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", scheduleReposition, true);
    window.addEventListener("resize", scheduleReposition);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", scheduleReposition, true);
      window.removeEventListener("resize", scheduleReposition);
      window.removeEventListener("keydown", handleKeyDown);
      if (positionRafRef.current != null) {
        cancelAnimationFrame(positionRafRef.current);
        positionRafRef.current = null;
      }
    };
  }, [open]);

  return (
    <div className="game-status-dropdown-container" ref={dropdownRef}>
      <button
        ref={buttonRef}
        className="game-status-selector-btn"
        onClick={() => {
          if (!open) {
            recomputeMenuPosition();
            setOpen(true);
          } else {
            setOpen(false);
          }
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span
          className="status-dot"
          style={{
            backgroundColor: details.color,
            boxShadow: `0 0 8px ${details.color}`,
          }}
        />
        <span>{details.label}</span>
        <svg
          viewBox="0 0 24 24"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform var(--transition-fast)",
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open &&
        menuPosition &&
        createPortal(
          <div
            className="game-status-dropdown-menu"
            role="listbox"
            style={{
              position: "fixed",
              top: menuPosition.top,
              left: menuPosition.left,
              minWidth: Math.max(menuPosition.width, 140),
              zIndex: 1100,
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {Object.entries(PLAY_STATUS_DETAILS).map(([key, d]) => (
              <button
                key={key}
                type="button"
                role="option"
                aria-selected={current === key}
                className={`game-status-dropdown-item ${
                  current === key ? "active" : ""
                }`}
                onClick={() => {
                  onChange(key as PlayStatus);
                  setOpen(false);
                }}
              >
                <span
                  className="status-dot"
                  style={{ backgroundColor: d.color }}
                />
                {d.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
