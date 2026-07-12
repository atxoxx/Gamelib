export interface SteamSession {
  /** 64-bit Steam ID (SteamID64) of the user the API key belongs to. */
  steamId: string;
  /** Steam Web API key — obtained from https://steamcommunity.com/dev/apikey.
   *  Passed as the `key=` query parameter to all Steam Web API calls. The key
   *  is tied to a Steam account registration and does not expire until the
   *  owner revokes it from the dev/apikey page. */
  apiKey: string;
  /** Display name pulled from ISteamUser/GetPlayerSummaries at connect time. */
  displayName?: string;
}

export interface SteamLoginResult {
  session: SteamSession;
}

/** Auth state for the Settings UI. */
export interface SteamAuthState {
  isAuthenticated: boolean;
  session?: SteamSession;
  lastSync?: number;
}

export interface SteamGame {
  appid: number;
  name: string;
  /** Total playtime in minutes */
  playtimeForever: number;
  /** Windows-specific playtime in minutes */
  playtimeWindowsForever: number;
  /** Whether the game has publicly visible stats (achievements) */
  hasCommunityVisibleStats: boolean;
  /** Unix timestamp of last played */
  rtimeLastPlayed?: number;
}

export interface SteamSyncResult {
  success: boolean;
  gamesSynced: number;
  playtimeUpdated: number;
  achievementsSynced: number;
  error?: string;
  /** Mapped game entries ready to be added to the library */
  syncedGames: SyncedGameEntry[];
  /** Steam AppIDs that are currently installed on disk */
  installedAppids: number[];
}

export interface SyncedGameEntry {
  appid: number;
  name: string;
  playtimeForever: number;
  /** Resolved path to the main game executable (if installed locally) */
  exePath?: string;
  /** Total disk footprint of the install dir, measured by the Rust
   *  sync flow right after `resolve_main_exe` returns. `undefined`
   *  when the game is uninstalled, exe resolution failed, or the
   *  disk walk errored out. */
  sizeBytes?: number;
  /** Folder the size was measured against (= parent of `exePath`).
   *  Auditable from the Storage tab so users can re-link if the
   *  default install dir is wrong. */
  sizeRootPath?: string;
  /** Unix timestamp (seconds) of the last Steam play session. The
   *  frontend converts this to milliseconds for `Game.lastPlayed`. */
  rtimeLastPlayed?: number;
}

export interface SteamSettings {
  autoSyncOnLaunch: boolean;
  syncPlaytime: boolean;
  syncAchievements: boolean;
  /**
   * DEPRECATED (kept for backward-compat reads of older localStorage blobs).
   */
  autoFetchMetadata?: boolean;
}

/** localStorage key for Steam settings */
export const STEAM_SETTINGS_KEY = "gamelib-steam-settings";
