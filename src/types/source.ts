// TypeScript mirrors of the Rust DTOs in `src-tauri/src/source_manager.rs`.
// Field names are camelCase because the backend uses
// `#[serde(rename_all = "camelCase")]` on these structs.
//
// A "source" is a JSON file hosted on a third-party URL that lists
// available downloads for various games. The most common shape is
// the Hydra format — `{ name, downloads: [{ title, fileSize, uris }] }`.
// The frontend doesn't validate the JSON shape directly; that's
// done by the Rust deserializer. We just consume the parsed result.

/**
 * A single download entry inside a source. `fileSize` is intentionally
 * a string ("62.4 GB") because the source ecosystem doesn't agree on
 * a unit, and parsing each variant client-side is more brittle than
 * passing it through to the UI.
 *
 * `magnet` is the optional convenience field some sources populate
 * to spare clients from scanning the `uris` array. We treat it as
 * authoritative when present.
 */
export interface SourceDownload {
  title: string;
  fileSize: string;
  /** Magnet links, .torrent URLs, or both. */
  uris: string[];
  uploadDate?: string;
  magnet?: string;
}

/**
 * The full JSON payload of a source. Currently we only ever
 * see this on the Rust side; the frontend just gets per-match
 * `MatchedDownload` records. The type is exported anyway so
 * the file is self-documenting.
 */
export interface GameSource {
  name: string;
  downloads: SourceDownload[];
}

/**
 * User-facing metadata for a single source the user has added.
 * Persisted to `<app_data_dir>/sources.json`. The `lastFetched` /
 * `gameCount` fields are updated by the Rust side after every
 * successful fetch.
 */
export interface SourceLink {
  id: string;
  /** ID assigned by the Hydra API — used as the key for sync/refresh calls. */
  hydraSourceId: string;
  url: string;
  name: string;
  enabled: boolean;
  /** Unix seconds of the last successful fetch, or null. */
  lastFetched: number | null;
  /** Number of download entries in the most recent fetch. */
  gameCount: number;
}

/**
 * One cached source. Held in memory only (not persisted) so a
 * restart re-fetches and re-validates. The Rust side returns
 * this from `sources_search_game` filtered by match score.
 */
export interface CachedSource {
  sourceId: string;
  data: GameSource;
  /** Unix seconds of when this was fetched. */
  fetchedAt: number;
}

/**
 * A single search result returned by `sources_search_game`. The
 * frontend renders these directly in the DownloadModal.
 *
 * `matchScore` is 0.0-1.0. The Rust side already filters out
 * matches below 0.3, so anything we receive is worth showing.
 * The score is still useful for sorting and visual dimming.
 */
export interface MatchedDownload {
  sourceName: string;
  sourceId: string;
  title: string;
  fileSize: string;
  uris: string[];
  /** Resolved magnet URI (if the source provided one explicitly, or
   *  if we found a `magnet:` URI in the `uris` array). */
  magnet: string | null;
  uploadDate: string | null;
  matchScore: number;
  /**
   * True when the owning source was first fetched (added) within the
   * last 7 days. The DownloadModal renders a stylised "NEW" badge.
   */
  isNew: boolean;
}

/**
 * One URL that failed during a bulk add, with the reason.
 */
export interface BulkAddError {
  url: string;
  error: string;
}

/**
 * Aggregated result of `sources_add_bulk`. The frontend shows a
 * summary ("added N, skipped M, failed K") and lists any failures so
 * a single bad link doesn't abort the whole batch.
 */
export interface BulkAddResult {
  added: SourceLink[];
  skipped: string[];
  failed: BulkAddError[];
}
