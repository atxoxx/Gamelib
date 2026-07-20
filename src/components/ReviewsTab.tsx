import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useBigScreen } from "../context/BigScreenContext";
import { useFocusable } from "../hooks/useFocusable";
import {
  type Game,
  type IgdbReview,
  type ReviewFetchResult,
  type SteamReaction,
  extractSteamAppId,
  resolveSteamAppId,
  STEAM_LANGUAGES,
  STEAM_REACTIONS,
  formatPlayTime,
} from "../types/game";
import { useGames } from "../context/GameContext";
import { useToast } from "../context/ToastContext";

// ─── Types ──────────────────────────────────────────────────────────────────

type RatingFilter = "all" | "positive" | "negative";
/** Sort modes mapped to Steam's `filter` query param:
 *  - "featured"   → filter=all       (Steam's default "most helpful")
 *  - "recent"     → filter=updated   (sorted by last update)
 *  - "funny"      → filter=funny     (reactions > votes funny)
 *  - "highest"    → client-side sort by rating (Steam has no "highest" param)
 *  - "longest"    → client-side sort by review length
 */
type SortOrder = "featured" | "recent" | "funny" | "highest" | "longest";
type SourceFilter = "all" | "steam" | "you" | "metacritic" | "opencritic" | "rawg";
/** Steam review purchase_type param. Maps 1:1 to the query value. */
type PurchaseTypeFilter = "all" | "steam" | "other";
/** Playtime filter. "over_1h" / "over_10h" map to Steam's
 *  `playtime_filter_min_<hours>` query params. "custom" applies
 *  client-side (Steam only supports a single min threshold). */
type PlaytimeFilter = "none" | "over_1h" | "over_10h" | "custom";

/** A normalized review record we render. Combines local + Steam-fetched data. */
interface ReviewItem {
  id: string;
  /** Stable index assigned during the build step. Used for the
   *  "featured" sort (Steam's natural order) — string IDs like
   *  `steam-{idx}` would re-introduce the parseInt bug we're fixing. */
  sourceIndex: number;
  source: "you" | "steam" | "metacritic" | "opencritic" | "rawg";
  sourceLabel: string;
  username: string;
  rating: number | null;
  ratingLabel: string;
  title: string;
  /** Review body. May contain Steam BB code; rendered through
   *  `BbCodeRenderer` so [b]/[i]/[url]/[spoiler] etc. display properly. */
  content: string;
  dateAdded?: number;
  reviewLength: number;
  language?: string;
  sentiment: "positive" | "negative" | null;
  /** Steam: number of users who found this helpful. */
  votesUp?: number;
  /** Steam: number of users who found this funny. */
  votesFunny?: number;
  /** Steam: full reaction breakdown (newest addition). */
  reactions?: SteamReaction[];
  /** Steam: comment count (newest addition). */
  commentCount?: number;
  /** Steam: reviewer playtime at the moment of writing (minutes). */
  authorPlaytimeAtReview?: number;
  /** Steam: reviewer's total playtime across all games (minutes). */
  authorPlaytimeForever?: number;
  /** Steam: reviewer's Steam Deck playtime for this game (minutes). */
  authorDeckPlaytimeAtReview?: number;
  /** Steam: reviewer primarily played on Steam Deck. */
  primarilySteamDeck?: boolean;
  /** Steam: reviewer received the game for free. */
  receivedForFree?: boolean;
  /** Steam: review was written during Early Access. */
  writtenDuringEarlyAccess?: boolean;
  /** Steam: reviewer purchased on Steam directly. */
  steamPurchase?: boolean;
  /** Steam: reviewer's SteamID64 — used for the deep-link button. */
  authorSteamId?: string;
  /** Steam: raw hardware JSON string. Parsed client-side by
   *  `parseSteamHardware` since the schema is unstable. */
  hw?: string;
  /** True when `reviewLength` is in bytes rather than characters.
   *  The byte length is what Steam actually returns; we keep both
   *  for display but use the byte count for sort. */
  reviewLengthBytes: number;
}

// ─── Steam hardware JSON parser ────────────────────────────────────────────

/** Parsed Steam `hw` payload. The schema is unstable across API
 *  versions so every field is optional; the renderer only shows
 *  lines whose value is non-null. */
interface SteamHardware {
  os?: string;
  cpuName?: string;
  gpuName?: string;
  /** RAM in MB (Steam returns the value as a string; we coerce). */
  systemRamMb?: number;
  /** VRAM in MB. */
  vramSize?: number;
}

function parseSteamHardware(raw: string | undefined): SteamHardware | null {
  if (!raw) return null;
  try {
    // Steam's hw field is itself a JSON string in some API responses.
    // Try parsing once; if that fails, the value might be already-
    // parsed (an object passed through some intermediate layer).
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // `os` and `cpuName` are sometimes nested under different keys
    // across API versions; check both.
    const os = pickString(parsed, ["os", "OS"]);
    const cpuName = pickString(parsed, ["cpuName", "cpu", "processorName"]);
    const gpuName = pickString(parsed, ["adapterDescription", "gpu", "gpuName"]);
    const systemRamMb = pickNumber(parsed, ["systemRam", "ram", "totalMemoryMB"]);
    const vramSize = pickNumber(parsed, ["vramSize", "vram", "videoMemoryMB"]);
    if (!os && !cpuName && !gpuName && !systemRamMb && !vramSize) return null;
    return { os, cpuName, gpuName, systemRamMb, vramSize };
  } catch {
    return null;
  }
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
    if (typeof v === "string") {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return undefined;
}

function formatRam(mb: number | undefined): string | null {
  if (mb === undefined || mb <= 0) return null;
  // Steam returns the value as either MB (old) or GB*1024 (newer).
  // Threshold: anything < 64 GB * 1024 = 65536 MB is treated as MB.
  if (mb < 65536) return `${(mb / 1024).toFixed(1)} GB`;
  // Already in MB but huge; fall through to GB.
  return `${(mb / 1024).toFixed(0)} GB`;
}

function formatVram(mb: number | undefined): string | null {
  if (mb === undefined || mb <= 0) return null;
  return `${(mb / 1024).toFixed(1)} GB`;
}

// ─── BB code renderer ──────────────────────────────────────────────────────

/** Maximum nesting depth for the BB code parser. Steam review text
 *  rarely nests more than 2-3 levels deep; anything deeper is almost
 *  certainly malformed author markup that we should treat as text
 *  rather than spawn a deeply-nested React tree. */
const BB_MAX_DEPTH = 6;

/** Maximum output length (chars). Steam review text is bounded by
 *  Steam itself, but a pathological BB code string could explode
 *  into huge output. Clamp so the renderer stays responsive. */
const BB_MAX_OUTPUT = 20_000;

/** Parse Steam BB code into a flat list of React-renderable nodes.
 *
 *  Implementation note: a proper state machine is the textbook
 *  approach but adds ~200 lines for a feature that is, in practice,
 *  straight-line text with optional inline markup. We use a
 *  depth-limited recursive-descent parser that:
 *  1. Strips leading/trailing whitespace and CR/LF (BB code is
 *     line-oriented; we keep paragraph breaks).
 *  2. Strips any HTML tags from the input (XSS defense — Steam's
 *     [url=...] and [img] tags are the only ones that emit raw
 *     HTML, and we sanitise both).
 *  3. Walks the string char-by-char, recognising `[tag]...[/tag]`
 *     and `[self]` markers. Nested same-tag blocks are processed
 *     recursively up to `BB_MAX_DEPTH`.
 *  4. Returns React elements for the supported tags; unknown tags
 *     pass through as their inner text.
 */
function parseBbCode(input: string): React.ReactNode[] {
  if (!input) return [];
  if (input.length > BB_MAX_OUTPUT) {
    input = input.slice(0, BB_MAX_OUTPUT);
  }
  // Strip CR (keep \n as paragraph separators). We also strip any
  // literal HTML tags since Steam's BB code is the only "rich text"
  // surface we render; any embedded HTML would be a Steam-side bug.
  const safe = stripHtml(input).replace(/\r/g, "");

  const nodes: React.ReactNode[] = [];
  const cursor = { i: 0 };
  parseBlock(safe, cursor, nodes, 0);
  return nodes;
}

/** Strip any literal HTML tags from `input`. This is XSS defense —
 *  Steam review content is BB code only, and any embedded HTML
 *  would be unexpected. We don't try to preserve escaping
 *  (`&lt;` etc.) since Steam authors don't use it. */
function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "");
}

/** Parse a top-level block of text, splitting on tag boundaries
 *  and recursing into nested tags up to `depth`. */
