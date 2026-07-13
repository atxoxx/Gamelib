//! System tray icon + right-click menu with a live "Playing: X" status line.
//!
//! Built with Tauri's first-party `tauri::tray` API (available because the
//! `unstable` feature is enabled in Cargo.toml). No third-party plugin
//! required — the same surface ships with Tauri 2 itself.
//!
//! ## Menu shape
//!
//! ```text
//!   Status line (disabled): "Gamelib — idle"  or  "Playing: <name>"
//!   ─────────────────
//!   Show Gamelib
//!   Hide to tray                (disabled when window is already hidden)
//!   ─────────────────
//!   Quit Gamelib
//! ```
//!
//! Left-click on the tray icon is **not** a menu trigger — it acts as
//! "Show Gamelib" so the user can dismiss the menu without an extra
//! click. Right-click opens the context menu (built-in behaviour when
//! `show_menu_on_left_click(false)` is set).
//!
//! ## Lifecycle
//!
//! `build_tray` is called once from `lib.rs::run` inside `.setup(...)`
//! after `GameWatcher` is registered. Returns `tauri::Result<()>` so
//! failures surface — but the caller wraps the call with
//! `unwrap_or_else(|e| eprintln!(...))` because a missing tray
//! (eg. headless Linux without a system tray) must not abort startup;
//! the launcher body still works, the user just can't reach Show/Hide
//! from the tray.
//!
//! ## State propagation
//!
//! The two events `GameWatcher` already emits — `game-started` (any
//! path that added an active session, including passive WMI
//! detection) and `game-exited` (any path that ended one, including
//! `force_close_game` and natural exits) — feed the listener
//! closures. Both re-read `GameWatcher::current_session_name()` so
//! the menu text follows the in-memory `active_sessions` HashMap as
//! the single source of truth. Any future launch path that registers
//! a session via `register_launched_session` (or `start_passive_`
//! session`) is auto-reflected without bespoke event-payload
//! parsing.

use std::sync::Arc;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Listener, Manager, Wry};

use crate::game_watcher::GameWatcher;

/// Concrete MenuItem generic for the desktop runtime. The full
/// `MenuItem<R>` type is parameterised over `R: Runtime`; on desktop
/// that runtime is always `tauri::Wry`. Pinning the concrete type
/// here keeps `app.state::<TrayHandles>()` (which is keyed by
/// `TypeId`, not generics) happy without forcing every consumer to
/// spell out `Wry`.
pub struct TrayHandles {
    /// Disabled label "Gamelib — idle" / "Playing: <name>". Clicking
    /// it is a no-op (Tauri treats disabled `MenuItem`s as
    /// non-interactive rows in the menu).
    pub status_item: MenuItem<Wry>,
    pub show_item: MenuItem<Wry>,
    /// Disabled when the window is already hidden — the user has no
    /// use for a "Hide to tray" entry if the window isn't visible.
    pub hide_item: MenuItem<Wry>,
    pub quit_item: MenuItem<Wry>,
}

impl TrayHandles {
    /// Stamp the status item with "Playing: <name>" and enable both
    /// Show (in case the window is hidden) and Hide (the user might
    /// have alt-tabbed back to lookup something mid-session).
    pub fn show_playing(&self, game_name: &str) {
        let _ = self.status_item.set_text(format!("Playing: {}", game_name));
        let _ = self.show_item.set_enabled(true);
        let _ = self.hide_item.set_enabled(true);
    }

    /// Reset to "Gamelib — idle" and disable Hide (can't hide a
    /// hidden window). Show stays enabled so the menu still serves
    /// users whose window sits hidden behind other apps.
    pub fn show_idle(&self) {
        let _ = self.status_item.set_text("Gamelib — idle");
        let _ = self.show_item.set_enabled(true);
        let _ = self.hide_item.set_enabled(false);
    }
}

