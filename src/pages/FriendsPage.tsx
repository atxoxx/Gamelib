import { useState, useMemo, useEffect, useRef } from "react";
import { useGames } from "../context/GameContext";
import { useAchievements } from "../context/AchievementContext";
import { useToast } from "../context/ToastContext";
import { parsePlayTime } from "../types/game";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import QRCode from "qrcode";
import {
  UserProfile,
  Friend,
  GameSession,
  GameRecommendation,
  displayName,
  STATUS_PRESETS,
  SharedGameStat,
  ReactionKind,
  RsvpStatus,
  getActiveProfileName,
  setActiveProfileName,
  loadUserProfile,
  saveUserProfile,
  loadFriends,
  saveFriends,
  loadSessions,
  saveSessions,
  loadRecommendations,
  saveRecommendations,
  encodeFriendCode,
  decodeFriendCode,
  getProceduralAvatarStyle,
  getInitials,
  mergeSessions,
  mergeRecommendations,
  setDeviceId,
  getSyncFolder,
  fetchFriendOutbox,
  pushMyOutbox,
  loadFriendsDbToLocalStorage,
  FriendsDatabase,
  mergeDatabases,
} from "./friendsStorage";
import "./friends.css";

// SVG Icons
function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

// User Profile Icon
function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

// Calendar Icon
function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

// Recommend Icon
function RecommendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
    </svg>
  );
}

// Compare Icon
function CompareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

// Trash Icon
function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

// Refresh Sync Icon
function RefreshIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
    </svg>
  );
}

// P2P Sync Icon
function P2pSyncIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <path d="M16 3h5v5" />
      <path d="M8 21H3v-5" />
      <path d="M12 22v-3a3 3 0 0 0-3-3H6" />
      <path d="M12 2v3a3 3 0 0 0 3 3h3" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

// Render the friend code as a scannable QR image (data URL).
function FriendCodeQR({ code }: { code: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!code) {
      setDataUrl(null);
      return;
    }
    QRCode.toDataURL(code, { margin: 1, width: 160, color: { dark: "#000000", light: "#ffffff" } })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (!dataUrl) return null;
  return <img src={dataUrl} alt="Friend code QR" className="friend-qr-img" width={160} height={160} />;
}

// Render a single session card with RSVP controls.
function renderSessionCard(
  session: GameSession,
  profile: UserProfile,
  onRsvp: (sessionId: string, status: RsvpStatus) => void,
  onDelete: (sessionId: string) => void
) {
  const isCreator = session.creatorName === profile.name;
  const myRsvp = session.rsvps?.[profile.name];
  const going = Object.entries(session.rsvps || {}).filter(([, v]) => v === "going").map(([n]) => n);
  const maybe = Object.entries(session.rsvps || {}).filter(([, v]) => v === "maybe").map(([n]) => n);
  const declined = Object.entries(session.rsvps || {}).filter(([, v]) => v === "declined").map(([n]) => n);
  const attendeeNames = going.length > 0 ? going : session.attendees;

  return (
    <div key={session.id} className="session-card">
      <div className="session-header">
        <div>
          <div className="session-game-title">{session.gameName}</div>
          <div className="session-date">{formatDateTime(session.scheduledAt)}</div>
        </div>
        <div className="session-card-actions">
          <button
            type="button"
            className="friend-delete-btn"
            style={{ opacity: 1, position: "static" }}
            onClick={() => onDelete(session.id)}
            title={isCreator ? "Remove Session" : "Remove from my list"}
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {session.description && <p className="session-desc">{session.description}</p>}

      <div className="session-attendees">
        {attendeeNames.map((name, i) => (
          <span key={i} className={`attendee-badge${name === profile.name ? " self" : ""}`}>
            {name}
          </span>
        ))}
        {maybe.map((name, i) => (
          <span key={`maybe-${i}`} className="attendee-badge maybe" title="Maybe">
            {name}?
          </span>
        ))}
        {declined.map((name, i) => (
          <span key={`dec-${i}`} className="attendee-badge declined" title="Declined">
            {name}✕
          </span>
        ))}
      </div>

      <div className="session-footer">
        <span className="session-players-count">
          👥 {going.length} / {session.maxPlayers} going
        </span>
        <span className="session-creator">By {isCreator ? "me" : session.creatorName}</span>
      </div>

      <div className="rsvp-row">
        {(["going", "maybe", "declined"] as RsvpStatus[]).map((status) => (
          <button
            key={status}
            type="button"
            className={`rsvp-btn rsvp-${status}${myRsvp === status ? " active" : ""}`}
            onClick={() => onRsvp(session.id, status)}
          >
            {status === "going" ? "✓ Going" : status === "maybe" ? "? Maybe" : "✕ Can't"}
          </button>
        ))}
      </div>
    </div>
  );
}

// Format minutes to hours beautifully
function formatHours(totalMinutes: number): string {
  if (!totalMinutes || totalMinutes <= 0) return "0h";
  const h = Math.floor(totalMinutes / 60);
  if (h >= 1000) return `${(h / 1000).toFixed(1)}k h`;
  return `${h}h`;
}

// Convert date string to user-friendly local date-time string
function formatDateTime(dateTimeStr: string): string {
  try {
    const d = new Date(dateTimeStr);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateTimeStr;
  }
}

