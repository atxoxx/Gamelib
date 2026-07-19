// Community persistence helpers — localStorage-backed state for the
// Community tab (screenshot favorites, monthly playtime goal, saved
// articles, recently unlocked showcase opt-in). Kept self-contained so
// the React components stay declarative and don't each re-implement
// their own storage keys.

const LS_FAVORITES = "gamelib.community.favorites";
const LS_GOAL_MIN = "gamelib.community.monthly_goal_min";
const LS_SAVED_ARTICLES = "gamelib.community.saved_articles";

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
    /* storage full / unavailable — ignore */
  }
}

// ── Screenshot favorites ──────────────────────────────────────────────
// Favorites are keyed by the absolute screenshot path so they survive
// re-detection (paths are stable across Steam/system scans).

export function loadFavorites(): Set<string> {
  return new Set(readJson<string[]>(LS_FAVORITES, []));
}

export function saveFavorites(favs: Set<string>): void {
  writeJson(LS_FAVORITES, Array.from(favs));
}

// ── Monthly playtime goal (minutes) ────────────────────────────────────

export function loadMonthlyGoal(): number {
  const v = readJson<number>(LS_GOAL_MIN, 0);
  return Number.isFinite(v) ? v : 0;
}

export function saveMonthlyGoal(min: number): void {
  writeJson(LS_GOAL_MIN, min);
}

// ── Saved / bookmarked news articles ───────────────────────────────────

export interface SavedArticle {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  sourceName: string;
  sourceUrl: string;
  imageUrl: string | null;
}

export function loadSavedArticles(): SavedArticle[] {
  return readJson<SavedArticle[]>(LS_SAVED_ARTICLES, []);
}

export function saveSavedArticles(articles: SavedArticle[]): void {
  writeJson(LS_SAVED_ARTICLES, articles);
}
