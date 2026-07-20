import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CrackWatchStatus } from "../types/game";

/**
 * CrackWatchContext batches per-card CrackWatch lookups into a single
 * backend round-trip.
 *
 * Previously every `StoreGameCard` fired its own `fetch_crackwatch_status`
 * invoke on mount — a 20-card grid meant 20 concurrent scrapes against
 * gamestatus.info's PoW-gated endpoint, a real rate-limit and
 * connection-pool risk. Cards now register their game name here; the
 * provider coalesces registrations within a short window and calls
 * `fetch_crackwatch_status_batch` once, then publishes results back.
 */
interface CrackWatchContextValue {
  /** Register a name for lookup; returns the resolved status (or null). */
  request: (name: string) => void;
  /** Read the resolved status for a name (undefined = not yet resolved). */
  get: (name: string) => CrackWatchStatus | null | undefined;
  /** Bump on every batch completion so consumers re-read `get`. */
  version: number;
}

const CrackWatchContext = createContext<CrackWatchContextValue | null>(null);

/** Coalesce window: registrations within this window share one batch call. */
const BATCH_DEBOUNCE_MS = 120;

export function CrackWatchProvider({ children }: { children: ReactNode }) {
  // Resolved cache: name -> status | null (null = looked up, no data).
  const cacheRef = useRef<Map<string, CrackWatchStatus | null>>(new Map());
  // Names awaiting the next batch flush.
  const pendingRef = useRef<Set<string>>(new Set());
  // Names currently in flight (avoid re-requesting mid-batch).
  const inflightRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [version, setVersion] = useState(0);

  const flush = useCallback(() => {
    timerRef.current = null;
    const names = Array.from(pendingRef.current);
    pendingRef.current.clear();
    if (names.length === 0) return;
    names.forEach((n) => inflightRef.current.add(n));

    invoke<Record<string, CrackWatchStatus>>("fetch_crackwatch_status_batch", {
      gameNames: names,
    })
      .then((result) => {
        for (const name of names) {
          cacheRef.current.set(name, result[name] ?? null);
          inflightRef.current.delete(name);
        }
        setVersion((v) => v + 1);
      })
      .catch(() => {
        // On failure, mark as resolved-null so we don't hammer the endpoint.
        for (const name of names) {
          if (!cacheRef.current.has(name)) cacheRef.current.set(name, null);
          inflightRef.current.delete(name);
        }
        setVersion((v) => v + 1);
      });
  }, []);

  const request = useCallback(
    (name: string) => {
      if (!name) return;
      if (cacheRef.current.has(name)) return;
      if (inflightRef.current.has(name)) return;
      if (pendingRef.current.has(name)) return;
      pendingRef.current.add(name);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, BATCH_DEBOUNCE_MS);
    },
    [flush]
  );

  const get = useCallback(
    (name: string) => cacheRef.current.get(name),
    []
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <CrackWatchContext.Provider value={{ request, get, version }}>
      {children}
    </CrackWatchContext.Provider>
  );
}

/**
 * useCrackWatch: subscribe a single card to the batched CrackWatch lookup.
 * Returns the resolved status (or null when there's no data). Safe to call
 * without a provider — it simply returns null and does nothing.
 */
export function useCrackWatch(name: string): CrackWatchStatus | null {
  const ctx = useContext(CrackWatchContext);

  useEffect(() => {
    if (ctx && name) ctx.request(name);
    // Re-request only when the name changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, ctx?.request]);

  if (!ctx) return null;
  // Reading ctx.version in render ties this component to batch completions.
  void ctx.version;
  return ctx.get(name) ?? null;
}

export { CrackWatchContext };
