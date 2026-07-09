import { useState, useCallback, useEffect } from "react";
import type { NewsFeed } from "../../hooks/useNewsFeeds";
import { DEFAULT_FEEDS } from "../../hooks/useNewsFeeds";

interface NewsFeedSettingsProps {
  allFeeds: NewsFeed[];
  enabledFeedUrls: Set<string>;
  customFeeds: NewsFeed[];
  onToggleFeed: (url: string) => void;
  onAddFeed: (name: string, url: string) => void;
  onRemoveFeed: (url: string) => void;
  onClose: () => void;
}

export default function NewsFeedSettings({
  allFeeds,
  enabledFeedUrls,
  customFeeds,
  onToggleFeed,
  onAddFeed,
  onRemoveFeed,
  onClose,
}: NewsFeedSettingsProps) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleKeyDown]);

  const handleAdd = () => {
    setAddError(null);

    const trimmedName = name.trim();
    let trimmedUrl = url.trim();

    if (!trimmedName || !trimmedUrl) {
      setAddError("Both name and URL are required.");
      return;
    }

    // Ensure URL has a protocol
    if (!/^https?:\/\//i.test(trimmedUrl)) {
      trimmedUrl = "https://" + trimmedUrl;
    }

    // Validate URL format
    try {
      new URL(trimmedUrl);
    } catch {
      setAddError("Please enter a valid URL.");
      return;
    }

    // Check for duplicates
    const allUrls = [
      ...DEFAULT_FEEDS.map((f) => f.url),
      ...customFeeds.map((f) => f.url),
    ];
    if (allUrls.some((u) => u.toLowerCase() === trimmedUrl.toLowerCase())) {
      setAddError("This feed URL is already added.");
      return;
    }

    onAddFeed(trimmedName, trimmedUrl);
    setName("");
    setUrl("");
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="News feed settings"
    >
      <div className="modal news-feed-settings-modal">
        {/* Header */}
        <div className="modal-header">
          <div className="modal-header-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </div>
          <div className="modal-header-text">
            <h2 className="modal-title">News Feed Settings</h2>
            <p className="modal-subtitle">
              Manage your RSS feed sources. Default feeds are always available.
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="news-feed-settings-body">
          {/* Default feeds */}
          <div className="news-feed-settings-section">
            <h3 className="news-feed-settings-section-title">
              Default Feeds
              <span style={{ fontWeight: 400, textTransform: "none", marginLeft: "auto", fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
                {allFeeds.filter((f) => f.isDefault && enabledFeedUrls.has(f.url)).length}/{DEFAULT_FEEDS.length} enabled
              </span>
            </h3>
            {DEFAULT_FEEDS.map((feed) => {
              const isEnabled = enabledFeedUrls.has(feed.url);
              return (
                <div key={feed.url} className="news-feed-default-item">
                  <div className="news-feed-default-icon">
                    {feed.name.charAt(0)}
                  </div>
                  <div className="news-feed-default-info">
                    <div className="news-feed-default-name">{feed.name}</div>
                    <div className="news-feed-default-url" title={feed.url}>
                      {feed.url}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`news-source-pill${isEnabled ? " active" : ""}`}
                    style={{ fontSize: "10px", padding: "2px 10px" }}
                    onClick={() => onToggleFeed(feed.url)}
                    title={isEnabled ? `Disable ${feed.name}` : `Enable ${feed.name}`}
                  >
                    {isEnabled ? "On" : "Off"}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Custom feeds */}
          <div className="news-feed-settings-section">
            <h3 className="news-feed-settings-section-title">
              Custom Feeds
              {customFeeds.length > 0 && ` (${customFeeds.length})`}
            </h3>
            {customFeeds.length === 0 ? (
              <p
                className="news-feed-error"
                style={{ color: "var(--color-text-muted)", marginTop: 0 }}
              >
                No custom feeds added yet. Add one below.
              </p>
            ) : (
              customFeeds.map((feed) => (
                <div key={feed.url} className="news-feed-custom-item">
                  <div className="news-feed-custom-info">
                    <div className="news-feed-custom-name">{feed.name}</div>
                    <div className="news-feed-custom-url" title={feed.url}>
                      {feed.url}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="news-feed-remove-btn"
                    title={`Remove ${feed.name}`}
                    aria-label={`Remove ${feed.name}`}
                    onClick={() => onRemoveFeed(feed.url)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Add feed form */}
          <div className="news-feed-settings-section">
            <h3 className="news-feed-settings-section-title">Add Custom Feed</h3>
            <div className="news-feed-add-form">
              <div className="news-feed-add-row">
                <input
                  type="text"
                  className="news-feed-input"
                  placeholder="Feed name (e.g., My Blog)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  maxLength={40}
                />
                <input
                  type="url"
                  className="news-feed-input"
                  placeholder="RSS Feed URL (e.g., https://example.com/feed)"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                />
              </div>
              {addError && <p className="news-feed-error">{addError}</p>}
              <button
                type="button"
                className="news-feed-add-btn"
                onClick={handleAdd}
                disabled={!name.trim() || !url.trim()}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add Feed
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <span className="modal-footer-count">
            {DEFAULT_FEEDS.length} default + {customFeeds.length} custom
          </span>
          <div className="modal-footer-actions">
            <button
              type="button"
              className="edit-btn edit-btn-secondary"
              onClick={onClose}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
