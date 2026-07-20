// Community persistence helpers — localStorage-backed state for the
// Community tab (screenshot favorites, monthly playtime goal, saved
// articles, recently unlocked showcase opt-in). Kept self-contained so
// the React components stay declarative and don't each re-implement
// their own storage keys.

const LS_FAVORITES = "gamelib.community.favorites";
const LS_GOAL_MIN = "gamelib.community.monthly_goal_min";
const LS_SAVED_ARTICLES = "gamelib.community.saved_articles";
const LS_SCREENSHOT_CACHE = "gamelib.community.screenshot_cache";

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

// ── Cached screenshot detection ──────────────────────────────────────
// Persists the last successful auto-detect so the tab can re-hydrate
// instantly on the next visit instead of requiring a manual re-scan.
// The cache holds the raw detected groups (before any filtering).

export interface CachedScreenshotGroup {
  key: string;
  appId?: number;
  gameName: string;
  gameId?: string;
  coverArtUrl?: string;
  platform?: string;
  folderPath: string;
  screenshots: string[];
  source?: string;
}

export function loadScreenshotCache(): CachedScreenshotGroup[] {
  return readJson<CachedScreenshotGroup[]>(LS_SCREENSHOT_CACHE, []);
}

export function saveScreenshotCache(groups: CachedScreenshotGroup[]): void {
  writeJson(LS_SCREENSHOT_CACHE, groups);
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

/** True when an article (keyed by link) is bookmarked. */
export function isArticleSaved(link: string): boolean {
  return loadSavedArticles().some((a) => a.link === link);
}

/**
 * Toggle a saved article. When `article` is provided and not yet saved it is
 * appended (most-recent first); when already saved it is removed. Returns the
 * resulting list of saved articles.
 */
export function toggleSavedArticle(article: SavedArticle): SavedArticle[] {
  const current = loadSavedArticles();
  const idx = current.findIndex((a) => a.link === article.link);
  let next: SavedArticle[];
  if (idx >= 0) {
    next = current.filter((a) => a.link !== article.link);
  } else {
    next = [article, ...current];
  }
  saveSavedArticles(next);
  return next;
}

/** Remove a saved article by link. Returns the resulting list. */
export function removeSavedArticle(link: string): SavedArticle[] {
  const next = loadSavedArticles().filter((a) => a.link !== link);
  saveSavedArticles(next);
  return next;
}
