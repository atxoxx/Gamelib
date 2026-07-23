import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  type HydraAnswersResult,
  type HydraReview,
  type HydraReviewAnswer,
  type HydraReviewsResult,
  type HydraSortOption,
  HYDRA_SORT_OPTIONS,
} from "../types/game";

// ─── Hydra community reviews panel ──────────────────────────────────────────
//
// Read-only view of the Hydra launcher's public community reviews
// (https://github.com/hydralauncher/hydra). Listing reviews and replies
// is a public endpoint; voting/posting requires a Hydra account, so we
// only display upvote/downvote counts.
//
// All HTML bodies (reviewHtml / answerHtml / translations) are sanitized
// by the Rust backend with ammonia BEFORE they reach this component, so
// dangerouslySetInnerHTML is safe here.

const REVIEWS_TAKE = 20;
const REPLIES_TAKE = 10;
/** Number of embedded replies shown before "View all replies". Mirrors Hydra. */
const REPLIES_PREVIEW_LIMIT = 5;

interface HydraReviewsPanelProps {
  /** Steam appid used as the Hydra objectId. Null when unresolvable. */
  appId: number | null;
  gameName: string;
}

// ─── Formatting helpers ─────────────────────────────────────────────────────

function formatHydraPlaytime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 120) return `${minutes} min`;
  const hours = seconds / 3600;
  if (hours >= 100) return `${Math.round(hours).toLocaleString()} h`;
  return `${hours.toFixed(1)} h`;
}

