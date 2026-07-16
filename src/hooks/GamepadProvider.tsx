// GamepadProvider — React context + provider that wraps
// `useGamepadInternal` into a shared singleton for Big Screen Mode.
//
// As of PR 1, this provider is mounted at the App root (see
// `App.tsx`), NOT inside `BigScreenLayout` — and accepts an
// `enabled` prop that gates the rAF polling loop. This means:
//
//   • `useGamepad()` is safe to call from anywhere in the tree,
//     on Big Screen or on desktop. No try/catch fallback needed.
//   • When `enabled={false}` (i.e. Big Screen Mode is off), the
//     rAF loop sleeps — zero per-frame work on desktop.
//   • The focus registry + virtual mouse are still reachable but
//     inert until `enabled` flips to true.
//
// Consumers should use `useGamepad()` (renamed from `useGamepadCtx`
// for clarity) — `useGamepadCtx` is kept as a deprecated alias for
// one release to ease migration.

import { createContext, useContext, type ReactNode } from "react";
import {
  useGamepadInternal,
  type GamepadState,
} from "./useGamepad";

const GamepadCtx = createContext<GamepadState | null>(null);

export interface GamepadProviderProps {
  children: ReactNode;
  /**
   * When `false`, the rAF polling loop sleeps and the returned
   * `GamepadState` reports `connected: false` with no registered
   * focusables. Safe default for desktop mode — flipping to
   * `true` wakes the loop on the next animation frame.
   */
  enabled?: boolean;
}

export function GamepadProvider({
  children,
  enabled = true,
}: GamepadProviderProps) {
  const gamepad = useGamepadInternal(enabled);
  return (
    <GamepadCtx.Provider value={gamepad}>{children}</GamepadCtx.Provider>
  );
}

/**
 * Read the shared gamepad state. Throws if no `<GamepadProvider>`
 * ancestor is mounted — same idiom as React's built-in `useContext`.
 *
 * This replaces the old `useBigScreenHook().gamepad` accessor AND
 * the old `useGamepadCtx` name (kept as a deprecated alias).
 */
export function useGamepad(): GamepadState {
  const ctx = useContext(GamepadCtx);
  if (!ctx) {
    throw new Error(
      "useGamepad must be used within a GamepadProvider. " +
        "If you're seeing this on a non-big-screen page, the " +
        "GamepadProvider mount moved to App.tsx in PR 1 — check " +
        "that App.tsx still wraps Routes in <GamepadProvider>.",
    );
  }
  return ctx;
}

/**
 * @deprecated Use `useGamepad` from this same file. Kept as an
 * alias for one release so existing imports don't break mid-PR.
 */
export const useGamepadCtx = useGamepad;