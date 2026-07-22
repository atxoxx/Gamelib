import { useMemo } from "react";
import { loadFriends, loadSessions, type Friend, type GameSession } from "../pages/friendsStorage";

/**
 * useFriendsPlaying
 *
 * Derives "friends currently in this game" for a hero surface. Two
 * signals are combined:
 *   1. `friend.currentlyPlaying` === game name (live "now playing")
 *   2. Active `GameSession`s whose game matches (co-op / scheduled)
 *
 * Matching is normalized (case-insensitive, collapsed whitespace) so
 * IGDB/Steam name variants still line up with a friend's free-text
 * `currentlyPlaying` string. Reads from localStorage-backed helpers
 * (synchronous) — cheap enough to run on every hero mount.
 */

function normalizeName(s?: string | null): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

export interface FriendsPlayingResult {
  /** Friends whose live status names this game. */
  playingNow: Friend[];
  /** Active sessions for this game (not tombstoned). */
  sessions: GameSession[];
  /** Unique avatars to render (playing-now first, then session hosts). */
  avatars: { src: string; name: string }[];
  /** Total distinct people surfaced. */
  count: number;
}

export function useFriendsPlaying(
  gameName?: string,
  gameId?: string | number
): FriendsPlayingResult {
  return useMemo(() => {
    const target = normalizeName(gameName);
    if (!target) {
      return { playingNow: [], sessions: [], avatars: [], count: 0 };
    }

    const friends = loadFriends();
    const playingNow = friends.filter(
      (f) => !f.blocked && normalizeName(f.currentlyPlaying) === target
    );

    const sessions = loadSessions().filter(
      (s) =>
        !s.deleted &&
        (s.gameId === String(gameId ?? "") ||
          normalizeName(s.gameName) === target)
    );

    const seen = new Set<string>();
    const avatars: { src: string; name: string }[] = [];
    for (const f of playingNow) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      avatars.push({ src: f.avatar, name: f.name });
    }
    for (const s of sessions) {
      for (const p of s.participants ?? []) {
        if (seen.has(p.name)) continue;
        seen.add(p.name);
        avatars.push({ src: "", name: p.name });
      }
    }

    return {
      playingNow,
      sessions,
      avatars,
      count: avatars.length,
    };
  }, [gameName, gameId]);
}
