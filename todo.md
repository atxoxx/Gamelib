# GameLib — Project Roadmap & TODO

---

## 🔧 Immediate / Fixes

### 1. Fix Game Icon Fetching
- Game icons currently fail to load for imported executables and batch files.
- Investigate whether the issue is in the Rust backend (`game_scraper.rs`) or the frontend icon resolution.
- Add a fallback: if no icon can be extracted from the `.exe`/.ico, generate a placeholder based on the game's first letter or fetch one from a public DB (IGDB, SteamGridDB, Giant Bomb).
- Cache fetched icons locally in `%APPDATA%/GameLib/icons/` so they survive restarts.

### 2. Fix Activity Page UI Inconsistencies
- The Activity sub-components (Dashboard, Gantt, Performance, Sessions, Sparkline) may have styling mismatches — check for:
  - Hardcoded colors instead of CSS custom properties (theme breakage in light mode).
  - Spacing/padding drift between tabs.
  - Chart labels overflowing on narrow sidebar states.
  - Scroll behavior inside the activity panel not matching the rest of the app.
- Ensure all activity charts (`BarChart`, `DonutChart`, `LineChart`) inherit theme variables consistently.

### 3. Import Modal: Rename, Metadata & Image Fetch
- When adding a single `.exe` or `.bat` file, show a **new modal** after file selection that lets the user:
  - **Rename** the game (title field, editable, pre-filled with file stem).
  - **Search & fetch metadata** from LaunchBox Games DB / IGDB / SteamGridDB:
    - Cover art / banner.
    - Developer, publisher, release date, genre tags.
    - Description / summary.
  - Show a **preview card** with the fetched data before confirming the import.
  - Show a progress indicator while scraping runs.
- The existing `ImportModal.tsx` handles batch imports — this new single-game modal should complement it, not replace it.

---

## 📰 News & Discovery

### 4. News Tab: Xbox Game Pass + IsThereAnyDeal
- Add a **News tab** to the main navigation (TopNav).
- Integrate two sub-sections:
  - **Xbox Game Pass**: latest additions, leaving-soon titles, upcoming day-one releases. Scrape or use an unofficial RSS/API.
  - **IsThereAnyDeal**: current deals across stores (Steam, GOG, Epic, Humble, Fanatical, Green Man Gaming). Show price, discount %, store, and a link.
- Each section should have its own card grid with filtering (platform, discount threshold).

### 5. RSS News Page
- Add an RSS reader page (or tab within News) where users can subscribe to gaming news feeds.
- Store feed URLs locally (IndexedDB or a JSON config file).
- Provide default curated feeds: PC Gamer, Rock Paper Shotgun, Eurogamer, Gematsu, GamingOnLinux.
- Display articles in a scrollable card layout with title, date, source, and expandable summary.
- Open full article in the user's default browser (Tauri shell open).

---

## 🎮 Game Page Enhancements

### 6. Steam Reviews + Multi-Site Review Aggregation
- In the game page's **Reviews** tab, add:
  - **Steam reviews** summary card: overall rating (Very Positive / Mixed / etc.), review count, recent review trend.
  - **Multi-site aggregation**: pull scores from Metacritic, OpenCritic, IGDB, HowLongToBeat.
  - Display each source with its logo/icon, numeric score, and a color-coded badge.
- Backend: add a Rust scraper/API caller that fetches review metadata for a given game title.

### 7. Overview Tab — Additional Info Cards
- Add compact, glanceable cards to the game page **Overview** tab:
  - **Crackwatch** status (cracked / uncracked / denuvo) — scrape or API.
  - **Ratings panel**: Metacritic critic + user scores, OpenCritic score, IGDB rating.
  - **Languages supported**: audio + subtitles, pulled from Steam / IGDB metadata.
  - **ProtonDB** badge: native / platinum / gold / silver / bronze / borked, with a link to the ProtonDB page.
  - **System requirements**: minimum & recommended (CPU, GPU, RAM, storage).
  - **Release date + developer + publisher** card (if not already present).

