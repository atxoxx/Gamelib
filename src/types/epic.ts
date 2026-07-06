/** Epic authentication tokens returned after OAuth flow. */
export interface EpicAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId: string;
  displayName?: string;
}

/** A synced Epic game entry from the backend. */
export interface EpicSyncedGame {
  id: string;
  title: string;
  namespace: string;
  catalogItemId: string;
  isInstalled: boolean;
  installPath?: string;
  playtimeMinutes?: number;
  lastPlayed?: number;
  /** Cover art URL from Epic's catalog CDN (keyImages). */
  coverUrl?: string;
  /** Total disk footprint of the install dir, measured by the Rust
   *  sync flow for installed games. `undefined` when uninstalled or
   *  the disk walk errored. */
  sizeBytes?: number;
  /** Folder the size was measured against (= parent of `installPath`). */
  sizeRootPath?: string;
}

/** Result of an Epic library sync operation. */
export interface EpicSyncResult {
  success: boolean;
  gamesImported: number;
  gamesSkipped: number;
  errors: string[];
  lastSync: number;
  syncedGames: EpicSyncedGame[];
}

/** Filter options for Epic games in the sidebar. */
export interface EpicFilterOptions {
  statuses: string[];
  categories: string[];
  namespaces: string[];
}

/** Auth state for the Settings UI. */
export interface EpicAuthState {
  isAuthenticated: boolean;
  accountId?: string;
  displayName?: string;
  lastSync?: number;
}
