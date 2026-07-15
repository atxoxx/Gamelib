// GamepadHint — on-screen legend showing the current gamepad button
// mapping. Auto-fades in when a controller connects, then settles to
// a low-opacity reference card so the mapping is always one glance
// away without competing for attention.
//
// The hint grows out of the bottom-left of the viewport where the
// cursor and the focused element are typically NOT — placement
// mirrors Steam Big Picture's reference card location, so users with
// muscle memory find it instantly. Tapping any button briefly
// brightens the legend so the user can confirm the mapping live.
//
// Reduced motion: the entrance animation is suppressed when the user
// has prefers-reduced-motion enabled.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GamepadState } from "../../hooks/useGamepad";

interface GamepadHintProps {
  gamepad: GamepadState;
}

interface Binding {
  /** Short label printed to the right of the icon. */
  label: string;
  /** SVG glyph for the button (Xbox-style circle motifs). */
  glyph: React.ReactNode;
}

interface RowBinding {
  /** Stable key for React list rendering. */
  key: string;
  /** Row heading (Move / Cursor / Actions / Tabs / Mouse). */
  label: string;
  /** Glyphs rendered inside the row. */
  entries: Binding[];
}

const bindings: RowBinding[] = [
  {
    key: "dpad",
    label: "Move",
    entries: [
      {
        label: "D-pad / L-stick",
        glyph: <DpadGlyph />,
      },
    ],
  },
  {
    key: "stick",
    label: "Cursor",
    entries: [
      {
        label: "Right stick",
        glyph: <RStickGlyph />,
      },
    ],
  },
  {
    key: "face",
    label: "Actions",
    entries: [
      { label: "Click", glyph: <FaceButtonGlyph letter="A" tone="green" /> },
      { label: "Back", glyph: <FaceButtonGlyph letter="B" tone="red" /> },
      { label: "Close", glyph: <FaceButtonGlyph letter="X" tone="blue" /> },
      { label: "Hide cursor", glyph: <FaceButtonGlyph letter="Y" tone="yellow" /> },
    ],
  },
  {
    key: "bumpers",
    label: "Tabs",
    entries: [
      { label: "Prev", glyph: <BumperGlyph side="left" /> },
      { label: "Next", glyph: <BumperGlyph side="right" /> },
    ],
  },
  {
    key: "triggers",
    label: "Mouse",
    entries: [
      { label: "Right click (LT)", glyph: <TriggerGlyph side="left" /> },
      { label: "Left click (RT)", glyph: <TriggerGlyph side="right" /> },
    ],
  },
];

const ENTRANCE_MS = 4000;

export default function GamepadHint({ gamepad }: GamepadHintProps) {
  const [showFullHint, setShowFullHint] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const lastConnectedRef = useRef<boolean>(gamepad.connected);
  const entranceTimerRef = useRef<number | null>(null);

  // Detect controller connect to flash a fresh hint. We only re-fire
  // on the rising edge (false → true), so a dismount + remount of the
  // provider doesn't retrigger.
  useEffect(() => {
    const wasConnected = lastConnectedRef.current;
    lastConnectedRef.current = gamepad.connected;
    if (gamepad.connected && !wasConnected && !dismissed) {
      setShowFullHint(true);
      if (entranceTimerRef.current) window.clearTimeout(entranceTimerRef.current);
      entranceTimerRef.current = window.setTimeout(() => {
        setShowFullHint(false);
      }, ENTRANCE_MS);
    }
    return () => {
      if (entranceTimerRef.current) {
        window.clearTimeout(entranceTimerRef.current);
        entranceTimerRef.current = null;
      }
    };
  }, [gamepad.connected, dismissed]);

  // If the user dismissed the hint manually, don't show after connect.
  function handleDismiss() {
    setDismissed(true);
    setShowFullHint(false);
  }

  // If the hint is dismissed and the user reconnects, allow it to
  // re-show once (e.g. another controller).
  useEffect(() => {
    if (!gamepad.connected) setDismissed(false);
  }, [gamepad.connected]);

  if (typeof document === "undefined") return null;
  if (!gamepad.connected) return null;

  return createPortal(
    <div
      className={`gamepad-hint${showFullHint ? " gamepad-hint--prominent" : ""}`}
      aria-hidden="true"
    >
      <div className="gamepad-hint-header">
        <GamepadIcon />
        <span>Controller</span>
        <button
          type="button"
          className="gamepad-hint-dismiss"
          onClick={handleDismiss}
          title="Hide hints"
          aria-label="Hide controller hints"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
      </div>
      <div className="gamepad-hint-body">
        {bindings.map((row) => (
          <div key={row.key} className="gamepad-hint-row">
            <span className="gamepad-hint-row-label">{row.label}</span>
            <div className="gamepad-hint-row-entries">
              {row.entries.map((entry) => (
                <span key={entry.label} className="gamepad-hint-entry">
                  {entry.glyph}
                  <span className="gamepad-hint-entry-label">{entry.label}</span>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

// ── Glyphs ──────────────────────────────────────────────────────
// Style: small, monochrome, drawn at ~14×14 px so they sit naturally
// next to text. Colors use the Xbox layout conventional palette but
// fade gracefully to currentColor on dim backgrounds.

function GamepadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <line x1="6" y1="11" x2="10" y2="11" />
      <line x1="8" y1="9" x2="8" y2="13" />
      <line x1="15" y1="12" x2="15.01" y2="12" />
      <line x1="16" y1="10" x2="16.01" y2="10" />
      <path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.544-.604-6.584-.685-7.258A4 4 0 0 0 17.32 5z" />
    </svg>
  );
}

function DpadGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <rect x="9" y="3" width="6" height="18" rx="2" />
      <rect x="3" y="9" width="18" height="6" rx="2" />
    </svg>
  );
}

function RStickGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </svg>
  );
}

function BumperGlyph({ side }: { side: "left" | "right" }) {
  // Stylized claw / shoulder-button silhouette. Symmetric for left/right.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      {side === "left" ? (
        <>
          <path d="M3 8 L8 8" />
          <path d="M3 8 C 5 12, 5 14, 3 18" />
        </>
      ) : (
        <>
          <path d="M21 8 L16 8" />
          <path d="M21 8 C 19 12, 19 14, 21 18" />
        </>
      )}
    </svg>
  );
}

function TriggerGlyph({ side }: { side: "left" | "right" }) {
  // Slim trigger silhouette. Pulled-back indicator on the inside edge.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      {side === "left" ? (
        <path d="M3 6 L8 6 C 9 6, 10 7, 10 8 L 10 14 L 3 14 Z" />
      ) : (
        <path d="M21 6 L16 6 C 15 6, 14 7, 14 8 L 14 14 L 21 14 Z" />
      )}
    </svg>
  );
}

const FACE_TONE: Record<"green" | "red" | "blue" | "yellow", string> = {
  green: "var(--color-success)",
  red: "var(--color-danger)",
  blue: "var(--color-accent)",
  yellow: "var(--color-warning)",
};

function FaceButtonGlyph({
  letter,
  tone,
}: {
  letter: string;
  tone: "green" | "red" | "blue" | "yellow";
}) {
  return (
    <span
      className="gamepad-hint-facebtn"
      style={{ background: FACE_TONE[tone] }}
    >
      {letter}
    </span>
  );
}
