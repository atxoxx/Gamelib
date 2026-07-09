import { useState, useCallback, useMemo, useEffect } from "react";
import { useNewsFeeds } from "../hooks/useNewsFeeds";
import type { NewsArticle } from "../hooks/useNewsFeeds";
import { useDensityContext } from "../context/DensityContext";
import DensityToggle from "../components/DensityToggle";
import NewsSourcePills from "../components/news/NewsSourcePills";
import NewsArticleCard, { NewsArticleCardSkeleton } from "../components/news/NewsArticleCard";
import NewsArticlePreview from "../components/news/NewsArticlePreview";
import NewsFeedSettings from "../components/news/NewsFeedSettings";
import "./news/NewsPage.css";

const ITEMS_PER_PAGE = 20;

export default function NewsPage() {
  const {
    articles,
    allArticles,
    loading,
    error,
    activeSource,
    sourceNames,
    customFeeds,
    allFeeds,
    enabledFeedUrls,
    setSourceFilter,
    toggleFeed,
    addCustomFeed,
    removeCustomFeed,
    refresh,
  } = useNewsFeeds();

  const { density, setDensity } = useDensityContext();

  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [page, setPage] = useState(1);

  // Reset to page 1 when source filter changes
  useEffect(() => {
    setPage(1);
  }, [activeSource]);

  // Paginated articles
  const totalPages = Math.max(1, Math.ceil(articles.length / ITEMS_PER_PAGE));
  const paginatedArticles = useMemo(
    () => articles.slice(0, page * ITEMS_PER_PAGE),
    [articles, page]
  );
  const hasMore = page < totalPages;

  const handleCardClick = useCallback((article: NewsArticle) => {
    setSelectedArticle(article);
  }, []);

  const handleClosePreview = useCallback(() => {
    setSelectedArticle(null);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setShowSettings(true);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setShowSettings(false);
  }, []);

  return (
    <div className="news-page">
      {/* Header */}
      <div className="news-header">
        <div className="news-header-left">
          <h1 className="news-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 11a9 9 0 0 1 9 9" />
              <path d="M4 4a16 16 0 0 1 16 16" />
              <circle cx="5" cy="19" r="1" />
            </svg>
            News
          </h1>
        </div>

        <div className="news-header-right">
          <DensityToggle density={density} onChange={setDensity} />
          <button
            type="button"
            className="news-settings-btn"
            onClick={handleOpenSettings}
            title="Manage news feeds"
            aria-label="Manage news feeds"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Feeds
          </button>
        </div>
      </div>

      {/* Source filter pills */}
      <NewsSourcePills
        sourceNames={sourceNames}
        activeSource={activeSource}
        articleCount={allArticles.length}
        onSourceChange={setSourceFilter}
      />

      {/* Content area */}
      {loading ? (
        <div className={`news-article-grid density-${density}`}>
          {Array.from({ length: 8 }).map((_, i) => (
            <NewsArticleCardSkeleton key={i} density={density} />
          ))}
        </div>
      ) : error && articles.length === 0 ? (
        <div className="news-error">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <h3>Couldn't load news</h3>
          <p>{error}</p>
          <button type="button" className="news-retry-btn" onClick={refresh}>
            Try Again
          </button>
        </div>
      ) : articles.length === 0 ? (
        <div className="news-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 11a9 9 0 0 1 9 9" />
            <path d="M4 4a16 16 0 0 1 16 16" />
            <circle cx="5" cy="19" r="1" />
          </svg>
          <h3>No articles yet</h3>
          <p>
            {sourceNames.length === 0
              ? "Add a news feed in settings to get started."
              : activeSource
                ? `No articles from ${activeSource}. Try selecting a different source.`
                : "Articles will appear here. Check your feed settings or try refreshing."}
          </p>
          {sourceNames.length === 0 ? (
            <button type="button" className="news-retry-btn" onClick={handleOpenSettings}>
              Add a Feed
            </button>
          ) : (
            <button type="button" className="news-retry-btn" onClick={refresh}>
              Refresh
            </button>
          )}
        </div>
      ) : (
        <>
          <div className={`news-article-grid density-${density}`}>
            {paginatedArticles.map((article, i) => (
              <NewsArticleCard
                key={`${article.link}-${i}`}
                article={article}
                density={density}
                onClick={handleCardClick}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="news-pagination">
              <span className="news-pagination-info">
                {paginatedArticles.length} of {articles.length} articles
              </span>
              {hasMore && (
                <button
                  type="button"
                  className="news-pagination-btn"
                  onClick={() => setPage((p) => p + 1)}
                >
                  Load more
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* Article preview modal */}
      <NewsArticlePreview article={selectedArticle} onClose={handleClosePreview} />

      {/* Feed settings modal */}
      {showSettings && (
        <NewsFeedSettings
          allFeeds={allFeeds}
          enabledFeedUrls={enabledFeedUrls}
          customFeeds={customFeeds}
          onToggleFeed={toggleFeed}
          onAddFeed={addCustomFeed}
          onRemoveFeed={removeCustomFeed}
          onClose={handleCloseSettings}
        />
      )}
    </div>
  );
}
