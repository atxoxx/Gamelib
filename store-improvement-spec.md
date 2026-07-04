# Store Page — Improvement & Feature Spec

> Source: interview transcript (4 rounds). Goal: combine **visual/UX polish** with **new discovery features**, kept deliberately lighter ("list of ideas" depth) so we can pick favorites later.
>
> **Out of scope:** Backend migration off IGDB, GamePage redesign, Rust scraper rewrites.

---

## 0. Decisions Locked From Interview

| Topic | Decision |
|---|---|
| Primary goal | Visual/UX polish **+** new discovery features |
| Default landing | Hero banner + horizontal scrollers (Switchpad-style) |
| Browsing modes | Add **Coming Soon** & **New Releases** as new tabs in `StoreTabBar` |
| Wishlist storage | New **disk cache file** alongside `store_cache.json` in app data dir |
| Card variant | **Layout switcher** (Compact / Cozy / Cinematic) toggle |
| IGDB source | Sole data source — no Steam/RAWG/etc. migrations |

`StoreTabBar` will become:
```
Trending • Popular • Top • Coming Soon • New Releases • All • Search
```
(7 tabs total — risk of overflow on small screens, addressed in §6.)

---

## 1. Discovery — Landing Experience (`DiscoverPage` or rework of default tab)

### 1.1 Hero Feature Strip
- **What:** Full-width banner (~600px tall) showing one auto-rotating "Game of the Day" — large art, gradient overlay, logo/title, short tagline, "View →" CTA.
- **Why:** Give the store a "wow" intro; users currently drop into the same Trending grid as the Steam homepage.
- **Where:** As the **first element** of `/store` (or a new `/store/discover` route — see §6).

### 1.2 Horizontal Rails
- **What:** Below the hero, stack **4 horizontal scrollers** (`SnapRail`):
  1. **Trending** (top 12)
  2. **New This Week** (top 12)
  3. **Free to Play** (top 12, IGDB filter)
  4. **Top Critics** (top 12)
- **Why:** Lets users see variety without scrolling vertical grids. Each rail is clickable — clicking the title expands it into a full grid view.
- **Where:** Right under the hero.

### 1.3 Featured Chips (Promotional Markers)
- **What:** Cards in rails can show small badges: `NEW`, `HOT`, `FREE`, `UPCOMING`, `#1 IN {{GENRE}}`.
- **Why:** Adds visual rhythm and helps users spot interesting cards at a glance.

---

## 2. Browsing Modes — New Tabs

### 2.1 "Coming Soon" Tab
- **What:** Lists games with `first_release_date` between today and ~6 months out. Sorted by hype descending.
- **Why:** Strong discovery motivator; users love seeing what's next. Built-in IGDB query: `first_release_date > now & first_release_date < now+6m & hypes > 0`.
- **Where:** New `StoreCategory = "coming_soon"`.

### 2.2 "New Releases" Tab
- **What:** Games released in the **last 30 days**, sorted by release date desc.
- **Why:** Complement to Coming Soon — covers the "what just dropped" use case. IGDB query: `first_release_date > now-30d`.
- **Where:** New `StoreCategory = "new_releases"`.

### 2.3 Tab Hover Preview (concept)
- **What:** Hovering a tab could trigger a tooltip with a 5×3 mini-grid preview ("Trending → 15 thumbnails").
- **Why:** Power-user nicety; helps users decide which tab to click. Optional, defer if scope tight.

*(Both 2.1 and 2.2 are pure IGDB queries — small additions to `fetch_store_games` in Rust.)*

---

## 3. Wishlist & Favorites

### 3.1 Heart Icon on Store Game Cards
- **What:** Top-right of `StoreGameCard` shows an empty/heart icon. Click → toggles wishlist, toast confirms.
- **Why:** Universal pattern; users want to save games they discover without adding to library.
- **Where:** `StoreGameCard.tsx` (present in ALL store views).

### 3.2 "Wishlist" Tab in StoreSidebar (NEW)
- **What:** Show all wishlisted games in a grid (or accessible from a top-bar pill next to Search).
- **Why:** Centralized place to revisit saved games. Resets on `Clear wishlist` action.
- **Scope:** Read-only — wishlisted games aren't automatically in library.

