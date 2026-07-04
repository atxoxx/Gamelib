import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { type Game, type IgdbReview, type ReviewFetchResult, extractSteamAppId } from "../types/game";
import { useGames } from "../context/GameContext";
import { useToast } from "../context/ToastContext";

// ─── Types ──────────────────────────────────────────────────────────────────

type RatingFilter = "all" | "positive" | "negative";
type SortOrder = "featured" | "highest" | "longest";
type SourceFilter = "all" | "steam" | "you" | "metacritic" | "opencritic" | "rawg";

/** Supported Steam review languages (matching Steam API query codes). */
const LANGUAGES: { code: string; label: string; flag: string }[] = [
  { code: "all", label: "All languages", flag: "🌐" },
  { code: "english", label: "English", flag: "🇬🇧" },
  { code: "french", label: "Français", flag: "🇫🇷" },
  { code: "german", label: "Deutsch", flag: "🇩🇪" },
  { code: "spanish", label: "Español", flag: "🇪🇸" },
  { code: "italian", label: "Italiano", flag: "🇮🇹" },
  { code: "russian", label: "Русский", flag: "🇷🇺" },
  { code: "schinese", label: "简体中文", flag: "🇨🇳" },
  { code: "tchinese", label: "繁體中文", flag: "🇹🇼" },
  { code: "japanese", label: "日本語", flag: "🇯🇵" },
  { code: "koreana", label: "한국어", flag: "🇰🇷" },
  { code: "brazilian", label: "Português (BR)", flag: "🇧🇷" },
  { code: "polish", label: "Polski", flag: "🇵🇱" },
  { code: "turkish", label: "Türkçe", flag: "🇹🇷" },
];

