import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { useGames, NO_IGDB_MATCH_SOURCE } from "../context/GameContext";
import { useToast } from "../context/ToastContext";
import { useLibraryFilters } from "../hooks/useLibraryFilters";
import { useSidebarCollapse } from "../context/SidebarCollapseContext";
import {
  gameNameFromPath,
  PLAY_STATUS_DETAILS,
  type Game,
  type GameMetadataResult,
  type PlayStatus,
} from "../types/game";
import ImportModal, { type ExeInfo } from "./ImportModal";
import SidebarFilterPopover from "./SidebarFilterPopover";
import {
  SidebarHoverPreview,
  buildSidebarAnchorSelector,
} from "./SidebarHoverPreview";
import { Button } from "./ui";

/**
 * Read the persisted pinned-id set from localStorage. Wrapped in
 * try/catch because private-browsing / sandboxed contexts can throw
 * on access — returning an empty Set keeps the sidebar renderable.
 * Per-entry type filtering defends against a corrupt payload (e.g.
 * a future schema migration that wrote numbers instead of strings):
 * one bad entry cannot poison the whole set.
 */
function loadPinnedIds(): Set<string> {
  try {
    if (typeof localStorage === "undefined") return new Set();
    const raw = localStorage.getItem("gamelib.sidebar.pinned_ids:v1");
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

/**
 * HighlightedName
 * ───────────────
 * Renders `name` with any substring matching `query` (case-
 * insensitive) wrapped in a <mark> tag for the matched substring.
 * React's JSX renders <mark> as a real text element so the wrapped
 * chunk can NEVER escape as raw HTML — XSS-safe by construction.
 *
 * Multiple matches are handled: the function walks the string with
 * `String.prototype.indexOf` from the last cursor. Empty/whitespace
 * queries fall through to an unhighlighted render so the search
 * experience feels "clean" once the user clears the input.
 */
function HighlightedName({ name, query }: { name: string; query: string }) {
  const trimmed = query.trim();
  if (!trimmed) return <>{name}</>;
  const qLower = trimmed.toLowerCase();
  const lower = name.toLowerCase();
  const parts: React.ReactNode[] = [];
  let last = 0;
  while (last < name.length) {
    const idx = lower.indexOf(qLower, last);
    if (idx === -1) {
      parts.push(name.substring(last));
      break;
    }
    if (idx > last) parts.push(name.substring(last, idx));
    parts.push(
      <mark key={`${name}-${idx}`}>{name.substring(idx, idx + qLower.length)}</mark>
    );
    last = idx + qLower.length;
  }
  return <>{parts}</>;
}

/**
 * ActiveFilterChips
 * ─────────────────
 * The horizontal strip of removable chips below the search row.
 * Each chip represents one advanced filter facet (status, source,
 * play status, genres, platforms, year, rating) plus a virtual
 * "Clear all" affordance at the start when more than one chip is
 * active. The strip scrolls horizontally on overflow rather than
 * wrapping, so it never pushes the divider down. Hidden entirely
 * when no filters are active.
 *
 * The remove button calls the corresponding `removeXxx` handler
 * passed from `useLibraryFilters` — we keep the chip's rendering
 * dumb so the filter hook remains the single source of truth.
 */
function ActiveFilterChips({
  filterState,
  onRemoveStatus,
  onRemoveSource,
  onRemovePlayStatus,
  onRemoveGenre,
  onRemovePlatform,
  onRemoveYear,
  onRemoveRating,
  onReset,
}: {
  filterState: {
    status: string;
    source: string;
    playStatus: string;
    genres: string[];
    platforms: string[];
    yearMin: number | null;
    yearMax: number | null;
    ratingMin: number | null;
  };
  onRemoveStatus: () => void;
  onRemoveSource: () => void;
  onRemovePlayStatus: () => void;
  onRemoveGenre: (g: string) => void;
  onRemovePlatform: (p: string) => void;
  onRemoveYear: () => void;
  onRemoveRating: () => void;
  onReset: () => void;
}) {
  const chips: { key: string; label: string; remove: () => void }[] = [];
  if (filterState.status !== "all") {
    chips.push({
      key: "status",
      label: filterState.status === "installed" ? "Installed" : "Uninstalled",
      remove: onRemoveStatus,
    });
  }
  if (filterState.source !== "all") {
    chips.push({
      key: `source-${filterState.source}`,
      label: `Source: ${filterState.source}`,
      remove: onRemoveSource,
    });
  }
  if (filterState.playStatus !== "all") {
    const meta = PLAY_STATUS_DETAILS[filterState.playStatus as PlayStatus];
    chips.push({
      key: "play-status",
      label: meta?.label || filterState.playStatus,
      remove: onRemovePlayStatus,
    });
  }
  for (const g of filterState.genres) {
    chips.push({ key: `g-${g}`, label: g, remove: () => onRemoveGenre(g) });
  }
  for (const p of filterState.platforms) {
    chips.push({ key: `p-${p}`, label: p, remove: () => onRemovePlatform(p) });
  }
  if (filterState.yearMin != null || filterState.yearMax != null) {
    chips.push({
      key: "year",
      label: `${filterState.yearMin ?? "any"}–${filterState.yearMax ?? "any"}`,
      remove: onRemoveYear,
    });
  }
  if (filterState.ratingMin != null) {
    chips.push({
      key: "rating",
      label: `≥${filterState.ratingMin}%`,
      remove: onRemoveRating,
    });
  }
  if (chips.length === 0) return null;
  return (
    <div
      className="sidebar-active-filters"
      role="region"
      aria-label="Active advanced filters"
    >
      {chips.length > 1 && (
        <span className="sidebar-active-filter">
          Clear all
          <button
            type="button"
            onClick={onReset}
            className="sidebar-active-filter__remove"
            aria-label="Clear all active filters"
            title="Clear all filters"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </span>
      )}
      {chips.map((c) => (
        <span key={c.key} className="sidebar-active-filter">
          {c.label}
          <button
            type="button"
            onClick={c.remove}
            className="sidebar-active-filter__remove"
            aria-label={`Remove filter: ${c.label}`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </span>
      ))}
    </div>
  );
}

export default function Sidebar() {
  const navigate = useNavigate();
  const { games, selectedGameId, setSelectedGameId, removeGame, runningGameIds, launchGame, importLocalGames, updateGame } =
    useGames();
  const { showToast } = useToast();

  // Full filter system for the sidebar game list. Reuses the same hook
  // the Library page uses, so search + status + genres + platforms +
  // release year + rating all narrow the list in real time. The
  // popover exposes everything except search (which lives in the
  // sidebar itself). The per-facet `removeX` callbacks below power
  // the ActiveFilterChips strip — each chip's × unmounts the
  // matching facet without clearing the others.
  const {
    filters: filterState,
    filteredGames,
    availableGenres,
    availablePlatforms,
    setSearch,
    setGenres,
    setPlatforms,
    setYearRange,
    setRatingMin,
    setStatus,
    setSort,
    removeGenre,
    removePlatform,
    removeYear,
    removeRating,
    removeStatus,
    removePlayStatus,
    removeSource,
    reset,
  } = useLibraryFilters(games);

  // Count of active advanced facets (everything except the always-visible
  // search). Drives BOTH the filter button's `active` class and its badge
  // so the two visuals stay in sync — typing in the sidebar search alone
  // shouldn't turn the button purple with no badge to justify it. The
  // search field itself is the visual indicator that search is active.
  const advancedFilterCount =
    (filterState.status !== "all" ? 1 : 0) +
    (filterState.genres.length > 0 ? 1 : 0) +
    (filterState.platforms.length > 0 ? 1 : 0) +
    (filterState.yearMin != null || filterState.yearMax != null ? 1 : 0) +
    (filterState.ratingMin != null ? 1 : 0);

  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showFilterPopover, setShowFilterPopover] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ game: Game; x: number; y: number } | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [scannedExes, setScannedExes] = useState<ExeInfo[]>([]);

  // ── Sidebar collapse (icon-rail mode) ─────────────────────────────
  // The SidebarCollapseProvider in App.tsx owns the persisted
  // boolean. We read it here so the header can render the toggle
  // button and the main JSX can switch to a compact rail layout
  // for the cover-only rows.
  const { isIconRail, toggle: toggleIconRail } = useSidebarCollapse();

  // ── Pinned Games (Feature #12) ───────────────────────────────────
  // Module-scope loader handles try/catch + corrupt-payload defense.
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => loadPinnedIds());
  // Persist on every change. Reads-then-writes is fine here — the
  // single Set instance is mutated locally and serialized once.
  useEffect(() => {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(
        "gamelib.sidebar.pinned_ids:v1",
        JSON.stringify(Array.from(pinnedIds))
      );
    } catch {
      /* quota / sandboxed contexts / private browsing — ignore */
    }
  }, [pinnedIds]);

  // ── Multi-select (Feature #13) ───────────────────────────────────
  // `bulkSelectedIds` is the canonical "what's checked" set.
  // `lastClickedId` is the shift-click anchor. Both are local
  // state — no need to lift into GameContext because the sidebar
  // is the only consumer and the selection clears on action.
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);

  // Escape clears bulk selection — single key to back out without
  // having to click each row off. Listener is bound only when the
  // selection is non-empty so an idle sidebar carries no handler.
  useEffect(() => {
    if (bulkSelectedIds.size === 0) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setBulkSelectedIds(new Set());
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bulkSelectedIds.size]);

  // ── Auto-scroll selected row into view (Feature #4) ──────────────
  // When selectedGameId changes via deep navigation (e.g. click on a
  // wishlist card → /library/:id), the matching row may be off-screen
  // because of filter or scroll position. We use `block: "nearest"`
  // so an already-visible row does NOT scroll (clicking inside the
  // sidebar thus doesn't trigger a twitch). The setTimeout defers
  // to the next paint cycle so the row has rendered before we
  // measure it.
  useEffect(() => {
    if (!selectedGameId) return;
    const handle = setTimeout(() => {
      try {
        const el = document.querySelector<HTMLElement>(
          `[data-sidebar-game-id="${CSS.escape(selectedGameId)}"]`
        );
        el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } catch {
        /* CSS.escape unavailable — skip */
      }
    }, 0);
    return () => clearTimeout(handle);
  }, [selectedGameId]);

  // ── Hover preview (Feature #9) ───────────────────────────────────
  // Single source of truth: the row's onMouseEnter sets the id,
  // onMouseLeave clears it. The SidebarHoverPreview component
  // handles its own delay timer + visibility.
  const [hoveredGameId, setHoveredGameId] = useState<string | null>(null);
  const hoveredGame = useMemo(
    () => (hoveredGameId ? (games.find((g) => g.id === hoveredGameId) ?? null) : null),
    [hoveredGameId, games]
  );

  // Pre-compute the selector so SidebarHoverPreview doesn't have to
  // re-derive the CSS escape each render.
  const hoverPreviewAnchor = useMemo(
    () => buildSidebarAnchorSelector(hoveredGameId),
    [hoveredGameId]
  );

  // ── Derived lists for rendering ──────────────────────────────────
  // Pinned games keep their insertion order via Set iteration
  // (matches "pin new = top of pinned section"). Filtering from
  // games (not filteredGames) keeps pins visible above any active
  // search filter so a user can always jump back to a pinned title
  // they've hidden by typing.
  const pinnedGames = useMemo(() => {
    return Array.from(pinnedIds)
      .map((id) => games.find((g) => g.id === id))
      .filter((g): g is Game => !!g);
  }, [pinnedIds, games]);

  // Main list dedupes against the pinned section so users don't see
  // the same row twice when a game is both pinned and matches the
  // current filter.
  const filteredNonPinned = useMemo(() => {
    if (pinnedIds.size === 0) return filteredGames;
    return filteredGames.filter((g) => !pinnedIds.has(g.id));
  }, [filteredGames, pinnedIds]);

  const importMenuRef = useRef<HTMLDivElement>(null);
  const importBtnRef = useRef<HTMLButtonElement>(null);
  // Ref to the filter icon button — passed to `SidebarFilterPopover` so
  // the popover can anchor itself next to the button and so its
  // click-outside detector doesn't treat clicks on the icon as
  // "outside" (which would race against the parent's toggle state).
  const filterBtnRef = useRef<HTMLButtonElement>(null);

  // Close import menu and context menu on outside click. The filter
  // popover manages its own dismissal (click anywhere outside the
  // popover OR the anchor, plus Escape) so the sidebars listen for
  // everything else.
  //
  // We bind to `click` (NOT `mousedown`) so the portaled context
  // menu's button onClick handlers run BEFORE the dismiss fires —
  // the menu's React `e.stopPropagation()` only stops React's
  // synthetic bubble, not native DOM bubbling, so a `mousedown`
  // listener would close the menu before the user could release
  // their click on a menu item. `click` fires after mouseup so the
  // menu button's onClick (which runs the action) executes first.
  // The downside: a user who opens the menu then drags out without
  // releasing on a menu item still triggers dismiss — which is the
  // expected loop-closing behavior anyway.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      // Ignore clicks whose target is inside the portaled menu —
      // React's stopPropagation runs but its scope is synthetic,
      // and the menu's button onClick that runs the action is
      // what we WANT to fire before dismiss. We tag the portal
      // root with `data-sidebar-context-menu` (set via the menu
      // component) so this handler can detect containment cheaply.
      const target = e.target as Element | null;
      if (target && target.closest("[data-sidebar-context-menu]")) {
        return;
      }
      setShowImportMenu(false);
      setContextMenu(null);
    }
    if (showImportMenu || contextMenu) {
      document.addEventListener("click", handleClick);
    }
    return () => document.removeEventListener("click", handleClick);
  }, [showImportMenu, contextMenu]);

  async function handleImportExe() {
    setShowImportMenu(false);
    try {
      const filePath = await open({
        multiple: false,
        directory: false,
        title: "Select Game Executable",
        filters: [{ name: "Executable", extensions: ["exe"] }],
      });
      if (filePath && typeof filePath === "string") {
        const existing = games.find((g) => g.path.toLowerCase().trim() === filePath.toLowerCase().trim());
        if (existing) {
          showToast(`${gameNameFromPath(filePath)} is already in your library`, "info");
          return;
        }
        setScannedExes([{ path: filePath, size: 0, modifiedAt: Math.round(Date.now() / 1000) }]);
        setShowImportModal(true);
      }
    } catch (err) {
      console.error("Failed to import exe:", err);
    }
  }

  async function handleImportFolder() {
    setShowImportMenu(false);
    try {
      const folderPath = await open({
        multiple: false,
        directory: true,
        title: "Select Folder to Scan for Games",
      });
      if (folderPath && typeof folderPath === "string") {
        const exes: ExeInfo[] = await invoke("scan_folder_for_exes", {
          folderPath,
        });
        if (exes.length === 0) {
          showToast("No executable files found in the selected folder", "info");
          return;
        }
        // Deduplicate against existing games before showing modal
        const existingPaths = new Set(games.map((g) => g.path.toLowerCase()));
        const newExes = exes.filter(
          (exe) => !existingPaths.has(exe.path.toLowerCase())
        );
        if (newExes.length === 0) {
          showToast("All executables in this folder are already in your library", "info");
          return;
        }
        setScannedExes(newExes);
        setShowImportModal(true);
      }
    } catch (err) {
      console.error("Failed to import folder:", err);
    }
  }

  async function handleConfirmImport(imports: { path: string; metadata: GameMetadataResult | null }[]) {
    setShowImportModal(false);
    await importLocalGames(imports);
  }

  function handleGameContextMenu(e: React.MouseEvent, game: Game) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ game, x: e.clientX, y: e.clientY });
  }

  function handleLaunchFromContextMenu(game: Game) {
    setContextMenu(null);
    launchGame(game);
  }

  function handleViewDetailsFromContextMenu(game: Game) {
    setContextMenu(null);
    setSelectedGameId(game.id);
    navigate(`/library/${game.id}`);
  }

  function handleRemoveFromContextMenu(game: Game) {
    removeGame(game.id);
    setContextMenu(null);
    showToast(`Removed ${game.name}`, "info");
  }

  // ──────────────────────────────────────────────────────────────────
  // Multi-select + plain/click row handler (Feature #13)
  // ──────────────────────────────────────────────────────────────────
  // Behavior:
  //   • Shift-click → select a contiguous range from the last
  //     clicked/selected row to the current row. Works across
  //     both pinned + main sections because the iteration uses
  //     the canonical flat list the user is currently looking
  //     at.
  //   • Ctrl/Cmd-click → toggle the row's membership in the selection
  //     set without changing selectedGameId or navigating.
  //   • Plain click → if a selection is active, clear it and fall
  //     through to the original "select + navigate" semantics.
  //     Otherwise just navigate.
  // We intentionally do NOT collapse the selection into the global
  // `selectedGameId` — the bulk action bar reads `bulkSelectedIds`
  // directly, and individual-vs-bulk are two orthogonal intents.
  const combinedVisibleGames = useMemo<Game[]>(
    () => [...pinnedGames, ...filteredNonPinned],
    [pinnedGames, filteredNonPinned]
  );

  function handleRowClick(game: Game, e: React.MouseEvent) {
    // Shift-click range: compute indices in the canonical list.
    if (e.shiftKey && lastClickedId) {
      e.preventDefault();
      e.stopPropagation();
      const ids = combinedVisibleGames.map((g) => g.id);
      const fromIdx = ids.indexOf(lastClickedId);
      const toIdx = ids.indexOf(game.id);
      if (fromIdx >= 0 && toIdx >= 0) {
        const [lo, hi] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
        setBulkSelectedIds((prev) => {
          const next = new Set(prev);
          for (let i = lo; i <= hi; i++) next.add(ids[i]);
          return next;
        });
      }
      return;
    }
    // Ctrl/Cmd-click toggle.
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      setLastClickedId(game.id);
      setBulkSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(game.id)) next.delete(game.id);
        else next.add(game.id);
        return next;
      });
      return;
    }
    // Plain click: clear any bulk selection so a stray click
    // doesn't accidentally carry selections into the new screen,
    // then navigate. Setting lastClickedId so a follow-up
    // shift-click anchors against the just-clicked row rather
    // than whatever was last toggled.
    setLastClickedId(game.id);
    if (bulkSelectedIds.size > 0) setBulkSelectedIds(new Set());
    setSelectedGameId(game.id);
    navigate(`/library/${game.id}`);
  }

  // ── Pin/unpin single game (Feature #12) ──────────────────────────
  // Used by the context-menu toggle. We use the functional updater
  // pattern so two rapid clicks on the same row can't read a stale
  // Set and accidentally double-pin (write-after-write race).
  const togglePin = useCallback((game: Game) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(game.id)) next.delete(game.id);
      else next.add(game.id);
      return next;
    });
  }, []);

  // ── Bulk action helpers (Feature #13) ─────────────────────────────
  // Each bulk operation intentionally clears the selection AFTER
  // running — leaving the check overlay up after the action is
  // done reads as "the action is still pending" and most users
  // will reflexively click another row before realizing the
  // first action completed.
  const bulkPin = useCallback(() => {
    const ids = Array.from(bulkSelectedIds);
    setPinnedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    setBulkSelectedIds(new Set());
  }, [bulkSelectedIds]);

  const bulkUnpin = useCallback(() => {
    const ids = Array.from(bulkSelectedIds);
    setPinnedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
    setBulkSelectedIds(new Set());
  }, [bulkSelectedIds]);

  const bulkRemove = useCallback(() => {
    const count = bulkSelectedIds.size;
    if (count === 0) return;
    bulkSelectedIds.forEach((id) => removeGame(id));
    setBulkSelectedIds(new Set());
    showToast(
      `Removed ${count} game${count !== 1 ? "s" : ""} from library`,
      "info"
    );
  }, [bulkSelectedIds, removeGame, showToast]);

  const bulkSetPlayStatus = useCallback(
    (status: PlayStatus) => {
      const count = bulkSelectedIds.size;
      if (count === 0) return;
      bulkSelectedIds.forEach((id) => updateGame(id, { playStatus: status }));
      setBulkSelectedIds(new Set());
      const meta = PLAY_STATUS_DETAILS[status];
      showToast(
        `Marked ${count} game${count !== 1 ? "s" : ""} as ${meta?.label || status}`,
        "success"
      );
    },
    [bulkSelectedIds, updateGame, showToast]
  );

  // ── Context menu actions (Feature #18) ───────────────────────────
  // Show-in-folder: uses the same `openPath` pattern as InfoKpiCard
  // — accepts a directory path and shells out to the OS file
  // manager (Explorer / Finder / Nautilus). Disabled when the
  // game has no on-disk path (Steam-owned titles without a local
  // install can't be revealed because there's nothing to point at).
  async function handleShowInFolder(game: Game) {
    setContextMenu(null);
    if (!game.path) {
      showToast(
        `${game.name} has no local path to reveal`,
        "info"
      );
      return;
    }
    try {
      const parent = game.path.replace(/[\\/][^\\/]+$/, "");
      await openPath(parent);
    } catch (err) {
      showToast(`Couldn't open folder: ${err}`, "error");
    }
  }

  // Open Store page: if we have a metadataUrl (IGDB / Steam) jump
  // to that external browser URL via plugin-opener. Falls back to
  // the in-app store search by name otherwise.
  function handleOpenStore(game: Game) {
    setContextMenu(null);
    if (game.metadataUrl) {
      openUrl(game.metadataUrl).catch(() => undefined);
      return;
    }
    navigate(`/store?q=${encodeURIComponent(game.name)}`);
  }

  // Copy launch path: best-effort clipboard via the browser API,
  // falling back to Tauri's clipboard-manager plugin. The toast
  // confirms so the user knows the action succeeded.
  async function handleCopyPath(game: Game) {
    setContextMenu(null);
    const text = game.path || game.name;
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      /* fall through */
    }
    if (!copied) {
      try {
        await invoke("plugin:clipboard-manager|write_text", {
          label: null,
          text,
        });
        copied = true;
      } catch {
        /* clipboard unavailable in this sandbox */
      }
    }
    showToast(
      copied ? "Copied to clipboard" : "Couldn't copy to clipboard",
      copied ? "success" : "error"
    );
  }

  // Set play status (single row, used by the context-menu submenu)
  function handleSetPlayStatus(game: Game, status: PlayStatus) {
    updateGame(game.id, { playStatus: status });
    setContextMenu(null);
    const meta = PLAY_STATUS_DETAILS[status];
    showToast(
      `${game.name} → ${meta?.label || status}`,
      "success"
    );
  }

  return (
    <aside className="sidebar">
      {/* Sidebar header. In icon-rail mode we render ONLY a small
       * collapse-to-full button so the 68px column stays clean —
       * the search / filter / import controls are hidden via the
       * `.app-sidebar.sidebar-icon-rail .sidebar-search → display:none`
       * rules but the JSX is still mounted for a clean toggle
       * without remounting React trees on collapse/expand. The
       * icon-rail collapse toggle sits at the top of the sidebar
       * header and is rotated 180° to read as "expand" — same
       * arrow direction as the rail-mode affordance in PS5/Steam
       * Big Picture. */}
      <div className="sidebar-header">
        <button
          type="button"
          className="sidebar-collapse-toggle"
          onClick={toggleIconRail}
          aria-label={isIconRail ? "Expand sidebar" : "Collapse sidebar"}
          aria-pressed={isIconRail}
          title={isIconRail ? "Expand sidebar" : "Collapse to icon rail"}
        >
          {isIconRail ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          )}
        </button>
        <div className="sidebar-search-row">
          <div className="sidebar-search">
            <svg
              className="sidebar-search-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search games..."
              value={filterState.search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                // Phase 2.9 PR 2: rolling industry-standard shortcut
                // — Escape clears the search input + drops focus, so
                // a user mid-typing who decides the filter is wrong
                // can blow the field away in a single keystroke.
                // `.blur()` is what makes the `:focus-within` widened
                // outer glow collapse back to the resting state. We
                // intentionally only react when the input has a
                // value — pressing Escape on an empty input does
                // nothing here so the keystroke doesn't accidentally
                // chain into the global sidebar Escape handler (if
                // we ever add one).
                if (e.key === "Escape" && filterState.search !== "") {
                  e.preventDefault();
                  setSearch("");
                  e.currentTarget.blur();
                }
              }}
            />
          </div>

          {/*
            Filter icon button. Sits to the right of the search input at
            the same height so the two controls feel like a unified
            toolbar. Shows a count badge (active-facets only, not search)
            and a glowing accent border whenever any advanced filter is
            active, so the user can tell at a glance that the list is
            being narrowed. Uses `aria-haspopup="dialog"` (not
            `aria-pressed`) because it opens a modal rather than toggling
            state.
          */}
          <button
            ref={filterBtnRef}
            className={`sidebar-filter-btn${advancedFilterCount > 0 ? " active" : ""}`}
            aria-label="Filter games"
            aria-haspopup="dialog"
            aria-expanded={showFilterPopover}
            onClick={() => setShowFilterPopover((v) => !v)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            {advancedFilterCount > 0 && (
              <span className="sidebar-filter-count">{advancedFilterCount}</span>
            )}
          </button>
        </div>

        <div className="sidebar-import-wrapper">
          <Button
            ref={importBtnRef}
            variant="secondary"
            className="sidebar-import-btn"
            title="Import games"
            onClick={(e) => {
              e.stopPropagation();
              setShowImportMenu((v) => !v);
            }}
            leftIcon={
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ width: 16, height: 16 }}
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            }
          >
            Import Games
          </Button>

          {showImportMenu &&
            createPortal(
              (() => {
                const rect = importBtnRef.current?.getBoundingClientRect();
                const menuStyle: React.CSSProperties = rect
                  ? {
                      position: "fixed",
                      top: rect.bottom + 6,
                      left: rect.left,
                      width: 240,
                      zIndex: 10000,
                    }
                  : { position: "fixed", zIndex: 10000 };
                return (
                  <div
                    ref={importMenuRef}
                    className="sidebar-import-menu"
                    data-sidebar-context-menu
                    style={menuStyle}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <button
                      className="sidebar-import-option"
                      onClick={handleImportExe}
                    >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="12" y1="18" x2="12" y2="12" />
                  <line x1="9" y1="15" x2="15" y2="15" />
                </svg>
                <div className="sidebar-import-option-text">
                  <span className="sidebar-import-option-title">
                    Import Game EXE
                  </span>
                  <span className="sidebar-import-option-desc">
                    Add a single game executable
                  </span>
                </div>
              </button>
              <button
                className="sidebar-import-option"
                onClick={handleImportFolder}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  <line x1="12" y1="11" x2="12" y2="17" />
                  <line x1="9" y1="14" x2="15" y2="14" />
                </svg>
                <div className="sidebar-import-option-text">
                  <span className="sidebar-import-option-title">
                    Import Folder
                  </span>
                  <span className="sidebar-import-option-desc">
                    Scan folder for all executables
                  </span>
                </div>
              </button>
              </div>
            );
              })(),
              document.body
            )}
        </div>
      </div>

      {/* Active-filter chips strip. Hidden when nothing advanced is
       * active (returns null). Wrapping with a fragment so we
       * don't add an extra div-level box; the chips strip itself
       * owns its padding. */}
      <ActiveFilterChips
        filterState={filterState}
        onRemoveStatus={removeStatus}
        onRemoveSource={removeSource}
        onRemovePlayStatus={removePlayStatus}
        onRemoveGenre={removeGenre}
        onRemovePlatform={removePlatform}
        onRemoveYear={removeYear}
        onRemoveRating={removeRating}
        onReset={reset}
      />

      <hr className="sidebar-divider" />

      {/* Pinned section. Renders above the main list so the
       * pinned titles are always reachable even when an active
       * filter narrows the main list to zero rows. Each pinned
       * row is the same SidebarGameItem component the main list
       * uses, just rendered separately so the section header
       * makes the affordance obvious. */}
      {pinnedGames.length > 0 && (
        <>
          <div className="sidebar-section-header">
            <span>
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
                style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 4 }}
              >
                <path d="M12 2 9 9 2 9.5l5.5 4.5L5 22l7-4 7 4-2.5-8 5.5-4.5L15 9z" />
              </svg>
              Pinned
            </span>
            <span className="sidebar-list-count">{pinnedGames.length}</span>
          </div>
          <div className="sidebar-pinned-list">
            {pinnedGames.map((game) => (
              <SidebarGameItem
                key={`pinned-${game.id}`}
                game={game}
                isSelected={selectedGameId === game.id}
                isRunning={runningGameIds.includes(game.id)}
                bulkSelected={bulkSelectedIds.has(game.id)}
                searchQuery={filterState.search}
                prefersCover={isIconRail}
                onClick={handleRowClick}
                onContextMenu={(e) => handleGameContextMenu(e, game)}
                onPointerEnter={(g) => setHoveredGameId(g.id)}
                onPointerLeave={() => setHoveredGameId((id) => (id === game.id ? null : id))}
              />
            ))}
          </div>
          <hr className="sidebar-divider sidebar-divider--thin" />
        </>
      )}

      <div className="sidebar-list-header">
        <span>Games</span>
        <span className="sidebar-list-count">{filteredNonPinned.length}</span>
      </div>

      <div className="sidebar-list">
        {filteredNonPinned.length === 0 ? (
          <div className="sidebar-empty">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            <p>{games.length === 0 ? "No games imported yet" : "No games found"}</p>
            {games.length === 0 && (
              <button onClick={() => setShowImportMenu(true)}>
                + Import Games
              </button>
            )}
          </div>
        ) : (
          <>
            {filteredNonPinned.map((game) => (
              <SidebarGameItem
                key={game.id}
                game={game}
                isSelected={selectedGameId === game.id}
                isRunning={runningGameIds.includes(game.id)}
                bulkSelected={bulkSelectedIds.has(game.id)}
                searchQuery={filterState.search}
                prefersCover={isIconRail}
                onClick={handleRowClick}
                onContextMenu={(e) => handleGameContextMenu(e, game)}
                onPointerEnter={(g) => setHoveredGameId(g.id)}
                onPointerLeave={() => setHoveredGameId((id) => (id === game.id ? null : id))}
              />
            ))}
            {/* Floating bulk-action bar — sticky to the bottom of
             * the scroll container so it stays visible while the
             * user mouses over selected rows far down the list.
             * Hidden when no bulk selection is active. Actions:
             * Pin / Unpin (toggles depending on whether the entire
             * selection is already pinned), Set Status, Remove.
             * Escape closes the selection. */}
            {bulkSelectedIds.size > 0 && (
              <BulkActionBar
                count={bulkSelectedIds.size}
                allPinned={
                  pinnedIds.size > 0 &&
                  Array.from(bulkSelectedIds).every((id) => pinnedIds.has(id))
                }
                onPin={bulkPin}
                onUnpin={bulkUnpin}
                onSetStatus={bulkSetPlayStatus}
                onRemove={bulkRemove}
                onCancel={() => setBulkSelectedIds(new Set())}
              />
            )}
          </>
        )}
      </div>
      {/* Context menu is portalled to `document.body` so it can
       *  extend past the sidebar's right edge without being
       *  clipped by `.app-sidebar { overflow: hidden }`. Without
       *  this the menu items truncate mid-label when the user's
       *  right-click sits inside the sidebar — the parent sidebar
       *  clips the overflow but the menu needs to draw over the
       *  main panel. Portal keeps the React tree (so handlers like
       *  `onMouseDown={stopPropagation}` still fire correctly)
       *  while letting the rendered DOM live at body level. */}
      {contextMenu &&
        createPortal(
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            game={contextMenu.game}
            isRunning={runningGameIds.includes(contextMenu.game.id)}
            isPinned={pinnedIds.has(contextMenu.game.id)}
            onLaunch={() => handleLaunchFromContextMenu(contextMenu.game)}
            onViewDetails={() => handleViewDetailsFromContextMenu(contextMenu.game)}
            onRemove={() => handleRemoveFromContextMenu(contextMenu.game)}
            onTogglePin={() => {
              togglePin(contextMenu.game);
              setContextMenu(null);
            }}
            onSetStatus={(s) => handleSetPlayStatus(contextMenu.game, s)}
            onShowInFolder={() => handleShowInFolder(contextMenu.game)}
            onOpenStore={() => handleOpenStore(contextMenu.game)}
            onCopyPath={() => handleCopyPath(contextMenu.game)}
          />,
          document.body
        )}

      {showImportModal && (
        <ImportModal
          exeInfos={scannedExes}
          onConfirm={handleConfirmImport}
          onCancel={() => setShowImportModal(false)}
        />
      )}

      {showFilterPopover && (
        <SidebarFilterPopover
          anchorRef={filterBtnRef}
          status={filterState.status}
          selectedGenres={filterState.genres}
          selectedPlatforms={filterState.platforms}
          yearMin={filterState.yearMin}
          yearMax={filterState.yearMax}
          ratingMin={filterState.ratingMin}
          sort={filterState.sort}
          availableGenres={availableGenres}
          availablePlatforms={availablePlatforms}
          totalGames={games.length}
          filteredCount={filteredGames.length}
          onStatusChange={setStatus}
          onGenresChange={setGenres}
          onPlatformsChange={setPlatforms}
          onYearRangeChange={setYearRange}
          onRatingMinChange={setRatingMin}
          onSortChange={setSort}
          onReset={reset}
          onClose={() => setShowFilterPopover(false)}
        />
      )}

      {/* Hover preview (Feature #9). Portal-based, anchored to the
       * closest `data-sidebar-game-id` row via CSS selector. The
       * component mounts nothing when `game === null` so this
       * line is a zero-cost no-op outside the hover window. */}
      <SidebarHoverPreview
        game={hoveredGame}
        anchorSelector={hoverPreviewAnchor}
        active={hoveredGameId !== null}
      />
    </aside>
  );
}

