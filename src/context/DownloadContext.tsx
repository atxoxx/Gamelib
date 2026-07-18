// React context for the download feature.
//
// Wraps the Tauri commands exposed by `src-tauri/src/torrent_engine.rs`:
//
//   * `torrent_add(magnetUri, savePath, gameId, sourceName)` — enqueue
//   * `torrent_pause(id)` / `torrent_resume(id)` — control
//   * `torrent_remove(id, deleteFiles)` — drop from the queue
//   * `torrent_get_all()` — snapshot of every torrent
//   * `torrent_select_save_path()` — open a folder picker dialog
//
// The Rust side spawns a background task on app boot that polls
// `librqbit` every 2 s and emits a `download-progress` event with
// the full `Vec<TorrentDownload>`. We listen for that here so the
// progress panel re-renders without the React tree having to deal
// with per-torrent event streams.
//
// We DO also do a one-shot `torrent_get_all()` on mount, in case
// the engine was already initialised when the context mounts (it
// shouldn't be, since the provider wraps the routes and the
// engine is init'd in the lib.rs `setup` closure — but the
// extra call costs nothing and shields us from future
// refactors that change that ordering).
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
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useToast } from "./ToastContext";
import {
  getStatusError,
  isActiveStatus,
  isCompletedStatus,
  type TorrentDownload,
  type DownloadStatus,
} from "../types/download";

interface DownloadContextValue {
  /** All downloads, sorted (active first, completed at the bottom). */
  downloads: TorrentDownload[];
  /** Convenience: only active downloads. */
  activeDownloads: TorrentDownload[];
  /** Convenience: only completed downloads. */
  completedDownloads: TorrentDownload[];
  /** Number of downloads in `activeDownloads`. */
  activeCount: number;
  /** True until the initial `torrent_get_all` resolves. */
  loading: boolean;
  /**
   * Enqueue a new download. Returns the full `TorrentDownload`
   * record that the Rust engine created. The context also merges
   * it into local state immediately so the modal, the popover
   * badge, and the Downloads page all update without waiting
   * for the next 2 s progress tick. The background poller will
   * reconcile live stats (downloaded bytes, speed, peers) on
   * its next tick.
   */
  addDownload: (
    magnetUri: string,
    savePath: string,
    gameId?: string | null,
    sourceName?: string,
    autoExtract?: boolean,
    listOnly?: boolean,
  ) => Promise<TorrentDownload>;
  addDirectDownload: (
    url: string,
    savePath: string,
    gameId?: string | null,
    sourceName?: string,
    autoExtract?: boolean,
    uris?: string[],
  ) => Promise<TorrentDownload>;
  startSelectedDownload: (
    id: string,
    onlyFiles: number[],
    autoExtract: boolean,
  ) => Promise<void>;
  updateDirectDownloadUrl: (id: string, url: string) => Promise<void>;
  pauseDownload: (id: string) => Promise<void>;
  resumeDownload: (id: string) => Promise<void>;
  /**
   * Pause every active (non-completed) torrent. Returns the
   * number of torrents that were (re)paused. Backend
   * implementation lives in `torrent_engine::pause_all`.
   */
  pauseAll: () => Promise<number>;
  /** Mirror of `pauseAll` for paused / queued torrents. */
  resumeAll: () => Promise<number>;
  /** Remove a download. Pass `deleteFiles=true` to also wipe the downloaded bytes. */
  removeDownload: (id: string, deleteFiles?: boolean) => Promise<void>;
  /** Open the system folder picker. Returns null on cancel. */
  selectSavePath: () => Promise<string | null>;
  /** Force a one-shot refresh from the engine. Rarely needed — the
   *  `download-progress` event keeps state in sync. */
  refresh: () => Promise<void>;
  updateSpeedLimits: (
    downloadKbps: number | null,
    uploadKbps: number | null,
    disableUpload: boolean,
  ) => Promise<void>;
  updateSelectedFiles: (id: string, onlyFiles: number[]) => Promise<void>;
  openDownloadFolder: (id: string) => Promise<void>;
}

const DownloadContext = createContext<DownloadContextValue | null>(null);

