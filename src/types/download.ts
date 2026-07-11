// TypeScript mirrors of the Rust DTOs in `src-tauri/src/torrent_engine.rs`
// and `src-tauri/src/store_checker.rs`. Field names are camelCase because
// the backend uses `#[serde(rename_all = "camelCase")]` on its structs.
//
import type { SizeUnit } from "./game";

// Keep this file in sync with the Rust side — the frontend DTOs and the
// wire format must stay byte-for-byte compatible, or `invoke<DownloadStatus>`
// will fail to deserialize and every Tauri command will throw.
//
// ## DownloadStatus serialization
//
// The Rust `DownloadStatus` is defined as:
//
//     #[serde(rename_all = "camelCase", tag = "kind", content = "message")]
//     pub enum DownloadStatus {
//         Queued, FetchingMetadata, Downloading, Paused, Completed,
//         Error(String),
//     }
//
// `rename_all = "camelCase"` lower-cases the variant name's first letter
// (and joins multi-word variants into camelCase). `tag = "kind"` +
// `content = "message"` produces an **adjacently-tagged** representation:
//
//     Queued             → {"kind":"queued"}
//     FetchingMetadata   → {"kind":"fetchingMetadata"}
//     Downloading        → {"kind":"downloading"}
//     Paused             → {"kind":"paused"}
//     Completed          → {"kind":"completed"}
//     Error("...")       → {"kind":"error","message":"..."}
//
// Note the *all-lowercase* kind values — that's `rename_all = "camelCase"`
// doing its work on a single-word variant. Don't write `"Downloading"`
// in TS; the wire value is `"downloading"`.

/**
 * Status of a single torrent. Discriminated union on the `kind` field;
 * the helper functions below narrow the type-safely via `status.kind`.
 */
export type DownloadStatus =
  | { kind: "queued" }
  | { kind: "fetchingMetadata" }
  | { kind: "downloading" }
  | { kind: "paused" }
  | { kind: "completed" }
  | { kind: "error"; message: string };

/**
 * One torrent's full state. The Rust side hands us a copy of this
 * structure on every `torrent_get_all` call (and on each `download-progress`
 * event emitted by the background polling task).
 *
 * `progress` is `null` until the engine knows `totalSize` (i.e. metadata
 * has been fetched). Once known, it's a 0.0-1.0 fraction. The
 * frontend uses `null` to render an indeterminate progress bar.
 */
export interface TorrentFile {
  name: string;
  size: number;
  downloaded: number;
  progress: number;
  selected: boolean;
}

export interface TorrentDownload {
  id: string;
  name: string;
  /** The magnet URI or .torrent URL that was passed in. */
  sourceUri: string;
  /** Folder the engine is downloading into. */
  savePath: string;
  downloaded: number;
  totalSize: number | null;
  progress: number | null;
  /** Live download speed in bytes/sec. `0` while paused / errored. */
  downloadSpeed: number;
  /** Live upload speed in bytes/sec. `0` while paused / errored. */
  uploadSpeed: number;
  /**
   * Peers currently connected to us. Mirrors
   * `LiveStats.snapshot.peer_stats.live` on the Rust side.
   */
  peers: number;
  /**
   * Peers we know about but aren't currently connected to
   * (`seen - live`, saturating). Strict seed/leech distinction
   * would require per-peer iteration, which the backend avoids on
   * the 2 s poll path.
   */
  seeds: number;
  status: DownloadStatus;
  /** Optional GameContext id, set when the DownloadModal knows the game. */
  gameId: string | null;
  /** Display name of the source the URI came from. */
  sourceName: string;
  /** Unix seconds when the user added the download. */
  addedAt: number;
  files: TorrentFile[];
  autoExtract?: boolean;
  extracted?: boolean;
}

/**
 * Cross-store ownership result for a single game. Returned by
 * `check_ownership` and `check_ownership_for_ids` Tauri commands.
 *
 * The Rust side has `#[serde(rename_all = "camelCase")]` on both
 * `OwnershipResult` and `StoreOwnership` (verified), so camelCase
 * field names are correct here.
 */
