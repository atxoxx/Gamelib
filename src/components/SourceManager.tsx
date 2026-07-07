// SourceManager — the user-facing UI for managing download sources.
// Renders inside SettingsPage's Integrations section (or a new
// "Download Sources" sub-section). Three visible blocks:
//
//   1. Header — title + "Refresh all" button
//   2. Add-source form — URL + optional name + Add button
//   3. Source list — one row per configured source with
//      enabled toggle, refresh, delete, and metadata
//
// Persistence is handled by the Rust source_manager module; this
// component is just the React shell that calls the Tauri commands
// and renders state from useSources().

import { useState, useCallback } from "react";
import { useSources } from "../context/SourceContext";
import { useToast } from "../context/ToastContext";
import type { SourceLink } from "../types/source";

/** Format a unix-seconds timestamp as a short relative string. */
function formatRelative(unixSeconds: number | null): string {
  if (unixSeconds == null) return "Never";
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  if (diff < 30 * 86400) return `${Math.round(diff / 86400)}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString();
}

export default function SourceManager() {
  const {
    sources,
    addSource,
    removeSource,
    toggleSource,
    refreshSource,
    refreshAllSources,
  } = useSources();
  const { showToast } = useToast();

  const [showAddForm, setShowAddForm] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newName, setNewName] = useState("");
  // `adding` is true while the Hydra API call is in flight.
  const [adding, setAdding] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  // Track which row is currently refreshing so we can show the
  // spinner only on that row (instead of on every row at once).
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(
    () => new Set(),
  );

  const handleAdd = useCallback(async () => {
    const url = newUrl.trim();
    if (!url) {
      showToast("Source URL is required", "error");
      return;
    }
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      showToast("Source URL must start with http:// or https://", "error");
      return;
    }
    // The Rust command POSTs the URL to the Hydra API
    // `/download-sources` endpoint, which fetches + parses the
    // source JSON and returns the full download data. We disable
    // the form while the API call is in flight.
    setAdding(true);
    try {
      await addSource(url, newName);
      setNewUrl("");
      setNewName("");
      setShowAddForm(false);
    } catch (err) {
      const msg = String(err);
      showToast(`Add source failed: ${msg}`, "error");
    } finally {
      setAdding(false);
    }
  }, [newUrl, newName, addSource, showToast]);

  const handleRefreshOne = useCallback(
    async (id: string) => {
      setRefreshingIds((prev) => new Set(prev).add(id));
      try {
        await refreshSource(id);
      } catch {
        // toast already shown by context
      } finally {
        setRefreshingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [refreshSource],
  );

  const handleRefreshAll = useCallback(async () => {
    if (refreshingAll) return;
    setRefreshingAll(true);
    try {
      await refreshAllSources();
    } catch {
      // toast already shown
    } finally {
      setRefreshingAll(false);
    }
  }, [refreshingAll, refreshAllSources]);

  const handleRemove = useCallback(
    async (source: SourceLink) => {
      const confirmed = window.confirm(
        `Remove source "${source.name}"?\n\nThe source list entry will be deleted. Cached downloads for this source are not affected.`,
      );
      if (!confirmed) return;
      try {
        await removeSource(source.id);
        showToast(`Removed source "${source.name}"`, "info");
      } catch (err) {
        showToast(`Remove failed: ${err}`, "error");
        // Re-throw so the caller (e.g. an optimistic-UI layer) can
        // roll back if needed. The current caller ignores it but a
        // future caller may want to react.
        throw err;
      }
    },
    [removeSource, showToast],
  );

  const hasSources = sources.length > 0;
  const enabledCount = sources.filter((s) => s.enabled).length;

  return (
    <div className="src-manager">
      {/* ── Header row ───────────────────────────────────────────── */}
      <div className="src-manager-header">
        <div className="src-manager-header-text">
          <h3 className="src-manager-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            Download Sources
          </h3>
          <p className="src-manager-desc">
            Add JSON-formatted source URLs to find download mirrors for your games.
            The built-in format is <code>{`{ name, downloads: [{ title, fileSize, uris }] }`}</code> — Hydra-compatible sources work out of the box.
            Adding a source registers it with the Hydra API, which fetches
            and validates the source JSON on your behalf.
          </p>
        </div>
        <div className="src-manager-bulk">
          {hasSources && (
            <button
              type="button"
              className="settings-btn"
              onClick={handleRefreshAll}
              disabled={refreshingAll || enabledCount === 0}
              title="Re-fetch every enabled source"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={refreshingAll ? "src-action-btn spinning" : ""}
              >
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              {refreshingAll ? "Refreshing…" : "Refresh All"}
            </button>
          )}
          <button
            type="button"
            className="settings-btn settings-btn-primary"
            onClick={() => setShowAddForm((s) => !s)}
          >
            {showAddForm ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
                Cancel
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add Source
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Add-source form ─────────────────────────────────────── */}
      {showAddForm && (
        <form
          className="src-form"
          onSubmit={(e) => {
            e.preventDefault();
            void handleAdd();
          }}
        >
          <div className="src-form-row">
            <input
              className="src-form-input"
              type="url"
              placeholder="https://example.com/sources/my-source.json"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              autoFocus
              required
              aria-label="Source URL"
            />
            <input
              className="src-form-input"
              type="text"
              placeholder="Display name (optional)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={{ maxWidth: "200px" }}
              aria-label="Source name"
            />
          </div>
          <p className="src-form-hint">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span>
              Clicking <strong>Add Source</strong> registers the URL
              with the Hydra API, which fetches and parses the source
              JSON. The downloads list is cached locally for offline use.
            </span>
          </p>
          <div className="src-form-actions">
            <button
              type="button"
              className="settings-btn"
              onClick={() => {
                setShowAddForm(false);
                setNewUrl("");
                setNewName("");
              }}
              disabled={adding}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="settings-btn settings-btn-primary"
              disabled={!newUrl.trim() || adding}
            >
              {adding ? (
                <>
                  <span className="src-action-btn spinning" aria-hidden />
                  Adding Source…
                </>
              ) : (
                <>Add Source</>
              )}
            </button>
          </div>
        </form>
      )}

      {/* ── Source list ─────────────────────────────────────────── */}
      {hasSources ? (
        <div className="src-list">
          {sources.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              isRefreshing={refreshingIds.has(source.id)}
              onToggle={() => void toggleSource(source.id)}
              onRefresh={() => void handleRefreshOne(source.id)}
              onRemove={() => void handleRemove(source)}
            />
          ))}
        </div>
      ) : (
        <div className="src-empty">
          <svg
            className="src-empty-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          <p className="src-empty-title">No sources yet</p>
          <p className="src-empty-hint">
            Click <strong>Add Source</strong> to paste a JSON source URL. The built-in
            schema is{" "}
            <code>{`{ name, downloads: [{ title, fileSize, uris }] }`}</code>; any
            Hydra-compatible source should work. The URL is registered
            with the Hydra API, which fetches and validates the source JSON.
          </p>
        </div>
      )}

    </div>
  );
}

function SourceRow({
  source,
  isRefreshing,
  onToggle,
  onRefresh,
  onRemove,
}: {
  source: SourceLink;
  isRefreshing: boolean;
  onToggle: () => void;
  onRefresh: () => void;
  onRemove: () => void;
}) {
  return (
    <div className={`src-item${source.enabled ? "" : " disabled"}${isRefreshing ? " refreshing" : ""}`}>
      <div className="src-item-info">
        <div className="src-item-header">
          <span className="src-item-name">{source.name}</span>
          <span className={`src-item-status ${source.enabled ? "enabled" : "disabled"}`}>
            {source.enabled ? "Enabled" : "Disabled"}
          </span>
        </div>
        <div className="src-item-url">
          <a href={source.url} target="_blank" rel="noopener noreferrer">
            {source.url}
          </a>
        </div>
        <div className="src-item-meta">
          <span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {formatRelative(source.lastFetched)}
          </span>
          <span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            {source.gameCount.toLocaleString()} game{source.gameCount === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      <div className="src-item-controls">
        <label className="src-toggle" title={source.enabled ? "Disable source" : "Enable source"}>
          <input
            type="checkbox"
            checked={source.enabled}
            onChange={onToggle}
            aria-label={`Toggle ${source.name}`}
          />
          <span className="src-toggle-slider" />
        </label>
        <button
          type="button"
          className={`src-action-btn${isRefreshing ? " spinning" : ""}`}
          onClick={onRefresh}
          disabled={isRefreshing}
          title="Re-fetch this source"
          aria-label={`Refresh ${source.name}`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
        <button
          type="button"
          className="src-action-btn danger"
          onClick={onRemove}
          disabled={isRefreshing}
          title="Remove source"
          aria-label={`Remove ${source.name}`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
