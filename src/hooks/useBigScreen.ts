// useBigScreen — thin re-export of the BigScreenContext hook.
//
// As of PR 1, this module is a one-liner. The old `useBigScreenHook`
// mega-hook (which mixed the layout toggle, the gamepad context, and
// a `focusableProps` factory behind a try/catch stub) has been
// broken up:
//
//   • `useBigScreen()`        — just the layout toggle (this file).
//   • `useGamepad()`          — gamepad state, throws if not in
//                               provider. Imported from
//                               `./GamepadProvider`.
//   • `useFocusable(onActivate)` — register a focusable element.
//                                  Imported from `./useFocusable`.
//
// Consumers should pick the focused hook they need rather than
// re-aggregating here.

export { useBigScreen } from "../context/BigScreenContext";