import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * WindowControls — custom minimize / maximize(+restore) / close buttons
 * shown inside the app when the Tauri main window runs with
 * `decorations: false` (see `src-tauri/tauri.conf.json`).
 *
 * Why a dedicated component
 * ─────────────────────────
 * Splitting this off from `TopNav` keeps three concerns separate:
 *
 *   1. **TopNav** is the in-app navigation surface (tabs, downloads
 *      button, settings button) — its renderer should not have to
 *      know about window-chrome state.
 *   2. **WindowControls** owns the maximize ↔ restore icon swap and
 *      the lifecycle of the resize listener (subscribe on mount,
 *      unsubscribe on unmount).
 *   3. **App.css** has tighter styling rules for `.window-controls`
 *      that would otherwise clutter the much larger topnav block.
 *
 * Why we listen to `onResized`
 * ────────────────────────────
 * Tauri's `toggleMaximize()` is a fire-and-forget verb: it does NOT
 * return the resulting maximized state. We need to track that state
 * ourselves to choose between the "maximize" (hollow square) and
 * "restore" (two overlapping squares) icons. The cheapest correct
 * signal is `onResized`: whenever the window is resized (whether
 * triggered by `toggleMaximize()`, the OS, or a drag-resize border),
 * we re-poll `isMaximized()` and sync local state. This also
 * handles the user double-clicking the topnav title-bar to
 * maximize — Tauri fires the resize event just like any other
 * maximize-source, so our icon flips for free.
 *
 * Cross-platform note
 * ───────────────────
 * The buttons are positioned on the far right of the topnav
 * (Windows / Linux convention). macOS's "traffic-light on the
 * left" convention does not apply to a custom title-bar — by the
 * time we've elected for a frameless look, the user expects a
 * single consistent grouping. The buttons themselves are themed
 * via CSS variables so they look correct on both light and dark
 * themes defined in `App.css`.
 */
