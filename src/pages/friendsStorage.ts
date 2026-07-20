import { invoke } from "@tauri-apps/api/core";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { SimplePool } from "nostr-tools/pool";

const nostrPoolForPreview = new SimplePool();
const nostrRelaysForPreview = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.snort.social",
  "wss://relay.primal.net"
];

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

export interface NostrKeys {
  privateKey: Uint8Array;
  privateKeyHex: string;
  publicKey: string;
}

let cachedNostrKeys: NostrKeys | null = null;

export function getNostrKeys(): NostrKeys {
  if (cachedNostrKeys) return cachedNostrKeys;
  
  let skHex: string | null = null;
  try {
    skHex = localStorage.getItem("gamelib.friends.nostr_privkey");
  } catch {
    /* ignore */
  }
  
  let sk: Uint8Array;
  if (!skHex) {
    sk = generateSecretKey();
    skHex = bytesToHex(sk);
    try {
      localStorage.setItem("gamelib.friends.nostr_privkey", skHex);
    } catch {
      /* ignore */
    }
  } else {
    sk = hexToBytes(skHex);
  }
  
  const pk = getPublicKey(sk);
  cachedNostrKeys = {
    privateKey: sk,
    privateKeyHex: skHex,
    publicKey: pk,
  };
  return cachedNostrKeys;
}

export interface UserProfile {
  name: string;
  avatar: string; // "procedural" or base64 data url
  status: string;
  favoriteGameId?: string;
  favoriteGameName?: string;
  syncId: string; // Stable device id used as the outbox subfolder name
  /** Name of the game the user is currently playing, or undefined when idle. */
  currentlyPlaying?: string;
  /** Free-text bio shown on the profile card. */
  bio?: string;
  /** Player region / country label. */
  region?: string;
  /** Unix seconds of the last time we published our outbox. */
  lastPublished?: number;
  libStats?: {
    gamesCount: number;
    playtimeMinutes: number;
    achievementsCount: number;
  };
}

/** Quick-pick status presets for the profile editor. */
export const STATUS_PRESETS: { label: string; value: string; emoji: string }[] = [
  { label: "Ready to Play", value: "Ready to Play!", emoji: "🎮" },
  { label: "In Game", value: "In a game", emoji: "🕹️" },
  { label: "Looking for Group", value: "Looking for Group (LFG)", emoji: "🔍" },
  { label: "Away", value: "Away", emoji: "💤" },
  { label: "Busy", value: "Busy — do not disturb", emoji: "⛔" },
  { label: "Offline", value: "Offline", emoji: "⚪" },
];

export interface Friend {
  id: string;
  name: string;
  avatar: string;
  status: string;
  favoriteGame?: string;
  currentlyPlaying?: string;
  libStats?: {
    gamesCount: number;
    playtimeMinutes: number;
    achievementsCount: number;
  };
  addedAt: number;
  syncId: string; // Stored from their friend code
  /** Local-only display override for the friend's name. */
  nickname?: string;
  /** Whether the friend is pinned to the top of the list. */
  pinned?: boolean;
  /** Epoch seconds of the last successful sync with this friend. */
  lastSeen?: number;
  /** Locally ignored peers — their outbox is skipped during sync. */
  blocked?: boolean;
  /** Friend's free-text bio (synced from their outbox). */
  bio?: string;
  /** Friend's region label (synced from their outbox). */
  region?: string;
  /** Per-game stats shared by the friend for truthful library comparison. */
  games?: SharedGameStat[];
}

/** Returns the display name, preferring a local nickname override. */
export function displayName(friend: Friend): string {
  return friend.nickname?.trim() || friend.name;
}

export type RsvpStatus = "going" | "maybe" | "declined";

/** Roles a participant can hold in a session. */
export type SessionRole = "host" | "cohost" | "player";

/** A participant can be a friend (named) or a +1 guest (no friend record). */
export interface SessionParticipant {
  /** Display name. For friends this matches their profile name. */
  name: string;
  /** Role in the session. */
  role: SessionRole;
  /** Free-text "what I'm bringing" note attached to the RSVP. */
  note?: string;
  /** IANA timezone used to display this attendee's local time, if known. */
  timezone?: string;
  /** True for non-friend +1 guests. */
  guest?: boolean;
}