function parseBlock(
  src: string,
  cursor: { i: number },
  out: React.ReactNode[],
  depth: number,
): void {
  if (depth > BB_MAX_DEPTH) {
    // Bail: append the rest as a text node and stop parsing.
    out.push(renderText(src.slice(cursor.i)));
    cursor.i = src.length;
    return;
  }
  const len = src.length;
  let buf = "";
  while (cursor.i < len) {
    if (out.length > 200) {
      // Defensive: 200 top-level nodes is more than any sane review.
      // Bail rather than spend the rest of the render on BB parsing.
      out.push(renderText(buf + src.slice(cursor.i)));
      cursor.i = len;
      return;
    }
    const ch = src[cursor.i];
    if (ch === "\n") {
      if (buf) {
        out.push(renderText(buf));
        buf = "";
      }
      out.push(<br key={`br-${out.length}-${cursor.i}`} />);
      cursor.i++;
      // Skip blank lines so a `\n\n` doesn't render as 2x <br>.
      while (cursor.i < len && src[cursor.i] === "\n") cursor.i++;
      continue;
    }
    if (ch !== "[") {
      buf += ch;
      cursor.i++;
      continue;
    }
    // Try to read a tag at the current position.
    const tagMatch = readTag(src, cursor.i);
    if (!tagMatch) {
      buf += ch;
      cursor.i++;
      continue;
    }
    if (tagMatch.kind === "close") {
      // Stray close tag (no matching open) — emit the tag literal
      // and continue so the text isn't lost.
      buf += `[${tagMatch.tag}]`;
      cursor.i = tagMatch.nextIndex;
      continue;
    }
    if (tagMatch.kind === "self") {
      if (buf) {
        out.push(renderText(buf));
        buf = "";
      }
      const selfNode = renderSelfClosing(tagMatch.tag, tagMatch.attrs);
      if (selfNode !== null) out.push(selfNode);
      cursor.i = tagMatch.nextIndex;
      continue;
    }
    // open — flush the buffer, parse inner block, then expect a close.
    if (buf) {
      out.push(renderText(buf));
      buf = "";
    }
    cursor.i = tagMatch.nextIndex;
    const inner: React.ReactNode[] = [];
    parseBlock(src, cursor, inner, depth + 1);
    const node = renderOpening(tagMatch.tag, tagMatch.attrs, inner);
    if (node !== null) out.push(node);
    // Consume the close tag if present. If missing, just continue —
    // we already pushed the open's content.
    const closeMatch = readTag(src, cursor.i);
    if (closeMatch && closeMatch.kind === "close" && closeMatch.tag === tagMatch.tag) {
      cursor.i = closeMatch.nextIndex;
    }
  }
  if (buf) {
    out.push(renderText(buf));
  }
}

interface TagMatch {
  kind: "open" | "close" | "self";
  tag: string;
  attrs?: Record<string, string>;
  nextIndex: number;
}

/** Try to read a [tag], [/tag], or [self/] marker at `pos`.
 *  Returns `null` when no well-formed tag is present (in which
 *  case the caller treats the `[` as a literal character). */
function readTag(src: string, pos: number): TagMatch | null {
  if (src[pos] !== "[") return null;
  // Search up to the next `]`. Bail if not found within 256 chars —
  // a long unterminated `[` shouldn't be treated as a tag.
  let end = src.indexOf("]", pos + 1);
  if (end === -1 || end - pos > 256) return null;
  const inner = src.slice(pos + 1, end).trim();
  if (!inner) return null;
  if (inner.startsWith("/")) {
    const tag = inner.slice(1).toLowerCase().trim();
    if (!isKnownTag(tag)) return null;
    return { kind: "close", tag, nextIndex: end + 1 };
  }
  // Self-closing: [tag/] or [tag attr=val/]
  if (inner.endsWith("/")) {
    const body = inner.slice(0, -1).trim();
    const { tag, attrs } = parseTagBody(body);
    if (!isKnownTag(tag)) return null;
    return { kind: "self", tag, attrs, nextIndex: end + 1 };
  }
  const { tag, attrs } = parseTagBody(inner);
  if (!isKnownTag(tag)) return null;
  return { kind: "open", tag, attrs, nextIndex: end + 1 };
}

function parseTagBody(body: string): { tag: string; attrs?: Record<string, string> } {
  const spaceIdx = body.indexOf(" ");
  if (spaceIdx === -1) return { tag: body.toLowerCase() };
  const tag = body.slice(0, spaceIdx).toLowerCase();
  const rest = body.slice(spaceIdx + 1).trim();
  const attrs = parseAttrs(rest);
  return { tag, attrs };
}

function parseAttrs(rest: string): Record<string, string> | undefined {
  if (!rest) return undefined;
  const out: Record<string, string> = {};
  // Match key=value pairs. Values may be quoted; unquoted values
  // are read up to the next whitespace.
  const re = /(\w+)\s*=\s*(?:"([^"]*)"|(\S+))/g;
  let m: RegExpExecArray | null;
  let any = false;
  while ((m = re.exec(rest)) !== null) {
    const key = m[1].toLowerCase();
    const val = (m[2] ?? m[3] ?? "").trim();
    out[key] = val;
    any = true;
  }
  return any ? out : undefined;
}

function isKnownTag(tag: string): boolean {
  switch (tag) {
    case "b": case "i": case "u": case "s": case "code":
    case "h1": case "h2": case "h3":
    case "url": case "img": case "hr":
    case "list": case "olist": case "*":
    case "spoiler": case "quote":
      return true;
    default:
      return false;
  }
}

function renderText(text: string): React.ReactNode {
  // Convert double newlines into a paragraph break (no-op in the
  // current parser since we only emit single <br/>; reserved for
  // future paragraph support).
  return text;
}

function renderSelfClosing(tag: string, attrs?: Record<string, string>): React.ReactNode | null {
  switch (tag) {
    case "hr":
      return <hr />;
    case "img": {
      const src = attrs?.src ?? attrs?.href ?? "";
      if (!isSafeUrl(src)) return null;
      return <img src={src} alt="Review image" loading="lazy" style={{ maxWidth: "100%", borderRadius: 4 }} />;
    }
    case "*": {
      // [*] inside a [list] becomes an <li>. Handled by the opening
      // tag's renderer; the self-closing form is rare but supported.
      return null;
    }
    default:
      return null;
  }
}

function renderOpening(
  tag: string,
  attrs: Record<string, string> | undefined,
  children: React.ReactNode[],
): React.ReactNode {
  switch (tag) {
    case "b": return <strong>{children}</strong>;
    case "i": return <em>{children}</em>;
    case "u": return <u>{children}</u>;
    case "s": return <s>{children}</s>;
    case "code": return <code className="rv-bbcode">{children}</code>;
    case "h1": return <h4 className="rv-bbcode rv-bbcode-h1">{children}</h4>;
    case "h2": return <h4 className="rv-bbcode rv-bbcode-h2">{children}</h4>;
    case "h3": return <h4 className="rv-bbcode rv-bbcode-h3">{children}</h4>;
    case "url": {
      const href = attrs?.href ?? attrs?.url ?? "";
      if (!isSafeUrl(href)) return <>{children}</>;
      return (
        <a className="rv-bbcode-link" href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    }
    case "list": return <ul className="rv-bbcode-list">{children}</ul>;
    case "olist": return <ol className="rv-bbcode-list">{children}</ol>;
    case "spoiler": return <SpoilerBlock>{children}</SpoilerBlock>;
    case "quote": {
      const author = attrs?.user;
      return (
        <blockquote className="rv-bbcode-quote">
          {author && <cite className="rv-bbcode-quote-author">{author} wrote:</cite>}
          {children}
        </blockquote>
      );
    }
    default:
      return <>{children}</>;
  }
}

/** Click-to-reveal spoiler block. State is local to the component;
 *  the parent never sees the toggle. */
function SpoilerBlock({ children }: { children: React.ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      className={`rv-bbcode-spoiler${revealed ? " revealed" : ""}`}
      onClick={() => setRevealed(true)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setRevealed(true);
        }
      }}
    >
      {revealed ? children : <span className="rv-bbcode-spoiler-mask">Click to reveal spoiler</span>}
    </span>
  );
}

/** XSS defense: only allow http(s) URLs in [url=...] and [img] tags.
 *  This is the single most important BB code safety check. */
