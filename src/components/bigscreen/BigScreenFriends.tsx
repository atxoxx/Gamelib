import { useState, useMemo, useCallback } from "react";
import { useFocusable } from "../../hooks/useFocusable";
import BigScreenPill from "./BigScreenPill";
import BigScreenTabBar, { type TabDef } from "./BigScreenTabBar";
import BigScreenTabPanel from "./BigScreenTabPanel";
import type { Friend, UserProfile, GameSession } from "../../pages/friendsStorage";
import { displayName } from "../../pages/friendsStorage";

function formatHours(totalMinutes: number): string {
  if (!totalMinutes || totalMinutes <= 0) return "0m";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h >= 1000) return `${(h / 1000).toFixed(1)}k h`;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

interface BigScreenFriendsProps {
  profile: UserProfile;
  friends: Friend[];
  sessions: GameSession[];
  generatedFriendCode: string;
  selfStats: { gamesCount: number; playtimeMinutes: number; achievementsCount: number };
  performSync: (manual?: boolean) => Promise<void>;
  handleSetRsvp: (sessionId: string, status: any) => Promise<void>;
  handleDeleteSession: (sessionId: string) => Promise<void>;
  handleSendMessage: (sessionId: string, text: string) => Promise<void>;
  handleSaveProfile: (e: React.FormEvent) => Promise<void>;
  handleAddFriend: () => void;
  friendCodeInput: string;
  setFriendCodeInput: (val: string) => void;
  decodedFriend: Friend | null;
  handleTogglePin: (friendId: string) => void;
  handleToggleBlock: (friendId: string, friendName: string) => void;
  handleDeleteFriend: (friendId: string, friendName: string) => void;
  setProfile: React.Dispatch<React.SetStateAction<UserProfile>>;
}

type FriendsTab = "list" | "sessions" | "profile";

const FRIENDS_TABS: TabDef<FriendsTab>[] = [
  { id: "list", label: "Friends List" },
  { id: "sessions", label: "Game Lobbies" },
  { id: "profile", label: "My Profile" },
];

