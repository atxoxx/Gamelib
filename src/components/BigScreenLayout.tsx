// BigScreenLayout — full-viewport layout for Big Screen Mode.
// Replaces the standard AppLayout (TopNav + Sidebar + MainContent
// grid) with:
//
//   ┌─────────────────────────────────────────┐
//   │  [🖥️ Exit Big Screen]  (floating button) │
//   │                                          │
//   │  <Outlet />  (page content, full width)  │
//   │                                          │
//   │  BigScreenNav  (fixed bottom bar)        │
//   │  FocusRing     (controller focus ring)   │
//   │  VirtualCursor (right-stick pointer)     │
//   │  GamepadHint   (live button-mapping card)│
//   └─────────────────────────────────────────┘
//
// As of PR 1, the <GamepadProvider> sits at the App root (App.tsx)
// with `enabled={isBigScreen}` — so this layout no longer mounts
// it. `useGamepad()` is safe to call here because the provider
// ancestor is always present.

import { Outlet } from "react-router-dom";
import BigScreenNav from "./BigScreenNav";
import FocusRing from "./ui/FocusRing";
import VirtualCursor from "./ui/VirtualCursor";
import GamepadHint from "./ui/GamepadHint";
import { useBigScreen } from "../hooks/useBigScreen";
import { useGamepad } from "../hooks/GamepadProvider";

export default function BigScreenLayout() {
  const { setBigScreen } = useBigScreen();
  const gamepad = useGamepad();

  return (
    <div className="bigscreen-layout" data-bigscreen="true">
      {/* Floating exit button */}
      <button
        className="bigscreen-exit-btn"
        onClick={() => setBigScreen(false)}
        aria-label="Exit Big Screen Mode"
        title="Exit Big Screen Mode"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
        <span>Exit Big Screen</span>
      </button>

      {/* Main content area */}
      <main className="bigscreen-main">
        <Outlet />
      </main>

      {/* Bottom navigation bar */}
      <BigScreenNav />

      {/* Controller focus ring overlay */}
      <FocusRing gamepad={gamepad} />

      {/* Virtual mouse pointer (right stick) */}
      <VirtualCursor gamepad={gamepad} />

      {/* Live button-mapping legend (low-opacity reference card) */}
      <GamepadHint gamepad={gamepad} />
    </div>
  );
}