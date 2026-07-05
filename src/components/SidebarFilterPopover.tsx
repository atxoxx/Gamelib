import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LibraryStatus, LibrarySort } from "../hooks/useLibraryFilters";
import { SORT_LABELS, SORT_OPTIONS } from "../hooks/useLibraryFilters";

/** Status toggle options. Declared at module scope so the literal
 *  `LibraryStatus` type is preserved on each `value` instead of widening
 *  to `string`. Matches the option set used elsewhere so the UX is
 *  identical between Library, Store, and the sidebar popover. */
const STATUS_OPTIONS: readonly { value: LibraryStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "installed", label: "Installed" },
  { value: "not_installed", label: "Uninstalled" },
];  /** Fallback width, used only if the browser hasn't yet laid out the
 *  popover when the position manager runs (extremely rare, since
 *  `useLayoutEffect` runs after layout). The canonical width is set
 *  in CSS as the `--sidebar-filter-popover-width` custom property on
 *  the `.sidebar-filter-popover` rule; the JS reads the live
 *  `getBoundingClientRect().width` for the actual rendered width, so
 *  changing the CSS value alone is enough to resize the popover and
 *  its flip logic at the same time. */
const FALLBACK_WIDTH_PX = 300;

/** Minimum gap between the popover and the viewport edges so the card
 *  never sticks flush to the edge. The positioning state machine
 *  clamps the final `left` and `top` against these. */
const VIEWPORT_MARGIN = 12;

interface SidebarFilterPopoverProps {
  /** The icon button the popover anchors to. Pass the same ref the
   *  click handler uses so position calc, focus restoration, and
   *  click-outside detection all read from a single element. The
   *  generic is widened to `HTMLElement | null` so a
   *  `useRef<HTMLButtonElement>(null)` (or any HTML element ref) can
   *  be passed without variance issues between React's
   *  `RefObject<T>` instantiations. */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Currently active status filter. */
  status: LibraryStatus;
  /** Currently selected genres (OR). */
  selectedGenres: string[];
  /** Currently selected platforms (exact match). */
  selectedPlatforms: string[];
  /** Lower bound on release year. */
  yearMin: number | null;
  /** Upper bound on release year. */
  yearMax: number | null;
  /** Minimum IGDB / critic rating (0–100, null = no minimum). */
  ratingMin: number | null;
  /** Current sort order. */
  sort: LibrarySort;
  /** Unique genre names present in the library, sorted alphabetically. */
  availableGenres: string[];
  /** Unique platform names present in the library, sorted alphabetically. */
  availablePlatforms: string[];
  /** Total games before filtering (denominator for the count line). */
  totalGames: number;
  /** Games passing the current filter set (numerator for the count line). */
  filteredCount: number;
  onStatusChange: (s: LibraryStatus) => void;
  onGenresChange: (g: string[]) => void;
  onPlatformsChange: (p: string[]) => void;
  onYearRangeChange: (min: number | null, max: number | null) => void;
  onRatingMinChange: (r: number | null) => void;
  onSortChange: (s: LibrarySort) => void;
  onReset: () => void;
  onClose: () => void;
}

/**
 * SidebarFilterPopover
 *
 *  A compact anchored popover that opens next to the sidebar's filter
 *  icon. Replaces the earlier full-screen modal — the user wanted
 *  something smaller and more beautiful that lives next to the icon it
 *  was triggered from. Renders into a portal on `document.body` so it
 *  is never clipped by the sidebar's `overflow: hidden` or hidden
 *  behind a sibling's stacking context.
 *
 *  Positioning
 *  ───────────
 *  Computed via `useLayoutEffect` from the anchor element's bounding
 *  rect on (a) initial open, (b) every window resize, and (c) every
 *  scroll on the page and on its scrollable ancestors. The popover
 *  flips horizontally onto the left side of the anchor when there's
 *  not enough room on the right (typical when the user is on the
 *  Library page and the panel beneath is wide). Falls back to
 *  positioning below the anchor if there isn't space above either.
 *
 *  Dismissal
 *  ─────────
 *  - Click anywhere outside the popover OR the anchor button
 *  - Press Escape
 *  - Click the close X in the header
 *
 *  Accessibility
 *  ─────────────
 *  Uses `role="dialog"` with `aria-modal` set so screen readers
 *  announce it as a modal even though it has no inline backdrop.
 *  Focus moves to the first tabbable element on open and is restored
 *  to the anchor on close, so keyboard users don't lose their place.
 *  Tab cycles within the popover (small, predictable focus group).
 *
 *  Visual approach
 *  ───────────────
 *  - Pill toggles for status / genres / platforms instead of a
 *    checkbox list. Chips wrap, multi-select via re-click.
 *  - Year range as compact dual numeric inputs with a thin "—" separator.
 *  - Rating slider with a numeric badge that updates live.
 *  - Header has the title and a small (recycle) reset + (X) close pair.
 *  - Footer shows the live "X of Y" count, left-aligned — gives the
 *    screen-reader announcement of the result count and gives the user
 *    a real-time preview of how aggressive their filter is.
 *  - Card fades + scales in from the anchor in 180ms.
 *  - Subtle shadow, 1px accent border, no full-page overlay.
 */
