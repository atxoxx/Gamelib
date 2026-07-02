# Game Library Application Specification

## 1. Overview
This document outlines the base technical and functional specification for a modular, lightweight, and cross-platform desktop application designed to act as a unified game library. The app allows users to import, organize, and launch games, while offering extensive system-level capabilities and UI customizability.

---

## 2. Framework Recommendation: Tauri
**Recommended Stack:** **Tauri** (Backend: Rust, Frontend: React / Vue / Svelte with TypeScript).

### Why Tauri instead of Electron?
While Electron is the traditional choice for web-based desktop apps, you explicitly requested the app to be **lightweight**. Electron bundles an entire Chromium browser and Node.js environment, leading to heavy RAM usage and large file sizes (often 100MB+). 
* **Lightweight & Portable:** Tauri uses the host operating system's native webview (WebView2 on Windows, WebKit on macOS/Linux). This results in extremely small app sizes (often under 10MB) and minimal RAM usage.
* **Cross-Platform:** Fully compatible with Windows, macOS, and Linux out of the box.
* **Deep OS Integration:** Tauri's Rust backend is incredibly fast and secure. It can easily handle your requirements to run system scripts, delete folders, and manage files.
* **Web Native (Media & Previews):** Because the frontend uses standard web technologies (HTML/CSS/JS), embedding HTML5 video players for game trailers and using `<iframe>` or webviews to render website previews is natively supported.
* **Network & Torrents:** Rust has excellent libraries (crates) for networking, downloading files, and handling peer-to-peer/torrent protocols natively.

---

## 3. User Interface (UI) Layout
The application will utilize a modern, responsive web layout (CSS Flexbox/Grid).

* **Top Navigation Bar (Tabs):** * Acts as the primary page router.
  * Modular tabs: *Library, Store/News, Community, Settings, Plugins*.
  * Designed to easily append new tabs dynamically via the plugin system.
* **Left Sidebar (Game List):**
  * Displays the user's imported games in a scrollable list.
  * Includes a search bar and advanced filters (e.g., By genre, By platform, Installed/Uninstalled, Favorites).
  * Collapsible on smaller screens for responsiveness.
* **Main Content Area (Game Page):**
  * Appears dynamically when a game is selected from the sidebar.
  * **Header:** Game banner/cover art, title, play time, and a prominent "Launch Game" button.
  * **Media Area:** Built-in video player for trailers or gameplay footage.
  * **Information Panel:** Game description, metadata (developer, release date).
  * **Web Preview:** A dedicated section (iframe) to render web content (e.g., live patch notes from a website, Wiki previews, or integrated guides).

---

## 4. Modularity Architecture
To ensure the app is highly extensible:
* **Frontend Component Architecture:** Using a framework like React or Vue allows the UI to be broken down into strict components. Adding a new feature simply means injecting a new component.
* **Plugin System:** A plugin API that allows third-party scripts or internal add-ons to hook into the app's lifecycle. Plugins should be able to:
  * Register new Top Tabs.
  * Add custom context menu items.
  * Inject new scrapers to automatically fetch game metadata.
* **Theme Engine:** CSS variables (Custom Properties) will dictate all colors, fonts, and spacing. Users can drop `.css` or `.json` theme files into a `themes/` folder to instantly restyle the app.

---

## 5. System Capabilities & Scripting
The app requires powerful host-system permissions. In a Tauri architecture, this is split between the UI and the Backend:
* **Game Execution:** The Rust backend will use standard OS process spawning (`std::process::Command`) to securely launch game executables (`.exe`, `.sh`, `.app`).
* **Script Execution & File Management:** The app will support custom pre-launch and post-launch scripts (e.g., run a Python/Batch script to clear cache folders before launching a game). Rust's standard file system (`std::fs`) can handle deleting folders or moving files efficiently.
* **Downloader & Torrents:**
  * **HTTP/HTTPS:** Handled via Rust crates like `reqwest` to download updates or game files.
  * **Torrents:** Handled via Rust BitTorrent libraries (e.g., `rust-torrent` or custom implementations via `tokio`), allowing background P2P downloading directly managed by the app's backend.
