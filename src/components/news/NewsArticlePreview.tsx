import { useEffect, useCallback } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { NewsArticle } from "../../hooks/useNewsFeeds";
import { formatArticleDate } from "../../hooks/useNewsFeeds";

interface NewsArticlePreviewProps {
  article: NewsArticle | null;
  onClose: () => void;
}

export default function NewsArticlePreview({ article, onClose }: NewsArticlePreviewProps) {
  // Close on Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!article) return;
    document.addEventListener("keydown", handleKeyDown);
    // Prevent body scroll while modal is open
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [article, handleKeyDown]);

  if (!article) return null;

  const handleOpenInBrowser = () => {
    openUrl(article.link).catch(() => {
      // Fallback for dev mode without Tauri runtime
      window.open(article.link, "_blank", "noopener,noreferrer");
    });
  };

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`Article: ${article.title}`}
    >
      <div className="modal news-preview-modal">
        {/* Header */}
        <div className="news-preview-header">
          <div className="news-preview-header-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
          </div>
          <div className="news-preview-header-text">
            <h2 className="news-preview-title">{article.title}</h2>
            <div className="news-preview-meta">
              <span className="news-preview-source">{article.sourceName}</span>
              {article.pubDate && (
                <>
                  <span className="news-preview-meta-dot" aria-hidden="true" />
                  <span>{formatArticleDate(article.pubDate)}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Body */}
        <div
          className="news-preview-body"
          dangerouslySetInnerHTML={{
            __html: sanitizeHtml(article.content || article.description),
          }}
        />

        {/* Footer */}
        <div className="news-preview-footer">
          <button
            type="button"
            className="edit-btn edit-btn-ghost"
            onClick={onClose}
          >
            Close
          </button>
          <button
            type="button"
            className="news-preview-open-btn"
            onClick={handleOpenInBrowser}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            Open in Browser
          </button>
        </div>
      </div>
    </div>
  );
}

/** Very basic HTML sanitization — strips scripts, event handlers, and dangerous tags. */
function sanitizeHtml(html: string): string {
  // Strip <script> tags and their content
  let cleaned = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");

  // Strip on* event handlers
  cleaned = cleaned.replace(/\son\w+="[^"]*"/gi, "");
  cleaned = cleaned.replace(/\son\w+='[^']*'/gi, "");

  // Strip <iframe> tags (could embed arbitrary content)
  cleaned = cleaned.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "");

  // Remove javascript: URLs
  cleaned = cleaned.replace(/href=["']javascript:[^"']*["']/gi, 'href="#"');

  return cleaned;
}
