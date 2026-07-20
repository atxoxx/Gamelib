# Project knowledge

This file gives Codebuff context about your project: goals, commands, conventions, and gotchas.

## Quickstart
- **Stack:** Tauri v2 (Rust backend) + React 19 + TypeScript (Vite). Bundler: Vite 7. Dev port: `1420`.
- **Setup:** `npm install`
- **Dev:** `npm run tauri dev` — starts Vite at `localhost:1420` and the native window.
- **Build:** `npm run tauri build` — runs `tsc && vite build` then bundles via tauri.conf.json bundle targets.
- **Typecheck:** `npx tsc --noEmit` (the `npm run build` script does `tsc && vite build`, so a fresh build also typechecks).
- **Frontend-only (no Tauri shell):** `npm run dev` — useful for UI iteration; Tauri-injected APIs will be stubbed.

## Architecture

### Tauri window
- Frameless window configured in `src-tauri/tauri.conf.json` — `decorations: false`, min 900×600. Custom in-app `WindowControls` (min / max / close) live under `src/components/WindowControls.tsx`. Title bar is the `TopNav`.

### Frontend (`src/`)
- **Router:** React Router v7 with `HashRouter` in `src/main.tsx` (required — Tauri ships `file://` in production).
- **Layout:** `App.tsx` wraps `ThemeProvider > ToastProvider > SplashProvider > GameProvider > ... > DownloadProvider > SourceProvider > ...`. The shell renders `TopNav`, `Sidebar`, and `MainContent` via nested routes. `<Splashscreen />` is mounted inside `SplashProvider` at z-index 9500.
- **Pages (`src/pages/`)** — 14 page files; `App.tsx` registers 14 `<Route>` entries (so `ActivityPage` itself has sub-tabs `Dashboard / Gantt / Performance / Sessions / Sparkline` listed below):
  - `LibraryPage` (`/library`, `/library/:gameId` → `GamePage`) — main library grid + game detail.
  - `GamePage` — rich detail view with hero, metadata, reviews, achievements, screenshots, web links, player count, force-close.
  - `StorePage` (`/store`) + `StoreGameDetail` (`/store/:gameSlug`) — IGDB-backed catalog with rails.
  - `WishlistPage` (`/wishlist`), `NewsPage` (`/news`), `DealsPage` (`/deals`) — discovery surfaces.
  - `ActivityPage` (`/activity`) — dashboard / Gantt / performance / sessions / sparkline sub-tabs in `src/pages/activity/`.
  - `AchievementsPage` (`/achievements`), `DownloadsPage` (`/downloads`), `StoragePage` (`/storage`).
  - `CommunityPage` (`/community`), `SettingsPage` (`/settings`), `PluginsPage` (`/plugins`).
  - Default redirect on `/` → `/library`.
- **Components (`src/components/`)** — 20+ files grouped by area: `game/`, `library/`, `store/`, `downloads/`, `news/`, `activity/`, `charts/`, `ui/` (`Card`, `Button`, `Badge`, `KpiTile`, `Skeleton`, `Tooltip`, `ConfirmModal`).
- **Contexts (`src/context/`)** — one provider per cross-cutting concern: `GameContext` (library CRUD / launch), `ActivityContext`, `AchievementContext`, `WishlistContext`, `DownloadContext` (active downloads + speed limits), `SourceContext` (download sources), `SplashContext`, `ToastContext`, `ThemeContext` (light/dark), `DensityContext` (compact/comfortable).
- **Hooks (`src/hooks/`)** — extracted filters/store-cache/player-count helpers (`useLibraryFilters`, `useStoreGames`, `useStoreCache`, `useProgressiveImages`, `useSteamGameStats`, `usePlayerCountHistory`, `useNewsFeeds`, `useWishlist`, etc.).
- **Types (`src/types/`)** — hand-written TypeScript types mirroring the Rust serde models: `game.ts`, `steam.ts`, `gog.ts`, `epic.ts`, `source.ts`, `download.ts`, `deals.ts`.
- **Styles (`src/styles/`, `src/*.css`)** — co-located CSS files (`App.css` for layout + theme tokens, `library.css`, `store.css`, plus themed style sheets under `src/styles/`). All theme colors go through CSS custom properties defined in `:root` / `[data-theme="light"]` in `App.css`. **Never hardcode hex/rgb values** — use `var(--…)`.

