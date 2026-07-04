# Store Page Redesign — Specification

## 1. Overview

Transform the current placeholder StorePage into a fully-featured IGDB game discovery hub. Users can browse trending, popular, top-rated, and all IGDB catalog games, search IGDB live, view detailed game info without adding to library, and optionally add games to their library with full IGDB metadata auto-downloaded.

---

## 2. User Interview Summary

| Question | Answer |
|---|---|
| Store data source | Live IGDB catalog (TWITCH_CLIENT_ID/SECRET already configured via `.env`) |
| Clicking a store game | Opens a game detail page (read-only, no Launch button). Does NOT add to library automatically. |
| Store layout | Top tabs: Trending \| Popular \| Top Rated \| All Games \| Search |
| Search behavior | Live IGDB search (queries IGDB API as user types, debounced) |
| Store game detail UI | Reuse GamePage read-only (hide Launch button; Edit, Delete, Activity tab still visible) |
| Pagination | Infinite scroll (20 games per load) |
| Auto-fetch timing | Progressive: as game cards appear in view, download metadata + cover images progressively. Smooth and "live" feel. |
| Adding to library | "Add to Library" button on the store game detail page only. Creates a full library entry with IGDB metadata. |
| IGDB auth | Credentials already set via environment variables (`TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`). Reuse existing `get_twitch_token()` and `search_igdb()`. |
| All Games filters | Sidebar filters + top filter bar + search — all three combined |
| Duplicate detection | Prevent adding a game that already exists in the library (match by name/slug). Show toast: "Already in your library." |
| Store caching | Persistent cache to disk (Tauri app data dir). Refresh periodically. |

---

## 3. IGDB API Integration

### 3.1 Existing Infrastructure
- `game_scraper.rs`: Already has `get_twitch_token()` (token caching), `search_igdb()` (search + metadata), and IGDB type definitions (`IgdbGame`, `IgdbCover`, `IgdbName`, etc.)
- `lib.rs`: Exposes `search_game_metadata` Tauri command
- `.env`: Contains `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`

### 3.2 New IGDB Queries Needed

#### 3.2.1 `fetch_store_games` — Browse by category
```rust
// Tauri command signature
#[tauri::command]
async fn fetch_store_games(
    category: String,       // "trending" | "popular" | "top" | "all"
    offset: u32,            // Pagination offset (0, 20, 40...)
    limit: u32,             // Items per page (default 20)
    genre_filter: Option<String>,     // Optional genre name filter
    platform_filter: Option<String>,  // Optional platform name filter  
    year_filter: Option<u32>,         // Optional release year filter
    rating_min: Option<u32>,          // Optional minimum rating
) -> Vec<StoreGameSummary>
```

**IGDB API query mapping:**

| Category | IGDB Query | Sort Field | Where Clause |
|---|---|---|---|
| `trending` | `/games` | `hypes desc` | `hypes > 0 & total_rating_count > 5` |
| `popular` | `/games` | `total_rating_count desc` | `total_rating_count > 10` |
| `top` | `/games` | `rating desc` | `rating >= 70 & total_rating_count > 20` |
| `all` | `/games` | `total_rating_count desc` | `total_rating_count > 0` |

**Fields requested:**
```
name, slug, summary, first_release_date, rating, aggregated_rating,
cover.url, genres.name, platforms.name, total_rating_count, hypes, follows
```

**Genre filter:** Use IGDB genre IDs (1-30+). Map frontend genre names to IGDB genre IDs.

**Platform filter:** Use IGDB platform IDs (6=PC, 48=PS4, 49=Xbox One, 167=PS5, 169=Xbox Series, 130=Switch, etc.).

#### 3.2.2 `search_store_games` — Live IGDB search
```rust
#[tauri::command]
async fn search_store_games(
    query: String,
    offset: u32,
    limit: u32,
) -> Vec<StoreGameSummary>
```

**IGDB query:**
```
search "{query}"; fields name, slug, summary, first_release_date, rating,
aggregated_rating, cover.url, genres.name, platforms.name, total_rating_count;
limit {limit}; offset {offset};
```

#### 3.2.3 `get_store_game_detail` — Full game detail for the preview page
Reuses the existing `search_igdb()` function but with a single game query by slug or ID, requesting ALL fields (screenshots, videos, storyline, involved_companies, game_modes, themes, player_perspectives, similar_games, release_dates, websites, time_to_beat).