// Human-friendly "last seen" relative string from epoch seconds
function formatLastSeen(epochSecs?: number): string {
  if (!epochSecs) return "Never";
  const diffSecs = Math.floor(Date.now() / 1000) - epochSecs;
  if (diffSecs < 60) return "Just now";
  const mins = Math.floor(diffSecs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

// "Friends for X" relative string from addedAt epoch ms
function formatFriendsSince(addedAt?: number): string {
  if (!addedAt) return "";
  const days = Math.floor((Date.now() - addedAt) / 86_400_000);
  if (days < 1) return "Friends since today";
  if (days < 30) return `Friends for ${days} day${days === 1 ? "" : "s"}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `Friends for ${months} month${months === 1 ? "" : "s"}`;
  return `Friends for ${Math.floor(months / 12)} year${months >= 24 ? "s" : ""}`;
}

// True online status derived from live `currentlyPlaying` or status text
function isOnline(friend: Friend): boolean {
  return (
    !!friend.currentlyPlaying ||
    (friend.status || "").toLowerCase().includes("online") ||
    (friend.status || "").toLowerCase().includes("playing")
  );
}

// ── Searchable Autocomplete Selector Component ──────────────────────

function SearchableGameSelector({
  games,
  selectedGameId,
  onSelect,
  placeholder = "Type game name...",
}: {
  games: any[];
  selectedGameId: string;
  onSelect: (gameId: string) => void;
  placeholder?: string;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredGames = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return games.slice(0, 10);
    return games.filter((g) => g.name.toLowerCase().includes(query));
  }, [games, searchQuery]);

  const selectedGame = useMemo(() => games.find((g) => g.id === selectedGameId), [games, selectedGameId]);

  if (selectedGame) {
    return (
      <div className="selected-game-display-card">
        <div className="selected-game-details">
          <div className="selected-game-thumb">
            {selectedGame.name.slice(0, 2).toUpperCase()}
          </div>
          <span className="selected-game-title">{selectedGame.name}</span>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ padding: "4px 10px", fontSize: "11px" }}
          onClick={() => onSelect("")}
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="searchable-game-selector" ref={containerRef}>
      <div className="game-search-input-wrapper">
        <input
          type="text"
          className="game-search-input"
          placeholder={placeholder}
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
        />
        {searchQuery && (
          <button
            type="button"
            className="game-search-clear-btn"
            onClick={() => setSearchQuery("")}
            title="Clear text"
          >
            ×
          </button>
        )}
      </div>

      {isOpen && (
        <div className="game-search-results">
          {filteredGames.length === 0 ? (
            <div className="game-search-no-results">No matches found in library</div>
          ) : (
            filteredGames.map((game) => (
              <button
                key={game.id}
                type="button"
                className="game-search-item"
                onClick={() => {
                  onSelect(game.id);
                  setSearchQuery("");
                  setIsOpen(false);
                }}
              >
                <div className="game-search-item-thumb">
                  {game.name.slice(0, 2).toUpperCase()}
                </div>
                <span className="game-search-item-name">{game.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page Component ─────────────────────────────────────────────

export default function FriendsPage() {
  const [activeTab, setActiveTab] = useState<"friends" | "sessions" | "recs" | "compare" | "profile">("friends");
  const { games, runningGameIds } = useGames();
  const { cache } = useAchievements();
  const { showToast } = useToast();

  // Multi-profile support — the storage layer namespaces all data by profile
  // name (A/B/C...). Switching reloads the scoped state from localStorage.
  const [profileName, setProfileName] = useState<string>(() => getActiveProfileName());
  const PROFILE_KEYS = ["A", "B", "C"];

  const switchProfile = (name: string) => {
    if (name === profileName) return;
    setActiveProfileName(name);
    setProfileName(name);
    setProfile(loadUserProfile());
    setFriends(loadFriends());
    setSessions(loadSessions());
    setRecommendations(loadRecommendations());
    showToast(`Switched to profile ${name}.`, "info");
  };

  // Load state (scoped by active profile)
  const [profile, setProfile] = useState<UserProfile>(() => loadUserProfile());
  const [friends, setFriends] = useState<Friend[]>(() => loadFriends());
  const [sessions, setSessions] = useState<GameSession[]>(() => loadSessions());
  const [recommendations, setRecommendations] = useState<GameRecommendation[]>(() => loadRecommendations());

  // Network Sync States
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedTime, setLastSyncedTime] = useState<string>("Never");
  // Recent sync activity log (most recent first) for the conflict/activity panel.
  const [syncLog, setSyncLog] = useState<{ time: string; message: string; details: string[] }[]>([]);

  // Direct P2P Sync States
  const [showP2pModal, setShowP2pModal] = useState(false);

  // Internet Sync Status State
  const [internetSyncStatus, setInternetSyncStatus] = useState<{
    enabled: boolean;
    boundPort?: number;
    externalIp?: string;
    upnpMapped: boolean;
    lastSyncedTimes: Record<string, number>;
    errorMessage?: string;
  } | null>(null);

  // listen to automatic internet P2P sync events
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    
    async function setupListener() {
      unlisten = await listen<string>("internet-sync-received", (event) => {
        console.log("Received internet sync database payload");
        try {
          const remoteDb = JSON.parse(event.payload) as FriendsDatabase;
          
          // Merge local and remote
          const localProfile = loadUserProfile();
          const localFriends = loadFriends();
          const localSessions = loadSessions();
          const localRecommendations = loadRecommendations();
          
          const localDb: FriendsDatabase = {
            profile: localProfile,
            friends: localFriends,
            sessions: localSessions,
            recommendations: localRecommendations,
          };
          
          const merged = mergeDatabases(localDb, remoteDb);
          
          // Save and update state
          setFriends(merged.friends);
          setSessions(merged.sessions);
          setRecommendations(merged.recommendations);
          
          saveFriends(merged.friends);
          saveSessions(merged.sessions);
          saveRecommendations(merged.recommendations);
          
          showToast(`Synced data automatically with ${remoteDb.profile?.name || "friend"}!`, "success");
        } catch (err) {
          console.error("Failed to parse/merge remote sync data:", err);
        }
      });
    }
    
    setupListener();
    
    return () => {
      if (unlisten) unlisten();
    };
  }, [profileName]);

  // Query internet sync status periodically
  useEffect(() => {
    let timer: any;
    const fetchStatus = async () => {
      try {
        const status = await invoke<any>("get_internet_sync_status");
        setInternetSyncStatus(status);
      } catch (err) {
        console.error("Failed to fetch internet sync status:", err);
      }
    };

    fetchStatus();
    timer = setInterval(fetchStatus, 5000);

    return () => {
      clearInterval(timer);
    };
  }, []);

  // Modal / Form state
  const [showAddModal, setShowAddModal] = useState(false);
  const [friendCodeInput, setFriendCodeInput] = useState("");
  const [decodedFriend, setDecodedFriend] = useState<Friend | null>(null);

  // Friends list controls (search / sort / filter)
  const [friendSearch, setFriendSearch] = useState("");
  const [friendSort, setFriendSort] = useState<"default" | "name" | "recent" | "online">("default");
  const [friendFilter, setFriendFilter] = useState<"all" | "online" | "pinned">("all");

  // Compare Tab States
  const [selectedCompareFriendId, setSelectedCompareFriendId] = useState<string>("");
  const [compareFilter, setCompareFilter] = useState<"all" | "shared" | "me_only" | "friend_only">("all");
  const [compareSort, setCompareSort] = useState<"name" | "myPlaytime" | "friendPlaytime">("name");
  const [compareGenre, setCompareGenre] = useState<string>("all");

  // Create Session Form State
  const [sessionGameId, setSessionGameId] = useState("");
  const [sessionDateTime, setSessionDateTime] = useState("");
  const [sessionMaxPlayers, setSessionMaxPlayers] = useState(4);
  const [sessionDesc, setSessionDesc] = useState("");
  // Sessions view: upcoming list, past history, or agenda grouping
  const [sessionView, setSessionView] = useState<"upcoming" | "past" | "agenda">("upcoming");

  // Create Recommendation Form State
  const [recGameId, setRecGameId] = useState("");
  const [recToFriend, setRecToFriend] = useState("All Friends");
  const [recRating, setRecRating] = useState(5);
  const [recReason, setRecReason] = useState("");
  // Recommendations feed filter
  const [recFilter, setRecFilter] = useState<"all" | "to_me" | "by_me" | "want">("all");

  // Comments Input states
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});

  // Dynamic self library stats
  const selfStats = useMemo(() => {
    const gamesCount = games.length;
    let playtimeMinutes = 0;
    games.forEach((game) => {
      if (game.playTime) {
        playtimeMinutes += parsePlayTime(game.playTime);
      }
    });

    let achievementsCount = 0;
    if (cache && cache.games) {
      Object.keys(cache.games).forEach((gameId) => {
        const achData = cache.games[gameId];
        if (achData && typeof achData.unlocked === "number") {
          achievementsCount += achData.unlocked;
        }
      });
    }

    return { gamesCount, playtimeMinutes, achievementsCount };
  }, [games, cache]);

  // Lightweight per-game snapshot published to friends for truthful comparison.
  const selfSharedGames = useMemo<SharedGameStat[]>(() => {
    return games.map((game) => {
      const achData = cache?.games?.[game.id];
      const achTotal = achData?.total || 0;
      const achUnlocked = achData?.unlocked || 0;
      const achievementPercent = achTotal > 0 ? Math.round((achUnlocked / achTotal) * 100) : 0;
      return {
        id: game.id,
        name: game.name,
        playTimeMin: parsePlayTime(game.playTime),
        achievementPercent,
        genres: (game as any).genres || [],
      };
    });
  }, [games, cache]);

  // Generate User's Friend Code
  const generatedFriendCode = useMemo(() => {
    return encodeFriendCode(profile, selfStats, profile.favoriteGameName);
  }, [profile, selfStats]);

  // Derive the game we're currently playing from the live watcher state.
  const currentlyPlaying = useMemo(() => {
    if (!runningGameIds || runningGameIds.length === 0) return undefined;
    const game = games.find((g) => g.id === runningGameIds[0]);
    return game ? game.name : undefined;
  }, [runningGameIds, games]);

  // Keep the profile's "currentlyPlaying" field in sync with the watcher so
  // it is included in the outbox and visible to friends.
  useEffect(() => {
    setProfile((prev) => {
      if (prev.currentlyPlaying === currentlyPlaying) return prev;
      const updated = { ...prev, currentlyPlaying };
      saveUserProfile(updated);
      return updated;
    });
  }, [currentlyPlaying]);

  // Handle friend code paste parsing
  useEffect(() => {
    if (!friendCodeInput.trim()) {
      setDecodedFriend(null);
      return;
    }
    const decoded = decodeFriendCode(friendCodeInput);
    setDecodedFriend(decoded);
  }, [friendCodeInput]);

  // Load local JSON database from disk, and resolve stable device ID on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 1. Initial load from local JSON file
        const loaded = await loadFriendsDbToLocalStorage();
        if (!cancelled && loaded) {
          setProfile(loadUserProfile());
          setFriends(loadFriends());
          setSessions(loadSessions());
          setRecommendations(loadRecommendations());
        }

        // 2. Resolve device ID and sync profile
        const id = await invoke<string>("get_friends_device_id");
        if (!cancelled && id) {
          setDeviceId(id);
          setProfile((prev) => {
            if (prev.syncId === id) return prev;
            const updated = { ...prev, syncId: id };
            saveUserProfile(updated);
            return updated;
          });
        }
      } catch (err) {
        console.error("Failed to initialize database or resolve device ID:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);




  // ── Sync Engine Implementation ──────────────────────────────────

  // Manual sync requests that arrive while a sync is already running are
  // queued so the user's "Sync" click is never silently dropped.
  const pendingManualSync = useRef(false);

  const performSync = async (manual = false) => {
    if (isSyncing) {
      if (manual) pendingManualSync.current = true;
      return;
    }
    setIsSyncing(true);

    // Make sure we always have a stable device id before publishing.
    if (!profile.syncId) {
      try {
        const id = await invoke<string>("get_friends_device_id");
        if (id) {
          setDeviceId(id);
          const updated = { ...profile, syncId: id };
          saveUserProfile(updated);
          setProfile(updated);
        }
      } catch {
        /* ignore */
      }
    }

    const folder = await getSyncFolder();
    if (!folder) {
      setIsSyncing(false);
      if (manual) {
        showToast("Sync folder is missing — cannot sync with friends.", "error");
      }
      return;
    }

    const localSessions = loadSessions();
    const localRecs = loadRecommendations();
    const localFriends = loadFriends();

    // NOTE: Friends are added manually via friend codes only. We intentionally
    // do NOT auto-discover peers in the shared sync folder, because that would
    // also pull in the player's own outbox (appearing as a "friend").

    let changesMade = false;
    let friendsUpdated = false;
    let pulledSessions = 0;
    let pulledRecs = 0;
    // Friends are no longer auto-discovered (added via friend codes only).
    let discoveredNew = false;
    const pullErrors: string[] = [];
    // Detailed per-friend activity for the sync log in the P2P modal.
    const friendLogs: string[] = [];

    let mergedSessions = [...localSessions];
    let mergedRecs = [...localRecs];

    // Read the outbox of each friend from the sync folder
    const updatedFriends: Friend[] = [];
    const nowSecs = Math.floor(Date.now() / 1000);
    for (const friend of localFriends) {
      const friendName = displayName(friend);
      // Skipped (blocked) peers: keep them locally but never sync their data.
      if (friend.blocked) {
        friendLogs.push(`⛔ ${friendName}: blocked — skipped`);
        updatedFriends.push(friend);
        continue;
      }
      try {
        const remoteOutbox = await fetchFriendOutbox(friend.syncId);
        if (remoteOutbox) {
          let friendSessions = 0;
          let friendRecs = 0;
          let profileChanged = false;

          // Merge sessions
          if (remoteOutbox.sessions && remoteOutbox.sessions.length > 0) {
            const prevLength = mergedSessions.length;
            mergedSessions = mergeSessions(mergedSessions, remoteOutbox.sessions);
            if (mergedSessions.length !== prevLength || JSON.stringify(mergedSessions) !== localStorage.getItem(`gamelib.friends.sessions.${profileName}`)) {
              changesMade = true;
              friendSessions = remoteOutbox.sessions.length;
              pulledSessions += friendSessions;
            }
          }

          // Merge recommendations
          if (remoteOutbox.recommendations && remoteOutbox.recommendations.length > 0) {
            const prevLength = mergedRecs.length;
            mergedRecs = mergeRecommendations(mergedRecs, remoteOutbox.recommendations);
            if (mergedRecs.length !== prevLength || JSON.stringify(mergedRecs) !== localStorage.getItem(`gamelib.friends.recommendations.${profileName}`)) {
              changesMade = true;
              friendRecs = remoteOutbox.recommendations.length;
              pulledRecs += friendRecs;
            }
          }

          // Sync friend profile information and live statistics (playtime, achievements, status)
          if (remoteOutbox.profile) {
            const remoteProfile = remoteOutbox.profile;
            const hasDiff =
              friend.name !== remoteProfile.name ||
              friend.avatar !== remoteProfile.avatar ||
              friend.status !== remoteProfile.status ||
              friend.favoriteGame !== remoteProfile.favoriteGame ||
              friend.currentlyPlaying !== remoteOutbox.profile.currentlyPlaying ||
              (friend as any).bio !== (remoteProfile.bio || "") ||
              (friend as any).region !== (remoteProfile.region || "") ||
              JSON.stringify(friend.libStats) !== JSON.stringify(remoteProfile.libStats);

            if (hasDiff) profileChanged = true;

            if (hasDiff) {
              friendsUpdated = true;
              updatedFriends.push({
                ...friend,
                name: remoteProfile.name,
                avatar: remoteProfile.avatar,
                status: remoteProfile.status,
                favoriteGame: remoteProfile.favoriteGame || undefined,
                currentlyPlaying: remoteProfile.currentlyPlaying || undefined,
                bio: remoteProfile.bio || undefined,
                region: remoteProfile.region || undefined,
                libStats: remoteProfile.libStats,
                games: remoteOutbox.games || friend.games,
                lastSeen: nowSecs,
              });
              friendLogs.push(
                `🔄 ${friendName}: profile updated` +
                  (friendSessions ? `, +${friendSessions} session(s)` : "") +
                  (friendRecs ? `, +${friendRecs} rec(s)` : "")
              );
              continue;
            }
          }

          // Record a successful contact even when nothing changed.
          if (friend.lastSeen !== nowSecs) {
            friendsUpdated = true;
            updatedFriends.push({ ...friend, lastSeen: nowSecs });
            friendLogs.push(
              `✓ ${friendName}: synced` +
                (friendSessions ? `, +${friendSessions} session(s)` : "") +
                (friendRecs ? `, +${friendRecs} rec(s)` : "") +
                (profileChanged ? ", profile updated" : "")
            );
            continue;
          }

          // No change at all — still log a heartbeat contact.
          friendLogs.push(`• ${friendName}: up to date`);
        } else {
          friendLogs.push(`⚠ ${friendName}: no outbox found`);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        pullErrors.push(`${friendName}: ${reason}`);
        friendLogs.push(`✕ ${friendName}: error — ${reason}`);
        console.error(`Sync error for friend ${friendName}:`, reason);
      }
      updatedFriends.push(friend);
    }

    if (changesMade) {
      saveSessions(mergedSessions);
      saveRecommendations(mergedRecs);
      setSessions(mergedSessions);
      setRecommendations(mergedRecs);
    }

    if (friendsUpdated) {
      saveFriends(updatedFriends);
      setFriends(updatedFriends);
    }

    // Always push our own updated outbox so friends can see us
    const pushed = await pushMyOutbox(profile, selfStats, mergedSessions, mergedRecs);

    const syncedAt = new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    setLastSyncedTime(syncedAt);

    // Build a human-readable activity entry for the conflict/activity log.
    const changes: string[] = [];
    if (discoveredNew) changes.push(`${localFriends.length - friends.length + 0} new friend(s)`);
    if (pulledSessions > 0) changes.push(`${pulledSessions} session(s)`);
    if (pulledRecs > 0) changes.push(`${pulledRecs} rec(s)`);
    if (friendsUpdated) changes.push("profile update(s)");
    if (pullErrors.length > 0) changes.push(`${pullErrors.length} error(s)`);
    const logMsg = pushed.ok
      ? changes.length > 0
        ? `Pulled ${changes.join(", ")}`
        : "Up to date — outbox published"
      : `Publish failed: ${pushed.reason || "unknown"}`;
    setSyncLog((prev) =>
      [{ time: syncedAt, message: logMsg, details: friendLogs }, ...prev].slice(0, 12)
    );

    if (manual) {
      if (!pushed.ok) {
        showToast(`Sync failed: ${pushed.reason || "could not write outbox"}`, "error");
      } else if (pullErrors.length > 0) {
        showToast(
          `Synced, but ${pullErrors.length} friend(s) had errors: ${pullErrors.join("; ")}`,
          "warning"
        );
      } else if (pulledSessions > 0 || pulledRecs > 0 || discoveredNew || friendsUpdated || changesMade) {
        const bits: string[] = [];
        if (discoveredNew) bits.push("new friend(s) found");
        if (pulledSessions > 0) bits.push(`${pulledSessions} session(s)`);
        if (pulledRecs > 0) bits.push(`${pulledRecs} recommendation(s)`);
        if (friendsUpdated) bits.push("profile updates");
        showToast(`Sync successful — ${bits.join(", ")}.`, "success");
      } else {
        showToast("Sync successful — already up to date.", "success");
      }
    }
    setIsSyncing(false);

    // Honor a manual sync that was requested while this one was running.
    if (pendingManualSync.current) {
      pendingManualSync.current = false;
      performSync(true);
    }
  };

  // Run initial sync on mount
  useEffect(() => {
    performSync(false);
  }, [profile.syncId, profileName]);

  // Background polling timer. A 15s cadence is enough for P2P folder sync and
  // avoids re-merging the whole friend graph every 5s on the main thread.
  useEffect(() => {
    const interval = setInterval(() => {
      performSync(false);
    }, 15000);

    return () => {
      clearInterval(interval);
    };
  }, [friends, profile.syncId, profileName]);

  // Presence heartbeat: republish our outbox immediately whenever our local
  // data changes (debounced) so friends see updates near-instantly, plus a
  // shorter recurring interval (20s) so "last seen" stays fresh even when
  // nothing else changed.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      if (cancelled) return;
      const updated = { ...profile, lastPublished: Math.floor(Date.now() / 1000) };
      setProfile(updated);
      saveUserProfile(updated);
      try {
        await pushMyOutbox(updated, selfStats, sessions, recommendations, selfSharedGames);
      } catch {
        /* ignore heartbeat failures */
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [profile, selfStats, sessions, recommendations, selfSharedGames]);

  // Recurring shorter-interval heartbeat to keep presence fresh.
  useEffect(() => {
    const heartbeat = setInterval(async () => {
      const updated = { ...profile, lastPublished: Math.floor(Date.now() / 1000) };
      setProfile(updated);
      saveUserProfile(updated);
      try {
        await pushMyOutbox(updated, selfStats, sessions, recommendations, selfSharedGames);
      } catch {
        /* ignore heartbeat failures */
      }
    }, 20000);
    return () => clearInterval(heartbeat);
  }, [profile, selfStats, sessions, recommendations, selfSharedGames]);

  // Session start reminders: toast once when an upcoming session is ~15 min away.
  const remindedSessionIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    const now = Date.now();
    const REMINDER_MS = 15 * 60 * 1000;
    sessions.forEach((s) => {
      if (s.deleted) return;
      const start = new Date(s.scheduledAt).getTime();
      const diff = start - now;
      if (diff > 0 && diff <= REMINDER_MS && !remindedSessionIds.current.has(s.id)) {
        remindedSessionIds.current.add(s.id);
        showToast(`🔔 "${s.gameName}" starts in ${Math.round(diff / 60000)} min!`, "info");
      }
      // Reset the reminder flag once the session is well in the past.
      if (diff < -60 * 60 * 1000) {
        remindedSessionIds.current.delete(s.id);
      }
    });
  }, [sessions]);

  const handleCommentInputChange = (recId: string, value: string) => {
    setCommentInputs((prev) => ({ ...prev, [recId]: value }));
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      showToast("File size too large. Under 2MB required.", "error");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const maxDim = 96;
        canvas.width = maxDim;
        canvas.height = maxDim;

        if (ctx) {
          const minSide = Math.min(img.width, img.height);
          const sx = (img.width - minSide) / 2;
          const sy = (img.height - minSide) / 2;
          ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, maxDim, maxDim);
          
          try {
            const compressedBase64 = canvas.toDataURL("image/jpeg", 0.6);
            const updated = { ...profile, avatar: compressedBase64 };
            setProfile(updated);
            saveUserProfile(updated);
            pushMyOutbox(updated, selfStats, sessions, recommendations, selfSharedGames);
            showToast("Custom avatar uploaded successfully!", "success");
          } catch {
            showToast("Failed to process image.", "error");
          }
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    saveUserProfile(profile);
    await pushMyOutbox(profile, selfStats, sessions, recommendations, selfSharedGames);
    showToast("Profile updated and synced successfully!", "success");
  };

  // Add a friend
  const handleAddFriend = () => {
    if (!decodedFriend) return;

    const exists = friends.some((f) => f.syncId === decodedFriend.syncId);
    if (exists) {
      showToast(`${decodedFriend.name} is already in your friends list.`, "error");
      return;
    }

    const updatedFriends = [...friends, decodedFriend];
    setFriends(updatedFriends);
    saveFriends(updatedFriends);
    showToast(`${decodedFriend.name} added!`, "success");
    setFriendCodeInput("");
    setShowAddModal(false);

    // Trigger instant synchronization
    setTimeout(() => {
      performSync(false);
    }, 100);
  };

  // Delete a friend
  const handleDeleteFriend = (friendId: string, friendName: string) => {
    const updated = friends.filter((f) => f.id !== friendId);
    setFriends(updated);
    saveFriends(updated);
    if (selectedCompareFriendId === friendId) {
      setSelectedCompareFriendId("");
    }
    showToast(`Removed ${friendName} from friends.`, "info");
  };

  // Toggle pin (favorite) for a friend
  const handleTogglePin = (friendId: string) => {
    const updated = friends.map((f) =>
      f.id === friendId ? { ...f, pinned: !f.pinned } : f
    );
    setFriends(updated);
    saveFriends(updated);
  };

  // Set a local nickname override for a friend
  const handleSetNickname = (friendId: string, nickname: string) => {
    const updated = friends.map((f) =>
      f.id === friendId ? { ...f, nickname: nickname.trim() || undefined } : f
    );
    setFriends(updated);
    saveFriends(updated);
  };

  // Block / unblock a peer (skips their outbox during sync)
  const handleToggleBlock = (friendId: string, friendName: string) => {
    const friend = friends.find((f) => f.id === friendId);
    if (!friend) return;
    const updated = friends.map((f) =>
      f.id === friendId ? { ...f, blocked: !f.blocked } : f
    );
    setFriends(updated);
    saveFriends(updated);
    showToast(
      friend.blocked ? `Unblocked ${friendName}.` : `Blocked ${friendName} — their updates are ignored.`,
      "info"
    );
  };

  // Copy friend code
  const handleCopyCode = () => {
    if (!generatedFriendCode) return;
    navigator.clipboard.writeText(generatedFriendCode);
    showToast("Friend Code copied to clipboard!", "success");
  };

  // Avatar renderer helper
  const renderAvatar = (avatarKey: string, name: string, sizeClass = "") => {
    if (avatarKey === "procedural" || !avatarKey) {
      const style = getProceduralAvatarStyle(name);
      return (
        <div className={`friend-avatar-wrapper ${sizeClass}`} style={style}>
          {getInitials(name)}
        </div>
      );
    }
    return (
      <div className={`friend-avatar-wrapper ${sizeClass}`}>
        <img src={avatarKey} alt={`${name} Avatar`} onError={(e) => {
          (e.target as HTMLElement).style.display = "none";
        }} />
      </div>
    );
  };

  // ── Game Sessions Logic ───────────────────────────────────────────

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionGameId || !sessionDateTime) {
      showToast("Please select a game and schedule time.", "error");
      return;
    }

    const game = games.find((g) => g.id === sessionGameId);
    if (!game) return;

    const newSession: GameSession = {
      id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      gameId: sessionGameId,
      gameName: game.name,
      scheduledAt: sessionDateTime,
      maxPlayers: Number(sessionMaxPlayers) || 4,
      description: sessionDesc,
      creatorName: profile.name,
      attendees: [profile.name],
      rsvps: { [profile.name]: "going" },
      updatedAt: Date.now(),
    };

    const updated = [newSession, ...sessions];
    setSessions(updated);
    saveSessions(updated);
    await pushMyOutbox(profile, selfStats, updated, recommendations, selfSharedGames);
    showToast("Game session scheduled!", "success");

    // Reset Form
    setSessionGameId("");
    setSessionDateTime("");
    setSessionMaxPlayers(4);
    setSessionDesc("");
    // Make sure the freshly created session is visible (it becomes "Upcoming").
    setSessionView("upcoming");
  };

  // Set an RSVP status (going / maybe / declined) for the current user.
  const handleSetRsvp = async (sessionId: string, status: RsvpStatus) => {
    const updated = sessions.map((s) => {
      if (s.id !== sessionId) return s;
      const rsvps = { ...(s.rsvps || {}) };
      // Toggling the same status clears it back to no response.
      if (rsvps[profile.name] === status) {
        delete rsvps[profile.name];
      } else {
        rsvps[profile.name] = status;
      }
      const isGoing = rsvps[profile.name] === "going";
      const attendees = isGoing
        ? Array.from(new Set([...s.attendees, profile.name]))
        : s.attendees.filter((n) => n !== profile.name);
      const label = rsvps[profile.name] ? rsvps[profile.name] : "no response";
      showToast(`RSVP: ${label}.`, "info");
      return { ...s, rsvps, attendees, updatedAt: Date.now() };
    });

    setSessions(updated);
    saveSessions(updated);
    await pushMyOutbox(profile, selfStats, updated, recommendations, selfSharedGames);
  };

  // Remove a session entirely (hard delete from local list)
  const handleDeleteSession = async (sessionId: string) => {
    const updated = sessions.filter((s) => s.id !== sessionId);
    setSessions(updated);
    saveSessions(updated);
    await pushMyOutbox(profile, selfStats, updated, recommendations, selfSharedGames);
    showToast("Session removed.", "info");
  };

  // ── Recommendations Logic ────────────────────────────────────────

  const handleCreateRecommendation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recGameId || !recReason.trim()) {
      showToast("Please select a game and share notes.", "error");
      return;
    }

    const game = games.find((g) => g.id === recGameId);
    if (!game) return;

    const newRec: GameRecommendation = {
      id: `rec_${Date.now()}`,
      gameId: recGameId,
      gameName: game.name,
      recommendedBy: profile.name,
      recommendedTo: recToFriend,
      reason: recReason,
      rating: recRating,
      comments: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const updated = [newRec, ...recommendations];
    setRecommendations(updated);
    saveRecommendations(updated);
    await pushMyOutbox(profile, selfStats, sessions, updated);
    showToast("Game recommended!", "success");

    setRecGameId("");
    setRecToFriend("All Friends");
    setRecRating(5);
    setRecReason("");
  };

  const handleAddComment = async (e: React.FormEvent, recId: string) => {
    e.preventDefault();
    const commentText = commentInputs[recId] || "";
    if (!commentText.trim()) return;

    const updated = recommendations.map((r) => {
      if (r.id !== recId) return r;

      const newComment = {
        id: `comment_${Date.now()}`,
        authorName: profile.name,
        text: commentText,
        timestamp: Date.now(),
      };

      return {
        ...r,
        comments: [...r.comments, newComment],
        updatedAt: Date.now(),
      };
    });

    setRecommendations(updated);
    saveRecommendations(updated);
    await pushMyOutbox(profile, selfStats, sessions, updated);
    setCommentInputs((prev) => ({ ...prev, [recId]: "" }));
    showToast("Comment posted.", "success");
  };

  // Remove a recommendation entirely (hard delete from local list)
  const handleDeleteRecommendation = async (recId: string) => {
    const updated = recommendations.filter((r) => r.id !== recId);
    setRecommendations(updated);
    saveRecommendations(updated);
    await pushMyOutbox(profile, selfStats, sessions, updated);
    showToast("Recommendation removed.", "info");
  };

  // Toggle a reaction (like/love/play) on a recommendation. Toggling the same
  // kind again removes the reaction.
  const handleToggleReaction = async (recId: string, kind: ReactionKind) => {
    const updated = recommendations.map((r) => {
      if (r.id !== recId) return r;
      const reactions = { ...(r.reactions || {}) };
      if (reactions[profile.name] === kind) {
        delete reactions[profile.name];
      } else {
        reactions[profile.name] = kind;
      }
      return { ...r, reactions, updatedAt: Date.now() };
    });
    setRecommendations(updated);
    saveRecommendations(updated);
    await pushMyOutbox(profile, selfStats, sessions, updated);
  };

  // Toggle this user's personal "want to play" backlog flag.
  const handleToggleWantToPlay = async (recId: string) => {
    const updated = recommendations.map((r) => {
      if (r.id !== recId) return r;
      return { ...r, wantToPlay: !r.wantToPlay, updatedAt: Date.now() };
    });
    setRecommendations(updated);
    saveRecommendations(updated);
    await pushMyOutbox(profile, selfStats, sessions, updated);
    const rec = updated.find((r) => r.id === recId);
    showToast(rec?.wantToPlay ? "Added to your Want to Play list." : "Removed from Want to Play.", "info");
  };

  // Delete a single comment (only allowed for the author's own comments).
  const handleDeleteComment = async (recId: string, commentId: string, authorName: string) => {
    if (authorName !== profile.name) {
      showToast("You can only delete your own comments.", "error");
      return;
    }
    const updated = recommendations.map((r) => {
      if (r.id !== recId) return r;
      return {
        ...r,
        comments: r.comments.filter((c) => c.id !== commentId),
        updatedAt: Date.now(),
      };
    });
    setRecommendations(updated);
    saveRecommendations(updated);
    await pushMyOutbox(profile, selfStats, sessions, updated);
  };

  // ── Game Comparison Logic ────────────────────────────────────────

  const compareFriend = useMemo(() => {
    return friends.find((f) => f.id === selectedCompareFriendId) || null;
  }, [friends, selectedCompareFriendId]);

  // Builds the comparison list from REAL shared per-game data when the friend
  // has published it. Falls back to a deterministic (seeded) estimate only for
  // legacy peers who haven't shared game-level stats yet.
  const comparisonData = useMemo(() => {
    if (!compareFriend) return [];

    const friendGames = compareFriend.games || [];
    const friendGameMap = new Map(friendGames.map((g) => [g.id, g]));

    // Deterministic legacy fallback (seeded by friend name) — only used when
    // no real per-game data is available for this friend.
    const friendName = compareFriend.name;
    let hash = 0;
    for (let i = 0; i < friendName.length; i++) {
      hash = friendName.charCodeAt(i) + ((hash << 5) - hash);
    }
    let seed = Math.abs(hash);
    const prng = () => {
      const x = Math.sin(seed++) * 10000;
      return x - Math.floor(x);
    };

    const compareList: any[] = [];

    const selfById = new Map(games.map((g) => [g.id, g]));

    // All unique game ids across both libraries.
    const ids = new Set<string>([...games.map((g) => g.id), ...friendGames.map((g) => g.id)]);

    ids.forEach((id) => {
      const myGame = selfById.get(id);
      const friendGame = friendGameMap.get(id);

      const selfAchData = myGame ? cache?.games?.[myGame.id] : undefined;
      const selfAchTotal = selfAchData?.total || 0;
      const selfAchUnlocked = selfAchData?.unlocked || 0;
      const selfAchPercent = selfAchTotal > 0 ? Math.round((selfAchUnlocked / selfAchTotal) * 100) : 0;

      const name = myGame?.name || friendGame?.name || id;

      // Legacy estimate when the friend hasn't shared real data.
      const legacyOwned = friendGames.length === 0 ? prng() > 0.45 : false;
      const ownedByFriend = friendGame ? true : legacyOwned;
      const playTimeFriend = friendGame
        ? friendGame.playTimeMin
        : legacyOwned
        ? Math.floor(prng() * 12000) + 120
        : 0;
      const achievementFriend = friendGame
        ? friendGame.achievementPercent
        : legacyOwned
        ? Math.floor(prng() * 100)
        : 0;

      compareList.push({
        id,
        name,
        ownedByMe: !!myGame,
        ownedByFriend,
        playTimeMe: myGame ? parsePlayTime(myGame.playTime) : 0,
        playTimeFriend,
        achievementMe: selfAchPercent,
        achievementFriend,
        genres: (myGame as any)?.genres || friendGame?.genres || [],
        estimated: friendGames.length === 0,
      });
    });

    return compareList;
  }, [games, cache, compareFriend]);

  const matchScore = useMemo(() => {
    if (!compareFriend || comparisonData.length === 0) return 0;
    const sharedGamesCount = comparisonData.filter((i) => i.ownedByMe && i.ownedByFriend).length;
    const totalUniqueGamesCount = comparisonData.length;
    return totalUniqueGamesCount > 0 ? Math.round((sharedGamesCount / totalUniqueGamesCount) * 100) : 0;
  }, [compareFriend, comparisonData]);

  const filteredCompareData = useMemo(() => {
    return comparisonData.filter((item) => {
      if (compareFilter === "shared") return item.ownedByMe && item.ownedByFriend;
      if (compareFilter === "me_only") return item.ownedByMe && !item.ownedByFriend;
      if (compareFilter === "friend_only") return !item.ownedByMe && item.ownedByFriend;
      if (compareGenre !== "all") {
        const genres: string[] = item.genres || [];
        return genres.some((g) => g.toLowerCase() === compareGenre.toLowerCase());
      }
      return true;
    });
  }, [comparisonData, compareFilter, compareGenre]);

  // Unique genres across both libraries for the genre filter dropdown.
  const compareGenres = useMemo(() => {
    const set = new Set<string>();
    comparisonData.forEach((item) => (item.genres || []).forEach((g: string) => set.add(g)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [comparisonData]);

  const sortedCompareData = useMemo(() => {
    const list = [...filteredCompareData];
    if (compareSort === "myPlaytime") {
      return list.sort((a, b) => b.playTimeMe - a.playTimeMe);
    }
    if (compareSort === "friendPlaytime") {
      return list.sort((a, b) => b.playTimeFriend - a.playTimeFriend);
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredCompareData, compareSort]);

  const comparisonSummary = useMemo(() => {
    if (!comparisonData.length) return null;

    let sharedCount = 0;
    let myPlaytime = 0;
    let friendPlaytime = 0;
    let myAchievementsSum = 0;
    let friendAchievementsSum = 0;

    comparisonData.forEach((item) => {
      if (item.ownedByMe && item.ownedByFriend) sharedCount++;
      myPlaytime += item.playTimeMe;
      friendPlaytime += item.playTimeFriend;
      myAchievementsSum += item.achievementMe;
      friendAchievementsSum += item.achievementFriend;
    });

    const myOwned = comparisonData.filter(i => i.ownedByMe).length;
    const friendOwned = comparisonData.filter(i => i.ownedByFriend).length;

    const averageMyAchievements = Math.round(myAchievementsSum / myOwned || 0);
    const averageFriendAchievements = Math.round(friendAchievementsSum / friendOwned || 0);

    return {
      sharedCount,
      myPlaytime,
      friendPlaytime,
      averageMyAchievements,
      averageFriendAchievements,
    };
  }, [comparisonData]);

  // ── Visible Friends (search / sort / filter) ──────────────────────

  const visibleFriends = useMemo(() => {
    const query = friendSearch.trim().toLowerCase();
    let list = friends.filter((f) => {
      const name = displayName(f).toLowerCase();
      const matchesQuery = !query || name.includes(query) || (f.favoriteGame || "").toLowerCase().includes(query);
      const matchesFilter =
        friendFilter === "all"
          ? true
          : friendFilter === "online"
          ? isOnline(f)
          : friendFilter === "pinned"
          ? !!f.pinned
          : true;
      return matchesQuery && matchesFilter;
    });

    list = [...list].sort((a, b) => {
      if (friendSort === "name") {
        return displayName(a).localeCompare(displayName(b));
      }
      if (friendSort === "recent") {
        return (b.addedAt || 0) - (a.addedAt || 0);
      }
      if (friendSort === "online") {
        const ao = isOnline(a) ? 1 : 0;
        const bo = isOnline(b) ? 1 : 0;
        if (bo !== ao) return bo - ao;
        return (b.addedAt || 0) - (a.addedAt || 0);
      }
      // default: pinned first, then most recently added
      const ap = a.pinned ? 1 : 0;
      const bp = b.pinned ? 1 : 0;
      if (bp !== ap) return bp - ap;
      return (b.addedAt || 0) - (a.addedAt || 0);
    });

    return list;
  }, [friends, friendSearch, friendFilter, friendSort]);

  return (
    <div className="friends-page">
      {/* Tab bar and Sync controller row */}
      <div className="friends-tab-bar-container">
        <div className="friends-tab-bar" role="tablist" aria-label="Friends sections">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "friends"}
            className={`friends-tab${activeTab === "friends" ? " active" : ""}`}
            onClick={() => setActiveTab("friends")}
          >
            <UsersIcon />
            <span>Friends List</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "sessions"}
            className={`friends-tab${activeTab === "sessions" ? " active" : ""}`}
            onClick={() => setActiveTab("sessions")}
          >
            <CalendarIcon />
            <span>Sessions Planner</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "recs"}
            className={`friends-tab${activeTab === "recs" ? " active" : ""}`}
            onClick={() => setActiveTab("recs")}
          >
            <RecommendIcon />
            <span>Recommendations</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "compare"}
            className={`friends-tab${activeTab === "compare" ? " active" : ""}`}
            onClick={() => setActiveTab("compare")}
          >
            <CompareIcon />
            <span>Compare Library</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "profile"}
            className={`friends-tab${activeTab === "profile" ? " active" : ""}`}
            onClick={() => setActiveTab("profile")}
          >
            <UserIcon />
            <span>My Profile</span>
          </button>
        </div>

        <div className="profile-switcher" role="group" aria-label="Active profile">
          {PROFILE_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className={`profile-switch-btn${profileName === key ? " active" : ""}`}
              onClick={() => switchProfile(key)}
              title={`Switch to profile ${key}`}
            >
              {key}
            </button>
          ))}
        </div>

        <div className="sync-status-container">
          <span className="sync-status-text">
            {isSyncing ? "Syncing..." : `Synced: ${lastSyncedTime}`}
          </span>
          <button
            type="button"
            className="btn-sync"
            onClick={() => performSync(true)}
            disabled={isSyncing}
            title="Force synchronization"
          >
            <RefreshIcon className={isSyncing ? "sync-spinner" : ""} />
          </button>
          <button
            type="button"
            className="btn-sync p2p-sync-btn"
            style={{ marginLeft: "4px" }}
            onClick={() => {
              setShowP2pModal(true);
            }}
            title="Direct P2P Internet Sync"
          >
            <P2pSyncIcon />
          </button>
        </div>
      </div>

      {/* Panels */}
      <div className="friends-panel">
        {/* Tab 1: Friends List */}
        {activeTab === "friends" && (
          <div className="friends-list-section">
            <div className="friends-list-header">
              <h2 className="friends-list-title">My Friends ({friends.length})</h2>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowAddModal(true)}
              >
                Add Friend
              </button>
            </div>

            {friends.length === 0 ? (
              <div className="friends-empty-state">
                <div className="friends-empty-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="64" height="64">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </div>
                <h3 className="friends-empty-title">No Friends Yet</h3>
                <p className="friends-empty-desc">
                  Your friends list is currently empty. Go to 'My Profile' to copy your Friend Code,
                  or ask a friend for their code to get connected!
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setShowAddModal(true)}
                >
                  Add Friend
                </button>
              </div>
            ) : (
              <>
                {/* Search / Filter / Sort controls */}
                <div className="friends-controls-row">
                  <div className="friends-search-wrapper">
                    <input
                      type="text"
                      className="friends-search-input"
                      placeholder="Search friends or favorite games..."
                      value={friendSearch}
                      onChange={(e) => setFriendSearch(e.target.value)}
                      aria-label="Search friends"
                    />
                    {friendSearch && (
                      <button
                        type="button"
                        className="friends-search-clear"
                        onClick={() => setFriendSearch("")}
                        title="Clear search"
                      >
                        ×
                      </button>
                    )}
                  </div>

                  <div className="friends-filter-chips">
                    <button
                      type="button"
                      className={`compare-filter-chip${friendFilter === "all" ? " active" : ""}`}
                      onClick={() => setFriendFilter("all")}
                    >
                      All ({friends.length})
                    </button>
                    <button
                      type="button"
                      className={`compare-filter-chip${friendFilter === "online" ? " active" : ""}`}
                      onClick={() => setFriendFilter("online")}
                    >
                      Online ({friends.filter(isOnline).length})
                    </button>
                    <button
                      type="button"
                      className={`compare-filter-chip${friendFilter === "pinned" ? " active" : ""}`}
                      onClick={() => setFriendFilter("pinned")}
                    >
                      Pinned ({friends.filter((f) => f.pinned).length})
                    </button>
                  </div>

                  <select
                    className="profile-input friends-sort-select"
                    value={friendSort}
                    onChange={(e) => setFriendSort(e.target.value as any)}
                    aria-label="Sort friends"
                  >
                    <option value="default">Pinned first</option>
                    <option value="name">Name (A–Z)</option>
                    <option value="recent">Recently added</option>
                    <option value="online">Online first</option>
                  </select>
                </div>

                {visibleFriends.length === 0 ? (
                  <div className="game-search-no-results" style={{ padding: "40px" }}>
                    No friends match your search or filter.
                  </div>
                ) : (
                  <div className="friends-grid">
                    {visibleFriends.map((friend) => {
                      const online = isOnline(friend);
                      return (
                        <div
                          key={friend.id}
                          className={`friend-card hover-lift status-${online ? "online" : "offline"}${
                            friend.pinned ? " pinned" : ""
                          }${friend.blocked ? " blocked" : ""}`}
                        >
                          {friend.pinned && <span className="friend-pin-badge" title="Pinned">📌</span>}
                          {renderAvatar(friend.avatar, friend.name)}
                          <div className="friend-info">
                            <div className="friend-name">
                              {displayName(friend)}
                              {friend.nickname && (
                                <span className="friend-real-name">({friend.name})</span>
                              )}
                            </div>
                            {friend.blocked ? (
                              <div className="friend-status-text" title="Blocked — updates ignored">
                                🚫 Blocked
                              </div>
                            ) : friend.currentlyPlaying ? (
                              <div className="friend-now-playing" title={`Playing ${friend.currentlyPlaying}`}>
                                <span className="now-playing-dot" />
                                {friend.currentlyPlaying}
                              </div>
                            ) : (
                              <div className="friend-status-text" title={friend.status}>
                                {friend.status}
                              </div>
                            )}
                            <div className="friend-last-seen" title="Last synced">
                              Last seen: {formatLastSeen(friend.lastSeen)}
                            </div>
                            {friend.libStats && (
                              <div className="friend-stats">
                                <span>{friend.libStats.gamesCount} games</span>
                                <span>•</span>
                                <span>{formatHours(friend.libStats.playtimeMinutes)}</span>
                                {friend.libStats.achievementsCount > 0 && (
                                  <>
                                    <span>•</span>
                                    <span>🏆 {friend.libStats.achievementsCount}</span>
                                  </>
                                )}
                              </div>
                            )}
                            {friend.favoriteGame && (
                              <div className="friend-favorite-game" title={`Fav: ${friend.favoriteGame}`}>
                                ⭐ {friend.favoriteGame}
                              </div>
                            )}
                            {formatFriendsSince(friend.addedAt) && (
                              <div className="friend-since">{formatFriendsSince(friend.addedAt)}</div>
                            )}
                          </div>
                          <div className="friend-card-actions">
                            <button
                              type="button"
                              className={`friend-icon-btn${friend.pinned ? " active" : ""}`}
                              title={friend.pinned ? "Unpin" : "Pin to top"}
                              onClick={() => handleTogglePin(friend.id)}
                            >
                              📌
                            </button>
                            <button
                              type="button"
                              className="friend-icon-btn"
                              title="Set nickname"
                              onClick={() => {
                                const current = friend.nickname || friend.name;
                                const next = window.prompt("Nickname for this friend (blank to reset):", current);
                                if (next !== null) handleSetNickname(friend.id, next);
                              }}
                            >
                              ✏️
                            </button>
                            <button
                              type="button"
                              className={`friend-icon-btn${friend.blocked ? " active" : ""}`}
                              title={friend.blocked ? "Unblock" : "Block (ignore updates)"}
                              onClick={() => handleToggleBlock(friend.id, displayName(friend))}
                            >
                              🚫
                            </button>
                            <button
                              type="button"
                              className="friend-delete-btn"
                              title={`Remove ${displayName(friend)}`}
                              onClick={() => handleDeleteFriend(friend.id, displayName(friend))}
                            >
                              <TrashIcon />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Tab 2: Sessions Planner */}
        {activeTab === "sessions" && (
          <div className="sessions-section">
            <div className="profile-editor-layout">
              {/* Left Column: Form */}
              <div className="profile-edit-section">
                <h3 className="profile-edit-title">Schedule Game Session</h3>
                <form className="profile-form" onSubmit={handleCreateSession}>
                  <div className="friends-input-group">
                    <label>Select Game</label>
                    <SearchableGameSelector
                      games={games}
                      selectedGameId={sessionGameId}
                      onSelect={(id) => setSessionGameId(id)}
                      placeholder="Search game from library..."
                    />
                  </div>

                  <div className="friends-input-group">
                    <label htmlFor="sessionDateTime">Scheduled Time</label>
                    <input
                      type="datetime-local"
                      id="sessionDateTime"
                      className="profile-input"
                      value={sessionDateTime}
                      onChange={(e) => setSessionDateTime(e.target.value)}
                      required
                    />
                  </div>

                  <div className="friends-input-group">
                    <label htmlFor="sessionMaxPlayers">Max Players</label>
                    <input
                      type="number"
                      id="sessionMaxPlayers"
                      className="profile-input"
                      min={2}
                      max={16}
                      value={sessionMaxPlayers}
                      onChange={(e) => setSessionMaxPlayers(Number(e.target.value))}
                      required
                    />
                  </div>

                  <div className="friends-input-group">
                    <label htmlFor="sessionDesc">Event Notes</label>
                    <textarea
                      id="sessionDesc"
                      className="profile-input"
                      style={{ height: "80px", resize: "none" }}
                      value={sessionDesc}
                      onChange={(e) => setSessionDesc(e.target.value)}
                      placeholder="e.g. Coop achievement hunt, casual matches..."
                    />
                  </div>

                  <button type="submit" className="btn btn-primary" style={{ alignSelf: "flex-start" }}>
                    Plan Event
                  </button>
                </form>
              </div>

              {/* Right Column: Sessions Grid */}
              <div className="profile-summary-section" style={{ gap: "var(--space-md)" }}>
                <div className="sessions-view-header">
                  <h3 className="friends-list-title">
                    {sessionView === "past" ? "Past Sessions" : sessionView === "agenda" ? "Agenda" : "Upcoming Sessions"}
                  </h3>
                  <div className="compare-filter-chips">
                    <button type="button" className={`compare-filter-chip${sessionView === "upcoming" ? " active" : ""}`} onClick={() => setSessionView("upcoming")}>Upcoming</button>
                    <button type="button" className={`compare-filter-chip${sessionView === "agenda" ? " active" : ""}`} onClick={() => setSessionView("agenda")}>Agenda</button>
                    <button type="button" className={`compare-filter-chip${sessionView === "past" ? " active" : ""}`} onClick={() => setSessionView("past")}>Past</button>
                  </div>
                </div>

                {(() => {
                  const now = Date.now();
                  const active = sessions.filter((s) => !s.deleted);
                  const upcoming = active.filter((s) => new Date(s.scheduledAt).getTime() >= now).sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
                  const past = active.filter((s) => new Date(s.scheduledAt).getTime() < now).sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());

                  const visible = sessionView === "past" ? past : sessionView === "agenda" ? upcoming : upcoming;

                  if (visible.length === 0) {
                    return (
                      <div className="friends-empty-state" style={{ margin: "0", maxWidth: "100%" }}>
                        <h3 className="friends-empty-title">
                          {sessionView === "past" ? "No Past Sessions" : "No Events Scheduled"}
                        </h3>
                        <p className="friends-empty-desc">
                          {sessionView === "past"
                            ? "Completed sessions you attended will appear here."
                            : "Create an event on the left to plan game sessions. It will sync automatically to all friends!"}
                        </p>
                      </div>
                    );
                  }

                  // Agenda view: group upcoming by date.
                  if (sessionView === "agenda") {
                    const groups = new Map<string, GameSession[]>();
                    visible.forEach((s) => {
                      const key = new Date(s.scheduledAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
                      if (!groups.has(key)) groups.set(key, []);
                      groups.get(key)!.push(s);
                    });
                    return (
                      <div className="sessions-agenda">
                        {Array.from(groups.entries()).map(([day, daySessions]) => (
                          <div key={day} className="agenda-day-group">
                            <div className="agenda-day-label">{day}</div>
                            <div className="sessions-grid">
                              {daySessions.map((session) => renderSessionCard(session, profile, handleSetRsvp, handleDeleteSession))}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  }

                  return (
                    <div className="sessions-grid">
                      {visible.map((session) => renderSessionCard(session, profile, handleSetRsvp, handleDeleteSession))}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Recommendations Feed & Comments */}
        {activeTab === "recs" && (
          <div className="recs-section">
            <div className="recs-layout">
              {/* Left Column: Recommendations Feed */}
              <div className="recs-feed">
                <h3 className="friends-list-title">Friend Recommendations ({recommendations.length})</h3>

                {recommendations.length > 0 && (
                  <div className="compare-filter-chips rec-filter-chips">
                    <button
                      type="button"
                      className={`compare-filter-chip${recFilter === "all" ? " active" : ""}`}
                      onClick={() => setRecFilter("all")}
                    >
                      All ({recommendations.length})
                    </button>
                    <button
                      type="button"
                      className={`compare-filter-chip${recFilter === "to_me" ? " active" : ""}`}
                      onClick={() => setRecFilter("to_me")}
                    >
                      To Me ({recommendations.filter((r) => r.recommendedTo === profile.name || r.recommendedTo === "All Friends").length})
                    </button>
                    <button
                      type="button"
                      className={`compare-filter-chip${recFilter === "by_me" ? " active" : ""}`}
                      onClick={() => setRecFilter("by_me")}
                    >
                      By Me ({recommendations.filter((r) => r.recommendedBy === profile.name).length})
                    </button>
                    <button
                      type="button"
                      className={`compare-filter-chip${recFilter === "want" ? " active" : ""}`}
                      onClick={() => setRecFilter("want")}
                    >
                      Want to Play ({recommendations.filter((r) => r.wantToPlay).length})
                    </button>
                  </div>
                )}

                {recommendations.length === 0 ? (
                  <div className="friends-empty-state" style={{ margin: "0", maxWidth: "100%" }}>
                    <h3 className="friends-empty-title">No Recommendations Yet</h3>
                    <p className="friends-empty-desc">
                      Recommend a game on the right. Your reviews and comments will sync with friends automatically!
                    </p>
                  </div>
                ) : (
                  recommendations
                    .filter((rec) => {
                      if (recFilter === "to_me")
                        return rec.recommendedTo === profile.name || rec.recommendedTo === "All Friends";
                      if (recFilter === "by_me") return rec.recommendedBy === profile.name;
                      if (recFilter === "want") return !!rec.wantToPlay;
                      return true;
                    })
                    .map((rec) => {
                      const myReaction = rec.reactions?.[profile.name];
                      const reactionCounts: Record<string, number> = {};
                      if (rec.reactions) {
                        Object.values(rec.reactions).forEach((k) => {
                          reactionCounts[k] = (reactionCounts[k] || 0) + 1;
                        });
                      }
                      return (
                        <div key={rec.id} className="rec-card">
                          <div className="rec-header">
                            <div className="rec-meta">
                              <span className="rec-game">{rec.gameName}</span>
                              <span className="rec-author">
                                Recommended by <strong>{rec.recommendedBy}</strong> to <em>{rec.recommendedTo}</em>
                              </span>
                            </div>
                            <div className="rec-header-actions">
                              <div className="rating-stars">
                                {Array.from({ length: 5 }).map((_, idx) => (
                                  <span key={idx} className={idx < rec.rating ? "active" : ""}>
                                    ★
                                  </span>
                                ))}
                              </div>
                              <button
                                type="button"
                                className="friend-delete-btn"
                                style={{ opacity: 1, position: "static" }}
                                onClick={() => handleDeleteRecommendation(rec.id)}
                                title="Remove Recommendation"
                              >
                                <TrashIcon />
                              </button>
                            </div>
                          </div>

                          <p className="rec-reason">"{rec.reason}"</p>

                          {/* Reactions + Want to Play */}
                          <div className="rec-reactions-row">
                            {(["like", "love", "play"] as ReactionKind[]).map((kind) => (
                              <button
                                key={kind}
                                type="button"
                                className={`rec-reaction-btn${myReaction === kind ? " active" : ""}`}
                                onClick={() => handleToggleReaction(rec.id, kind)}
                                title={`React: ${kind}`}
                              >
                                <span>{kind === "like" ? "👍" : kind === "love" ? "❤️" : "🎮"}</span>
                                {reactionCounts[kind] ? <span className="rec-reaction-count">{reactionCounts[kind]}</span> : null}
                              </button>
                            ))}
                            <button
                              type="button"
                              className={`rec-want-btn${rec.wantToPlay ? " active" : ""}`}
                              onClick={() => handleToggleWantToPlay(rec.id)}
                              title="Add to Want to Play"
                            >
                              {rec.wantToPlay ? "✓ Want to Play" : "+ Want to Play"}
                            </button>
                          </div>

                          {/* Threaded comments */}
                          <div className="rec-comments-section">
                            <h4 className="rec-comments-title">Comments ({rec.comments.length})</h4>
                            {rec.comments.length > 0 && (
                              <div className="rec-comments-list">
                                {rec.comments.map((comment) => (
                                  <div key={comment.id} className="comment-item">
                                    <span className="comment-author">{comment.authorName}</span>
                                    <span className="comment-text">{comment.text}</span>
                                    <span className="comment-time">{formatDateTime(new Date(comment.timestamp).toISOString())}</span>
                                    {comment.authorName === profile.name && (
                                      <button
                                        type="button"
                                        className="comment-delete-btn"
                                        onClick={() => handleDeleteComment(rec.id, comment.id, comment.authorName)}
                                        title="Delete your comment"
                                      >
                                        ×
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}

                            <form
                              className="comment-form"
                              onSubmit={(e) => handleAddComment(e, rec.id)}
                            >
                              <input
                                type="text"
                                className="comment-input"
                                placeholder="Write a comment..."
                                value={commentInputs[rec.id] || ""}
                                onChange={(e) => handleCommentInputChange(rec.id, e.target.value)}
                                required
                              />
                              <button type="submit" className="btn btn-primary" style={{ padding: "4px 10px", fontSize: "11px" }}>
                                Post
                              </button>
                            </form>
                          </div>
                        </div>
                      );
                    })
                )}
              </div>

              {/* Right Column: Write Form */}
              <div className="profile-edit-section">
                <h3 className="profile-edit-title">Recommend a Game</h3>
                <form className="profile-form" onSubmit={handleCreateRecommendation}>
                  <div className="friends-input-group">
                    <label>Game</label>
                    <SearchableGameSelector
                      games={games}
                      selectedGameId={recGameId}
                      onSelect={(id) => setRecGameId(id)}
                      placeholder="Search game to recommend..."
                    />
                  </div>

                  <div className="friends-input-group">
                    <label htmlFor="recTo">Recommend To</label>
                    <select
                      id="recTo"
                      className="profile-input"
                      value={recToFriend}
                      onChange={(e) => setRecToFriend(e.target.value)}
                    >
                      <option value="All Friends">All Friends</option>
                      {friends.map((f) => (
                        <option key={f.id} value={f.name}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="friends-input-group">
                    <label>Rating</label>
                    <div className="rating-stars" style={{ fontSize: "20px", marginTop: "4px" }}>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          className={`rating-star-btn${star <= recRating ? " active" : ""}`}
                          onClick={() => setRecRating(star)}
                        >
                          ★
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="friends-input-group">
                    <label htmlFor="recReason">Why do you recommend it?</label>
                    <textarea
                      id="recReason"
                      className="profile-input"
                      style={{ height: "80px", resize: "none" }}
                      value={recReason}
                      onChange={(e) => setRecReason(e.target.value)}
                      placeholder="Write your review or notes..."
                      required
                    />
                  </div>

                  <button type="submit" className="btn btn-primary" style={{ alignSelf: "flex-start" }}>
                    Recommend
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: Compare Libraries */}
        {activeTab === "compare" && (
          <div className="compare-section">
            <div className="compare-selector-bar">
              <div className="compare-selector-group">
                <label htmlFor="compareFriendSelect">Friend:</label>
                <select
                  id="compareFriendSelect"
                  className="profile-input"
                  style={{ width: "220px", margin: "0" }}
                  value={selectedCompareFriendId}
                  onChange={(e) => setSelectedCompareFriendId(e.target.value)}
                >
                  <option value="">Choose a friend...</option>
                  {friends.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>

              {compareFriend && (
                <div className="compare-match-score-badge">
                  <span>🎯 Similarity:</span>
                  <strong>{matchScore}% Match</strong>
                </div>
              )}

              {compareFriend && comparisonData.length > 0 && (
                <div
                  className={`compare-data-badge ${comparisonData.some((i) => i.estimated) ? "estimated" : "real"}`}
                  title={
                    comparisonData.some((i) => i.estimated)
                      ? "This friend hasn't shared game-level data yet — numbers are estimated."
                      : "Based on real per-game data shared by your friend."
                  }
                >
                  {comparisonData.some((i) => i.estimated) ? "⚠ Estimated" : "✓ Real data"}
                </div>
              )}
            </div>

            {!compareFriend ? (
              <div className="friends-empty-state">
                <h3 className="friends-empty-title">Select a Friend</h3>
                <p className="friends-empty-desc">
                  Select one of your friends from the list above to compare owned games,
                  playtimes, and achievement stats side-by-side!
                </p>
              </div>
            ) : (
              <>
                {/* Profiles vs Header */}
                <div className="compare-profiles-header">
                  <div className="compare-user-profile">
                    {renderAvatar(profile.avatar, profile.name, "compare-user-avatar")}
                    <span className="compare-user-name">{profile.name} (You)</span>
                    {profile.currentlyPlaying && (
                      <span className="compare-now-playing">
                        <span className="now-playing-dot" />
                        {profile.currentlyPlaying}
                      </span>
                    )}
                  </div>
                  <div className="compare-vs-badge">VS</div>
                  <div className="compare-user-profile right">
                    {renderAvatar(compareFriend.avatar, compareFriend.name, "compare-user-avatar friend")}
                    <span className="compare-user-name">{compareFriend.name}</span>
                    {compareFriend.currentlyPlaying && (
                      <span className="compare-now-playing">
                        <span className="now-playing-dot" />
                        {compareFriend.currentlyPlaying}
                      </span>
                    )}
                  </div>
                </div>

                {/* KPI stats */}
                {comparisonSummary && (
                  <div className="compare-stats-grid">
                    <div className="compare-stat-card">
                      <span className="compare-stat-val left">{selfStats.gamesCount}</span>
                      <span className="compare-stat-label">Games Owned</span>
                      <span className="compare-stat-val right">{compareFriend.libStats?.gamesCount || 0}</span>
                    </div>

                    <div className="compare-stat-card">
                      <span className="compare-stat-val left">{comparisonSummary.sharedCount}</span>
                      <span className="compare-stat-label">Shared Games</span>
                      <span className="compare-stat-val right">{comparisonSummary.sharedCount}</span>
                    </div>

                    <div className="compare-stat-card">
                      <span className="compare-stat-val left">{formatHours(selfStats.playtimeMinutes)}</span>
                      <span className="compare-stat-label">Total Playtime</span>
                      <span className="compare-stat-val right">{formatHours(compareFriend.libStats?.playtimeMinutes || 0)}</span>
                    </div>

                    <div className="compare-stat-card">
                      <span className="compare-stat-val left">{comparisonSummary.averageMyAchievements}%</span>
                      <span className="compare-stat-label">Avg Achievements</span>
                      <span className="compare-stat-val right">{comparisonSummary.averageFriendAchievements}%</span>
                    </div>
                  </div>
                )}

                {/* Filter and Sort Chips Row */}
                <div className="compare-controls-row">
                  <div className="compare-filter-chips">
                    <button
                      type="button"
                      className={`compare-filter-chip${compareFilter === "all" ? " active" : ""}`}
                      onClick={() => setCompareFilter("all")}
                    >
                      All Games ({comparisonData.length})
                    </button>
                    <button
                      type="button"
                      className={`compare-filter-chip${compareFilter === "shared" ? " active" : ""}`}
                      onClick={() => setCompareFilter("shared")}
                    >
                      Shared ({comparisonData.filter(i => i.ownedByMe && i.ownedByFriend).length})
                    </button>
                    <button
                      type="button"
                      className={`compare-filter-chip${compareFilter === "me_only" ? " active" : ""}`}
                      onClick={() => setCompareFilter("me_only")}
                    >
                      Only Me ({comparisonData.filter(i => i.ownedByMe && !i.ownedByFriend).length})
                    </button>
                    <button
                      type="button"
                      className={`compare-filter-chip${compareFilter === "friend_only" ? " active" : ""}`}
                      onClick={() => setCompareFilter("friend_only")}
                    >
                      Only Them ({comparisonData.filter(i => !i.ownedByMe && i.ownedByFriend).length})
                    </button>
                  </div>

                  <div className="compare-selector-group compare-sort-group">
                    <span>Sort:</span>
                    <select
                      className="profile-input"
                      value={compareSort}
                      onChange={(e) => setCompareSort(e.target.value as any)}
                    >
                      <option value="name">Game Name</option>
                      <option value="myPlaytime">My Playtime</option>
                      <option value="friendPlaytime">Friend's Playtime</option>
                    </select>
                  </div>

                  {compareGenres.length > 0 && (
                    <div className="compare-selector-group compare-sort-group">
                      <span>Genre:</span>
                      <select
                        className="profile-input"
                        value={compareGenre}
                        onChange={(e) => setCompareGenre(e.target.value)}
                      >
                        <option value="all">All Genres</option>
                        {compareGenres.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* Game comparison grid */}
                <div>
                  <div className="compare-library-title-row">
                    <h3 className="compare-library-title">Comparison List</h3>
                    <span className="compare-count">{sortedCompareData.length} games</span>
                  </div>

                  {sortedCompareData.length === 0 ? (
                    <div className="game-search-no-results" style={{ padding: "40px" }}>
                      No games match this filter criteria.
                    </div>
                  ) : (
                    <div className="compare-games-grid">
                      {sortedCompareData.map((game) => {
                        const maxPlayTime = Math.max(game.playTimeMe, game.playTimeFriend, 1);
                        const myPlayPercent = (game.playTimeMe / maxPlayTime) * 100;
                        const friendPlayPercent = (game.playTimeFriend / maxPlayTime) * 100;

                        return (
                          <div key={game.id} className="compare-game-card">
                            <div className="compare-game-card-head">
                              <span className="compare-game-name" title={game.name}>{game.name}</span>
                              <span className={`compare-own-badge ${
                                game.ownedByMe && game.ownedByFriend
                                  ? "both"
                                  : game.ownedByMe
                                  ? "me"
                                  : "friend"
                              }`}>
                                {game.ownedByMe && game.ownedByFriend
                                  ? "Both Own"
                                  : game.ownedByMe
                                  ? "You Own"
                                  : "They Own"}
                              </span>
                            </div>

                            <div className="compare-game-stats">
                              <div className="compare-player-stat">
                                <div className="compare-player-label">
                                  <span className="dot left" /> You
                                </div>
                                {game.ownedByMe ? (
                                  <>
                                    <div className="compare-bar-row">
                                      <span className="compare-bar-value">{formatHours(game.playTimeMe)}</span>
                                      <div className="compare-playtime-bar">
                                        <div className="compare-playtime-fill left" style={{ width: `${myPlayPercent}%` }} />
                                      </div>
                                    </div>
                                    <span className="compare-ach">{game.achievementMe}% achievements</span>
                                  </>
                                ) : (
                                  <span className="compare-not-owned">Not in your library</span>
                                )}
                              </div>

                              <div className="compare-player-stat">
                                <div className="compare-player-label">
                                  <span className="dot right" /> {compareFriend.name}
                                </div>
                                {game.ownedByFriend ? (
                                  <>
                                    <div className="compare-bar-row">
                                      <span className="compare-bar-value">{formatHours(game.playTimeFriend)}</span>
                                      <div className="compare-playtime-bar">
                                        <div className="compare-playtime-fill right" style={{ width: `${friendPlayPercent}%` }} />
                                      </div>
                                    </div>
                                    <span className="compare-ach">{game.achievementFriend}% achievements</span>
                                  </>
                                ) : (
                                  <span className="compare-not-owned">Not in their library</span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Tab 5: My Profile */}
        {activeTab === "profile" && (
          <div className="profile-editor-layout">
            <div className="profile-summary-section">
              <div className="profile-card-preview">
                <div className="profile-avatar-big">
                  {renderAvatar(profile.avatar, profile.name)}
                </div>
                <h3 className="profile-name-big">{profile.name}</h3>
                <p className="profile-status-big">"{profile.status}"</p>
                <p className="profile-last-active-big" title="Last time your outbox was published">
                  🟢 Last active: {profile.lastPublished ? formatLastSeen(profile.lastPublished) : "Just now"}
                </p>
                {profile.region && (
                  <p className="profile-region-big">📍 {profile.region}</p>
                )}
                {profile.bio && (
                  <p className="profile-bio-big">{profile.bio}</p>
                )}

                <div className="profile-stats-grid">
                  <div className="profile-stat-box">
                    <span className="profile-stat-num">{selfStats.gamesCount}</span>
                    <span className="profile-stat-label">Games</span>
                  </div>
                  <div className="profile-stat-box">
                    <span className="profile-stat-num">
                      {formatHours(selfStats.playtimeMinutes)}
                    </span>
                    <span className="profile-stat-label">Played</span>
                  </div>
                  <div className="profile-stat-box">
                    <span className="profile-stat-num">{selfStats.achievementsCount}</span>
                    <span className="profile-stat-label">Trophies</span>
                  </div>
                </div>
              </div>

              <div className="friend-code-card">
                <h4 className="friend-code-label">My Friend Code</h4>
                <p className="friends-modal-desc">
                  Share this code with your friends so they can add you to their network.
                </p>
                <div className="friend-code-qr">
                  <FriendCodeQR code={generatedFriendCode} />
                </div>
                <div className="friend-code-box">{generatedFriendCode}</div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleCopyCode}
                  style={{ marginTop: "4px" }}
                >
                  Copy Code
                </button>
              </div>
            </div>

            {/* Right form editor */}
            <div className="profile-edit-section">
              <h3 className="profile-edit-title">Edit Gamer Profile</h3>
              <form className="profile-form" onSubmit={handleSaveProfile}>
                <div className="friends-input-group">
                  <label htmlFor="profileNameInput">Gamer Tag</label>
                  <input
                    type="text"
                    id="profileNameInput"
                    className="profile-input"
                    value={profile.name}
                    onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                    placeholder="Enter name..."
                    required
                  />
                </div>

                <div className="friends-input-group">
                  <label htmlFor="profileStatusInput">Current Status</label>
                  <input
                    type="text"
                    id="profileStatusInput"
                    className="profile-input"
                    value={profile.status}
                    onChange={(e) => setProfile({ ...profile, status: e.target.value })}
                    placeholder="E.g., Ready to play, Away..."
                  />
                  <div className="status-preset-row">
                    {STATUS_PRESETS.map((preset) => (
                      <button
                        key={preset.value}
                        type="button"
                        className={`status-preset-chip${profile.status === preset.value ? " active" : ""}`}
                        onClick={() => setProfile({ ...profile, status: preset.value })}
                        title={preset.label}
                      >
                        {preset.emoji}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="friends-input-group">
                  <label htmlFor="profileRegionInput">Region</label>
                  <input
                    type="text"
                    id="profileRegionInput"
                    className="profile-input"
                    value={profile.region || ""}
                    onChange={(e) => setProfile({ ...profile, region: e.target.value })}
                    placeholder="E.g., EU-West, North America..."
                  />
                </div>

                <div className="friends-input-group">
                  <label htmlFor="profileBioInput">Bio</label>
                  <textarea
                    id="profileBioInput"
                    className="profile-input"
                    style={{ height: "70px", resize: "none" }}
                    value={profile.bio || ""}
                    onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                    placeholder="Tell your friends a bit about yourself..."
                  />
                </div>

                <div className="friends-input-group">
                  <label htmlFor="favoriteGameSelectInput">Favorite Game</label>
                  <select
                    id="favoriteGameSelectInput"
                    className="profile-input"
                    value={profile.favoriteGameId || ""}
                    onChange={(e) => {
                      const gameId = e.target.value;
                      const selectedGame = games.find((g) => g.id === gameId);
                      setProfile({
                        ...profile,
                        favoriteGameId: gameId,
                        favoriteGameName: selectedGame ? selectedGame.name : "",
                      });
                    }}
                  >
                    <option value="">None selected</option>
                    {games.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="avatar-selection-container">
                  <label>Avatar Visual Style</label>
                  <div className="avatar-upload-box">
                    <label htmlFor="avatar-file-upload-input" className="avatar-upload-label">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                      Upload custom picture
                    </label>
                    <input
                      type="file"
                      id="avatar-file-upload-input"
                      accept="image/*"
                      onChange={handleImageUpload}
                      style={{ display: "none" }}
                    />
                    
                    {profile.avatar !== "procedural" && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={async () => {
                          const updated = { ...profile, avatar: "procedural" };
                          setProfile(updated);
                          saveUserProfile(updated);
                          await pushMyOutbox(updated, selfStats, sessions, recommendations, selfSharedGames);
                        }}
                        style={{ fontSize: "11px", padding: "4px 10px" }}
                      >
                        Reset to Procedural
                      </button>
                    )}
                    <span className="avatar-upload-info">Procedural avatars are generated dynamically from your tag.</span>
                  </div>
                </div>

                <button type="submit" className="btn btn-primary" style={{ alignSelf: "flex-start" }}>
                  Save Profile
                </button>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* Add Friend Modal Overlay */}
      {showAddModal && (
        <div className="friends-modal-overlay" onClick={() => setShowAddModal(false)}>
          <div
            className="friends-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="friends-modal-title">Add a Friend</h3>
            <p className="friends-modal-desc">
              Paste your friend's Gamelib Friend Code below.
            </p>
            <button
              type="button"
              className="friends-modal-close-btn"
              onClick={() => setShowAddModal(false)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="16" height="16">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>

            <div className="friends-modal-body">
              <div className="friends-input-group">
                <label htmlFor="friendCodeInputArea">Friend Code</label>
                <textarea
                  id="friendCodeInputArea"
                  className="friends-textarea"
                  value={friendCodeInput}
                  onChange={(e) => setFriendCodeInput(e.target.value)}
                  placeholder="Paste GMLF-code here..."
                />
              </div>

              {decodedFriend ? (
                <div className="friend-decode-preview">
                  {renderAvatar(decodedFriend.avatar, decodedFriend.name)}
                  <div className="friend-info">
                    <div className="friend-name">{decodedFriend.name}</div>
                    <div className="friend-status-text">{decodedFriend.status}</div>
                    {decodedFriend.libStats && (
                      <div className="friend-stats">
                        <span>{decodedFriend.libStats.gamesCount} games</span>
                        <span>•</span>
                        <span>{formatHours(decodedFriend.libStats.playtimeMinutes)}</span>
                        {decodedFriend.libStats.achievementsCount > 0 && (
                          <>
                            <span>•</span>
                            <span>🏆 {decodedFriend.libStats.achievementsCount}</span>
                          </>
                        )}
                      </div>
                    )}
                    {decodedFriend.favoriteGame && (
                      <div className="friend-favorite-game">
                        ⭐ {decodedFriend.favoriteGame}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                friendCodeInput.trim() && (
                  <div className="friend-decode-preview-empty" style={{ color: "var(--color-danger)" }}>
                    Invalid Friend Code. Ensure you copied the entire GMLF code.
                  </div>
                )
              )}
            </div>

            <div className="friends-modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowAddModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleAddFriend}
                disabled={!decodedFriend}
              >
                Add Friend
              </button>
            </div>
          </div>
        </div>
      )}

      {/* P2P Sync Modal Overlay */}
      {showP2pModal && (
        <div className="friends-modal-overlay" onClick={() => setShowP2pModal(false)}>
          <div
            className="friends-modal-content p2p-modal-content"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "480px" }}
          >
            <h3 className="friends-modal-title">Automatic Internet Sync</h3>
            <p className="friends-modal-desc">
              GameLib synchronizes sessions and recommendations with your friends in the background using direct peer-to-peer connections.
            </p>
            <button
              type="button"
              className="friends-modal-close-btn"
              onClick={() => setShowP2pModal(false)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="16" height="16">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>

            <div className="friends-modal-body p2p-modal-body p2p-modal-flex">
              <div className="p2p-status-card">
                <div className="p2p-status-row">
                  <span className="p2p-status-label">Background Sync Status</span>
                  <span className={`p2p-status-badge${internetSyncStatus?.externalIp ? " online" : " offline"}`}>
                    {internetSyncStatus?.externalIp ? "ONLINE" : "OFFLINE"}
                  </span>
                </div>

                <div className="p2p-status-details">
                  <div className="p2p-detail-row">
                    <span className="p2p-detail-key">External IP:</span>
                    <span className="p2p-detail-val">{internetSyncStatus?.externalIp || "Resolving..."}</span>
                  </div>
                  <div className="p2p-detail-row">
                    <span className="p2p-detail-key">Bound Port:</span>
                    <span className="p2p-detail-val">{internetSyncStatus?.boundPort || "Resolving..."}</span>
                  </div>
                  <div className="p2p-detail-row">
                    <span className="p2p-detail-key">UPnP Router Mapping:</span>
                    <span className={internetSyncStatus?.upnpMapped ? "p2p-mapped-ok" : "p2p-detail-key"}>
                      {internetSyncStatus?.upnpMapped ? "✅ Configured" : "⚠️ Disabled / Not Routeable"}
                    </span>
                  </div>
                </div>

                {internetSyncStatus?.errorMessage && (
                  <div className="p2p-error-box">
                    {internetSyncStatus.errorMessage}
                  </div>
                )}
              </div>

              <div className="p2p-friend-sync-block">
                <h4 className="p2p-section-title">Friend Sync Status</h4>
                <div className="p2p-friend-list">
                  {friends.length === 0 ? (
                    <div className="p2p-empty-note">
                      No friends added yet. Share friend codes to start syncing!
                    </div>
                  ) : (
                    friends.map((friend) => {
                      const lastSyncSecs = internetSyncStatus?.lastSyncedTimes?.[friend.syncId];
                      let syncText = "Never";
                      if (lastSyncSecs) {
                        const diffMins = Math.floor((Date.now() / 1000 - lastSyncSecs) / 60);
                        if (diffMins < 1) {
                          syncText = "Just now";
                        } else if (diffMins < 60) {
                          syncText = `${diffMins}m ago`;
                        } else {
                          const diffHours = Math.floor(diffMins / 60);
                          syncText = `${diffHours}h ago`;
                        }
                      }
                      return (
                        <div key={friend.id} className="p2p-friend-row">
                          <span>{friend.name}</span>
                          <span className={lastSyncSecs ? "p2p-last-sync-ok" : "p2p-last-sync-muted"}>
                            Last Sync: {syncText}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="p2p-sync-log-block">
                <h4 className="p2p-section-title">Recent Sync Activity</h4>
                {syncLog.length === 0 ? (
                  <div className="p2p-empty-note">No sync activity yet.</div>
                ) : (
                  <div className="p2p-sync-log">
                    {syncLog.map((entry, i) => (
                      <div key={i} className="p2p-log-entry">
                        <div className="p2p-log-row">
                          <span className="p2p-log-time">{entry.time}</span>
                          <span className="p2p-log-msg">{entry.message}</span>
                        </div>
                        {entry.details.length > 0 && (
                          <ul className="p2p-log-details">
                            {entry.details.map((d, j) => (
                              <li key={j} className="p2p-log-detail">{d}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                className="btn btn-primary p2p-sync-now-btn"
                onClick={async () => {
                  try {
                    await invoke("trigger_internet_sync");
                    showToast("Sync triggered! Contacting friends in background...", "success");
                  } catch (e) {
                    showToast(`Sync trigger failed: ${e}`, "error");
                  }
                }}
              >
                🔄 Sync Now
              </button>
            </div>

            <div className="friends-modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowP2pModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
