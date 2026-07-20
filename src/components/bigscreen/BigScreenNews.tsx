import { useState, useMemo, useCallback } from "react";
import { useNewsFeeds, formatArticleDate, type NewsArticle } from "../../hooks/useNewsFeeds";
import { useFocusable } from "../../hooks/useFocusable";
import { openUrl } from "@tauri-apps/plugin-opener";
import BigScreenPill from "./BigScreenPill";

export default function BigScreenNews() {
  const {
    articles,
    loading,
    error,
    activeSource,
    sourceNames,
    setSourceFilter,
    refresh,
  } = useNewsFeeds();

  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null);

  // Left Sidebar Sources
  const allSources = useMemo(() => ["All Sources", ...sourceNames], [sourceNames]);

  return (
    <div className="bigscreen-system-hub">
      {/* Left Menu Pane - Filter by Source */}
      <div className="bigscreen-system-left-pane">
        <h2 className="bigscreen-system-title">News Feeds</h2>
        <div className="bigscreen-system-menu" role="tablist">
          {allSources.map((src) => {
            const isAll = src === "All Sources";
            const isActive = isAll ? activeSource === null : activeSource === src;
            const selectSource = () => setSourceFilter(isAll ? null : src);
            const focusProps = useFocusable(selectSource);

            return (
              <button
                type="button"
                key={src}
                aria-selected={isActive}
                className={`bigscreen-system-menu-item ${isActive ? "active" : ""}`}
                {...focusProps}
              >
                <span className="menu-item-icon">📰</span>
                <span className="menu-item-label">{src}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right Content Pane - Articles Grid */}
      <div className="bigscreen-system-right-pane" style={{ padding: "0" }}>
        <div className="bigscreen-system-section-view" style={{ height: "100%", overflowY: "auto", padding: "30px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
            <h3 style={{ margin: 0 }}>Latest Articles</h3>
            <button
              type="button"
              className="bigscreen-details-btn bigscreen-details-btn--secondary"
              {...useFocusable(refresh)}
              style={{ padding: "6px 12px", fontSize: "12px" }}
            >
              🔄 Refresh
            </button>
          </div>

          {loading ? (
            <div className="store-tab-loading">
              <div className="store-spinner" />
              <span>Loading news articles...</span>
            </div>
          ) : error && articles.length === 0 ? (
            <div className="system-view-empty">
              <p>Couldn't load news feeds: {error}</p>
            </div>
          ) : articles.length === 0 ? (
            <div className="system-view-empty">
              <p>No news articles found from this source.</p>
            </div>
          ) : (
            <div className="bigscreen-library-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "20px" }}>
              {articles.map((article, index) => (
                <NewsArticleCard
                  key={`${article.link}-${index}`}
                  article={article}
                  onSelect={() => setSelectedArticle(article)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Fullscreen Article Reader Modal */}
      {selectedArticle && (
        <BigScreenNewsReader article={selectedArticle} onClose={() => setSelectedArticle(null)} />
      )}
    </div>
  );
}

// ─── News Card Component ─────────────────────────────────────────────

function NewsArticleCard({
  article,
  onSelect,
}: {
  article: NewsArticle;
  onSelect: () => void;
}) {
  const focusProps = useFocusable(onSelect);

  return (
    <div
      className="bigscreen-game-card"
      {...focusProps}
      style={{ display: "flex", flexDirection: "column", height: "300px" }}
    >
      <div className="bigscreen-game-card-cover" style={{ height: "150px" }}>
        {article.imageUrl ? (
          <img src={article.imageUrl} alt="" loading="lazy" style={{ objectFit: "cover", width: "100%", height: "100%" }} />
        ) : (
          <div className="bigscreen-game-card-cover-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="40" height="40">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
        )}
        <span className="bigscreen-game-card-running-dot" style={{ background: "var(--color-accent)", right: "8px", top: "8px", left: "auto" }} />
      </div>
      <div className="bigscreen-game-card-body" style={{ flex: 1, padding: "12px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <div>
          <h4
            className="bigscreen-game-card-name"
            style={{
              fontSize: "14px",
              lineHeight: "1.4",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              margin: 0,
              fontWeight: 600,
            }}
          >
            {article.title}
          </h4>
        </div>
        <div className="bigscreen-game-card-meta" style={{ marginTop: "8px", display: "flex", justifyContent: "space-between", fontSize: "11px" }}>
          <span className="bigscreen-game-card-platform" style={{ color: "var(--color-accent)", fontWeight: 600 }}>{article.sourceName}</span>
          {article.pubDate && (
            <span className="bigscreen-game-card-playtime">{formatArticleDate(article.pubDate)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── News Reader Modal Component ─────────────────────────────────────

function BigScreenNewsReader({
  article,
  onClose,
}: {
  article: NewsArticle;
  onClose: () => void;
}) {
  const handleOpenBrowser = useCallback(async () => {
    try {
      await openUrl(article.link);
    } catch {
      window.open(article.link, "_blank", "noopener,noreferrer");
    }
  }, [article.link]);

  const closeProps = useFocusable(onClose);
  const browserProps = useFocusable(handleOpenBrowser);

  return (
    <div className="bigscreen-overlay-drawer" style={{ display: "flex", justifyContent: "center", alignItems: "center", background: "rgba(10, 11, 16, 0.9)" }} onClick={onClose}>
      <div
        className="bigscreen-overlay-drawer-panel"
        style={{
          width: "80%",
          maxWidth: "800px",
          height: "80%",
          maxHeight: "650px",
          display: "flex",
          flexDirection: "column",
          borderRadius: "16px",
          border: "1px solid var(--color-border)",
          background: "var(--color-bg-primary)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Banner image or placeholder */}
        <div style={{ position: "relative", width: "100%", height: "220px", background: "var(--color-bg-tertiary)" }}>
          {article.imageUrl ? (
            <img src={article.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <div style={{ width: "100%", height: "100%", display: "flex", justifyContent: "center", alignItems: "center", opacity: 0.1 }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="80" height="80">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </div>
          )}
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "100px", background: "linear-gradient(to top, var(--color-bg-primary), transparent)" }} />
        </div>

        {/* Article Details */}
        <div style={{ flex: 1, padding: "24px 30px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <BigScreenPill tone="accent" size="sm">{article.sourceName}</BigScreenPill>
            {article.pubDate && (
              <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                {formatArticleDate(article.pubDate)}
              </span>
            )}
          </div>
          <h2 style={{ margin: "5px 0 10px 0", fontSize: "22px", lineHeight: "1.4", fontWeight: 700 }}>{article.title}</h2>
          <p style={{ fontSize: "14px", lineHeight: "1.6", color: "var(--color-text-secondary)", margin: 0, whiteSpace: "pre-wrap" }}>
            {article.description || "No preview text available. Use the button below to read the full article."}
          </p>
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: "20px 30px",
            borderTop: "1px solid var(--color-border)",
            display: "flex",
            justifyContent: "flex-end",
            gap: "12px",
            background: "var(--color-bg-secondary)",
          }}
        >
          <button
            type="button"
            className="bigscreen-details-btn bigscreen-details-btn--secondary"
            {...browserProps}
          >
            🌐 Open in Browser
          </button>
          <button
            type="button"
            className="bigscreen-details-btn bigscreen-details-btn--primary"
            {...closeProps}
          >
            ✕ Close
          </button>
        </div>
      </div>
    </div>
  );
}
