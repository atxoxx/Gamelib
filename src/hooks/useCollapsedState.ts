import { useEffect, useState } from "react";

/**
 * `useCollapsedState` — shared persistence-and-collapse helper used by
 * the collapsible Library rails (Continue Playing, Recently Added, …).
 *
 * Why a shared hook instead of duplicated `useState`/`useEffect` blocks
 * in each rail:
 *  1. Persistence logic (the try/catch around `localStorage`, the SSR
 *     guard via `typeof localStorage`, the boolean coercion) needs to
 *     be IDENTICAL across rails — drifting copies is how corrupt
 *     localStorage keys and 500-on-mount bugs creep in.
 *  2. The "auto-expand when the rail has nothing to show" rule is a
 *     UX contract shared by every collapsable rail: the user should
 *     never land on a collapsed section that hides the empty-state
 *     onboarding copy. Centralizing the derived state means we can't
 *     forget to apply it.
 *
 * The hook stores the **user's preference** (`userCollapsed`) and
 * derives the **effective collapse state** (`isCollapsed`) from both
 * the preference AND whether the rail has content. This single-source
 * model avoids the "initializer reads length + effect re-reads length"
 * tangle that produced two code paths handling the same edge case
 * before.
 *
 * Args:
 *  - `key`         localStorage key. Versioned suffix (`...:v1`) lets
 *                  us bump the schema without colliding with stale reads.
 *  - `hasContent`  Whether the rail has anything to display. When
 *                  `false`, `isCollapsed` is forced to `false` so the
 *                  empty-state card is always visible. The user's
 *                  preference is still remembered — when content
 *                  returns (e.g. a session timestamps back into the
 *                  window after a pause), `isCollapsed` resumes.
 *  - `defaultCollapsed` What `userCollapsed` should be on first visit
 *                  (when no value is stored yet).
 */
export function useCollapsedState(
  key: string,
  hasContent: boolean,
  defaultCollapsed = true,
): [isCollapsed: boolean, toggle: () => void, setCollapsed: (v: boolean) => void] {
  const [userCollapsed, setUserCollapsed] = useState<boolean>(() => {
    const persisted = readStored(key);
    return persisted ?? defaultCollapsed;
  });

  // Persist the user's actual choice (not the derived `isCollapsed`)
  // so the original preference survives a temporary "0 items" bounce.
  // Example: user collapses Continue Playing, then they stop playing
  // for two weeks (rail empties out → forced expanded → user plays
  // again → rail has items → their COLLAPSED choice is restored).
  useEffect(() => {
    writeStored(key, userCollapsed);
  }, [key, userCollapsed]);

  // Single-source derived state. `false` whenever the rail has nothing
  // to show — pinning the empty-state card to "always visible".
  const isCollapsed = userCollapsed && hasContent;
  const toggle = () => setUserCollapsed((c) => !c);

  return [isCollapsed, toggle, setUserCollapsed];
}

/** Read the persisted collapsed flag. Returns `null` when nothing has
 *  been stored yet (signals "first visit" to the caller). Wrapped in
 *  try/catch because localStorage throws in private-browsing /
 *  sandboxed / SSR / `cookies-blocked` contexts, and a 500 on mount
 *  would crash the whole Library page. */
function readStored(key: string): boolean | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    return raw === "true";
  } catch {
    return null;
  }
}

/** Mirror of readStored for writes. */
function writeStored(key: string, value: boolean) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, String(value));
  } catch {
    /* ignore quota / sandbox errors */
  }
}
