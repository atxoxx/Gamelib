// useBigScreen — convenience hook that combines BigScreenContext's
// layout toggle with the Gamepad API controller navigation state
// from the shared GamepadProvider context.
//
// BigScreenLayout provides GamepadProvider, so all children
// (BigScreenNav, BigScreenGameCard, FocusRing, pages) share the
// same focus registry and focused element via useGamepadCtx().
//
// Consumer components call `useBigScreenHook()` to get:
// - `isBigScreen`: whether the mode is active
// - `gamepad`: the shared GamepadState from context
// - `setBigScreen`: toggle the layout mode
// - `focusableProps`: helper returning spread props for
//   controller-focusable elements

import { useCallback } from "react";
import { useBigScreen as useBigScreenCtx } from "../context/BigScreenContext";
import { useGamepadCtx } from "./GamepadProvider";
import type { GamepadState } from "./useGamepad";

export interface BigScreenHook {
  isBigScreen: boolean;
  setBigScreen: (on: boolean) => void;
  gamepad: GamepadState;
  focusableProps: (
    onActivate: () => void,
  ) => {
    ref: (el: HTMLElement | null) => void;
    tabIndex: number;
    role: string;
    onClick: () => void;
  };
}

export function useBigScreenHook(): BigScreenHook {
  const { isBigScreen, setBigScreen } = useBigScreenCtx();

  // Read from the shared GamepadProvider context. Consumers no
  // longer create their own useGamepad() instance — BigScreenLayout
  // owns the single source of truth.
  let gamepad: GamepadState;
  try {
    gamepad = useGamepadCtx();
  } catch {
    // GamepadProvider not mounted yet (e.g. desktop mode). Return a
    // stub so components don't crash.
    gamepad = {
      connected: false,
      focusedElement: null,
      registerAction: () => () => {},
    };
  }

  const focusableProps = useCallback(
    (onActivate: () => void) => {
      let cleanup: (() => void) | null = null;

      return {
        ref: (el: HTMLElement | null) => {
          if (cleanup) {
            cleanup();
            cleanup = null;
          }
          if (el) {
            cleanup = gamepad.registerAction(el, onActivate);
          }
        },
        tabIndex: 0,
        role: "option",
        onClick: onActivate,
      };
    },
    [gamepad],
  );

  return { isBigScreen, setBigScreen, gamepad, focusableProps };
}