export default function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    // Single async IIFE for both the initial-state poll and the
    // resize subscription. Doing both in one race avoids the case
    // where two parallel IIFEs each `await` separately and the cleanup
    // misses the slower one.
    //
    // Why BOTH the cleanup-return AND the retroactive check
    // ─────────────────────────────────────────────────────────────────
    // In production, the cleanup-return is what matters: it fires on
    // real unmount and can call unlisten() if the await already
    // resolved. The retroactive check inside the IIFE is StrictMode
    // hardening: in dev, mount → cleanup → re-mount runs synchronously
    // *before* the first mount's `await onResized(...)` resolves, so
    // unlisten is still undefined when cleanup runs. Without the
    // post-await teardown, that first listener would leak across the
    // StrictMode double-mount. Both paths are needed.
    (async () => {
      try {
        const win = getCurrentWindow();
        const initial = await win.isMaximized();
        if (!cancelled) setIsMaximized(initial);
        unlisten = await win.onResized(async () => {
          if (cancelled) return;
          try {
            setIsMaximized(await win.isMaximized());
          } catch {
            /* browser-mode: noop */
          }
        });
        if (cancelled && unlisten) {
          try {
            unlisten();
          } catch {
            /* ignore */
          }
          unlisten = undefined;
        }
      } catch {
        /* browser-mode (vite dev on the browser): noop */
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) {
        try {
          unlisten();
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  // ── Click handlers ────────────────────────────────────────────────
  // Each button triggers one Tauri window verb. Outside Tauri
  // (e.g. `npm run dev` on the browser) those verbs throw because
  // there's no native bridge — we surface the rejection via
  // console.warn so a missing/wrong capability flag shows up in
  // DevTools instead of vanishing silently (the previous build
  // had `.catch(() => {})` everywhere, which made tracking down
  // "the maximise button does nothing" impossible from the
  // frontend).
  //
  // Memoized with `useCallback` keyed on `[]` so the button's
  // `onClick` prop keeps a stable identity across renders. Without
  // this, every parent re-render re-allocates all three handlers
  // and forces the button subtree to re-diff for no reason.
  //
  // `handleToggleMaximize` is async (vs. its peers) because, after
  // the IPC resolves, we explicitly re-poll `isMaximized()` and
  // push the new value into React state. The `onResized` listener
  // above already covers this, but a number of window managers
  // (DWM on certain Win11 builds, macOS Stage Manager) don't fire
  // a resize event for programmatic maximize — leaving the icon
  // stuck on the wrong state. The post-action poll is a
  // belt-and-suspenders sync that works regardless of the OS.
  const handleMinimize = useCallback(() => {
    getCurrentWindow().minimize().catch((e) => {
      console.warn("[WindowControls] minimize failed:", e);
    });
  }, []);
  const handleToggleMaximize = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      await win.toggleMaximize();
      setIsMaximized(await win.isMaximized());
    } catch (e) {
      console.warn("[WindowControls] toggleMaximize failed:", e);
    }
  }, []);
  const handleClose = useCallback(() => {
    getCurrentWindow().close().catch((e) => {
      console.warn("[WindowControls] close failed:", e);
    });
  }, []);

  // ── Icons ─────────────────────────────────────────────────────────
  // 14×14 viewBox keeps them visually consistent with the other
  // 16–18px topnav icons while leaving a touch more detail than a
  // 12×12. All three render with currentColor so the theme does
  // the heavy lifting. Stroke 1.5 (instead of the 2 used in tab
  // icons) keeps the close X from feeling chunky next to the
  // button's 28×28 hit area.
  return (
    <div
      className="window-controls"
      role="group"
      aria-label="Window controls"
    >
      <button
        type="button"
        className="window-controls-btn"
        onClick={handleMinimize}
        aria-label="Minimize"
        title="Minimize"
      >
        {/* Horizontal line — restrained so it doesn't compete
         *  with the close X for visual weight. */}
        <svg viewBox="0 0 14 14" aria-hidden="true">
          <line
            x1="3"
            y1="10"
            x2="11"
            y2="10"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <button
        type="button"
        className="window-controls-btn"
        onClick={handleToggleMaximize}
        aria-label={isMaximized ? "Restore" : "Maximize"}
        title={isMaximized ? "Restore" : "Maximize"}
      >
        {isMaximized ? (
          // Restore: two overlapping squares. The back square is
          // a small offset so the user can read it as "click to
          // shrink back to the previous size" rather than a
          // second maximize icon.
          <svg viewBox="0 0 14 14" aria-hidden="true">
            <rect
              x="5.5"
              y="2.75"
              width="6.5"
              height="6.5"
              rx="1"
              stroke="currentColor"
              strokeWidth="1.1"
              fill="none"
            />
            <rect
              x="2"
              y="5.25"
              width="6.5"
              height="6.5"
              rx="1"
              stroke="currentColor"
              strokeWidth="1.1"
              fill="none"
            />
          </svg>
        ) : (
          // Maximize: single outlined square covering most of
          // the icon area.
          <svg viewBox="0 0 14 14" aria-hidden="true">
            <rect
              x="2.5"
              y="2.5"
              width="9"
              height="9"
              rx="1"
              stroke="currentColor"
              strokeWidth="1.25"
              fill="none"
            />
          </svg>
        )}
      </button>

      <button
        type="button"
        className="window-controls-btn window-controls-btn--close"
        onClick={handleClose}
        aria-label="Close"
        title="Close"
      >
        {/* An X drawn from two crossing strokes. Slightly shorter
         *  than the viewbox edge so the corners read as "clean
         *  diagonal" rather than "touches the edge". */}
        <svg viewBox="0 0 14 14" aria-hidden="true">
          <line
            x1="3.5"
            y1="3.5"
            x2="10.5"
            y2="10.5"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
          />
          <line
            x1="10.5"
            y1="3.5"
            x2="3.5"
            y2="10.5"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
