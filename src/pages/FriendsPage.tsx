import { useState, useMemo, useEffect, useRef } from "react";
import { useGames } from "../context/GameContext";
import { useAchievements } from "../context/AchievementContext";
import { useToast } from "../context/ToastContext";
import { parsePlayTime } from "../types/game";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  UserProfile,
  Friend,
  GameSession,
  GameRecommendation,
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
  listPeerOutboxes,
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
  const { games } = useGames();
  const { cache } = useAchievements();
  const { showToast } = useToast();

  // Multi-profile variables — single fixed profile ("A") is the only one used.
  const profileName = "A";

  // Load state (scoped by active profile)
  const [profile, setProfile] = useState<UserProfile>(() => loadUserProfile());
  const [friends, setFriends] = useState<Friend[]>(() => loadFriends());
  const [sessions, setSessions] = useState<GameSession[]>(() => loadSessions());
  const [recommendations, setRecommendations] = useState<GameRecommendation[]>(() => loadRecommendations());

  // Network Sync States
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedTime, setLastSyncedTime] = useState<string>("Never");

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

  // Compare Tab States
  const [selectedCompareFriendId, setSelectedCompareFriendId] = useState<string>("");
  const [compareFilter, setCompareFilter] = useState<"all" | "shared" | "me_only" | "friend_only">("all");
  const [compareSort, setCompareSort] = useState<"name" | "myPlaytime" | "friendPlaytime">("name");

  // Create Session Form State
  const [sessionGameId, setSessionGameId] = useState("");
  const [sessionDateTime, setSessionDateTime] = useState("");
  const [sessionMaxPlayers, setSessionMaxPlayers] = useState(4);
  const [sessionDesc, setSessionDesc] = useState("");

  // Create Recommendation Form State
  const [recGameId, setRecGameId] = useState("");
  const [recToFriend, setRecToFriend] = useState("All Friends");
  const [recRating, setRecRating] = useState(5);
  const [recReason, setRecReason] = useState("");

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

  // Generate User's Friend Code
  const generatedFriendCode = useMemo(() => {
    return encodeFriendCode(profile, selfStats, profile.favoriteGameName);
  }, [profile, selfStats]);

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

  const performSync = async (manual = false) => {
    if (isSyncing) return;
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
    let localFriends = loadFriends();

    // Auto-discover peers in the sync folder and add any we don't know yet.
    const peers = await listPeerOutboxes();
    let discoveredNew = false;
    const knownIds = new Set(localFriends.map((f) => f.syncId));
    for (const peerId of peers) {
      if (!knownIds.has(peerId)) {
        const ob = await fetchFriendOutbox(peerId);
        if (ob && ob.profile) {
          const newFriend: Friend = {
            id: `friend_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: ob.profile.name || "Friend",
            avatar: ob.profile.avatar || "procedural",
            status: ob.profile.status || "Offline",
            favoriteGame: ob.profile.favoriteGame || undefined,
            libStats: ob.profile.libStats,
            addedAt: Date.now(),
            syncId: peerId,
          };
          localFriends = [...localFriends, newFriend];
          knownIds.add(peerId);
          discoveredNew = true;
        }
      }
    }
    if (discoveredNew) {
      saveFriends(localFriends);
      setFriends(localFriends);
    }

    let changesMade = false;
    let friendsUpdated = false;
    let pulledSessions = 0;
    let pulledRecs = 0;
    const pullErrors: string[] = [];

    let mergedSessions = [...localSessions];
    let mergedRecs = [...localRecs];

    // Read the outbox of each friend from the sync folder
    const updatedFriends: Friend[] = [];
    for (const friend of localFriends) {
      try {
        const remoteOutbox = await fetchFriendOutbox(friend.syncId);
        if (remoteOutbox) {
          // Merge sessions
          if (remoteOutbox.sessions && remoteOutbox.sessions.length > 0) {
            const prevLength = mergedSessions.length;
            mergedSessions = mergeSessions(mergedSessions, remoteOutbox.sessions);
            if (mergedSessions.length !== prevLength || JSON.stringify(mergedSessions) !== localStorage.getItem(`gamelib.friends.sessions.${profileName}`)) {
              changesMade = true;
              pulledSessions += remoteOutbox.sessions.length;
            }
          }

          // Merge recommendations
          if (remoteOutbox.recommendations && remoteOutbox.recommendations.length > 0) {
            const prevLength = mergedRecs.length;
            mergedRecs = mergeRecommendations(mergedRecs, remoteOutbox.recommendations);
            if (mergedRecs.length !== prevLength || JSON.stringify(mergedRecs) !== localStorage.getItem(`gamelib.friends.recommendations.${profileName}`)) {
              changesMade = true;
              pulledRecs += remoteOutbox.recommendations.length;
            }
          }

          // Sync friend profile information and live statistics (playtime, achievements, status)
          if (remoteOutbox.profile) {
            const hasDiff =
              friend.name !== remoteOutbox.profile.name ||
              friend.avatar !== remoteOutbox.profile.avatar ||
              friend.status !== remoteOutbox.profile.status ||
              friend.favoriteGame !== remoteOutbox.profile.favoriteGame ||
              JSON.stringify(friend.libStats) !== JSON.stringify(remoteOutbox.profile.libStats);

            if (hasDiff) {
              friendsUpdated = true;
              updatedFriends.push({
                ...friend,
                name: remoteOutbox.profile.name,
                avatar: remoteOutbox.profile.avatar,
                status: remoteOutbox.profile.status,
                favoriteGame: remoteOutbox.profile.favoriteGame || undefined,
                libStats: remoteOutbox.profile.libStats,
              });
              continue;
            }
          }
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        pullErrors.push(`${friend.name}: ${reason}`);
        console.error(`Sync error for friend ${friend.name}:`, reason);
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

    setLastSyncedTime(new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }));

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
  };

  // Run initial sync on mount
  useEffect(() => {
    performSync(false);
  }, [profile.syncId, profileName]);

  // Background polling timer (runs every 5 seconds for fast local responsiveness)
  useEffect(() => {
    const interval = setInterval(() => {
      performSync(false);
    }, 5000);

    return () => {
      clearInterval(interval);
    };
  }, [friends, profile.syncId, profileName]);

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
            pushMyOutbox(updated, selfStats, sessions, recommendations);
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
    await pushMyOutbox(profile, selfStats, sessions, recommendations);
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
      id: `session_${Date.now()}`,
      gameId: sessionGameId,
      gameName: game.name,
      scheduledAt: sessionDateTime,
      maxPlayers: Number(sessionMaxPlayers) || 4,
      description: sessionDesc,
      creatorName: profile.name,
      attendees: [profile.name],
      updatedAt: Date.now(),
    };

    const updated = [newSession, ...sessions];
    setSessions(updated);
    saveSessions(updated);
    await pushMyOutbox(profile, selfStats, updated, recommendations);
    showToast("Game session scheduled!", "success");

    // Reset Form
    setSessionGameId("");
    setSessionDateTime("");
    setSessionMaxPlayers(4);
    setSessionDesc("");
  };

  const handleToggleJoinSession = async (sessionId: string) => {
    const updated = sessions.map((s) => {
      if (s.id !== sessionId) return s;

      const isAttending = s.attendees.includes(profile.name);
      if (isAttending) {
        const filtered = s.attendees.filter((name) => name !== profile.name);
        showToast("Left session.", "info");
        return { ...s, attendees: filtered, updatedAt: Date.now() };
      } else {
        if (s.attendees.length >= s.maxPlayers) {
          showToast("Session is already full!", "error");
          return s;
        }
        showToast("Joined session!", "success");
        return { ...s, attendees: [...s.attendees, profile.name], updatedAt: Date.now() };
      }
    });

    setSessions(updated);
    saveSessions(updated);
    await pushMyOutbox(profile, selfStats, updated, recommendations);
  };

  const handleCancelSession = async (sessionId: string) => {
    const updated = sessions.map((s) => {
      if (s.id === sessionId) {
        return { ...s, deleted: true, updatedAt: Date.now() };
      }
      return s;
    });
    setSessions(updated);
    saveSessions(updated);
    await pushMyOutbox(profile, selfStats, updated, recommendations);
    showToast("Session cancelled.", "info");
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

  // ── Game Comparison Logic ────────────────────────────────────────

  const compareFriend = useMemo(() => {
    return friends.find((f) => f.id === selectedCompareFriendId) || null;
  }, [friends, selectedCompareFriendId]);

  // Procedural Library Generator (seeded by name)
  const comparisonData = useMemo(() => {
    if (!compareFriend) return [];

    const friendName = compareFriend.name;
    let hash = 0;
    for (let i = 0; i < friendName.length; i++) {
      hash = friendName.charCodeAt(i) + ((hash << 5) - hash);
    }
    let seed = Math.abs(hash);
    function prng() {
      const x = Math.sin(seed++) * 10000;
      return x - Math.floor(x);
    }

    const popularGames = [
      { id: "pop_1", name: "Elden Ring" },
      { id: "pop_2", name: "The Witcher 3: Wild Hunt" },
      { id: "pop_3", name: "Red Dead Redemption 2" },
      { id: "pop_4", name: "Grand Theft Auto V" },
      { id: "pop_5", name: "Baldur's Gate 3" },
      { id: "pop_6", name: "Hades" },
      { id: "pop_7", name: "Hollow Knight" },
      { id: "pop_8", name: "Cyberpunk 2077" },
    ];

    const compareList: any[] = [];

    games.forEach((game) => {
      const owned = prng() > 0.45;
      const playTimeMin = owned ? Math.floor(prng() * 12000) + 120 : 0;
      const achievementPercent = owned ? Math.floor(prng() * 100) : 0;

      const selfAchData = cache?.games?.[game.id];
      const selfAchCount = selfAchData?.unlocked || 0;
      const selfAchTotal = selfAchData?.total || 0;
      const selfAchPercent = selfAchTotal > 0 ? Math.round((selfAchCount / selfAchTotal) * 100) : 0;

      compareList.push({
        id: game.id,
        name: game.name,
        ownedByMe: true,
        ownedByFriend: owned,
        playTimeMe: parsePlayTime(game.playTime),
        playTimeFriend: playTimeMin,
        achievementMe: selfAchPercent,
        achievementFriend: achievementPercent,
      });
    });

    popularGames.forEach((pop) => {
      if (games.some((g) => g.name.toLowerCase() === pop.name.toLowerCase())) return;

      if (prng() > 0.4) {
        const playTimeMin = Math.floor(prng() * 9000) + 180;
        const achievementPercent = Math.floor(prng() * 100);

        compareList.push({
          id: pop.id,
          name: pop.name,
          ownedByMe: false,
          ownedByFriend: true,
          playTimeMe: 0,
          playTimeFriend: playTimeMin,
          achievementMe: 0,
          achievementFriend: achievementPercent,
        });
      }
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
      return true;
    });
  }, [comparisonData, compareFilter]);

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
              <div className="friends-grid">
                {friends.map((friend) => (
                  <div
                    key={friend.id}
                    className={`friend-card hover-lift status-${
                      friend.status.toLowerCase().includes("online") ||
                      friend.status.toLowerCase().includes("playing")
                        ? "online"
                        : "offline"
                    }`}
                  >
                    {renderAvatar(friend.avatar, friend.name)}
                    <div className="friend-info">
                      <div className="friend-name">{friend.name}</div>
                      <div className="friend-status-text" title={friend.status}>
                        {friend.status}
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
                    </div>
                    <button
                      type="button"
                      className="friend-delete-btn"
                      title={`Remove ${friend.name}`}
                      onClick={() => handleDeleteFriend(friend.id, friend.name)}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                ))}
              </div>
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
                <h3 className="friends-list-title">Upcoming Sessions ({sessions.filter(s => !s.deleted).length})</h3>

                {sessions.filter(s => !s.deleted).length === 0 ? (
                  <div className="friends-empty-state" style={{ margin: "0", maxWidth: "100%" }}>
                    <h3 className="friends-empty-title">No Events Scheduled</h3>
                    <p className="friends-empty-desc">
                      Create an event on the left to plan game sessions. It will sync automatically to all friends!
                    </p>
                  </div>
                ) : (
                  <div className="sessions-grid">
                    {sessions.filter(s => !s.deleted).map((session) => {
                      const isCreator = session.creatorName === profile.name;
                      const isJoined = session.attendees.includes(profile.name);

                      return (
                        <div key={session.id} className="session-card">
                          <div className="session-header">
                            <div>
                              <div className="session-game-title">{session.gameName}</div>
                              <div className="session-date">{formatDateTime(session.scheduledAt)}</div>
                            </div>
                            {isCreator && (
                              <button
                                type="button"
                                className="friend-delete-btn"
                                style={{ opacity: 1, position: "static" }}
                                onClick={() => handleCancelSession(session.id)}
                                title="Cancel Session"
                              >
                                <TrashIcon />
                              </button>
                            )}
                          </div>
                          
                          {session.description && (
                            <p className="session-desc">{session.description}</p>
                          )}

                          <div className="session-attendees">
                            {session.attendees.map((name, i) => (
                              <span
                                key={i}
                                className={`attendee-badge${name === profile.name ? " self" : ""}`}
                              >
                                {name}
                              </span>
                            ))}
                          </div>

                          <div className="session-footer">
                            <span className="session-players-count">
                              👥 {session.attendees.length} / {session.maxPlayers} players
                            </span>
                            <span className="session-creator">
                              By {isCreator ? "me" : session.creatorName}
                            </span>
                          </div>

                          {!isCreator && (
                            <button
                              type="button"
                              className={`btn btn-${isJoined ? "secondary" : "primary"}`}
                              onClick={() => handleToggleJoinSession(session.id)}
                              style={{ width: "100%", fontSize: "11px", padding: "4px" }}
                            >
                              {isJoined ? "Leave Session" : "Join Session"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
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

                {recommendations.length === 0 ? (
                  <div className="friends-empty-state" style={{ margin: "0", maxWidth: "100%" }}>
                    <h3 className="friends-empty-title">No Recommendations Yet</h3>
                    <p className="friends-empty-desc">
                      Recommend a game on the right. Your reviews and comments will sync with friends automatically!
                    </p>
                  </div>
                ) : (
                  recommendations.map((rec) => (
                    <div key={rec.id} className="rec-card">
                      <div className="rec-header">
                        <div className="rec-meta">
                          <span className="rec-game">{rec.gameName}</span>
                          <span className="rec-author">
                            Recommended by <strong>{rec.recommendedBy}</strong> to <em>{rec.recommendedTo}</em>
                          </span>
                        </div>
                        <div className="rating-stars">
                          {Array.from({ length: 5 }).map((_, idx) => (
                            <span key={idx} className={idx < rec.rating ? "active" : ""}>
                              ★
                            </span>
                          ))}
                        </div>
                      </div>

                      <p className="rec-reason">"{rec.reason}"</p>

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
                  ))
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
                  </div>
                  <div className="compare-vs-badge">VS</div>
                  <div className="compare-user-profile right">
                    {renderAvatar(compareFriend.avatar, compareFriend.name, "compare-user-avatar friend")}
                    <span className="compare-user-name">{compareFriend.name}</span>
                  </div>
                </div>

                {/* KPI stats */}
                {comparisonSummary && (
                  <div className="compare-stats-card">
                    <div className="compare-stats-row">
                      <span className="compare-stat-val left">{selfStats.gamesCount}</span>
                      <span className="compare-stat-title">Games Owned</span>
                      <span className="compare-stat-val right">{compareFriend.libStats?.gamesCount || 0}</span>
                    </div>

                    <div className="compare-stats-row">
                      <span className="compare-stat-val left">{comparisonSummary.sharedCount}</span>
                      <span className="compare-stat-title">Shared Games</span>
                      <span className="compare-stat-val right">{comparisonSummary.sharedCount}</span>
                    </div>

                    <div className="compare-stats-row">
                      <span className="compare-stat-val left">{formatHours(selfStats.playtimeMinutes)}</span>
                      <span className="compare-stat-title">Total Playtime</span>
                      <span className="compare-stat-val right">{formatHours(compareFriend.libStats?.playtimeMinutes || 0)}</span>
                    </div>

                    <div className="compare-stats-row">
                      <span className="compare-stat-val left">{comparisonSummary.averageMyAchievements}%</span>
                      <span className="compare-stat-title">Avg Achievements</span>
                      <span className="compare-stat-val right">{comparisonSummary.averageFriendAchievements}%</span>
                    </div>
                  </div>
                )}

                {/* Filter and Sort Chips Row */}
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "var(--space-md)", alignItems: "center" }}>
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

                  <div className="compare-selector-group" style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                    <span>Sort:</span>
                    <select
                      className="profile-input"
                      style={{ width: "130px", fontSize: "11px", padding: "2px 6px" }}
                      value={compareSort}
                      onChange={(e) => setCompareSort(e.target.value as any)}
                    >
                      <option value="name">Game Name</option>
                      <option value="myPlaytime">My Playtime</option>
                      <option value="friendPlaytime">Friend's Playtime</option>
                    </select>
                  </div>
                </div>

                {/* Grid breakdown */}
                <div>
                  <div className="compare-library-title-row">
                    <h3 className="compare-library-title">Comparison List</h3>
                  </div>
                  <div className="compare-library-table">
                    <div className="compare-table-row header">
                      <span>Game Name</span>
                      <span>My Stats (Completion)</span>
                      <span>{compareFriend.name}'s Stats</span>
                    </div>
                    {sortedCompareData.length === 0 ? (
                      <div className="game-search-no-results" style={{ padding: "40px" }}>
                        No games match this filter criteria.
                      </div>
                    ) : (
                      sortedCompareData.map((game, i) => {
                        const maxPlayTime = Math.max(game.playTimeMe, game.playTimeFriend, 1);
                        const myPlayPercent = (game.playTimeMe / maxPlayTime) * 100;
                        const friendPlayPercent = (game.playTimeFriend / maxPlayTime) * 100;

                        return (
                          <div key={i} className="compare-table-row">
                            <div className="compare-game-name">
                              {game.name}
                              <div style={{ fontSize: "10px", color: "var(--color-text-muted)", marginTop: "2px" }}>
                                {game.ownedByMe && game.ownedByFriend ? (
                                  <span style={{ color: "var(--color-success)" }}>✓ Both Own</span>
                                ) : game.ownedByMe ? (
                                  <span>Only you own</span>
                                ) : (
                                  <span>Only friend owns</span>
                                )}
                              </div>
                            </div>

                            <div className="compare-playtime-bar-container">
                              {game.ownedByMe ? (
                                <>
                                  <span style={{ fontSize: "11px", color: "var(--color-text-primary)" }}>
                                    {formatHours(game.playTimeMe)} ({game.achievementMe}%)
                                  </span>
                                  <div className="compare-playtime-bar">
                                    <div
                                      className="compare-playtime-fill left"
                                      style={{ width: `${myPlayPercent}%` }}
                                    />
                                  </div>
                                </>
                              ) : (
                                <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>— Not owned</span>
                              )}
                            </div>

                            <div className="compare-playtime-bar-container">
                              {game.ownedByFriend ? (
                                <>
                                  <span style={{ fontSize: "11px", color: "var(--color-text-primary)" }}>
                                    {formatHours(game.playTimeFriend)} ({game.achievementFriend}%)
                                  </span>
                                  <div className="compare-playtime-bar">
                                    <div
                                      className="compare-playtime-fill right"
                                      style={{ width: `${friendPlayPercent}%` }}
                                    />
                                  </div>
                                </>
                              ) : (
                                <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>— Not owned</span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
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
                          await pushMyOutbox(updated, selfStats, sessions, recommendations);
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

            <div className="friends-modal-body p2p-modal-body" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="p2p-status-card" style={{ padding: "16px", background: "rgba(255, 255, 255, 0.02)", borderRadius: "8px", border: "1px solid var(--color-border)", display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Background Sync Status</span>
                  <span className="badge" style={{
                    background: internetSyncStatus?.externalIp ? "rgba(46, 204, 113, 0.15)" : "rgba(231, 76, 60, 0.15)",
                    color: internetSyncStatus?.externalIp ? "#2ecc71" : "#e74c3c",
                    padding: "4px 8px",
                    borderRadius: "4px",
                    fontSize: "11px",
                    fontWeight: "bold"
                  }}>
                    {internetSyncStatus?.externalIp ? "ONLINE" : "OFFLINE"}
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--color-text-muted)" }}>External IP:</span>
                    <span style={{ fontFamily: "monospace" }}>{internetSyncStatus?.externalIp || "Resolving..."}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--color-text-muted)" }}>Bound Port:</span>
                    <span>{internetSyncStatus?.boundPort || "Resolving..."}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--color-text-muted)" }}>UPnP Router Mapping:</span>
                    <span style={{ color: internetSyncStatus?.upnpMapped ? "#2ecc71" : "var(--color-text-muted)" }}>
                      {internetSyncStatus?.upnpMapped ? "✅ Configured" : "⚠️ Disabled / Not Routeable"}
                    </span>
                  </div>
                </div>

                {internetSyncStatus?.errorMessage && (
                  <div style={{ padding: "10px", background: "rgba(231, 76, 60, 0.1)", borderLeft: "3px solid #e74c3c", borderRadius: "4px", fontSize: "12px", color: "#e74c3c" }}>
                    {internetSyncStatus.errorMessage}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <h4 style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--color-accent)", margin: "0 0 4px 0" }}>Friend Sync Status</h4>
                <div style={{ maxHeight: "150px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
                  {friends.length === 0 ? (
                    <div style={{ fontSize: "12px", color: "var(--color-text-muted)", textAlign: "center", padding: "10px" }}>
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
                        <div key={friend.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "rgba(255,255,255,0.01)", borderRadius: "4px", border: "1px solid rgba(255,255,255,0.03)", fontSize: "13px" }}>
                          <span>{friend.name}</span>
                          <span style={{ fontSize: "11px", color: lastSyncSecs ? "var(--color-success)" : "var(--color-text-muted)" }}>
                            Last Sync: {syncText}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <button
                type="button"
                className="btn btn-primary"
                style={{ width: "100%", padding: "10px", display: "flex", justifyContent: "center", alignItems: "center", gap: "8px" }}
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