```rust
#[tauri::command]
async fn get_store_game_detail(slug: String) -> Option<GameMetadataResult>
```

### 3.3 StoreGameSummary Type (new)

A lightweight type for store listings (card display only, no full metadata):

```typescript
interface StoreGameSummary {
  id: number;                    // IGDB game ID
  name: string;
  slug: string;
  summary: string | null;        // Short description for cards
  rating: number | null;         // IGDB rating (0-100)
  aggregatedRating: number | null; // Critic rating
  coverUrl: string | null;       // Cover image URL (t_cover_big)
  genres: string[];              // Genre names
  platforms: string[];           // Platform names
  firstReleaseDate: string | null; // "YYYY-MM-DD"
  totalRatingCount: number;      // For popularity display
  hypes: number;                 // For trending display
}
```

### 3.4 Rate Limiting
IGDB free tier: ~4 requests/second. Strategy:
- Cache token (already done)
- Sequential requests per tab (avoid burst)
- Persistent disk cache reduces API calls
- If rate limited, show cached data with a toast

---

## 4. Rust Backend Changes

### 4.1 New Tauri Commands

| Command | File | Purpose |
|---|---|---|
| `fetch_store_games` | `game_scraper.rs` | Fetch paginated store games by category with filters |
| `search_store_games` | `game_scraper.rs` | Search IGDB games live |
| `get_store_game_detail` | `game_scraper.rs` | Fetch full detail for a single IGDB game |
| `save_store_cache` | `lib.rs` | Persist store cache to disk |
| `load_store_cache` | `lib.rs` | Load store cache from disk |

### 4.2 Register in `lib.rs`

Add to `invoke_handler`:
```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands ...
    fetch_store_games,
    search_store_games,
    get_store_game_detail,
    save_store_cache,
    load_store_cache,
])
```

### 4.3 Disk Cache Schema

File: `<app_data_dir>/store_cache.json`

```json
{
  "categories": {
    "trending": { "data": [...], "fetchedAt": 1234567890 },
    "popular": { "data": [...], "fetchedAt": 1234567890 },
    "top": { "data": [...], "fetchedAt": 1234567890 },
    "all": { "data": [...], "fetchedAt": 1234567890 }
  },
  "detailCache": {
    "game-slug-1": { "data": {...}, "fetchedAt": 1234567890 }
  }
}
```

Cache TTL: 6 hours (21,600 seconds). After TTL, fetch fresh data.

---

## 5. Frontend Architecture

### 5.1 Route Changes

```typescript
// App.tsx — add new route
<Route path="store" element={<StorePage />} />
<Route path="store/:gameSlug" element={<StoreGameDetail />} />
```

Note: Store game detail uses `:gameSlug` not `:gameId` to distinguish from library games. The existing `/library/:gameId` route remains unchanged.

### 5.2 New Components

```
src/pages/
  StorePage.tsx              (rewrite from placeholder)
  StoreGameDetail.tsx        (new - read-only game page for IGDB games)

src/components/
  store/
    StoreTabBar.tsx          (tab navigation: Trending | Popular | Top Rated | All | Search)
    StoreGameCard.tsx        (single game card with cover, name, rating, genres)
    StoreGameGrid.tsx        (infinite scroll grid of StoreGameCards)
    StoreSearchBar.tsx       (live search with debounce input)
    StoreFilterSidebar.tsx   (sidebar with genre/platform/year/rating filters)
    StoreFilterChips.tsx     (top filter bar with active filter chips)
    StoreAddButton.tsx       ("Add to Library" button on store detail page)

src/hooks/
  useStoreGames.ts           (data fetching, caching, pagination logic)
  useStoreCache.ts           (disk read/write for store cache)
  useProgressiveImages.tsx   (IntersectionObserver-based progressive image loading)
```

### 5.3 StorePage Component Structure

```
<StorePage>
  <StoreTabBar activeTab={activeTab} onChange={setActiveTab} />
  
  {activeTab === "search" && <StoreSearchBar onSearch={handleSearch} />}
  {(activeTab === "all" || activeTab === "search") && (
    <>
      <StoreFilterChips activeFilters={filters} onChange={setFilters} />
      <div className="store-layout">
        <StoreFilterSidebar filters={filters} onChange={setFilters} />
        <StoreGameGrid games={games} onLoadMore={loadMore} hasMore={hasMore} />
      </div>
    </>
  )}
  {activeTab !== "all" && activeTab !== "search" && (
    <StoreGameGrid games={games} onLoadMore={loadMore} hasMore={hasMore} />
  )}
</StorePage>
```

