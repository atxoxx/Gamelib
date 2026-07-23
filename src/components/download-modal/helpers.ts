import type { MatchedDownload } from "../../types/source";

/**
 * Single source of truth for "which URI does the user actually want to
 * download". The Rust match can carry explicit `uris` (mirrors) and an
 * optional convenience `magnet`. The user's selected mirror index wins
 * when it points at a real URI; otherwise we fall back to the magnet,
 * then to the first URI. Returning `null` is a hard signal that this
 * match has nothing downloadable (shouldn't happen for results the Rust
 * side vetted, but we guard anyway).
 */
export function resolveSourceUri(
  match: MatchedDownload | undefined,
  mirrorIdx: number,
): string | null {
  if (!match) return null;
  if (mirrorIdx >= 0 && mirrorIdx < match.uris.length) {
    return match.uris[mirrorIdx];
  }
  return match.magnet ?? match.uris[0] ?? null;
}

/** Classify a resolved URI into the three engine paths we support. */
export function classifyUri(uri: string | null): {
  isMagnet: boolean;
  isTorrentFile: boolean;
  isDirect: boolean;
} {
  const isMagnet = !!uri && uri.startsWith("magnet:");
  const isTorrentFile =
    !!uri && (uri.endsWith(".torrent") || uri.includes(".torrent?"));
  const isDirect =
    !!uri &&
    !isMagnet &&
    !isTorrentFile &&
    (uri.startsWith("http://") || uri.startsWith("https://"));
  return { isMagnet, isTorrentFile, isDirect };
}

/** Derive a friendly host label from a mirror URI for the chip picker. */
export function hostLabelForUri(uri: string, fallbackIndex: number): string {
  try {
    return new URL(uri).hostname.replace(/^www\./, "");
  } catch {
    return `Mirror ${fallbackIndex + 1}`;
  }
}

/** Numeric value used to order results by upload date (newest first).
 *  Missing / unparseable dates sink to the bottom. */
function dateValue(date: string | null | undefined): number {
  if (!date) return 0;
  const parsed = Date.parse(date);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Return a re-sorted copy of the matches for display. The canonical
 *  `matches` array stays score-ordered; this only affects presentation
 *  and the selection mapping (which is id-based, so reordering is safe). */
export function sortMatches<T extends { sourceName: string; matchScore: number; uploadDate?: string | null }>(
  list: T[],
  sortBy: "date" | "source" | "relevance",
): T[] {
  const copy = [...list];
  if (sortBy === "source") {
    copy.sort(
      (a, b) =>
        a.sourceName.localeCompare(b.sourceName) || b.matchScore - a.matchScore,
    );
  } else if (sortBy === "relevance") {
    copy.sort((a, b) => b.matchScore - a.matchScore);
  } else {
    // date — newest first; entries without a parseable date go last.
    copy.sort((a, b) => dateValue(b.uploadDate) - dateValue(a.uploadDate));
  }
  return copy;
}
