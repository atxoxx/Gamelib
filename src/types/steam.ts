export interface SteamApiConfig {
  /** Steam Web API key from https://steamcommunity.com/dev/apikey */
  apiKey: string;
  /** 64-bit Steam ID (e.g. 76561198123456789) */
  steamId: string;
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
   * DEPRECATED (kept for backward-compat reads of older localStorage blobs):
   * previously this gated a sequential IGDB metadata pass during Steam sync,
   * but that approach was wasteful for 500+ game libraries. We now run
   * Steam sync lightweight (Steam CDN image URLs only, no IGDB calls) and
   * lazily enrich metadata when the user opens a game's GamePage. Defaults
   * to `true` here only so legacy settings JSON parses without errors.
   */
  autoFetchMetadata?: boolean;
}

/** localStorage key for Steam settings */
export const STEAM_SETTINGS_KEY = "gamelib-steam-settings";