export interface OwnershipResult {
  gameName: string;
  ownedStores: StoreOwnership[];
  isOwnedAnywhere: boolean;
}

export interface StoreOwnership {
  store: string;
  owned: boolean;
  storeGameId: string | null;
  details: string | null;
}

// ─── Display helpers ───────────────────────────────────────────────────────

/** Render a byte/sec value as a human speed string. */
export function formatBytesPerSecond(bytesPerSec: number, unit: SizeUnit = "gb"): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return "0 B/s";
  const isGib = unit === "gib";
  const divisor = isGib ? 1024 : 1000;
  const units = isGib
    ? ["B/s", "KiB/s", "MiB/s", "GiB/s"]
    : ["B/s", "KB/s", "MB/s", "GB/s"];
  let value = bytesPerSec;
  let unitIndex = 0;
  while (value >= divisor && unitIndex < units.length - 1) {
    value /= divisor;
    unitIndex++;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

/** Render a byte total as a short size string ("1.4 GB", "820 MB", "1.4 GiB", "820 MiB"). */
export function formatBytesShort(bytes: number, unit: SizeUnit = "gb"): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const isGib = unit === "gib";
  const divisor = isGib ? 1024 : 1000;
  const units = isGib
    ? ["B", "KiB", "MiB", "GiB", "TiB"]
    : ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= divisor && unitIndex < units.length - 1) {
    value /= divisor;
    unitIndex++;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

/**
 * Format a progress value (0.0-1.0) as a percentage. Returns a
 * placeholder when the value is null/undefined so the UI can
 * always render a label. The output is always a non-empty string
 * (the explicit `return` on the first branch guarantees that the
 * function's `string` return type is honored at compile time).
 */
export function formatProgress(progress: number | null | undefined): string {
  if (progress === null || progress === undefined) return "—";
  if (!Number.isFinite(progress)) return "—";
  const clamped = Math.max(0, Math.min(1, progress));
  return `${Math.round(clamped * 100)}%`;
}

/** Return true if the status indicates the download is still in flight or active (not completed). */
export function isActiveStatus(status: DownloadStatus): boolean {
  return status.kind !== "completed";
}

/** Return true if the status indicates the download finished. */
export function isCompletedStatus(status: DownloadStatus): boolean {
  return status.kind === "completed";
}

/** Return true if the status indicates an error. */
export function isErrorStatus(status: DownloadStatus): boolean {
  return status.kind === "error";
}

/** Pull the error message out of a `DownloadStatus`, or null if not an error. */
export function getStatusError(status: DownloadStatus): string | null {
  return status.kind === "error" ? status.message : null;
}

/**
 * Get a short human label for any status (used in chips, tooltips).
 * The exhaustive switch on `status.kind` makes the function total —
 * TypeScript verifies we handle every variant of the discriminated union.
 */
export function getStatusLabel(status: DownloadStatus): string {
  switch (status.kind) {
    case "queued":
      return "Queued";
    case "fetchingMetadata":
      return "Fetching metadata";
    case "downloading":
      return "Downloading";
    case "paused":
      return "Paused";
    case "completed":
      return "Completed";
    case "error":
      return "Error";
  }
}

/** Get a CSS class suffix for the status, suitable for BEM-style classes
 *  (e.g. `dl-progress-card-status--downloading`). */
export function getStatusClassSuffix(status: DownloadStatus): string {
  return status.kind;
}

/** Calculate and format the estimated time until finish (ETA). */
export function formatEta(downloaded: number, totalSize: number | null, speed: number): string {
  if (totalSize === null || speed <= 0) return "";
  const remaining = totalSize - downloaded;
  if (remaining <= 0) return "";
  const seconds = Math.ceil(remaining / speed);
  
  if (seconds < 60) {
    return `${seconds}s remaining`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s remaining`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return `${hours}h ${remainingMinutes}m remaining`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `${days}d ${remainingHours}h remaining`;
}