interface SidebarContextMenuProps {
  x: number;
  y: number;
  game: Game;
  isRunning: boolean;
  /** True when this game is in the pinned set. Drives the Pin/Unpin
   *  label switch and lets the menu read "already pinned now?" without
   *  needing the parent to compute it. */
  isPinned: boolean;
  onLaunch: () => void;
  onViewDetails: () => void;
  onRemove: () => void;
  onTogglePin: () => void;
  onSetStatus: (status: PlayStatus) => void;
  onShowInFolder: () => void;
  onOpenStore: () => void;
  onCopyPath: () => void;
}

function ContextMenu({
  x,
  y,
  game,
  isRunning,
  isPinned,
  onLaunch,
  onViewDetails,
  onRemove,
  onTogglePin,
  onSetStatus,
  onShowInFolder,
  onOpenStore,
  onCopyPath,
}: SidebarContextMenuProps) {
  // Width grew from 190 with the new items (Pin, Status submenu,
  // Show in folder, Open store, Copy path). Height grew similarly
  // because of the Status submenu expander. Update the
  // viewport-edge adjusters to match.
  const menuWidth = 230;
  const menuHeight = 360;
  const adjustedX = window.innerWidth - x < menuWidth ? x - menuWidth : x;
  const adjustedY = window.innerHeight - y < menuHeight ? y - menuHeight : y;

  // Status submenu open state + viewport position computed from
  // the trigger row's bounding rect. We do NOT rely on CSS
  // `position: absolute; left: 100%` because the surrounding
  // portaled menu can introduce stacking contexts / overflow that
  // silently shift the submenu out of view on some themes.
  // Instead the submenu is portaled to `document.body` with
  // explicit `position: fixed; top; left` so it always sits at
  // the right edge of the trigger row no matter what styling is
  // applied to ancestors. Recomputed every time `statusOpen`
  // flips true so a scroll between the menu's mount and the
  // first click can't leave the submenu stranded.
  const [statusOpen, setStatusOpen] = useState(false);
  const [submenuPos, setSubmenuPos] = useState<{ top: number; left: number } | null>(null);
  const hasSubmenuRef = useRef<HTMLDivElement>(null);

  function toggleStatusSubmenu() {
    setStatusOpen((prev) => {
      const next = !prev;
      if (next && hasSubmenuRef.current) {
        const rect = hasSubmenuRef.current.getBoundingClientRect();
        // Prefer flying out to the right; flip to the LEFT only
        // when there's not enough room past the trigger to fit
        // a 160px-min submenu. Clamp to viewport padding (8px)
        // so the submenu never bleeds off the screen.
        const SUBMENU_MIN_WIDTH = 168;
        const PAGE_MARGIN = 8;
        let left = rect.right + 4;
        if (left + SUBMENU_MIN_WIDTH > window.innerWidth - PAGE_MARGIN) {
          left = Math.max(
            PAGE_MARGIN,
            rect.left - SUBMENU_MIN_WIDTH - 4
          );
        }
        let top = rect.top;
        // Estimated height: 5 status options × ~28px + 8px padding.
        const ESTIMATED_SUBMENU_HEIGHT = 156;
        if (top + ESTIMATED_SUBMENU_HEIGHT > window.innerHeight - PAGE_MARGIN) {
          top = Math.max(PAGE_MARGIN, window.innerHeight - ESTIMATED_SUBMENU_HEIGHT - PAGE_MARGIN);
        }
        setSubmenuPos({ top, left });
      }
      return next;
    });
  }

  return (
    <div
      // `data-sidebar-context-menu` is the contract our parent
      // Sidebar's outside-click dismiss handler uses to detect the
      // portaled menu's DOM tree. React's `stopPropagation` only
      // blocks synthetic events; the dismiss handler is a NATIVE
      // document-level `click` listener, so it would otherwise see
      // every menu-item click and unmount the menu before the
      // item's onClick runs. The `closest()` check in the parent
      // useEffect early-returns for clicks tagged with this attr.
      className="context-menu"
      data-sidebar-context-menu="true"
      style={{ left: adjustedX, top: adjustedY, zIndex: 9200 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="context-menu-header">
        <span className="context-menu-title">{game.name}</span>
      </div>
      <button
        className="context-menu-item play-action"
        onClick={onLaunch}
        disabled={isRunning}
      >
        <svg viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        {isRunning ? "Running" : "Play Game"}
      </button>
      <button className="context-menu-item" onClick={onViewDetails}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        View Details
      </button>
      <button className="context-menu-item" onClick={onTogglePin}>
        <svg viewBox="0 0 24 24" fill={isPinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2 9 9 2 9.5l5.5 4.5L5 22l7-4 7 4-2.5-8 5.5-4.5L15 9z" />
        </svg>
        {isPinned ? "Unpin" : "Pin to Top"}
      </button>
      {/* Set Status — toggles a fly-out submenu that is portaled to
       *  document.body with position: fixed coords derived from
       *  this trigger row's bounding rect. Without portaling
       *  CSS containment (overflow:hidden on .context-menu ancestor,
       *  stacking-context clipping on a parent) can silently shift
       *  the submenu out of view. The portal guarantees it paints
       *  at the calculated viewport coordinates regardless.
       *  The trigger div keeps `position: relative` so the
       *  CSS-defined chevron submenu (`.has-submenu::after`) and
       *  any z-index layering still anchor cleanly to it. */}
      <div
        ref={hasSubmenuRef}
        className={`context-menu-item has-submenu${statusOpen ? " submenu-open" : ""}`}
        onClick={toggleStatusSubmenu}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleStatusSubmenu();
          }
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m21.64 3-2.28 2.28" />
          <path d="M3 21l9-9" />
          <path d="M14.5 6.5 21 13" />
          <circle cx="9" cy="7" r="3" />
        </svg>
        Set Status
      </div>
      {statusOpen && submenuPos &&
        createPortal(
          <div
            className="sidebar-context-submenu open"
            data-sidebar-context-menu="true"
            style={{
              position: "fixed",
              top: submenuPos.top,
              left: submenuPos.left,
              zIndex: 9300,
            }}
            role="menu"
            aria-label="Play status options"
          >
            {(["backlog", "playing", "completed", "on_hold", "abandoned"] as PlayStatus[]).map(
              (s) => {
                const meta = PLAY_STATUS_DETAILS[s];
                const active = (game.playStatus || "backlog") === s;
                return (
                  <button
                    key={s}
                    type="button"
                    className={`sidebar-context-submenu__item${active ? " active" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSetStatus(s);
                    }}
                  >
                    <span
                      className="dot"
                      style={{ background: meta.color }}
                    />
                    {meta.label}
                  </button>
                );
              }
            )}
          </div>,
          document.body
        )}
      <button className="context-menu-item" onClick={onShowInFolder}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        Show in Folder
      </button>
      <button className="context-menu-item" onClick={onOpenStore}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="21" r="1" />
          <circle cx="20" cy="21" r="1" />
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
        </svg>
        Open in Store
      </button>
      <button className="context-menu-item" onClick={onCopyPath}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
        </svg>
        Copy Path
      </button>
      <div className="context-menu-separator" />
      <button className="context-menu-item remove-action" onClick={onRemove}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
        Remove from Library
      </button>
    </div>
  );
}

/**
 * Single row in the sidebar's game list. Mirrors the auto-fetch
 * pattern from `LibraryGameCard`: an IntersectionObserver attached to
 * the row's outer `<div>` triggers `enrichGameMetadata` the moment the
 * row scrolls into view AND the game lacks a cover asset, so side-panel
 * games no longer need the user to open the Game detail page before
 * their artwork appears. The cover `<img>` wears the same Steam-CDN
 * `onError` fallback chain as the library card so older / modded
 * titles with no IGDB cover still gracefully degrade to `header.jpg`
 * before clearing `coverArtUrl` to trigger a re-arm and an IGDB /
 * LaunchBox re-scrape via the observer.
 *
 * Why the ref is on the OUTER `<button className="sidebar-game-item">`
 * rather than the inner `sidebar-game-icon`: attaching the observer to
 * the larger row rectangle means the trigger fires as soon as the row
 * is anywhere near the viewport — the 300 px rootMargin gives a generous
 * head-start — instead of waiting for the small 36 × 36 icon to enter
 * the viewport, which would otherwise miss rows whose icon is just
 * out-of-frame while the title is still readable.
 */
function SidebarGameItem({
  game,
  isSelected,
  isRunning,
  bulkSelected,
  searchQuery,
  prefersCover,
  onClick,
  onContextMenu,
  onPointerEnter,
  onPointerLeave,
}: {
  game: Game;
  isSelected: boolean;
  isRunning: boolean;
  bulkSelected: boolean;
  searchQuery: string;
  /**
   * When true, prefer `coverArtUrl` (the full-cover artwork, e.g.
   * IGDB / Steam library_600x900) over `iconUrl` (the small
   * square library icon). Set in icon-rail mode so each row is
   * visually dominated by its game cover rather than a 32×32
   * square thumbnail; the rail is wide enough (68px) for the
   * larger image to read clearly while the title/meta is hidden.
   */
  prefersCover?: boolean;
  onClick: (game: Game, e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onPointerEnter: (game: Game) => void;
  onPointerLeave: () => void;
}) {
  const { updateGame, enrichGameMetadata } = useGames();
  // The ref is attached to the OUTER `<button className="sidebar-game-item">`,
  // not the inner icon — see the doc comment above for why the larger
  // rectangle wins for IntersectionObserver rootMargin. React 19 infers
  // the ref type from the element, so the explicit `HTMLButtonElement`
  // generic must match the JSX element type.
  const coverRef = useRef<HTMLButtonElement | null>(null);

  // Auto-enrich criteria — short-circuits the observer setup so we
  // don't spam IGDB for games we already know are unmatched.
  const canAutoFetchCover =
    !game.coverArtUrl &&
    game.metadataSource !== NO_IGDB_MATCH_SOURCE &&
    !!game.name;

  // Set up the IntersectionObserver. Disconnect on first intersect —
  // the session dedupe in `enrichGameMetadata` makes repeat calls
  // no-ops, and the effect re-arms whenever `canAutoFetchCover` flips
  // (e.g. user manually cleared the cover via the edit modal and the
  // row scrolls back into view), so the loop is self-healing.
  useEffect(() => {
    if (!canAutoFetchCover || !coverRef.current) return;
    const node = coverRef.current;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        enrichGameMetadata(game.id, game.name, game.steamAppId).catch(
          (err) =>
            console.warn(
              `Sidebar auto-cover fetch failed for ${game.name}:`,
              err
            )
        );
      },
      { rootMargin: "300px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [canAutoFetchCover, game.id, game.name, game.steamAppId, enrichGameMetadata]);

  return (
    <button
      type="button"
      ref={coverRef}
      data-sidebar-game-id={game.id}
      className={`sidebar-game-item${isSelected ? " active" : ""}${bulkSelected ? " bulk-selected" : ""}`}
      onClick={(e) => onClick(game, e)}
      onContextMenu={onContextMenu}
      onMouseEnter={() => onPointerEnter(game)}
      onMouseLeave={onPointerLeave}
    >
      <div className="sidebar-game-icon">
        {/* Image priority chain:
         *   • prefersCover + coverArtUrl → cover (icon-rail mode).
         *     Covers are aspect-ratio (often 2:3), cropped to fit
         *     the rail box via `object-fit: cover` in CSS.
         *   • otherwise iconUrl (small Steam library square), falls
         *     through to coverArtUrl, falls through to the
         *     placeholder SVG.
         *  The Steam-CDN onError fallback chain is shared with the
         *  Library page's auto-fetch so a tile that 404s on the
         *  hi-res URL still has a graceful degradation path. */}
        {prefersCover && game.coverArtUrl ? (
          <img
            src={game.coverArtUrl}
            alt={game.name}
            onError={(e) => {
              const img = e.currentTarget;
              const appId = game.steamAppId;
              if (appId) {
                if (img.src.includes("library_600x900_2x")) {
                  img.src = `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`;
                  return;
                }
                if (img.src.includes("library_600x900")) {
                  img.src = `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`;
                  return;
                }
              }
              updateGame(game.id, { coverArtUrl: undefined });
            }}
          />
        ) : game.iconUrl ? (
          <img src={game.iconUrl} alt={game.name} />
        ) : game.coverArtUrl ? (
          <img
            src={game.coverArtUrl}
            alt={game.name}
            onError={(e) => {
              const img = e.currentTarget;
              // Steam-CDN fallback chain. Walks to progressively
              // simpler URLs on each onError, then clears
              // `coverArtUrl` once the chain is exhausted —
              // clearing re-renders the placeholder AND flips
              // `canAutoFetchCover` back to `true`, so the
              // observer above re-arms and scrapes IGDB /
              // LaunchBox for a real cover on the next
              // intersection.
              const appId = game.steamAppId;
              if (appId) {
                if (img.src.includes("library_600x900_2x")) {
                  img.src = `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`;
                  return;
                }
                if (img.src.includes("library_600x900")) {
                  img.src = `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`;
                  return;
                }
              }
              console.warn(
                `Sidebar cover image failed for ${game.name}, falling back to placeholder`
              );
              updateGame(game.id, { coverArtUrl: undefined });
            }}
          />
        ) : (
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            opacity={0.3}
          >
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        )}
        {/* Bulk-select check badge — pinned to the row's top-right.
         *  Always present in the DOM so the entrance animation
         *  (`opacity 0→1, scale 0.6→1`) can run when the class flips.
         *  `pointer-events: none` so the badge can't intercept a
         *  click meant for the row underneath. */}
        <div className="sidebar-game-item__check" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      </div>
      <div className="sidebar-game-info">
        <div className="sidebar-game-name">
          {/* Wraps the matched substring in <mark> for the search
           *  highlight (Feature #5). React renders the mark as a
           *  real element so XSS is impossible by construction. */}
          <HighlightedName name={game.name} query={searchQuery} />
        </div>
        <div className="sidebar-game-meta">
          {game.platform} · {game.playTime}
        </div>
      </div>
      {/* Status dot (RIGHT) — last in the flex row so it sits
       *  visually on the right edge, after the title/meta.
       *  All rows share the same rightmost X coordinate
       *  (gap-controlled, with `flex-shrink: 0`) so the dots
       *  line up vertically in a single column on the right.
       *  `aria-label` reads the install state to screen
       *  readers so the visual-only colored dot isn't lost
       *  in the aural rendering. */}
      <div
        className={`sidebar-game-status ${isRunning ? "running" : game.installed ? "installed" : "not-installed"}`}
        aria-label={
          isRunning
            ? "Running"
            : game.installed
            ? "Installed"
            : "Not installed"
        }
      />
    </button>
  );
}

/**
 * BulkActionBar
 * ─────────────
 * Floating bar that renders inside the sidebar list area at
 * `position: sticky; bottom: 0` so it always floats above the
 * last visible row, regardless of how far down the list the
 * user has scrolled. Each action runs the corresponding
 * `useCallback`-wrapped handler from the parent Sidebar —
 * kept terse here so all bulk-action logic lives in one place.
 *
 * The `Cancel` button (× icon) clears the selection WITHOUT
 * running an action — same effect as Escape but visualized
 * for users who don't try the keyboard.
 *
 * The "Pin / Unpin" toggle swaps based on `allPinned` so a
 * user pressing it twice doesn't end up making the entire
 * selection pinned, then immediately un-pinned: the button
 * label clearly communicates what the next click will do.
 */
function BulkActionBar({
  count,
  allPinned,
  onPin,
  onUnpin,
  onSetStatus,
  onRemove,
  onCancel,
}: {
  count: number;
  allPinned: boolean;
  onPin: () => void;
  onUnpin: () => void;
  onSetStatus: (s: PlayStatus) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="sidebar-bulk-action-bar"
      role="region"
      aria-label={`Bulk actions for ${count} selected games`}
    >
      <div className="sidebar-bulk-action-bar__count" aria-live="polite">
        <span>{count} selected</span>
      </div>
      <div className="sidebar-bulk-action-bar__actions">
        <button
          type="button"
          className="sidebar-bulk-action-bar__btn"
          onClick={allPinned ? onUnpin : onPin}
          title={allPinned ? "Unpin selected" : "Pin selected"}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2 9 9 2 9.5l5.5 4.5L5 22l7-4 7 4-2.5-8 5.5-4.5L15 9z" />
          </svg>
          <span>{allPinned ? "Unpin" : "Pin"}</span>
        </button>
        <PlayStatusMenuButton
          onSelect={(s) => onSetStatus(s)}
          ariaLabel="Set play status for selection"
        />
        <button
          type="button"
          className="sidebar-bulk-action-bar__btn sidebar-bulk-action-bar__btn--danger"
          onClick={onRemove}
          title="Remove from library"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          <span>Remove</span>
        </button>
        <button
          type="button"
          className="sidebar-bulk-action-bar__btn"
          onClick={onCancel}
          title="Cancel selection (Esc)"
          aria-label="Cancel selection"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/**
 * Compact play-status select button used by the bulk action bar.
 * Renders the chip as a <select> for native, accessible keyboard
 * support. Visual styling matches the surrounding bulk-action
 * buttons so the bar reads as a single language.
 */
function PlayStatusMenuButton({
  onSelect,
  ariaLabel,
}: {
  onSelect: (s: PlayStatus) => void;
  ariaLabel: string;
}) {
  const options: PlayStatus[] = ["backlog", "playing", "completed", "on_hold", "abandoned"];
  return (
    <select
      className="sidebar-bulk-action-bar__btn"
      onChange={(e) => {
        const v = e.target.value as PlayStatus;
        if (v) onSelect(v);
        // Reset to placeholder so picking the same status twice
        // still fires onChange.
        e.currentTarget.value = "";
      }}
      aria-label={ariaLabel}
      defaultValue=""
    >
      <option value="" disabled>
        Status…
      </option>
      {options.map((s) => (
        <option key={s} value={s}>
          {PLAY_STATUS_DETAILS[s].label}
        </option>
      ))}
    </select>
  );
}