export interface SessionMessage {
  id: string;
  author: string;
  text: string;
  timestamp: number;
  /** Pinned messages show at the top of the chat thread. */
  pinned?: boolean;
}

export interface GameSession {
  id: string;
  gameId: string;
  gameName: string;
  scheduledAt: string; // YYYY-MM-DDTHH:mm format (creator's local time)
  maxPlayers: number;
  description: string;
  creatorName: string;
  attendees: string[]; // names of people attending ("going")
  /** Per-name RSVP status map (extends beyond `attendees`). */
  rsvps?: Record<string, RsvpStatus>;
  updatedAt: number; // Unix timestamp for merging
  deleted?: boolean; // Tombstone for sync deletion

  /** IANA timezone of the creator when the session was scheduled. */
  creatorTimezone?: string;
  /** Explicit invitee list (names). Empty = broadcast to all friends. */
  invited?: string[];
  /** Rich participant metadata (roles, notes, guest flag, tz). */
  participants?: SessionParticipant[];
  /** Shared session chat / pinned messages. */
  messages?: SessionMessage[];
  /** Duration in minutes, for countdown + agenda display. */
  durationMin?: number;
}

export interface RecommendationComment {
  id: string;
  authorName: string;
  text: string;
  timestamp: number;
}

export type ReactionKind = "like" | "love" | "play";

export interface GameRecommendation {
  id: string;
  gameId: string;
  gameName: string;
  recommendedBy: string; // Name of recommender
  recommendedTo: string; // Name of friend, or "All Friends"
  reason: string;
  rating: number; // 1 to 5 stars
  comments: RecommendationComment[];
  /** Per-author reaction map (authorName -> reaction kind). */
  reactions?: Record<string, ReactionKind>;
  /** True when the current user wants to try this game (personal backlog). */
  wantToPlay?: boolean;
  createdAt: number;
  updatedAt: number; // Unix timestamp for merging
  deleted?: boolean; // Tombstone for sync deletion
}

/** Lightweight per-game stat shared in the outbox so friends can compare libraries truthfully. */
export interface SharedGameStat {
  id: string;
  name: string;
  playTimeMin: number;
  achievementPercent: number;
  genres: string[];
}

/**
 * A "Game Suggestion" — a game the user shares from their personal Wishlist
 * tab with friends, optionally with a note about why it's worth playing.
 * Friends can react (emoji-style) and leave threaded comments, mirroring the
 * Recommendation feed but rooted in the user's own wishlist.
 */
export interface SuggestionComment {
  id: string;
  authorName: string;
  text: string;
  timestamp: number;
}

export type SuggestionReactionKind = "like" | "love" | "interest" | "played";

export interface GameSuggestion {
  id: string;
  /** Wishlist entry slug/IGDB id used as the source of truth. */
  gameId: string;
  gameName: string;
  /** Optional cover art url pulled from the wishlist entry, for richer cards. */
  coverUrl?: string;
  /** Free-text note explaining why the game was shared. */
  note: string;
  /** Person who shared it from their wishlist. */
  suggestedBy: string;
  /** Target friend name, or "All Friends" for a broadcast. */
  suggestedTo: string;
  comments: SuggestionComment[];
  /** Per-author reaction map (authorName -> reaction kind). */
  reactions?: Record<string, SuggestionReactionKind>;
  /** True when the current viewer has added this game to their own wishlist. */
  addedToWishlist?: boolean;
  createdAt: number;
  updatedAt: number; // Unix timestamp for merging
  deleted?: boolean; // Tombstone for sync deletion
}

// Keys namespaced per active profile name (A, B, C)
const LS_PROFILE_PREFIX = "gamelib.friends.profile.";
const LS_FRIENDS_PREFIX = "gamelib.friends.list.";
const LS_SESSIONS_PREFIX = "gamelib.friends.sessions.";
const LS_RECOMMENDATIONS_PREFIX = "gamelib.friends.recommendations.";
const LS_SUGGESTIONS_PREFIX = "gamelib.friends.suggestions.";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore storage errors */
  }
}

// Window-isolated profile helper using sessionStorage
export function getActiveProfileName(): string {
  try {
    return sessionStorage.getItem("gamelib.friends.activeProfile") || "A";
  } catch {
    return "A";
  }
}

