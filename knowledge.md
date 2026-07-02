# Project knowledge

This file gives Codebuff context about your project: goals, commands, conventions, and gotchas.

## Quickstart
- **Stack:** Tauri v2 (Rust backend + React 19 + TypeScript frontend via Vite)
- **Setup:** `npm install`
- **Dev:** `npm run tauri dev` (starts Vite dev server + Tauri window)
- **Build:** `npm run tauri build`
- **Typecheck:** `npx tsc --noEmit`
- **Frontend only:** `npm run dev` (just the web app on localhost:1420)

## Architecture
- **Frontend:** `src/` — React components with HashRouter for routing (required for Tauri's file:// protocol)
  - `src/components/` — TopNav, Sidebar, MainContent (layout components)
  - `src/pages/` — LibraryPage, StorePage, CommunityPage, SettingsPage, PluginsPage
  - `src/App.css` — CSS custom properties theme engine (light/dark), all layout styles
  - `src/index.css` — CSS reset and base styles
- **Backend (Rust):** `src-tauri/` — OS-level operations (game launching, file management, HTTP, torrents)
- **Key design goals:** Lightweight (<10MB), cross-platform (Win/Mac/Linux), plugin system, theme engine (CSS variables)

## Conventions
- **Routing:** Always use `HashRouter` (not BrowserRouter) — Tauri serves from `file://` protocol in production
- **Theming:** All colors go through CSS custom properties in `:root`/`[data-theme="light"]` — never hardcode colors
- **Components:** Modular, one component per file, co-locate styles in `App.css` (prefer CSS classes over CSS modules for theming)
- **Icons:** Inline SVGs (no icon library dependency)
- **Things to avoid:** Heavy dependencies that bloat app size — Tauri was chosen over Electron specifically for this reason
