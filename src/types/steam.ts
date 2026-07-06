export interface SteamSession {
  /** 64-bit Steam ID extracted from the store page HTML */
  steamId: string;
  /** Web API access token extracted from the store page HTML.
   *  Passed as `access_token` to Steam Web API calls. */
  webApiToken: string;
  /** Display name from profile (if available) */
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
