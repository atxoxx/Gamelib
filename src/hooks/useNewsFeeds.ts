import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";

// ── Types ──────────────────────────────────────────────────────────────

export interface NewsFeed {
  name: string;
  url: string;
  isDefault: boolean;
  enabled: boolean;
}

export interface NewsArticle {
  title: string;
  link: string;
  description: string;
  content: string;
  pubDate: string;
  sourceName: string;
  sourceUrl: string;
  imageUrl: string | null;
}

// ── Default Gaming News RSS Feeds ──────────────────────────────────────

export const DEFAULT_FEEDS: NewsFeed[] = [
  {
    name: "PC Gamer",
    url: "https://www.pcgamer.com/rss/",
    isDefault: true,
    enabled: true,
  },
  {
    name: "Rock Paper Shotgun",
    url: "https://www.rockpapershotgun.com/feed",
    isDefault: true,
    enabled: true,
  },
  {
    name: "Eurogamer",
    url: "https://www.eurogamer.net/feed",
    isDefault: true,
    enabled: true,
  },
  {
    name: "Gematsu",
    url: "https://www.gematsu.com/feed",
    isDefault: true,
    enabled: true,
  },
  {
    name: "Kotaku",
    url: "https://kotaku.com/rss",
    isDefault: true,
    enabled: true,
  },
  {
    name: "IGN",
    url: "https://feeds.feedburner.com/ign/all",
    isDefault: true,
    enabled: true,
  },
  {
    name: "VGC",
    url: "https://www.videogameschronicle.com/feed/",
    isDefault: true,
    enabled: true,
  },
];

const STORAGE_KEY = "gamelib-news-feeds";
const CACHE_KEY = "gamelib-news-cache";
const READ_KEY = "gamelib-news-read";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── Helpers ────────────────────────────────────────────────────────────

/** Load custom feeds from localStorage. */
function loadCustomFeeds(): NewsFeed[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as NewsFeed[];
  } catch {
    return [];
  }
}

/** Save custom feeds to localStorage. */
function saveCustomFeeds(feeds: NewsFeed[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(feeds));
}

/** Load the set of read article links from localStorage. */
function loadReadLinks(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

/** Persist the set of read article links to localStorage. */
function saveReadLinks(links: Set<string>): void {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify(Array.from(links)));
  } catch { /* ignore */ }
}

/**
 * Auto-discover a feed URL from a site homepage by looking for
 * <link rel="alternate" type="application/rss+xml|atom+xml"> tags.
 * Returns the first discovered feed href, or null if none found.
 */
export async function discoverFeedUrl(homepage: string): Promise<string | null> {
  const hasTauri = typeof window !== "undefined" && "__TAURI__" in window;
  let html: string;
  try {
    if (hasTauri) {
      html = await invoke<string>("fetch_url", { url: homepage });
    } else {
      const res = await fetch(homepage, {
        headers: { Accept: "text/html, */*" },
      });
      if (!res.ok) return null;
      html = await res.text();
    }
  } catch {
    return null;
  }

  const doc = new DOMParser().parseFromString(html, "text/html");
  const links = Array.from(
    doc.querySelectorAll('link[type="application/rss+xml"], link[type="application/atom+xml"], link[rel="alternate"]')
  );
  for (const link of links) {
    const type = link.getAttribute("type") ?? "";
    const rel = link.getAttribute("rel") ?? "";
    if (/rss\+xml|atom\+xml/i.test(type) || rel === "alternate") {
      const href = link.getAttribute("href");
      if (href) {
        try {
          return new URL(href, homepage).toString();
        } catch {
          return href;
        }
      }
    }
  }
  return null;
}

export interface DiscoveredFeed {
  name: string;
  url: string;
}

/** Parse an OPML document string into a list of feed sources. */
export function parseOpml(opmlText: string): DiscoveredFeed[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(opmlText, "text/xml");
  if (doc.querySelector("parsererror")) return [];

  const feeds: DiscoveredFeed[] = [];
  const seen = new Set<string>();
  const outlines = doc.querySelectorAll("outline");
  for (const outline of Array.from(outlines)) {
    const type = outline.getAttribute("type");
    const xmlUrl =
      outline.getAttribute("xmlUrl") ??
      outline.getAttribute("xmlurl") ??
      outline.getAttribute("url");
    if ((!type || /^rss|atom$/i.test(type)) && xmlUrl) {
      const normalized = xmlUrl.trim();
      if (seen.has(normalized.toLowerCase())) continue;
      seen.add(normalized.toLowerCase());
      feeds.push({
        name: (outline.getAttribute("title") || outline.getAttribute("text") || normalized).trim(),
        url: normalized,
      });
    }
  }
  return feeds;
}