### 5.4 StoreGameDetail Component

Reuses GamePage rendering logic with these differences:
- **Data source:** IGDB API via `get_store_game_detail`, not GameContext
- **No Launch button:** Hidden entirely (the user chose "Only Launch" hidden, meaning Edit and Delete remain)
- **"Add to Library" button:** Prominently placed (same position as Launch button in library GamePage)
- **No Activity tab:** No activity data for non-library games (hide the tab)
- **No executable path:** The "Details" section shows "Not in library" instead of executable path
- **Reviews tab:** Only shows IGDB reviews (no local review writing)
- **No Weblinks tab:** Or show IGDB weblinks read-only

Routes that should still work: Overview, IGDB Reviews (read-only), Weblinks (read-only if data available).

**States:**
- **Loading:** Skeleton/spinner while fetching IGDB detail
- **Not found:** Game not found on IGDB (slug invalid)
- **Already in library:** If game is already in user's library, show "View in Library" button instead of "Add to Library"
- **Error:** API failure with retry option

### 5.5 Clicking a Store Game Card

1. User clicks a `StoreGameCard`
2. Navigate to `/store/{game.slug}`
3. `StoreGameDetail` loads
4. Calls `get_store_game_detail(slug)` → full IGDB data
5. Displays in read-only GamePage format
6. "Add to Library" button calls `addStoreGame(metadata)` → creates Game entry → shows toast → stays on detail page

### 5.6 Adding to Library Flow

1. User clicks "Add to Library" on StoreGameDetail
2. Check for duplicate (by name normalization / slug match against existing games)
3. If duplicate: show toast "Already in your library" + change button to "View in Library"
4. If not duplicate:
   a. Create Game object from IGDB metadata:
      - `id`: generated
      - `name`: from IGDB title
      - `path`: "" (no executable — placeholder)
      - `platform`: first platform from IGDB or "Unknown"
      - `installed`: false
      - `playTime`: "0h"
      - `addedAt`: Date.now()
      - All IGDB metadata fields populated (description, developer, publisher, genres, rating, screenshots, videos, coverArtUrl, bannerUrl, logoUrl, etc.)
   b. Call `progressiveDownloadImages(metadata)`:
      - Download cover image → base64 → set as `coverArtUrl`
      - Download screenshots → base64 → set as `screenshots`
      - Progress tracking: toast shows "Downloading media... (3/8)"
      - On completion: toast "Added {name} to library" (success)
   c. Add game via `addGame()` from GameContext
5. Button changes to "✓ Added to Library" (disabled)

### 5.7 Progressive Image Loading

For store cards (not detail pages):
- Use `IntersectionObserver` to detect when a card enters the viewport
- On entry: download the cover image via `invoke("download_image", { url })` in the background
- Show a placeholder/skeleton until the image loads
- Images that leave viewport can cancel their download (AbortController)

---

## 6. State Management

### 6.1 Store Data Flow

```
User opens Store tab
  → Load cache from disk (if fresh < 6 hours, use cache)
  → If cache is stale or missing, fetch from IGDB
  → Render game cards
  → Cards in viewport → progressively download cover images → replace placeholders
  → User scrolls → infinite scroll → fetch next page from IGDB or cache
  → User changes tab → fetch category from IGDB or cache
  → User searches → debounced (300ms) → live IGDB search
```

### 6.2 GameContext Addition

Add `addStoreGame` function to `GameContext`:
```typescript
addStoreGame: (metadata: GameMetadataResult) => Promise<void>
```

This creates a Game object from IGDB metadata, handles image downloading, and calls `addGame()`.

### 6.3 Toast Usage

| Scenario | Toast Type | Message |
|---|---|---|
| Game added to library | success | "Added {name} to your library" |
| Already in library | info | "{name} is already in your library" |
| Media download progress | info | "Downloading media for {name}... (3/8)" |
| Cache loaded | (none — silent) | — |
| IGDB rate limited | error | "IGDB rate limit reached. Showing cached data." |
| API failure | error | "Could not load store data. Try again later." |
| Duplicate prevented | info | "{name} is already in your library" |

