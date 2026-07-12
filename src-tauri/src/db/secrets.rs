//! OS-keychain wrapper.
//!
//! Phase 4 migrates the OAuth tokens and debrid API key out of
//! plaintext JSON files into the OS keychain:
//!
//! - **Windows**: Credential Manager (`wincred`)
//! - **macOS**: Keychain Access (login keychain by default)
//! - **Linux**: Secret Service (`gnome-keyring`, `kwallet`,
//!   `KeePassXC` Secret Service plugin, etc.)
//!
//! Wrapped with a thin `SecretStore` that exposes typed get/set/delete
//! so callers don't need to drop down to `keyring::Entry`. Errors
//! are mapped to `String` matching the rest of the commands' style.
//!
//! Account names we use today:
//! - `epic_tokens`
//! - `steam_session`
//! - `steam_config`
//! - `debrid_api_key`
//!
//! The service name is `gamelib/gamelib-app` (matching the bundle
//! identifier `com.gamelib.app`). On Windows this groups entries
//! under "Generic Credentials → gamelib/gamelib-app"; on macOS the
//! user sees them as "Gamelib" in Keychain Access; on Linux a
//! single secret-service collection per service name.

use keyring::Entry;

const SERVICE: &str = "gamelib/gamelib-app";
#[allow(dead_code)] // reserved for future use
pub const SERVICE_FOR_DIAGNOSTICS: &str = SERVICE;

/// One-stop wrapper. Cloning is cheap (only holds a `&str`).
#[derive(Clone)]
pub struct SecretStore;

impl SecretStore {
    pub fn new() -> Self {
        Self
    }

    pub fn get(&self, account: &str) -> Result<Option<String>, String> {
        let entry = Entry::new(SERVICE, account)
            .map_err(|e| format!("keyring entry new: {e}"))?;
        match entry.get_password() {
            Ok(s) => Ok(Some(s)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("keyring get: {e}")),
        }
    }

    pub fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        let entry = Entry::new(SERVICE, account)
            .map_err(|e| format!("keyring entry new: {e}"))?;
        entry
            .set_password(secret)
            .map_err(|e| format!("keyring set: {e}"))
    }

    pub fn delete(&self, account: &str) -> Result<(), String> {
        let entry = Entry::new(SERVICE, account)
            .map_err(|e| format!("keyring entry new: {e}"))?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("keyring delete: {e}")),
        }
    }
}
