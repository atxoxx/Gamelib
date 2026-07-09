import type { NewsArticle } from "../../hooks/useNewsFeeds";
import { formatArticleDate } from "../../hooks/useNewsFeeds";

interface NewsArticleCardProps {
  article: NewsArticle;
  onClick: (article: NewsArticle) => void;
}

export default function NewsArticleCard({ article, onClick }: NewsArticleCardProps) {
  return (
    <div
      className="news-article-card hover-lift"
      onClick={() => onClick(article)}
      role="button"
      tabIndex={0}
      aria-label={`Read article: ${article.title}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(article);
        }
      }}
    >
      <div className="news-card-cover">
        {article.imageUrl ? (
          <img
            src={article.imageUrl}
            alt=""
            loading="lazy"
            onError={(e) => {
              // Show placeholder on image load failure
              const target = e.currentTarget;
              target.style.display = "none";
              const placeholder = target.parentElement?.querySelector(
                ".news-card-cover-placeholder"
              ) as HTMLElement | null;
              if (placeholder) placeholder.style.display = "flex";
            }}
          />
        ) : null}
        <div
          className="news-card-cover-placeholder"
          style={{ display: article.imageUrl ? "none" : "flex" }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        </div>
        <span className="news-card-source-badge">{article.sourceName}</span>
      </div>

      <div className="news-card-body">
        <h3 className="news-card-title" title={article.title}>
          {article.title}
        </h3>
        {article.description && (
          <p className="news-card-snippet">{article.description}</p>
        )}
        <div className="news-card-meta">
          <span className="news-card-source-name">{article.sourceName}</span>
          {article.pubDate && (
            <>
              <span className="news-card-meta-dot" aria-hidden="true" />
              <span>{formatArticleDate(article.pubDate)}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Skeleton loader for news article cards shown during loading. */
export function NewsArticleCardSkeleton() {
  return (
    <div className="news-article-card news-article-card-skeleton" aria-hidden="true">
      <div className="news-card-cover-skeleton" />
      <div className="news-card-body-skeleton">
        <div className="skeleton-line skeleton-title" />
        <div className="skeleton-line skeleton-subtitle" />
        <div className="skeleton-line skeleton-subtitle short" />
      </div>
    </div>
  );
}
