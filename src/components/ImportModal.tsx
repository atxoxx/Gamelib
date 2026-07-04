import { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { gameNameFromPath } from "../types/game";
import type { GameMetadataResult, StoreGameSummary } from "../types/game";

export interface ExeInfo {
  path: string;
  size: number;
  modifiedAt: number;
}

interface ImportModalProps {
  exeInfos: ExeInfo[];
  onConfirm: (imports: { path: string; metadata: GameMetadataResult | null }[]) => void;
  onCancel: () => void;
}

export default function ImportModal({
  exeInfos,
  onConfirm,
  onCancel,
}: ImportModalProps) {
  // Selection state (which files to actually import)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  // Active executable index for detail panel
  const [activeIndex, setActiveIndex] = useState<number>(0);

  // Search query strings per executable path
  const [searchQueries, setSearchQueries] = useState<Record<string, string>>({});

  // Matched IGDB game summaries per executable path
  const [matches, setMatches] = useState<Record<string, StoreGameSummary | null>>({});

  // Cached IGDB full metadata details per game slug (for previews & import)
  const [previews, setPreviews] = useState<Record<string, GameMetadataResult>>({});

  // Cached IGDB suggestions lists per query string
  const [suggestions, setSuggestions] = useState<Record<string, StoreGameSummary[]>>({});

  // Loading states
  const [loadingSuggestions, setLoadingSuggestions] = useState<boolean>(false);
  const [loadingPreview, setLoadingPreview] = useState<boolean>(false);
  const [importing, setImporting] = useState<boolean>(false);
  const [importProgress, setImportProgress] = useState<string>("");

  const activePath = useMemo(() => exeInfos[activeIndex]?.path || "", [exeInfos, activeIndex]);
  const activeQuery = searchQueries[activePath] || "";

  // Initialize queries and automatically check all scanned executables
  useEffect(() => {
    if (exeInfos.length > 0) {
      const initialQueries: Record<string, string> = {};
      const paths = new Set<string>();
      exeInfos.forEach((info) => {
        initialQueries[info.path] = gameNameFromPath(info.path);
        paths.add(info.path);
      });
      setSearchQueries(initialQueries);
      setSelectedPaths(paths);
      setActiveIndex(0);
    }
  }, [exeInfos]);

  // Debounced search logic for suggestions
  useEffect(() => {
    if (!activeQuery.trim()) {
      return;
    }

    // If suggestions are already cached for this query, don't refetch
    if (suggestions[activeQuery]) {
      return;
    }

    const timer = setTimeout(async () => {
      setLoadingSuggestions(true);
      try {
        const results = await invoke<StoreGameSummary[]>("search_store_games", {
          query: activeQuery,
          offset: 0,
          limit: 8,
        });
        setSuggestions((prev) => ({ ...prev, [activeQuery]: results }));
      } catch (err) {
        console.error("IGDB suggestions search failed:", err);
      } finally {
        setLoadingSuggestions(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [activeQuery, suggestions]);

  // Handle query input change
  function handleQueryChange(val: string) {
    setSearchQueries((prev) => ({ ...prev, [activePath]: val }));
  }

  // Get suggestions for the active item
  const activeSuggestions = suggestions[activeQuery] || [];

  // When active item changes, trigger an immediate search if it hasn't been searched yet
  useEffect(() => {
    if (activePath && activeQuery && !suggestions[activeQuery] && !loadingSuggestions) {
      setLoadingSuggestions(true);
      invoke<StoreGameSummary[]>("search_store_games", {
        query: activeQuery,
        offset: 0,
        limit: 8,
      })
        .then((results) => {
          setSuggestions((prev) => ({ ...prev, [activeQuery]: results }));
        })
        .catch((err) => console.error("Immediate suggestions search failed:", err))
        .finally(() => setLoadingSuggestions(false));
    }
  }, [activePath]);

  // Link a suggestion to the active executable and fetch details
  async function handleLinkGame(game: StoreGameSummary) {
    setMatches((prev) => ({ ...prev, [activePath]: game }));

    // Fetch full details if not already loaded
    if (previews[game.slug]) {
      return;
    }

    setLoadingPreview(true);
    try {
      const detail = await invoke<GameMetadataResult | null>("get_store_game_detail", {
        slug: game.slug,
      });
      if (detail) {
        setPreviews((prev) => ({ ...prev, [game.slug]: detail }));
      }
    } catch (err) {
      console.error("Failed to fetch game details:", err);
    } finally {
      setLoadingPreview(false);
    }
  }

  // Remove the IGDB link for the active executable
  function handleUnlinkGame() {
    setMatches((prev) => ({ ...prev, [activePath]: null }));
  }

  // Selection toggle handlers
  function toggleSelectPath(path: string) {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  const allSelected = selectedPaths.size === exeInfos.length;
  const someSelected = selectedPaths.size > 0 && selectedPaths.size < exeInfos.length;

  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(exeInfos.map((e) => e.path)));
    }
  }

  // Confirm import and download metadata/images
  async function handleConfirm() {
    if (selectedPaths.size === 0) return;
    setImporting(true);

    const importResults: { path: string; metadata: GameMetadataResult | null }[] = [];
    const pathsArray = Array.from(selectedPaths);

    try {
      for (let i = 0; i < pathsArray.length; i++) {
        const path = pathsArray[i];
        const match = matches[path];
        const fileName = gameNameFromPath(path);

        if (match) {
          setImportProgress(
            `Fetching metadata for "${match.name}" (${i + 1} of ${pathsArray.length})...`
          );

          let details = previews[match.slug];
          if (!details) {
            // Fallback fetch if details weren't loaded yet
            try {
              const fetched = await invoke<GameMetadataResult | null>("get_store_game_detail", {
                slug: match.slug,
              });
              if (fetched) {
                details = fetched;
              }
            } catch (err) {
              console.error(`Failed to fetch details for ${match.slug}:`, err);
            }
          }

          importResults.push({ path, metadata: details || null });
        } else {
          setImportProgress(
            `Processing "${fileName}" (${i + 1} of ${pathsArray.length})...`
          );
          importResults.push({ path, metadata: null });
        }
      }

      onConfirm(importResults);
    } catch (err) {
      console.error("Import failed:", err);
    } finally {
      setImporting(false);
    }
  }

  // Format utility functions
  function getDirectory(fullPath: string): string {
    const parts = fullPath.split(/[\\/]/);
    parts.pop();
    return parts.join("\\");
  }

  const activeMatch = matches[activePath] || null;
  const activeDetail = activeMatch ? previews[activeMatch.slug] : null;

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        className={`modal import-modal${exeInfos.length > 1 ? " batch-import-layout" : ""}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {importing && (
          <div className="import-progress-overlay">
            <div className="import-progress-card">
              <div className="import-spinner" />
              <h3>Importing Games</h3>
              <p className="import-progress-status">{importProgress}</p>
            </div>
          </div>
        )}

        <div className="modal-header">
          <div className="modal-header-icon">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <div className="modal-header-text">
            <h2 className="modal-title">
              {exeInfos.length > 1 ? "Scan & Link Games to Import" : "Import Game Executable"}
            </h2>
            <p className="modal-subtitle">
              {exeInfos.length > 1
                ? `Found ${exeInfos.length} executables. Link them with IGDB for rich metadata.`
                : "Select a game from IGDB to link with your local executable."}
            </p>
          </div>
        </div>

        <div className="modal-body-container">
          {/* Side panel with executables list (only for batch folder imports) */}
          {exeInfos.length > 1 && (
            <div className="import-sidebar">
              <div className="import-sidebar-header">
                <label className="modal-select-all">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={selectAllRef}
                    onChange={toggleSelectAll}
                  />
                  <span>
                    Select All ({selectedPaths.size}/{exeInfos.length})
                  </span>
                </label>
              </div>
              <div className="import-sidebar-list">
                {exeInfos.map((exe, index) => {
                  const isChecked = selectedPaths.has(exe.path);
                  const isActive = index === activeIndex;
                  const match = matches[exe.path];

                  return (
                    <div
                      key={exe.path}
                      className={`import-sidebar-item${isActive ? " active" : ""}${
                        isChecked ? " checked" : ""
                      }`}
                      onClick={() => setActiveIndex(index)}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleSelectPath(exe.path);
                        }}
                      />
                      <div className="import-sidebar-item-info">
                        <span className="import-sidebar-item-filename">
                          {gameNameFromPath(exe.path)}
                        </span>
                        {match ? (
                          <span className="import-sidebar-item-match matched">
                            ✓ Linked: {match.name}
                          </span>
                        ) : (
                          <span className="import-sidebar-item-match skipped">
                            ⚠ No Metadata Match
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Main workspace: matching interface */}
          <div className="import-workspace">
            {activePath ? (
              <div className="import-matching-area">
                {/* Path info header */}
                <div className="import-active-file-info">
                  <div className="file-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="12 2 2 7 12 12 22 7 12 2" />
                      <polyline points="2 17 12 22 22 17" />
                      <polyline points="2 12 12 17 22 12" />
                    </svg>
                  </div>
                  <div className="file-details">
                    <span className="file-label">Executable File</span>
                    <span className="file-name">{gameNameFromPath(activePath)}</span>
                    <span className="file-path" title={activePath}>
                      {getDirectory(activePath)}
                    </span>
                  </div>
                </div>

                {/* IGDB search and recommendations */}
                <div className="import-search-row">
                  <div className="search-input-wrapper">
                    <svg
                      className="search-icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input
                      type="text"
                      className="import-search-input"
                      placeholder="Search game on IGDB..."
                      value={activeQuery}
                      onChange={(e) => handleQueryChange(e.target.value)}
                    />
                    {activeQuery && (
                      <button className="clear-btn" onClick={() => handleQueryChange("")}>
                        ✖
                      </button>
                    )}
                  </div>
                </div>

                {/* Suggestions and Preview split */}
                <div className="import-matching-columns">
                  {/* Left: Suggestions list */}
                  <div className="import-suggestions-panel">
                    <h4 className="section-title">IGDB Suggestions</h4>
                    {loadingSuggestions ? (
                      <div className="suggestions-loader">
                        <div className="spinner-small" />
                        <span>Searching IGDB...</span>
                      </div>
                    ) : activeSuggestions.length > 0 ? (
                      <div className="suggestions-list">
                        {activeSuggestions.map((game) => {
                          const isLinked = activeMatch?.id === game.id;
                          const releaseYear = game.firstReleaseDate
                            ? new Date(game.firstReleaseDate).getFullYear()
                            : null;

                          return (
                            <button
                              key={game.id}
                              className={`suggestion-item${isLinked ? " linked" : ""}`}
                              onClick={() => handleLinkGame(game)}
                            >
                              <div className="suggestion-cover">
                                {game.coverUrl ? (
                                  <img src={game.coverUrl} alt={game.name} />
                                ) : (
                                  <div className="suggestion-cover-placeholder">?</div>
                                )}
                              </div>
                              <div className="suggestion-info">
                                <span className="suggestion-name">{game.name}</span>
                                <span className="suggestion-meta">
                                  {releaseYear ? `${releaseYear}` : "Unknown Year"}
                                  {game.platforms.length > 0 && ` · ${game.platforms[0]}`}
                                </span>
                              </div>
                              {isLinked && <span className="linked-badge">Linked</span>}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="suggestions-empty">
                        <p>No suggestions found.</p>
                        <p className="subtext">Try refining your search terms.</p>
                      </div>
                    )}
                  </div>

                  {/* Right: Detailed Preview */}
                  <div className="import-preview-panel">
                    <h4 className="section-title">Match Preview</h4>
                    {loadingPreview ? (
                      <div className="preview-skeleton-loader">
                        <div className="skeleton-hero" />
                        <div className="skeleton-content">
                          <div className="skeleton-line title" />
                          <div className="skeleton-line text" />
                          <div className="skeleton-line text" />
                          <div className="skeleton-line text" />
                        </div>
                      </div>
                    ) : activeMatch ? (
                      <div className="game-preview-card">
                        {activeDetail ? (
                          <>
                            {activeDetail.images.hero && (
                              <div
                                className="preview-hero-banner"
                                style={{ backgroundImage: `url(${activeDetail.images.hero})` }}
                              />
                            )}
                            <div className="preview-main-info">
                              <div className="preview-cover">
                                {activeDetail.images.cover ? (
                                  <img
                                    src={activeDetail.images.cover}
                                    alt={activeDetail.title}
                                  />
                                ) : (
                                  <div className="preview-cover-placeholder">?</div>
                                )}
                              </div>
                              <div className="preview-metadata">
                                <h3 className="preview-title">{activeDetail.title}</h3>
                                <div className="preview-meta-row">
                                  {activeDetail.releaseDate && (
                                    <span className="meta-badge">
                                      {new Date(activeDetail.releaseDate).getFullYear()}
                                    </span>
                                  )}
                                  {activeDetail.igdbRating && (
                                    <span className="meta-badge rating">
                                      ★ {Math.round(activeDetail.igdbRating)}%
                                    </span>
                                  )}
                                </div>
                                <p className="preview-meta-label">
                                  <strong>Developer:</strong> {activeDetail.developer || "Unknown"}
                                </p>
                                <p className="preview-meta-label">
                                  <strong>Publisher:</strong> {activeDetail.publisher || "Unknown"}
                                </p>
                                <div className="preview-genres">
                                  {activeDetail.genres.slice(0, 3).map((g) => (
                                    <span key={g} className="genre-tag">
                                      {g}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </div>
                            <div className="preview-summary-scroll">
                              {activeDetail.description && (
                                <div className="preview-summary">
                                  <p>{activeDetail.description}</p>
                                </div>
                              )}
                              {activeDetail.storyline && (
                                <div className="preview-storyline">
                                  <h5>Storyline</h5>
                                  <p>{activeDetail.storyline}</p>
                                </div>
                              )}
                            </div>
                            <button
                              className="preview-unlink-btn"
                              onClick={handleUnlinkGame}
                            >
                              Skip Metadata Match (Use Local Name Only)
                            </button>
                          </>
                        ) : (
                          // Fallback to summary fields if full details haven't finished loading yet
                          <>
                            <div className="preview-main-info">
                              <div className="preview-cover">
                                {activeMatch.coverUrl ? (
                                  <img src={activeMatch.coverUrl} alt={activeMatch.name} />
                                ) : (
                                  <div className="preview-cover-placeholder">?</div>
                                )}
                              </div>
                              <div className="preview-metadata">
                                <h3 className="preview-title">{activeMatch.name}</h3>
                                <div className="preview-meta-row">
                                  {activeMatch.firstReleaseDate && (
                                    <span className="meta-badge">
                                      {new Date(activeMatch.firstReleaseDate).getFullYear()}
                                    </span>
                                  )}
                                  {activeMatch.rating && (
                                    <span className="meta-badge rating">
                                      ★ {Math.round(activeMatch.rating)}%
                                    </span>
                                  )}
                                </div>
                                <div className="preview-genres">
                                  {activeMatch.genres.slice(0, 3).map((g) => (
                                    <span key={g} className="genre-tag">
                                      {g}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </div>
                            {activeMatch.summary && (
                              <div className="preview-summary-scroll">
                                <div className="preview-summary">
                                  <p>{activeMatch.summary}</p>
                                </div>
                              </div>
                            )}
                            <button
                              className="preview-unlink-btn"
                              onClick={handleUnlinkGame}
                            >
                              Skip Metadata Match
                            </button>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="preview-empty">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                          <rect x="2" y="2" width="20" height="20" rx="2.5" />
                          <circle cx="12" cy="12" r="4" />
                          <line x1="12" y1="8" x2="12" y2="16" />
                          <line x1="8" y1="12" x2="16" y2="12" />
                        </svg>
                        <p>No Game Linked</p>
                        <p className="subtext">
                          This game will be imported with name:{" "}
                          <strong>{gameNameFromPath(activePath)}</strong> and no additional metadata or
                          cover art.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="import-workspace-empty">
                <p>Select an executable file from the list to start matching.</p>
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <span className="modal-footer-count">
            {selectedPaths.size} file{selectedPaths.size !== 1 ? "s" : ""} selected for import
          </span>
          <div className="modal-footer-actions">
            <button className="modal-btn modal-btn-cancel" onClick={onCancel}>
              Cancel
            </button>
            <button
              className="modal-btn modal-btn-confirm"
              disabled={selectedPaths.size === 0}
              onClick={handleConfirm}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Import Selected
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