function isSafeUrl(href: string): boolean {
  if (!href) return false;
  const trimmed = href.trim();
  if (trimmed.length > 1024) return false;
  if (/^javascript:/i.test(trimmed)) return false;
  if (/^data:/i.test(trimmed)) return false;
  if (/^vbscript:/i.test(trimmed)) return false;
  return /^https?:\/\//i.test(trimmed);
}

function BbCodeRenderer({ text }: { text: string }) {
  const nodes = useMemo(() => parseBbCode(text), [text]);
  return <>{nodes}</>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function languageCodeToFriendly(code?: string): string {
  const found = STEAM_LANGUAGES.find((l) => l.code === code);
  return found ? `${found.flag} ${found.label}` : code || "Unknown";
}

function buildExternalUrl(game: Game, site: "metacritic" | "opencritic" | "rawg"): string {
  const q = encodeURIComponent(game.name);
  switch (site) {
    case "metacritic":
      return `https://www.metacritic.com/search/game/${q}/results`;
    case "opencritic":
      return `https://opencritic.com/game/search?q=${q}`;
    case "rawg":
      return `https://rawg.io/games?query=${q}`;
  }
}

function getSteamCommunityUrl(path: string): string | null {
  const id = extractSteamAppId(path);
  if (id === null) return null;
  return `https://steamcommunity.com/app/${id}/reviews/?browsefilter=toprated`;
}

function ratingToSentiment(score: number | null): "positive" | "negative" | null {
  if (score === null) return null;
  if (score >= 60) return "positive";
  return "negative";
}

function ratingToStars(score: number): number {
  return Math.max(0, Math.min(5, Math.round((score / 100) * 5 * 2) / 2));
}

function formatShortDate(ts?: number): string {
  if (!ts) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleDateString();
  }
}

function formatHelpfulFunny(count: number | undefined): string {
  if (!count || count <= 0) return "";
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return count.toString();
}

// ─── Sub-components ────────────────────────────────────────────────────────

function StarRow({ score, size = 14, overrideStars }: { score?: number; size?: number; overrideStars?: number }) {
  const reactId = useId();
  // Bug fix: previously `score` was required and always used. Now the
  // parent (ReviewSummary) pre-computes stars from Steam's 1-9 score
  // bucket or percentage tiers and passes them via `overrideStars`,
  // because `ratingToStars(score)` is wrong for percentage context
  // (a 75% positive ratio is NOT a 75/100 average rating).
  const stars = overrideStars !== undefined ? overrideStars : score !== undefined ? ratingToStars(score) : 0;
  const full = Math.floor(stars);
  const half = stars - full >= 0.5;
  const empty = Math.max(0, 5 - full - (half ? 1 : 0));
  return (
    <div className="rv-stars" aria-label={`${stars} out of 5`}>
      {Array.from({ length: full }).map((_, i) => (
        <svg key={`${reactId}-f${i}`} width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ))}
      {half && (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <defs>
            <linearGradient id={`half-${reactId}`}>
              <stop offset="50%" stopColor="currentColor" />
              <stop offset="50%" stopColor="var(--color-text-muted)" />
            </linearGradient>
          </defs>
          <polygon fill={`url(#half-${reactId})`} points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      )}
      {Array.from({ length: empty }).map((_, i) => (
        <svg key={`${reactId}-e${i}`} width={size} height={size} viewBox="0 0 24 24" fill="var(--color-text-muted)">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ))}
    </div>
  );
}

function RecommendationIndicator({
  source,
  sentiment,
  rating,
}: {
  source: ReviewItem["source"];
  sentiment: ReviewItem["sentiment"];
  rating: number | null;
}) {
  if (source === "you") {
    const score = rating ?? 0;
    return (
      <div className="rv-recommendation rv-recommendation-you" aria-label={`${score} out of 100`}>
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
        <div className="rv-recommendation-score">{Math.round(score)}</div>
      </div>
    );
  }
  if (sentiment === "positive") {
    return (
      <div className="rv-recommendation rv-recommendation-pos" aria-label="Recommended">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: "rotate(-10deg)" }}>
          <path d="M7 10v12" />
          <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h3" />
        </svg>
        <div className="rv-recommendation-label">Rec</div>
      </div>
    );
  }
  if (sentiment === "negative") {
    return (
      <div className="rv-recommendation rv-recommendation-neg" aria-label="Not Recommended">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: "rotate(10deg)" }}>
          <path d="M17 14V2" />
          <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3" />
        </svg>
        <div className="rv-recommendation-label">Not</div>
      </div>
    );
  }
  return (
    <div className="rv-recommendation rv-recommendation-none" aria-label="No rating">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
      </svg>
    </div>
  );
}

function ReviewSourceBadge({ source, label }: { source: ReviewItem["source"]; label: string }) {
  const iconMap: Record<string, React.ReactNode> = {
    you: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
    steam: (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M3 5h18v14H3V5zm9 2L5 19h4l1-2.5h2L13 19h4L12 7zm0 4.6L13.2 14h-2.4L12 11.6z" />
      </svg>
    ),
    metacritic: (<span style={{ fontSize: "12px", fontWeight: 900, lineHeight: 1 }}>MC</span>),
    opencritic: (<span style={{ fontSize: "12px", fontWeight: 900, lineHeight: 1 }}>OC</span>),
    rawg: (<span style={{ fontSize: "10px", fontWeight: 900, lineHeight: 1 }}>R</span>),
  };
  return (
    <span className={`rv-source-badge rv-source-badge-${source}`}>
      {iconMap[source] || null}
      <span>{label}</span>
    </span>
  );
}

function ContextBadge({ icon, label, tone }: { icon: React.ReactNode; label: string; tone: "info" | "warning" | "success" }) {
  return (
    <span
      className={`rv-context-badge rv-context-badge-${tone}`}
      title={label}
    >
      {icon}
      <span>{label}</span>
    </span>
  );
}

function ContextBadgesRow({ review }: { review: ReviewItem }) {
  const badges: React.ReactNode[] = [];
  if (review.writtenDuringEarlyAccess) {
    badges.push(
      <ContextBadge
        key="ea"
        tone="warning"
        label="Early Access"
        icon={
          <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <polyline points="12 7 12 12 15 14" />
          </svg>
        }
      />,
    );
  }
  if (review.receivedForFree) {
    badges.push(
      <ContextBadge
        key="free"
        tone="info"
        label="Received for Free"
        icon={
          <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        }
      />,
    );
  }
  if (review.steamPurchase) {
    badges.push(
      <ContextBadge
        key="sp"
        tone="success"
        label="Steam Purchase"
        icon={
          <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <path d="M16 10a4 4 0 0 1-8 0" />
          </svg>
        }
      />,
    );
  }
  if (review.primarilySteamDeck) {
    badges.push(
      <ContextBadge
        key="deck"
        tone="info"
        label="Played on Steam Deck"
        icon={
          <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="2" y="6" width="20" height="13" rx="2" />
            <circle cx="8" cy="12.5" r="0.5" />
            <circle cx="16" cy="12.5" r="0.5" />
          </svg>
        }
      />,
    );
  }
  if (badges.length === 0) return null;
  return <div className="rv-context-badges">{badges}</div>;
}

