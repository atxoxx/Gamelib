/**
 * TypeScript types for the Rockstar Games Launcher integration —
 * Playnite `RockstarLibrary` parity (installed-games + launcher
 * client only; there is no Rockstar cloud library API).
 *
 * These mirror the Rust DTOs in `src-tauri/src/rockstar/mod.rs`
 * and `src-tauri/src/rockstar/sync.rs`. Field names stay camelCase
 * end-to-end because the Rust structs use
 * `#[serde(rename_all = "camelCase")]`.
 */

/** Single synced Rockstar title (installed scan result). */
export interface RockstarSyncedGame {
  /** Stable game id: `rockstar-<titleId>`. */
  id: string;
  title: string;
  /** Rockstar `TitleId` (e.g. `"gta5"`, `"rdr2"`). */
  titleId: string;
  isInstalled: boolean;
  /** Absolute path to the primary executable, `undefined` when
   *  not installed. */
  installPath?: string;
  installDir?: string;
  /** Absolute path to the registry `DisplayIcon`, when present. */
  iconPath?: string;
  /** Install-dir size in bytes (measured when isInstalled). */
  sizeBytes?: number;
  sizeRootPath?: string;
}

/** Result of a Rockstar scan. Mirrors `GogSyncResult` /
 *  `EpicSyncResult` so the Settings tile renders it uniformly. */
export interface RockstarSyncResult {
  success: boolean;
  gamesImported: number;
  gamesSkipped: number;
  errors: string[];
  /** Unix seconds at which the scan completed. */
  lastSync: number;
  /** True when the Rockstar Games Launcher is installed at all —
   *  gates the "Sync Library" button on the tile. */
  clientInstalled: boolean;
  /** Install root of the Rockstar Games Launcher (empty off-Windows
   *  or when not installed). */
  clientPath: string;
  syncedGames: RockstarSyncedGame[];
}