/** A normalized review record we render. Combines local + Steam-fetched data. */
interface ReviewItem {
  id: string;
  source: "you" | "steam" | "metacritic" | "opencritic" | "rawg";
  sourceLabel: string;
  username: string;
  rating: number | null; // 0-100
  ratingLabel: string; // pre-formatted for display
  title: string;
  content: string;
  dateAdded?: number;
  reviewLength: number;
  language?: string;
  sentiment: "positive" | "negative" | null;
  /** Steam: number of users who found this helpful. */
  votesUp?: number;
  /** Steam: number of users who found this funny. */
  votesFunny?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function languageCodeToFriendly(code?: string): string {
  const found = LANGUAGES.find((l) => l.code === code);
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

// ─── Sub-components ────────────────────────────────────────────────────────

function StarRow({ score, size = 14 }: { score: number; size?: number }) {
  const reactId = useId();
  const stars = ratingToStars(score);
  const full = Math.floor(stars);
  const half = stars - full >= 0.5;
  const empty = 5 - full - (half ? 1 : 0);
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

/** Vertical recommendation badge used at the top of each card. */
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
    metacritic: (
      <span style={{ fontSize: "12px", fontWeight: 900, lineHeight: 1 }}>MC</span>
    ),
    opencritic: (
      <span style={{ fontSize: "12px", fontWeight: 900, lineHeight: 1 }}>OC</span>
    ),
    rawg: (
      <span style={{ fontSize: "10px", fontWeight: 900, lineHeight: 1 }}>R</span>
    ),
  };

  return (
    <span className={`rv-source-badge rv-source-badge-${source}`}>
      {iconMap[source] || null}
      <span>{label}</span>
    </span>
  );
}

/** Read-only reaction display showing real Steam data at the bottom of each review card. */
function ReactionBar({ review }: { review: ReviewItem }) {
  const hasVotesUp = (review.votesUp ?? 0) > 0;
  const hasVotesFunny = (review.votesFunny ?? 0) > 0;

  if (!hasVotesUp && !hasVotesFunny) return null;

  return (
    <div className="rv-card-reactions">
      {hasVotesUp && (
        <span className="rv-reaction-badge" title="People found this helpful">
          <span className="rv-reaction-emoji">👍</span>
          <span className="rv-reaction-count">{review.votesUp}</span>
        </span>
      )}
      {hasVotesFunny && (
        <span className="rv-reaction-badge" title="People found this funny">
          <span className="rv-reaction-emoji">😂</span>
          <span className="rv-reaction-count">{review.votesFunny}</span>
        </span>
      )}
    </div>
  );
}

// ─── Review Card ──────────────────────────────────────────────────────────

function ReviewCard({ review }: { review: ReviewItem }) {
  const isYou = review.source === "you";
  const isSteam = review.source === "steam";
  const username = isYou ? "You" : review.username;
  const showTitle = !!review.title;

  // Derive a human-friendly sentiment emoji for the header
  const sentimentEmoji =
    review.sentiment === "positive" ? "👍" : review.sentiment === "negative" ? "👎" : isYou ? "⭐" : "💬";

  return (
    <article className={`rv-card rv-source-${review.source}`}>
      {/* Top accent strip uses --accent variable (set by rv-source-* class) */}

      {/* ── Card header row: indicator + meta ─────────────────────────── */}
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
          </div>
        </div>
      </div>

      {/* ── Card body: title + content ────────────────────────────────── */}
      {showTitle && <h3 className="rv-card-title">{review.title}</h3>}

      {review.content && (
        <p className={`rv-card-content${review.content.length > 280 ? " clamp" : ""}`}>
          {review.content}
        </p>
      )}

      {/* ── Card footer: reactions (real Steam data, read-only) ──────── */}
      <ReactionBar review={review} />
    </article>
  );
}

// ─── Rating Summary Header ────────────────────────────────────────────────

function ReviewSummary({
  reviews,
  game,
  totalReviewCount,
  steamReviewScoreDesc,
  steamTotalPositive,
  steamTotalNegative,
}: {
  reviews: ReviewItem[];
  game: Game;
  totalReviewCount: number;
  steamReviewScoreDesc: string | null;
  steamTotalPositive: number | null;
  steamTotalNegative: number | null;
}) {
  const ratings = reviews.filter((r) => r.rating !== null);

  // Real Steam average score is the percentage of positive reviews
  const hasRealSteamStats = steamTotalPositive !== null && steamTotalNegative !== null;
  const realSteamTotal = hasRealSteamStats ? steamTotalPositive + steamTotalNegative : 0;

  const communityAvg = hasRealSteamStats
    ? Math.round((steamTotalPositive / Math.max(1, realSteamTotal)) * 100)
    : ratings.length > 0
    ? ratings.reduce((acc, r) => acc + (r.rating as number), 0) / ratings.length
    : (game.igdbRating ?? 0);

  const totalReviews = totalReviewCount > 0 ? totalReviewCount : reviews.length;

  const positiveCount = hasRealSteamStats
    ? steamTotalPositive
    : reviews.filter((r) => r.sentiment === "positive").length;

  const negativeCount = hasRealSteamStats
    ? steamTotalNegative
    : reviews.filter((r) => r.sentiment === "negative").length;

  const totalSentiment = positiveCount + negativeCount;
  const divisor = Math.max(1, totalSentiment);
  const hasRatings = totalSentiment > 0;

  const positivePct = Math.round((positiveCount / divisor) * 100);
  const negativePct = 100 - positivePct;

  return (
    <div className="rv-summary">
      <div className="rv-summary-left">
        <div className="rv-summary-score-wrap">
          <div
            className="rv-summary-score"
            style={{
              color:
                communityAvg >= 75
                  ? "#10b981"
                  : communityAvg >= 50
                  ? "#f59e0b"
                  : "#ef4444",
            }}
          >
            {communityAvg > 0 ? Math.round(communityAvg) : "—"}
          </div>
          <div className="rv-summary-score-label">/ 100</div>
        </div>
        <div className="rv-summary-stats">
          <div className="rv-summary-source-stars">
            {communityAvg > 0 && <StarRow score={communityAvg} size={18} />}
          </div>
          {steamReviewScoreDesc && (
            <div
              className="rv-summary-desc"
              style={{
                color:
                  communityAvg >= 75
                    ? "#10b981"
                    : communityAvg >= 50
                    ? "#f59e0b"
                    : "#ef4444",
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
              <div
                className="rv-distribution-bar-fill"
                style={{ width: `${positivePct}%`, background: "#10b981" }}
              />
            </div>
            <span className="rv-distribution-count" style={{ width: "auto", minWidth: "45px" }}>
              {positiveCount.toLocaleString()}
            </span>
          </div>
          <div className="rv-distribution-row">
            <span className="rv-distribution-label rv-distribution-label-neg">Negative</span>
            <div className="rv-distribution-bar-track">
              <div
                className="rv-distribution-bar-fill"
                style={{ width: `${negativePct}%`, background: "#ef4444" }}
              />
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
  /** When provided (store page), called after reviews are fetched so the parent
   *  can update its own state. The library page does not pass this — it relies
   *  on the GameContext update instead. */
  onReviewsFetched?: (reviews: IgdbReview[], source: string) => void;
}

// ─── Main component ────────────────────────────────────────────────────────

export default function ReviewsTab({ game, onReviewsFetched }: ReviewsTabProps) {
  const { showToast } = useToast();
  const { updateGame } = useGames();

  // Filter state
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("featured");
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [languageFilter, setLanguageFilter] = useState("all");

  // ── Auto-fetch reviews ────────────────────────────────────────────────
  const [isFetchingReviews, setIsFetchingReviews] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalReviewCount, setTotalReviewCount] = useState(0);

  // Real Steam summary statistics
  const [steamReviewScoreDesc, setSteamReviewScoreDesc] = useState<string | null>(null);
  const [steamTotalPositive, setSteamTotalPositive] = useState<number | null>(null);
  const [steamTotalNegative, setSteamTotalNegative] = useState<number | null>(null);

  const autoFetchedForRef = useRef<string | null>(null);
  const fetchInFlightRef = useRef(false);

  // ── External reviews state (Metacritic, OpenCritic, RAWG) ───────────
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
            "success"
          );
        }
      } catch (err) {
        console.error(`Failed to fetch ${src} reviews:`, err);
        // Remove from fetched set so user can retry by clicking the tab again
        externalFetchedRef.current.delete(src);
        showToast(`Could not load ${src} reviews`, "error");
      } finally {
        setExternalLoading((prev) => ({ ...prev, [src]: false }));
      }
    },
    [game.id, game.name, showToast]
  );