/** Serialize a list of feeds into an OPML document string. */
export function buildOpml(feeds: NewsFeed[]): string {
  const now = new Date().toUTCString();
  const body = feeds
    .map((f) => {
      const name = f.name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const url = f.url.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `    <outline type="rss" text="${name}" title="${name}" xmlUrl="${url}"/>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>Gamelib News Feeds</title>
    <dateCreated>${now}</dateCreated>
  </head>
  <body>
${body}
  </body>
</opml>`;
}

/** Get all enabled feed URLs. */
function getEnabledUrls(customFeeds: NewsFeed[]): NewsFeed[] {
  const all = [...DEFAULT_FEEDS, ...customFeeds.filter((f) => !f.isDefault)];
  return all.filter((f) => f.enabled);
}

/** Parse RSS XML into NewsArticle array. */
function parseRSS(xmlText: string, sourceName: string, sourceUrl: string): NewsArticle[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "text/xml");

  // Check for parse errors
  const parseError = doc.querySelector("parsererror");
  if (parseError) return [];

  // Handle both RSS 2.0 and Atom feeds
  const rssItems = doc.querySelectorAll("item");
  const atomEntries = doc.querySelectorAll("entry");

  if (rssItems.length > 0) {
    return Array.from(rssItems).map((item) => ({
      title: item.querySelector("title")?.textContent?.trim() ?? "Untitled",
      link: item.querySelector("link")?.textContent?.trim() ?? sourceUrl,
      description: stripHtml(item.querySelector("description")?.textContent ?? ""),
      content: item.querySelector("content\\:encoded, encoded, content")?.textContent
        ?? item.querySelector("description")?.textContent
        ?? "",
      pubDate: item.querySelector("pubDate")?.textContent
        ?? item.querySelector("dc\\:date, date")?.textContent
        ?? "",
      sourceName,
      sourceUrl,
      imageUrl: extractImageUrl(item),
    }));
  }

  if (atomEntries.length > 0) {
    return Array.from(atomEntries).map((entry) => ({
      title: entry.querySelector("title")?.textContent?.trim() ?? "Untitled",
      link: getAtomLink(entry) ?? sourceUrl,
      description: stripHtml(
        entry.querySelector("summary")?.textContent
        ?? entry.querySelector("content")?.textContent
        ?? ""
      ),
      content: entry.querySelector("content")?.textContent
        ?? entry.querySelector("summary")?.textContent
        ?? "",
      pubDate: entry.querySelector("published")?.textContent
        ?? entry.querySelector("updated")?.textContent
        ?? "",
      sourceName,
      sourceUrl,
      imageUrl: extractAtomImage(entry),
    }));
  }

  return [];
}

/** Get link href from an Atom entry. */
function getAtomLink(entry: Element): string | null {
  const links = entry.querySelectorAll("link");
  for (const link of links) {
    const rel = link.getAttribute("rel");
    if (!rel || rel === "alternate") {
      const href = link.getAttribute("href");
      if (href) return href;
    }
  }
  // Fallback: first link with an href
  for (const link of links) {
    const href = link.getAttribute("href");
    if (href) return href;
  }
  return null;
}

/** Extract image from RSS item (enclosure, media:content, media:thumbnail). */
function extractImageUrl(item: Element): string | null {
  // Check enclosure
  const enclosure = item.querySelector("enclosure");
  if (enclosure?.getAttribute("type")?.startsWith("image")) {
    return enclosure.getAttribute("url") ?? null;
  }

  // Check media:content
  const mediaContent = item.querySelector(
    "media\\:content, content[medium='image'], content[type^='image']"
  );
  if (mediaContent) return mediaContent.getAttribute("url") ?? null;

  // Check media:thumbnail
  const mediaThumb = item.querySelector("media\\:thumbnail, thumbnail");
  if (mediaThumb) return mediaThumb.getAttribute("url") ?? null;

  // Extract first <img> from description/content
  const contentHtml = item.querySelector("content\\:encoded, encoded, content, description")?.textContent ?? "";
  return extractFirstImage(contentHtml);
}

/** Extract image from Atom entry. */
function extractAtomImage(entry: Element): string | null {
  const mediaContent = entry.querySelector(
    "media\\:content, content[type^='image']"
  );
  if (mediaContent) return mediaContent.getAttribute("url") ?? null;

  const mediaThumb = entry.querySelector("media\\:thumbnail, thumbnail");
  if (mediaThumb) return mediaThumb.getAttribute("url") ?? null;

  const contentHtml = entry.querySelector("content, summary")?.textContent ?? "";
  return extractFirstImage(contentHtml);
}

/** Extract first meaningful <img> src from an HTML string.
 *  Filters out tracking pixels, icons, and other tiny images. */
function extractFirstImage(html: string): string | null {
  const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRegex.exec(html)) !== null) {
    const src = match[1];
    // Skip tracking pixels and tiny icons
    if (isTinyImage(src)) continue;
    // Skip common icon/spacer patterns
    if (/\b(spacer|pixel|tracking|1x1|blank|dot|icon-16|favicon)\b/i.test(src)) continue;
    return src;
  }
  return null;
}

