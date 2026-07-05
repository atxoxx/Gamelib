import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Game, GameSession } from "../types/game";

/**
 * Status visible in the splash card. Drives the status pill copy and
 * the splash's auto-close lifecycle.
 */
export type SplashStatus = "launching" | "started" | "error";

/**
 * Pre-rendered payload displayed in the splash overlay. Includes the
 * last session so the splash doesn't need to bootstrap ActivityContext
 * on mount and excludes the full game list.
 */
export interface SplashPayload {
  game: Game;
  lastSession: GameSession | null;
}

/**
 * Record currently displayed by the splash. Stamps `startedAt` so the
 * splash can compute a min-visibility hold regardless of how many
 * status flips happened after launch_game resolved.
 */
export interface SplashRecord extends SplashPayload {
  status: SplashStatus;
  startedAt: number;
}

function buildSplashRecord(
  payload: SplashPayload,
  status: SplashStatus
): SplashRecord {
  return { ...payload, status, startedAt: Date.now() };
}

interface SplashContextType {
  /** Whether the splash overlay is currently visible. */
  visible: boolean;
  /** Current splash record. Null when no launch is in flight. */
  record: SplashRecord | null;
  /** Draw the splash with status "launching". Idempotent — re-calling
   *  with a different game wipes the previous record. */
  open: (payload: SplashPayload) => void;
  /** Flip just the status field, preserving `startedAt` so the splash's
   *  min-visibility timer is consistent across status flips. */
  updateStatus: (status: SplashStatus) => void;
  /** Tear the splash down. The Splashscreen component calls this from
   *  its fade lifecycle. */
  close: () => void;
}

const SplashContext = createContext<SplashContextType | null>(null);

/** localStorage key for the user-controlled "show launch splash"
 *  preference. Read fresh on every launchGame call so a Settings
 *  toggle takes effect on the very next click without a remount. */
const SPLASH_ENABLED_KEY = "gamelib-show-splash";

/** Per-window user preference stored in localStorage (intentionally
 *  per-window — it's the user's own setting, not an IPC payload).
 *  Defaults to ON. */
export function isSplashEnabled(): boolean {
  try {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem(SPLASH_ENABLED_KEY) !== "false";
  } catch {
    return true;
  }
}

export function SplashProvider({ children }: { children: ReactNode }) {
  const [record, setRecord] = useState<SplashRecord | null>(null);

  const open = useCallback((payload: SplashPayload) => {
    setRecord(buildSplashRecord(payload, "launching"));
  }, []);

  const updateStatus = useCallback((status: SplashStatus) => {
    setRecord((prev) => (prev ? { ...prev, status } : prev));
  }, []);

  const close = useCallback(() => {
    setRecord(null);
  }, []);

  const value = useMemo<SplashContextType>(
    () => ({
      visible: record !== null,
      record,
      open,
      updateStatus,
      close,
    }),
    [record, open, updateStatus, close]
  );

  return (
    <SplashContext.Provider value={value}>{children}</SplashContext.Provider>
  );
}

export function useSplash(): SplashContextType {
  const ctx = useContext(SplashContext);
  if (!ctx) {
    throw new Error("useSplash must be used within a SplashProvider");
  }
  return ctx;
}