/** Initial empty-list render value for SSR / pre-hydrate. */
const EMPTY_DOWNLOADS: TorrentDownload[] = [];

/**
 * Fire an OS-level notification via the Web Notifications API (which
 * works inside the Tauri webview). Best-effort: requests permission
 * on first use and silently no-ops if the user denies it or the API
 * is unavailable. We keep this on the web API rather than adding the
 * Tauri notification plugin so no extra Rust registration / capability
 * wiring is required.
 */
function fireOsNotification(title: string, body: string): void {
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") {
      new Notification(title, { body });
    } else if (Notification.permission !== "denied") {
      void Notification.requestPermission().then((perm) => {
        if (perm === "granted") {
          new Notification(title, { body });
        }
      });
    }
  } catch (err) {
    console.debug("[DownloadContext] OS notification failed:", err);
  }
}

/**
 * Sort: active downloads first (most recently added at the top of
 * that group), completed next (newest first). This matches what
 * the Rust `list()` does so the panel ordering is consistent
 * with whatever the engine itself thinks the order is.
 */
function sortDownloads(a: TorrentDownload, b: TorrentDownload): number {
  const aActive = isActiveStatus(a.status);
  const bActive = isActiveStatus(b.status);
  if (aActive && !bActive) return -1;
  if (!aActive && bActive) return 1;
  return b.addedAt - a.addedAt;
}

function areDownloadsEqual(a: TorrentDownload[], b: TorrentDownload[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const da = a[i];
    const db = b[i];
    if (
      da.id !== db.id ||
      da.name !== db.name ||
      da.downloaded !== db.downloaded ||
      da.totalSize !== db.totalSize ||
      da.progress !== db.progress ||
      da.downloadSpeed !== db.downloadSpeed ||
      da.uploadSpeed !== db.uploadSpeed ||
      da.peers !== db.peers ||
      da.seeds !== db.seeds ||
      da.status.kind !== db.status.kind ||
      da.sourceUri !== db.sourceUri
    ) {
      return false;
    }
    if (da.status.kind === "error" && db.status.kind === "error" && da.status.message !== db.status.message) {
      return false;
    }
    if ((da.uris?.length ?? 0) !== (db.uris?.length ?? 0)) return false;
    if (da.uris && db.uris) {
      for (let j = 0; j < da.uris.length; j++) {
        if (da.uris[j] !== db.uris[j]) return false;
      }
    }
    if ((da.files?.length ?? 0) !== (db.files?.length ?? 0)) return false;
    if (da.files && db.files) {
      for (let j = 0; j < da.files.length; j++) {
        const fa = da.files[j];
        const fb = db.files[j];
        if (
          fa.name !== fb.name ||
          fa.selected !== fb.selected ||
          fa.progress !== fb.progress ||
          fa.downloaded !== fb.downloaded
        ) {
          return false;
        }
      }
    }
  }
  return true;
}