---

## 7. UI/UX Design

### 7.1 Store Tab Bar
Styled similarly to the game detail page tabs. Active tab has accent color underline.

### 7.2 Store Game Card
```
┌──────────────────────┐
│                      │
│    Cover Image       │
│    (2:3 ratio)       │
│                      │
│    ⭐ 87             │
├──────────────────────┤
│ Game Name            │
│ Genre1 · Genre2      │
│ PC · PS5             │
└──────────────────────┘
```
- Hover: subtle scale + glow border
- Click: navigate to /store/{slug}
- Cover loading: skeleton pulse animation

### 7.3 Store Game Grid
- Responsive grid: `grid-template-columns: repeat(auto-fill, minmax(150px, 1fr))`
- Gap: `var(--space-md)`
- Infinite scroll trigger: 200px before the end (use sentinel div with IntersectionObserver)

### 7.4 Filter Sidebar (All Games tab only)
- Genre checkboxes (Action, Adventure, RPG, Strategy, etc.)
- Platform checkboxes (PC, PlayStation, Xbox, Nintendo)
- Year range slider or dropdown
- Minimum rating slider (0-100)
- "Apply Filters" & "Reset" buttons

### 7.5 Top Filter Bar (All Games tab only)
- Active filter chips (clickable × to remove)
- Sort dropdown: Popularity / Rating / Release Date / Name
- Result count display

### 7.6 Live Search
- Search bar at the top (replaces tabs when search tab is active)
- 300ms debounce before querying IGDB
- Results appear in the same StoreGameGrid layout
- Empty state: "No games found for '{query}'"
- Loading state: skeleton grid

### 7.7 Store Game Detail
- Same layout as GamePage (hero, tabs, sidebar, content grid)
- Hero section: "Add to Library" button where Launch button would be
- "Already in Library" state: "View in Library" button that navigates to `/library/{gameId}`
- Sidebar: IGDB ratings, game specs, time to beat, releases (all from IGDB data)
- Tabs: Overview | IGDB Reviews | Weblinks (no Activity tab since not in library)
- Loading: full-page skeleton mimicking GamePage layout

---

## 8. CSS / Theming

All new styles use CSS custom properties from the existing theme engine (defined in `App.css`). No hardcoded colors.

### 8.1 New CSS Classes Needed

```css
.store-page                    (container)
.store-tab-bar                 (tab navigation)
.store-tab                     (individual tab)
.store-tab.active              (active tab)
.store-game-grid               (responsive grid)
.store-game-card               (individual card)
.store-game-card:hover         (hover effect)
.store-card-cover              (cover image container)
.store-card-cover-skeleton     (loading placeholder)
.store-card-rating             (rating badge)
.store-card-name               (game title)
.store-card-meta               (genres, platforms)
.store-search-bar              (search input container)
.store-search-input            (search input field)
.store-filter-sidebar          (filter sidebar)
.store-filter-section          (filter section group)
.store-filter-checkbox         (checkbox filter row)
.store-filter-chips            (active filter display)
.store-filter-chip             (individual chip)
.store-layout                  (sidebar + grid flex layout)
.store-sentinel                (infinite scroll trigger)
.store-empty                   (empty state)
.store-loading                 (loading state)
.store-add-btn                 ("Add to Library" button)
.store-add-btn.added           (confirmed state)
```

---

## 9. Edge Cases & Error Handling

| Scenario | Behavior |
|---|---|
| IGDB API is down | Load from disk cache. Show cached data with toast: "Using cached data — IGDB is unavailable." |
| IGDB rate limit hit | Stop fetching, show cached data, toast: "IGDB rate limit reached. Try again in a few seconds." |
| No results for search | Empty state: "No games found for '{query}'. Try different keywords." |
| No results for category | Empty state: "No games found. Check back later!" |
| Game already in library | "Add to Library" replaced with "View in Library". Toast if attempted to add. |
| Offline / no internet | Load from cache, show offline indicator. Disable search. |
| API returns malformed data | Graceful degradation — skip malformed entries, show what we can. Log error. |
| Cache file corrupted | Delete cache, fetch fresh from IGDB. |
| Adding a game fails mid-way | Rollback — remove partially added game. Toast error. |
| Very long game name | Truncate with ellipsis (CSS: `text-overflow: ellipsis`, max 2 lines) |
| No cover image available | Show a placeholder with game's initials or a controller icon |
| Switching tabs rapidly | Cancel in-flight requests with AbortController, fetch new tab data |
| Multiple filter combinations with zero results | Empty state: "No games match your filters. Try adjusting them." |