### Backend (`src-tauri/src/`)
- **Entry point:** `lib.rs::run()` registers every Tauri command and initializes state in `.setup(...)`. `main.rs` simply calls `gamelib_lib::run()`.
- **Modules:** `game_scraper`, `game_watcher`, `gpu_detector`, `mahm_reader`, `rtss_reader`, `metrics_collector`, `source_manager`, `store_checker`, `torrent_engine`, `achievements`, `crackwatch`, `deals`, `size`, `config`. `mahm_reader` and `rtss_reader` read shared memory from **MSI Afterburner** and **RivaTuner Statistics Server** to power the in-game FPS / frametime overlays on the Activity page (`debug_mahm_entries` IPC exposes raw MAHM entries for diagnostics).
- **Side binary:** `src-tauri/src/bin/` holds additional executables built alongside `gamelib_lib` (`cargo build --bin <name>`). Contents change frequently — list the directory before assuming anything about it. Leave alone unless the change is explicitly for a bin target.
- **Per-store integrations (`src-tauri/src/steam/`, `gog/`, `epic/`)** — each has `auth.rs` + `sync.rs` + `types.rs`. Steam uses a pasted **Web API key** (not OpenID). GOG uses a Tauri WebView to capture session cookies after the 2026 OAuth client_id rotation. Epic uses OAuth via stored refresh tokens.
- **Downloads (`src-tauri/src/downloader/`)** — `mod.rs` orchestrates three paths:
  - `direct.rs` — HTTP/chunk downloader with resume support.
  - `debrid.rs` — Real-Debrid / AllDebrid cache lookup + unrestrict.
  - Uses `librqbit` (pinned to `8`, no HTTP API feature) for the torrent engine — see `src-tauri/src/torrent_engine.rs`.
- **SQLite storage layer (`src-tauri/src/db/`)** — see "Storage" section below.

### Cross-cutting UI
- **Launch flow:** `GameContext.launch(...)` → `invoke("launch_game", {...})` from Rust. Rust:
  1. Spawns the exe (Windows: `ShellExecuteExW` with `runas` if `ERROR_ELEVATION_REQUIRED`, else `std::process::Command`).
  2. Registers a session with the shared `Arc<Mutex<GameWatcher>>` (from `state()`).
  3. Starts a metrics collection channel (`metrics_collector::start_metrics_collection`) keyed to the new PID + GPU.
  4. Background poller (`game_watcher::start_background_poll`, every 5s) detects exit via WMI on Windows and writes one row to the `sessions` table before emitting the `game-exited` event.
- **Session record per exit:** last_played bump + activity dashboard roll-up. Use `update_game_last_played` IPC, not `save_games`, for the hot path.
- **Steam `open` flow:** when a Steam title has no local exe (e.g., synced only), Rust opens `steam://run/<appid>` via the opener plugin and registers a pending session that the poller activates when the matching process appears.

## Storage (SQLite)

Phase 1–4 of a migration that moved every JSON file under `<app_data_dir>` plus the bulk of the frontend's `localStorage` payloads into one SQLite database (`gamelib.db`). Sensitive credentials live in the **OS keychain** via the `keyring` crate.

- **Pool:** `src-tauri/src/db/pool.rs` — `r2d2_sqlite` (pinned to `0.24` because it requires `rusqlite ^0.31`; `librqbit` 7.x has a broken dep graph that requires 8.x and `rusqlite` major unification). Connections use WAL mode.
- **Schema registry:** `src-tauri/src/db/schema.rs` lists `SCHEMA_VERSIONS: &[(&str, &str)]` (`v1`, `v2`, files in `schema_v{1,2}.sql`). **Add new versions by appending, never renumber.** The runner in `db::migrate::run_migrations` applies each version in its own transaction inside `.setup`.
- **Tables:** the canonical list lives in [`schema_v1.sql`](src-tauri/src/db/schema_v1.sql) + [`schema_v2.sql`](src-tauri/src/db/schema_v2.sql). Confirmed in code: `games`, `sources`, `downloads`, `sessions`, `wishlist`, `kv`, `store_cache`, `store_detail`, `achievements`, `news`, `schema_meta`. If you need the current authoritative list, read those SQL files — anything else (e.g. an FTS5 mirror) is unverified.
- **DAO pattern:** one file per table under `src-tauri/src/db/` (`games.rs`, `sessions.rs`, `sources.rs`, `wishlist.rs`, `store_cache.rs`, `achievements.rs`, `news.rs`, `kv.rs`, `secrets.rs`, `legacy.rs`, `atomic.rs`, `migrate.rs`, `pool.rs`, `schema.rs`, `mod.rs`) exposing `upsert_*`, `list_*`, helpers. Commands extract the DB pool via `app.state::<db::Db>().inner().clone()` — never wrap in `Arc`, the inner pool is already shared.
- **Compact JSON columns:** used for variform state (sources config payloads, a whole `GameData` row, store detail cache). Tradeoff: read-side deserialization vs. write-side schema flexibility. See `db::games::GameRow` round-trip in `save_games` for the pattern.
- **Atomic JSON writes (Phase 0, only for unmigrated files):** `db::atomic.rs` writes to a `.tmp` sibling then `fs::rename` for crash-safety. Use it for any file we haven't migrated into SQLite yet.
- **Secrets:** `db::secrets.rs` wraps `keyring` for Steam / Epic OAuth tokens and Real-Debrid API keys. macOS Keychain / Windows Credential Manager / Linux secret-service — `sync-secret-service` is enabled for Linux `keyring` so Gnome Keyring + KWallet work without extra setup.
- **v2 change:** `schema_v2.sql` adds `gog_game_id` (TEXT) + `gog_playtime` (INTEGER) columns to `games`, both nullable. The Rust `GameData` struct uses `Option<…>`; older rows without these fields deserialize cleanly thanks to `serde(default)`.

