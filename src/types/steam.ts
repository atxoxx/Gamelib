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
}

export interface SteamSettings {
  autoSyncOnLaunch: boolean;
  syncPlaytime: boolean;
  syncAchievements: boolean;
  /**
   * Auto-fetch IGDB metadata for each newly synced game that lacks a
   * description. When true, SettingsPage passes a flag to GameContext.addGames
   * which runs the fetches SEQUENTIALLY (one game at a time) to stay under
   * IGDB's 4 req/s free-tier cap. The existing backend `igdb_acquire`
   * rate-limiter is the last line of defense.
   *
   * For a 500-game library this can take several minutes; users on slow
   * connections or who only care about launching may opt out.
   */
  autoFetchMetadata: boolean;
}

/** localStorage key for Steam settings */
export const STEAM_SETTINGS_KEY = "gamelib-steam-settings";
