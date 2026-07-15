// BigScreenContext — manages the Big Screen Mode toggle, persists the
// user's preference to localStorage, and integrates with Tauri's
// fullscreen API so entering Big Screen Mode automatically makes the
// window fullscreen.
//
// Keyboard shortcuts (F11 / Ctrl+B) toggle the mode globally while
// the context is mounted. The TopNav toggle button (🖥️) calls
// setBigScreen() directly.
//
// Architecture mirrors SettingsContext: localStorage hydration on
// mount, React state for fast renders, Tauri API calls wrapped in
// try/catch so `npm run dev` in the browser doesn't crash.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const LS_BIG_SCREEN = "gamelib-bigscreen";

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

async function setTauriFullscreen(on: boolean): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setFullscreen(on);
  } catch {
    // Tauri API not available (e.g. `npm run dev` in browser).
    // Silently no-op — Big Screen still works in windowed mode.
  }
}

// ── Public shape ────────────────────────────────────────────────

export interface BigScreenContextValue {
  /** Whether Big Screen Mode is currently active. */
  isBigScreen: boolean;
  /** Toggle Big Screen Mode. Persists to localStorage and toggles fullscreen. */
  setBigScreen: (on: boolean) => void;
  /** True after the initial localStorage hydration. */
  ready: boolean;
}

const BigScreenContext = createContext<BigScreenContextValue | null>(null);

// ── Provider ────────────────────────────────────────────────────

export function BigScreenProvider({ children }: { children: ReactNode }) {
  const [isBigScreen, setIsBigScreenState] = useState<boolean>(() => {
    return lsGet(LS_BIG_SCREEN) === "true";
  });
  const [ready, setReady] = useState(false);

  // Hydrate fullscreen on mount to match the persisted preference.
  // Only fires `setFullscreen` if we hydrated to `true` — avoids an
  // unnecessary async call on every mount for the majority of users
  // who leave Big Screen off.
  useEffect(() => {
    setReady(true);
    if (lsGet(LS_BIG_SCREEN) === "true") {
      setTauriFullscreen(true);
    }
  }, []);

  const setBigScreen = useCallback(async (on: boolean) => {
    setIsBigScreenState(on);
    lsSet(LS_BIG_SCREEN, String(on));
    await setTauriFullscreen(on);
  }, []);

  // ── Keyboard shortcuts ─────────────────────────────────────────
  // F11 is the standard fullscreen toggle in every browser / media
  // player. Ctrl+B is the secondary shortcut — easier to reach on
  // a controller-free keyboard without stretching for F11.
  //
  // We use `keydown` (not `keyup`) so the toggle fires on press
  // and doesn't conflict with any page-level `keyup` handlers that
  // might eat the event. The listener is registered once per mount
  // and cleaned up on unmount so multiple providers (e.g.
  // StrictMode double-mount in dev) don't stack handlers.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't toggle when the user is typing in an input / textarea /
      // contenteditable — F11 and Ctrl+B inside a form field should
      // be handled by the browser / text editor, not us.
      const target = e.target;
      if (target instanceof HTMLElement) {
        if (
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          target.closest("[contenteditable]")
        ) {
          return;
        }
      }

      const isF11 = e.key === "F11";
      const isCtrlB = (e.ctrlKey || e.metaKey) && e.key === "b";

      if (isF11 || isCtrlB) {
        e.preventDefault();
        setIsBigScreenState((prev) => {
          const next = !prev;
          lsSet(LS_BIG_SCREEN, String(next));
          setTauriFullscreen(next);
          return next;
        });
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const value = useMemo<BigScreenContextValue>(
    () => ({ isBigScreen, setBigScreen, ready }),
    [isBigScreen, setBigScreen, ready],
  );

  return (
    <BigScreenContext.Provider value={value}>
      {children}
    </BigScreenContext.Provider>
  );
}

// ── Hook ────────────────────────────────────────────────────────

export function useBigScreen(): BigScreenContextValue {
  const ctx = useContext(BigScreenContext);
  if (!ctx) {
    throw new Error(
      "useBigScreen must be used within a BigScreenProvider",
    );
  }
  return ctx;
}
