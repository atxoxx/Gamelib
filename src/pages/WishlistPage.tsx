import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import StoreGameCard from "../components/store/StoreGameCard";
import { useWishlistContext } from "../context/WishlistContext";
import { PriceProvider } from "../context/PriceContext";
import { requestShareToFriends } from "./friendSuggestionSignal";
import type { StoreGameSummary, WishlistEntry } from "../types/game";

type WishlistSort = "date_added" | "name" | "rating" | "release_date";
type WishlistGroup = "all" | "released" | "coming_soon";

const SORT_LABELS: Record<WishlistSort, string> = {
  date_added: "Date Added (Newest)",
  name: "Name (A–Z)",
  rating: "Highest Rated",
  release_date: "Release Date",
};

const WISHLIST_FILTERS_KEY = "gamelib_wishlist_filters_v1";

interface PersistedFilters {
  search: string;
  genres: string[];
  platforms: string[];
  sort: WishlistSort;
  group: WishlistGroup;
}

const DEFAULT_FILTERS: PersistedFilters = {
  search: "",
  genres: [],
  platforms: [],
  sort: "date_added",
  group: "all",
};

function parseStoredFilters(raw: unknown): PersistedFilters {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_FILTERS;
  }
  const obj = raw as Record<string, unknown>;
  const sort: WishlistSort =
    obj.sort === "name" || obj.sort === "rating" || obj.sort === "release_date"
      ? obj.sort
      : "date_added";
  const group: WishlistGroup =
    obj.group === "released" || obj.group === "coming_soon"
      ? obj.group
      : "all";
  return {
    search: typeof obj.search === "string" ? obj.search : "",
    genres: Array.isArray(obj.genres)
      ? obj.genres.filter((g): g is string => typeof g === "string")
      : [],
    platforms: Array.isArray(obj.platforms)
      ? obj.platforms.filter((p): p is string => typeof p === "string")
      : [],
    sort,
    group,
  };
}

function isReleased(entry: WishlistEntry): boolean {
  if (!entry.firstReleaseDate) return false;
  const t = new Date(entry.firstReleaseDate).getTime();
  return Number.isFinite(t) && t <= Date.now();
}

/**
 * WishlistPage: dedicated tab mounted at `/wishlist`. Reads its state from the
 * lifted `WishlistProvider` that wraps `<Routes>` in `App.tsx`, so the same
 * wishlist state tree is shared with `StorePage`'s cards. Users can:
 *
 *   - See all wishlisted games in a grid, grouped by released / coming soon.
 *   - Search, filter by genre/platform, and sort the list.
 *   - Attach a free-text note to each game (persisted locally).
 *   - Toggle hearts to remove items, or clear the whole list at once.
 *
 * Density is read from `DensityContext` (also lifted), so toggling the density
 * in the Store page updates this page automatically.
 */
import { useBigScreen } from "../context/BigScreenContext";
import BigScreenStore from "../components/store/BigScreenStore";

