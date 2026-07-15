// GamepadProvider — React context + provider that wraps
// `useGamepadInternal` into a shared singleton for Big Screen Mode.
//
// BigScreenLayout wraps its subtree in <GamepadProvider> so
// BigScreenNav, BigScreenGameCard, FocusRing, and any page
// component all share the same gamepad instance — one focus
// registry, one focused element.
//
// This file is `.tsx` because it contains JSX (the provider).
// The hook itself lives in `./useGamepad.ts` (pure TypeScript).

import { createContext, useContext, type ReactNode } from "react";
import {
  useGamepadInternal,
  type GamepadState,
} from "./useGamepad";

const GamepadCtx = createContext<GamepadState | null>(null);

export function GamepadProvider({ children }: { children: ReactNode }) {
  const gamepad = useGamepadInternal(true);
  return (
    <GamepadCtx.Provider value={gamepad}>
      {children}
    </GamepadCtx.Provider>
  );
}

export function useGamepadCtx(): GamepadState {
  const ctx = useContext(GamepadCtx);
  if (!ctx) {
    throw new Error(
      "useGamepadCtx must be used within a GamepadProvider",
    );
  }
  return ctx;
}