## Integrations

- **Steam** — `steam/sync.rs` reads `libraryfolders.vdf` + the manifests under `steamapps/`, then pulls metadata from the Web API (key stored in keychain). Live concurrent player count via `ISteamUserStats/GetNumberOfCurrentPlayers/v1/` (no key needed), cached 60s per-appid in `PlayerCountCache`. `ISteamUserStats/GetNumberOfCurrentPlayers/v1/` aggregates plus 24h ring buffer in `PlayerCountHistoryCache` (capped at 1440 samples / 5s dedupe).
- **GOG Galaxy** — `gog/auth.rs` opens a Tauri WebView at `https://auth.gog.com`, JS detector posts a callback bundle via `gog_webview_callback` Tauri command (UUID-→-`mpsc::Sender` mapping in `GogWebviewCallbackSlot`). `gog/sync.rs` calls the same bridge twice — first for the login bundle, then a wider kind="sync" webview to scrape the user's library.
- **Epic Games Store** — OAuth via `epic::auth` (refresh tokens in keychain). `epic::sync::epic_sync_library` callers land via `epic_sync_library` command.
- **Achievements** — `achievements.rs` pulls Steam achievement lists via the Web API (string-typed `percent` from the API is parsed defensively). Cached in the `achievements` table.
- **News** — RSS reader. `fetch_url` IPC lets the frontend bypass browser CORS; `news.rs` DAO persists the most recent read per feed.
- **Deals** — `deals.rs` exposes `fetch_gamepass_catalog`, `fetch_isthereanydeal_deals`, `fetch_giveaways`, `open_deal_url` (opens external via opener plugin).
- **Crackwatch** — `crackwatch::fetch_crackwatch_status(game_name, app_id?)` scrapes gamestatus.info for crack status (Hydra-style: `CrackWatchService` + 24h KV cache keyed by slug+appid, returns `CrackWatchStatus { isCracked, crackDate, crackGroup, protection }` or `null`). Rendered by `CrackWatchCard` (`CrackWatchSection` presentational + skeleton).
- **Torrents** — `torrent_engine.rs` wraps `librqbit` (see Cargo.toml — `librqbit 8`, `default-tls`, **no** `http-api`). Upload disabled via runtime `SessionOptions`. Cleanup hook (`cleanup_extractions`) registered on the Tauri `RunEvent::Exit`.

## Style & UI conventions