function formatRelativeDate(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month} month${month === 1 ? "" : "s"} ago`;
  const year = Math.floor(day / 365);
  return `${year} year${year === 1 ? "" : "s"} ago`;
}

function formatAbsoluteDate(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

/** Hydra maps 1–5 score to a color bucket: 1–2 red, 3 yellow, 4–5 green. */
function scoreTone(score: number): "neg" | "mid" | "pos" {
  if (score <= 2) return "neg";
  if (score === 3) return "mid";
  return "pos";
}

/** Base language of the current UI locale, Hydra-style (`en`, `pt`, …). */
function uiBaseLanguage(): string {
  try {
    return (navigator.language || "en").split("-")[0].toLowerCase();
  } catch {
    return "en";
  }
}

/** Pick the translated HTML for the UI language, or null when the
 *  original is already in the UI language / no translation exists. */
function pickTranslation(
  translations: Record<string, string> | undefined,
  detectedLanguage: string | null | undefined,
): string | null {
  if (!translations) return null;
  const target = uiBaseLanguage();
  const detected = (detectedLanguage ?? "").split("-")[0].toLowerCase();
  if (detected && detected === target) return null;
  const html = translations[target];
  return typeof html === "string" && html.trim() ? html : null;
}

// ─── Small local dropdown (same rv-dd styling as ReviewsTab) ────────────────

function SortDropdown({
  value,
  onChange,
}: {
  value: HydraSortOption;
  onChange: (value: HydraSortOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);
  const selected = HYDRA_SORT_OPTIONS.find((o) => o.value === value);
  return (
    <div className="rv-dd" ref={ref}>
      <button
        type="button"
        className={`rv-dd-trigger${open ? " active" : ""}`}
        onClick={() => setOpen((p) => !p)}
      >
        <span>Sort: {selected?.label ?? "Newest"}</span>
        <svg className="rv-dd-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="rv-dd-menu">
          {HYDRA_SORT_OPTIONS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`rv-dd-opt${item.value === value ? " active" : ""}`}
              onClick={() => {
                onChange(item.value);
                setOpen(false);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Shared atoms ───────────────────────────────────────────────────────────

function HydraAvatar({ user, size = 34 }: { user: HydraReview["user"]; size?: number }) {
  const [broken, setBroken] = useState(false);
  const name = user.displayName?.trim() || "Anonymous";
  const initial = name.charAt(0).toUpperCase();
  if (user.profileImageUrl && !broken) {
    return (
      <img
        className="hrv-avatar"
        style={{ width: size, height: size }}
        src={user.profileImageUrl}
        alt={name}
        loading="lazy"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className="hrv-avatar hrv-avatar-fallback" style={{ width: size, height: size, fontSize: size * 0.44 }} aria-hidden="true">
      {initial}
    </span>
  );
}

function HydraStarScore({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(5, Math.round(score)));
  return (
    <span className={`hrv-score hrv-score-${scoreTone(clamped)}`} title={`${clamped} out of 5`}>
      <span className="hrv-score-stars" aria-hidden="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <svg
            key={i}
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill={i < clamped ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        ))}
      </span>
      <span className="hrv-score-label">{clamped}/5</span>
    </span>
  );
}

function HydraVotes({ upvotes, downvotes }: { upvotes: number; downvotes: number }) {
  return (
    <span className="hrv-votes" title="Vote counts from the Hydra community (voting requires a Hydra account)">
      <span className="hrv-vote hrv-vote-up">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
        </svg>
        {upvotes.toLocaleString()}
      </span>
      <span className="hrv-vote hrv-vote-down">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
        </svg>
        {downvotes.toLocaleString()}
      </span>
    </span>
  );
}

// ─── Reply row ──────────────────────────────────────────────────────────────

function HydraReplyRow({ answer }: { answer: HydraReviewAnswer }) {
  const [showOriginal, setShowOriginal] = useState(false);
  const translated = pickTranslation(answer.translations, answer.detectedLanguage);
  const html = translated && !showOriginal ? translated : answer.answerHtml;
  const name = answer.user.displayName?.trim() || "Anonymous";
  return (
    <div className="hrv-reply">
      <HydraAvatar user={answer.user} size={26} />
      <div className="hrv-reply-body">
        <div className="hrv-reply-meta">
          <span className="hrv-name">{name}</span>
          <span className="hrv-date" title={formatAbsoluteDate(answer.createdAt)}>
            {formatRelativeDate(answer.createdAt)}
          </span>
          <HydraVotes upvotes={answer.upvotes} downvotes={answer.downvotes} />
        </div>
        <div className="hrv-html" dangerouslySetInnerHTML={{ __html: html }} />
        {translated && (
          <button type="button" className="hrv-translate-toggle" onClick={() => setShowOriginal((p) => !p)}>
            {showOriginal ? "Show translation" : "Show original"}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Reply thread (lazy "view all" / "load more" like Hydra) ────────────────

function mergeReplies(existing: HydraReviewAnswer[], incoming: HydraReviewAnswer[]): HydraReviewAnswer[] {
  const seen = new Set(existing.map((a) => a.id));
  return [...existing, ...incoming.filter((a) => !seen.has(a.id))];
}

function HydraReplyThread({ review, appId }: { review: HydraReview; appId: number }) {
  const [replies, setReplies] = useState<HydraReviewAnswer[]>(review.answers ?? []);
  const [totalCount, setTotalCount] = useState<number>(review.answerCount ?? 0);
  const [expanded, setExpanded] = useState(false);
  const [loadedAll, setLoadedAll] = useState(false);
  const [serverLoaded, setServerLoaded] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = expanded ? replies : replies.slice(0, REPLIES_PREVIEW_LIMIT);
  const hasMoreOnServer = loadedAll ? serverLoaded < totalCount : replies.length < totalCount;

  const fetchReplies = useCallback(
    async (replace: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const skip = replace ? 0 : serverLoaded;
        const result = await invoke<HydraAnswersResult>("fetch_hydra_review_replies", {
          steamAppId: appId,
          reviewId: review.id,
          take: REPLIES_TAKE,
          skip,
        });
        setTotalCount(result.totalCount);
        setReplies((prev) => (replace ? result.answers : mergeReplies(prev, result.answers)));
        setServerLoaded(skip + result.answers.length);
        setLoadedAll(true);
        setExpanded(true);
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    },
    [appId, review.id, serverLoaded],
  );

  if (totalCount <= 0 && replies.length === 0) return null;

  // The toggle is only useful when there is something beyond the preview.
  const showToggle = expanded || totalCount > visible.length;

  return (
    <div className="hrv-thread">
      {showToggle && (
        <button
          type="button"
          className="hrv-thread-toggle"
          onClick={() => {
            if (expanded) {
              setExpanded(false);
            } else if (!loadedAll && replies.length < totalCount) {
              void fetchReplies(true);
            } else {
              setExpanded(true);
            }
          }}
          disabled={loading}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {loading
            ? "Loading replies…"
            : expanded
            ? "Hide replies"
            : totalCount === 1
            ? "View 1 reply"
            : `View all ${totalCount.toLocaleString()} replies`}
        </button>
      )}

      {visible.length > 0 && (
        <div className="hrv-thread-list">
          {visible.map((answer) => (
            <HydraReplyRow key={answer.id} answer={answer} />
          ))}

          {expanded && hasMoreOnServer && (
            <button type="button" className="hrv-thread-more" onClick={() => void fetchReplies(false)} disabled={loading}>
              {loading ? "Loading…" : "Load more replies"}
            </button>
          )}
        </div>
      )}

      {error && <p className="hrv-error-inline">Could not load replies: {error}</p>}
    </div>
  );
}

// ─── Review row ─────────────────────────────────────────────────────────────

function HydraReviewRow({ review, appId }: { review: HydraReview; appId: number }) {
  const [showOriginal, setShowOriginal] = useState(false);
  const translated = pickTranslation(review.translations, review.detectedLanguage);
  const html = translated && !showOriginal ? translated : review.reviewHtml;
  const name = review.user.displayName?.trim() || "Anonymous";
  const playtime = review.playTimeInSeconds ?? 0;

  return (
    <div className="rv-row hrv-row">
      <div className="hrv-row-header">
        <HydraAvatar user={review.user} />
        <div className="hrv-row-id">
          <span className="hrv-name">{name}</span>
          <div className="hrv-row-sub">
            <span className="hrv-date" title={formatAbsoluteDate(review.createdAt)}>
              {formatRelativeDate(review.createdAt)}
            </span>
            {playtime > 0 && (
              <span className="hrv-playtime" title="Author playtime in this game">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                {formatHydraPlaytime(playtime)} played
              </span>
            )}
          </div>
        </div>
        <HydraStarScore score={review.score} />
      </div>

      <div className="hrv-html" dangerouslySetInnerHTML={{ __html: html }} />
      {translated && (
        <button type="button" className="hrv-translate-toggle" onClick={() => setShowOriginal((p) => !p)}>
          {showOriginal ? "Show translation" : "Show original"}
        </button>
      )}

      <div className="hrv-row-footer">
        <HydraVotes upvotes={review.upvotes} downvotes={review.downvotes} />
        {review.answerCount > 0 && (
          <span className="hrv-reply-count">
            {review.answerCount === 1 ? "1 reply" : `${review.answerCount.toLocaleString()} replies`}
          </span>
        )}
      </div>

      <HydraReplyThread review={review} appId={appId} />
    </div>
  );
}

// ─── Panel ──────────────────────────────────────────────────────────────────

export default function HydraReviewsPanel({ appId, gameName }: HydraReviewsPanelProps) {
  const [reviews, setReviews] = useState<HydraReview[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [sortBy, setSortBy] = useState<HydraSortOption>("newest");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against out-of-order responses when sort changes mid-flight.
  const requestSeq = useRef(0);

  const fetchPage = useCallback(
    async (skip: number, sort: HydraSortOption, replace: boolean) => {
      if (appId === null) return;
      const seq = ++requestSeq.current;
      if (replace) setLoading(true);
      else setLoadingMore(true);
      setError(null);
      try {
        const result = await invoke<HydraReviewsResult>("fetch_hydra_reviews", {
          steamAppId: appId,
          take: REVIEWS_TAKE,
          skip,
          sortBy: sort,
        });
        if (seq !== requestSeq.current) return;
        setTotalCount(result.totalCount);
        setReviews((prev) => {
          if (replace) return result.reviews;
          const seen = new Set(prev.map((r) => r.id));
          return [...prev, ...result.reviews.filter((r) => !seen.has(r.id))];
        });
      } catch (err) {
        if (seq === requestSeq.current) setError(String(err));
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [appId],
  );

  useEffect(() => {
    setReviews([]);
    setTotalCount(0);
    void fetchPage(0, sortBy, true);
  }, [fetchPage, sortBy]);

  const hasMore = useMemo(() => reviews.length < totalCount, [reviews.length, totalCount]);

  if (appId === null) {
    return (
      <div className="rv-empty">
        <div className="rv-empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
        <h3 className="rv-empty-title">No Steam match for “{gameName}”</h3>
        <p className="rv-empty-subtitle">
          Hydra community reviews are keyed by Steam appid. Link this game to a Steam app to see user reviews.
        </p>
      </div>
    );
  }

  return (
    <div className="hrv-root">
      <div className="hrv-toolbar">
        <span className="hrv-toolbar-count">
          {loading
            ? "Loading user reviews…"
            : totalCount === 0
            ? "No user reviews yet"
            : totalCount === 1
            ? "1 user review"
            : `${totalCount.toLocaleString()} user reviews`}
        </span>
        <SortDropdown value={sortBy} onChange={setSortBy} />
      </div>

      {error ? (
        <div className="rv-empty rv-empty-small">
          <h3 className="rv-empty-title">Could not load Hydra reviews</h3>
          <p className="rv-empty-subtitle">{error}</p>
          <button type="button" className="rv-btn rv-btn-ghost" onClick={() => void fetchPage(0, sortBy, true)}>
            Retry
          </button>
        </div>
      ) : loading ? (
        <div className="rv-empty">
          <div className="rv-empty-icon">
            <span className="rv-spinner" aria-hidden="true" style={{ width: 28, height: 28, borderWidth: 3 }} />
          </div>
          <h3 className="rv-empty-title">Loading user reviews…</h3>
          <p className="rv-empty-subtitle">Fetching community reviews from Hydra…</p>
        </div>
      ) : reviews.length === 0 ? (
        <div className="rv-empty rv-empty-small">
          <div className="rv-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <h3 className="rv-empty-title">No user reviews yet</h3>
          <p className="rv-empty-subtitle">Nobody has reviewed “{gameName}” on Hydra so far.</p>
        </div>
      ) : (
        <div className="rv-list">
          <div className="rv-list-rows">
            {reviews.map((review) => (
              <HydraReviewRow key={review.id} review={review} appId={appId} />
            ))}
          </div>

          {hasMore && (
            <div className="rv-load-more-row">
              <button
                type="button"
                className="rv-btn rv-btn-ghost rv-btn-large"
                onClick={() => void fetchPage(reviews.length, sortBy, false)}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <><span className="rv-spinner" aria-hidden="true" />Loading more…</>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <polyline points="19 12 12 19 5 12" />
                    </svg>
                    Load more reviews
                    <span className="rv-load-more-count">({reviews.length} of {totalCount} loaded)</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