export function DownloadProvider({ children }: { children: ReactNode }) {
  const [downloads, setDownloads] = useState<TorrentDownload[]>(EMPTY_DOWNLOADS);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();
  // Keep a stable ref to the latest list so the `download-progress`
  // event handler (which we register once on mount) doesn't capture
  // a stale snapshot.
  const downloadsRef = useRef(downloads);
  downloadsRef.current = downloads;

  // Track the last-seen status kind per download id so we can detect
  // the "not-completed → completed" transition and surface a
  // completion toast (and, when enabled, an OS notification). We seed
  // this from the first snapshot so pre-completed downloads present
  // at boot don't fire a spurious "finished" toast.
  const statusKindsRef = useRef<Map<string, DownloadStatus["kind"]>>(new Map());
  const seededStatusRef = useRef(false);

  /**
   * Compare an incoming list against the last-seen statuses and fire
   * a completion notification for each download that just finished.
   * Idempotent per-id: once a download is recorded as completed we
   * won't notify again unless it leaves and re-enters the completed
   * state.
   */
  const notifyCompletions = useCallback(
    (incoming: TorrentDownload[]) => {
      const prev = statusKindsRef.current;
      // First snapshot: seed without notifying so we don't announce
      // downloads that were already done when the app launched.
      if (!seededStatusRef.current) {
        for (const d of incoming) prev.set(d.id, d.status.kind);
        seededStatusRef.current = true;
        return;
      }

      const notifyEnabled =
        localStorage.getItem("gamelib-download-notify-complete") !== "false";
      const osNotifyEnabled =
        localStorage.getItem("gamelib-download-notify-os") === "true";

      for (const d of incoming) {
        const before = prev.get(d.id);
        const now = d.status.kind;
        if (now === "completed" && before !== undefined && before !== "completed") {
          if (notifyEnabled) {
            showToast(`Download complete: ${d.name}`, "success");
            if (osNotifyEnabled) {
              fireOsNotification("Download complete", d.name);
            }
          }
        }
        prev.set(d.id, now);
      }

      // Drop ids that are no longer present so the map doesn't grow
      // unbounded across long sessions with lots of removals.
      if (prev.size > incoming.length) {
        const liveIds = new Set(incoming.map((d) => d.id));
        for (const id of Array.from(prev.keys())) {
          if (!liveIds.has(id)) prev.delete(id);
        }
      }
    },
    [showToast],
  );

  // Stable ref to the latest notifier so the mount effect (which
  // registers the event listener exactly once) can call it without
  // taking it as a dependency and re-subscribing.
  const notifyCompletionsRef = useRef(notifyCompletions);
  notifyCompletionsRef.current = notifyCompletions;

  // ── Initial load + event subscription ──────────────────────────────
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;

    (async () => {
      try {
        // Apply speed limits on startup
        try {
          const dlLimitEnabled = localStorage.getItem("gamelib-dl-limit-download-enabled") === "true";
          const dlLimitVal = parseInt(localStorage.getItem("gamelib-dl-limit-download-value") || "0", 10);
          const ulLimitEnabled = localStorage.getItem("gamelib-dl-limit-upload-enabled") === "true";
          const ulLimitVal = parseInt(localStorage.getItem("gamelib-dl-limit-upload-value") || "0", 10);
          const disableUpload = localStorage.getItem("gamelib-dl-limit-disable-upload") === "true";

          const downloadKbps = dlLimitEnabled && dlLimitVal > 0 ? dlLimitVal : null;
          const uploadKbps = ulLimitEnabled && ulLimitVal > 0 ? ulLimitVal : null;

          await invoke("torrent_set_speed_limits", {
            downloadLimitKbps: downloadKbps,
            uploadLimitKbps: uploadKbps,
            disableUpload,
          });
        } catch (e) {
          console.error("Failed to apply initial speed limits:", e);
        }

        // 1. Subscribe to the background-polling event FIRST so we
        //    don't miss the first emission if the engine is already
        //    running. (In practice, the engine isn't init'd until
        //    lib.rs's `setup` closure finishes, which happens before
        //    any routes mount — but this ordering is still safer.)
        const unlistenFn = await listen<TorrentDownload[]>("download-progress", (event) => {
          if (Array.isArray(event.payload)) {
            notifyCompletionsRef.current(event.payload);
            setDownloads((prev) => {
              if (areDownloadsEqual(prev, event.payload)) {
                return prev;
              }
              return event.payload;
            });
            setLoading(false);
          }
        });
        if (cancelled) {
          unlistenFn();
          return;
        }
        unlisten = unlistenFn;

        // 2. Kick off a one-shot snapshot. If the engine is still
        //    initialising, the Rust command will return "engine not
        //    initialized" (handled below) and we'll just show the
        //    empty state until the first event lands.
        try {
          const initial = await invoke<TorrentDownload[]>("torrent_get_all");
          if (!cancelled && Array.isArray(initial)) {
            notifyCompletionsRef.current(initial);
            setDownloads(initial);
          }
        } catch (err) {
          // Common during the very first second of app boot before
          // the engine init task has run. Not an error worth
          // surfacing.
          console.debug("[DownloadContext] initial get_all skipped:", err);
        } finally {
          if (!cancelled) setLoading(false);
        }
      } catch (err) {
        // The `listen` call itself failed (shouldn't happen). Log
        // and continue so the rest of the app still works.
        console.error("[DownloadContext] listen failed:", err);
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  // ── Command wrappers ───────────────────────────────────────────────
  const addDownload = useCallback(
    async (
      magnetUri: string,
      savePath: string,
      gameId: string | null | undefined = null,
      sourceName: string = "Unknown",
      autoExtract?: boolean,
      listOnly?: boolean,
    ): Promise<TorrentDownload> => {
      const newDownload = await invoke<TorrentDownload>("torrent_add", {
        magnetUri,
        savePath,
        gameId: gameId ?? null,
        sourceName,
        autoExtract: autoExtract ?? false,
        listOnly: listOnly ?? false,
      });
      // Optimistic merge: insert (or replace) the new record so the
      // UI updates within milliseconds of `torrent_add` returning,
      // not up to 2 s later when the background poller next ticks.
      // The poller will overwrite our placeholder fields with the
      // live stats on the next emission.
      setDownloads((prev) => {
        const without = prev.filter((d) => d.id !== newDownload.id);
        return [newDownload, ...without];
      });
      return newDownload;
    },
    [],
  );

  const addDirectDownload = useCallback(
    async (
      url: string,
      savePath: string,
      gameId: string | null = null,
      sourceName = "Direct Download",
      autoExtract = false,
      uris: string[] = [],
    ): Promise<TorrentDownload> => {
      const id = `dd_${Math.random().toString(36).substring(2, 11)}`;
      
      let downloadUrl = url;
      const debridProvider = localStorage.getItem("gamelib-debrid-provider") || "none";
      const debridApiKey = localStorage.getItem("gamelib-debrid-apikey") || "";

      if (debridProvider !== "none" && debridApiKey) {
        try {
          downloadUrl = await invoke<string>("debrid_unrestrict_link", {
            provider: debridProvider,
            apikey: debridApiKey,
            url,
          });
          console.log("[DownloadContext] Unrestricted link successfully:", downloadUrl);
        } catch (e) {
          // Surface the debrid error to the user instead of silently
          // falling through to the original URL. The original URL is
          // typically a hoster link that requires a premium account —
          // downloading it directly will fail with HTTP 403/402 and
          // the user sees a generic "Connection failed" error with no
          // indication that their debrid service is the problem.
          throw new Error(
            `Debrid unrestrict failed (${debridProvider}): ${e}. ` +
            `Check your API key or try disabling debrid in Settings.`,
          );
        }
      }

      let finalSavePath = savePath;
      if (downloadUrl !== url) {
        try {
          const urlObj = new URL(downloadUrl);
          const lastSeg = urlObj.pathname.substring(urlObj.pathname.lastIndexOf('/') + 1);
          if (lastSeg && lastSeg.includes('.')) {
            const dir = savePath.substring(0, savePath.lastIndexOf('/'));
            const safeFile = lastSeg.replace(/[:*?"<>|\\/]/g, "").trim();
            finalSavePath = `${dir}/${safeFile}`;
          }
        } catch (err) {
          console.error("Failed to parse unlocked URL filename:", err);
        }
      }

      const newDownload = await invoke<TorrentDownload>("direct_download_start", {
        id,
        url: downloadUrl,
        savePath: finalSavePath,
        gameId,
        sourceName,
        autoExtract,
        uris,
      });
      setDownloads((prev) => {
        const without = prev.filter((d) => d.id !== newDownload.id);
        return [newDownload, ...without];
      });
      return newDownload;
    },
    [],
  );

  const startSelectedDownload = useCallback(
    async (id: string, onlyFiles: number[], autoExtract: boolean): Promise<void> => {
      await invoke("torrent_start_selected", { id, onlyFiles, autoExtract });
    },
    [],
  );

  const updateDirectDownloadUrl = useCallback(
    async (id: string, url: string): Promise<void> => {
      await invoke("direct_download_update_url", { id, newUrl: url });
      setDownloads((prev) =>
        prev.map((d) => (d.id === id ? { ...d, sourceUri: url } : d))
      );
    },
    [],
  );

  const pauseDownload = useCallback(async (id: string) => {
    await invoke("torrent_pause", { id });
  }, []);

  const resumeDownload = useCallback(async (id: string) => {
    await invoke("torrent_resume", { id });
  }, []);

  const pauseAll = useCallback(async (): Promise<number> => {
    return await invoke<number>("torrent_pause_all");
  }, []);

  const resumeAll = useCallback(async (): Promise<number> => {
    return await invoke<number>("torrent_resume_all");
  }, []);

  const removeDownload = useCallback(async (id: string, deleteFiles = false) => {
    await invoke("torrent_remove", { id, deleteFiles });
  }, []);

  const selectSavePath = useCallback(async (): Promise<string | null> => {
    return await invoke<string | null>("torrent_select_save_path");
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await invoke<TorrentDownload[]>("torrent_get_all");
      if (Array.isArray(list)) setDownloads(list);
    } catch (err) {
      // Engine not initialised yet. Ignore — the next progress event
      // will populate state.
      console.debug("[DownloadContext] refresh skipped:", err);
    }
  }, []);

  const updateSpeedLimits = useCallback(
    async (
      downloadKbps: number | null,
      uploadKbps: number | null,
      disableUpload: boolean,
    ): Promise<void> => {
      await invoke("torrent_set_speed_limits", {
        downloadLimitKbps: downloadKbps,
        uploadLimitKbps: uploadKbps,
        disableUpload,
      });
    },
    [],
  );

  const updateSelectedFiles = useCallback(
    async (id: string, onlyFiles: number[]): Promise<void> => {
      await invoke("torrent_update_only_files", { id, onlyFiles });
    },
    [],
  );

  const openDownloadFolder = useCallback(async (id: string) => {
    await invoke("torrent_open_folder", { id });
  }, []);

  // ── Derived state ──────────────────────────────────────────────────
  const sorted = useMemo(() => [...downloads].sort(sortDownloads), [downloads]);
  const activeDownloads = useMemo(
    () => sorted.filter((d) => isActiveStatus(d.status)),
    [sorted],
  );
  const completedDownloads = useMemo(
    () => sorted.filter((d) => isCompletedStatus(d.status)),
    [sorted],
  );

  const value = useMemo<DownloadContextValue>(
    () => ({
      downloads: sorted,
      activeDownloads,
      completedDownloads,
      activeCount: activeDownloads.length,
      loading,
      addDownload,
      addDirectDownload,
      startSelectedDownload,
      updateDirectDownloadUrl,
      pauseDownload,
      resumeDownload,
      pauseAll,
      resumeAll,
      removeDownload,
      selectSavePath,
      refresh,
      updateSpeedLimits,
      updateSelectedFiles,
      openDownloadFolder,
    }),
    [
      sorted,
      activeDownloads,
      completedDownloads,
      loading,
      addDownload,
      addDirectDownload,
      startSelectedDownload,
      updateDirectDownloadUrl,
      pauseDownload,
      resumeDownload,
      pauseAll,
      resumeAll,
      removeDownload,
      selectSavePath,
      refresh,
      updateSpeedLimits,
      updateSelectedFiles,
      openDownloadFolder,
    ],
  );

  return <DownloadContext.Provider value={value}>{children}</DownloadContext.Provider>;
}

/**
 * Consume the download context. Throws if no provider is mounted,
 * which is the same convention every other context in this app
 * follows (GameContext, WishlistContext, ToastContext).
 */
export function useDownloads(): DownloadContextValue {
  const ctx = useContext(DownloadContext);
  if (!ctx) {
    throw new Error("useDownloads must be used within a DownloadProvider");
  }
  return ctx;
}

/**
 * Lightweight hook for callers that only need the active-download
 * count (e.g. the TopNav badge). Re-renders only when the count
 * changes, not on every progress tick — saves a re-render of the
 * whole topnav every 2 s.
 */
export function useActiveDownloadCount(): number {
  const ctx = useContext(DownloadContext);
  if (!ctx) return 0;
  return ctx.activeCount;
}

// Re-export the status helpers so existing call sites can pull
// them from the same module as the rest of the download API.
export { getStatusError, isActiveStatus, isCompletedStatus };
export type { DownloadStatus, TorrentDownload };
