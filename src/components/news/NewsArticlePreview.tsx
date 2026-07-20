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
  saved?: boolean;
  onToggleSave?: (article: NewsArticle) => void;
}

export default function NewsArticlePreview({
  article,
  onClose,
  saved = false,
  onToggleSave,
}: NewsArticlePreviewProps) {
  const placeholderRef = useRef<HTMLDivElement>(null);
  const [webviewReady, setWebviewReady] = useState(false);
  const [webviewError, setWebviewError] = useState(false);
  const webviewInstRef = useRef<Webview | null>(null);
  const [shareCopied, setShareCopied] = useState(false);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  // Share via the OS share sheet when available, otherwise copy the link (#28)
  const handleShare = useCallback(async () => {
    if (!article) return;
    const shareData = { title: article.title, text: article.title, url: article.link };
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share(shareData);
        return;
      }
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(article.link);
        setWebviewError(false);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2000);
      }
    } catch {
      /* user cancelled share — ignore */
    }
  }, [article]);

  // ── Webview lifecycle ──────────────────────────────────────────────
  // The native child webview is a progressive enhancement layered over the
  // already-rendered sanitized article body. Any failure (missing Tauri, ACL
  // rejection, unsupported renderer) must degrade gracefully WITHOUT throwing,
  // since an uncaught rejection here surfaces as a React "failing component".

  useEffect(() => {
    if (!article) return;

    let active = true;
    setWebviewReady(false);
    setWebviewError(false);

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    // Wait for the modal layout to paint, then attempt the webview.
    const raf = requestAnimationFrame(() => {
      void (async () => {
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
          // Non-fatal: the sanitized article body is already shown above.
          console.warn("[News] Native webview unavailable, using inline reader:", err);
          if (active) setWebviewError(true);
        }
      })().catch((err) => {
        // Failsafe: never let the async lifecycle crash the component.
        console.warn("[News] Webview lifecycle failed gracefully:", err);
        if (active) setWebviewError(true);
      });
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
          <div className="news-preview-footer-actions">
            {onToggleSave && (
              <button
                type="button"
                className={`news-preview-action-btn${saved ? " is-saved" : ""}`}
                onClick={() => onToggleSave(article)}
                title={saved ? "Remove bookmark" : "Save for later"}
                aria-label={saved ? "Remove bookmark" : "Save for later"}
              >
                <svg viewBox="0 0 24 24" fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                </svg>
                {saved ? "Saved" : "Save"}
              </button>
            )}
            <button
              type="button"
              className="news-preview-action-btn"
              onClick={handleShare}
              title="Share article"
              aria-label="Share article"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
              {shareCopied ? "Copied!" : "Share"}
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
