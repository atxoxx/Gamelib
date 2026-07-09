// React context for the source-link feature.
//
// Wraps the Tauri commands exposed by `src-tauri/src/source_manager.rs`:
//
//   * `sources_list()` — current source metadata (id, url, name, enabled, …)
//   * `sources_add(url, name)` — add a new source (validates via fetch)
//   * `sources_remove(id)` — drop a source
//   * `sources_toggle(id)` — flip a source's enabled flag
//   * `sources_refresh(id)` — re-fetch a single source
//   * `sources_refresh_all()` — re-fetch every enabled source
//   * `sources_search_game(query)` — fuzzy-match `query` against every
//     enabled source's cached downloads; returns sorted matches
//
// The Rust side persists source metadata (id, url, name, enabled,
// last_fetched, game_count) to `<app_data_dir>/sources.json` after
// every mutation, so the list survives a restart. We just hydrate
// from `sources_list()` on mount.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { useToast } from "./ToastContext";
import type { MatchedDownload, SourceLink } from "../types/source";

interface SourceContextValue {
  /** Current list of sources, in user-added order. */
  sources: SourceLink[];
  /** True until the initial `sources_list` resolves. */
  loading: boolean;
  /** Add a new source via the Hydra API. POSTs the URL to Hydra's
   *  `/download-sources` endpoint, which fetches + parses the source
   *  JSON and returns the full download data. */
  addSource: (url: string, name: string) => Promise<SourceLink>;
  removeSource: (id: string) => Promise<void>;
  toggleSource: (id: string) => Promise<void>;
  refreshSource: (id: string) => Promise<void>;
  refreshAllSources: () => Promise<void>;
  /** Fuzzy-match `query` against every enabled source's cache, checking Hydra online when possible. */
  searchSources: (query: string, steamAppId?: number) => Promise<MatchedDownload[]>;
}

const SourceContext = createContext<SourceContextValue | null>(null);

const EMPTY_SOURCES: SourceLink[] = [];

export function SourceProvider({ children }: { children: ReactNode }) {
  const { showToast } = useToast();
  const [sources, setSources] = useState<SourceLink[]>(EMPTY_SOURCES);
  const [loading, setLoading] = useState(true);
  // Suppress toast spam if the user clicks Refresh All rapidly.
  // The ref tracks the most recent in-flight refresh so the
  // subsequent `refreshAllSources` call can either skip or
  // wait. We just skip + dedupe the toast.
  const inFlightRefresh = useRef<Promise<void> | null>(null);

  // ── Initial load ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await invoke<SourceLink[]>("sources_list");
        if (!cancelled && Array.isArray(list)) {
          setSources(list);
        }
      } catch (err) {
        // Not catastrophic — the Settings page will show the empty
        // state and the user can add a source.
        console.error("[SourceContext] sources_list failed:", err);
        showToast(`Failed to load sources: ${err}`, "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  // ── Mutations ──────────────────────────────────────────────────────
  // Each mutation goes through a `setSources` callback to keep the
  // local cache in sync with whatever the Rust side has just
  // persisted. We then surface a success/error toast.

  const addSource = useCallback(
    async (url: string, name: string): Promise<SourceLink> => {
      const created = await invoke<SourceLink>("sources_add", { url, name });
      setSources((prev) => [...prev, created]);
      showToast(`Added source "${created.name}"`, "success");
      return created;
    },
    [showToast],
  );

  const removeSource = useCallback(
    async (id: string) => {
      await invoke("sources_remove", { id });
      setSources((prev) => prev.filter((s) => s.id !== id));
      // Don't toast — the SourceManager UI is the only caller and it
      // renders its own success indication (the row disappears).
    },
    [],
  );

  const toggleSource = useCallback(
    async (id: string) => {
      await invoke("sources_toggle", { id });
      setSources((prev) =>
        prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)),
      );
    },
    [],
  );

  const refreshSource = useCallback(
    async (id: string) => {
      try {
        await invoke("sources_refresh", { id });
        // The Rust side updates last_fetched + game_count on the
        // persisted record; re-pull the full list so the UI sees
        // those updated fields.
        const list = await invoke<SourceLink[]>("sources_list");
        if (Array.isArray(list)) setSources(list);
      } catch (err) {
        showToast(`Refresh failed: ${err}`, "error");
        throw err;
      }
    },
    [showToast],
  );

  const refreshAllSources = useCallback(async () => {
    if (inFlightRefresh.current) {
      // A refresh is already running; piggyback on the existing
      // promise so the second click doesn't double-fire the
      // network work.
      return inFlightRefresh.current;
    }
    const p = (async () => {
      try {
        await invoke("sources_refresh_all");
        const list = await invoke<SourceLink[]>("sources_list");
        if (Array.isArray(list)) setSources(list);
        showToast("All sources refreshed", "success");
      } catch (err) {
        showToast(`Refresh failed: ${err}`, "error");
        throw err;
      }
    })();
    inFlightRefresh.current = p;
    try {
      await p;
    } finally {
      inFlightRefresh.current = null;
    }
  }, [showToast]);

  const searchSources = useCallback(
    async (query: string, steamAppId?: number): Promise<MatchedDownload[]> => {
      const trimmed = query.trim();
      if (!trimmed) return [];
      return await invoke<MatchedDownload[]>("sources_search_game", {
        query: trimmed,
        steamAppId: steamAppId ?? null,
      });
    },
    [],
  );

  const value = useMemo<SourceContextValue>(
    () => ({
      sources,
      loading,
      addSource,
      removeSource,
      toggleSource,
      refreshSource,
      refreshAllSources,
      searchSources,
    }),
    [
      sources,
      loading,
      addSource,
      removeSource,
      toggleSource,
      refreshSource,
      refreshAllSources,
      searchSources,
    ],
  );

  return <SourceContext.Provider value={value}>{children}</SourceContext.Provider>;
}

export function useSources(): SourceContextValue {
  const ctx = useContext(SourceContext);
  if (!ctx) {
    throw new Error("useSources must be used within a SourceProvider");
  }
  return ctx;
}
