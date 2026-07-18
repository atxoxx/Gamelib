/**
 * TypeScript types for the Humble Bundle integration — Playnite
 * `HumbleLibrary` parity.
 *
 * These mirror the Rust DTOs in `src-tauri/src/humble/*` and the IPC
 * command shapes. Field names stay camelCase end-to-end because the
 * Rust structs use `#[serde(rename_all = "camelCase")]`.
 */

/** Persistent Humble login marker — read through
 *  `humble_is_authenticated` / `humble_start_login` IPC. */
export interface HumbleSession {
  /** Display name scraped from the library page (best-effort). */
  username: string;
  /** Unix seconds at which login completed. */
  loggedInAt: number;
  /** True once we've confirmed at least one successful order fetch. */
  hasOrders?: boolean;
}

/** Public auth state shape surfaced to the Settings UI. */
export interface HumbleAuthState {
  isAuthenticated: boolean;
  username?: string;
  /** Unix seconds of the last successful sync. */
  lastSync?: number;
}

/**
 * User-toggleable settings — mirrors `HumbleLibrarySettings` (Playnite).
 * Every field maps 1:1 to the Rust `HumbleSettings` blob.
 */
export interface HumbleSettings {
  /** Master switch — when false, sync imports nothing. */
  connectAccount: boolean;
  /** Skip subproducts with no `windows` download. */
  ignoreThirdPartyStoreGames: boolean;
  /** Import third-party-store (Steam/GOG/…) drm-free collisions. */
  importThirdPartyDrmFree: boolean;
  /** Import owned library subproducts (the main "Orders" library). */
  importGeneralLibrary: boolean;
  /** Import non-game bonus downloads (soundtracks, artbooks, …). */
  importGameExtras: boolean;
  /** Import the Humble Trove catalog (subscriber library). */
  importTroveGames: boolean;
  /** Prefer `humble://launch/<id>` over the on-disk executable. */
  launchViaHumbleApp: boolean;
}

/** Single synced game entry — what the React side receives via
 *  `invoke("humble_sync_library")` and feeds into `addGames(...)`. */
export interface HumbleSyncedGame {
  id: string;
  title: string;
  /** Stable Humble game id. */
  humbleGameId: string;
  /** True for Trove-sourced entries. */
  isTrove: boolean;
  isInstalled: boolean;
  /** Absolute path to the resolved launchable executable. */
  installPath?: string;
  installDir?: string;
  /** Cover image URL (order product icon). */
  coverUrl?: string;
  /** Install-dir size in bytes (measured when isInstalled). */
  sizeBytes?: number;
  sizeRootPath?: string;
  /** True when this entry is a non-game extra. */
  isExtra: boolean;
}

/** Result of a Humble library sync. */
export interface HumbleSyncResult {
  success: boolean;
  gamesImported: number;
  gamesSkipped: number;
  errors: string[];
  /** Unix seconds of when the sync completed. */
  lastSync: number;
  syncedGames: HumbleSyncedGame[];
}
