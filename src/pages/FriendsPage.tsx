import { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useGames } from "../context/GameContext";
import { useAchievements } from "../context/AchievementContext";
import { useToast } from "../context/ToastContext";
import { useWishlistContext } from "../context/WishlistContext";
import { consumePendingSuggestion } from "./friendSuggestionSignal";
import { parsePlayTime } from "../types/game";
import type { StoreGameSummary } from "../types/game";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import QRCode from "qrcode";
import { SimplePool } from "nostr-tools/pool";
import { finalizeEvent, verifyEvent } from "nostr-tools/pure";
import {
  UserProfile,
  Friend,
  GameSession,
  GameRecommendation,
  GameSuggestion,
  SuggestionComment,
  SuggestionReactionKind,
  SessionRole,
  SessionMessage,
  displayName,
  STATUS_PRESETS,
  SharedGameStat,
  ReactionKind,
  RsvpStatus,
  loadUserProfile,
  saveUserProfile,
  loadFriends,
  saveFriends,
  loadSessions,
  saveSessions,
  loadRecommendations,
  saveRecommendations,
  loadSuggestions,
  saveSuggestions,
  mergeSuggestions,
  encodeFriendCode,
  decodeFriendCode,
  getProceduralAvatarStyle,
  getInitials,
  mergeSessions,
  mergeRecommendations,
  setDeviceId,
  getSyncFolder,
  fetchFriendOutbox,
  pushMyOutbox as pushMyOutboxStorage,
  loadFriendsDbToLocalStorage,
  FriendsDatabase,
  mergeDatabases,
  listPeerOutboxes,
  getNostrKeys,
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

// Suggestion (share from wishlist) Icon
function SuggestionIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <circle cx="12" cy="14.5" r="0.6" fill="currentColor" />
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

// Leaderboard / Trophy Icon
function LeaderboardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
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

// ── Session Card Component ──────────────────────────────────────────
// Renders a single session with RSVP controls, attendee roles, timezone
// aware time, countdown, +1 guests, conflict warning and a chat thread.

const SESSION_ROLE_ORDER: SessionRole[] = ["host", "cohost", "player"];

function SessionCard({
  session,
  profile,
  friends,
  viewerTimezone,
  conflicting,
  onRsvp,
  onDelete,
  onSetRole,
  onAddGuest,
  onRemoveGuest,
  onSetRsvpNote,
  onSendMessage,
  onTogglePinMessage,
  gameCover,
}: {
  session: GameSession;
  profile: UserProfile;
  friends: Friend[];
  viewerTimezone?: string;
  conflicting?: GameSession;
  gameCover?: string;
  onRsvp: (sessionId: string, status: RsvpStatus) => void;
  onDelete: (sessionId: string) => void;
  onSetRole: (sessionId: string, name: string, role: SessionRole) => void;
  onAddGuest: (sessionId: string, guestName: string) => void;
  onRemoveGuest: (sessionId: string, guestName: string) => void;
  onSetRsvpNote: (sessionId: string, note: string) => void;
  onSendMessage: (sessionId: string, text: string) => void;
  onTogglePinMessage: (sessionId: string, messageId: string) => void;
}) {
  const [now, setNow] = useState(Date.now());
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [guestDraft, setGuestDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState(session.rsvps?.[profile.name] ? session.participants?.find((p) => p.name === profile.name)?.note || "" : "");
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Tick the countdown every 30s.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (chatOpen && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatOpen, session.messages?.length]);

  const isCreator = session.creatorName === profile.name;
  const myRsvp = session.rsvps?.[profile.name];
  const canManage = isCreator || session.participants?.some((p) => p.name === profile.name && (p.role === "host" || p.role === "cohost"));

  const going = Object.entries(session.rsvps || {}).filter(([, v]) => v === "going").map(([n]) => n);
  const maybe = Object.entries(session.rsvps || {}).filter(([, v]) => v === "maybe").map(([n]) => n);
  const declined = Object.entries(session.rsvps || {}).filter(([, v]) => v === "declined").map(([n]) => n);
  const attendeeNames = going.length > 0 ? going : session.attendees;

  // Build a sorted participant list (host first) for the roster.
  const roster = [...(session.participants || [])].sort(
    (a, b) => SESSION_ROLE_ORDER.indexOf(a.role) - SESSION_ROLE_ORDER.indexOf(b.role)
  );

  const messages = session.messages || [];
  const pinned = messages.filter((m) => m.pinned);
  const thread = messages.filter((m) => !m.pinned);

  const showTimeForViewer = viewerTimezone && session.creatorTimezone && viewerTimezone !== session.creatorTimezone;

  const submitNote = () => {
    onSetRsvpNote(session.id, noteDraft.trim());
  };

  const submitGuest = () => {
    const name = guestDraft.trim();
    if (!name) return;
    onAddGuest(session.id, name);
    setGuestDraft("");
  };

  const submitChat = () => {
    const text = chatDraft.trim();
    if (!text) return;
    onSendMessage(session.id, text);
    setChatDraft("");
  };

  return (
    <div key={session.id} className={`session-card${conflicting ? " session-conflict" : ""}`}>
      <div className="session-header">
        <div className="session-header-main">
          {gameCover && (
            <img src={gameCover} alt={session.gameName} className="session-cover" loading="lazy" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
          )}
          <div>
          <div className="session-game-title">
            {session.gameName}
            {session.durationMin ? <span className="session-duration"> · {session.durationMin}m</span> : null}
          </div>
          <div className="session-date">
            {formatDateTime(session.scheduledAt, session.creatorTimezone)}
            {tzAbbrev(session.scheduledAt, session.creatorTimezone)}
            {showTimeForViewer && (
              <span className="session-date-local"> · your time: {formatDateTime(session.scheduledAt, viewerTimezone)}{tzAbbrev(session.scheduledAt, viewerTimezone)}</span>
            )}
          </div>
          {session.creatorTimezone && (
            <div className="session-tz-note">Scheduled in {session.creatorTimezone.replace(/_/g, " ")}</div>
          )}
          </div>
        </div>
        <div className="session-card-actions">
          <span className={`session-countdown${new Date(session.scheduledAt).getTime() - now <= 0 ? " live" : ""}`} title="Time until start">
            ⏱ {countdownLabel(session.scheduledAt)}
          </span>
          {isCreator && (
            <button
              type="button"
              className="friend-delete-btn"
              style={{ opacity: 1, position: "static" }}
              onClick={() => onDelete(session.id)}
              title="Remove Session"
            >
              <TrashIcon />
            </button>
          )}
        </div>
      </div>

      {session.description && <p className="session-desc">{session.description}</p>}

      {conflicting && (
        <div className="session-conflict-banner">
          ⚠ Overlaps your "{conflicting.gameName}" session at {formatDateTime(conflicting.scheduledAt, conflicting.creatorTimezone)}
        </div>
      )}

      {/* Roster with roles + guest tags */}
      <div className="session-roster">
        {roster.length > 0 ? (
          roster.map((p) => {
            const friend = friends.find((f) => f.name === p.name);
            const online = friend ? isOnline(friend) : false;
            return (
              <div key={p.name} className={`roster-row${p.name === profile.name ? " self" : ""}`}>
                <span className={`roster-dot${online ? " online" : ""}`} title={online ? "Online now" : "Offline"} />
                <span className="roster-name">{p.name}{p.guest ? " (guest)" : ""}</span>
                <span className={`roster-role role-${p.role}`}>{p.role}</span>
                {p.note && <span className="roster-note" title={p.note}>🎒 {p.note}</span>}
                {(canManage && p.name !== profile.name) && (
                  <select
                    className="roster-role-select"
                    value={p.role}
                    onChange={(e) => onSetRole(session.id, p.name, e.target.value as SessionRole)}
                    title="Change role"
                  >
                    <option value="player">Player</option>
                    <option value="cohost">Co-host</option>
                    <option value="host">Host</option>
                  </select>
                )}
                {p.guest && canManage && (
                  <button type="button" className="roster-remove" onClick={() => onRemoveGuest(session.id, p.name)} title="Remove guest">✕</button>
                )}
              </div>
            );
          })
        ) : (
          <div className="session-attendees">
            {attendeeNames.map((name, i) => (
              <span key={i} className={`attendee-badge${name === profile.name ? " self" : ""}`}>{name}</span>
            ))}
            {maybe.map((name, i) => (
              <span key={`maybe-${i}`} className="attendee-badge maybe" title="Maybe">{name}?</span>
            ))}
            {declined.map((name, i) => (
              <span key={`dec-${i}`} className="attendee-badge declined" title="Declined">{name}✕</span>
            ))}
          </div>
        )}
      </div>

      {/* +1 guest invite (open to anyone going) */}
      {myRsvp === "going" && (
        <div className="session-guest-row">
          <input
            className="profile-input session-guest-input"
            placeholder="Bring a +1 guest (name)"
            value={guestDraft}
            onChange={(e) => setGuestDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitGuest()}
          />
          <button type="button" className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: "11px" }} onClick={submitGuest}>+1</button>
        </div>
      )}

      <div className="session-footer">
        <span className="session-players-count">
          👥 {going.length} / {session.maxPlayers} going
        </span>
        <span className="session-creator">By {isCreator ? "me" : session.creatorName}</span>
      </div>

      {/* RSVP note editor */}
      {myRsvp && (
        <div className="session-note-row">
          <input
            className="profile-input session-note-input"
            placeholder="What are you bringing?"
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onBlur={submitNote}
          />
          <button type="button" className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: "11px" }} onClick={submitNote}>Save</button>
        </div>
      )}

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
        <button type="button" className={`session-chat-toggle${chatOpen ? " active" : ""}`} onClick={() => setChatOpen((v) => !v)} title="Session chat">
          💬 {messages.length > 0 ? messages.length : ""}
        </button>
      </div>

      {chatOpen && (
        <div className="session-chat">
          {pinned.length > 0 && (
            <div className="session-chat-pinned">
              {pinned.map((m) => (
                <div key={m.id} className="chat-msg pinned">
                  <span className="chat-author">{m.author}</span>
                  <span className="chat-text">{m.text}</span>
                  {canManage && (
                    <button type="button" className="chat-pin-btn" onClick={() => onTogglePinMessage(session.id, m.id)} title="Unpin">📌</button>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="session-chat-thread">
            {thread.length === 0 && pinned.length === 0 && <div className="chat-empty">No messages yet.</div>}
            {thread.map((m) => (
              <div key={m.id} className={`chat-msg${m.author === profile.name ? " mine" : ""}`}>
                <span className="chat-author">{m.author}</span>
                <span className="chat-text">{m.text}</span>
                {canManage && (
                  <button type="button" className="chat-pin-btn" onClick={() => onTogglePinMessage(session.id, m.id)} title="Pin">📌</button>
                )}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="session-chat-input">
            <input
              className="profile-input"
              placeholder="Message the group..."
              value={chatDraft}
              onChange={(e) => setChatDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitChat()}
            />
            <button type="button" className="btn btn-primary" style={{ padding: "4px 10px", fontSize: "11px" }} onClick={submitChat}>Send</button>
          </div>
        </div>
      )}
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

// Convert date string to user-friendly local date-time string.
// When `tz` (IANA timezone) is supplied the time is rendered in that zone.
function formatDateTime(dateTimeStr: string, tz?: string): string {
  try {
    const d = new Date(dateTimeStr);
    const opts: Intl.DateTimeFormatOptions = {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    };
    if (tz) {
      try {
        opts.timeZone = tz;
      } catch {
        /* invalid tz — fall back to local */
      }
    }
    return d.toLocaleString(undefined, opts);
  } catch {
    return dateTimeStr;
  }
}

/** Short timezone label like "PDT" for a given IANA zone, or "" if unknown. */
function tzAbbrev(dateTimeStr: string, tz?: string): string {
  if (!tz) return "";
  try {
    const d = new Date(dateTimeStr);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "short",
    }).formatToParts(d);
    const name = parts.find((p) => p.type === "timeZoneName")?.value;
    return name ? ` (${name})` : "";
  } catch {
    return "";
  }
}

/** Two sessions conflict when their time windows overlap. */
function sessionsConflict(
  a: { id?: string; scheduledAt: string; durationMin?: number },
  b: { id?: string; scheduledAt: string; durationMin?: number }
): boolean {
  if (a.id && b.id && a.id === b.id) return false;
  const startA = new Date(a.scheduledAt).getTime();
  const startB = new Date(b.scheduledAt).getTime();
  if (Number.isNaN(startA) || Number.isNaN(startB)) return false;
  const endA = startA + (a.durationMin || 120) * 60_000;
  const endB = startB + (b.durationMin || 120) * 60_000;
  return startA < endB && startB < endA;
}

/** Detect the viewer's IANA timezone. */
function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

/** Compact "in 3h 12m" / "2d 4h" countdown label from now to the target time. */
function countdownLabel(targetIso: string): string {
  const diff = new Date(targetIso).getTime() - Date.now();
  if (Number.isNaN(diff)) return "";
  if (diff <= 0) return "Now / live";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMin = mins % 60;
  if (hours < 24) return `in ${hours}h${remMin ? ` ${remMin}m` : ""}`;
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return `in ${days}d${remH ? ` ${remH}h` : ""}`;
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

// Rich presence label for display (online / in-game / last seen).
function presenceLabel(friend: Friend): string {
  if (friend.currentlyPlaying) return `Playing ${friend.currentlyPlaying}`;
  if (isOnline(friend)) return "Online";
  return "";
}

// Number of games the friend and the viewer both own (from shared stats).
function sharedGamesCount(friend: Friend, myGameIds: Set<string>): number {
  if (!friend.games || friend.games.length === 0) return 0;
  let count = 0;
  for (const g of friend.games) {
    if (myGameIds.has(g.id)) count++;
  }
  return count;
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

// ── Unified Game Picker (library / friend library / store search) ──────
// Lets the planner pick a game from the user's own library, a specific
// friend's shared library, or by searching the store catalog online.

function GamePicker({
  libraryGames,
  friends,
  selectedGameId,
  selectedGameName,
  onSelect,
}: {
  libraryGames: any[];
  friends: Friend[];
  selectedGameId: string;
  selectedGameName: string;
  onSelect: (game: { id: string; name: string }) => void;
}) {
  const [mode, setMode] = useState<"library" | "friend" | "store">("library");
  const [friendId, setFriendId] = useState("");
  const [search, setSearch] = useState("");
  const [storeResults, setStoreResults] = useState<StoreGameSummary[]>([]);
  const [storeLoading, setStoreLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Debounced store search.
  useEffect(() => {
    if (mode !== "store" || !search.trim()) {
      setStoreResults([]);
      return;
    }
    const q = search.trim();
    const t = setTimeout(async () => {
      setStoreLoading(true);
      try {
        const res = await invoke<StoreGameSummary[]>("search_store_games", { query: q, offset: 0, limit: 12 });
        setStoreResults(res || []);
      } catch {
        setStoreResults([]);
      } finally {
        setStoreLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [mode, search]);

  const selectedFriend = friends.find((f) => f.id === friendId);
  const friendLibGames = selectedFriend?.games || [];

  const baseList =
    mode === "friend"
      ? friendLibGames.map((g) => ({ id: g.id, name: g.name }))
      : libraryGames.map((g) => ({ id: g.id, name: g.name }));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (mode !== "library" && mode !== "friend") return baseList;
    if (!q) return baseList.slice(0, 12);
    return baseList.filter((g) => g.name.toLowerCase().includes(q)).slice(0, 12);
  }, [baseList, search, mode]);

  // Resolve a cover image per game id: library uses coverArtUrl, store uses coverUrl.
  const libraryCoverById = useMemo(() => {
    const m = new Map<string, string>();
    (libraryGames as any[]).forEach((g) => {
      if (g && g.coverArtUrl) m.set(String(g.id), g.coverArtUrl);
    });
    return m;
  }, [libraryGames]);

  const storeCoverById = useMemo(() => {
    const m = new Map<string, string>();
    storeResults.forEach((g) => {
      if (g && g.coverUrl) m.set(`store_${g.id}`, g.coverUrl);
    });
    return m;
  }, [storeResults]);

  const coverFor = (id: string): string | undefined => libraryCoverById.get(id) || storeCoverById.get(id);

  // Renders a cover image, falling back to the 2-letter initials badge.
  const GameCover = ({ id, name, className }: { id: string; name: string; className?: string }) => {
    const cover = coverFor(id);
    if (cover) {
      return <img src={cover} alt={name} className={className} loading="lazy" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />;
    }
    return <div className={className}>{name.slice(0, 2).toUpperCase()}</div>;
  };

  if (selectedGameId) {
    return (
      <div className="selected-game-display-card">
        <div className="selected-game-details">
          <GameCover id={selectedGameId} name={selectedGameName} className="selected-game-thumb" />
          <span className="selected-game-title">{selectedGameName}</span>
        </div>
        <button type="button" className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: "11px" }} onClick={() => onSelect({ id: "", name: "" })}>
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="game-picker" ref={containerRef}>
      <div className="game-picker-modes">
        <button type="button" className={`picker-mode${mode === "library" ? " active" : ""}`} onClick={() => { setMode("library"); setIsOpen(true); }}>My Library</button>
        <button type="button" className={`picker-mode${mode === "friend" ? " active" : ""}`} onClick={() => { setMode("friend"); setIsOpen(true); }}>Friend's</button>
        <button type="button" className={`picker-mode${mode === "store" ? " active" : ""}`} onClick={() => { setMode("store"); setIsOpen(true); }}>Store Search</button>
      </div>

      {mode === "friend" && (
        <select className="profile-input" value={friendId} onChange={(e) => setFriendId(e.target.value)}>
          <option value="">Select a friend…</option>
          {friends.map((f) => (
            <option key={f.id} value={f.id}>{displayName(f)}</option>
          ))}
        </select>
      )}

      <div className="game-search-input-wrapper">
        <input
          type="text"
          className="game-search-input"
          placeholder={mode === "store" ? "Search the store catalog…" : "Search games…"}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setIsOpen(true); }}
          onFocus={() => setIsOpen(true)}
        />
        {search && (
          <button type="button" className="game-search-clear-btn" onClick={() => setSearch("")} title="Clear">×</button>
        )}
      </div>

      {isOpen && (
        <div className="game-search-results">
          {mode === "store" ? (
            storeLoading ? (
              <div className="game-search-no-results">Searching store…</div>
            ) : storeResults.length === 0 ? (
              <div className="game-search-no-results">No store matches{search.trim() ? "" : " — type to search"}</div>
            ) : (
              storeResults.map((g) => (
                <button key={g.id} type="button" className="game-search-item" onClick={() => { onSelect({ id: `store_${g.id}`, name: g.name }); setSearch(""); setIsOpen(false); }}>
                  <GameCover id={`store_${g.id}`} name={g.name} className="game-search-item-thumb" />
                  <span className="game-search-item-name">{g.name}</span>
                </button>
              ))
            )
          ) : filtered.length === 0 ? (
            <div className="game-search-no-results">{mode === "friend" && !friendId ? "Pick a friend first" : "No matches found"}</div>
          ) : (
            filtered.map((g) => (
              <button key={g.id} type="button" className="game-search-item" onClick={() => { onSelect(g); setSearch(""); setIsOpen(false); }}>
                <GameCover id={g.id} name={g.name} className="game-search-item-thumb" />
                <span className="game-search-item-name">{g.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

interface FriendInvitation {
  syncId: string;
  name: string;
  avatar: string;
  status: string;
  favoriteGame?: string;
  libStats?: {
    gamesCount: number;
    playtimeMinutes: number;
    achievementsCount: number;
  };
}

// ── Main Page Component ─────────────────────────────────────────────

export default function FriendsPage() {
  const [activeTab, setActiveTab] = useState<"friends" | "sessions" | "recs" | "suggestions" | "compare" | "leaderboard" | "profile">("friends");
  const { games, runningGameIds } = useGames();
  const { wishlist, toggle } = useWishlistContext();
  const { cache } = useAchievements();
  const { showToast } = useToast();
  const navigate = useNavigate();

  // When arriving from the Wishlist "Share to Friends" button, jump straight
  // into the Wishlist Shares tab with the chosen game pre-selected.
  useEffect(() => {
    const pending = consumePendingSuggestion();
    if (pending) {
      setSuggestionGameId(pending.gameId);
      setActiveTab("suggestions");
    }
  }, []);

  // Single profile support — hardcoded active profile name to "A"
  const profileName = "A";

  // Load state (scoped by active profile)
  const [profile, setProfile] = useState<UserProfile>(() => loadUserProfile());
  const [friends, setFriends] = useState<Friend[]>(() => loadFriends());
  const [sessions, setSessions] = useState<GameSession[]>(() => loadSessions());
  const [recommendations, setRecommendations] = useState<GameRecommendation[]>(() => loadRecommendations());
  const [suggestions, setSuggestions] = useState<GameSuggestion[]>(() => loadSuggestions());

  // Pending Friend Invitations state
  const [invitations, setInvitations] = useState<FriendInvitation[]>([]);
  const [deniedIds, setDeniedIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("gamelib.friends.denied") || "[]");
    } catch {
      return [];
    }
  });

  // Nostr variables
  const nostrPool = useMemo(() => new SimplePool(), []);
  const nostrRelays = useMemo(() => [
    "wss://relay.damus.io",
    "wss://nos.lol",
    "wss://relay.snort.social",
    "wss://relay.primal.net"
  ], []);

  // Shared function to handle incoming remote database data (invitation vs merge)
  const handleReceiveRemoteData = (remoteDb: FriendsDatabase) => {
    try {
      const localProfile = loadUserProfile();
      const localFriends = loadFriends();
      
      const remoteProfile = remoteDb.profile;
      if (remoteProfile && remoteProfile.syncId) {
        const isFriend = localFriends.some((f) => f.syncId === remoteProfile.syncId);
        const isSelf = remoteProfile.syncId === localProfile.syncId;
        const isDenied = deniedIds.includes(remoteProfile.syncId);
        
        if (!isFriend && !isSelf && !isDenied) {
          const theyAddedUs = remoteDb.friends?.some((f) => f.syncId === localProfile.syncId);
          if (theyAddedUs) {
            const newInvite: FriendInvitation = {
              syncId: remoteProfile.syncId,
              name: remoteProfile.name,
              avatar: remoteProfile.avatar,
              status: remoteProfile.status,
              favoriteGame: remoteProfile.favoriteGameName || undefined,
              libStats: remoteProfile.libStats ? {
                gamesCount: (remoteProfile.libStats as any).gamesCount || 0,
                playtimeMinutes: (remoteProfile.libStats as any).playtimeMinutes || 0,
                achievementsCount: (remoteProfile.libStats as any).achievementsCount || 0,
              } : undefined
            };
            
            setInvitations((prev) => {
              if (prev.some((i) => i.syncId === newInvite.syncId)) return prev;
              return [...prev, newInvite];
            });
            showToast(`New friend invitation from ${remoteProfile.name}!`, "info");
            return; // Do not merge databases for non-friends
          }
        }
        
        // If they are not a friend and didn't add us, ignore
        if (!isFriend) {
          return;
        }
      }
      
      // Merge local and remote
      const localSessions = loadSessions();
      const localRecommendations = loadRecommendations();
      const localSuggestions = loadSuggestions();

      const localDb: FriendsDatabase = {
        profile: localProfile,
        friends: localFriends,
        sessions: localSessions,
        recommendations: localRecommendations,
        suggestions: localSuggestions,
      };

      const merged = mergeDatabases(localDb, remoteDb);

      // Save and update state
      setFriends(merged.friends);
      setSessions(merged.sessions);
      setRecommendations(merged.recommendations);
      setSuggestions(merged.suggestions);
      
      saveFriends(merged.friends);
      saveSessions(merged.sessions);
      saveRecommendations(merged.recommendations);
      
      console.log(`Synced data automatically with ${remoteDb.profile?.name || "friend"}!`);
    } catch (err) {
      console.error("Failed to parse/merge remote sync data:", err);
    }
  };

  // Publish our local database to configured Nostr relays
  const publishToNostr = async (db: FriendsDatabase, sharedGames?: SharedGameStat[]) => {
    try {
      const keys = getNostrKeys();
      const localFriendsList = loadFriends();
      const stats = selfStats;
      
      const payload = {
        syncId: keys.publicKey,
        profile: {
          name: db.profile?.name || "",
          avatar: db.profile?.avatar || "",
          status: db.profile?.status || "",
          favoriteGame: db.profile?.favoriteGameName || "",
          currentlyPlaying: db.profile?.currentlyPlaying || "",
          bio: db.profile?.bio || "",
          region: db.profile?.region || "",
          libStats: stats,
        },
        friends: localFriendsList.map((f) => f.syncId),
        games: sharedGames || [],
        sessions: db.sessions,
        recommendations: db.recommendations,
        suggestions: db.suggestions || [],
        updatedAt: Date.now(),
      };
      
      const eventTemplate = {
        kind: 30078,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["d", "gamelib-friends-outbox"]],
        content: JSON.stringify(payload),
      };
      
      const signedEvent = finalizeEvent(eventTemplate, keys.privateKey);
      console.log("Nostr: publishing outbox event:", signedEvent.id);
      
      await Promise.all(
        nostrRelays.map(async (relay) => {
          try {
            await nostrPool.publish([relay], signedEvent);
            console.log(`Nostr: successfully published to ${relay}`);
          } catch (err) {
            console.error(`Nostr: failed to publish to ${relay}:`, err);
          }
        })
      );
    } catch (err) {
      console.error("Nostr: failed to sign/publish event:", err);
    }
  };

  // Local wrapper around pushMyOutbox that handles both local files and Nostr relays
  const pushMyOutbox = async (
    currProfile: UserProfile,
    currStats: { gamesCount: number; playtimeMinutes: number; achievementsCount: number },
    currSessions: GameSession[],
    currRecs: GameRecommendation[],
    currSharedGames?: SharedGameStat[],
    currSuggestions?: GameSuggestion[]
  ) => {
    const res = await pushMyOutboxStorage(currProfile, currStats, currSessions, currRecs, currSharedGames, currSuggestions);

    // Also publish to Nostr
    const db: FriendsDatabase = {
      profile: currProfile,
      friends: friends,
      sessions: currSessions,
      recommendations: currRecs,
      suggestions: currSuggestions || [],
    };
    publishToNostr(db, currSharedGames);
    return res;
  };

  // Network Sync States
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedTime, setLastSyncedTime] = useState<string>("Never");
  // Recent sync activity log (most recent first) for the conflict/activity panel.
  const [syncLog, setSyncLog] = useState<{ time: string; message: string; details: string[] }[]>([]);

  // Direct P2P Sync States
  const [showP2pModal, setShowP2pModal] = useState(false);

  // listen to automatic internet P2P sync events
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    
    async function setupListener() {
      unlisten = await listen<string>("internet-sync-received", (event) => {
        console.log("Received internet sync database payload");
        try {
          const remoteDb = JSON.parse(event.payload) as FriendsDatabase;
          handleReceiveRemoteData(remoteDb);
        } catch (err) {
          console.error("Failed to parse/merge remote sync data:", err);
        }
      });
    }
    
    setupListener();
    
    return () => {
      if (unlisten) unlisten();
    };
  }, [deniedIds]);

  // Subscribe to all friend pubkeys via Nostr WebSockets
  useEffect(() => {
    if (friends.length === 0) return;
    
    const pubkeys = friends.map((f) => f.syncId).filter((id) => /^[0-9a-fA-F]{64}$/.test(id));
    if (pubkeys.length === 0) return;

    console.log("Nostr: subscribing to friends' pubkeys:", pubkeys);
    
    const sub = nostrPool.subscribeMany(
      nostrRelays,
      {
        authors: pubkeys,
        kinds: [30078],
        "#d": ["gamelib-friends-outbox"],
      },
      {
        onevent(event) {
          if (!verifyEvent(event)) {
            console.error("Nostr: invalid signature for event:", event.id);
            return;
          }
          console.log("Nostr: received updated outbox from friend pubkey:", event.pubkey);
          try {
            const remoteDb = JSON.parse(event.content) as FriendsDatabase;
            handleReceiveRemoteData(remoteDb);
          } catch (err) {
            console.error("Nostr: failed to parse remote data:", err);
          }
        },
      }
    );

    return () => {
      sub.close();
    };
  }, [friends, nostrPool, nostrRelays]);

  // Modal / Form state
  const [showAddModal, setShowAddModal] = useState(false);
  const [friendCodeInput, setFriendCodeInput] = useState("");
  const [decodedFriend, setDecodedFriend] = useState<Friend | null>(null);

  // Friends list controls (search / sort / filter)
  const [friendSearch, setFriendSearch] = useState("");
  const [friendSort, setFriendSort] = useState<"default" | "name" | "recent" | "online">("default");
  const [friendFilter, setFriendFilter] = useState<"all" | "online" | "pinned">("all");
  const [friendDensity, setFriendDensity] = useState<"grid" | "list">(
    () => (localStorage.getItem("gamelib.friends.density") as "grid" | "list") || "grid"
  );
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([]);
  const [selectMode, setSelectMode] = useState(false);

  // Compare Tab States
  const [selectedCompareFriendId, setSelectedCompareFriendId] = useState<string>("");
  const [compareSubTab, setCompareSubTab] = useState<"overview" | "games" | "genres" | "insights">("overview");
  const [compareFilter, setCompareFilter] = useState<"all" | "shared" | "me_only" | "friend_only">("all");
  const [compareSort, setCompareSort] = useState<"name" | "myPlaytime" | "friendPlaytime" | "gap" | "achievement">("name");
  const [compareGenre, setCompareGenre] = useState<string>("all");
  const [compareSearch, setCompareSearch] = useState<string>("");

  // Create Session Form State
  const [sessionGameId, setSessionGameId] = useState("");
  const [sessionGameName, setSessionGameName] = useState("");
  const [sessionDateTime, setSessionDateTime] = useState("");
  const [sessionMaxPlayers, setSessionMaxPlayers] = useState(4);
  const [sessionDesc, setSessionDesc] = useState("");
  const [sessionDuration, setSessionDuration] = useState(120);
  const [sessionInvited, setSessionInvited] = useState<string[]>([]);
  const viewerTimezone = useMemo(() => detectTimezone(), [profile]);
  // Sessions view: upcoming list, past history, or agenda grouping
  const [sessionView, setSessionView] = useState<"upcoming" | "past" | "agenda">("upcoming");
  // Agenda sub-mode: month calendar grid vs. chronological list.
  const [agendaMode, setAgendaMode] = useState<"grid" | "list">("grid");
  // Expanded day in the calendar grid (date key) to reveal full session cards.
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  // Sessions list filters + search
  const [sessionFilter, setSessionFilter] = useState<"all" | "mine" | "invited">("all");
  const [sessionSearch, setSessionSearch] = useState("");

  // Create Recommendation Form State
  const [recGameId, setRecGameId] = useState("");
  const [recToFriend, setRecToFriend] = useState("All Friends");
  const [recRating, setRecRating] = useState(5);
  const [recReason, setRecReason] = useState("");
  // Recommendations feed filter
  const [recFilter, setRecFilter] = useState<"all" | "to_me" | "by_me" | "want">("all");

  // Wishlist Suggestions feed state
  const [suggestionGameId, setSuggestionGameId] = useState("");
  const [suggestionNote, setSuggestionNote] = useState("");
  const [suggestionToFriend, setSuggestionToFriend] = useState("All Friends");
  const [suggestionFilter, setSuggestionFilter] = useState<"all" | "by_me" | "to_me" | "added" | "unadded">("all");
  const [suggestionSort, setSuggestionSort] = useState<"newest" | "oldest" | "reactions" | "comments">("newest");
  const [suggestionSearch, setSuggestionSearch] = useState("");
  const [suggestionCommentInputs, setSuggestionCommentInputs] = useState<Record<string, string>>({});

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

  // Asynchronously fetch real profile details for the friend code preview
  useEffect(() => {
    if (!decodedFriend || !decodedFriend.syncId) return;
    let cancelled = false;

    const fetchPreview = async () => {
      try {
        const remoteOutbox = await fetchFriendOutbox(decodedFriend.syncId);
        if (remoteOutbox && remoteOutbox.profile && !cancelled) {
          setDecodedFriend((prev) => {
            if (!prev || prev.syncId !== decodedFriend.syncId) return prev;
            return {
              ...prev,
              name: remoteOutbox.profile.name,
              avatar: remoteOutbox.profile.avatar,
              status: remoteOutbox.profile.status,
              favoriteGame: remoteOutbox.profile.favoriteGame || undefined,
              currentlyPlaying: remoteOutbox.profile.currentlyPlaying || undefined,
              libStats: remoteOutbox.profile.libStats,
            };
          });
        }
      } catch (err) {
        console.error("Failed to fetch friend preview outbox:", err);
      }
    };

    fetchPreview();
    return () => {
      cancelled = true;
    };
  }, [decodedFriend?.syncId]);

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
          setSuggestions(loadSuggestions());
        }

        // 2. Resolve device ID
        const id = await invoke<string>("get_friends_device_id");
        if (!cancelled && id) {
          setDeviceId(id);
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

    // Make sure we always have a stable Nostr public key before publishing.
    if (!profile.syncId) {
      const keys = getNostrKeys();
      const updated = { ...profile, syncId: keys.publicKey };
      saveUserProfile(updated);
      setProfile(updated);
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
    const localSuggestions = loadSuggestions();
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
    let mergedSuggestions = [...localSuggestions];

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

          // Merge wishlist game suggestions
          if (remoteOutbox.suggestions && remoteOutbox.suggestions.length > 0) {
            const prevLength = mergedSuggestions.length;
            mergedSuggestions = mergeSuggestions(mergedSuggestions, remoteOutbox.suggestions);
            if (mergedSuggestions.length !== prevLength || JSON.stringify(mergedSuggestions) !== localStorage.getItem(`gamelib.friends.suggestions.${profileName}`)) {
              changesMade = true;
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
      saveSuggestions(mergedSuggestions);
      setSessions(mergedSessions);
      setRecommendations(mergedRecs);
      setSuggestions(mergedSuggestions);
    }

    if (friendsUpdated) {
      saveFriends(updatedFriends);
      setFriends(updatedFriends);
    }

    // Always push our own updated outbox so friends can see us
    const pushed = await pushMyOutbox(profile, selfStats, mergedSessions, mergedRecs, selfSharedGames, suggestions);

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
    
    await checkFolderInvitations(profile.syncId, localFriends);
    setIsSyncing(false);

    // Honor a manual sync that was requested while this one was running.
    if (pendingManualSync.current) {
      pendingManualSync.current = false;
      performSync(true);
    }
  };

  const checkFolderInvitations = async (mySyncId: string, currentFriends: Friend[]) => {
    if (!mySyncId) return;
    try {
      const peers = await listPeerOutboxes();
      const newInvites: FriendInvitation[] = [];
      
      for (const peerId of peers) {
        if (currentFriends.some((f) => f.syncId === peerId)) continue;
        if (peerId === mySyncId) continue;
        if (deniedIds.includes(peerId)) continue;
        
        const remoteOutbox = await fetchFriendOutbox(peerId);
        if (remoteOutbox && remoteOutbox.friends && remoteOutbox.friends.includes(mySyncId)) {
          newInvites.push({
            syncId: peerId,
            name: remoteOutbox.profile.name,
            avatar: remoteOutbox.profile.avatar,
            status: remoteOutbox.profile.status,
            favoriteGame: remoteOutbox.profile.favoriteGame || undefined,
            libStats: remoteOutbox.profile.libStats,
          });
        }
      }
      
      setInvitations((prev) => {
        const merged = [...prev];
        newInvites.forEach((invite) => {
          if (!merged.some((i) => i.syncId === invite.syncId)) {
            merged.push(invite);
          }
        });
        return merged;
      });
    } catch (e) {
      console.error("Failed to check folder invitations:", e);
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
        await pushMyOutbox(updated, selfStats, sessions, recommendations, selfSharedGames, suggestions);
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
        await pushMyOutbox(updated, selfStats, sessions, recommendations, selfSharedGames, suggestions);
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
            pushMyOutbox(updated, selfStats, sessions, recommendations, selfSharedGames, suggestions);
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
    await pushMyOutbox(profile, selfStats, sessions, recommendations, selfSharedGames, suggestions);
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

  // Accept a friend invitation
  const handleAcceptInvitation = (invite: FriendInvitation) => {
    const exists = friends.some((f) => f.syncId === invite.syncId);
    if (exists) {
      setInvitations((prev) => prev.filter((i) => i.syncId !== invite.syncId));
      return;
    }

    const newFriend: Friend = {
      id: `friend_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: invite.name,
      avatar: invite.avatar,
      status: invite.status,
      favoriteGame: invite.favoriteGame,
      libStats: invite.libStats,
      addedAt: Date.now(),
      syncId: invite.syncId,
    };

    const updatedFriends = [...friends, newFriend];
    setFriends(updatedFriends);
    saveFriends(updatedFriends);
    setInvitations((prev) => prev.filter((i) => i.syncId !== invite.syncId));
    showToast(`Accepted friend invitation from ${invite.name}!`, "success");

    // Trigger instant synchronization to exchange data
    setTimeout(() => {
      performSync(true);
    }, 100);
  };

  // Deny a friend invitation
  const handleDenyInvitation = (syncId: string) => {
    const nextDenied = [...deniedIds, syncId];
    setDeniedIds(nextDenied);
    localStorage.setItem("gamelib.friends.denied", JSON.stringify(nextDenied));
    setInvitations((prev) => prev.filter((i) => i.syncId !== syncId));
    showToast("Invitation denied.", "info");
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

  // Bulk actions over selected friends
  const toggleSelect = (id: string) => {
    setSelectedFriendIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const applyBulk = (fn: (f: Friend) => Friend) => {
    const selected = new Set(selectedFriendIds);
    const updated = friends.map((f) => (selected.has(f.id) ? fn(f) : f));
    setFriends(updated);
    saveFriends(updated);
    setSelectedFriendIds([]);
    setSelectMode(false);
  };

  const handleBulkPin = () => {
    applyBulk((f) => ({ ...f, pinned: true }));
    showToast("Pinned selected friends.", "info");
  };
  const handleBulkUnpin = () => {
    applyBulk((f) => ({ ...f, pinned: false }));
    showToast("Unpinned selected friends.", "info");
  };
  const handleBulkBlock = () => {
    applyBulk((f) => ({ ...f, blocked: true }));
    showToast("Blocked selected friends.", "info");
  };
  const handleBulkRemove = () => {
    const selected = new Set(selectedFriendIds);
    const updated = friends.filter((f) => !selected.has(f.id));
    setFriends(updated);
    saveFriends(updated);
    if (selected.has(selectedCompareFriendId)) setSelectedCompareFriendId("");
    setSelectedFriendIds([]);
    setSelectMode(false);
    showToast("Removed selected friends.", "info");
  };

  // Quick actions that cross into other tabs
  const handleInviteToSession = (friend: Friend) => {
    if (!sessionInvited.includes(friend.name)) {
      setSessionInvited((prev) => [...prev, friend.name]);
    }
    setActiveTab("sessions");
    showToast(`Inviting ${displayName(friend)} to a session.`, "info");
  };

  const handleCompareFromCard = (friend: Friend) => {
    setSelectedCompareFriendId(friend.id);
    setActiveTab("compare");
  };

  const handleMessageFriend = (friend: Friend) => {
    if (!sessionInvited.includes(friend.name)) {
      setSessionInvited((prev) => [...prev, friend.name]);
    }
    setActiveTab("sessions");
    showToast(`Open the Sessions tab to chat with ${displayName(friend)}.`, "info");
  };

  // Copy public key
  const handleCopyCode = () => {
    if (!generatedFriendCode) return;
    navigator.clipboard.writeText(generatedFriendCode);
    showToast("Public Key copied to clipboard!", "success");
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

    // auto-decline: if the creator already has an overlapping non-declined session, decline it.
    const conflict = sessions.find(
      (s) => !s.deleted && s.creatorName === profile.name && sessionsConflict(s, { scheduledAt: sessionDateTime, durationMin: sessionDuration })
    );

    const newSession: GameSession = {
      id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      gameId: sessionGameId,
      gameName: sessionGameName || games.find((g) => g.id === sessionGameId)?.name || "Unknown Game",
      scheduledAt: sessionDateTime,
      maxPlayers: Number(sessionMaxPlayers) || 4,
      description: sessionDesc,
      creatorName: profile.name,
      attendees: [profile.name],
      rsvps: { [profile.name]: "going" },
      updatedAt: Date.now(),
      creatorTimezone: viewerTimezone,
      invited: sessionInvited,
      durationMin: Number(sessionDuration) || 120,
      participants: [{ name: profile.name, role: "host", timezone: viewerTimezone }],
      messages: [],
    };

    let updated = [newSession, ...sessions];

    if (conflict) {
      updated = updated.map((s) =>
        s.id === conflict.id
          ? { ...s, rsvps: { ...(s.rsvps || {}), [profile.name]: "declined" }, attendees: s.attendees.filter((n) => n !== profile.name), updatedAt: Date.now() }
          : s
      );
      showToast(`Scheduled! Auto-declined overlapping "${conflict.gameName}".`, "warning");
    } else {
      showToast("Game session scheduled!", "success");
    }

    setSessions(updated);
    saveSessions(updated);
    await pushMyOutbox(profile, selfStats, updated, recommendations, selfSharedGames, suggestions);

    // Reset Form
    setSessionGameId("");
    setSessionGameName("");
    setSessionDateTime("");
    setSessionMaxPlayers(4);
    setSessionDesc("");
    setSessionDuration(120);
    setSessionInvited([]);
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
      // Keep the participant record in sync with the RSVP.
      const participants = (s.participants || []).filter((p) => p.name !== profile.name);
      if (isGoing) {
        participants.unshift({ name: profile.name, role: "player", timezone: viewerTimezone });
      }
      const label = rsvps[profile.name] ? rsvps[profile.name] : "no response";
      showToast(`RSVP: ${label}.`, "info");
      return { ...s, rsvps, attendees, participants, updatedAt: Date.now() };
    });

    setSessions(updated);
    saveSessions(updated);
    await pushMyOutbox(profile, selfStats, updated, recommendations, selfSharedGames, suggestions);
  };

  // Remove a session entirely (hard delete from local list)
  const handleDeleteSession = async (sessionId: string) => {
    const updated = sessions.map((s) =>
      s.id === sessionId ? { ...s, deleted: true, updatedAt: Date.now() } : s
    );
    setSessions(updated);
    saveSessions(updated);
    await pushMyOutbox(profile, selfStats, updated, recommendations, selfSharedGames, suggestions);
    showToast("Session removed.", "info");
  };

  // Update a participant's role (host/cohost/player). Only host/cohost may change.
  const handleSetRole = async (sessionId: string, name: string, role: SessionRole) => {
    const updated = sessions.map((s) => {
      if (s.id !== sessionId) return s;
      const participants = (s.participants || []).map((p) => (p.name === name ? { ...p, role } : p));
      if (!participants.some((p) => p.name === name)) participants.push({ name, role });
      return { ...s, participants, updatedAt: Date.now() };
    });
    setSessions(updated);
    saveSessions(updated);
    await pushMyOutbox(profile, selfStats, updated, recommendations, selfSharedGames, suggestions);
  };

  // Add a +1 guest (non-friend attendee) to a session.
  const handleAddGuest = async (sessionId: string, guestName: string) => {
    const updated = sessions.map((s) => {
      if (s.id !== sessionId) return s;
      const participants = [...(s.participants || [])];
      if (!participants.some((p) => p.name.toLowerCase() === guestName.toLowerCase())) {
        participants.push({ name: guestName, role: "player", guest: true, timezone: viewerTimezone });
      }
      const rsvps = { ...(s.rsvps || {}) };
      if (rsvps[guestName] === undefined) rsvps[guestName] = "going";
      const attendees = Array.from(new Set([...s.attendees, guestName]));
      return { ...s, participants, rsvps, attendees, updatedAt: Date.now() };
    });
    setSessions(updated);
    saveSessions(updated);
    await pushMyOutbox(profile, selfStats, updated, recommendations, selfSharedGames, suggestions);
    showToast(`${guestName} added as a +1 guest.`, "success");
  };

  const handleRemoveGuest = async (sessionId: string, guestName: string) => {
    const updated = sessions.map((s) => {
      if (s.id !== sessionId) return s;
      const participants = (s.participants || []).filter((p) => !(p.guest && p.name === guestName));
      const rsvps = { ...(s.rsvps || {}) };
      delete rsvps[guestName];
      const attendees = s.attendees.filter((n) => n !== guestName);
      return { ...s, participants, rsvps, attendees, updatedAt: Date.now() };
    });
    setSessions(updated);
    saveSessions(updated);
    await pushMyOutbox(profile, selfStats, updated, recommendations, selfSharedGames, suggestions);
  };

  // Save the "what I'm bringing" note on the current user's RSVP.
  const handleSetRsvpNote = async (sessionId: string, note: string) => {
    const updated = sessions.map((s) => {
      if (s.id !== sessionId) return s;
      const participants = [...(s.participants || [])];
      const idx = participants.findIndex((p) => p.name === profile.name);
      if (idx >= 0) participants[idx] = { ...participants[idx], note: note || undefined };
      else participants.push({ name: profile.name, role: "player", note: note || undefined, timezone: viewerTimezone });
      return { ...s, participants, updatedAt: Date.now() };
    });
    setSessions(updated);
    saveSessions(updated);
    await pushMyOutbox(profile, selfStats, updated, recommendations, selfSharedGames, suggestions);
  };

  // Append a chat message to a session's shared thread.
  const handleSendMessage = async (sessionId: string, text: string) => {
    const msg: SessionMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      author: profile.name,
      text,
      timestamp: Date.now(),
    };
    const updated = sessions.map((s) =>
      s.id === sessionId ? { ...s, messages: [...(s.messages || []), msg], updatedAt: Date.now() } : s
    );
    setSessions(updated);
    saveSessions(updated);
    await pushMyOutbox(profile, selfStats, updated, recommendations, selfSharedGames, suggestions);
  };

  // Toggle a message's pinned state (host/cohost only, enforced in UI).
  const handleTogglePinMessage = async (sessionId: string, messageId: string) => {
    const updated = sessions.map((s) => {
      if (s.id !== sessionId) return s;
      const messages = (s.messages || []).map((m) => (m.id === messageId ? { ...m, pinned: !m.pinned } : m));
      return { ...s, messages, updatedAt: Date.now() };
    });
    setSessions(updated);
    saveSessions(updated);
    await pushMyOutbox(profile, selfStats, updated, recommendations, selfSharedGames, suggestions);
  };

  // Resolve a cover image URL for a session's game (library coverArtUrl, or
  // store coverUrl for `store_<id>` entries). Used by the session cards.
  const gameCoverForSession = useMemo(() => {
    const libMap = new Map<string, string>();
    (games as any[]).forEach((g) => {
      if (g && g.coverArtUrl) libMap.set(String(g.id), g.coverArtUrl);
    });
    return (session: GameSession): string | undefined => {
      const id = session.gameId;
      if (id.startsWith("store_")) {
        const slug = id.slice("store_".length);
        // Best-effort store lookup from the persisted store cache (by numeric id).
        try {
          const raw = localStorage.getItem("gamelib.store.cache");
          if (raw) {
            const cache = JSON.parse(raw);
            const all = Object.values(cache?.categories || {}) as any[];
            for (const entry of all) {
              const found = (entry?.data || []).find((g: any) => String(g.id) === slug);
              if (found?.coverUrl) return found.coverUrl;
            }
          }
        } catch {
          /* ignore */
        }
        return undefined;
      }
      return libMap.get(id);
    };
  }, [games]);

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
    await pushMyOutbox(profile, selfStats, sessions, updated, selfSharedGames, suggestions);
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
    await pushMyOutbox(profile, selfStats, sessions, updated, selfSharedGames, suggestions);
    setCommentInputs((prev) => ({ ...prev, [recId]: "" }));
    showToast("Comment posted.", "success");
  };

  // Remove a recommendation entirely (hard delete from local list replaced with tombstone)
  const handleDeleteRecommendation = async (recId: string) => {
    const updated = recommendations.map((r) =>
      r.id === recId ? { ...r, deleted: true, updatedAt: Date.now() } : r
    );
    setRecommendations(updated);
    saveRecommendations(updated);
    await pushMyOutbox(profile, selfStats, sessions, updated, selfSharedGames, suggestions);
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
    await pushMyOutbox(profile, selfStats, sessions, updated, selfSharedGames, suggestions);
  };

  // Toggle this user's personal "want to play" backlog flag.
  const handleToggleWantToPlay = async (recId: string) => {
    const updated = recommendations.map((r) => {
      if (r.id !== recId) return r;
      return { ...r, wantToPlay: !r.wantToPlay, updatedAt: Date.now() };
    });
    setRecommendations(updated);
    saveRecommendations(updated);
    await pushMyOutbox(profile, selfStats, sessions, updated, selfSharedGames, suggestions);
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
    await pushMyOutbox(profile, selfStats, sessions, updated, selfSharedGames, suggestions);
  };

  // ── Wishlist Game Suggestions Logic ──────────────────────────────
  // Share a game straight from the user's own wishlist tab with friends.

  const handleCreateSuggestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suggestionGameId) {
      showToast("Pick a game from your wishlist to share.", "error");
      return;
    }
    const wishItem = wishlist.find((w) => w.slug === suggestionGameId);
    if (!wishItem) {
      showToast("That game is no longer in your wishlist.", "error");
      return;
    }

    const newSug: GameSuggestion = {
      id: `sug_${Date.now()}_${Math.random().toString(36).substr(2, 7)}`,
      gameId: wishItem.slug,
      gameName: wishItem.name,
      coverUrl: wishItem.coverUrl || undefined,
      note: suggestionNote.trim(),
      suggestedBy: profile.name,
      suggestedTo: suggestionToFriend,
      comments: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const updated = [newSug, ...suggestions];
    setSuggestions(updated);
    saveSuggestions(updated);
    await pushMyOutbox(profile, selfStats, sessions, recommendations, selfSharedGames, updated);
    showToast(`Shared "${wishItem.name}" from your wishlist!`, "success");

    setSuggestionGameId("");
    setSuggestionNote("");
    setSuggestionToFriend("All Friends");
  };

  const handleDeleteSuggestion = async (sugId: string) => {
    const updated = suggestions.map((s) =>
      s.id === sugId ? { ...s, deleted: true, updatedAt: Date.now() } : s
    );
    setSuggestions(updated);
    saveSuggestions(updated);
    await pushMyOutbox(profile, selfStats, sessions, recommendations, selfSharedGames, updated);
    showToast("Suggestion removed.", "info");
  };

  const handleToggleSuggestionReaction = async (sugId: string, kind: SuggestionReactionKind) => {
    const updated = suggestions.map((s) => {
      if (s.id !== sugId) return s;
      const reactions = { ...(s.reactions || {}) };
      if (reactions[profile.name] === kind) {
        delete reactions[profile.name];
      } else {
        reactions[profile.name] = kind;
      }
      return { ...s, reactions, updatedAt: Date.now() };
    });
    setSuggestions(updated);
    saveSuggestions(updated);
    await pushMyOutbox(profile, selfStats, sessions, recommendations, selfSharedGames, updated);
  };

  const handleAddSuggestionComment = async (e: React.FormEvent, sugId: string) => {
    e.preventDefault();
    const text = suggestionCommentInputs[sugId] || "";
    if (!text.trim()) return;
    const updated = suggestions.map((s) => {
      if (s.id !== sugId) return s;
      const comment: SuggestionComment = {
        id: `sugc_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        authorName: profile.name,
        text,
        timestamp: Date.now(),
      };
      return { ...s, comments: [...s.comments, comment], updatedAt: Date.now() };
    });
    setSuggestions(updated);
    saveSuggestions(updated);
    await pushMyOutbox(profile, selfStats, sessions, recommendations, selfSharedGames, updated);
    setSuggestionCommentInputs((prev) => ({ ...prev, [sugId]: "" }));
  };

  const handleDeleteSuggestionComment = async (sugId: string, commentId: string, authorName: string) => {
    if (authorName !== profile.name) {
      showToast("You can only delete your own comments.", "error");
      return;
    }
    const updated = suggestions.map((s) => {
      if (s.id !== sugId) return s;
      return { ...s, comments: s.comments.filter((c) => c.id !== commentId), updatedAt: Date.now() };
    });
    setSuggestions(updated);
    saveSuggestions(updated);
    await pushMyOutbox(profile, selfStats, sessions, recommendations, selfSharedGames, updated);
  };

  // Add the shared game to the viewer's own wishlist (and mark the suggestion).
  const handleAddSuggestionToWishlist = async (sug: GameSuggestion) => {
    const alreadyThere = wishlist.some((w) => w.slug === sug.gameId);
    if (alreadyThere) {
      showToast(`"${sug.gameName}" is already in your wishlist.`, "info");
    } else {
      const asSummary: StoreGameSummary = {
        id: 0,
        slug: sug.gameId,
        name: sug.gameName,
        summary: null,
        rating: null,
        aggregatedRating: null,
        coverUrl: sug.coverUrl || null,
        genres: [],
        platforms: [],
        firstReleaseDate: null,
        totalRatingCount: 0,
        hypes: 0,
      };
      toggle(asSummary);
      showToast(`Added "${sug.gameName}" to your wishlist!`, "success");
    }
    const updated = suggestions.map((s) =>
      s.id === sug.id ? { ...s, addedToWishlist: true, updatedAt: Date.now() } : s
    );
    setSuggestions(updated);
    saveSuggestions(updated);
    await pushMyOutbox(profile, selfStats, sessions, recommendations, selfSharedGames, updated);
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

  // Jaccard-style similarity: shared games over the union of both libraries.
  const matchScore = useMemo(() => {
    if (!compareFriend || comparisonData.length === 0) return 0;
    const sharedGamesCount = comparisonData.filter((i) => i.ownedByMe && i.ownedByFriend).length;
    const totalUniqueGamesCount = comparisonData.length;
    return totalUniqueGamesCount > 0 ? Math.round((sharedGamesCount / totalUniqueGamesCount) * 100) : 0;
  }, [compareFriend, comparisonData]);

  const filteredCompareData = useMemo(() => {
    const q = compareSearch.trim().toLowerCase();
    return comparisonData.filter((item) => {
      // Ownership filter.
      if (compareFilter === "shared" && !(item.ownedByMe && item.ownedByFriend)) return false;
      if (compareFilter === "me_only" && !(item.ownedByMe && !item.ownedByFriend)) return false;
      if (compareFilter === "friend_only" && !(!item.ownedByMe && item.ownedByFriend)) return false;
      // Genre filter (applies on top of ownership filter).
      if (compareGenre !== "all") {
        const genres: string[] = item.genres || [];
        if (!genres.some((g) => g.toLowerCase() === compareGenre.toLowerCase())) return false;
      }
      // Text search.
      if (q && !item.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [comparisonData, compareFilter, compareGenre, compareSearch]);

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
    if (compareSort === "gap") {
      return list.sort(
        (a, b) => Math.abs(b.playTimeMe - b.playTimeFriend) - Math.abs(a.playTimeMe - a.playTimeFriend)
      );
    }
    if (compareSort === "achievement") {
      return list.sort(
        (a, b) => Math.max(b.achievementMe, b.achievementFriend) - Math.max(a.achievementMe, a.achievementFriend)
      );
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
      myOwned,
      friendOwned,
      meOnlyCount: comparisonData.filter((i) => i.ownedByMe && !i.ownedByFriend).length,
      friendOnlyCount: comparisonData.filter((i) => !i.ownedByMe && i.ownedByFriend).length,
      myPlaytime,
      friendPlaytime,
      averageMyAchievements,
      averageFriendAchievements,
    };
  }, [comparisonData]);

  // Per-genre breakdown of who owns / plays more, used by the Genres sub-tab.
  const genreBreakdown = useMemo(() => {
    if (!comparisonData.length) return [];
    const map = new Map<
      string,
      { genre: string; meOwned: number; friendOwned: number; shared: number; mePlay: number; friendPlay: number; total: number }
    >();
    comparisonData.forEach((item) => {
      const genres: string[] = (item.genres && item.genres.length ? item.genres : ["Uncategorized"]);
      genres.forEach((g) => {
        const key = g || "Uncategorized";
        const row =
          map.get(key) ||
          { genre: key, meOwned: 0, friendOwned: 0, shared: 0, mePlay: 0, friendPlay: 0, total: 0 };
        row.total++;
        if (item.ownedByMe) {
          row.meOwned++;
          row.mePlay += item.playTimeMe;
        }
        if (item.ownedByFriend) {
          row.friendOwned++;
          row.friendPlay += item.playTimeFriend;
        }
        if (item.ownedByMe && item.ownedByFriend) row.shared++;
        map.set(key, row);
      });
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [comparisonData]);

  // Genre taste affinity: overlap of genres where both own at least one game.
  const genreAffinity = useMemo(() => {
    if (!genreBreakdown.length) return 0;
    const shared = genreBreakdown.filter((g) => g.meOwned > 0 && g.friendOwned > 0).length;
    return Math.round((shared / genreBreakdown.length) * 100);
  }, [genreBreakdown]);

  // Overall compatibility blends library overlap with genre-taste affinity.
  const compatibilityScore = useMemo(() => {
    return Math.round(matchScore * 0.6 + genreAffinity * 0.4);
  }, [matchScore, genreAffinity]);

  // Actionable insights: top playtime gaps, recommendations, achievement leaders.
  const compareInsights = useMemo(() => {
    if (!comparisonData.length || !compareFriend) return null;
    const shared = comparisonData.filter((i) => i.ownedByMe && i.ownedByFriend);
    const meOnly = comparisonData.filter((i) => i.ownedByMe && !i.ownedByFriend);
    const friendOnly = comparisonData.filter((i) => !i.ownedByMe && i.ownedByFriend);

    // Games where you crush the friend on time / vice versa (shared titles).
    const iPlayMore = [...shared]
      .filter((i) => i.playTimeMe > i.playTimeFriend)
      .sort((a, b) => (b.playTimeMe - b.playTimeFriend) - (a.playTimeMe - a.playTimeFriend))
      .slice(0, 5);
    const theyPlayMore = [...shared]
      .filter((i) => i.playTimeFriend > i.playTimeMe)
      .sort((a, b) => (b.playTimeFriend - b.playTimeMe) - (a.playTimeFriend - a.playTimeMe))
      .slice(0, 5);

    // Recommendations = what they love that you don't own, ranked by their playtime.
    const forYou = [...friendOnly].sort((a, b) => b.playTimeFriend - a.playTimeFriend).slice(0, 6);
    const forThem = [...meOnly].sort((a, b) => b.playTimeMe - a.playTimeMe).slice(0, 6);

    // Best co-op candidate: shared game with the highest combined playtime.
    const topShared = [...shared].sort(
      (a, b) => (b.playTimeMe + b.playTimeFriend) - (a.playTimeMe + a.playTimeFriend)
    )[0];

    // Achievement leader per shared game.
    const achLeaderMe = shared.filter((i) => i.achievementMe > i.achievementFriend).length;
    const achLeaderFriend = shared.filter((i) => i.achievementFriend > i.achievementMe).length;

    return { shared, meOnly, friendOnly, iPlayMore, theyPlayMore, forYou, forThem, topShared, achLeaderMe, achLeaderFriend };
  }, [comparisonData, compareFriend]);

  // Reset sub-tab-affecting UI when switching friends.
  useEffect(() => {
    setCompareSubTab("overview");
    setCompareFilter("all");
    setCompareGenre("all");
    setCompareSearch("");
  }, [selectedCompareFriendId]);

  // Set of the viewer's own game ids, used for "games in common" on cards.
  const myGameIds = useMemo(() => new Set(games.map((g) => g.id)), [games]);

  // ── Leaderboard Tab ────────────────────────────────────────────────
  const [leaderboardMetric, setLeaderboardMetric] = useState<"playtime" | "games" | "achievements">("playtime");

  const leaderboardPlayers = useMemo(() => {
    const players: {
      key: string;
      name: string;
      avatar: string;
      isYou: boolean;
      status?: string;
      currentlyPlaying?: string;
      gamesCount: number;
      playtimeMinutes: number;
      achievementsCount: number;
    }[] = [
      {
        key: `me`,
        name: profile.name,
        avatar: profile.avatar,
        isYou: true,
        status: profile.status,
        currentlyPlaying: profile.currentlyPlaying,
        gamesCount: selfStats.gamesCount,
        playtimeMinutes: selfStats.playtimeMinutes,
        achievementsCount: selfStats.achievementsCount,
      },
      ...friends
        .filter((f) => !f.blocked)
        .map((f) => ({
          key: f.id,
          name: displayName(f),
          avatar: f.avatar,
          isYou: false,
          status: f.status,
          currentlyPlaying: f.currentlyPlaying,
          gamesCount: f.libStats?.gamesCount || 0,
          playtimeMinutes: f.libStats?.playtimeMinutes || 0,
          achievementsCount: f.libStats?.achievementsCount || 0,
        })),
    ];

    const scoreOf = (p: (typeof players)[number]) =>
      leaderboardMetric === "playtime"
        ? p.playtimeMinutes
        : leaderboardMetric === "games"
        ? p.gamesCount
        : p.achievementsCount;

    const ranked = [...players].sort((a, b) => scoreOf(b) - scoreOf(a));
    const top = scoreOf(ranked[0] || ({} as (typeof players)[number])) || 1;
    return ranked.map((p, i) => ({ ...p, rank: i + 1, value: scoreOf(p), max: top }));
  }, [friends, profile, selfStats, leaderboardMetric]);

  const leaderboardTab = (
    <div className="leaderboard-section">
      <div className="leaderboard-header">
        <h3 className="leaderboard-title">🏆 Friends Leaderboard</h3>
        <p className="leaderboard-subtitle">
          Ranked by shared library stats. Only friends who have synced their stats appear.
        </p>
        <div className="compare-filter-chips">
          <button
            type="button"
            className={`compare-filter-chip${leaderboardMetric === "playtime" ? " active" : ""}`}
            onClick={() => setLeaderboardMetric("playtime")}
          >
            Playtime
          </button>
          <button
            type="button"
            className={`compare-filter-chip${leaderboardMetric === "games" ? " active" : ""}`}
            onClick={() => setLeaderboardMetric("games")}
          >
            Games Owned
          </button>
          <button
            type="button"
            className={`compare-filter-chip${leaderboardMetric === "achievements" ? " active" : ""}`}
            onClick={() => setLeaderboardMetric("achievements")}
          >
            Achievements
          </button>
        </div>
      </div>

      {leaderboardPlayers.filter((p) => p.value > 0).length === 0 ? (
        <div className="friends-empty-state">
          <h3 className="friends-empty-title">No Stats Yet</h3>
          <p className="friends-empty-desc">
            Once you and your friends sync library stats, the leaderboard will rank everyone here.
          </p>
        </div>
      ) : (
        <div className="leaderboard-list">
          {leaderboardPlayers.map((p) => (
            <div key={p.key} className={`leaderboard-row${p.isYou ? " is-you" : ""}${p.rank <= 3 ? " top-three" : ""}`}>
              <div className={`leaderboard-rank rank-${p.rank}`}>{p.rank}</div>
              {renderAvatar(p.avatar, p.name, "leaderboard-avatar")}
              <div className="leaderboard-player-info">
                <div className="leaderboard-player-name">
                  {p.name}
                  {p.isYou && <span className="leaderboard-you-badge">YOU</span>}
                  {p.currentlyPlaying && <span className="leaderboard-now-playing">{p.currentlyPlaying}</span>}
                </div>
                <div className="leaderboard-bar-track">
                  <div className="leaderboard-bar-fill" style={{ width: `${Math.max((p.value / p.max) * 100, 2)}%` }} />
                </div>
              </div>
              <div className="leaderboard-value">
                {leaderboardMetric === "playtime"
                  ? formatHours(p.value)
                  : leaderboardMetric === "games"
                  ? `${p.value}`
                  : `${p.value}%`}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

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
            aria-selected={activeTab === "suggestions"}
            className={`friends-tab${activeTab === "suggestions" ? " active" : ""}`}
            onClick={() => setActiveTab("suggestions")}
          >
            <SuggestionIcon />
            <span>Wishlist Shares</span>
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
              aria-selected={activeTab === "leaderboard"}
              className={`friends-tab${activeTab === "leaderboard" ? " active" : ""}`}
              onClick={() => setActiveTab("leaderboard")}
            >
              <LeaderboardIcon />
              <span>Leaderboard</span>
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
            title="Sync Now"
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
            {invitations.length > 0 && (
              <div className="friend-invitations-section">
                <h3 className="friend-invitations-title">
                  <span>✉️ Pending Friend Invitations ({invitations.length})</span>
                </h3>
                <div className="friend-invitations-list">
                  {invitations.map((invite) => (
                    <div key={invite.syncId} className="friend-invitation-card">
                      {renderAvatar(invite.avatar, invite.name)}
                      <div className="friend-invitation-info">
                        <div className="friend-invitation-name">{invite.name}</div>
                        <div className="friend-invitation-status">{invite.status || "wants to connect"}</div>
                      </div>
                      <div className="friend-invitation-actions">
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ padding: "4px 8px", fontSize: "11px", marginRight: "4px" }}
                          onClick={() => handleAcceptInvitation(invite)}
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: "4px 8px", fontSize: "11px" }}
                          onClick={() => handleDenyInvitation(invite.syncId)}
                        >
                          Deny
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="friends-list-header">
              <h2 className="friends-list-title">My Friends ({friends.length})</h2>
              <div className="friends-list-header-actions">
                <button
                  type="button"
                  className={`btn btn-secondary${selectMode ? " active" : ""}`}
                  onClick={() => {
                    setSelectMode((v) => !v);
                    setSelectedFriendIds([]);
                  }}
                  disabled={friends.length === 0}
                  title="Select multiple friends for bulk actions"
                >
                  {selectMode ? "Cancel" : "Select"}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    const next = friendDensity === "grid" ? "list" : "grid";
                    setFriendDensity(next);
                    localStorage.setItem("gamelib.friends.density", next);
                  }}
                  title="Toggle grid / list view"
                >
                  {friendDensity === "grid" ? "List view" : "Grid view"}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setShowAddModal(true)}
                >
                  Add Friend
                </button>
              </div>
            </div>

            {selectMode && (
              <div className="friends-bulk-bar">
                <span className="friends-bulk-count">{selectedFriendIds.length} selected</span>
                <div className="friends-bulk-actions">
                  <button type="button" className="btn btn-secondary" onClick={handleBulkPin} disabled={selectedFriendIds.length === 0}>Pin</button>
                  <button type="button" className="btn btn-secondary" onClick={handleBulkUnpin} disabled={selectedFriendIds.length === 0}>Unpin</button>
                  <button type="button" className="btn btn-secondary" onClick={handleBulkBlock} disabled={selectedFriendIds.length === 0}>Block</button>
                  <button type="button" className="btn btn-secondary friend-bulk-remove" onClick={handleBulkRemove} disabled={selectedFriendIds.length === 0}>Remove</button>
                </div>
              </div>
            )}

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
                  Your friends list is currently empty. Go to 'My Profile' to copy your Public Key,
                  or ask a friend for their public key to get connected!
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
                    <div>No friends match your search or filter.</div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ marginTop: "12px" }}
                      onClick={() => {
                        setFriendSearch("");
                        setFriendFilter("all");
                      }}
                    >
                      Clear filters
                    </button>
                  </div>
                ) : (
                  <div className={`friends-grid${friendDensity === "list" ? " is-list" : ""}`}>
                    {visibleFriends.map((friend) => {
                      const online = isOnline(friend);
                      const presence = presenceLabel(friend);
                      const shared = sharedGamesCount(friend, myGameIds);
                      const selected = selectedFriendIds.includes(friend.id);
                      return (
                        <div
                          key={friend.id}
                          className={`friend-card hover-lift status-${online ? "online" : "offline"}${
                            friend.currentlyPlaying ? " playing" : ""
                          }${friend.pinned ? " pinned" : ""}${
                            friend.blocked ? " blocked" : ""
                          }${friendDensity === "list" ? " list-row" : ""}${
                            selectMode && selected ? " selected" : ""
                          }${selectMode ? " selectable" : ""}`}
                          onClick={selectMode ? () => toggleSelect(friend.id) : undefined}
                        >
                          {friend.pinned && <span className="friend-pin-badge" title="Pinned">📌</span>}
                          {selectMode && (
                            <span className={`friend-select-check${selected ? " checked" : ""}`} title="Select">
                              {selected ? "✓" : ""}
                            </span>
                          )}
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
                            ) : presence ? (
                              <div className="friend-status-text" title={friend.status}>
                                {presence}
                              </div>
                            ) : (
                              <div className="friend-status-text" title={friend.status}>
                                {friend.status}
                              </div>
                            )}
                            <div className="friend-last-seen" title="Last synced">
                              Last seen: {formatLastSeen(friend.lastSeen)}
                            </div>
                            {friend.region && (
                              <div className="friend-region" title="Region">🌍 {friend.region}</div>
                            )}
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
                            {shared > 0 && (
                              <button
                                type="button"
                                className="friend-shared-badge"
                                title="Games in common — compare libraries"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCompareFromCard(friend);
                                }}
                              >
                                🎮 {shared} in common
                              </button>
                            )}
                            {friend.bio && (
                              <div className="friend-bio" title={friend.bio}>{friend.bio}</div>
                            )}
                            {formatFriendsSince(friend.addedAt) && (
                              <div className="friend-since">{formatFriendsSince(friend.addedAt)}</div>
                            )}
                          </div>
                          {!selectMode && (
                            <div className="friend-card-actions">
                              <button
                                type="button"
                                className="friend-quick-btn"
                                title={`Compare libraries with ${displayName(friend)}`}
                                onClick={() => handleCompareFromCard(friend)}
                              >
                                Compare
                              </button>
                              <button
                                type="button"
                                className="friend-quick-btn"
                                title={`Invite ${displayName(friend)} to a session`}
                                onClick={() => handleInviteToSession(friend)}
                              >
                                Invite
                              </button>
                              <button
                                type="button"
                                className="friend-quick-btn"
                                title={`Message ${displayName(friend)}`}
                                onClick={() => handleMessageFriend(friend)}
                              >
                                Message
                              </button>
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
                          )}
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
                    <GamePicker
                      libraryGames={games}
                      friends={friends}
                      selectedGameId={sessionGameId}
                      selectedGameName={sessionGameName}
                      onSelect={(g) => { setSessionGameId(g.id); setSessionGameName(g.name); }}
                    />
                  </div>

                  <div className="friends-input-group">
                    <label htmlFor="sessionDateTime">Scheduled Time ({viewerTimezone || "local"})</label>
                    <input
                      type="datetime-local"
                      id="sessionDateTime"
                      className="profile-input"
                      value={sessionDateTime}
                      onChange={(e) => setSessionDateTime(e.target.value)}
                      required
                    />
                  </div>

                  <div className="sessions-form-row">
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
                      <label htmlFor="sessionDuration">Duration (min)</label>
                      <input
                        type="number"
                        id="sessionDuration"
                        className="profile-input"
                        min={15}
                        step={15}
                        value={sessionDuration}
                        onChange={(e) => setSessionDuration(Number(e.target.value))}
                      />
                    </div>
                  </div>

                  <div className="friends-input-group">
                    <label>Invite (optional — leave empty to notify all friends)</label>
                    <div className="session-invite-row">
                      <select
                        className="profile-input"
                        value=""
                        onChange={(e) => {
                          const name = e.target.value;
                          if (name && !sessionInvited.includes(name)) setSessionInvited((prev) => [...prev, name]);
                        }}
                      >
                        <option value="">Add a friend…</option>
                        {friends.map((f) => (
                          <option key={f.id} value={f.name} disabled={sessionInvited.includes(f.name)}>
                            {displayName(f)}
                          </option>
                        ))}
                      </select>
                      <div className="session-invite-chips">
                        {sessionInvited.map((name) => (
                          <span key={name} className="invite-chip">
                            {name}
                            <button type="button" className="invite-chip-x" onClick={() => setSessionInvited((prev) => prev.filter((n) => n !== name))}>×</button>
                          </span>
                        ))}
                      </div>
                    </div>
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

                  {sessionView === "agenda" && (
                    <div className="agenda-mode-toggle">
                      <button type="button" className={`agenda-mode-btn${agendaMode === "grid" ? " active" : ""}`} onClick={() => setAgendaMode("grid")}>📅 Calendar</button>
                      <button type="button" className={`agenda-mode-btn${agendaMode === "list" ? " active" : ""}`} onClick={() => setAgendaMode("list")}>☰ List</button>
                    </div>
                  )}

                  {/* Filters + search */}
                  <div className="sessions-toolbar">
                    <div className="compare-filter-chips">
                      <button type="button" className={`compare-filter-chip${sessionFilter === "all" ? " active" : ""}`} onClick={() => setSessionFilter("all")}>All</button>
                      <button type="button" className={`compare-filter-chip${sessionFilter === "mine" ? " active" : ""}`} onClick={() => setSessionFilter("mine")}>My Sessions</button>
                      <button type="button" className={`compare-filter-chip${sessionFilter === "invited" ? " active" : ""}`} onClick={() => setSessionFilter("invited")}>Invited To</button>
                    </div>
                    <input
                      className="profile-input session-search-input"
                      placeholder="Search sessions…"
                      value={sessionSearch}
                      onChange={(e) => setSessionSearch(e.target.value)}
                    />
                  </div>

                  {(() => {
                    const now = Date.now();
                    const bufferMs = 6 * 60 * 60 * 1000; // 6-hour grace period
                    const active = sessions.filter((s) => !s.deleted);
                    const mySessions = active.filter((s) => s.creatorName === profile.name);
                    const invitedTo = active.filter(
                      (s) => s.creatorName !== profile.name && (s.invited || []).includes(profile.name)
                    );

                    let pool = active;
                    if (sessionFilter === "mine") pool = mySessions;
                    else if (sessionFilter === "invited") pool = invitedTo;

                    const q = sessionSearch.trim().toLowerCase();
                    if (q) {
                      pool = pool.filter(
                        (s) =>
                          s.gameName.toLowerCase().includes(q) ||
                          (s.description || "").toLowerCase().includes(q) ||
                          (s.participants || []).some((p) => p.name.toLowerCase().includes(q))
                      );
                    }

                    const upcoming = pool.filter((s) => new Date(s.scheduledAt).getTime() + bufferMs >= now).sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
                    const past = pool.filter((s) => new Date(s.scheduledAt).getTime() + bufferMs < now).sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());

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

                    // Build a conflict map: for each session, the overlapping session (if any).
                    const conflicts = new Map<string, GameSession>();
                    visible.forEach((s) => {
                      if (new Date(s.scheduledAt).getTime() - now <= 0) return; // only warn about future
                      const clash = visible.find(
                        (o) => o.id !== s.id && o.creatorName === profile.name && sessionsConflict(s, o)
                      );
                      if (clash) conflicts.set(s.id, clash);
                    });

                    // Agenda view: group by month (or day for near-term).
                    if (sessionView === "agenda") {
                      const groups = new Map<string, GameSession[]>();
                      visible.forEach((s) => {
                        const d = new Date(s.scheduledAt);
                        const key = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
                        if (!groups.has(key)) groups.set(key, []);
                        groups.get(key)!.push(s);
                      });
                      // Group sessions by calendar day (local date key).
                      const dayMap = new Map<string, GameSession[]>();
                      visible.forEach((s) => {
                        const d = new Date(s.scheduledAt);
                        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
                        if (!dayMap.has(key)) dayMap.set(key, []);
                        dayMap.get(key)!.push(s);
                      });

                      // Determine the month range to render in the calendar.
                      const months = Array.from(
                        new Set(visible.map((s) => {
                          const d = new Date(s.scheduledAt);
                          return `${d.getFullYear()}-${d.getMonth()}`;
                        }))
                      ).sort();

                      const todayKey = (() => {
                        const t = new Date();
                        return `${t.getFullYear()}-${t.getMonth()}-${t.getDate()}`;
                      })();

                      const renderCalendarCard = (session: GameSession) => (
                        <SessionCard
                          key={session.id}
                          session={session}
                          profile={profile}
                          friends={friends}
                          viewerTimezone={viewerTimezone}
                          conflicting={conflicts.get(session.id)}
                          onRsvp={handleSetRsvp}
                          onDelete={handleDeleteSession}
                          onSetRole={handleSetRole}
                          onAddGuest={handleAddGuest}
                          onRemoveGuest={handleRemoveGuest}
                          onSetRsvpNote={handleSetRsvpNote}
                          onSendMessage={handleSendMessage}
                          gameCover={gameCoverForSession(session)}
                          onTogglePinMessage={handleTogglePinMessage}
                        />
                      );

                      if (agendaMode === "list") {
                        return (
                          <div className="sessions-agenda">
                            {months.map((m) => {
                              const [y, mo] = m.split("-").map(Number);
                              const monthLabel = new Date(y, mo, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
                              const monthSessions = visible.filter((s) => {
                                const d = new Date(s.scheduledAt);
                                return d.getFullYear() === y && d.getMonth() === mo;
                              });
                              const dayGroups = new Map<string, GameSession[]>();
                              monthSessions.forEach((s) => {
                                const dk = new Date(s.scheduledAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
                                if (!dayGroups.has(dk)) dayGroups.set(dk, []);
                                dayGroups.get(dk)!.push(s);
                              });
                              return (
                                <div key={m} className="agenda-month-group">
                                  <div className="agenda-month-label">{monthLabel}</div>
                                  {Array.from(dayGroups.entries()).map(([day, daySessions]) => (
                                    <div key={day} className="agenda-day-group">
                                      <div className="agenda-day-label">{day}</div>
                                      <div className="sessions-grid">
                                        {daySessions.map(renderCalendarCard)}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              );
                            })}
                          </div>
                        );
                      }

                      // Calendar grid mode.
                      const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
                      return (
                        <div className="sessions-calendar">
                          {months.map((m) => {
                            const [y, mo] = m.split("-").map(Number);
                            const monthLabel = new Date(y, mo, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
                            const firstDay = new Date(y, mo, 1).getDay();
                            const daysInMonth = new Date(y, mo + 1, 0).getDate();
                            const cells: (number | null)[] = [
                              ...Array(firstDay).fill(null),
                              ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
                            ];
                            // Pad to full weeks.
                            while (cells.length % 7 !== 0) cells.push(null);
                            return (
                              <div key={m} className="calendar-month">
                                <div className="calendar-month-label">{monthLabel}</div>
                                <div className="calendar-weekdays">
                                  {weekdays.map((w) => (
                                    <div key={w} className="calendar-weekday">{w}</div>
                                  ))}
                                </div>
                                <div className="calendar-grid">
                                  {cells.map((dayNum, idx) => {
                                    if (dayNum === null) return <div key={`empty-${idx}`} className="calendar-cell empty" />;
                                    const key = `${y}-${mo}-${dayNum}`;
                                    const daySessions = dayMap.get(key) || [];
                                    const isToday = key === todayKey;
                                    const isExpanded = expandedDay === key;
                                    return (
                                      <div
                                        key={key}
                                        className={`calendar-cell${isToday ? " today" : ""}${daySessions.length ? " has-events" : ""}${isExpanded ? " expanded" : ""}`}
                                        onClick={() => daySessions.length && setExpandedDay(isExpanded ? null : key)}
                                      >
                                        <div className="calendar-day-num">{dayNum}</div>
                                        {daySessions.length > 0 && !isExpanded && (
                                          <div className="calendar-chips">
                                            {daySessions.slice(0, 3).map((s) => (
                                              <div key={s.id} className={`calendar-chip${conflicts.get(s.id) ? " conflict" : ""}${s.creatorName === profile.name ? " mine" : ""}`} title={s.gameName}>
                                                <span className="calendar-chip-time">{new Date(s.scheduledAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
                                                <span className="calendar-chip-name">{s.gameName}</span>
                                              </div>
                                            ))}
                                            {daySessions.length > 3 && <div className="calendar-chip-more">+{daySessions.length - 3} more</div>}
                                          </div>
                                        )}
                                        {isExpanded && (
                                          <div className="calendar-day-detail" onClick={(e) => e.stopPropagation()}>
                                            {daySessions.map(renderCalendarCard)}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    }

                    return (
                      <div className="sessions-grid">
                        {visible.map((session) => (
                          <SessionCard
                            key={session.id}
                            session={session}
                            profile={profile}
                            friends={friends}
                            viewerTimezone={viewerTimezone}
                            conflicting={conflicts.get(session.id)}
                            onRsvp={handleSetRsvp}
                            onDelete={handleDeleteSession}
                            onSetRole={handleSetRole}
                            onAddGuest={handleAddGuest}
                            onRemoveGuest={handleRemoveGuest}
                            onSetRsvpNote={handleSetRsvpNote}
                            onSendMessage={handleSendMessage}
                            onTogglePinMessage={handleTogglePinMessage}
                          />
                        ))}
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
                {(() => {
                  const activeRecs = recommendations.filter((r) => !r.deleted);
                  const visibleRecs = activeRecs.filter((rec) => {
                    if (recFilter === "to_me")
                      return rec.recommendedTo === profile.name || rec.recommendedTo === "All Friends";
                    if (recFilter === "by_me") return rec.recommendedBy === profile.name;
                    if (recFilter === "want") return !!rec.wantToPlay;
                    return true;
                  });

                  return (
                    <>
                      <h3 className="friends-list-title">Friend Recommendations ({activeRecs.length})</h3>

                      {activeRecs.length > 0 && (
                        <div className="compare-filter-chips rec-filter-chips">
                          <button
                            type="button"
                            className={`compare-filter-chip${recFilter === "all" ? " active" : ""}`}
                            onClick={() => setRecFilter("all")}
                          >
                            All ({activeRecs.length})
                          </button>
                          <button
                            type="button"
                            className={`compare-filter-chip${recFilter === "to_me" ? " active" : ""}`}
                            onClick={() => setRecFilter("to_me")}
                          >
                            To Me ({activeRecs.filter((r) => r.recommendedTo === profile.name || r.recommendedTo === "All Friends").length})
                          </button>
                          <button
                            type="button"
                            className={`compare-filter-chip${recFilter === "by_me" ? " active" : ""}`}
                            onClick={() => setRecFilter("by_me")}
                          >
                            By Me ({activeRecs.filter((r) => r.recommendedBy === profile.name).length})
                          </button>
                          <button
                            type="button"
                            className={`compare-filter-chip${recFilter === "want" ? " active" : ""}`}
                            onClick={() => setRecFilter("want")}
                          >
                            Want to Play ({activeRecs.filter((r) => r.wantToPlay).length})
                          </button>
                        </div>
                      )}

                      {activeRecs.length === 0 ? (
                        <div className="friends-empty-state" style={{ margin: "0", maxWidth: "100%" }}>
                          <h3 className="friends-empty-title">No Recommendations Yet</h3>
                          <p className="friends-empty-desc">
                            Recommend a game on the right. Your reviews and comments will sync with friends automatically!
                          </p>
                        </div>
                      ) : (
                        visibleRecs.map((rec) => {
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
                                  {rec.recommendedBy === profile.name && (
                                    <button
                                      type="button"
                                      className="friend-delete-btn"
                                      style={{ opacity: 1, position: "static" }}
                                      onClick={() => handleDeleteRecommendation(rec.id)}
                                      title="Remove Recommendation"
                                    >
                                      <TrashIcon />
                                    </button>
                                  )}
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
                </>
              );
            })()}
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

        {/* Tab: Wishlist Shares (Game Suggestions) */}
        {activeTab === "suggestions" && (
          <div className="suggestions-section">
            <div className="recs-layout">
              {/* Left: Suggestions feed */}
              <div className="recs-feed">
                {(() => {
                  const activeSugs = suggestions.filter((s) => !s.deleted);
                  const visible = activeSugs.filter((s) => {
                    const q = suggestionSearch.trim().toLowerCase();
                    if (q && !s.gameName.toLowerCase().includes(q)) return false;
                    if (suggestionFilter === "by_me")
                      return s.suggestedBy === profile.name;
                    if (suggestionFilter === "to_me")
                      return s.suggestedTo === profile.name || s.suggestedTo === "All Friends";
                    if (suggestionFilter === "added") return !!s.addedToWishlist;
                    if (suggestionFilter === "unadded") return !s.addedToWishlist;
                    return true;
                  });

                  const sorted = [...visible].sort((a, b) => {
                    switch (suggestionSort) {
                      case "oldest":
                        return a.createdAt - b.createdAt;
                      case "reactions": {
                        const ca = Object.keys(a.reactions || {}).length;
                        const cb = Object.keys(b.reactions || {}).length;
                        return cb - ca;
                      }
                      case "comments":
                        return b.comments.length - a.comments.length;
                      case "newest":
                      default:
                        return b.createdAt - a.createdAt;
                    }
                  });

                  return (
                    <>
                      <h3 className="friends-list-title">Shared From Wishlists ({activeSugs.length})</h3>

                      {activeSugs.length > 0 && (
                        <div className="compare-filter-chips rec-filter-chips">
                          <button
                            type="button"
                            className={`compare-filter-chip${suggestionFilter === "all" ? " active" : ""}`}
                            onClick={() => setSuggestionFilter("all")}
                          >
                            All ({activeSugs.length})
                          </button>
                          <button
                            type="button"
                            className={`compare-filter-chip${suggestionFilter === "by_me" ? " active" : ""}`}
                            onClick={() => setSuggestionFilter("by_me")}
                          >
                            Shared by me ({activeSugs.filter((s) => s.suggestedBy === profile.name).length})
                          </button>
                          <button
                            type="button"
                            className={`compare-filter-chip${suggestionFilter === "to_me" ? " active" : ""}`}
                            onClick={() => setSuggestionFilter("to_me")}
                          >
                            For me ({activeSugs.filter((s) => s.suggestedTo === profile.name || s.suggestedTo === "All Friends").length})
                          </button>
                          <button
                            type="button"
                            className={`compare-filter-chip${suggestionFilter === "added" ? " active" : ""}`}
                            onClick={() => setSuggestionFilter("added")}
                          >
                            Added to WL ({activeSugs.filter((s) => s.addedToWishlist).length})
                          </button>
                          <button
                            type="button"
                            className={`compare-filter-chip${suggestionFilter === "unadded" ? " active" : ""}`}
                            onClick={() => setSuggestionFilter("unadded")}
                          >
                            Not added ({activeSugs.filter((s) => !s.addedToWishlist).length})
                          </button>
                        </div>
                      )}

                      <div className="suggestions-toolbar">
                        <input
                          type="text"
                          className="comment-input"
                          placeholder="Search shared games…"
                          value={suggestionSearch}
                          onChange={(e) => setSuggestionSearch(e.target.value)}
                        />
                        <select
                          className="profile-input suggestion-sort"
                          value={suggestionSort}
                          onChange={(e) => setSuggestionSort(e.target.value as any)}
                          aria-label="Sort shared games"
                        >
                          <option value="newest">Newest</option>
                          <option value="oldest">Oldest</option>
                          <option value="reactions">Most reactions</option>
                          <option value="comments">Most comments</option>
                        </select>
                      </div>

                      {activeSugs.length === 0 ? (
                        <div className="friends-empty-state" style={{ margin: "0", maxWidth: "100%" }}>
                          <h3 className="friends-empty-title">No Shared Games Yet</h3>
                          <p className="friends-empty-desc">
                            Share a game from your Wishlist tab on the right. Friends can react and comment — everything syncs automatically!
                          </p>
                        </div>
                      ) : sorted.length === 0 ? (
                        <div className="friends-empty-state" style={{ margin: "0", maxWidth: "100%" }}>
                          <p className="friends-empty-desc">No shared games match your filters.</p>
                        </div>
                      ) : (
                        sorted.map((sug) => {
                          const myReaction = sug.reactions?.[profile.name];
                          const reactionCounts: Record<string, number> = {};
                          if (sug.reactions) {
                            Object.values(sug.reactions).forEach((k) => {
                              reactionCounts[k] = (reactionCounts[k] || 0) + 1;
                            });
                          }
                          const alreadyWishlisted = wishlist.some((w) => w.slug === sug.gameId);
                          return (
                            <div key={sug.id} className="sug-card">
                              <div className="sug-header">
                                {sug.coverUrl ? (
                                  <img src={sug.coverUrl} alt={sug.gameName} className="sug-cover" loading="lazy" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                                ) : (
                                  <div className="sug-cover sug-cover-fallback">{sug.gameName.slice(0, 2).toUpperCase()}</div>
                                )}
                                <div className="sug-meta">
                                  <span className="sug-game">{sug.gameName}</span>
                                  <span className="sug-author">
                                    Shared by <strong>{sug.suggestedBy}</strong> {sug.suggestedTo === "All Friends" ? "with everyone" : `to ${sug.suggestedTo}`}
                                  </span>
                                </div>
                                <div className="sug-header-actions">
                                  <button
                                    type="button"
                                    className="friend-delete-btn"
                                    style={{ opacity: 1, position: "static" }}
                                    onClick={() => navigate(`/store/${sug.gameId}`)}
                                    title="View on Store"
                                  >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                      <polyline points="15 3 21 3 21 9" />
                                      <line x1="10" y1="14" x2="21" y2="3" />
                                    </svg>
                                  </button>
                                  {sug.suggestedBy === profile.name && (
                                    <button
                                      type="button"
                                      className="friend-delete-btn"
                                      style={{ opacity: 1, position: "static" }}
                                      onClick={() => handleDeleteSuggestion(sug.id)}
                                      title="Remove share"
                                    >
                                      <TrashIcon />
                                    </button>
                                  )}
                                </div>
                              </div>

                              {sug.note && <p className="sug-note">"{sug.note}"</p>}

                              <div className="rec-reactions-row">
                                {(["like", "love", "interest", "played"] as SuggestionReactionKind[]).map((kind) => {
                                  const label =
                                    kind === "like" ? "👍" : kind === "love" ? "❤️" : kind === "interest" ? "🔥" : "✅";
                                  return (
                                    <button
                                      key={kind}
                                      type="button"
                                      className={`rec-reaction-btn${myReaction === kind ? " active" : ""}`}
                                      onClick={() => handleToggleSuggestionReaction(sug.id, kind)}
                                      title={`React: ${kind}`}
                                    >
                                      <span>{label}</span>
                                      {reactionCounts[kind] ? <span className="rec-reaction-count">{reactionCounts[kind]}</span> : null}
                                    </button>
                                  );
                                })}
                                <button
                                  type="button"
                                  className={`rec-want-btn${sug.addedToWishlist || alreadyWishlisted ? " active" : ""}`}
                                  onClick={() => handleAddSuggestionToWishlist(sug)}
                                  disabled={alreadyWishlisted}
                                  title={alreadyWishlisted ? "Already in your wishlist" : "Add to my wishlist"}
                                >
                                  {alreadyWishlisted ? "✓ In Wishlist" : "+ Wishlist"}
                                </button>
                              </div>

                              <div className="rec-comments-section">
                                <h4 className="rec-comments-title">Comments ({sug.comments.length})</h4>
                                {sug.comments.length > 0 && (
                                  <div className="rec-comments-list">
                                    {sug.comments.map((comment) => (
                                      <div key={comment.id} className="comment-item">
                                        <span className="comment-author">{comment.authorName}</span>
                                        <span className="comment-text">{comment.text}</span>
                                        <span className="comment-time">{formatDateTime(new Date(comment.timestamp).toISOString())}</span>
                                        {comment.authorName === profile.name && (
                                          <button
                                            type="button"
                                            className="comment-delete-btn"
                                            onClick={() => handleDeleteSuggestionComment(sug.id, comment.id, comment.authorName)}
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
                                  onSubmit={(e) => handleAddSuggestionComment(e, sug.id)}
                                >
                                  <input
                                    type="text"
                                    className="comment-input"
                                    placeholder="Write a comment…"
                                    value={suggestionCommentInputs[sug.id] || ""}
                                    onChange={(e) =>
                                      setSuggestionCommentInputs((prev) => ({ ...prev, [sug.id]: e.target.value }))
                                    }
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
                    </>
                  );
                })()}
              </div>

              {/* Right: Share from wishlist */}
              <div className="profile-edit-section">
                <h3 className="profile-edit-title">Share a Game From Your Wishlist</h3>
                {wishlist.length === 0 ? (
                  <div className="friends-empty-state" style={{ margin: "0", maxWidth: "100%" }}>
                    <p className="friends-empty-desc">
                      Your wishlist is empty. Add games via the heart on any Store card, then share them here with friends.
                    </p>
                  </div>
                ) : (
                  <form className="profile-form" onSubmit={handleCreateSuggestion}>
                    <div className="friends-input-group">
                      <label>Game from Wishlist</label>
                      <select
                        className="profile-input"
                        value={suggestionGameId}
                        onChange={(e) => setSuggestionGameId(e.target.value)}
                        required
                      >
                        <option value="">Select a wishlisted game…</option>
                        {wishlist.map((w) => (
                          <option key={w.slug} value={w.slug}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="friends-input-group">
                      <label htmlFor="sugTo">Share With</label>
                      <select
                        id="sugTo"
                        className="profile-input"
                        value={suggestionToFriend}
                        onChange={(e) => setSuggestionToFriend(e.target.value)}
                      >
                        <option value="All Friends">All Friends</option>
                        {friends.map((f) => (
                          <option key={f.id} value={displayName(f)}>
                            {displayName(f)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="friends-input-group">
                      <label htmlFor="sugNote">Why are you sharing it? (optional)</label>
                      <textarea
                        id="sugNote"
                        className="profile-input"
                        style={{ height: "80px", resize: "none" }}
                        value={suggestionNote}
                        onChange={(e) => setSuggestionNote(e.target.value)}
                        placeholder="e.g. Co-op roguelike, great for our next session…"
                      />
                    </div>

                    <button type="submit" className="btn btn-primary" style={{ alignSelf: "flex-start" }}>
                      Share to Friends
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: Compare Libraries */}
        {activeTab === "compare" && (
          <div className="compare-section">
            <div className="compare-selector-bar">
              <div className="compare-selector-group">
                <label htmlFor="compareFriendSelect">Compare with:</label>
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
                <div className="compare-selector-badges">
                  <div className="compare-match-score-badge">
                    <span>🎯 Match</span>
                    <strong>{matchScore}%</strong>
                  </div>
                  <div className="compare-match-score-badge compat">
                    <span>🤝 Compatibility</span>
                    <strong>{compatibilityScore}%</strong>
                  </div>
                  {comparisonData.length > 0 && (
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
              )}
            </div>

            {!compareFriend ? (
              <div className="friends-empty-state">
                <h3 className="friends-empty-title">Select a Friend</h3>
                <p className="friends-empty-desc">
                  Choose one of your friends above to compare owned games, playtimes,
                  achievements, genre tastes, and get personalized recommendations
                  side-by-side!
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

                {/* Sub-tab navigation */}
                <div className="compare-subtabs" role="tablist">
                  {([
                    { id: "overview", label: "Overview", icon: "📊" },
                    { id: "games", label: "Games", icon: "🎮" },
                    { id: "genres", label: "Genres", icon: "🏷️" },
                    { id: "insights", label: "Insights", icon: "💡" },
                  ] as const).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={compareSubTab === t.id}
                      className={`compare-subtab${compareSubTab === t.id ? " active" : ""}`}
                      onClick={() => setCompareSubTab(t.id)}
                    >
                      <span className="compare-subtab-icon">{t.icon}</span>
                      <span>{t.label}</span>
                    </button>
                  ))}
                </div>

                {/* ── Overview sub-tab ─────────────────────────────── */}
                {compareSubTab === "overview" && comparisonSummary && (
                  <div className="compare-overview">
                    {/* Head-to-head KPI rows */}
                    <div className="compare-h2h">
                      {[
                        {
                          label: "Games Owned",
                          me: selfStats.gamesCount,
                          friend: compareFriend.libStats?.gamesCount || comparisonSummary.friendOwned,
                          fmt: (v: number) => `${v}`,
                        },
                        {
                          label: "Total Playtime",
                          me: selfStats.playtimeMinutes,
                          friend: compareFriend.libStats?.playtimeMinutes || comparisonSummary.friendPlaytime,
                          fmt: (v: number) => formatHours(v),
                        },
                        {
                          label: "Avg Achievements",
                          me: comparisonSummary.averageMyAchievements,
                          friend: comparisonSummary.averageFriendAchievements,
                          fmt: (v: number) => `${v}%`,
                        },
                        {
                          label: "Unique Titles",
                          me: comparisonSummary.meOnlyCount,
                          friend: comparisonSummary.friendOnlyCount,
                          fmt: (v: number) => `${v}`,
                        },
                      ].map((row) => {
                        const max = Math.max(row.me, row.friend, 1);
                        const mePct = (row.me / max) * 100;
                        const friendPct = (row.friend / max) * 100;
                        const meWins = row.me > row.friend;
                        const friendWins = row.friend > row.me;
                        return (
                          <div key={row.label} className="compare-h2h-row">
                            <div className="compare-h2h-side left">
                              <span className={`compare-h2h-val${meWins ? " win" : ""}`}>{row.fmt(row.me)}</span>
                              <div className="compare-h2h-bar">
                                <div className="compare-h2h-fill left" style={{ width: `${mePct}%` }} />
                              </div>
                            </div>
                            <span className="compare-h2h-label">{row.label}</span>
                            <div className="compare-h2h-side right">
                              <div className="compare-h2h-bar">
                                <div className="compare-h2h-fill right" style={{ width: `${friendPct}%` }} />
                              </div>
                              <span className={`compare-h2h-val${friendWins ? " win" : ""}`}>{row.fmt(row.friend)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Library overlap venn-ish summary */}
                    <div className="compare-overlap">
                      <div className="compare-overlap-seg me">
                        <span className="compare-overlap-num">{comparisonSummary.meOnlyCount}</span>
                        <span className="compare-overlap-lbl">Only You</span>
                      </div>
                      <div className="compare-overlap-seg shared">
                        <span className="compare-overlap-num">{comparisonSummary.sharedCount}</span>
                        <span className="compare-overlap-lbl">Shared</span>
                      </div>
                      <div className="compare-overlap-seg friend">
                        <span className="compare-overlap-num">{comparisonSummary.friendOnlyCount}</span>
                        <span className="compare-overlap-lbl">Only {compareFriend.name}</span>
                      </div>
                    </div>

                    {/* Quick highlights */}
                    {compareInsights && (
                      <div className="compare-highlights">
                        {compareInsights.topShared && (
                          <div className="compare-highlight-card">
                            <span className="compare-highlight-icon">🤝</span>
                            <div className="compare-highlight-body">
                              <span className="compare-highlight-title">Best game to play together</span>
                              <span className="compare-highlight-value">{compareInsights.topShared.name}</span>
                              <span className="compare-highlight-sub">
                                {formatHours(compareInsights.topShared.playTimeMe)} you · {formatHours(compareInsights.topShared.playTimeFriend)} them
                              </span>
                            </div>
                          </div>
                        )}
                        <div className="compare-highlight-card">
                          <span className="compare-highlight-icon">🏆</span>
                          <div className="compare-highlight-body">
                            <span className="compare-highlight-title">Achievement leader (shared games)</span>
                            <span className="compare-highlight-value">
                              {compareInsights.achLeaderMe === compareInsights.achLeaderFriend
                                ? "Neck and neck"
                                : compareInsights.achLeaderMe > compareInsights.achLeaderFriend
                                ? `${profile.name} (You)`
                                : compareFriend.name}
                            </span>
                            <span className="compare-highlight-sub">
                              You lead {compareInsights.achLeaderMe} · They lead {compareInsights.achLeaderFriend}
                            </span>
                          </div>
                        </div>
                        <div className="compare-highlight-card">
                          <span className="compare-highlight-icon">🏷️</span>
                          <div className="compare-highlight-body">
                            <span className="compare-highlight-title">Genre taste affinity</span>
                            <span className="compare-highlight-value">{genreAffinity}% aligned</span>
                            <span className="compare-highlight-sub">
                              {genreBreakdown.filter((g) => g.meOwned > 0 && g.friendOwned > 0).length} shared genres
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Games sub-tab ────────────────────────────────── */}
                {compareSubTab === "games" && (
                  <div className="compare-games-view">
                    <div className="compare-controls-row">
                      <div className="compare-filter-chips">
                        <button
                          type="button"
                          className={`compare-filter-chip${compareFilter === "all" ? " active" : ""}`}
                          onClick={() => setCompareFilter("all")}
                        >
                          All ({comparisonData.length})
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

                      <div className="compare-controls-right">
                        <input
                          type="search"
                          className="profile-input compare-search-input"
                          placeholder="Search games..."
                          value={compareSearch}
                          onChange={(e) => setCompareSearch(e.target.value)}
                        />
                        <div className="compare-selector-group compare-sort-group">
                          <span>Sort:</span>
                          <select
                            className="profile-input"
                            value={compareSort}
                            onChange={(e) => setCompareSort(e.target.value as any)}
                          >
                            <option value="name">Name</option>
                            <option value="myPlaytime">My Playtime</option>
                            <option value="friendPlaytime">Their Playtime</option>
                            <option value="gap">Playtime Gap</option>
                            <option value="achievement">Achievements</option>
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
                    </div>

                    <div className="compare-library-title-row">
                      <span className="compare-count">{sortedCompareData.length} games shown</span>
                    </div>

                    {sortedCompareData.length === 0 ? (
                      <div className="game-search-no-results" style={{ padding: "40px" }}>
                        No games match these filters.
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
                )}

                {/* ── Genres sub-tab ───────────────────────────────── */}
                {compareSubTab === "genres" && (
                  <div className="compare-genres-view">
                    {genreBreakdown.length === 0 ? (
                      <div className="game-search-no-results" style={{ padding: "40px" }}>
                        No genre data available to compare yet.
                      </div>
                    ) : (
                      <div className="compare-genre-list">
                        {genreBreakdown.map((g) => {
                          const max = Math.max(g.meOwned, g.friendOwned, 1);
                          return (
                            <div key={g.genre} className="compare-genre-row">
                              <div className="compare-genre-head">
                                <span className="compare-genre-name">{g.genre}</span>
                                <span className="compare-genre-shared">
                                  {g.shared > 0 ? `${g.shared} shared` : "no overlap"}
                                </span>
                              </div>
                              <div className="compare-genre-bars">
                                <div className="compare-genre-bar-side">
                                  <span className="compare-genre-count left">{g.meOwned}</span>
                                  <div className="compare-genre-bar-track">
                                    <div
                                      className="compare-genre-bar-fill left"
                                      style={{ width: `${(g.meOwned / max) * 100}%` }}
                                    />
                                  </div>
                                </div>
                                <div className="compare-genre-bar-side">
                                  <div className="compare-genre-bar-track reverse">
                                    <div
                                      className="compare-genre-bar-fill right"
                                      style={{ width: `${(g.friendOwned / max) * 100}%` }}
                                    />
                                  </div>
                                  <span className="compare-genre-count right">{g.friendOwned}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Insights sub-tab ─────────────────────────────── */}
                {compareSubTab === "insights" && compareInsights && (
                  <div className="compare-insights-view">
                    <div className="compare-insight-columns">
                      {/* Recommendations for you */}
                      <div className="compare-insight-panel">
                        <h4 className="compare-insight-title">
                          <span className="dot right" /> Games {compareFriend.name} loves that you don't own
                        </h4>
                        {compareInsights.forYou.length === 0 ? (
                          <p className="compare-insight-empty">You already own everything they play. Impressive!</p>
                        ) : (
                          <ul className="compare-insight-list">
                            {compareInsights.forYou.map((g) => (
                              <li key={g.id} className="compare-insight-item">
                                <span className="compare-insight-game">{g.name}</span>
                                <span className="compare-insight-meta">{formatHours(g.playTimeFriend)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {/* Recommendations for them */}
                      <div className="compare-insight-panel">
                        <h4 className="compare-insight-title">
                          <span className="dot left" /> Games you love that {compareFriend.name} is missing
                        </h4>
                        {compareInsights.forThem.length === 0 ? (
                          <p className="compare-insight-empty">They own all of your favorites already.</p>
                        ) : (
                          <ul className="compare-insight-list">
                            {compareInsights.forThem.map((g) => (
                              <li key={g.id} className="compare-insight-item">
                                <span className="compare-insight-game">{g.name}</span>
                                <span className="compare-insight-meta">{formatHours(g.playTimeMe)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {/* Where you play more */}
                      <div className="compare-insight-panel">
                        <h4 className="compare-insight-title">
                          <span className="dot left" /> Shared games you've played more
                        </h4>
                        {compareInsights.iPlayMore.length === 0 ? (
                          <p className="compare-insight-empty">No shared games where you're ahead — yet.</p>
                        ) : (
                          <ul className="compare-insight-list">
                            {compareInsights.iPlayMore.map((g) => (
                              <li key={g.id} className="compare-insight-item">
                                <span className="compare-insight-game">{g.name}</span>
                                <span className="compare-insight-meta win">
                                  +{formatHours(g.playTimeMe - g.playTimeFriend)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {/* Where they play more */}
                      <div className="compare-insight-panel">
                        <h4 className="compare-insight-title">
                          <span className="dot right" /> Shared games {compareFriend.name} has played more
                        </h4>
                        {compareInsights.theyPlayMore.length === 0 ? (
                          <p className="compare-insight-empty">You lead on every shared title.</p>
                        ) : (
                          <ul className="compare-insight-list">
                            {compareInsights.theyPlayMore.map((g) => (
                              <li key={g.id} className="compare-insight-item">
                                <span className="compare-insight-game">{g.name}</span>
                                <span className="compare-insight-meta win friend">
                                  +{formatHours(g.playTimeFriend - g.playTimeMe)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Tab 5: Leaderboard */}
        {activeTab === "leaderboard" && (leaderboardTab)}

        {/* Tab 6: My Profile */}
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
                <h4 className="friend-code-label">My Public Key</h4>
                <p className="friends-modal-desc">
                  Share this public key with your friends so they can add you to their network.
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
                  Copy Key
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
                          await pushMyOutbox(updated, selfStats, sessions, recommendations, selfSharedGames, suggestions);
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
              Paste your friend's Gamelib Public Key below.
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
                <label htmlFor="friendCodeInputArea">Public Key</label>
                <textarea
                  id="friendCodeInputArea"
                  className="friends-textarea"
                  value={friendCodeInput}
                  onChange={(e) => setFriendCodeInput(e.target.value)}
                  placeholder="Paste public key here..."
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
                    Invalid Public Key. Ensure you copied the entire 64-character hex key.
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
            <h3 className="friends-modal-title">Nostr Relay Sync</h3>
            <p className="friends-modal-desc">
              GameLib synchronizes sessions and recommendations with your friends automatically in the background using secure, public Nostr relays.
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
                  <span className="p2p-status-label">Nostr Connection</span>
                  <span className="p2p-status-badge online">
                    CONNECTED
                  </span>
                </div>

                <div className="p2p-status-details">
                  <div className="p2p-detail-row">
                    <span className="p2p-detail-key">My Public Key:</span>
                    <span className="p2p-detail-val" style={{ fontFamily: "monospace", fontSize: "11px", wordBreak: "break-all", color: "var(--color-accent)" }}>
                      {getNostrKeys().publicKey}
                    </span>
                  </div>
                  <div className="p2p-detail-row">
                    <span className="p2p-detail-key">Active Relays:</span>
                    <div className="p2p-detail-val" style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "10px", marginTop: "4px" }}>
                      {nostrRelays.map((r) => (
                        <span key={r}>🟢 {r}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p2p-friend-sync-block">
                <h4 className="p2p-section-title">Subscribed Friends ({friends.filter((f) => /^[0-9a-fA-F]{64}$/.test(f.syncId)).length})</h4>
                <div className="p2p-friend-list">
                  {friends.length === 0 ? (
                    <div className="p2p-empty-note">
                      No friends added yet. Share your public key to start syncing!
                    </div>
                  ) : (
                    friends.map((friend) => (
                      <div key={friend.id} className="p2p-friend-row">
                        <span>{friend.name}</span>
                        <span className="p2p-last-sync-ok" style={{ fontFamily: "monospace", fontSize: "10px" }}>
                          {friend.syncId.slice(0, 8)}...{friend.syncId.slice(-8)}
                        </span>
                      </div>
                    ))
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
                onClick={() => {
                  performSync(true);
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


