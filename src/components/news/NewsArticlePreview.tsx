import { useEffect, useCallback, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize, LogicalPosition } from "@tauri-apps/api/dpi";
import type { NewsArticle } from "../../hooks/useNewsFeeds";
import { formatArticleDate } from "../../hooks/useNewsFeeds";

interface NewsArticlePreviewProps {
  article: NewsArticle | null;
  onClose: () => void;
}

export default function NewsArticlePreview({ article, onClose }: NewsArticlePreviewProps) {
  const placeholderRef = useRef<HTMLDivElement>(null);
  const [webviewReady, setWebviewReady] = useState(false);
  const [webviewError, setWebviewError] = useState(false);
  const webviewInstRef = useRef<Webview | null>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  // ── Webview lifecycle ──────────────────────────────────────────────

  useEffect(() => {
    if (!article) return;

    let active = true;
    setWebviewReady(false);
    setWebviewError(false);

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    // Wait for the modal layout to paint, then create the webview
    const raf = requestAnimationFrame(async () => {
      if (!active || !placeholderRef.current) return;

      // Close any existing preview webviews first
      try {
        const allWebviews = await Webview.getAll();
        for (const wv of allWebviews) {
          if (wv.label.startsWith("news-preview-")) {
            await wv.close();
          }
        }
      } catch { /* ignore */ }

      if (!active || !placeholderRef.current) return;

      const rect = placeholderRef.current.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const uniqueLabel = "news-preview-" + Math.random().toString(36).substring(2, 9);

      try {
        const appWindow = getCurrentWindow();
        const webview = new Webview(appWindow, uniqueLabel, {
          url: article.link,
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        });

        if (!active) {
          webview.close().catch(() => {});
          return;
        }

        webviewInstRef.current = webview;
        setWebviewReady(true);

        webview.once("tauri://error", (e) => {
          console.error("[News] Webview error:", e);
          if (active) setWebviewError(true);
        });
      } catch (err) {
        console.error("[News] Failed to create webview:", err);
        if (active) setWebviewError(true);
      }
    });

    return () => {
      active = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";

      const wv = webviewInstRef.current;
      webviewInstRef.current = null;
      if (wv) {
        wv.close().catch(() => {});
      } else {
        // Cleanup any orphaned webviews
        Webview.getAll().then((all) => {
          for (const w of all) {
            if (w.label.startsWith("news-preview-")) {
              w.close().catch(() => {});
            }
          }
        }).catch(() => {});
      }
    };
  }, [article, handleKeyDown]);

  // ── Geometry sync (resize + scroll tracking) ────────────────────────

  useEffect(() => {
    if (!placeholderRef.current || !webviewInstRef.current) return;

    const syncGeometry = () => {
      const el = placeholderRef.current;
      const wv = webviewInstRef.current;
      if (!el || !wv) return;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      wv.setPosition(new LogicalPosition(rect.left, rect.top))
        .catch(() => {});
      wv.setSize(new LogicalSize(rect.width, rect.height))
        .catch(() => {});
    };

    syncGeometry();

    const observer = new ResizeObserver(() => syncGeometry());
    observer.observe(placeholderRef.current);
    window.addEventListener("resize", syncGeometry);
    window.addEventListener("scroll", syncGeometry, true);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncGeometry);
      window.removeEventListener("scroll", syncGeometry, true);
    };
  }, [webviewReady]);

  // ── Render ─────────────────────────────────────────────────────────

  if (!article) return null;

  const handleOpenInBrowser = () => {
    openUrl(article.link).catch(() => {
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

        {/* Body — article content */}
        <div
          className="news-preview-body"
          dangerouslySetInnerHTML={{
            __html: sanitizeHtml(article.content || article.description),
          }}
        />

        {/* Native Webview placeholder — the child webview is layered
            over this div. Kept as visible fallback if webview fails. */}
        <div className="news-preview-webview">
          <div className="news-preview-webview-bar">
            <span className="news-preview-webview-url" title={article.link}>
              {article.link}
            </span>
          </div>
          <div
            ref={placeholderRef}
            className={
              "news-preview-webview-placeholder" +
              (webviewError ? " news-preview-webview-error" : "")
            }
          >
            {!webviewReady && !webviewError && (
              <div className="news-preview-webview-spinner" />
            )}
          </div>
        </div>

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

function sanitizeHtml(html: string): string {
  let cleaned = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  cleaned = cleaned.replace(/\son\w+="[^"]*"/gi, "");
  cleaned = cleaned.replace(/\son\w+='[^']*'/gi, "");
  cleaned = cleaned.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "");
  cleaned = cleaned.replace(/href=["']javascript:[^"']*["']/gi, 'href="#"');
  return cleaned;
}