export function setActiveProfileName(name: string): void {
  try {
    sessionStorage.setItem("gamelib.friends.activeProfile", name);
  } catch {
    /* ignore */
  }
}

export function loadUserProfile(): UserProfile {
  const profileName = getActiveProfileName();
  const profile = readJson<Partial<UserProfile>>(`${LS_PROFILE_PREFIX}${profileName}`, {});
  
  // Fill in default values
  const name = profile.name || `Gamer ${profileName}`;
  const avatar = profile.avatar || "procedural";
  const status = profile.status || "Ready to Play!";
  const favoriteGameId = profile.favoriteGameId || "";
  const favoriteGameName = profile.favoriteGameName || "";
  const currentlyPlaying = profile.currentlyPlaying || undefined;
  const bio = profile.bio || "";
  const region = profile.region || "";

  // Nostr public key is our syncId
  const keys = getNostrKeys();
  const syncId = keys.publicKey;

  // Write key if newly generated
  const updated = { name, avatar, status, favoriteGameId, favoriteGameName, syncId, currentlyPlaying, bio, region };
  if (!profile.syncId || profile.syncId !== syncId) {
    writeJson(`${LS_PROFILE_PREFIX}${profileName}`, updated);
  }
  return updated;
}

/**
 * Reads the stable device id generated by the backend. The backend persists
 * it, so it never changes between runs — which is what makes the shared-folder
 * outbox subfolder name stable and discoverable by friends.
 */