### 8. Achievements Tab
- Add an **Achievements** tab to the game page.
- For Steam games: fetch unlocked/locked achievements via Steam Web API (requires user API key in settings).
- For emulated / DRM-free games: support RetroAchievements integration.
- Show a progress bar (% completion), rarity indicators, and last-unlocked date.
- Nice-to-have: compare achievements with friends (future community feature).

### 9. HowLongToBeat Card
- In the game page **Overview** tab, add a detailed **HowLongToBeat** card showing:
  - Main story time.
  - Main + extras time.
  - Completionist time.
  - All playstyles combined average.
- Display as horizontal bar chart with human-readable labels.
- Pull data from HowLongToBeat scraping or community-maintained dataset.

### 10. Hero Image: Live Steam Player Count
- In the game page's hero/banner area, overlay a **live Steam player count** badge.
- Fetch from Steam Charts / Steam Web API / steamcharts.com scraping.
- Show current players, 24h peak, and a tiny sparkline if data is available.
- Update every 60 seconds when the game page is active.

---

## 🛍️ Store & Library Management

### 11. Store Page — Browse & Download
- Build a full **Store** page that lets users browse a large game catalog.
- Integrate with a free game database API (IGDB, RAWG, or self-hosted).
- Features:
  - Search with autocomplete.
  - Filters: genre, platform, release year, rating, price range.
  - Sort: popularity, rating, release date, title.
  - Game detail cards with cover art, rating, platforms, and a "Download" or "Get" button (links to store pages).
  - Wishlist / watchlist integration (see #16).
- Note: "download" means opening the store link in the user's browser unless an official DRM-free source is available.

### 12. Multi-Store Import & Sync
- Import game libraries from external platforms:
  - **Steam**: parse `steamapps/common` folder + `libraryfolders.vdf` + Steam Web API for metadata.
  - **Epic Games**: parse Epic's manifest files in `ProgramData/Epic/`.
  - **GOG**: detect GOG Galaxy install folders.
  - **Humble Bundle**: parse downloaded installers/trove directory.
  - **Battle.net**, **Ubisoft Connect**, **EA App**: detect install folders.
- **Sync**: periodically re-scan for new games installed via these launchers.
- Deduplicate games that appear in multiple launchers (link them under one entry).
- Show launcher badge icons next to each game in the library.

### 13. Per-Game Options / Context Menu
- Right-click context menu (or settings gear) on any game in the sidebar/game page:
  - **Game-specific launch options**: command-line arguments, custom working directory, environment variables.
  - **Pre-launch / post-launch scripts**: select `.bat`, `.ps1`, `.sh` scripts to run.
  - **Compatibility settings**: force Proton/Wine version (for future Linux support), DXVK toggle, FSR toggle.
  - **Override metadata**: manually set cover art, title, genre, rating.
  - **Performance profile**: link a custom GPU/CPU/power profile (Windows power plan, RTSS OSD preset).
  - **Hide / archive game**: soft-delete from library without removing files.
  - **Tags & collections**: assign user-defined tags.

### 14. Game Manager Tab
- New **Game Manager** tab in the main layout (alongside Library, Store, etc.).
- Features:
  - **Storage overview**: total space used, per-drive breakdown, largest games.
  - **Move game**: relocate install folder to another drive, with progress bar.
  - **Verify / repair**: checksum-based integrity check against known manifests (Steam, GOG).
  - **Uninstall**: full cleanup including leftover folders, registry entries (Windows), and shortcuts.
  - **Backup**: compress and archive game folder to external drive / NAS.
  - **Batch operations**: select multiple games for move/uninstall/backup.

---

## 📊 Tabs & Panels

### 15. Deals Tab
- A dedicated **Deals** tab in the main navigation.
- Shows real-time deals from IsThereAnyDeal, Steam sales, GOG sales, Epic freebies.
- Filters: store, discount %, price, DRM-free only.
- "Price history" mini-chart per game (from ITAD data).
- Notification option: alert when a wishlisted game drops below a configurable price threshold.

### 16. Downloads Tab
- A **Downloads** tab showing:
  - Active downloads with progress bars, speed (MB/s), ETA.
  - Download history (completed, failed, cancelled).
  - Source: torrent, HTTP direct, launcher (Steam/Epic).
  - Pause / resume / cancel controls.
  - Bandwidth limiter (global setting, configurable in Settings).
  - Queue management: reorder, prioritize.

### 17. Statistics Tab
- A **Statistics** tab with personal gaming analytics:
  - **Playtime**: total hours, per-game breakdown, per-week trend, daily average.
  - **Genre distribution**: donut chart of playtime by genre.
  - **Platform distribution**: pie chart of games by platform.
  - **Achievements**: total unlocked, rarest achievements, completion rate.
  - **Session history**: longest session, average session length, most active time of day.
  - **Year in review**: annual summary card (Spotify Wrapped style).
  - Export stats as JSON/CSV.

### 18. Watchlist Tab
- A **Watchlist** tab where users can save games they're interested in but don't own yet.
- Add games from the Store page, news articles, or deals.
- Show current lowest price, price alert threshold (configurable).
- Sort by: added date, price, release date, title.
- Quick actions: "View in Store", "Set price alert", "Remove".

---

## 🔮 Future / Later

### 19. Linux Support
- Ensure Tauri backend compiles and runs on Linux (Ubuntu, Fedora, Arch, Steam Deck).
- Integrate with Wine/Proton prefix management:
  - Create/manage Wine prefixes per game.
  - Select Proton version (GE-Proton, Experimental, etc.).
  - Apply Winetricks / Protontricks.
- Detect Steam Deck and switch to gamepad-friendly UI mode.
- Flatpak / AppImage packaging.

### 20. Theming System (Phase 2)
- Expand the CSS custom property theme engine:
  - Theme editor UI in Settings with live preview.
  - Import/export `.json` theme files.
  - Community theme browser (share/download themes).
  - Scheduled theme switching (light day / dark night, or per-game).

### 21. Plugin System (Phase 2)
- Design a plugin manifest format (JSON) with:
  - Name, version, author, description.
  - Permissions: file access, network, process spawn, UI injection.
  - Hooks: onGameLaunch, onGameExit, onLibraryRefresh, onTabRegister.
- Plugin API (Rust backend + JS bridge):
  - `registerTab(label, component)` — add a new top-level tab.
  - `registerGameContextMenu(label, handler)` — add context menu items.
  - `registerMetadataScraper(name, handler)` — custom metadata source.
  - `registerSettingsSection(label, component)` — add to settings page.
- Plugin sandboxing: each plugin runs in its own scope.
- Plugin marketplace / repository (GitHub-based, initially).

---

## 📋 Task Priority Summary

| Priority | Task |
|----------|------|
| 🔴 High | Fix game icon fetching (#1) |
| 🔴 High | Fix activity page UI inconsistencies (#2) |
| 🔴 High | Import modal with rename & metadata fetch (#3) |
| 🟡 Medium | News tab: Xbox Game Pass + ITAD (#4) |
| 🟡 Medium | RSS news page (#5) |
| 🟡 Medium | Steam reviews + multi-site aggregation (#6) |
| 🟡 Medium | Overview info cards (#7) |
| 🟡 Medium | Achievements tab (#8) |
| 🟡 Medium | HowLongToBeat card (#9) |
| 🟡 Medium | Live Steam player count (#10) |
| 🟢 Normal | Store page (#11) |
| 🟢 Normal | Multi-store import & sync (#12) |
| 🟢 Normal | Per-game options (#13) |
| 🟢 Normal | Game manager tab (#14) |
| 🟢 Normal | Deals tab (#15) |
| 🟢 Normal | Downloads tab (#16) |
| 🟢 Normal | Statistics tab (#17) |
| 🟢 Normal | Watchlist tab (#18) |
| ⚪ Later | Linux support (#19) |
| ⚪ Later | Theming system v2 (#20) |
| ⚪ Later | Plugin system v2 (#21) |