export default function SidebarFilterPopover({
  anchorRef,
  status,
  selectedGenres,
  selectedPlatforms,
  yearMin,
  yearMax,
  ratingMin,
  sort,
  availableGenres,
  availablePlatforms,
  totalGames,
  filteredCount,
  onStatusChange,
  onGenresChange,
  onPlatformsChange,
  onYearRangeChange,
  onRatingMinChange,
  onSortChange,
  onReset,
  onClose,
}: SidebarFilterPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  // Storing `onClose` in a ref lets the keydown handler (registered
  // once on mount) call the latest version without re-binding on every
  // parent render. Same pattern used in the previous modal.
  const onCloseRef = useRef(onClose);

  // Computed popover geometry stored in state so the JSX stays pure.
  // Holds both the screen coordinates (`top`/`left`) AND a flag that
  // picks the entrance animation direction (`growFromLeft`). Keeping
  // the direction here (instead of deriving it in the JSX) avoids
  // reading `anchorRef.current.getBoundingClientRect()` during render,
  // which would be a side effect firing twice in React Strict Mode and
  // would couple the JSX to a value not in props/state. Position starts
  // off-screen with `growFromLeft: true`; the layout effect below
  // fixes both in a single update before the user sees anything.
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    growFromLeft: boolean;
  }>({
    top: VIEWPORT_MARGIN,
    left: VIEWPORT_MARGIN,
    growFromLeft: true,
  });

  // ── Position recalc ─────────────────────────────────────────────────
  // Recomputed on:
  //   1. Mount — paints the card at the correct coordinates before
  //      the user can see it
  //   2. Window resize — flips horizontally if space runs out
  //   3. Scroll on any ancestor — keeps the card pinned to the anchor
  useLayoutEffect(() => {
    function recompute() {
      const anchor = anchorRef.current;
      const popover = popoverRef.current;
      if (!anchor || !popover) return;

      const rect = anchor.getBoundingClientRect();
      const popRect = popover.getBoundingClientRect();
      // `popRect.width` reads the rendered width, which is sourced
      // from `--sidebar-filter-popover-width` in the CSS. The literal
      // fallback is only used if the browser hasn't yet computed
      // layout for a freshly mounted element — which `useLayoutEffect`
      // effectively rules out, but we keep a guard for paranoia.
      const popWidth = popRect.width || FALLBACK_WIDTH_PX;
      const popHeight = popRect.height;

      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Horizontal: prefer placing the popover to the right of the
      // anchor's right edge. If there isn't room (`right + width +
      // margin > vw`), flip onto the left side so the card sits
      // against the icon's left edge.
      const spaceRight = vw - rect.right - VIEWPORT_MARGIN;
      const spaceLeft = rect.left - VIEWPORT_MARGIN;
      let left: number;
      let growFromLeft: boolean;
      if (spaceRight >= popWidth) {
        left = rect.right + 4;
        growFromLeft = true;
      } else if (spaceLeft >= popWidth) {
        left = rect.left - popWidth - 4;
        growFromLeft = false;
      } else {
        // Neither side fits cleanly — pick whichever side has more
        // room and clamp against the right viewport edge.
        if (spaceRight >= spaceLeft) {
          left = rect.right + 4;
          growFromLeft = true;
        } else {
          left = rect.left - popWidth - 4;
          growFromLeft = false;
        }
      }
      left = Math.max(
        VIEWPORT_MARGIN,
        Math.min(left, vw - popWidth - VIEWPORT_MARGIN)
      );

      // Vertical: align the popover's top with the anchor's top by
      // default. If the popover would extend past the bottom of the
      // viewport, shift it up so the footer stays visible.
      let top = rect.top;
      if (top + popHeight + VIEWPORT_MARGIN > vh) {
        top = Math.max(VIEWPORT_MARGIN, vh - popHeight - VIEWPORT_MARGIN);
      }
      if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;

      setPosition({ top, left, growFromLeft });
    }

    recompute();

    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, true);
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, true);
    };
    // `anchorRef` is a stable ref object (its identity never changes),
    // so it's intentionally excluded from the deps array. Including
    // it would be flagged by `react-hooks/exhaustive-deps` lint rules
    // and adds noise without affecting when the effect runs.
  }, []);

  // ── Mount: focus capture + global dismissal handlers ───────────────
  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    // Push focus into the popover so screen readers announce it and
    // tab navigation starts inside the card.
    requestAnimationFrame(() => {
      const first = popoverRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      first?.focus();
    });

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }

      // Lightweight tab trap: cycle within the popover's focusables
      // so keyboard users can't tab into the page underneath. We
      // deliberately allow Shift+Tab to leave backward onto the
      // trigger if it's the first focusable (handled below) — but
      // mostly we want Tab inside the popover.
      if (e.key !== "Tab" || !popoverRef.current) return;
      const focusable = popoverRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    function handlePointerDown(e: MouseEvent) {
      // Dismiss if the click is outside BOTH the popover and the
      // anchor button. Documenting both because clicking the icon
      // again while the popover is open should toggle (close), which
      // the parent already handles — we just want to avoid treating
      // that click as a stray "outside" event before the toggle
      // fires.
      const target = e.target as Node | null;
      if (popoverRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onCloseRef.current();
    }

    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handlePointerDown);
      // Restore focus to whatever opened the popover.
      previouslyFocusedRef.current?.focus();
    };
    // `anchorRef` is a stable ref object — intentionally excluded from
    // deps. We bind once on mount and read the live element via the
    // ref's `.current` inside the closure.
  }, []);

  // Keep the latest `onClose` in the ref so the listener above (bound
  // once on mount) can call the most recent version.
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const handleGenreToggle = (genre: string) => {
    if (selectedGenres.includes(genre)) {
      onGenresChange(selectedGenres.filter((g) => g !== genre));
    } else {
      onGenresChange([...selectedGenres, genre]);
    }
  };

  const handlePlatformToggle = (platform: string) => {
    if (selectedPlatforms.includes(platform)) {
      onPlatformsChange(selectedPlatforms.filter((p) => p !== platform));
    } else {
      onPlatformsChange([...selectedPlatforms, platform]);
    }
  };

  // Memoize the genre / platform chip list — re-rendering the same
  // arrays on every keystroke (year input, slider drag) is wasted work.
  const genreChips = useMemo(
    () => availableGenres.slice(0, 24),
    [availableGenres]
  );
  const platformChips = useMemo(
    () => availablePlatforms.slice(0, 24),
    [availablePlatforms]
  );

  return createPortal(
    <div
      ref={popoverRef}
      className={`sidebar-filter-popover ${position.growFromLeft ? "from-left" : "from-right"}`}
      style={{ top: position.top, left: position.left }}
      role="dialog"
      aria-modal="true"
      aria-label="Filter games"
    >
      {/* Header ───────────────────────────────────────────────────── */}
      <header className="sidebar-filter-popover-header">
        <div className="sidebar-filter-popover-title">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
          <span>Filters</span>
        </div>
        <div className="sidebar-filter-popover-header-actions">
          <button
            type="button"
            className="sidebar-filter-popover-icon-btn"
            aria-label="Reset filters"
            onClick={onReset}
            title="Reset all filters"
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
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
          </button>
          <button
            type="button"
            className="sidebar-filter-popover-icon-btn"
            aria-label="Close filters"
            onClick={onClose}
            title="Close"
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
        </div>
      </header>

      {/* Body ─────────────────────────────────────────────────────── */}
      <div className="sidebar-filter-popover-body">
        {/* ── Status: segmented pill control ── */}
        <section className="sidebar-filter-popover-section">
          <h4 className="sidebar-filter-popover-heading">Status</h4>
          <div className="sidebar-filter-popover-segmented">
            {STATUS_OPTIONS.map((opt) => {
              const active = status === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  className={`sidebar-filter-popover-segment${active ? " active" : ""}`}
                  aria-pressed={active}
                  onClick={() => onStatusChange(opt.value)}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* ── Sort: compact dropdown ── */}
        <section className="sidebar-filter-popover-section">
          <h4 className="sidebar-filter-popover-heading">Sort</h4>
          <select
            className="sidebar-filter-popover-select"
            value={sort}
            onChange={(e) => onSortChange(e.target.value as LibrarySort)}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{SORT_LABELS[opt]}</option>
            ))}
          </select>
        </section>

        {/* ── Genres: wrapping toggle chips ── */}
        {genreChips.length > 0 && (
          <section className="sidebar-filter-popover-section">
            <h4 className="sidebar-filter-popover-heading">
              Genres
              {selectedGenres.length > 0 && (
                <span className="sidebar-filter-popover-heading-count">
                  {selectedGenres.length}
                </span>
              )}
            </h4>
            <div className="sidebar-filter-popover-chips">
              {genreChips.map((genre) => {
                const active = selectedGenres.includes(genre);
                return (
                  <button
                    key={genre}
                    type="button"
                    className={`sidebar-filter-popover-chip${active ? " active" : ""}`}
                    aria-pressed={active}
                    onClick={() => handleGenreToggle(genre)}
                  >
                    {genre}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Platforms: wrapping toggle chips ── */}
        {platformChips.length > 0 && (
          <section className="sidebar-filter-popover-section">
            <h4 className="sidebar-filter-popover-heading">
              Platforms
              {selectedPlatforms.length > 0 && (
                <span className="sidebar-filter-popover-heading-count">
                  {selectedPlatforms.length}
                </span>
              )}
            </h4>
            <div className="sidebar-filter-popover-chips">
              {platformChips.map((platform) => {
                const active = selectedPlatforms.includes(platform);
                return (
                  <button
                    key={platform}
                    type="button"
                    className={`sidebar-filter-popover-chip${active ? " active" : ""}`}
                    aria-pressed={active}
                    onClick={() => handlePlatformToggle(platform)}
                  >
                    {platform}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Year range: side-by-side compact inputs ── */}
        <section className="sidebar-filter-popover-section">
          <h4 className="sidebar-filter-popover-heading">Release Year</h4>
          <div className="sidebar-filter-popover-year">
            <input
              type="number"
              inputMode="numeric"
              className="sidebar-filter-popover-year-input"
              placeholder="From"
              value={yearMin ?? ""}
              min={1970}
              max={2030}
              onChange={(e) => {
                const raw = e.target.value.trim();
                onYearRangeChange(raw ? Number(raw) : null, yearMax);
              }}
            />
            <span className="sidebar-filter-popover-year-dash" aria-hidden="true">
              –
            </span>
            <input
              type="number"
              inputMode="numeric"
              className="sidebar-filter-popover-year-input"
              placeholder="To"
              value={yearMax ?? ""}
              min={1970}
              max={2030}
              onChange={(e) => {
                const raw = e.target.value.trim();
                onYearRangeChange(yearMin, raw ? Number(raw) : null);
              }}
            />
          </div>
        </section>

        {/* ── Rating: slider with live numeric badge ── */}
        <section className="sidebar-filter-popover-section">
          <div className="sidebar-filter-popover-heading-row">
            <h4 className="sidebar-filter-popover-heading">Minimum Rating</h4>
            <span
              className={`sidebar-filter-popover-rating-value${ratingMin != null ? " active" : ""}`}
            >
              {/* "Any" when no rating filter is set, so the badge
               *  doesn't visually claim "rating ≥ 0" (which every game
               *  satisfies). The number itself only appears once the
               *  user has dragged the slider above zero. */}
              {ratingMin ?? "Any"}
            </span>
          </div>
          <input
            type="range"
            className="sidebar-filter-popover-slider"
            min={0}
            max={100}
            step={5}
            value={ratingMin ?? 0}
            onChange={(e) => {
              const v = Number(e.target.value);
              onRatingMinChange(v > 0 ? v : null);
            }}
          />
        </section>
      </div>

      {/* Footer: live count, small and unobtrusive ───────────────── */}
      <footer className="sidebar-filter-popover-footer">
        <span className="sidebar-filter-popover-count">
          <strong>{filteredCount}</strong> of {totalGames} game{totalGames !== 1 ? "s" : ""}
        </span>
      </footer>
    </div>,
    document.body
  );
}