- **Dark-first** — `:root` declares the dark palette; `[data-theme="light"]` overrides. `ThemeProvider` toggles `data-theme` on `<html>`.
- **Iconography** — inline SVG only. Components live next to their consumers in `src/components/<area>/`.
- **Modals & overlays** — `<Splashscreen />` overlays at z-index 9500; modal components use fixed positioning. Render nothing when idle (don't mount empty shells).
- **Cards / KPIs** — reuse `src/components/ui/Card.tsx`, `KpiTile.tsx`, `Badge.tsx`, `Skeleton.tsx`, `Tooltip.tsx`, `ConfirmModal.tsx` for consistency.

## Conventions (do / don't)

- **Routing:** Always `HashRouter`. Never `BrowserRouter` — Tauri ships `file://` in production.
- **Theming:** Use CSS variable tokens (`var(--…)`) defined in `App.css`. Never hardcode colors. Every dark-mode style sees its light counterpart in `[data-theme="light"]`.
- **Components:** One component per file under `src/components/<area>/`. Co-locate styles in the matching `<area>.css` or `App.css`. Prefer CSS classes over CSS-modules so theme tokens apply.
- **Icons:** Inline SVGs, no icon library dependency.
- **Tauri commands:** Round-trip JSON at the boundary (`serde_json::to_value` / `from_value`) — saves hand-rolling field-by-field converters. Use `#[serde(rename_all = "camelCase")]` on Rust structs and `#[serde(default)]` for new optional fields so deserialization of older payloads still works.
- **State registration:** Register pooled/shared state inside `.setup` and read it via `app.state::<T>()`. Do **not** wrap the existing `Db` in `Arc` (the pool is already shared); other shared state (GameWatcher, SourceManager, StoreChecker) uses `Arc<Mutex<…>>`.
- **Async + locks:** Hold `Mutex` guards across `.await` only when absolutely necessary — the codebase generally clones into local variables and drops the guard before awaiting.
- **Schema migrations:** Edit existing `CREATE TABLE` clauses? **No.** Add a new `schema_vN.sql` file + append to `SCHEMA_VERSIONS` + use `ALTER TABLE … ADD COLUMN` for new columns.
- **Bundle size:** Tauri's <10 MB target is intentional. **Do not** add heavyweight N-API/icon dependencies. `html2canvas` is the only deliberate exception (used to capture screenshots of the Game page). Prefer browser-native APIs where possible.

## Common dev gotchas

- **Windows-only paths:** `game_watcher` and process polling use `WMI` + `Win32` APIs (`wmi`, `windows 0.58` crate). On non-Windows the watcher still runs but `query_running_processes()` returns empty (the cross-platform smoke test path). Elevation (`runas`) is Windows-only; passing `runAsAdmin: true` on macOS/Linux is a no-op error.
- **Steam OpenID deprecation:** Steam auth (`steam/auth.rs`) uses a pasted **Web API key**, not the deprecated OpenID flow. The WebView + RSA finalize flow is gone.
- **`librqbit` major pin:** Don't bump `librqbit` to anything below `8` — `librqbit 7.0.1` has a broken dep graph (`librqbit-core 4.1.0` vs `5.0.0` mismatch in sub-crates) and fails to compile. Feature flags: `default-tls` on, `http-api` **off** (avoids pulling axum + serde_html_form).
- **rustls vs openssl:** `keyring 3` defaults to `crypto-rust`, deliberately avoiding the openssl-sys transitive dep. Don't switch to `vendored` (that's an openssl-sys feature on purpose).
- **Player-count caching** (see "Integrations" above for the constants): live cache 60s per-appid, history cap 1,440 samples, 5s multi-banner dedupe. Note: only the Steam game-stats cache (`SteamGameStatsCache`) carries a 5 min negative cache — the player-count cache itself does not.
- **`Cargo.lock` is committed** in this repo. Manually bumping version ranges in `Cargo.toml` is acceptable; after a bump, run `cargo update -p <crate>` and review the **lockfile diff** carefully — transitive changes (keyring, librqbit, rusqlite especially) are how subtle regressions sneak in.
- **React 19:** Uses `react-dom/client` + `createRoot`. No `ReactDOM.render`. Concurrent features are opt-in per component.
- **No tests yet:** The repo has no `*.test.tsx` / `#[cfg(test)]` scaffolding. Unit tests exist only as inline examples (e.g. in `db/migrate.rs`). When adding a feature, add at least one happy-path + one error-path test.

## Repo layout cheat-sheet

```
src/                       React/TS frontend
  App.tsx                  Routes + provider nesting
  main.tsx                 createRoot + global CSS imports
  pages/                   One folder per top-level route
  components/<area>/       Feature-area components
  context/                 Providers (Game, Activity, Source, ...)
  hooks/                   Reusable stateful helpers
  types/                   Mirror the Rust serde models
  styles/                  Per-feature themed CSS
  *.css                    Layout / store / library base styles

src-tauri/
  src/lib.rs               Tauri command registry + setup hook
  src/main.rs              Trivial entry
  src/db/                  SQLite pool + schema + DAOs
  src/steam|gog|epic/      Per-store auth + sync + types
  src/downloader/          direct.rs, debrid.rs
  src/torrent_engine.rs    librqbit wrapper
  src/game_watcher.rs      WMI process polling + session lifecycle
  src/game_scraper.rs      IGDB + LaunchBox + Steam reviews metadata fetch
  src/achievements.rs      Steam achievement sync + cache
  tauri.conf.json          Frameless window + bundle config
  Cargo.toml               Pinned major versions for librqbit/keyring/rusqlite
```
