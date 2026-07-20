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
import type { GamePrice } from "../types/game";

/**
 * PriceContext batches per-card CheapShark price lookups into a single
 * backend round-trip, mirroring `CrackWatchContext`. Cards register their
 * game name; the provider coalesces registrations and calls
 * `fetch_game_prices_batch` once, then publishes results back.
 */
interface PriceContextValue {
  request: (name: string) => void;
  get: (name: string) => GamePrice | null | undefined;
  version: number;
}

const PriceContext = createContext<PriceContextValue | null>(null);

const BATCH_DEBOUNCE_MS = 150;

export function PriceProvider({ children }: { children: ReactNode }) {
  const cacheRef = useRef<Map<string, GamePrice | null>>(new Map());
  const pendingRef = useRef<Set<string>>(new Set());
  const inflightRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [version, setVersion] = useState(0);

  const flush = useCallback(() => {
    timerRef.current = null;
    const names = Array.from(pendingRef.current);
    pendingRef.current.clear();
    if (names.length === 0) return;
    names.forEach((n) => inflightRef.current.add(n));

    invoke<Record<string, GamePrice>>("fetch_game_prices_batch", {
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

  const get = useCallback((name: string) => cacheRef.current.get(name), []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <PriceContext.Provider value={{ request, get, version }}>
      {children}
    </PriceContext.Provider>
  );
}

/**
 * usePrice: subscribe a single card to the batched price lookup. Returns
 * the resolved price (or null when there's no data). Safe without provider.
 */
export function usePrice(name: string): GamePrice | null {
  const ctx = useContext(PriceContext);

  useEffect(() => {
    if (ctx && name) ctx.request(name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, ctx?.request]);

  if (!ctx) return null;
  void ctx.version;
  return ctx.get(name) ?? null;
}

export { PriceContext };
