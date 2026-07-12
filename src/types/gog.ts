/**
 * TypeScript types for the GOG Galaxy integration.
 *
 * These mirror the Rust DTOs in `src-tauri/src/gog/types.rs` and the
 * command signatures in `src-tauri/src/gog/{auth,sync}.rs`. Field
 * names stay camelCase end-to-end because the parent structs use
 * `#[serde(rename_all = "camelCase")]`, so the field comes across
 * the IPC boundary already shaped for the React side.
 */

/** A single GOG game reshaped for the frontend library.
 *  Maps directly to the Rust `GogSyncedGame` in `gog/types.rs`. */
export interface GogSyncedGame {
  id: string;
  title: string;
  /** GOG numeric product id (e.g. `"1207658925"`). */
  gogGameId: string;
  isInstalled: boolean;
  /** Absolute path to the resolved launchable executable,
   *  `undefined` when the game is owned-but-not-installed. */
  installPath?: string;
  /** Absolute path to the install dir (audit-able from the
   *  Storage tab, same as the Steam/Epic pattern). */
  installDir?: string;
  /** Playtime in MINUTES. Matches `steamPlaytime` semantics. */
  playtimeMinutes?: number;
  /** Unix SECONDS of the user's last session in this game.
   *  Rust returns seconds; convert to milliseconds on render
   *  (`value * 1000`) to match the project-wide `lastPlayed`
   *  convention in `Game`. */
  lastPlayed?: number;
  /** Cover image URL on GOG's CDN (`images.gog-static.com`). */
  coverUrl?: string;
  /** Total install footprint in bytes, measured by the Rust
   *  sync flow when `isInstalled`. `undefined` when uninstalled
   *  or the disk walk errored. */
  sizeBytes?: number;
  /** Folder the size was measured against. */
  sizeRootPath?: string;
}

/** Result of a GOG library sync — mirrors the Rust `GogSyncResult`. */
export interface GogSyncResult {
  success: boolean;
  gamesImported: number;
  gamesSkipped: number;
  errors: string[];
  /** Unix seconds of when the sync completed. */
  lastSync: number;
  syncedGames: GogSyncedGame[];
}

/** Auth state surfaced to the Settings UI. Mirrors the shape of
 *  `EpicAuthState` and `SteamAuthState` so the Settings page's
 *  integration list is uniform across the three vendors. */
export interface GogAuthState {
  isAuthenticated: boolean;
  userId?: string;
  username?: string;
  /** Unix seconds of last successful `gog_start_login` /
   *  `gog_finish_login` round-trip. Persisted to the kv_store so
   *  the Settings page can display "Last connected … ago". */
  lastSync?: number;
}