  // Reset external reviews when game changes
  useEffect(() => {
    externalReviewsRef.current = {};
    setExternalReviews({});
    setExternalLoading({});
    externalFetchedRef.current = new Set();
  }, [game.id]);

  // Auto-fetch external reviews when the source tab is selected
  useEffect(() => {
    if (
      (sourceFilter === "metacritic" || sourceFilter === "opencritic" || sourceFilter === "rawg")
    ) {
      fetchExternalReviews(sourceFilter);
    }
  }, [sourceFilter, game.id, fetchExternalReviews]);

  const fetchReviews = useCallback(
    async (force = false, cursor: string | null = null, currentLang: string = languageFilter) => {
      if (fetchInFlightRef.current) return;
      fetchInFlightRef.current = true;
      const isLoadMore = cursor !== null && cursor !== "";
      if (isLoadMore) {
        setIsLoadingMore(true);
      } else {
        setIsFetchingReviews(true);
      }
      try {
        const steamHint = extractSteamAppId(game.path);
        const result = await invoke<ReviewFetchResult>("fetch_game_reviews", {
          gameName: game.name,
          steamAppId: steamHint,
          cursor: cursor || null,
          language: currentLang === "all" ? null : currentLang,
        });

        setTotalReviewCount(result.totalReviews ?? 0);
        setNextCursor(result.cursor ?? null);
        setSteamReviewScoreDesc(result.steamReviewScoreDesc ?? null);
        setSteamTotalPositive(result.steamTotalPositive ?? null);
        setSteamTotalNegative(result.steamTotalNegative ?? null);

        if (result.reviews.length > 0) {
          if (isLoadMore) {
            // Append to existing reviews
            const existing = game.igdbReviews ?? [];
            const merged = [...existing, ...result.reviews];
            updateGame(game.id, { igdbReviews: merged });
            onReviewsFetched?.(merged, result.source);
          } else {
            updateGame(game.id, { igdbReviews: result.reviews });
            onReviewsFetched?.(result.reviews, result.source);
            if (force) {
              const sourceLabel =
                result.source === "steam"
                  ? "Steam"
                  : result.source === "igdb"
                  ? "IGDB"
                  : "community";
              showToast(
                `Fetched ${result.reviews.length} review${result.reviews.length === 1 ? "" : "s"} from ${sourceLabel}`,
                "success"
              );
            }
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
        fetchInFlightRef.current = false;
        setIsFetchingReviews(false);
        setIsLoadingMore(false);
      }
    },
    [game.id, game.name, game.path, showToast, updateGame, onReviewsFetched, languageFilter]
  );

  const handleLanguageChange = useCallback(
    (newLang: string) => {
      setLanguageFilter(newLang);
      setNextCursor(null);
      setTotalReviewCount(0);
      updateGame(game.id, { igdbReviews: [] });
      fetchReviews(true, null, newLang);
    },
    [game.id, updateGame, fetchReviews]
  );

  useEffect(() => {
    if (autoFetchedForRef.current === game.id) return;
    autoFetchedForRef.current = game.id;
    // Reset states for the new game
    setNextCursor(null);
    setTotalReviewCount(0);
    setSteamReviewScoreDesc(null);
    setSteamTotalPositive(null);
    setSteamTotalNegative(null);
    setLanguageFilter("all");

    fetchReviews(false, null, "all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id]);

  // ── Build the unified list of reviews ───────────────────────────────────
  const allReviews: ReviewItem[] = useMemo(() => {
    const items: ReviewItem[] = [];

    if ((game.rating && game.rating > 0) || game.reviewText) {
      const score = (game.rating ?? 0) * 20;
      items.push({
        id: "you",
        source: "you",
        sourceLabel: "You",
        username: "You",
        rating: game.rating && game.rating > 0 ? score : null,
        ratingLabel: game.rating ? `${game.rating}/5` : "—",
        title: "",
        content: game.reviewText || "",
        dateAdded: game.addedAt,
        reviewLength: (game.reviewText || "").length,
        language: undefined,
        sentiment: ratingToSentiment(game.rating && game.rating > 0 ? score : null),
      });
    }

    if (game.igdbReviews && game.igdbReviews.length > 0) {
      game.igdbReviews.forEach((r: IgdbReview, idx: number) => {
        const item: ReviewItem = {
          id: `steam-${idx}`,
          source: "steam",
          sourceLabel: "Steam",
          username: r.username || `Steam Player`,
          rating: r.rating ?? null,
          ratingLabel: r.rating !== undefined ? `${r.rating}/100` : "—",
          title: r.title || "",
          content: r.content || "",
          dateAdded: r.timestampCreated ? r.timestampCreated * 1000 : undefined,
          reviewLength: (r.content || "").length,
          language: r.language,
          sentiment: ratingToSentiment(r.rating ?? null),
          votesUp: r.votesUp,
          votesFunny: r.votesFunny,
        };
        items.push(item);
      });
    }

    // Merge external reviews (metacritic, opencritic, rawg)
    const externalLabels: Record<string, string> = {
      metacritic: "Metacritic",
      opencritic: "OpenCritic",
      rawg: "RAWG",
    };
    for (const [src, label] of Object.entries(externalLabels)) {
      const revs = externalReviews[src];
      if (revs && revs.length > 0) {
        revs.forEach((r: IgdbReview, idx: number) => {
          const item: ReviewItem = {
            id: `${src}-${idx}`,
            source: src as ReviewItem["source"],
            sourceLabel: label,
            username: r.username || label,
            rating: r.rating ?? null,
            ratingLabel: r.rating !== undefined ? `${Math.round(r.rating)}/100` : "—",
            title: r.title || "",
            content: r.content || "",
            dateAdded: r.timestampCreated ? r.timestampCreated * 1000 : undefined,
            reviewLength: (r.content || "").length,
            language: r.language,
            sentiment: ratingToSentiment(r.rating ?? null),
          };
          items.push(item);
        });
      }
    }

    return items;
  }, [game.rating, game.reviewText, game.igdbReviews, game.addedAt, externalReviews]);

  // Filtered + sorted
  const filteredReviews = useMemo(() => {
    let list = allReviews.slice();

    // Source filter
    if (sourceFilter !== "all") {
      list = list.filter((r) => r.source === sourceFilter);
    }

    // Language filter
    if (languageFilter !== "all") {
      list = list.filter((r) => r.language === languageFilter);
    }

    // Rating filter
    if (ratingFilter !== "all") {
      list = list.filter((r) => {
        if (ratingFilter === "positive") return r.sentiment === "positive";
        if (ratingFilter === "negative") return r.sentiment === "negative";
        return true;
      });
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (r) =>
          r.content.toLowerCase().includes(q) ||
          r.title.toLowerCase().includes(q) ||
          r.username.toLowerCase().includes(q)
      );
    }

    // Sort
    list.sort((a, b) => {
      if (a.source === "you" && b.source !== "you") return -1;
      if (b.source === "you" && a.source !== "you") return 1;

      switch (sortOrder) {
        case "highest":
          return (b.rating ?? -1) - (a.rating ?? -1);
        case "longest":
          return b.reviewLength - a.reviewLength;
        case "featured":
        default:
          const aIdx = a.id.startsWith("steam-") ? parseInt(a.id.slice(6), 10) : -1;
          const bIdx = b.id.startsWith("steam-") ? parseInt(b.id.slice(6), 10) : -1;
          return aIdx - bIdx;
      }
    });

    return list;
  }, [allReviews, sourceFilter, languageFilter, ratingFilter, sortOrder, searchQuery]);

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

    sources.push({
      id: "metacritic",
      name: "Metacritic",
      url: buildExternalUrl(game, "metacritic"),
      description: `Search "${game.name}" on Metacritic`,
      accent: "#ffcc33",
    });
    sources.push({
      id: "opencritic",
      name: "OpenCritic",
      url: buildExternalUrl(game, "opencritic"),
      description: "Critic reviews aggregator",
      accent: "#ff0099",
    });
    sources.push({
      id: "rawg",
      name: "RAWG",
      url: buildExternalUrl(game, "rawg"),
      description: "Community reviews & ratings",
      accent: "#f43f5e",
    });

    return sources;
  }, [game.metadataUrl, game.metadataSource, game.platform, game.path, game.name]);

  const totalAll = allReviews.length;
  const steamCount = allReviews.filter((r) => r.source === "steam").length;
  const youCount = allReviews.filter((r) => r.source === "you").length;

  function openExternal(url: string) {
    openUrl(url).catch((err) => {
      showToast(`Could not open link: ${err}`, "error");
    });
  }

  return (
    <div className="rv-root">
      {/* ── Header ────────────────────────────────────────────────────── */}
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
        game={game}
        totalReviewCount={totalReviewCount}
        steamReviewScoreDesc={steamReviewScoreDesc}
        steamTotalPositive={steamTotalPositive}
        steamTotalNegative={steamTotalNegative}
      />

      {/* ── Refresh button ────────────────────────────────────────────── */}
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

      {/* ── Toolbar: source tabs + filters + search ───────────────────── */}
      {totalAll > 0 && (
        <div className="rv-toolbar">
          {/* Source subtabs */}
          <div className="rv-source-tabs">
            <button
              type="button"
              className={`rv-source-tab${sourceFilter === "all" ? " active" : ""}`}
              onClick={() => setSourceFilter("all")}
            >
              All Reviews ({totalAll})
            </button>
            <button
              type="button"
              className={`rv-source-tab${sourceFilter === "steam" ? " active" : ""}`}
              onClick={() => setSourceFilter("steam")}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" aria-hidden="true">
                <path d="M3 5h18v14H3V5zm9 2L5 19h4l1-2.5h2L13 19h4L12 7zm0 4.6L13.2 14h-2.4L12 11.6z" />
              </svg>
              Steam ({totalReviewCount > 0 ? totalReviewCount.toLocaleString() : steamCount})
            </button>
            {youCount > 0 && (
              <button
                type="button"
                className={`rv-source-tab${sourceFilter === "you" ? " active" : ""}`}
                onClick={() => setSourceFilter("you")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" width="14" height="14" aria-hidden="true">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                You ({youCount})
              </button>
            )}
            {/* Metacritic, OpenCritic, and RAWG subtabs are hidden for now. */}

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
                <option value="featured">Sort: Featured</option>
                <option value="highest">Sort: Highest Rated</option>
                <option value="longest">Sort: Most Detailed</option>
              </select>
              <svg className="rv-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>

            {/* Language filter */}
            <div className="rv-select-wrap">
              <select
                className="rv-select"
                value={languageFilter}
                onChange={(e) => handleLanguageChange(e.target.value)}
                aria-label="Filter by language"
              >
                {LANGUAGES.map((lang) => (
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
                placeholder="Search reviews..."
                aria-label="Search reviews"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="rv-search-clear"
                  onClick={() => setSearchQuery("")}
                  aria-label="Clear search"
                >
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

      {/* ── Loading state for external reviews ─────────────────────── */}
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
              <path d="M9 10h.01" />
              <path d="M13 10h.01" />
              <path d="M17 10h.01" />
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
          <p className="rv-empty-subtitle">Try adjusting the rating, source, language, or search criteria.</p>
          <button
            type="button"
            className="rv-btn rv-btn-ghost"
            onClick={() => {
              setRatingFilter("all");
              setSourceFilter("all");
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
              <ReviewCard key={review.id} review={review} />
            ))}
          </div>

          {/* Load More button — when there are more pages on Steam */}
          {nextCursor && sourceFilter !== "you" && (
            <div className="rv-load-more-row">
              <button
                type="button"
                className="rv-btn rv-btn-ghost rv-btn-large"
                onClick={() => fetchReviews(false, nextCursor, languageFilter)}
                disabled={isLoadingMore}
              >
                {isLoadingMore ? (
                  <>
                    <span className="rv-spinner" aria-hidden="true" />
                    Loading more…
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <polyline points="19 12 12 19 5 12" />
                    </svg>
                    Load more reviews
                    {totalReviewCount > 0 && (
                      <span className="rv-load-more-count">
                        ({game.igdbReviews?.length ?? 0} of {totalReviewCount} loaded)
                      </span>
                    )}
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── External sources section ──────────────────────────────────── */}
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
            <p className="rv-external-subtitle">
              Open full reviews and aggregated scores from popular review sites
            </p>
          </div>
        </div>
        <div className="rv-external-grid">
          {externalSources.map((src) => (
            <button
              key={src.id}
              type="button"
              className="rv-external-card"
              onClick={() => openExternal(src.url)}
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
          ))}
        </div>
      </div>
    </div>
  );
}