### 3.3 Wishlist Persistence
- **What:** New file `<app_data>/wishlist_cache.json` containing `Record<gameSlug, { addedAt: number }>`.
- **Why:** Disk cache file is the decision-locked location. Tiny file, easy to merge/sync.
- **Where:** New hook `useWishlist.ts` mirroring `useStoreCache` shape.

### 3.4 "Not Interested" (light hide)
- **What:** Each card gets a "Hide" action (or right-click menu) marking a game as `dismissed: true`. Hidden games are filtered out of every category view by default (toggle to show).
- **Why:** Quick escape from noise without leaving the page.

---

## 4. Card Design & View Density

### 4.1 View-Density Toggle Switcher
- **What:** Floating top-right (or top-bar segment control) offering three modes:
  - **Compact** — current `150px`-wide covers, minimal meta, dense grid.
  - **Cozy** — `200px` covers, 2-line title, visible rating + year.
  - **Cinematic** — `280px` covers, full meta visible (genres, platforms, year), hover-trailer preview, bigger title.
- **Why:** Lets users self-tune based on screen size and intent (browse vs. inspect).
- **Where:** `StorePage.tsx` near the search bar. Preference saved to `localStorage` (purely UI; no Rust changes).

### 4.2 Card Hover Treatment
- **What:** On hover: subtle scale (1.02), accent glow border, secondary info fades in (`totalRatingCount`, `hypes`, release date).
- **Why:** Common store pattern; gives each card a "pop".

### 4.3 "In Library" Indicator
- **What:** Cards already in library show a small ✓ badge with `View in Library` action.
- **Why:** Avoid the duplicate-add flow; clarify which games are owned.

### 4.4 Trailer-on-Hover (Cinematic only)
- **What:** On hover (1.5s delay), swap cover image for first YouTube trailer thumbnail (or muted auto-play loop if extension allows later).
- **Why:** Cinematic store hero feel; great when paired with bigger cards.

---

## 5. Search Polish

### 5.1 Search Suggestion Dropdown
- **What:** As user types, show top 5 IGDB matches with cover thumbnail + name + release year in a dropdown attached to the search bar.
- **Why:** Classic store UX live-search pattern; faster than waiting for full results.
- **Implementation:** New debounced query `search_suggestions` (Rust) — or simplified: re-use existing `search_store_games` with `limit=5`.

### 5.2 Recent Searches
- **What:** Empty search state shows last 5 searches + "Popular searches" (curated list).
- **Why:** Users often re-search the same games.

### 5.3 Inline Result Count
- **What:** Currently shown only after first result. Show immediately with a placeholder count ("~245 results for 'hades'").
- **Why:** Less jarring transition.

### 5.4 Search Scope Filters
- **What:** Tiny "scope" chips inside the search bar: `[All]`, `[Multiplayer]`, `[Co-op]`, `[Singleplayer]`, `[Released only]`.
- **Why:** Reduces need to switch to All Games tab for filtered searches.

---

## 6. Filter / Sort UX

### 6.1 Reorganize Filter Sidebar
- **What:** Move filters out of a grayed-out placeholder into a real UX (Todo `# TODO: Wire to backend when filter support is added` in current `StorePage.tsx`). Sections:
  - **Platforms** (multi-select chips, with icons)
  - **Genres** (multi-select chips, color-coded)
  - **Year Range** (dual-thumb slider, 1970 → current year + 2)
  - **Minimum Rating** (live read-out, slider 0–100)
  - **Sort By** (Popularity / Rating / Release Date / Hypes / Name)
- **Why:** Filter UX is core for power users; currently the chips exist but don't apply.

### 6.2 Saved Filter Presets
- **What:** Users can save current filter combination as a preset ("Co-op RPGs on PC, 2018+"). Stored in `localStorage`.
- **Why:** Cuts repeat steps to zero for power users.