/** Check if a URL likely points to a tiny/tracking image. */
function isTinyImage(url: string): boolean {
  // URLs with explicit dimension hints for tiny images
  if (/\b(1x1|1\.gif|1\.png|pixel\.gif|spacer\.gif|blank\.gif|dot_clear\.gif)\b/i.test(url)) return true;
  return false;
}

/** Strip HTML tags from a string, preserving paragraph-like structure. */
function stripHtml(html: string): string {
  // Replace block-level breaks with newlines before stripping tags
  let cleaned = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n");
  // Strip remaining HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, "");
  // Decode common HTML entities
  cleaned = cleaned.replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&nbsp;/g, " ");
  // Collapse multiple newlines and trim per-line whitespace
  cleaned = cleaned
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join(" ");
  return cleaned.trim();
}

/** Format a date for display. Returns relative or absolute date. */
export function formatArticleDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;

    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
    });
  } catch {
    return dateStr;
  }
}

// ── Cache types ────────────────────────────────────────────────────────

interface NewsCache {
  timestamp: number;
  articles: NewsArticle[];
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useNewsFeeds() {
  const [customFeeds, setCustomFeeds] = useState<NewsFeed[]>(loadCustomFeeds);
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSource, setActiveSource] = useState<string | null>(null); // null = all
  const [readLinks, setReadLinks] = useState<Set<string>>(loadReadLinks);
  // All feeds (defaults + custom, respecting enabled state)
  const allFeeds = useMemo(() => {
    const defaults = DEFAULT_FEEDS.map((d) => {
      // Check if there's a custom override
      const override = customFeeds.find((c) => c.url === d.url);
      return override ?? d;
    });
    const customs = customFeeds.filter((c) => !DEFAULT_FEEDS.some((d) => d.url === c.url));
    return [...defaults, ...customs];
  }, [customFeeds]);

  // All unique source names
  const sourceNames = useMemo(() => {
    const names = allFeeds.filter((f) => f.enabled).map((f) => f.name);
    return [...new Set(names)];
  }, [allFeeds]);

  // Filtered articles
  const filteredArticles = useMemo(() => {
    if (!activeSource) return articles;
    return articles.filter((a) => a.sourceName === activeSource);
  }, [articles, activeSource]);

  // Mounted ref to prevent state updates after unmount
  const mountedRef = useRef(true);

  // Fetch all enabled feeds using the Tauri backend (reqwest, no CORS).
  // Falls back to browser fetch() in dev-only Vite mode (npm run dev).
  const fetchFeeds = useCallback(async (force = false) => {
    // Check cache first
    if (!force) {
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          const parsed: NewsCache = JSON.parse(cached);
          if (Date.now() - parsed.timestamp < CACHE_TTL_MS) {
            setArticles(parsed.articles);
            setLoading(false);
            return;
          }
        }
      } catch { /* ignore cache parse errors */ }
    }

    // Check whether we're running inside a Tauri webview.
    // In dev-only Vite mode (npm run dev), Tauri isn't available
    // and we fall back to browser fetch() — usable when the dev
    // server has CORS proxying, otherwise feeds will fail.
    const hasTauri = typeof window !== "undefined" && "__TAURI__" in window;

    setLoading(true);
    setError(null);

    const enabledFeeds = getEnabledUrls(customFeeds);