---

## 10. Performance Considerations

- **Cache-first strategy:** Load from disk immediately, refresh in background if stale
- **Progressive images:** Only download images for cards in/near the viewport (IntersectionObserver with 200px rootMargin)
- **Debounced search:** 300ms debounce for live search to avoid excessive API calls
- **Request deduplication:** Use a request key to avoid duplicate in-flight IGDB requests
- **Abort stale requests:** Cancel previous requests when tab changes or new search starts
- **Virtualized grid (optional/future):** If performance is an issue with many cards, consider react-window or CSS content-visibility
- **Image size:** Request IGDB images at appropriate sizes (t_cover_big for cards, t_720p for screenshots)

---

## 11. Implementation Plan

### Phase 1: Backend (Rust)
1. Add `StoreGameSummary` struct and Serde derives in `game_scraper.rs`
2. Implement `fetch_store_games()` — category browsing with pagination and filters
3. Implement `search_store_games()` — live search with pagination
4. Implement `get_store_game_detail()` — full detail for single game
5. Implement `save_store_cache()` / `load_store_cache()` — disk persistence
6. Register all new commands in `lib.rs`

### Phase 2: Frontend — Data Layer
7. Create `useStoreGames` hook (fetching, pagination, caching, error handling)
8. Create `useStoreCache` hook (disk read/write)
9. Create `useProgressiveImages` hook (viewport-based image loading)

### Phase 3: Frontend — Components
10. Create `StoreTabBar` component
11. Create `StoreGameCard` component (with skeleton, hover, ratings)
12. Create `StoreGameGrid` component (infinite scroll grid)
13. Create `StoreSearchBar` component (debounced live search)
14. Create `StoreFilterSidebar` component
15. Create `StoreFilterChips` component
16. Rewrite `StorePage` to compose all store components

### Phase 4: Store Game Detail
17. Create `StoreAddButton` component
18. Create `StoreGameDetail` component (read-only GamePage replica)
19. Add `addStoreGame` to `GameContext`

### Phase 5: Routing & Integration
20. Add `/store/:gameSlug` route in `App.tsx`
21. Wire up navigation from StoreGameCard → StoreGameDetail
22. Wire up "Add to Library" → GameContext → persist

### Phase 6: Polish
23. Add all CSS classes to `App.css`
24. Add toast messages throughout
25. Add duplicate detection logic
26. Add loading/empty/error states for all views
27. Test with typecheck (`npx tsc --noEmit`)

---

## 12. File Manifest (Files Changed/Created)

### New Files
| File | Purpose |
|---|---|
| `src/pages/StoreGameDetail.tsx` | Read-only game detail page for IGDB store games |
| `src/components/store/StoreTabBar.tsx` | Tab navigation within store |
| `src/components/store/StoreGameCard.tsx` | Individual game card |
| `src/components/store/StoreGameGrid.tsx` | Infinite scroll grid |
| `src/components/store/StoreSearchBar.tsx` | Live search input |
| `src/components/store/StoreFilterSidebar.tsx` | Filter sidebar |
| `src/components/store/StoreFilterChips.tsx` | Active filter chips |
| `src/components/store/StoreAddButton.tsx` | Add to library button |
| `src/hooks/useStoreGames.ts` | Store data fetching hook |
| `src/hooks/useStoreCache.ts` | Store cache persistence hook |
| `src/hooks/useProgressiveImages.tsx` | Progressive image loading hook |

### Modified Files
| File | Change |
|---|---|
| `src-tauri/src/game_scraper.rs` | Add `fetch_store_games()`, `search_store_games()`, `get_store_game_detail()`, cache save/load |
| `src-tauri/src/lib.rs` | Register new Tauri commands |
| `src/pages/StorePage.tsx` | Rewrite from placeholder to full store |
| `src/App.tsx` | Add `/store/:gameSlug` route |
| `src/App.css` | Add all store-related CSS classes |
| `src/context/GameContext.tsx` | Add `addStoreGame()` method |
| `src/types/game.ts` | Add `StoreGameSummary` interface |
