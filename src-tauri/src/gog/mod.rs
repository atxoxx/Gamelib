//! GOG Galaxy library integration.
//!
//! Public surface mirrors the Epic integration: `types.rs` defines the
//! serializable wire DTOs (serde camelCase so the React frontend can
//! `invoke()` them directly), `auth.rs` owns the Galaxy OAuth WebView
//! flow + token persistence, and `sync.rs` reads the user's owned
//! library and merges it with locally-installed games.
//!
//! All entry points are flat — `pub mod x;` lists all three. Commands
//! hang off these modules; the registration happens in the root
//! `lib.rs::run()` `invoke_handler!` block.

// `pub mod types;` first so that `auth.rs` / `sync.rs` can
// `use super::types::GogAuthTokens;` without a circular import.
pub mod types;
pub mod auth;
pub mod sync;