function HardwareSpecs({ hw }: { hw: string | undefined }) {
  const parsed = useMemo(() => parseSteamHardware(hw), [hw]);
  if (!parsed) return null;
  const lines: { label: string; value: string }[] = [];
  if (parsed.os) lines.push({ label: "OS", value: parsed.os });
  if (parsed.cpuName || parsed.systemRamMb) {
    const cpu = parsed.cpuName ?? "Unknown CPU";
    const ram = formatRam(parsed.systemRamMb);
    lines.push({ label: "CPU", value: ram ? `${cpu} • ${ram}` : cpu });
  }
  if (parsed.gpuName || parsed.vramSize) {
    const gpu = parsed.gpuName ?? "Unknown GPU";
    const vram = formatVram(parsed.vramSize);
    lines.push({ label: "GPU", value: vram ? `${gpu} • ${vram}` : gpu });
  }
  if (lines.length === 0) return null;
  return (
    <div className="rv-hw-specs">
      <span className="rv-hw-specs-label">Reviewer hardware</span>
      <ul>
        {lines.map((line) => (
          <li key={line.label}>
            <span className="rv-hw-specs-key">{line.label}</span>
            <span className="rv-hw-specs-value">{line.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlaytimeRow({ review }: { review: ReviewItem }) {
  if (review.authorPlaytimeAtReview === undefined && review.authorPlaytimeForever === undefined) {
    return null;
  }
  return (
    <div className="rv-playtime-row">
      {review.authorPlaytimeAtReview !== undefined && (
        <span className="rv-playtime-pill" title="Playtime on this game at the time the review was written">
          {formatPlayTime(review.authorPlaytimeAtReview)} on record
        </span>
      )}
      {review.authorPlaytimeForever !== undefined && (
        <span className="rv-playtime-pill rv-playtime-pill-muted" title="Total playtime across all games">
          {formatPlayTime(review.authorPlaytimeForever)} total
        </span>
      )}
    </div>
  );
}

function ReactionBar({ review }: { review: ReviewItem }) {
  const hasVotesUp = (review.votesUp ?? 0) > 0;
  const hasVotesFunny = (review.votesFunny ?? 0) > 0;
  const reactions = review.reactions ?? [];
  if (!hasVotesUp && !hasVotesFunny && reactions.length === 0) return null;
  // Sort by count descending and show top 3; reveal the rest on click.
  const sorted = [...reactions].sort((a, b) => b.count - a.count);
  return (
    <ReactionList reactions={sorted} votesUp={review.votesUp} votesFunny={review.votesFunny} />
  );
}

function ReactionList({
  reactions,
  votesUp,
  votesFunny,
}: {
  reactions: SteamReaction[];
  votesUp?: number;
  votesFunny?: number;
}) {
  // Augment with the legacy votes_up/votes_funny if those are > 0
  // and the corresponding reaction isn't already in the list.
  // (Steam migrated these to `reactions` in 2024; older reviews
  // only have the legacy fields.)
  const seen = new Set(reactions.map((r) => r.reactionType));
  const augmented: SteamReaction[] = [...reactions];
  if (votesUp && !seen.has(1)) augmented.push({ reactionType: 1, count: votesUp });
  if (votesFunny && !seen.has(3)) augmented.push({ reactionType: 3, count: votesFunny });
  augmented.sort((a, b) => b.count - a.count);
  if (augmented.length === 0) return null;
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? augmented : augmented.slice(0, 3);
  return (
    <div className="rv-card-reactions">
      {visible.map((r) => {
        const meta = STEAM_REACTIONS[r.reactionType] ?? { emoji: "❓", label: `Reaction ${r.reactionType}` };
        return (
          <span key={r.reactionType} className="rv-reaction-badge" title={meta.label}>
            <span className="rv-reaction-emoji">{meta.emoji}</span>
            <span className="rv-reaction-count">{formatHelpfulFunny(r.count)}</span>
          </span>
        );
      })}
      {augmented.length > 3 && !expanded && (
        <button
          type="button"
          className="rv-reaction-show-more"
          onClick={() => setExpanded(true)}
        >
          +{augmented.length - 3} more
        </button>
      )}
    </div>
  );
}

function CommentsLink({
  review,
  appId,
}: {
  review: ReviewItem;
  appId: number | null;
}) {
  if (!review.commentCount || review.commentCount <= 0) return null;
  if (!review.authorSteamId || !appId) return null;
  const url = `https://steamcommunity.com/profiles/${review.authorSteamId}/recommended/${appId}/`;
  return (
    <a
      className="rv-card-comments-link"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={`${review.commentCount} comment${review.commentCount === 1 ? "" : "s"} on Steam`}
    >
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
      {review.commentCount.toLocaleString()} comment{review.commentCount === 1 ? "" : "s"}
    </a>
  );
}

function ReviewCard({ review, appId }: { review: ReviewItem; appId: number | null }) {
  const { isBigScreen } = useBigScreen();
  const focusProps = useFocusable(() => {});
  const isYou = review.source === "you";
  const isSteam = review.source === "steam";
  const username = isYou ? "You" : review.username;
  const showTitle = !!review.title;
  const sentimentEmoji =
    review.sentiment === "positive" ? "👍" : review.sentiment === "negative" ? "👎" : isYou ? "⭐" : "💬";
  return (
    <article
      className={`rv-card rv-source-${review.source}`}
      {...(isBigScreen ? focusProps : {})}
    >
      <div className="rv-card-header-new">
        <RecommendationIndicator
          source={review.source}
          sentiment={review.sentiment}
          rating={review.rating}
        />
        <div className="rv-card-header-content">
          <div className="rv-card-name-row">
            <span className="rv-card-emoji" aria-hidden="true">{sentimentEmoji}</span>
            <span className="rv-card-name-text">{username}</span>
            {isYou && (
              <span className="rv-verified-badge">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Verified Player
              </span>
            )}
          </div>
          <div className="rv-card-submeta-row">
            {review.rating !== null && (
              <span className={`rv-rating-pill rv-rating-pill-${review.source}`}>
                {Math.round(review.rating)}/100
              </span>
            )}
            <ReviewSourceBadge source={review.source} label={review.sourceLabel} />
            {isSteam && review.dateAdded && (
              <span className="rv-card-date">{formatShortDate(review.dateAdded)}</span>
            )}
            {review.language && (
              <span className="rv-card-lang" title={languageCodeToFriendly(review.language)}>
                {languageCodeToFriendly(review.language)}
              </span>
            )}
            <CommentsLink review={review} appId={appId} />
          </div>
          <ContextBadgesRow review={review} />
        </div>
      </div>
      {showTitle && <h3 className="rv-card-title">{review.title}</h3>}
      {review.content && (
        <div className={`rv-card-content${review.content.length > 280 ? " clamp" : ""}`}>
          <BbCodeRenderer text={review.content} />
        </div>
      )}
      <PlaytimeRow review={review} />
      <HardwareSpecs hw={review.hw} />
      <ReactionBar review={review} />
    </article>
  );
}

function ReviewSummary({
  reviews,
  totalReviewCount,
  steamReviewScoreDesc,
  steamReviewScore,
  steamTotalPositive,
  steamTotalNegative,
}: {
  reviews: ReviewItem[];
  totalReviewCount: number;
  steamReviewScoreDesc: string | null;
  steamReviewScore?: number | null;
  steamTotalPositive: number | null;
  steamTotalNegative: number | null;
}) {
  const ratings = reviews.filter((r) => r.rating !== null);
  const steamReviews = reviews.filter((r) => r.source === "steam");
  const hasRealSteamStats = steamTotalPositive !== null && steamTotalNegative !== null;

  const positiveCount = hasRealSteamStats
    ? steamTotalPositive
    : reviews.filter((r) => r.sentiment === "positive").length;
  const negativeCount = hasRealSteamStats
    ? steamTotalNegative
    : reviews.filter((r) => r.sentiment === "negative").length;
  const totalSentiment = positiveCount + negativeCount;
  // Bug fix: previously the banner conflated Steam's positive percentage
  // (a 0-100% ratio of positive votes) with the average of individual
  // review ratings (a 0-100 average score). These are different metrics
  // — a 75% positive ratio is a "Mostly Positive" Steam label, but a 75/100
  // average rating is just "good". The banner now detects which context
  // applies and renders the correct label + color + stars.
  const hasLocalSteamFallback = !hasRealSteamStats && totalSentiment > 0 && steamReviews.length > 0;
  const isPercentageContext = hasRealSteamStats || hasLocalSteamFallback;

  const positivePct = totalSentiment > 0 ? Math.round((positiveCount / totalSentiment) * 100) : 0;
  const negativePct = totalSentiment > 0 ? 100 - positivePct : 0;

  const communityAvg = isPercentageContext
    ? positivePct
    : ratings.length > 0
    ? ratings.reduce((acc, r) => acc + (r.rating as number), 0) / ratings.length
    : 0;

  // Stars: use Steam's official 1-9 score bucket when available, else
  // map from positive percentage tiers that match Steam's labels
  // (Overwhelmingly/Very/Mostly Positive etc.), else fall back to the
  // standard rating-to-stars conversion for non-Steam averages.
  let stars = 0;
  if (communityAvg > 0) {
    if (isPercentageContext) {
      if (steamReviewScore != null) {
        stars =
          steamReviewScore >= 9 ? 5 :
          steamReviewScore >= 8 ? 4.5 :
          steamReviewScore >= 7 ? 4 :
          steamReviewScore >= 6 ? 3.5 :
          steamReviewScore >= 5 ? 3 :
          steamReviewScore >= 4 ? 2 :
          steamReviewScore >= 3 ? 1.5 :
          steamReviewScore >= 2 ? 1 : 0.5;
      } else if (positivePct >= 95) stars = 5;
      else if (positivePct >= 85) stars = 4.5;
      else if (positivePct >= 80) stars = 4;
      else if (positivePct >= 70) stars = 3.5;
      else if (positivePct >= 40) stars = 3;
      else if (positivePct >= 20) stars = 2;
      else stars = 1;
    } else {
      stars = ratingToStars(communityAvg);
    }
  }

  // Color: prefer Steam's own 1-9 score (most accurate), else fall back
  // to the percentage thresholds aligned with Steam's review labels.
  const scoreColor = isPercentageContext
    ? steamReviewScore != null
      ? steamReviewScore >= 6 ? "#10b981" : steamReviewScore >= 5 ? "#f59e0b" : "#ef4444"
      : positivePct >= 70 ? "#10b981" : positivePct >= 40 ? "#f59e0b" : "#ef4444"
    : communityAvg >= 75 ? "#10b981" : communityAvg >= 50 ? "#f59e0b" : "#ef4444";

  const totalReviews = totalReviewCount > 0 ? totalReviewCount : reviews.length;
  const hasRatings = totalSentiment > 0;
  return (
    <div className="rv-summary">
      <div className="rv-summary-left">
        <div className="rv-summary-score-wrap">
          <div
            className="rv-summary-score"
            style={{ color: scoreColor }}
          >
            {communityAvg > 0 ? (isPercentageContext ? `${positivePct}%` : Math.round(communityAvg)) : "—"}
          </div>
          <div className="rv-summary-score-label">
            {isPercentageContext ? "Positive" : "/ 100 avg"}
          </div>
        </div>
        <div className="rv-summary-stats">
          <div className="rv-summary-source-stars">
            {communityAvg > 0 && <StarRow score={0} overrideStars={stars} size={18} />}
          </div>
          {steamReviewScoreDesc && (
            <div
              className="rv-summary-desc"
              style={{
                color: scoreColor,
                fontWeight: "var(--font-weight-bold)",
                fontSize: "12px",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                lineHeight: "1.2",
              }}
            >
              {steamReviewScoreDesc}
            </div>
          )}
          <div className="rv-summary-count">
            {totalReviews.toLocaleString()} review{totalReviews === 1 ? "" : "s"}
          </div>
          {hasRatings && (
            <div className="rv-summary-sentiment">
              <span className="rv-summary-pos">{positivePct}% Positive</span>
              <span className="rv-summary-neg">{negativePct}% Negative</span>
            </div>
          )}
        </div>
      </div>
      {hasRatings && (
        <div className="rv-summary-distribution">
          <div className="rv-distribution-row">
            <span className="rv-distribution-label rv-distribution-label-pos">Positive</span>
            <div className="rv-distribution-bar-track">
              <div className="rv-distribution-bar-fill" style={{ width: `${positivePct}%`, background: "#10b981" }} />
            </div>
            <span className="rv-distribution-count" style={{ width: "auto", minWidth: "45px" }}>
              {positiveCount.toLocaleString()}
            </span>
          </div>
          <div className="rv-distribution-row">
            <span className="rv-distribution-label rv-distribution-label-neg">Negative</span>
            <div className="rv-distribution-bar-track">
              <div className="rv-distribution-bar-fill" style={{ width: `${negativePct}%`, background: "#ef4444" }} />
            </div>
            <span className="rv-distribution-count" style={{ width: "auto", minWidth: "45px" }}>
              {negativeCount.toLocaleString()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Props ─────────────────────────────────────────────────────────────────

interface ReviewsTabProps {
  game: Game;
  onReviewsFetched?: (reviews: IgdbReview[], source: string) => void;
}

export default function ReviewsTab({ game, onReviewsFetched }: ReviewsTabProps) {
  const { isBigScreen } = useBigScreen();
  const { showToast } = useToast();
  const { updateGame } = useGames();

  // ── Filter state ────────────────────────────────────────────────
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("featured");
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [languageFilter, setLanguageFilter] = useState("all");
  const [purchaseTypeFilter, setPurchaseTypeFilter] = useState<PurchaseTypeFilter>("all");
  const [playtimeFilter, setPlaytimeFilter] = useState<PlaytimeFilter>("none");
  const [playtimeMinHours, setPlaytimeMinHours] = useState(0);
  const [playtimeMaxHours, setPlaytimeMaxHours] = useState(0);

  // ── Auto-fetch reviews ──────────────────────────────────────────
  const [isFetchingReviews, setIsFetchingReviews] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalReviewCount, setTotalReviewCount] = useState(0);
  const [steamReviewScoreDesc, setSteamReviewScoreDesc] = useState<string | null>(null);
  const [steamReviewScore, setSteamReviewScore] = useState<number | null>(null);
  const [steamTotalPositive, setSteamTotalPositive] = useState<number | null>(null);
  const [steamTotalNegative, setSteamTotalNegative] = useState<number | null>(null);

  const autoFetchedForRef = useRef<string | null>(null);
  const fetchInFlightRef = useRef(false);
  // Bug fix: tracks which game's fetch is currently in flight so stale
  // results from a previous game don't clobber the banner when the user
  // switches games mid-fetch. Reset by the game-change useEffect.
  const currentFetchGameIdRef = useRef<string>(game.id);
  /** Mirrors `reviewsList` so `fetchReviews` can read the latest value
   *  (e.g. for `isLoadMore` merges) without going through `setState`
   *  or relying on stale closures. The effect below keeps the ref in
   *  sync after every render that produced a new array. */
  const reviewsListRef = useRef<IgdbReview[]>([]);

  // ── Local reviews list ───────────────────────────────────────────
  // Bug fix: previously the UI derived everything from
  // `game.igdbReviews` which meant changing the language filter
  // (which used to wipe `igdbReviews`) caused a UI flicker as the
  // cached state caught up. We now keep a local `reviewsList` that
  // drives the render; `game.igdbReviews` is only updated on a
  // completed fetch (for persistence).
  const [reviewsList, setReviewsList] = useState<IgdbReview[]>([]);
  useEffect(() => {
    setReviewsList(game.igdbReviews ?? []);
    reviewsListRef.current = game.igdbReviews ?? [];
  }, [game.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    reviewsListRef.current = reviewsList;
  }, [reviewsList]);

  // ── External reviews state (Metacritic, OpenCritic, RAWG) ───────
  const externalReviewsRef = useRef<Record<string, IgdbReview[]>>({});
  const [externalReviews, setExternalReviews] = useState<Record<string, IgdbReview[]>>({});
  const [externalLoading, setExternalLoading] = useState<Record<string, boolean>>({});
  const externalFetchedRef = useRef<Set<string>>(new Set());

  const fetchExternalReviews = useCallback(
    async (src: string) => {
      if (externalFetchedRef.current.has(src)) return;
      externalFetchedRef.current.add(src);
      setExternalLoading((prev) => ({ ...prev, [src]: true }));
      try {
        const reviews = await invoke<IgdbReview[]>("fetch_external_reviews", {
          gameName: game.name,
          source: src,
        });
        externalReviewsRef.current = { ...externalReviewsRef.current, [src]: reviews };
        setExternalReviews((prev) => ({ ...prev, [src]: reviews }));
        if (reviews.length > 0) {
          const labels: Record<string, string> = {
            metacritic: "Metacritic",
            opencritic: "OpenCritic",
            rawg: "RAWG",
          };
          showToast(
            `Fetched ${reviews.length} review${reviews.length === 1 ? "" : "s"} from ${labels[src] || src}`,
            "success",
          );
        }
      } catch (err) {
        console.error(`Failed to fetch ${src} reviews:`, err);
        externalFetchedRef.current.delete(src);
        showToast(`Could not load ${src} reviews`, "error");
      } finally {
        setExternalLoading((prev) => ({ ...prev, [src]: false }));
      }
    },
    [game.name, showToast],
  );

  useEffect(() => {
    externalReviewsRef.current = {};
    setExternalReviews({});
    setExternalLoading({});
    externalFetchedRef.current = new Set();
  }, [game.id]);

  useEffect(() => {
    if (sourceFilter === "metacritic" || sourceFilter === "opencritic" || sourceFilter === "rawg") {
      fetchExternalReviews(sourceFilter);
    }
  }, [sourceFilter, game.id, fetchExternalReviews]);

  // Map the frontend sort mode to a backend filter_type. The
  // "highest" / "longest" sorts are client-side because Steam's
  // appreviews endpoint doesn't have native params for them.
  const backendFilterType = useMemo<string | undefined>(() => {
    switch (sortOrder) {
      case "recent": return "recent";
      case "funny":  return "funny";
      case "featured": return "all";
      default: return undefined; // client-side sort
    }
  }, [sortOrder]);

  const fetchReviews = useCallback(
    async (force = false, cursor: string | null = null, currentLang: string = languageFilter) => {
      if (fetchInFlightRef.current) return;
      const targetGameId = game.id;
      // Bug fix: track lock ownership locally so a stale fetch's
      // `finally` block can't release a lock acquired by a concurrent
      // fetch (e.g. user clicks refresh while a fetch is in flight,
      // then switches games — the original fetch's finally would
      // see targetGameId === current and release the new fetch's
      // lock). Only the fetch that actually acquired the lock can
      // release it.
      fetchInFlightRef.current = true;
      let acquiredLock = true;
      const isLoadMore = cursor !== null && cursor !== "";
      if (isLoadMore) setIsLoadingMore(true);
      else setIsFetchingReviews(true);
      try {
        // Bug fix: use `resolveSteamAppId` so the helper prefers
        // `game.steamAppId` over parsing `game.path`. Previously,
        // a Steam-synced game with a local exe path (or an EGS
        // game matched to a Steam listing) would have its reviews
        // resolve to IGDB fallback, not Steam.
        const steamHint = resolveSteamAppId(game);
        const result = await invoke<ReviewFetchResult>("fetch_game_reviews", {
          gameName: game.name,
          steamAppId: steamHint,
          cursor: cursor || null,
          language: currentLang === "all" ? null : currentLang,
          filterType: backendFilterType ?? null,
          purchaseType: purchaseTypeFilter === "all" ? null : purchaseTypeFilter,
          playtimeMinHours: playtimeFilter === "over_1h" ? 1 : playtimeFilter === "over_10h" ? 10 : playtimeFilter === "custom" ? playtimeMinHours : null,
          playtimeMaxHours: playtimeFilter === "custom" ? playtimeMaxHours : null,
        });

        // Bug fix: if the user switched games while this fetch was
        // in flight, drop the stale result instead of clobbering the
        // new game's banner with the old game's totals.
        if (targetGameId !== currentFetchGameIdRef.current) return;

        // Bug fix: only update the Steam banner totals on the first
        // page. Steam's appreviews endpoint returns `query_summary`
        // (totalPositive / totalNegative / score / scoreDesc /
        // totalReviews) only on the first page — subsequent pages
        // return null/undefined for these fields, which would wipe
        // the banner data and show "—" for the score after every
        // "Load more" click. The cursor must always be updated so
        // pagination continues to work.
        if (!isLoadMore) {
          setTotalReviewCount(result.totalReviews ?? 0);
          setSteamReviewScoreDesc(result.steamReviewScoreDesc ?? null);
          setSteamReviewScore(result.steamReviewScore ?? null);
          setSteamTotalPositive(result.steamTotalPositive ?? null);
          setSteamTotalNegative(result.steamTotalNegative ?? null);
        }
        setNextCursor(result.cursor ?? null);

        if (result.reviews.length > 0) {
          // Compute `next` from the ref-tracked current list so the
          // `updateGame` and `onReviewsFetched` side effects get a
          // stable reference. Previously these ran inside the
          // `setReviewsList` updater, which React-19 StrictMode
          // double-invokes and would have fired the side effects
          // twice. The updater is now pure (returns only the new
          // state); the ref + setState happen in sequence so the
          // side effects run exactly once per fetch.
          const next: IgdbReview[] = isLoadMore
            ? [...reviewsListRef.current, ...result.reviews]
            : result.reviews;
          setReviewsList(next);
          reviewsListRef.current = next;
          updateGame(game.id, { igdbReviews: next });
          onReviewsFetched?.(next, result.source);
          if (force && !isLoadMore) {
            const sourceLabel =
              result.source === "steam" ? "Steam" : result.source === "igdb" ? "IGDB" : "community";
            showToast(
              `Fetched ${result.reviews.length} review${result.reviews.length === 1 ? "" : "s"} from ${sourceLabel}`,
              "success",
            );
          }
        } else if (force && !isLoadMore) {
          showToast("No reviews available from any source", "info");
        }
      } catch (err) {
        console.error("Auto-fetch reviews failed:", err);
        if (force || isLoadMore) {
          showToast(`Failed to fetch reviews: ${err}`, "error");
        }
      } finally {
        // Only release the in-flight lock + loading flags if THIS fetch
        // is the one that acquired the lock AND it's still for the
        // currently-selected game. A stale fetch (acquiredLock=true but
        // targetGameId !== current) must not flip the new game's spinner
        // off or allow a concurrent fetch to start.
        if (acquiredLock && targetGameId === currentFetchGameIdRef.current) {
          fetchInFlightRef.current = false;
          setIsFetchingReviews(false);
          setIsLoadingMore(false);
        }
      }
    },
    [
      game,
      showToast,
      updateGame,
      onReviewsFetched,
      languageFilter,
      backendFilterType,
      purchaseTypeFilter,
      playtimeFilter,
      playtimeMinHours,
      playtimeMaxHours,
    ],
  );

  const handleLanguageChange = useCallback(
    (newLang: string) => {
      setLanguageFilter(newLang);
      setNextCursor(null);
      setTotalReviewCount(0);
      fetchReviews(true, null, newLang);
    },
    [fetchReviews],
  );

  // Reset everything on game change; do an initial auto-fetch.
  useEffect(() => {
    if (autoFetchedForRef.current === game.id) return;
    autoFetchedForRef.current = game.id;
    // Bug fix: mark the new game as the current fetch target BEFORE
    // calling fetchReviews, so any in-flight fetch for the previous
    // game will see a mismatch and drop its result.
    currentFetchGameIdRef.current = game.id;
    // Bug fix: release the in-flight lock. If a fetch was running for
    // the previous game, it's now stale and will be dropped by the
    // stale check; releasing the lock here lets the new fetch start.
    fetchInFlightRef.current = false;
    setNextCursor(null);
    // Bug fix: previously this block nuked ALL banner state (including
    // steamReviewScoreDesc / totalPositive / totalNegative) on every
    // game change, causing the banner to flash "—" and "0 reviews"
    // while the new fetch loaded. Now we keep the cached igdbReviews
    // and only clear the Steam totals (which the new fetch will
    // replace). If the cache is empty we still clear everything.
    if (game.igdbReviews && game.igdbReviews.length > 0) {
      setReviewsList(game.igdbReviews);
      reviewsListRef.current = game.igdbReviews;
      // Bug fix: totalReviewCount comes from Steam's query_summary and
      // is per-game. If the previous game's count (e.g. 5,000) is left
      // in state, the banner will display "5,000 reviews" while only
      // showing the 20 cached IGDB reviews. Reset to 0 so the fallback
      // path (totalReviews = reviews.length) is used until the new
      // fetch returns the correct API count.
      setTotalReviewCount(0);
      setSteamReviewScoreDesc(null);
      setSteamReviewScore(null);
      setSteamTotalPositive(null);
      setSteamTotalNegative(null);
    } else {
      setReviewsList([]);
      reviewsListRef.current = [];
      setTotalReviewCount(0);
      setSteamReviewScoreDesc(null);
      setSteamReviewScore(null);
      setSteamTotalPositive(null);
      setSteamTotalNegative(null);
    }
    fetchReviews(false, null, "all");
    // Bug fix: previously this block reset the user's chosen
    // language filter to "all" on every game change, silently
    // clobbering their selection. The filter is now scoped to the
    // session (resets naturally on app reload). Game-change resets
    // are limited to data — the review list + cursor + totals.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id]);

  // ── Build the unified list of reviews ───────────────────────────
  const allReviews: ReviewItem[] = useMemo(() => {
    const items: ReviewItem[] = [];

    // Bug fix: previously the "You" review was rendered when
    // either `game.rating > 0` OR `game.reviewText` was present.
    // That created a phantom card with no content when the user
    // had only set a star rating. Now we only show the "You" card
    // when there's actual review text — a star rating without a
    // comment doesn't deserve its own card.
    if (game.reviewText && game.reviewText.trim()) {
      const score = (game.rating ?? 0) * 20;
      items.push({
        id: "you",
        sourceIndex: -1,
        source: "you",
        sourceLabel: "You",
        username: "You",
        rating: game.rating && game.rating > 0 ? score : null,
        ratingLabel: game.rating ? `${game.rating}/5` : "—",
        title: "",
        content: game.reviewText,
        dateAdded: game.addedAt,
        reviewLength: (game.reviewText || "").length,
        reviewLengthBytes: new Blob([game.reviewText || ""]).size,
        language: undefined,
        sentiment: ratingToSentiment(game.rating && game.rating > 0 ? score : null),
      });
    }

    if (reviewsList.length > 0) {
      reviewsList.forEach((r: IgdbReview, idx: number) => {
        const content = r.content || "";
        items.push({
          id: `steam-${idx}`,
          sourceIndex: idx,
          source: "steam",
          sourceLabel: "Steam",
          username: r.username || `Steam Player`,
          rating: r.rating ?? null,
          ratingLabel: r.rating !== undefined ? `${r.rating}/100` : "—",
          title: r.title || "",
          content,
          dateAdded: r.timestampCreated ? r.timestampCreated * 1000 : undefined,
          reviewLength: content.length,
          reviewLengthBytes: new Blob([content]).size,
          language: r.language,
          sentiment: ratingToSentiment(r.rating ?? null),
          votesUp: r.votesUp,
          votesFunny: r.votesFunny,
          reactions: r.reactions,
          commentCount: r.commentCount,
          authorPlaytimeAtReview: r.authorPlaytimeAtReview,
          authorPlaytimeForever: r.authorPlaytimeForever,
          authorDeckPlaytimeAtReview: r.authorDeckPlaytimeAtReview,
          primarilySteamDeck: r.primarilySteamDeck,
          receivedForFree: r.receivedForFree,
          writtenDuringEarlyAccess: r.writtenDuringEarlyAccess,
          steamPurchase: r.steamPurchase,
          authorSteamId: r.authorSteamId,
          hw: r.hw,
        });
      });
    }

    const externalLabels: Record<string, string> = {
      metacritic: "Metacritic",
      opencritic: "OpenCritic",
      rawg: "RAWG",
    };
    let externalIdx = 0;
    for (const [src, label] of Object.entries(externalLabels)) {
      const revs = externalReviews[src];
      if (revs && revs.length > 0) {
        revs.forEach((r: IgdbReview) => {
          const content = r.content || "";
          items.push({
            id: `${src}-${externalIdx++}`,
            sourceIndex: externalIdx,
            source: src as ReviewItem["source"],
            sourceLabel: label,
            username: r.username || label,
            rating: r.rating ?? null,
            ratingLabel: r.rating !== undefined ? `${Math.round(r.rating)}/100` : "—",
            title: r.title || "",
            content,
            dateAdded: r.timestampCreated ? r.timestampCreated * 1000 : undefined,
            reviewLength: content.length,
            reviewLengthBytes: new Blob([content]).size,
            language: r.language,
            sentiment: ratingToSentiment(r.rating ?? null),
          });
        });
      }
    }

    return items;
  }, [game.reviewText, game.rating, game.addedAt, reviewsList, externalReviews]);

  // ── Client-side filter pass-through ─────────────────────────────
  // Backend supports: filter (all/recent/funny), purchase_type, language.
  // Backend does NOT support: rating filter, source filter, playtime
  // filter, custom playtime range, search. Those are applied here so
  // the cursor-based pagination works as expected (no mid-list holes).
  const filteredReviews = useMemo(() => {
    let list = allReviews.slice();

    if (sourceFilter !== "all") {
      list = list.filter((r) => r.source === sourceFilter);
    }
    if (languageFilter !== "all") {
      list = list.filter((r) => r.language === languageFilter);
    }
    if (ratingFilter !== "all") {
      list = list.filter((r) => {
        if (ratingFilter === "positive") return r.sentiment === "positive";
        if (ratingFilter === "negative") return r.sentiment === "negative";
        return true;
      });
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (r) =>
          r.content.toLowerCase().includes(q) ||
          r.title.toLowerCase().includes(q) ||
          r.username.toLowerCase().includes(q),
      );
    }
    // Playtime filter — only applied to Steam reviews (only source
    // that has `authorPlaytimeAtReview` populated). Non-Steam
    // reviews are kept (playtime is unknown for them).
    if (playtimeFilter !== "none") {
      list = list.filter((r) => {
        if (r.source !== "steam") return true; // keep unknown
        const playMinH = r.authorPlaytimeAtReview !== undefined ? r.authorPlaytimeAtReview / 60 : undefined;
        if (playMinH === undefined) return true;
        switch (playtimeFilter) {
          case "over_1h":  return playMinH >= 1;
          case "over_10h": return playMinH >= 10;
          case "custom": {
            const minOk = playtimeMinHours === 0 || playMinH >= playtimeMinHours;
            const maxOk = playtimeMaxHours === 0 || playMinH <= playtimeMaxHours;
            return minOk && maxOk;
          }
          default: return true;
        }
      });
    }

    // Sort
    list.sort((a, b) => {
      if (a.source === "you" && b.source !== "you") return -1;
      if (b.source === "you" && a.source !== "you") return 1;
      switch (sortOrder) {
        case "highest":
          return (b.rating ?? -1) - (a.rating ?? -1);
        case "longest":
          return b.reviewLengthBytes - a.reviewLengthBytes;
        case "featured":
        default:
          // Bug fix: previously used `parseInt(a.id.slice(6))`
          // which is fragile (depends on the string format). The
          // stable `sourceIndex` assigned during the build step
          // preserves Steam's natural order without parseInt.
          return a.sourceIndex - b.sourceIndex;
      }
    });

    return list;
  }, [
    allReviews,
    sourceFilter,
    languageFilter,
    ratingFilter,
    searchQuery,
    sortOrder,
    playtimeFilter,
    playtimeMinHours,
    playtimeMaxHours,
  ]);

  // External review sources
  const externalSources = useMemo(() => {
    const sources: { id: string; name: string; url: string; description: string; accent: string }[] = [];
    if (game.metadataUrl && game.metadataSource) {
      sources.push({
        id: "metadata",
        name: game.metadataSource,
        url: game.metadataUrl,
        description: `View on ${game.metadataSource}`,
        accent: "var(--color-accent)",
      });
    }
    if (game.platform === "Steam") {
      const community = getSteamCommunityUrl(game.path);
      if (community) {
        sources.push({
          id: "steam-reviews",
          name: "Steam Reviews",
          url: community,
          description: "Read Steam community reviews",
          accent: "#1b9ae0",
        });
      }
    }
    sources.push(
      { id: "metacritic", name: "Metacritic", url: buildExternalUrl(game, "metacritic"), description: `Search "${game.name}" on Metacritic`, accent: "#ffcc33" },
      { id: "opencritic", name: "OpenCritic", url: buildExternalUrl(game, "opencritic"), description: "Critic reviews aggregator", accent: "#ff0099" },
      { id: "rawg", name: "RAWG", url: buildExternalUrl(game, "rawg"), description: "Community reviews & ratings", accent: "#f43f5e" },
    );
    return sources;
  }, [game.metadataUrl, game.metadataSource, game.platform, game.path, game.name]);

  // Bug fix: previously `totalAll` was computed from
  // `allReviews.filter(steam).length` and used as the Steam badge
  // count, but that drifted from the actual `totalReviewCount` the
  // API returned (the filter could be empty while the API says
  // 100k+). Now we use the API count when available.
  const totalAll = allReviews.length;
  const steamCount = totalReviewCount > 0
    ? totalReviewCount
    : allReviews.filter((r) => r.source === "steam").length;
  const youCount = allReviews.filter((r) => r.source === "you").length;
  const appId = resolveSteamAppId(game);

  function openExternal(url: string) {
    openUrl(url).catch((err) => {
      showToast(`Could not open link: ${err}`, "error");
    });
  }

  return (
    <div className="rv-root">
      <div className="rv-header">
        <div className="rv-header-left">
          <h2 className="rv-header-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              <line x1="9" y1="10" x2="15" y2="10" />
              <line x1="12" y1="13" x2="12" y2="13" />
            </svg>
            Community Reviews
          </h2>
          <p className="rv-header-subtitle">
            {totalReviewCount > 0
              ? `${totalReviewCount.toLocaleString()} reviews for this game.`
              : totalAll === 0
              ? "No community reviews are available for this game yet."
              : totalAll === 1
              ? "One review for this game."
              : `${totalAll} reviews for this game.`}
          </p>
        </div>
      </div>

      <ReviewSummary
        reviews={allReviews}
        totalReviewCount={totalReviewCount}
        steamReviewScoreDesc={steamReviewScoreDesc}
        steamReviewScore={steamReviewScore}
        steamTotalPositive={steamTotalPositive}
        steamTotalNegative={steamTotalNegative}
      />

      <div className="rv-refresh-row">
        <button
          type="button"
          className="rv-refresh-btn"
          onClick={() => {
            setNextCursor(null);
            fetchReviews(true, null);
          }}
          disabled={isFetchingReviews}
          title="Fetch latest reviews from Steam"
          aria-label="Refresh reviews"
        >
          {isFetchingReviews ? (
            <>
              <span className="rv-spinner" aria-hidden="true" />
              Fetching reviews…
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              Refresh reviews
            </>
          )}
        </button>
      </div>

      {totalAll > 0 && (
        <div className="rv-toolbar">
          <div className="rv-source-tabs">
            <button type="button" className={`rv-source-tab${sourceFilter === "all" ? " active" : ""}`} onClick={() => setSourceFilter("all")}>
              All Reviews ({totalAll})
            </button>
            <button type="button" className={`rv-source-tab${sourceFilter === "steam" ? " active" : ""}`} onClick={() => setSourceFilter("steam")}>
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" aria-hidden="true">
                <path d="M3 5h18v14H3V5zm9 2L5 19h4l1-2.5h2L13 19h4L12 7zm0 4.6L13.2 14h-2.4L12 11.6z" />
              </svg>
              Steam ({steamCount > 0 ? steamCount.toLocaleString() : steamCount})
            </button>
            {youCount > 0 && (
              <button type="button" className={`rv-source-tab${sourceFilter === "you" ? " active" : ""}`} onClick={() => setSourceFilter("you")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" width="14" height="14" aria-hidden="true">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                You ({youCount})
              </button>
            )}
          </div>

          <div className="rv-filters">
            <div className="rv-select-wrap">
              <select
                className="rv-select"
                value={ratingFilter}
                onChange={(e) => setRatingFilter(e.target.value as RatingFilter)}
                aria-label="Filter by recommendation"
              >
                <option value="all">All reviews</option>
                <option value="positive">Recommended only</option>
                <option value="negative">Not recommended only</option>
              </select>
              <svg className="rv-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>

            <div className="rv-select-wrap">
              <select
                className="rv-select"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                aria-label="Sort order"
              >
                <option value="featured">Sort: Featured (Most Helpful)</option>
                <option value="recent">Sort: Recent</option>
                <option value="funny">Sort: Funny</option>
                <option value="highest">Sort: Highest Rated</option>
                <option value="longest">Sort: Most Detailed</option>
              </select>
              <svg className="rv-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>

            <div className="rv-select-wrap">
              <select
                className="rv-select"
                value={purchaseTypeFilter}
                onChange={(e) => {
                  setPurchaseTypeFilter(e.target.value as PurchaseTypeFilter);
                  setNextCursor(null);
                  fetchReviews(true, null);
                }}
                aria-label="Filter by purchase source"
              >
                <option value="all">All purchasers</option>
                <option value="steam">Steam purchases only</option>
                <option value="other">Other sources only</option>
              </select>
              <svg className="rv-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>

            <div className="rv-select-wrap">
              <select
                className="rv-select"
                value={playtimeFilter}
                onChange={(e) => setPlaytimeFilter(e.target.value as PlaytimeFilter)}
                aria-label="Filter by reviewer playtime"
              >
                <option value="none">All playtimes</option>
                <option value="over_1h">Over 1 hour</option>
                <option value="over_10h">Over 10 hours</option>
                <option value="custom">Custom range…</option>
              </select>
              <svg className="rv-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>

            {playtimeFilter === "custom" && (
              <div className="rv-playtime-range">
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="rv-input"
                  value={playtimeMinHours}
                  onChange={(e) => setPlaytimeMinHours(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                  placeholder="Min h"
                  aria-label="Minimum reviewer playtime in hours"
                />
                <span className="rv-playtime-range-sep">–</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="rv-input"
                  value={playtimeMaxHours}
                  onChange={(e) => setPlaytimeMaxHours(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                  placeholder="Max h"
                  aria-label="Maximum reviewer playtime in hours (0 = no max)"
                />
                <span className="rv-playtime-range-hint">hours</span>
              </div>
            )}

            <div className="rv-select-wrap">
              <select
                className="rv-select"
                value={languageFilter}
                onChange={(e) => handleLanguageChange(e.target.value)}
                aria-label="Filter by language"
              >
                {STEAM_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.flag} {lang.label}
                  </option>
                ))}
              </select>
              <svg className="rv-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>

            <div className="rv-search-wrap">
              <svg className="rv-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                className="rv-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search reviews…"
                aria-label="Search reviews"
              />
              {searchQuery && (
                <button type="button" className="rv-search-clear" onClick={() => setSearchQuery("")} aria-label="Clear search">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {(externalLoading["metacritic"] || externalLoading["opencritic"] || externalLoading["rawg"]) &&
        (sourceFilter === "metacritic" || sourceFilter === "opencritic" || sourceFilter === "rawg") ? (
        <div className="rv-empty">
          <div className="rv-empty-icon">
            <span className="rv-spinner" aria-hidden="true" style={{ width: 28, height: 28, borderWidth: 3 }} />
          </div>
          <h3 className="rv-empty-title">Loading reviews…</h3>
          <p className="rv-empty-subtitle">
            Fetching reviews from {sourceFilter === "metacritic" ? "Metacritic" : sourceFilter === "opencritic" ? "OpenCritic" : "RAWG"}…
          </p>
        </div>
      ) : totalAll === 0 ? (
        <div className="rv-empty">
          <div className="rv-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              <path d="M9 10h.01" /><path d="M13 10h.01" /><path d="M17 10h.01" />
            </svg>
          </div>
          <h3 className="rv-empty-title">No community reviews yet</h3>
          <p className="rv-empty-subtitle">
            Click <strong>Refresh reviews</strong> to fetch the latest community feedback from Steam and other sources.
          </p>
        </div>
      ) : filteredReviews.length === 0 ? (
        <div className="rv-empty rv-empty-small">
          <div className="rv-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </div>
          <h3 className="rv-empty-title">No reviews match your filters</h3>
          <p className="rv-empty-subtitle">Try adjusting the rating, source, language, playtime, or search criteria.</p>
          <button
            type="button"
            className="rv-btn rv-btn-ghost"
            onClick={() => {
              setRatingFilter("all");
              setSourceFilter("all");
              setPurchaseTypeFilter("all");
              setPlaytimeFilter("none");
              setPlaytimeMinHours(0);
              setPlaytimeMaxHours(0);
              handleLanguageChange("all");
              setSearchQuery("");
            }}
          >
            Reset filters
          </button>
        </div>
      ) : (
        <div className="rv-list">
          <div className="rv-list-grid">
            {filteredReviews.map((review) => (
              <ReviewCard key={review.id} review={review} appId={appId} />
            ))}
          </div>

          {nextCursor && sourceFilter !== "you" && sourceFilter !== "metacritic" && sourceFilter !== "opencritic" && sourceFilter !== "rawg" && (
            <div className="rv-load-more-row">
              <button
                type="button"
                className="rv-btn rv-btn-ghost rv-btn-large"
                onClick={() => fetchReviews(false, nextCursor, languageFilter)}
                disabled={isLoadingMore}
              >
                {isLoadingMore ? (
                  <><span className="rv-spinner" aria-hidden="true" />Loading more…</>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <polyline points="19 12 12 19 5 12" />
                    </svg>
                    Load more reviews
                    {totalReviewCount > 0 && (
                      <span className="rv-load-more-count">
                        ({reviewsList.length} of {totalReviewCount} loaded)
                      </span>
                    )}
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="rv-external-section">
        <div className="rv-external-header">
          <div className="rv-external-header-text">
            <h3 className="rv-external-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              Reviews from across the web
            </h3>
            <p className="rv-external-subtitle">Open full reviews and aggregated scores from popular review sites</p>
          </div>
        </div>
        <div className="rv-external-grid">
          {externalSources.map((src) => (
            <ExternalReviewButton
              key={src.id}
              src={src}
              openExternal={openExternal}
              isBigScreen={isBigScreen}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface ExternalReviewButtonProps {
  src: { id: string; name: string; url: string; description: string; accent: string };
  openExternal: (url: string) => void;
  isBigScreen?: boolean;
}

function ExternalReviewButton({ src, openExternal, isBigScreen }: ExternalReviewButtonProps) {
  const focusProps = useFocusable(() => openExternal(src.url));
  return (
    <button
      type="button"
      className="rv-external-card"
      {...(isBigScreen ? focusProps : { onClick: () => openExternal(src.url) })}
      style={{ "--accent": src.accent } as React.CSSProperties}
    >
      <div className="rv-external-card-icon" style={{ color: src.accent }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      </div>
      <div className="rv-external-card-body">
        <div className="rv-external-card-name">{src.name}</div>
        <div className="rv-external-card-desc">{src.description}</div>
      </div>
      <svg className="rv-external-card-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  );
}