export default function BigScreenFriends({
  profile,
  friends,
  sessions,
  generatedFriendCode,
  selfStats,
  performSync,
  handleSetRsvp,
  handleDeleteSession,
  handleSendMessage,
  handleSaveProfile,
  handleAddFriend,
  friendCodeInput,
  setFriendCodeInput,
  decodedFriend,
  handleTogglePin,
  handleToggleBlock,
  handleDeleteFriend,
  setProfile,
}: BigScreenFriendsProps) {
  const [activeTab, setActiveTab] = useState<FriendsTab>("list");
  const [showAddModal, setShowAddModal] = useState(false);
  const [chattingSessionId, setChattingSessionId] = useState<string | null>(null);
  const [chatDraft, setChatDraft] = useState("");

  const handleSelectTab = useCallback((tabId: FriendsTab) => {
    setActiveTab(tabId);
  }, []);

  // Filter out deleted sessions
  const activeSessions = useMemo(() => {
    return sessions.filter((s) => !s.deleted).sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  }, [sessions]);

  // Active chat session
  const chatSession = useMemo(() => {
    return sessions.find((s) => s.id === chattingSessionId) || null;
  }, [sessions, chattingSessionId]);

  const submitChat = () => {
    const text = chatDraft.trim();
    if (!text || !chattingSessionId) return;
    handleSendMessage(chattingSessionId, text);
    setChatDraft("");
  };

  const focusAddFriendBtn = useFocusable(() => setShowAddModal(true));
  const focusSyncBtn = useFocusable(() => performSync(true));

  return (
    <div className="bigscreen-store-dashboard">
      <div className="bigscreen-dashboard-scrollable-content" style={{ padding: "30px 40px" }}>
        
        {/* Header Tabs */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <BigScreenTabBar
            tabs={FRIENDS_TABS}
            activeTab={activeTab}
            onActivate={handleSelectTab}
          />
          <div style={{ display: "flex", gap: "12px" }}>
            <button
              type="button"
              className="bigscreen-details-btn bigscreen-details-btn--secondary"
              {...focusSyncBtn}
              style={{ padding: "6px 12px", fontSize: "12px" }}
            >
              🔄 Sync Network
            </button>
            {activeTab === "list" && (
              <button
                type="button"
                className="bigscreen-details-btn bigscreen-details-btn--primary"
                {...focusAddFriendBtn}
                style={{ padding: "6px 12px", fontSize: "12px" }}
              >
                ➕ Add Friend
              </button>
            )}
          </div>
        </div>

        {/* Tab Panels */}
        <div className="bigscreen-gamepage-tab-scroll-region" style={{ marginTop: "10px" }}>
          
          {/* 1. Friends List Tab */}
          <BigScreenTabPanel tabId="list" activeTab={activeTab}>
            {friends.length === 0 ? (
              <div className="system-view-empty">
                <p>No friends added yet. Share your Public Key from the Profile tab, or click "Add Friend" to add one!</p>
              </div>
            ) : (
              <div className="bigscreen-library-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "20px" }}>
                {friends.map((friend) => (
                  <FriendCard
                    key={friend.id}
                    friend={friend}
                    onPin={() => handleTogglePin(friend.id)}
                    onBlock={() => handleToggleBlock(friend.id, friend.name)}
                    onDelete={() => handleDeleteFriend(friend.id, friend.name)}
                  />
                ))}
              </div>
            )}
          </BigScreenTabPanel>

          {/* 2. Game Lobbies (Sessions) Tab */}
          <BigScreenTabPanel tabId="sessions" activeTab={activeTab}>
            {activeSessions.length === 0 ? (
              <div className="system-view-empty">
                <p>No upcoming game sessions scheduled. Create sessions in desktop mode to coordinate co-op games!</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {activeSessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    profileName={profile.name}
                    onRsvp={(status) => handleSetRsvp(session.id, status)}
                    onOpenChat={() => setChattingSessionId(session.id)}
                    onDelete={() => handleDeleteSession(session.id)}
                  />
                ))}
              </div>
            )}
          </BigScreenTabPanel>

          {/* 3. My Profile Tab */}
          <BigScreenTabPanel tabId="profile" activeTab={activeTab}>
            <div className="bigscreen-gamepage-2col" data-cols="2" style={{ gap: "30px", alignItems: "flex-start" }}>
              {/* Profile Card & Key */}
              <div className="bigscreen-widget-card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                  <div className="friend-avatar-wrapper" style={{ width: "64px", height: "64px", fontSize: "24px", borderRadius: "50%", background: "var(--color-accent)" }}>
                    {profile.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h3 style={{ margin: 0 }}>{profile.name}</h3>
                    <div style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: "4px" }}>
                      "{profile.status || "No status set"}"
                    </div>
                  </div>
                </div>

                <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: "16px" }}>
                  <div style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--color-text-muted)", marginBottom: "6px" }}>My Public Key</div>
                  <div style={{ fontFamily: "monospace", fontSize: "11px", wordBreak: "break-all", background: "rgba(0,0,0,0.2)", padding: "10px", borderRadius: "6px" }}>
                    {generatedFriendCode}
                  </div>
                </div>

                <div className="profile-stats-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginTop: "10px" }}>
                  <div className="profile-stat-box" style={{ background: "rgba(255,255,255,0.02)", padding: "10px", borderRadius: "6px", textAlign: "center" }}>
                    <span style={{ display: "block", fontSize: "18px", fontWeight: "700" }}>{selfStats.gamesCount}</span>
                    <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Games</span>
                  </div>
                  <div className="profile-stat-box" style={{ background: "rgba(255,255,255,0.02)", padding: "10px", borderRadius: "6px", textAlign: "center" }}>
                    <span style={{ display: "block", fontSize: "18px", fontWeight: "700" }}>{formatHours(selfStats.playtimeMinutes)}</span>
                    <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Playtime</span>
                  </div>
                  <div className="profile-stat-box" style={{ background: "rgba(255,255,255,0.02)", padding: "10px", borderRadius: "6px", textAlign: "center" }}>
                    <span style={{ display: "block", fontSize: "18px", fontWeight: "700" }}>{selfStats.achievementsCount}</span>
                    <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Trophies</span>
                  </div>
                </div>
              </div>

              {/* Edit gamer details form */}
              <div className="bigscreen-widget-card" style={{ padding: "24px" }}>
                <h3 style={{ marginTop: 0, marginBottom: "20px" }}>Edit Profile</h3>
                <form onSubmit={handleSaveProfile} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  <div className="friends-input-group">
                    <label style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>Gamer Tag</label>
                    <input
                      type="text"
                      className="profile-input"
                      value={profile.name}
                      onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                      style={{ background: "rgba(0,0,0,0.2)", border: "1px solid var(--color-border)", color: "white", padding: "8px", borderRadius: "4px" }}
                      required
                    />
                  </div>
                  <div className="friends-input-group">
                    <label style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>Current Status</label>
                    <input
                      type="text"
                      className="profile-input"
                      value={profile.status}
                      onChange={(e) => setProfile({ ...profile, status: e.target.value })}
                      style={{ background: "rgba(0,0,0,0.2)", border: "1px solid var(--color-border)", color: "white", padding: "8px", borderRadius: "4px" }}
                    />
                  </div>
                  <button
                    type="submit"
                    className="bigscreen-details-btn bigscreen-details-btn--primary"
                    {...useFocusable(() => {})}
                    style={{ alignSelf: "flex-start", marginTop: "10px" }}
                  >
                    Save & Sync
                  </button>
                </form>
              </div>
            </div>
          </BigScreenTabPanel>

        </div>
      </div>

      {/* Add Friend Modal */}
      {showAddModal && (
        <div className="bigscreen-overlay-drawer" style={{ display: "flex", justifyContent: "center", alignItems: "center", background: "rgba(10, 11, 16, 0.9)" }} onClick={() => setShowAddModal(false)}>
          <div
            className="bigscreen-overlay-drawer-panel"
            style={{
              width: "500px",
              padding: "30px",
              borderRadius: "16px",
              border: "1px solid var(--color-border)",
              background: "var(--color-bg-primary)",
              display: "flex",
              flexDirection: "column",
              gap: "20px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: 0 }}>Add a Friend</h3>
            <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", margin: 0 }}>Paste your friend's Public Key code below.</p>
            <textarea
              className="friends-textarea"
              value={friendCodeInput}
              onChange={(e) => setFriendCodeInput(e.target.value)}
              placeholder="Paste public key here..."
              style={{ background: "rgba(0,0,0,0.2)", border: "1px solid var(--color-border)", color: "white", padding: "10px", borderRadius: "6px", height: "80px", resize: "none" }}
            />

            {decodedFriend ? (
              <div style={{ display: "flex", alignItems: "center", gap: "12px", background: "rgba(255,255,255,0.02)", padding: "10px", borderRadius: "8px" }}>
                <div className="friend-avatar-wrapper" style={{ width: "40px", height: "40px", borderRadius: "50%", background: "var(--color-warning)" }}>
                  {decodedFriend.name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: "600" }}>{decodedFriend.name}</div>
                  <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>{decodedFriend.status}</div>
                </div>
              </div>
            ) : (
              friendCodeInput.trim() && (
                <div style={{ fontSize: "12px", color: "var(--color-danger)" }}>Invalid Public Key.</div>
              )
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "10px" }}>
              <button
                type="button"
                className="bigscreen-details-btn bigscreen-details-btn--secondary"
                {...useFocusable(() => setShowAddModal(false))}
              >
                Cancel
              </button>
              <button
                type="button"
                className="bigscreen-details-btn bigscreen-details-btn--primary"
                disabled={!decodedFriend}
                {...useFocusable(() => {
                  if (decodedFriend) {
                    handleAddFriend();
                    setShowAddModal(false);
                  }
                })}
              >
                Add Friend
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lobbies Chat Modal */}
      {chattingSessionId && chatSession && (
        <div className="bigscreen-overlay-drawer" style={{ display: "flex", justifyContent: "center", alignItems: "center", background: "rgba(10, 11, 16, 0.9)" }} onClick={() => setChattingSessionId(null)}>
          <div
            className="bigscreen-overlay-drawer-panel"
            style={{
              width: "600px",
              height: "500px",
              borderRadius: "16px",
              border: "1px solid var(--color-border)",
              background: "var(--color-bg-primary)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--color-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Lobby Chat: {chatSession.gameName}</h3>
              <button type="button" style={{ background: "none", border: "none", color: "white", fontSize: "18px", cursor: "pointer" }} onClick={() => setChattingSessionId(null)}>✕</button>
            </div>
            
            {/* Messages body */}
            <div style={{ flex: 1, padding: "20px 24px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px" }}>
              {(chatSession.messages || []).length === 0 ? (
                <div style={{ textAlign: "center", color: "var(--color-text-muted)", fontSize: "13px", padding: "40px 0" }}>No messages in this lobby yet.</div>
              ) : (
                (chatSession.messages || []).map((m) => {
                  const isMe = m.author === profile.name;
                  return (
                    <div key={m.id} style={{ alignSelf: isMe ? "flex-end" : "flex-start", maxWidth: "70%" }}>
                      <div style={{ fontSize: "10px", color: "var(--color-text-muted)", marginBottom: "4px", textAlign: isMe ? "right" : "left" }}>{m.author}</div>
                      <div style={{ background: isMe ? "var(--color-accent)" : "var(--color-bg-tertiary)", padding: "10px 14px", borderRadius: "10px", fontSize: "13px", color: "white" }}>
                        {m.text}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Message input */}
            <div style={{ padding: "16px 24px", borderTop: "1px solid var(--color-border)", display: "flex", gap: "10px", background: "var(--color-bg-secondary)" }}>
              <input
                type="text"
                value={chatDraft}
                onChange={(e) => setChatDraft(e.target.value)}
                placeholder="Type a message..."
                style={{ flex: 1, background: "rgba(0,0,0,0.2)", border: "1px solid var(--color-border)", color: "white", padding: "8px 12px", borderRadius: "4px", fontSize: "13px" }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitChat();
                }}
              />
              <button
                type="button"
                className="bigscreen-details-btn bigscreen-details-btn--primary"
                style={{ padding: "6px 16px" }}
                {...useFocusable(submitChat)}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ─── Friend Card ─────────────────────────────────────────────────────

function FriendCard({
  friend,
  onPin,
  onBlock,
  onDelete,
}: {
  friend: Friend;
  onPin: () => void;
  onBlock: () => void;
  onDelete: () => void;
}) {
  const [showOptions, setShowOptions] = useState(false);

  const focusCard = useFocusable(() => setShowOptions(true));

  return (
    <div
      className={`bigscreen-game-card${friend.pinned ? " running" : ""}`}
      {...focusCard}
      style={{ display: "flex", flexDirection: "column", height: "200px", padding: "16px", justifyContent: "space-between" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <div className="friend-avatar-wrapper" style={{ width: "48px", height: "48px", borderRadius: "50%", background: "var(--color-accent)", display: "flex", justifyContent: "center", alignItems: "center", fontSize: "18px" }}>
          {friend.name.slice(0, 2).toUpperCase()}
        </div>
        <div style={{ flex: 1, overflow: "hidden" }}>
          <h4 style={{ margin: 0, fontSize: "15px", fontWeight: "600", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
            {displayName(friend)}
          </h4>
          <p style={{ margin: "4px 0 0 0", fontSize: "11px", color: "var(--color-text-muted)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
            {friend.currentlyPlaying ? `🎮 Playing: ${friend.currentlyPlaying}` : friend.status || "Offline"}
          </p>
        </div>
        {friend.pinned && <span style={{ fontSize: "12px" }}>📌</span>}
      </div>

      <div style={{ fontSize: "11px", color: "var(--color-text-muted)", borderTop: "1px solid rgba(255,255,255,0.03)", paddingTop: "8px" }}>
        {friend.libStats ? (
          <div>🎮 {friend.libStats.gamesCount} games · 🏆 {friend.libStats.achievementsCount} trophies</div>
        ) : (
          <div>No sync statistics yet</div>
        )}
      </div>

      {/* Quick popup options on click */}
      {showOptions && (
        <div className="bigscreen-overlay-drawer" style={{ display: "flex", justifyContent: "center", alignItems: "center", background: "rgba(10, 11, 16, 0.8)" }} onClick={() => setShowOptions(false)}>
          <div
            className="bigscreen-overlay-drawer-panel"
            style={{ width: "260px", padding: "16px", borderRadius: "12px", background: "var(--color-bg-primary)", border: "1px solid var(--color-border)", display: "flex", flexDirection: "column", gap: "10px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h4 style={{ margin: "0 0 5px 0", textAlign: "center" }}>{displayName(friend)}</h4>
            <button type="button" className="bigscreen-details-btn bigscreen-details-btn--secondary" {...useFocusable(() => { onPin(); setShowOptions(false); })} style={{ width: "100%", justifyContent: "center" }}>
              {friend.pinned ? "📌 Unpin Friend" : "📌 Pin Friend"}
            </button>
            <button type="button" className="bigscreen-details-btn bigscreen-details-btn--secondary" {...useFocusable(() => { onBlock(); setShowOptions(false); })} style={{ width: "100%", justifyContent: "center" }}>
              {friend.blocked ? "🚫 Unblock Friend" : "🚫 Block Friend"}
            </button>
            <button type="button" className="bigscreen-details-btn bigscreen-details-btn--danger" {...useFocusable(() => { onDelete(); setShowOptions(false); })} style={{ width: "100%", justifyContent: "center" }}>
              🗑️ Delete Friend
            </button>
            <button type="button" className="bigscreen-details-btn bigscreen-details-btn--secondary" {...useFocusable(() => setShowOptions(false))} style={{ width: "100%", justifyContent: "center", marginTop: "5px" }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Session Row ─────────────────────────────────────────────────────

function SessionRow({
  session,
  profileName,
  onRsvp,
  onOpenChat,
  onDelete,
}: {
  session: GameSession;
  profileName: string;
  onRsvp: (status: any) => void;
  onOpenChat: () => void;
  onDelete: () => void;
}) {
  const myRsvp = session.rsvps?.[profileName] || "none";

  const focusRsvpGoing = useFocusable(() => onRsvp("going"));
  const focusRsvpMaybe = useFocusable(() => onRsvp("maybe"));
  const focusRsvpDeclined = useFocusable(() => onRsvp("declined"));
  const focusChat = useFocusable(onOpenChat);
  const focusDelete = useFocusable(onDelete);

  const formattedDate = useMemo(() => {
    return new Date(session.scheduledAt).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [session.scheduledAt]);

  const attendeesCount = Object.values(session.rsvps || {}).filter((v) => v === "going").length;

  return (
    <div className="bigscreen-widget-card" style={{ padding: "20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <h4 style={{ margin: 0, fontSize: "16px", fontWeight: "700" }}>{session.gameName}</h4>
          <BigScreenPill tone="accent" size="sm">Lobby</BigScreenPill>
        </div>
        <div style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
          📅 {formattedDate} · 👥 {attendeesCount} / {session.maxPlayers} going
        </div>
        {session.description && (
          <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginTop: "4px" }}>
            "{session.description}"
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
        {/* RSVP button strip */}
        <div style={{ display: "flex", borderRadius: "6px", background: "rgba(255,255,255,0.02)", border: "1px solid var(--color-border)", padding: "2px" }}>
          <button type="button" {...focusRsvpGoing} style={{ border: "none", background: myRsvp === "going" ? "#10b981" : "transparent", color: "white", padding: "6px 12px", borderRadius: "4px", fontSize: "12px", cursor: "pointer", fontWeight: myRsvp === "going" ? "700" : "400" }}>
            Going
          </button>
          <button type="button" {...focusRsvpMaybe} style={{ border: "none", background: myRsvp === "maybe" ? "var(--color-warning)" : "transparent", color: "white", padding: "6px 12px", borderRadius: "4px", fontSize: "12px", cursor: "pointer", fontWeight: myRsvp === "maybe" ? "700" : "400" }}>
            Maybe
          </button>
          <button type="button" {...focusRsvpDeclined} style={{ border: "none", background: myRsvp === "declined" ? "var(--color-danger)" : "transparent", color: "white", padding: "6px 12px", borderRadius: "4px", fontSize: "12px", cursor: "pointer", fontWeight: myRsvp === "declined" ? "700" : "400" }}>
            Decline
          </button>
        </div>

        <button type="button" className="bigscreen-details-btn bigscreen-details-btn--secondary" {...focusChat}>
          💬 Chat
        </button>

        {session.creatorName === profileName && (
          <button type="button" className="bigscreen-details-btn bigscreen-details-btn--secondary" {...focusDelete} style={{ color: "var(--color-danger)" }}>
            🗑️ Cancel
          </button>
        )}
      </div>
    </div>
  );
}