### 6.3 Sort Dropdown in Top Bar
- **What:** Persistent "Sort: Popularity ▼" dropdown in top-right of every category view (not just All).
- **Why:** Common store convention; users expect it everywhere.

### 6.4 Keyboard Navigation
- **What:** `/` focuses search; `←/→` cycle through card grid; `Enter` opens focused card; `W` wishlists focused card.
- **Why:** Power-user delight, similar to Playnite.

---

## 7. Store Game Detail Page Polish

### 7.1 Trailer Auto-Play Muted
- **What:** First YouTube trailer autoplays muted with sound-toggle button overlay.
- **Why:** Mimics Steam's storepages — show, don't link.

### 7.2 "You Might Also Like" Improvements
- **What:** Similar games section becomes a horizontal rail (instead of current dense grid).
- **Why:** Better fit on detail page; encourages comparison.

### 7.3 Ratings Breakdown Card Enhancement
- **What:** The existing donut + breakdown bars get upgraded: add an "X% of critics recommend" pill, and a small sparkline showing rating distribution across user rating buckets.
- **Why:** Compresses more trust signal into less space.

### 7.4 Add to Library Animation
- **What:** On click, the Add button morphs into a checkmark, card lifts and disappears into the sidebar's library icon.
- **Why:** Reward feedback; makes "Add to Library" feel like a real action.

### 7.5 Read-only Reviews Tab Improvements
- **What:** Already polished (Steam subtabs, pagination, etc.). Possible tweaks:
  - Persist last-opened review source tab in `localStorage`.
  - Add "Sort: Most Helpful" option that uses Steam's `votesUp`.
- **Why:** Outside the main interview focus; mentioned only because cheap wins.

---

## 8. Polish & Micro-Interactions

### 8.1 Skeleton Loaders
- **What:** Replace current grey squares with shimmering gradient skeletons matching final card shape.
- **Why:** Standard polish; the current skeletons are minimal.

### 8.2 Empty States
- **What:** Friendly placeholders for every "no results" case:
  - "No games match this filter — try resetting?"
  - "Coming Soon is empty — must be a slow news week 🌱"
  - "Search returned nothing for '{{query}}'"
- **Why:** Less jarring than current generic "No games found".

### 8.3 Error Toasts (Top Center)
- **What:** Move from current bottom-right to top-center; include retry button for IGDB errors.
- **Why:** Less obtrusive, more actionable.

### 8.4 Typography Hierarchy
- **What:** Section headers (Trending, Popular) become larger/bold (was 11px in chips). Card titles get a clear weight tier (800 for highlight, 600 for default).
- **Why:** Current chips read as flat.

### 8.5 Theme-Aware Sweeps
- **What:** Hero banner background incorporates a subtle accent color layer (radial gradient) that adapts to the active theme (Nord → icy, Dracula → purple haze, Cyberpunk → neon edge).
- **Why:** Makes the store feel "alive" against any theme.

### 8.6 Hero Parallax (Subtle)
- **What:** Banner background scrolls at ~50% speed as user scrolls down to rails.
- **Why:** Cinematic effect; only ~30 lines of CSS.

### 8.7 Smooth Tab Switch
- **What:** Fade + scale on `StoreTabBar.active` change.
- **Why:** Tab switches currently feel abrupt.

### 8.8 Card Reveal Animation
- **What:** When a category first loads, cards stagger in (50ms delay between each, slide-up + fade).
- **Why:** Adds delight; reference pattern from hero of `ActivityDashboard.tsx`.

---

## 9. Library Integration

### 9.1 "Recently Viewed" Strip on Store
- **What:** Top of `/store` shows a "Recently viewed in store" rail (last 5 slugs), pulled from `localStorage`.
- **Why:** Cheap Cialdini-style re-engagement; doesn't add backend work.

### 9.2 Cross-link from Library → Store
- **What:** Clicking an installed game's sidebar item could offer "Show similar games" → opens store filtered by that game's genre with similar games rail.
- **Why:** One-tap jump from "I love this" → "more like this". Complementary to existing release/title filter on `GamePage`.

---

## 10. Accessibility & Polish Wins

