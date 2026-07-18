/**
 * TypeScript types for the Ubisoft Connect (Uplay) integration —
 * Playnite `UplayLibrary` parity.
 *
 * These mirror the Rust DTOs in `src-tauri/src/uplay/*` and the IPC
 * command shapes. Field names stay camelCase end-to-end because the
 * Rust structs use `#[serde(rename_all = "camelCase")]`.
 */

/**
 * User-toggleable settings — mirrors `UplayLibrarySettings` (Playnite).
 * Every field maps 1:1 to the Rust `UplaySettings` blob.
 */
export interface UplaySettings {
  /** Import games detected as installed via the registry. */
  importInstalledGames: boolean;
  /** Import the full owned library (incl. uninstalled) from the local
   *  product cache. */
  importUninstalledGames: boolean;
}

/** Single synced Ubisoft Connect game entry. */
export interface UplaySyncedGame {
  /** Stable game id: `uplay-<uplayId>`. */
  id: string;
  title: string;
  /** Ubisoft `uplay_id` (used for `uplay://launch/<id>`). */
  uplayId: string;
  isInstalled: boolean;
  /** Absolute path to the install directory, `undefined` when not
   *  installed on disk. */
  installDir?: string;
  /** Background image URL (from the product cache). */
  backgroundImage?: string;
  /** Cover image URL (from the product cache). */
  coverImage?: string;
  /** Icon image URL (from the product cache). */
  iconImage?: string;
  /** Install-dir size in bytes (measured when isInstalled). */
  sizeBytes?: number;
  sizeRootPath?: string;
}

/** Result of a Ubisoft Connect sync. */
export interface UplaySyncResult {
  success: boolean;
  gamesImported: number;
  gamesSkipped: number;
  errors: string[];
  /** Unix seconds at which the sync completed. */
  lastSync: number;
  /** True when Ubisoft Connect is installed at all — gates the
   *  "Sync Library" button on the tile. */
  clientInstalled: boolean;
  /** Install root of Ubisoft Connect (empty off-Windows or when not
   *  installed). */
  clientPath: string;
  syncedGames: UplaySyncedGame[];
}
