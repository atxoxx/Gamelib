//! GOG Galaxy library integration.
//!
//! Module surface (full Playnite-parity stack, OAuth2 bearer-token auth):
//! - `types` — wire DTOs + OAuth token types (camelCase).
//! - `auth` — OAuth2 WebView login, token exchange, refresh,
//!   keychain persistence, session marker.
//! - `client` — pure-Rust `reqwest`-backed GOG HTTP client
//!   carrying `Authorization: Bearer <token>`.
//! - `installed` — Windows registry + `goggame-<id>.info` parsing
//!   + primary-exe resolution.
//! - `sync` — pure-Rust orchestrator. Refreshes tokens, probes
//!   `account/basic`, fetches owned + metadata + playtime,
//!   merges with installed scan into `GogSyncResult`.
//!
//! The `webview_capture` module has been removed (JS probe →
//! on_navigation callback). The `cookies` module remains —
//! `embed.gog.com/user/data/games` requires session cookies
//! even with OAuth2 Bearer auth on other endpoints.

pub mod auth;
pub mod client;
pub mod cookies;
pub mod installed;
pub mod sync;
pub mod types;