    // Fetch all feeds in parallel (#17). Failures are isolated per-feed
    // so a single broken source doesn't blank the whole page.
    const results = await Promise.all(
      enabledFeeds.map(async (feed) => {
        try {
          let xmlText: string;
          if (hasTauri) {
            // Use the Rust backend's reqwest client — no CORS restrictions.
            xmlText = await invoke<string>("fetch_url", { url: feed.url });
          } else {
            // Browser fetch() — only works if CORS is relaxed (e.g. via Vite proxy).
            const response = await fetch(feed.url, {
              headers: { Accept: "application/rss+xml, application/xml, text/xml, */*" },
            });
            if (!response.ok) {
              return { feed, ok: false as const, error: `HTTP ${response.status}` };
            }
            xmlText = await response.text();
          }
          const parsed = parseRSS(xmlText, feed.name, feed.url);
          return { feed, ok: true as const, articles: parsed };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return { feed, ok: false as const, error: msg };
        }
      })
    );

    const allArticles: NewsArticle[] = [];
    const failedFeeds: string[] = [];
    for (const r of results) {
      if (r.ok) {
        allArticles.push(...r.articles);
      } else {
        failedFeeds.push(`${r.feed.name} (${r.feed.url})`);
        console.warn(`[News] Error fetching ${r.feed.name}: ${r.error}`);
      }
    }

    // Sort by date, newest first
    allArticles.sort((a, b) => {
      const da = new Date(a.pubDate).getTime();
      const db = new Date(b.pubDate).getTime();
      if (isNaN(da) && isNaN(db)) return 0;
      if (isNaN(da)) return 1;
      if (isNaN(db)) return -1;
      return db - da;
    });

    if (!mountedRef.current) return;
    setArticles(allArticles);

    // Save to cache
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ timestamp: Date.now(), articles: allArticles })
      );
    } catch { /* ignore cache write errors */ }

    if (allArticles.length === 0 && enabledFeeds.length > 0) {
      setError("No articles found. RSS feeds may be unavailable right now.");
    } else if (failedFeeds.length > 0) {
      // Surface which feeds failed without hiding the working ones.
      console.warn(`[News] ${failedFeeds.length} feed(s) failed: ${failedFeeds.join(", ")}`);
    }

    if (mountedRef.current) setLoading(false);
  }, [customFeeds]);

  // Toggle a source filter
  const setSourceFilter = useCallback((sourceName: string | null) => {
    setActiveSource(sourceName);
  }, []);

  // Toggle a feed on/off
  const toggleFeed = useCallback(
    (feedUrl: string) => {
      setCustomFeeds((prev) => {
        const updated = prev.map((f) =>
          f.url === feedUrl ? { ...f, enabled: !f.enabled } : f
        );
        // Also update default feeds
        saveCustomFeeds(updated);
        return updated;
      });
    },
    []
  );

  // Add a custom feed
  const addCustomFeed = useCallback(
    (name: string, url: string) => {
      setCustomFeeds((prev) => {
        const updated = [...prev, { name, url, isDefault: false, enabled: true }];
        saveCustomFeeds(updated);
        return updated;
      });
    },
    []
  );

  // Remove a custom feed
  const removeCustomFeed = useCallback(
    (feedUrl: string) => {
      setCustomFeeds((prev) => {
        const updated = prev.filter((f) => f.url !== feedUrl);
        saveCustomFeeds(updated);
        return updated;
      });
    },
    []
  );

  // Mark an article as read (#4)
  const markRead = useCallback((articleLink: string) => {
    setReadLinks((prev) => {
      if (prev.has(articleLink)) return prev;
      const updated = new Set(prev);
      updated.add(articleLink);
      saveReadLinks(updated);
      return updated;
    });
  }, []);

  // Mark all currently-loaded articles as read (#4)
  const markAllRead = useCallback(() => {
    setReadLinks((prev) => {
      const updated = new Set(prev);
      for (const a of articles) updated.add(a.link);
      saveReadLinks(updated);
      return updated;
    });
  }, [articles]);

  // Initial fetch
  useEffect(() => {
    mountedRef.current = true;
    fetchFeeds();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchFeeds]);    return {
      articles: filteredArticles,
      allArticles: articles,
      loading,
      error,
      activeSource,
      sourceNames,
      allFeeds,
      customFeeds: customFeeds.filter((f) => !f.isDefault),
      setSourceFilter,
      toggleFeed,
      addCustomFeed,
      removeCustomFeed,
      refresh: () => fetchFeeds(true),
      // Read-tracking (#4)
      readLinks,
      markRead,
      markAllRead,
      // Expose enabled feeds for display in settings
      enabledFeedUrls: new Set(allFeeds.filter((f) => f.enabled).map((f) => f.url)),
    };
}
