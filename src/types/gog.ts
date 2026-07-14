/**
 * TypeScript types for the GOG Galaxy integration — Playnite
 * `playnite-gog-oss-plugin` parity.
 *
 * These mirror the Rust DTOs in `src-tauri/src/gog/types.rs` and
 * the IPC command shapes in
 * `src-tauri/src/gog/{auth,sync,webview_capture}.rs`. Field names
 * stay camelCase end-to-end because the Rust structs use
 * `#[serde(rename_all = "camelCase")]`.
 */

/** Persistent GOG login marker — read from the OS keychain
 *  through `gog_is_authenticated` / `gog_session` IPC. */
export interface GogSession {
  userId: string;
  username: string;
  /** Numeric galaxy user id; used as the stats key in the
   *  embed.gog.com response and as the gameplay endpoint URL
   *  segment (`gameplay.gog.com/clients/<userId>/playtime`). */
  galaxyUserId?: string;
  /** Unix seconds at which login completed. */
  loggedInAt: number;
}

/** Public auth state shape surfaced to the Settings UI. */
export interface GogAuthState {
  isAuthenticated: boolean;
  userId?: string;
  username?: string;
  /** Unix seconds of last successful `gog_start_login`. */
  lastSync?: number;
}

/** Per-game playtime + last session from GOG. */
export interface GogGameStats {
  /** Playtime in MINUTES. */
  playtime: number;
  /** Unix SECONDS of last play session. */
  lastSession?: number;
}

/** Per-product element of `embed.gog.com/user/data/games` owned[].
 *  The Rust deserializer coerces GOG's array-vs-object stats
 *  quirk into the `stats?: GogGameStats` you'll see — empty array
 *  becomes undefined, the account-keyed object becomes the entry. */
export interface GogLibraryGame {
  game: {
    id: string;
    title: string;
    isHidden?: boolean;
    url?: string;
  };
  stats?: GogGameStats;
}

/** Per-product metadata from `api.gog.com/products`. We always
 *  prefer `boxArtImage` and fall back to `backgroundImage`. */
export interface GogProductMeta {
  id: string;
  title: string;
  coverUrl?: string;
  images?: {
    boxArtImage?: string;
    backgroundImage?: string;
    logo?: string;
    icon?: string;
  };
  /** Install size as reported by the API (MB). */
  sizeMb?: number;
  /** Release date as Unix seconds. */
  releaseDate?: number;
  developer?: string;
  publisher?: string;
  description?: string;
  genres?: string[];
  storeUrl?: string;
}

/** Single synced game entry — what the React side receives via
 *  `invoke("gog_sync_library")` and feeds into `addGames(...)`. */
export interface GogSyncedGame {
  id: string;
  title: string;
  /** GOG numeric product id (e.g. `"1207658925"`). */
  gogGameId: string;
  isInstalled: boolean;
  /** Absolute path to the resolved launchable executable,
   *  `undefined` when the game is owned-but-not-installed. */
  installPath?: string;
  installDir?: string;
  /** Playtime in MINUTES — frontend multiplies by 60 to render
   *  against the Steam-style `playtimeForever` formatting. */
  playtimeMinutes?: number;
  /** Unix SECONDS — frontend converts to ms (×1000) to match the
   *  project-wide `lastPlayed` convention. */
  lastPlayed?: number;
  /** Cover image URL on GOG's CDN. */
  coverUrl?: string;
  /** Install-dir size in bytes (measured when isInstalled). */
  sizeBytes?: number;
  sizeRootPath?: string;
}

/** Result of a GOG library sync. */
export interface GogSyncResult {
  success: boolean;
  gamesImported: number;
  gamesSkipped: number;
  errors: string[];
  /** Unix seconds of when the sync completed. */
  lastSync: number;
  syncedGames: GogSyncedGame[];
}
