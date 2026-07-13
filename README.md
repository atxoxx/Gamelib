<div align="center">

# GameLib

**A unified, cross-store game launcher and library manager.**

Unify your Steam, GOG, Epic, and DRM-free libraries into a single, fast, native experience — with discovery, sync, activity tracking, and a controller-first Big Picture mode.

[![Status](https://img.shields.io/badge/status-active--development-yellow)](#status)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux-informational)](#platforms)
[![Stack](https://img.shields.io/badge/stack-Tauri%20%7C%20Rust%20%7C%20React%20%7C%20TypeScript-orange)](#tech-stack)
[![License](https://img.shields.io/badge/license-MIT-green)](#license)

</div>

---

## ✨ Features

- **Unified Library** — Steam, GOG Galaxy, Epic Games Store, and manual imports in one cohesive grid.
- **Rich Game Pages** — Hero, metadata, reviews, achievements, screenshots, videos, web links, HowLongToBeat, Crackwatch, ProtonDB, and live player counts.
- **Storefront & Discovery** — IGDB-powered catalog, wishlist tracking, RSS news, and real-time deals across stores.
- **Activity Tracking** — FPS, frametime, and per-session metrics via MSI Afterburner / RTSS integration.
- **Downloads** — Direct downloads, debrid (Real-Debrid / AllDebrid), and torrent support via `librqbit`.
- **Storage Manager** — Visualize disk usage, move installs between drives, and bulk-recalculate sizes.
- **Theming & Density** — Dark-first design with light mode, compact/comfortable layouts, and configurable UI tokens.
- 🆕 **Big Picture Mode** *(planned)* — Controller-friendly, full-screen launcher UI for couch and TV play.
- 🆕 **Linux Support** *(planned)* — Native Tauri builds, Wine/Proton prefix management, Steam Deck optimizations.

> See [`todo.md`](./todo.md) for the full roadmap.

---

## 💡 Inspiration

GameLib stands on the shoulders of excellent projects in the launcher space:

- **[Hydra Launcher](https://hydralauncher.gg)** — for the clean, modern, torrent-first approach to game distribution.
- **[Playnite](https://playnite.com)** — for the extensible, library-aggregation philosophy and customization depth.
- **[LaunchBox](https://www.launchbox-app.com)** — for the rich metadata, media, and emulation-focused cataloging.
- **[Steam](https://store.steampowered.com)** + **[GOG Galaxy](https://www.gog.com/galaxy)** — for unified-library UX patterns.

We borrow the best ideas from each and aim to combine them into a single, lightweight native app.

---

## 🛠️ Tech Stack

| Layer    | Technology |
|----------|------------|
| Shell    | [Tauri v2](https://tauri.app) (Rust) |
| Frontend | [React 19](https://react.dev) + [TypeScript](https://www.typescriptlang.org) |
| Bundler  | [Vite 7](https://vitejs.dev) |
| DB       | SQLite (`rusqlite` + `r2d2_sqlite`) |
| Secrets  | OS keychain via [`keyring`](https://crates.io/crates/keyring) |
| Torrents | [`librqbit`](https://github.com/ikatson/rqbit) |
| Charts   | Custom SVG (in `src/components/charts/`) |
| Routing  | React Router v7 (`HashRouter` for Tauri `file://`) |

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org) (≥ 18) + npm
- [Rust](https://rustup.rs) (stable toolchain)
- Platform deps: see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

### Development
```bash
npm install
npm run tauri dev      # launches the native window with hot reload
```

Frontend-only iteration (no native shell):
```bash
npm run dev            # Vite at http://localhost:1420
```

### Build
```bash
npm run tauri build    # tsc + vite build + native bundles
```

### Typecheck
```bash
npx tsc --noEmit
```

---

## 📁 Project Structure

```
.
├── src/                 React + TypeScript frontend
│   ├── pages/           Top-level route components
│   ├── components/      Feature-scoped UI components
│   ├── context/         Cross-cutting providers (Game, Activity, …)
│   ├── hooks/           Reusable stateful helpers
│   ├── types/           Mirrors of Rust serde models
│   └── styles/          Themed CSS modules
└── src-tauri/           Rust backend
    ├── src/             Tauri commands, DB DAOs, integrations
    │   ├── steam|gog|epic/   Per-store sync + auth
    │   ├── downloader/       Direct + debrid downloads
    │   ├── db/               SQLite pool + schema
    │   └── torrent_engine.rs librqbit wrapper
    └── tauri.conf.json  Frameless window + bundle config
```

For deeper architectural notes and conventions, see [`knowledge.md`](./knowledge.md).

---

## 🗺️ Roadmap

Track progress, ideas, and priorities in [`todo.md`](./todo.md). Highlights:

- ✅ Steam, GOG, Epic library sync
- ✅ Steam achievements, HowLongToBeat, Crackwatch, live player counts
- ✅ Activity dashboard with FPS + frametime charts
- ✅ Downloads (direct, debrid, torrents)
- ✅ Storage manager + bulk operations
- ✅ News page with RSS feeds
- ✅ IGDB-backed storefront & wishlist
- 🚧 Steam reviews & multi-source ratings
- 🚧 Per-game launch options & compatibility profiles
- ⏳ Big Picture Mode
- ⏳ Linux + Steam Deck support
- ⏳ Plugin system
- ⏳ Theme editor & community themes

---

## 📌 Status

> 🛠️ **Personal project, vibe-coded** — built in my free time as a learning exercise and a love-letter to PC gaming.
> Expect rough edges, breaking changes, and rapid iteration. Contributions and ideas are welcome.

---

## 🤝 Contributing

1. Read the conventions in [`knowledge.md`](./knowledge.md) (theme tokens, routing, schema migrations, etc.).
2. Fork the repo and create a feature branch.
3. Keep PRs focused and documented.
4. Run `npx tsc --noEmit` and `cargo check` before submitting.

Please open an issue before starting large changes so we can discuss direction.

---

## 📄 License

MIT — free to use, modify, and distribute. Attribution appreciated.

---

## 🙏 Acknowledgments

- The Tauri, React, and Rust communities for the excellent tooling.
- IGDB, HowLongToBeat, Steam, GOG, Epic, and IsThereAnyDeal for the data.
- Hydra Launcher, Playnite, and LaunchBox for the inspiration.

<div align="center">
<sub>Built with ☕ and a lot of music.</sub>
</div>