### 10.1 Card Focus State for Keyboard
- **What:** `tabIndex=0` on cards; visible focus ring on Tab navigation.
- **Why:** Required for keyboard nav (§6.4).

### 10.2 Screen-Reader Labels
- **What:** Each card has aria-label `"{{game.name}}, rated {{rating}}/100, platforms {{platforms}}"`.
- **Why:** Bonus polish for screen-reader users.

### 10.3 Reduced Motion Mode
- **What:** `prefers-reduced-motion` → disable parallax, card reveals, hero auto-rotate.
- **Why:** Cheap; respectful of motion-sensitive users.

---

## 11. File Manifest (Estimated)

### New Components
- `src/components/store/SnapRail.tsx` — horizontal scroller
- `src/components/store/HeroFeature.tsx` — landing hero
- `src/components/store/DensityToggle.tsx` — Compact/Cozy/Cinematic
- `src/components/store/CardHoverPreview.tsx` — trailer-on-hover wrapper
- `src/components/store/SearchSuggestions.tsx` — dropdown
- `src/components/store/RecentSearches.tsx`
- `src/components/store/WishlistRail.tsx`
- `src/components/store/StoreEmptyState.tsx` — friendly empties
- `src/components/store/EmptyStateMotion.tsx` — skeleton variants

### New Hooks
- `src/hooks/useWishlist.ts` — disk cache CRUD
- `src/hooks/useRecentlyViewed.ts` — `localStorage` list (last 5)
- `src/hooks/useSearchSuggestions.ts` — debounced mini-search
- `src/hooks/useViewDensity.ts` — sync density to `localStorage`

### Modified Files
- `src-tauri/src/game_scraper.rs` — add `coming_soon` & `new_releases` to `fetch_store_games` category mapping
- `src-tauri/src/lib.rs` — new `save_wishlist` / `load_wishlist` tauri commands
- `src/types/game.ts` — add `StoreCategory = "trending" | "popular" | "top" | "coming_soon" | "new_releases" | "all"`
- `src/pages/StorePage.tsx` — rework to compose hero + rails + tabs + density
- `src/components/store/StoreTabBar.tsx` — add 2 new tabs
- `src/components/store/StoreGameCard.tsx` — add wishlist heart, in-library badge, hover preview
- `src/pages/StoreGameDetail.tsx` — autoplay trailer, animation on add
- `src/components/store/StoreFilterSidebar.tsx` — actually wire filters to backend
- `src/App.css` — new classes for hero, rails, wishlist, density modes, animations

---

## 12. Priority Buckets (suggested)

When picking ideas to implement, group them by effort:

🟢 **Quick wins (1–2 hrs each):** Hero parallax (8.6), Skeleton loaders (8.1), Empty states (8.2), In-library card badge (4.3), Recently viewed (9.1), Card hover scale (4.2), Tab fade-in (8.7), Stagger reveal (8.8).

🟡 **Medium effort (half day each):** Wishlist (3.1–3.4), Coming Soon & New Releases tabs (2.1, 2.2), Density toggle (4.1), Search suggestions (5.1), Filter sidebar rework (6.1), Sort dropdown (6.3), Hero + rails (1.1, 1.2), Trailer-on-hover (4.4).

🔴 **Larger (1+ day):** Hero Landing full redesign (1.1+1.2 combined), Saved filter presets (6.2), Read-only reviews sort by helpful (7.5), Trailer autoplay muted (7.1).

---

## 13. Open Questions Worth Re-Confirming Before Coding

- §1: Is a single Discover tab separate from `/store`, or do we **replace** `/store` with Discover? (Decision locked: "Hero + scrolling rows" implies `/store` becomes Discover.)
- §2: With 7 tabs total, do we cap to 5 visible + overflow "••• More" menu?
- §4.1: Density toggle is pure frontend, but adds significant CSS work — worth scoping to just Compact vs. Cinematic first?
- §3.3: Wishlist disk cache vs. `localStorage` is locked, but disk cache requires Tauri commands — confirm we **want** the extra 2 commands vs. just `localStorage`.
