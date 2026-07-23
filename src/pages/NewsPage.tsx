import { useState, useCallback, useMemo, useEffect } from "react";
import { useNewsFeeds, buildOpml, parseOpml } from "../hooks/useNewsFeeds";
import type { NewsArticle } from "../hooks/useNewsFeeds";
import { useDensityContext } from "../context/DensityContext";
import DensityToggle from "../components/DensityToggle";
import NewsSourcePills from "../components/news/NewsSourcePills";
import NewsArticleCard, { NewsArticleCardSkeleton } from "../components/news/NewsArticleCard";
import NewsArticlePreview from "../components/news/NewsArticlePreview";
import NewsFeedSettings from "../components/news/NewsFeedSettings";
import {
  loadSavedArticles,
  toggleSavedArticle,
} from "../pages/communityStorage";
import "./news/NewsPage.css";
import "../styles/page-news.css";
import { PageHeader } from "../components/ui";

const ITEMS_PER_PAGE = 20;

import { useBigScreen } from "../context/BigScreenContext";
import BigScreenNews from "../components/bigscreen/BigScreenNews";

export default function NewsPage() {
  const { isBigScreen } = useBigScreen();
  if (isBigScreen) {
    return <BigScreenNews />;
  }
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
    readLinks,
    markRead,
    markAllRead,
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
  const [savedArticles, setSavedArticles] = useState(() => loadSavedArticles());
  const [opmlInput, setOpmlInput] = useState<HTMLInputElement | null>(null);
  const [opmlMessage, setOpmlMessage] = useState<string | null>(null);

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

  const unreadCount = useMemo(
    () => articles.filter((a) => !readLinks.has(a.link)).length,
    [articles, readLinks]
  );

  const handleCardClick = useCallback((article: NewsArticle) => {
    setSelectedArticle(article);
  }, []);

  // Toggle bookmark for the currently-open article (#5)
  const handleToggleSave = useCallback((article: NewsArticle) => {
    setSavedArticles(toggleSavedArticle(article));
  }, []);

  // OPML export (#10)
  const handleExportOpml = useCallback(() => {
    const feeds = allFeeds.filter((f) => f.enabled);
    const blob = new Blob([buildOpml(feeds)], { type: "text/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gamelib-news-feeds.opml";
    a.click();
    URL.revokeObjectURL(url);
  }, [allFeeds]);

  // OPML import (#10)
  const handleImportOpml = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const feeds = parseOpml(text);
        if (feeds.length === 0) {
          setOpmlMessage("No feeds found in that OPML file.");
          return;
        }
        let added = 0;
        for (const f of feeds) {
          // Reuse the hook's add logic; duplicates are rejected silently.
          addCustomFeed(f.name, f.url);
          added++;
        }
        setOpmlMessage(`Imported ${added} feed${added === 1 ? "" : "s"}.`);
        refresh();
      } catch {
        setOpmlMessage("Failed to read OPML file.");
      }
    },
    [addCustomFeed, refresh]
  );

  const handleClosePreview = useCallback(() => {
    // Mark the article as read when the preview is dismissed.
    if (selectedArticle) markRead(selectedArticle.link);
    setSelectedArticle(null);
  }, [selectedArticle, markRead]);

  const handleOpenSettings = useCallback(() => {
    setShowSettings(true);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setShowSettings(false);
  }, []);

  return (
    <div className="news-page page">
      {/* Header */}
      <PageHeader
        eyebrow="Stay in the loop"
        title="News"
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 11a9 9 0 0 1 9 9" />
            <path d="M4 4a16 16 0 0 1 16 16" />
            <circle cx="5" cy="19" r="1" />
          </svg>
        }
        actions={
          <>
            <DensityToggle density={density} onChange={setDensity} />
          <DensityToggle density={density} onChange={setDensity} />
          {unreadCount < articles.length && articles.length > 0 && (
            <button
              type="button"
              className="news-settings-btn"
              onClick={markAllRead}
              title="Mark all as read"
              aria-label="Mark all as read"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Mark read
            </button>
          )}
          <button
            type="button"
            className="news-settings-btn"
            onClick={handleExportOpml}
            title="Export feeds as OPML"
            aria-label="Export feeds as OPML"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export
          </button>
          <button
            type="button"
            className="news-settings-btn"
            onClick={() => opmlInput?.click()}
            title="Import feeds from OPML"
            aria-label="Import feeds from OPML"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Import
          </button>
          <input
            ref={(el) => setOpmlInput(el)}
            type="file"
            accept=".opml,application/xml,text/xml"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportOpml(file);
              e.target.value = "";
            }}
          />
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
          </>
        }
      />

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
                read={readLinks.has(article.link)}
                saved={savedArticles.some((s) => s.link === article.link)}
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
      <NewsArticlePreview
        article={selectedArticle}
        saved={selectedArticle ? savedArticles.some((s) => s.link === selectedArticle.link) : false}
        onClose={handleClosePreview}
        onToggleSave={handleToggleSave}
      />

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

      {opmlMessage && (
        <div className="news-opml-toast" role="status" onClick={() => setOpmlMessage(null)}>
          {opmlMessage}
        </div>
      )}
    </div>
  );
}