let cachedDeviceId: string | null = null;
export function getDeviceId(): string | null {
  if (cachedDeviceId) return cachedDeviceId;
  try {
    const v = localStorage.getItem("gamelib.friends.deviceId");
    if (v) {
      cachedDeviceId = v;
      return v;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function setDeviceId(id: string): void {
  cachedDeviceId = id;
  try {
    localStorage.setItem("gamelib.friends.deviceId", id);
  } catch {
    /* ignore */
  }
}

// ── Shared Sync Folder Helpers ───────────────────────────────────────

export interface FriendsDatabase {
  profile: UserProfile | null;
  friends: Friend[];
  sessions: GameSession[];
  recommendations: GameRecommendation[];
  suggestions: GameSuggestion[];
}

export async function loadFriendsDb(): Promise<FriendsDatabase> {
  try {
    const raw = await invoke<string>("load_friends_db");
    return JSON.parse(raw);
  } catch (err) {
    console.error("Failed to load friends database:", err);
    return { profile: null, friends: [], sessions: [], recommendations: [], suggestions: [] };
  }
}

export async function saveFriendsDb(db: FriendsDatabase): Promise<void> {
  try {
    await invoke("save_friends_db", { content: JSON.stringify(db) });
  } catch (err) {
    console.error("Failed to save friends database:", err);
  }
}

export async function persistLocalStorageToDisk(): Promise<void> {
  const profile = loadUserProfile();
  const friends = loadFriends();
  const sessions = loadSessions();
  const recommendations = loadRecommendations();
  const suggestions = loadSuggestions();
  await saveFriendsDb({ profile, friends, sessions, recommendations, suggestions });
}

export async function loadFriendsDbToLocalStorage(): Promise<boolean> {
  try {
    const db = await loadFriendsDb();
    const profileName = getActiveProfileName();
    if (db.profile) {
      writeJson(`${LS_PROFILE_PREFIX}${profileName}`, db.profile);
    }
    if (db.friends) {
      writeJson(`${LS_FRIENDS_PREFIX}${profileName}`, db.friends);
    }
    if (db.sessions) {
      writeJson(`${LS_SESSIONS_PREFIX}${profileName}`, db.sessions);
    }
    if (db.recommendations) {
      writeJson(`${LS_RECOMMENDATIONS_PREFIX}${profileName}`, db.recommendations);
    }
    if (db.suggestions) {
      writeJson(`${LS_SUGGESTIONS_PREFIX}${profileName}`, db.suggestions);
    }
    return true;
  } catch (err) {
    console.error("Failed to load friends DB to localStorage:", err);
    return false;
  }
}

export function saveUserProfile(profile: UserProfile): void {
  const profileName = getActiveProfileName();
  writeJson(`${LS_PROFILE_PREFIX}${profileName}`, profile);
  persistLocalStorageToDisk();
}

export function loadFriends(): Friend[] {
  const profileName = getActiveProfileName();
  return readJson<Friend[]>(`${LS_FRIENDS_PREFIX}${profileName}`, []);
}

export function saveFriends(friends: Friend[]): void {
  const profileName = getActiveProfileName();
  writeJson(`${LS_FRIENDS_PREFIX}${profileName}`, friends);
  persistLocalStorageToDisk();
}

export function loadSessions(): GameSession[] {
  const profileName = getActiveProfileName();
  return readJson<GameSession[]>(`${LS_SESSIONS_PREFIX}${profileName}`, []);
}

export function saveSessions(sessions: GameSession[]): void {
  const profileName = getActiveProfileName();
  writeJson(`${LS_SESSIONS_PREFIX}${profileName}`, sessions);
  persistLocalStorageToDisk();
}

export function loadRecommendations(): GameRecommendation[] {
  const profileName = getActiveProfileName();
  return readJson<GameRecommendation[]>(`${LS_RECOMMENDATIONS_PREFIX}${profileName}`, []);
}

export function saveRecommendations(recs: GameRecommendation[]): void {
  const profileName = getActiveProfileName();
  writeJson(`${LS_RECOMMENDATIONS_PREFIX}${profileName}`, recs);
  persistLocalStorageToDisk();
}

export function loadSuggestions(): GameSuggestion[] {
  const profileName = getActiveProfileName();
  return readJson<GameSuggestion[]>(`${LS_SUGGESTIONS_PREFIX}${profileName}`, []);
}

export function saveSuggestions(suggestions: GameSuggestion[]): void {
  const profileName = getActiveProfileName();
  writeJson(`${LS_SUGGESTIONS_PREFIX}${profileName}`, suggestions);
  persistLocalStorageToDisk();
}

/**
 * Procedural avatar gradient generator based on string hashing.
 */
export function getProceduralAvatarStyle(name: string): { background: string; color: string } {
  const cleanName = name.trim() || "User";
  let hash = 0;
  for (let i = 0; i < cleanName.length; i++) {
    hash = cleanName.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  const hue = Math.abs(hash) % 360;
  const hue2 = (hue + 130) % 360;
  
  return {
    background: `linear-gradient(135deg, hsl(${hue}, 70%, 42%), hsl(${hue2}, 75%, 32%))`,
    color: "#ffffff",
  };
}

/**
 * Returns initials (1 or 2 characters) for any username.
 */
export function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "GG";
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

/**
 * Encodes a user's profile and dynamic statistics into a shareable Base64 friend code.
 */
export function encodeFriendCode(
  profile: UserProfile,
  _stats?: { gamesCount: number; playtimeMinutes: number; achievementsCount: number },
  _favoriteGameName?: string
): string {
  return profile.syncId;
}

/**
 * Decodes a shareable friend code back into a Friend object.
 */
export function decodeFriendCode(code: string): Friend | null {
  try {
    const trimmed = code.trim();
    if (!trimmed) return null;
    
    let syncId = trimmed;
    if (trimmed.startsWith("GMLF-")) {
      const remaining = trimmed.substring(5);
      if (remaining.startsWith("device_")) {
        syncId = remaining;
      } else {
        // Decode old Base64 format for backward compatibility
        try {
          const binary = atob(remaining);
          const jsonStr = decodeURIComponent(
            Array.prototype.map
              .call(binary, (c: string) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
              .join("")
          );
          const data = JSON.parse(jsonStr);
          if (data.sy) {
            syncId = data.sy;
          }
        } catch {
          syncId = remaining;
        }
      }
    }
    
    const isNostrPubkey = /^[0-9a-fA-F]{64}$/.test(syncId);
    const isLegacySyncId = syncId.startsWith("device_");
    if (!isNostrPubkey && !isLegacySyncId) {
      return null;
    }
    
    return {
      id: `friend_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: "Gamer Syncing...",
      avatar: "procedural",
      status: "Offline",
      addedAt: Date.now(),
      syncId: syncId,
    };
  } catch {
    return null;
  }
}

// ── P2P CRDT Merge Logic ──────────────────────────────────────────

/**
 * Merge local sessions with remote friend sessions.
 * Keep the latest version of sessions, combine attendees, and respect deletion tombstones.
 */
export function mergeSessions(local: GameSession[], remote: GameSession[]): GameSession[] {
  const mergedMap = new Map<string, GameSession>();
  
  local.forEach((s) => mergedMap.set(s.id, s));
  
  remote.forEach((remoteSession) => {
    const localSession = mergedMap.get(remoteSession.id);
    if (!localSession) {
      mergedMap.set(remoteSession.id, remoteSession);
    } else {
      const keepRemote = remoteSession.updatedAt > localSession.updatedAt;
      
      const creatorName = keepRemote ? remoteSession.creatorName : localSession.creatorName;
      const gameId = keepRemote ? remoteSession.gameId : localSession.gameId;
      const gameName = keepRemote ? remoteSession.gameName : localSession.gameName;
      const scheduledAt = keepRemote ? remoteSession.scheduledAt : localSession.scheduledAt;
      const maxPlayers = keepRemote ? remoteSession.maxPlayers : localSession.maxPlayers;
      const description = keepRemote ? remoteSession.description : localSession.description;
      const deleted = localSession.deleted || remoteSession.deleted || false;
      const updatedAt = Math.max(localSession.updatedAt, remoteSession.updatedAt);

      // Merge RSVP maps key-by-key; remote wins per key when its session is newer.
      const rsvpMap: Record<string, RsvpStatus> = { ...(localSession.rsvps || {}) };
      if (remoteSession.rsvps) {
        for (const [name, status] of Object.entries(remoteSession.rsvps)) {
          if (keepRemote || rsvpMap[name] === undefined) {
            rsvpMap[name] = status;
          }
        }
      }
      // Attendees list should reflect "going" RSVPs for backward compatibility.
      const attendees =
        keepRemote
          ? Array.from(new Set([...remoteSession.attendees, ...Object.keys(rsvpMap).filter((n) => rsvpMap[n] === "going")]))
          : Array.from(new Set([...localSession.attendees, ...Object.keys(rsvpMap).filter((n) => rsvpMap[n] === "going")]));

      // Merge the rich participant metadata (roles, notes, guest flag, tz).
      const participantsMap = new Map<string, SessionParticipant>();
      (keepRemote ? remoteSession.participants || [] : localSession.participants || []).forEach((p) =>
        participantsMap.set(p.name, { ...p })
      );
      (keepRemote ? localSession.participants || [] : remoteSession.participants || []).forEach((p) => {
        if (!participantsMap.has(p.name)) participantsMap.set(p.name, { ...p });
      });

      // Merge the chat thread; remote message wins on timestamp tie-break.
      const messagesMap = new Map<string, SessionMessage>();
      [...(localSession.messages || []), ...(remoteSession.messages || [])].forEach((m) => {
        const existing = messagesMap.get(m.id);
        if (!existing || m.timestamp >= existing.timestamp) messagesMap.set(m.id, m);
      });
      const messages = Array.from(messagesMap.values()).sort((a, b) => a.timestamp - b.timestamp);

      const invited = keepRemote
        ? remoteSession.invited || localSession.invited || []
        : Array.from(new Set([...(localSession.invited || []), ...(remoteSession.invited || [])]));

      mergedMap.set(remoteSession.id, {
        id: localSession.id,
        gameId,
        gameName,
        scheduledAt,
        maxPlayers,
        description,
        creatorName,
        attendees,
        rsvps: rsvpMap,
        updatedAt,
        deleted,
        creatorTimezone: remoteSession.creatorTimezone || localSession.creatorTimezone,
        invited,
        participants: Array.from(participantsMap.values()),
        messages,
        durationMin: remoteSession.durationMin ?? localSession.durationMin,
      });
    }
  });

  return Array.from(mergedMap.values());
}

export function mergeRecommendations(local: GameRecommendation[], remote: GameRecommendation[]): GameRecommendation[] {
  const mergedMap = new Map<string, GameRecommendation>();
  
  local.forEach((r) => mergedMap.set(r.id, r));
  
  remote.forEach((remoteRec) => {
    const localRec = mergedMap.get(remoteRec.id);
    if (!localRec) {
      mergedMap.set(remoteRec.id, remoteRec);
    } else {
      const keepRemote = remoteRec.updatedAt > localRec.updatedAt;
      
      const gameId = keepRemote ? remoteRec.gameId : localRec.gameId;
      const gameName = keepRemote ? remoteRec.gameName : localRec.gameName;
      const recommendedBy = keepRemote ? remoteRec.recommendedBy : localRec.recommendedBy;
      const recommendedTo = keepRemote ? remoteRec.recommendedTo : localRec.recommendedTo;
      const reason = keepRemote ? remoteRec.reason : localRec.reason;
      const rating = keepRemote ? remoteRec.rating : localRec.rating;
      const deleted = localRec.deleted || remoteRec.deleted || false;
      const createdAt = Math.min(localRec.createdAt, remoteRec.createdAt);
      const updatedAt = Math.max(localRec.updatedAt, remoteRec.updatedAt);
 
      // Merge reactions key-by-key: union of author keys, remote wins per key
      // when its rec is newer (and thus more likely authoritative).
      const reactionMap: Record<string, ReactionKind> = { ...(localRec.reactions || {}) };
      if (remoteRec.reactions) {
        for (const [author, kind] of Object.entries(remoteRec.reactions)) {
          if (keepRemote || reactionMap[author] === undefined) {
            reactionMap[author] = kind;
          }
        }
      }
 
      const commentMap = new Map<string, any>();
      localRec.comments.forEach((c) => commentMap.set(c.id, c));
      remoteRec.comments.forEach((c) => commentMap.set(c.id, c));
 
      const comments = Array.from(commentMap.values()).sort((a, b) => a.timestamp - b.timestamp);
 
      mergedMap.set(remoteRec.id, {
        id: localRec.id,
        gameId,
        gameName,
        recommendedBy,
        recommendedTo,
        reason,
        rating,
        reactions: reactionMap,
        wantToPlay: keepRemote ? remoteRec.wantToPlay ?? localRec.wantToPlay : localRec.wantToPlay ?? remoteRec.wantToPlay,
        comments,
        createdAt,
        updatedAt,
        deleted,
      });
    }
  });
 
  return Array.from(mergedMap.values());
}

/**
 * Merge local wishlist-derived game suggestions with a friend's. Follows the
 * same "freshest update wins" + tombstone + union-of-reactions/comments rules
 * as `mergeRecommendations`.
 */
export function mergeSuggestions(local: GameSuggestion[], remote: GameSuggestion[]): GameSuggestion[] {
  const mergedMap = new Map<string, GameSuggestion>();

  local.forEach((s) => mergedMap.set(s.id, s));

  remote.forEach((remoteSug) => {
    const localSug = mergedMap.get(remoteSug.id);
    if (!localSug) {
      mergedMap.set(remoteSug.id, remoteSug);
      return;
    }

    const keepRemote = remoteSug.updatedAt > localSug.updatedAt;

    const gameId = keepRemote ? remoteSug.gameId : localSug.gameId;
    const gameName = keepRemote ? remoteSug.gameName : localSug.gameName;
    const coverUrl = keepRemote ? remoteSug.coverUrl ?? localSug.coverUrl : localSug.coverUrl ?? remoteSug.coverUrl;
    const note = keepRemote ? remoteSug.note : localSug.note;
    const suggestedBy = keepRemote ? remoteSug.suggestedBy : localSug.suggestedBy;
    const suggestedTo = keepRemote ? remoteSug.suggestedTo : localSug.suggestedTo;
    const deleted = localSug.deleted || remoteSug.deleted || false;
    const createdAt = Math.min(localSug.createdAt, remoteSug.createdAt);
    const updatedAt = Math.max(localSug.updatedAt, remoteSug.updatedAt);

    const reactionMap: Record<string, SuggestionReactionKind> = { ...(localSug.reactions || {}) };
    if (remoteSug.reactions) {
      for (const [author, kind] of Object.entries(remoteSug.reactions)) {
        if (keepRemote || reactionMap[author] === undefined) {
          reactionMap[author] = kind;
        }
      }
    }

    const commentMap = new Map<string, SuggestionComment>();
    localSug.comments.forEach((c) => commentMap.set(c.id, c));
    remoteSug.comments.forEach((c) => commentMap.set(c.id, c));

    const comments = Array.from(commentMap.values()).sort((a, b) => a.timestamp - b.timestamp);

    mergedMap.set(remoteSug.id, {
      id: localSug.id,
      gameId,
      gameName,
      coverUrl,
      note,
      suggestedBy,
      suggestedTo,
      reactions: reactionMap,
      addedToWishlist: keepRemote ? remoteSug.addedToWishlist ?? localSug.addedToWishlist : localSug.addedToWishlist ?? remoteSug.addedToWishlist,
      comments,
      createdAt,
      updatedAt,
      deleted,
    });
  });

  return Array.from(mergedMap.values());
}

//
// Each client publishes its outbox into `<appData>/sync/<myDeviceId>/`
// and reads a friend's outbox from `<appData>/sync/<friendDeviceId>/`.
// The sync folder is fixed next to the databases, so a local and a
// remote client that share that data folder exchange data through the
// same files — no server, no extra software.

export interface SyncResult {
  ok: boolean;
  reason?: string;
}

/**
 * Publishes local social items and current player statistics to our outbox
 * subfolder in the fixed sync directory. Returns success + a human reason.
 */
export async function pushMyOutbox(
  profile: UserProfile,
  stats: { gamesCount: number; playtimeMinutes: number; achievementsCount: number },
  sessions: GameSession[],
  recs: GameRecommendation[],
  sharedGames?: SharedGameStat[],
  suggestions?: GameSuggestion[]
): Promise<SyncResult> {
  const localFriends = loadFriends();
  const payload = {
    syncId: profile.syncId,
    profile: {
      name: profile.name,
      avatar: profile.avatar,
      status: profile.status,
      favoriteGame: profile.favoriteGameName || "",
      currentlyPlaying: profile.currentlyPlaying || "",
      bio: profile.bio || "",
      region: profile.region || "",
      libStats: stats,
    },
    friends: localFriends.map((f) => f.syncId),
    games: sharedGames || [],
    sessions,
    recommendations: recs,
    suggestions: suggestions || [],
    updatedAt: Date.now(),
  };

  try {
    await invoke("write_sync_file", {
      content: JSON.stringify(payload),
    });
    return { ok: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("Failed to write local sync outbox file:", reason);
    return { ok: false, reason };
  }
}

/**
 * Pulls a friend's outbox content from the fixed sync directory.
 * `friendSyncId` is the friend's stable device id (their outbox subfolder).
 */
export async function fetchFriendOutbox(friendSyncId: string): Promise<{
  syncId: string;
  profile: {
    name: string;
    avatar: string;
    status: string;
    favoriteGame: string;
    currentlyPlaying?: string;
    bio?: string;
    region?: string;
    libStats: {
      gamesCount: number;
      playtimeMinutes: number;
      achievementsCount: number;
    };
  };
  friends?: string[];
  games?: SharedGameStat[];
  sessions: GameSession[];
  recommendations: GameRecommendation[];
  suggestions: GameSuggestion[];
} | null> {
  if (!friendSyncId) return null;

  // 1. Try local file sync first
  try {
    const raw = await invoke<string | null>("read_sync_file", {
      peerId: friendSyncId,
    });
    if (raw) return JSON.parse(raw);
  } catch (err) {
    // Ignore local folder read failure, fallback to Nostr
  }

  // 2. Try Nostr relays
  if (/^[0-9a-fA-F]{64}$/.test(friendSyncId)) {
    try {
      console.log(`Nostr: fetching outbox preview for ${friendSyncId} from relays...`);
      const event = await nostrPoolForPreview.get(nostrRelaysForPreview, {
        authors: [friendSyncId],
        kinds: [30078],
        "#d": ["gamelib-friends-outbox"],
      });
      if (event) {
        console.log(`Nostr: successfully fetched outbox preview for ${friendSyncId}`);
        return JSON.parse(event.content);
      }
    } catch (err) {
      console.error(`Nostr: failed to fetch preview event for ${friendSyncId}:`, err);
    }
  }

  return null;
}

/**
 * Discover peer device ids that have published an outbox in the sync
 * directory. Used to auto-populate friends without manual friend-code
 * exchange (as long as both clients share the same data folder).
 */
export async function listPeerOutboxes(): Promise<string[]> {
  try {
    return await invoke<string[]>("list_friend_outboxes");
  } catch (err) {
    console.error("Failed to list peer outboxes:", err);
    return [];
  }
}

/**
 * Returns the fixed sync directory path (next to the databases). The UI
 * shows this so the user knows where shared files are written.
 */
export async function getSyncFolder(): Promise<string | null> {
  try {
    return await invoke<string | null>("get_friends_sync_dir");
  } catch (err) {
    console.error("Failed to get sync folder:", err);
    return null;
  }
}

// ── Community tab notification badge ──────────────────────────────
// Counts "new" social items (sessions / recommendations / suggestions)
// pulled from friends during sync that the user hasn't seen yet. Surfaces
// as a number badge on the Community tab in the top navigation and is
// cleared when the user opens that tab.

const LS_UNSEEN_COMMUNITY = "gamelib.friends.unseen_community_items";

/** Broadcast channel so the nav badge updates instantly across components. */
const communityBadgeListeners = new Set<(count: number) => void>();

function readUnseenCommunity(): number {
  const n = Number(localStorage.getItem(LS_UNSEEN_COMMUNITY));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function writeUnseenCommunity(count: number): void {
  const clamped = Math.max(0, Math.floor(count));
  try {
    localStorage.setItem(LS_UNSEEN_COMMUNITY, String(clamped));
  } catch {
    /* ignore */
  }
  communityBadgeListeners.forEach((cb) => cb(clamped));
}

/** Current number of unseen community items. */
export function getUnseenCommunityItems(): number {
  return readUnseenCommunity();
}

/** Add `delta` newly-discovered community items to the unseen count. */
export function addUnseenCommunityItems(delta: number): void {
  if (!Number.isFinite(delta) || delta <= 0) return;
  writeUnseenCommunity(readUnseenCommunity() + delta);
}

/** Reset the unseen count to zero (called when the Community tab is opened). */
export function clearUnseenCommunityItems(): void {
  if (readUnseenCommunity() === 0) return;
  writeUnseenCommunity(0);
}

/** Subscribe to unseen-count changes; returns an unsubscribe function. */
export function subscribeUnseenCommunity(cb: (count: number) => void): () => void {
  communityBadgeListeners.add(cb);
  return () => communityBadgeListeners.delete(cb);
}

/**
 * Merges local database with a remote database received from P2P sync.
 */
export function mergeDatabases(local: FriendsDatabase, remote: FriendsDatabase): FriendsDatabase {
  const mergedFriendsMap = new Map<string, Friend>();
  local.friends.forEach((f) => mergedFriendsMap.set(f.syncId, f));
  
  if (remote.friends) {
    remote.friends.forEach((remoteFriend) => {
      // Do not process if it matches the local user's own profile syncId (to prevent own-profile addition)
      if (local.profile && remoteFriend.syncId === local.profile.syncId) {
        return;
      }

      const localFriend = mergedFriendsMap.get(remoteFriend.syncId);
      if (localFriend) {
        // Only update existing friends in our list
        mergedFriendsMap.set(remoteFriend.syncId, {
          ...localFriend,
          name: remoteFriend.name || localFriend.name,
          avatar: remoteFriend.avatar || localFriend.avatar,
          status: remoteFriend.status || localFriend.status,
          favoriteGame: remoteFriend.favoriteGame || localFriend.favoriteGame,
          currentlyPlaying: remoteFriend.currentlyPlaying ?? localFriend.currentlyPlaying,
          bio: remoteFriend.bio || localFriend.bio,
          region: remoteFriend.region || localFriend.region,
          libStats: remoteFriend.libStats || localFriend.libStats,
          games: remoteFriend.games || localFriend.games,
        });
      }
    });
  }

  // NOTE: Friends are added manually or approved mutually via invitations.
  // We intentionally do NOT auto-add remote friends we haven't accepted.

  const mergedFriends = Array.from(mergedFriendsMap.values());
  const mergedSessions = mergeSessions(local.sessions || [], remote.sessions || []);
  const mergedRecommendations = mergeRecommendations(local.recommendations || [], remote.recommendations || []);
  const mergedSuggestions = mergeSuggestions(local.suggestions || [], remote.suggestions || []);

  return {
    profile: local.profile,
    friends: mergedFriends,
    sessions: mergedSessions,
    recommendations: mergedRecommendations,
    suggestions: mergedSuggestions,
  };
}
