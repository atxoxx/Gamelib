import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * SidebarCollapseContext
 * ──────────────────────
 * Single source of truth for the left sidebar's full vs. icon-rail
 * mode. The App grid reads `isIconRail` to flip the CSS grid
 * column on `.app-layout.sidebar-icon-rail`, while the Sidebar
 * component reads the same value to render the toggle button and
 * the right compact-vs-full markup.
 *
 * Why a context (not just `useState` + a custom hook called by both
 * `App.tsx` and `Sidebar.tsx`):
 *  • `App.tsx` lives ABOVE the Sidebar in the component tree, but
 *    both need to re-render the moment the user clicks the
 *    collapse button in the sidebar. Two independent `useState`
 *    calls would either race (state desync between the two) or
 *    require a non-trivial shared `useEffect`/storage-event bridge
 *    to keep them in lockstep. A single shared state is cheaper.
 *  • Context also gives us a stable hook API for tests and any
 *    future consumer (e.g. a Visual Settings page that wants to
 *    toggle the rail from outside the sidebar).
 *
 * Persistence:
 *  Writes the boolean to localStorage on every change. Cross-tab
 *  sync via the `storage` event lets a second window pick up the
 *  toggle in real time. The `:v1` suffix on the key lets us bump
 *  the schema later without colliding with the legacy boolean.
 *
 * Default: full sidebar (`isIconRail = false`). We default to the
 * roomy mode because:
 *  • the icon rail hides the search box + import controls. A first-
 *    visit user landing on an empty icon rail with no hint how to
 *    find games would be a poor onboarding experience.
 *  • the user can opt-in to the rail explicitly.
 */
export interface SidebarCollapseContextValue {
  /** True when the sidebar is collapsed to a narrow icon-only rail. */
  isIconRail: boolean;
  /** Flip between full and icon-rail. */
  toggle: () => void;
  /** Force a specific value (used by tests + visual Settings UI). */
  setIconRail: (next: boolean) => void;
}

const SidebarCollapseContext = createContext<SidebarCollapseContextValue | null>(
  null
);

const LS_SIDEBAR_ICON_RAIL_KEY = "gamelib.sidebar.icon_rail:v1";

function readPersisted(): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(LS_SIDEBAR_ICON_RAIL_KEY) === "true";
  } catch {
    return false;
  }
}

function writePersisted(next: boolean) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(LS_SIDEBAR_ICON_RAIL_KEY, String(next));
  } catch {
    /* ignore quota / sandbox errors */
  }
}

export function SidebarCollapseProvider({ children }: { children: ReactNode }) {
  // Initialize from localStorage so a returning user lands on their
  // last-chosen state without a flash of full-sidebar-then-icon-rail
  // on mount. Initial read returns `false` on any error path.
  const [isIconRail, setIsIconRail] = useState<boolean>(() => readPersisted());

  // Persist on change. Effect is keyed only on `isIconRail` so the
  // writer runs once on mount (no-op write) and once per actual
  // toggle — no stale-closure issues because the writer only reads
  // the live state value.
  useEffect(() => {
    writePersisted(isIconRail);
  }, [isIconRail]);

  // Cross-window sync: when another instance (e.g. a future second
  // Tauri window) flips the value, the `storage` event propagates
  // the write here and we update our own React state. Within a single
  // window the event does not fire for our own writes — the reread
  // would be a self-acknowledge no-op anyway.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== LS_SIDEBAR_ICON_RAIL_KEY) return;
      setIsIconRail(e.newValue === "true");
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggle = useCallback(() => setIsIconRail((c) => !c), []);
  const setIconRail = useCallback((next: boolean) => setIsIconRail(next), []);

  const value = useMemo<SidebarCollapseContextValue>(
    () => ({ isIconRail, toggle, setIconRail }),
    [isIconRail, toggle, setIconRail]
  );

  return (
    <SidebarCollapseContext.Provider value={value}>
      {children}
    </SidebarCollapseContext.Provider>
  );
}

export function useSidebarCollapse(): SidebarCollapseContextValue {
  const ctx = useContext(SidebarCollapseContext);
  if (!ctx) {
    throw new Error(
      "useSidebarCollapse must be used within a SidebarCollapseProvider"
    );
  }
  return ctx;
}
