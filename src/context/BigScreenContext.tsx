// BigScreenContext — manages the Big Screen Mode toggle, persists the
// user's preference to localStorage, and integrates with Tauri's
// fullscreen API so entering Big Screen Mode automatically makes the
// window fullscreen.
//
// Keyboard shortcuts (F11 / Ctrl+B) toggle the mode globally while
// the context is mounted. The TopNav toggle button (🖥️) calls
// setBigScreen() directly.
//
// PR 1 cleanup: a single keydown listener handles F11, Ctrl+B, AND
// Escape (the latter exits Big Screen without toggling fullscreen
// when the OS already did — Tauri intercepts Escape at OS level in
// native fullscreen). Previously these were two separate useEffects
// with duplicated state+persist+fullscreen logic.
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
import { getCurrentWindow } from "@tauri-apps/api/window";

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
    const win = getCurrentWindow();
    // Read the current state first so toggling from a fullscreen
    // window that the user just exited with Escape doesn't make a
    // redundant IPC call that would re-enter fullscreen by accident.
    const isCurrentlyFullscreen = await win.isFullscreen().catch(() => false);
    if (isCurrentlyFullscreen === on) return;

    if (on) {
      // Enter native fullscreen directly. We deliberately do NOT touch
      // window decorations here: on Windows, flipping decorations on
      // then off resizes the frame and leaves the OS taskbar overlapping
      // the bottom of the window (the "bottom cut off" bug). A bordlerless
      // window going native-fullscreen cleanly covers the taskbar.
      await win.setFullscreen(true);
    } else {
      await win.setFullscreen(false);
    }
  } catch {
    // Tauri API not available (e.g. `npm run dev` in browser).
    // Fallback: use HTML5 Fullscreen API for standard browsers
    if (typeof document !== "undefined") {
      const isCurrentlyFullscreen = !!document.fullscreenElement;
      if (isCurrentlyFullscreen === on) return;
      if (on) {
        document.documentElement.requestFullscreen().catch((err) => {
          console.warn("Failed to enter browser fullscreen:", err);
        });
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen().catch((err) => {
            console.warn("Failed to exit browser fullscreen:", err);
          });
        }
      }
    }
  }
}

/**
 * Skip the global keyboard shortcuts when the user is typing in a
 * form field. F11 and Ctrl+B inside an input should be handled by
 * the browser (F11 toggles browser fullscreen anyway); Escape
 * inside a textarea should let the field swallow it (e.g. clear
 * IME composition).
 */
function isTypingInField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable ||
    !!target.closest("[contenteditable]")
  );
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

  // ── Public toggle (used by TopNav button + Gamepad hint's exit) ─
  // Programmatic toggle. Both keyboard handlers and direct callers
  // funnel through one of {setBigScreen, toggleBigScreen} so the
  // "state + localStorage + Tauri fullscreen" triplet lives in one
  // place.
  const setBigScreen = useCallback(async (on: boolean) => {
    setIsBigScreenState(on);
    lsSet(LS_BIG_SCREEN, String(on));
    await setTauriFullscreen(on);
  }, []);

  const toggleBigScreen = useCallback(() => {
    setIsBigScreenState((prev) => {
      const next = !prev;
      lsSet(LS_BIG_SCREEN, String(next));
      setTauriFullscreen(next);
      return next;
    });
  }, []);

  // ── Single keydown listener ─────────────────────────────────
  // Handles F11 / Ctrl+B (toggle) and Escape (exit Big Screen
  // without re-firing fullscreen when the OS already did). The OS
  // intercepts Escape at the native-fullscreen level on Windows /
  // macOS; this listener also handles the in-app case where
  // fullscreen is bypassed (browser dev).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isTypingInField(e.target)) return;

      // Escape: exit Big Screen when active; otherwise let other
      // handlers (modal close, etc.) consume it.
      if (e.key === "Escape") {
        if (!isBigScreen) return;
        e.preventDefault();
        setBigScreen(false);
        return;
      }

      // F11 (universal fullscreen toggle) or Ctrl+B (easier on
      // controller-free keyboards) — toggle Big Screen Mode.
      const isF11 = e.key === "F11";
      const isCtrlB = (e.ctrlKey || e.metaKey) && e.key === "b";
      if (isF11 || isCtrlB) {
        e.preventDefault();
        toggleBigScreen();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isBigScreen, setBigScreen, toggleBigScreen]);

  // Sync state if browser fullscreen is exited (e.g. Esc button pressed in browser)
  useEffect(() => {
    function handleFullscreenChange() {
      if (typeof document !== "undefined") {
        const isFullscreen = !!document.fullscreenElement;
        if (!isFullscreen && isBigScreen) {
          setIsBigScreenState(false);
          lsSet(LS_BIG_SCREEN, "false");
        }
      }
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [isBigScreen]);

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