export default function WishlistPage() {
  const { isBigScreen } = useBigScreen();
  if (isBigScreen) {
    return <BigScreenStore />;
  }
  const navigate = useNavigate();
  const { wishlist, hydrated, toggle, setNote, clear } = useWishlistContext();

  // ── Filter / sort state (persisted to localStorage) ──────────────────
  const [filters, setFilters] = useState<PersistedFilters>(() => {
    try {
      const raw = localStorage.getItem(WISHLIST_FILTERS_KEY);
      if (raw) return parseStoredFilters(JSON.parse(raw));
    } catch {
      /* corrupt or unavailable */
    }
    return DEFAULT_FILTERS;
  });

  useEffect(() => {
    try {
      localStorage.setItem(WISHLIST_FILTERS_KEY, JSON.stringify(filters));
    } catch {
      /* storage may throw in private mode */
    }
  }, [filters]);

  const setSearch = useCallback(
    (search: string) => setFilters((f) => ({ ...f, search })),
    []
  );
  const setSort = useCallback(
    (sort: WishlistSort) => setFilters((f) => ({ ...f, sort })),
    []
  );
  const setGroup = useCallback(
    (group: WishlistGroup) => setFilters((f) => ({ ...f, group })),
    []
  );
  const toggleGenre = useCallback(
    (g: string) =>
      setFilters((f) => ({
        ...f,
        genres: f.genres.includes(g)
          ? f.genres.filter((x) => x !== g)
          : [...f.genres, g],
      })),
    []
  );
  const togglePlatform = useCallback(
    (p: string) =>
      setFilters((f) => ({
        ...f,
        platforms: f.platforms.includes(p)
          ? f.platforms.filter((x) => x !== p)
          : [...f.platforms, p],
      })),
    []
  );
  const resetFilters = useCallback(() => setFilters(DEFAULT_FILTERS), []);

  // ── Derived facet lists from the current wishlist ────────────────────
  const availableGenres = useMemo(() => {
    const set = new Set<string>();
    for (const e of wishlist) for (const g of e.genres ?? []) if (g) set.add(g);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [wishlist]);

  const availablePlatforms = useMemo(() => {
    const set = new Set<string>();
    for (const e of wishlist)
      for (const p of e.platforms ?? []) if (p) set.add(p);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [wishlist]);

  const hasActiveFilters =
    filters.search.trim().length > 0 ||
    filters.genres.length > 0 ||
    filters.platforms.length > 0 ||
    filters.group !== "all";

  // ── Filter + sort the list ───────────────────────────────────────────
  const visible = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    let list = wishlist.filter((e) => {
      if (q && !e.name.toLowerCase().includes(q)) return false;
      if (filters.genres.length > 0) {
        const lower = (e.genres ?? []).map((g) => g.toLowerCase());
        if (!filters.genres.some((g) => lower.includes(g.toLowerCase())))
          return false;
      }
      if (filters.platforms.length > 0) {
        const lower = (e.platforms ?? []).map((p) => p.toLowerCase());
        if (!filters.platforms.some((p) => lower.includes(p.toLowerCase())))
          return false;
      }
      if (filters.group === "released" && !isReleased(e)) return false;
      if (filters.group === "coming_soon" && isReleased(e)) return false;
      return true;
    });

    list = [...list];
    switch (filters.sort) {
      case "name":
        list.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "rating":
        list.sort(
          (a, b) => (b.rating ?? b.aggregatedRating ?? 0) - (a.rating ?? a.aggregatedRating ?? 0)
        );
        break;
      case "release_date":
        list.sort((a, b) => {
          const ta = a.firstReleaseDate ? new Date(a.firstReleaseDate).getTime() : 0;
          const tb = b.firstReleaseDate ? new Date(b.firstReleaseDate).getTime() : 0;
          return tb - ta;
        });
        break;
      case "date_added":
      default:
        list.sort((a, b) => b.addedAt - a.addedAt);
        break;
    }
    return list;
  }, [wishlist, filters]);

  const releasedCount = useMemo(
    () => wishlist.filter((e) => isReleased(e)).length,
    [wishlist]
  );

  // ── Clear-wishlist confirm dialog ────────────────────────────────────
  const [confirmClear, setConfirmClear] = useState(false);
  const handleClear = useCallback(() => {
    clear();
    setConfirmClear(false);
  }, [clear]);

  const handleCardClick = (game: StoreGameSummary) => {
    navigate(`/store/${game.slug}`);
  };

  const handleBrowseStore = () => {
    navigate("/store");
  };

  return (
    <PriceProvider>
    <div className="wishlist-page">
      <header className="wishlist-page-header">
        <div className="wishlist-page-title-row">
          <span className="wishlist-page-icon" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </span>
          <h1 className="wishlist-page-title">Your Wishlist</h1>
          <span className="wishlist-page-count">
            {wishlist.length === 0
              ? "Empty"
              : `${wishlist.length} game${wishlist.length !== 1 ? "s" : ""}`}
          </span>
          {wishlist.length > 0 && (
            <button
              type="button"
              className="wishlist-clear-btn"
              onClick={() => setConfirmClear(true)}
            >
              Clear all
            </button>
          )}
        </div>
        <p className="wishlist-page-subtitle">
          Games you've saved to revisit later. Tap the heart on any card to
          remove it, and add a note to remember why it's here. Wishlist data is
          stored locally on your device.
        </p>
      </header>

      {wishlist.length === 0 ? (
        <div className="wishlist-empty" role="status" aria-live="polite">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
          {hydrated ? (
            <>
              <strong>No games in your wishlist yet</strong>
              <p>
                Tap the heart on any game in the Store to add it here. We'll
                keep it safe on this device.
              </p>
              <button
                type="button"
                className="wishlist-empty-cta"
                onClick={handleBrowseStore}
              >
                Browse the Store
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </button>
            </>
          ) : (
            <p>Loading your wishlist…</p>
          )}
        </div>
      ) : (
        <>
          {/* ── Toolbar ─────────────────────────────────────────────── */}
          <div className="wishlist-toolbar">
            <div className="wishlist-search">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                value={filters.search}
                placeholder="Search wishlist…"
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search wishlist"
              />
              {filters.search && (
                <button
                  type="button"
                  className="wishlist-search-clear"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                >
                  ×
                </button>
              )}
            </div>

            <div className="wishlist-group-tabs" role="group" aria-label="Group by status">
              <button
                type="button"
                className={filters.group === "all" ? "active" : ""}
                onClick={() => setGroup("all")}
              >
                All
              </button>
              <button
                type="button"
                className={filters.group === "released" ? "active" : ""}
                onClick={() => setGroup("released")}
              >
                Out now ({releasedCount})
              </button>
              <button
                type="button"
                className={filters.group === "coming_soon" ? "active" : ""}
                onClick={() => setGroup("coming_soon")}
              >
                Coming soon ({wishlist.length - releasedCount})
              </button>
            </div>

            <label className="wishlist-sort">
              <span className="wishlist-sort-label">Sort</span>
              <select
                value={filters.sort}
                onChange={(e) => setSort(e.target.value as WishlistSort)}
                aria-label="Sort wishlist"
              >
                {(Object.keys(SORT_LABELS) as WishlistSort[]).map((s) => (
                  <option key={s} value={s}>
                    {SORT_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* ── Genre / platform filter chips ───────────────────────── */}
          {(availableGenres.length > 0 || availablePlatforms.length > 0) && (
            <div className="wishlist-filters">
              {availableGenres.map((g) => (
                <button
                  key={`g-${g}`}
                  type="button"
                  className={`wishlist-chip${
                    filters.genres.includes(g) ? " active" : ""
                  }`}
                  onClick={() => toggleGenre(g)}
                  aria-pressed={filters.genres.includes(g)}
                >
                  {g}
                </button>
              ))}
              {availablePlatforms.map((p) => (
                <button
                  key={`p-${p}`}
                  type="button"
                  className={`wishlist-chip platform${
                    filters.platforms.includes(p) ? " active" : ""
                  }`}
                  onClick={() => togglePlatform(p)}
                  aria-pressed={filters.platforms.includes(p)}
                >
                  {p}
                </button>
              ))}
              {hasActiveFilters && (
                <button
                  type="button"
                  className="wishlist-chip reset"
                  onClick={resetFilters}
                >
                  Clear filters
                </button>
              )}
            </div>
          )}

          {/* ── Result count ───────────────────────────────────────── */}
          <p className="wishlist-result-count">
            Showing {visible.length} of {wishlist.length}
          </p>

          {/* ── Grid ──────────────────────────────────────────────── */}
          {visible.length === 0 ? (
            <div className="wishlist-empty small">
              <strong>No matches</strong>
              <p>Try a different search or clear the active filters.</p>
              <button
                type="button"
                className="wishlist-empty-cta"
                onClick={resetFilters}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="wishlist-page-grid">
              {visible.map((entry) => (
                <WishlistCard
                  key={entry.slug}
                  entry={entry}
                  onOpen={() => handleCardClick(entry)}
                  onToggle={() => toggle(entry)}
                  onNoteChange={(note) => setNote(entry.slug, note)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Clear confirmation dialog ──────────────────────────────── */}
      {confirmClear && (
        <div
          className="wishlist-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Clear wishlist"
          onClick={() => setConfirmClear(false)}
        >
          <div
            className="wishlist-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Clear your wishlist?</h2>
            <p>
              This removes all {wishlist.length} game
              {wishlist.length !== 1 ? "s" : ""} and notes from your wishlist.
              This action can't be undone.
            </p>
            <div className="wishlist-modal-actions">
              <button
                type="button"
                className="wishlist-modal-cancel"
                onClick={() => setConfirmClear(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="wishlist-modal-confirm"
                onClick={handleClear}
              >
                Clear all
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </PriceProvider>
  );
}

/**
 * WishlistCard: a `StoreGameCard` augmented with the "added on" date and an
 * inline note editor. The note is local to the card while editing and flushed
 * up via `onNoteChange` (which persists through `WishlistContext.setNote`).
 */
function WishlistCard({
  entry,
  onOpen,
  onToggle,
  onNoteChange,
}: {
  entry: WishlistEntry;
  onOpen: () => void;
  onToggle: () => void;
  onNoteChange: (note: string) => void;
}) {
  const navigate = useNavigate();

  const shareToFriends = () => {
    requestShareToFriends({
      gameId: entry.slug,
      gameName: entry.name,
      coverUrl: entry.coverUrl,
    });
    navigate("/friends");
  };
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.note ?? "");
  const [expanded, setExpanded] = useState(false);

  // Keep the draft in sync if the entry note changes externally.
  useEffect(() => {
    if (!editing) setDraft(entry.note ?? "");
  }, [entry.note, editing]);

  const saveNote = useCallback(() => {
    onNoteChange(draft);
    setEditing(false);
    setExpanded(false);
  }, [draft, onNoteChange]);

  const addedLabel = useMemo(() => {
    const d = new Date(entry.addedAt);
    if (!Number.isFinite(d.getTime())) return "";
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }, [entry.addedAt]);

  // ── Release date + live "time until release" countdown ────────────────
  const release = useMemo(() => {
    if (!entry.firstReleaseDate) return null;
    const date = new Date(entry.firstReleaseDate);
    if (!Number.isFinite(date.getTime())) return null;
    const released = date.getTime() <= Date.now();
    return {
      date,
      released,
      label: date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
    };
  }, [entry.firstReleaseDate]);

  // Tick every minute so the countdown stays fresh without thrashing.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (release?.released) return;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [release?.released]);

  const countdown = useMemo(() => {
    if (!release || release.released) return null;
    let diff = Math.max(0, release.date.getTime() - now);
    const days = Math.floor(diff / 86_400_000);
    diff -= days * 86_400_000;
    const hours = Math.floor(diff / 3_600_000);
    diff -= hours * 3_600_000;
    const minutes = Math.floor(diff / 60_000);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }, [release, now]);

  const showFullNote = expanded || draft.length <= 120;

  return (
    <div className="wishlist-card-wrap">
      <StoreGameCard
        game={entry}
        wishlisted
        onClick={onOpen}
        onToggleWishlist={(game) => {
          // StoreGameCard passes the game; we just need the toggle behavior.
          onToggle();
          void game;
        }}
      />
      <div className="wishlist-card-meta">
        <span className="wishlist-added-date" title={`Added ${addedLabel}`}>
          Added {addedLabel}
        </span>
        <button
          type="button"
          className="wishlist-share-btn"
          onClick={shareToFriends}
          title="Share this game with friends"
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
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
          Share to Friends
        </button>
      </div>

      {release && (
        <div
          className={`wishlist-release${release.released ? " released" : ""}`}
          title={
            release.released
              ? `Released ${release.label}`
              : `Releases ${release.label}`
          }
        >
          <span className="wishlist-release-icon" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </span>
          <span className="wishlist-release-text">
            {release.released ? (
              <span className="wishlist-release-out">Out now</span>
            ) : (
              <>
                <span className="wishlist-release-count">{countdown}</span>
                <span className="wishlist-release-date">{release.label}</span>
              </>
            )}
          </span>
        </div>
      )}

      <div className="wishlist-note">
        {editing ? (
          <div className="wishlist-note-editor">
            <textarea
              value={draft}
              placeholder="Add a note (why you want this game, sale target, etc.)…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setDraft(entry.note ?? "");
                  setEditing(false);
                }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  saveNote();
                }
              }}
              autoFocus
              rows={3}
              aria-label={`Note for ${entry.name}`}
            />
            <div className="wishlist-note-actions">
              <button
                type="button"
                className="wishlist-note-cancel"
                onClick={() => {
                  setDraft(entry.note ?? "");
                  setEditing(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="wishlist-note-save"
                onClick={saveNote}
              >
                Save note
              </button>
            </div>
          </div>
        ) : entry.note ? (
          <div className="wishlist-note-view-row">
            <button
              type="button"
              className="wishlist-note-view"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              <span className="wishlist-note-text">
                {showFullNote ? entry.note : `${entry.note.slice(0, 120)}…`}
              </span>
            </button>
            <button
              type="button"
              className="wishlist-note-edit"
              onClick={() => {
                setDraft(entry.note ?? "");
                setEditing(true);
              }}
              aria-label={`Edit note for ${entry.name}`}
              title="Edit note"
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
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="wishlist-note-add"
            onClick={() => setEditing(true)}
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
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add note
          </button>
        )}
      </div>
    </div>
  );
}