/// Build the system tray icon, attach the menu, register event
/// listeners, and manage the menu-item handles as state.
///
/// Called from `lib.rs::run` inside `.setup(...)` after `GameWatcher`
/// has been registered and its background poll loop has started.
/// Returns `tauri::Result<()>` — callers log-and-continue on error
/// because the absence of a tray mustn't abort app startup
/// (headless Linux launches won't have one).
pub fn build_tray(app: &App<Wry>) -> tauri::Result<()> {
    let handle = app.handle();

    // Menu items. `status` is built disabled — Tauri treats disabled
    // items as inert status rows. The other three are interactive.
    // `with_id`'s fourth arg is `enabled`; `None` for accelerator on
    // every row (we don't currently expose a Ctrl+1/Ctrl+W-style
    // shortcut).
    let status_item = MenuItem::with_id(handle, "status", "Gamelib — idle", false, None::<&str>)?;
    let show_item = MenuItem::with_id(handle, "show", "Show Gamelib", true, None::<&str>)?;
    let hide_item = MenuItem::with_id(handle, "hide", "Hide to tray", false, None::<&str>)?;
    let quit_item = MenuItem::with_id(handle, "quit", "Quit Gamelib", true, None::<&str>)?;

    let menu = Menu::with_items(
        handle,
        &[
            &status_item,
            &PredefinedMenuItem::separator(handle)?,
            &show_item,
            &hide_item,
            &PredefinedMenuItem::separator(handle)?,
            &quit_item,
        ],
    )?;

    // Use the bundled app icon — already configured as the default
    // window icon by tauri.conf.json so we don't need to load a
    // separate file from disk. `default_window_icon()` returns
    // `Option<&Image>`; cloning yields `Option<Image>` so the
    // builder takes ownership.
    let icon = handle
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("default-window-icon".into()))?;

    // Persist the TrayIcon in a binding so the closure handlers below
    // can keep using it (we don't actually need it after `.build`,
    // but the builder's `build` returns `Result<TrayIcon>` and we
    // `let _ =` it so the binding doesn't trigger an unused warning).
    let _tray = TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .menu(&menu)
        // Show the menu on right-click only; left-click is "Show
        // Gamelib" via the on_tray_icon_event handler below. This
        // matches Discord / Steam / Spotify behaviour.
        .show_menu_on_left_click(false)
        .on_menu_event({
            // Show / Hide restore the window; Quit calls app.exit(0)
            // which triggers the existing RunEvent::Exit cleanup hook
            // (torrent_engine::cleanup_extractions + std::process::
            // exit(0) inside lib.rs::run). So the librqbit cleanup
            // runs the same way regardless of how the app exits.
            let app_handle = handle.clone();
            move |app, event| match event.id().as_ref() {
                "show" => {
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.unminimize();
                        let _ = win.set_focus();
                    }
                }
                "hide" => {
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.hide();
                    }
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event({
            move |tray, event| {
                if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                    if let Some(win) = tray.app_handle().get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.unminimize();
                        let _ = win.set_focus();
                    }
                }
            }
        })
        .build(handle)?;

    // Manage the menu-item handles so the listeners below can grab
    // them back from `app.state::<TrayHandles>()`. `MenuItem<Wry>` is
    // a cheap clone (it's internally `Arc`-backed) so we clone into
    // the state struct without losing the original references held
    // by the live `Menu` above.
    app.manage(TrayHandles {
        status_item: status_item.clone(),
        show_item: show_item.clone(),
        hide_item: hide_item.clone(),
        quit_item: quit_item.clone(),
    });

    // Live update subscribers. We read GameWatcher's active_sessions
    // on every emit so the indicator follows whatever path added the
    // session (Launch button via `register_launched_session`,
    // passive WMI detection via `start_passive_session`, future
    // integration paths) without bespoke event-payload parsing.
    // `app.listen` returns an `EventId` (ignored here — we don't
    // unlisten) and accepts any `Fn + Send + 'static` closure, so
    // the captured `handle.clone()` is sufficient.
    let app_handle_started = handle.clone();
    handle.listen("game-started", move |_event| {
        refresh_status_from_watcher(&app_handle_started);
    });

    let app_handle_exited = handle.clone();
    handle.listen("game-exited", move |_event| {
        refresh_status_from_watcher(&app_handle_exited);
    });

    Ok(())
}

/// Read GameWatcher's `current_session_name` once and update the menu
/// accordingly. The lock on `GameWatcher.active_sessions` is held for
/// microseconds (a single HashMap`::values().next()` + clone) so it
/// doesn't contend with the 5 s background poll or the per-launch
/// `force_close_game` path. If the lock is poisoned (a `GameWatcher`
/// mutex panicked mid-update), we treat it as "no active session"
/// and reset to idle so the menu doesn't stay stale forever.
fn refresh_status_from_watcher(app: &AppHandle<Wry>) {
    let watcher = app.state::<Arc<std::sync::Mutex<GameWatcher>>>();
    let handles = app.state::<TrayHandles>();

    let session_name: Option<String> = match watcher.lock() {
        Ok(w) => w.current_session_name(),
        Err(_) => None,
    };

    match session_name {
        Some(name) => handles.show_playing(&name),
        None => handles.show_idle(),
    }
}
