import type { Game } from "../../types/game";

// ─── Sort ──────────────────────────────────────────────────────────────────

/** Active sort key on the Storage page. The locked default is
 *  `size:desc` per spec (no persistence between sessions). */
export type SortKey =
  | "size:desc"
  | "name:asc"
  | "platform:asc"
  | "detectedAt:desc";

export const DEFAULT_SORT: SortKey = "size:desc";

/** Sort comparator factory for a given SortKey. Pure — no UI state. */
export function compareGames(sort: SortKey): (a: Game, b: Game) => number {
  switch (sort) {
    case "size:desc":
      return (a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0);
    case "name:asc":
      return (a, b) => a.name.localeCompare(b.name);
    case "platform:asc":
      return (a, b) =>
        (a.platform || "Unknown").localeCompare(b.platform || "Unknown");
    case "detectedAt:desc":
      // `sizeDetectedAt` is a string ISO-8601 timestamp OR undefined.
      // For the desc sort, undefined values map to -Infinity so they
      // sink to the bottom of the list.
      return (a, b) => {
        const aT = a.sizeDetectedAt
          ? Date.parse(a.sizeDetectedAt)
          : Number.NEGATIVE_INFINITY;
        const bT = b.sizeDetectedAt
          ? Date.parse(b.sizeDetectedAt)
          : Number.NEGATIVE_INFINITY;
        return bT - aT;
      };
  }
}

export function sortGames(games: Game[], sort: SortKey): Game[] {
  return [...games].sort(compareGames(sort));
}

// ─── Drive extraction ──────────────────────────────────────────────────────

/** Best-effort "drive bucket" label for a `sizeRootPath`:
 *
 *  - Windows: `"C:\Games\Foo\bin.exe"            -> "C:"`
 *  - Unix:    `"/mnt/games/Foo/bin.exe"          -> "/mnt/games"`
 *             (we strip the file basename so the bucket spans the mount)
 *  - Fallback: "Unknown" (no path, weird format) */
export function driveOf(rootPath: string | undefined | null): string {
  if (!rootPath) return "Unknown";
  // Normalize separators to forward slash so Windows + Unix share the
  // same downstream splitter.
  const norm = rootPath.replace(/\\/g, "/");
  const winMatch = norm.match(/^([a-zA-Z]):/);
  if (winMatch) {
    return `${winMatch[1].toUpperCase()}:`;
  }
  // Unix: take the first two non-empty segments so "/mnt/games" stays
  // its own bucket even when individual game folders beneath differ.
  const parts = norm.split("/").filter(Boolean);
  if (parts.length >= 2) return `/${parts[0]}/${parts[1]}`;
  if (parts.length === 1) return `/${parts[0]}`;
  return "Unknown";
}

// ─── Aggregation ────────────────────────────────────────────────────────────

/** A single bar in the Storage header breakdown lists. */
export interface StorageBucket {
  /** Display label (platform name or drive prefix). */
  label: string;
  /** Sum of sizeBytes across this bucket's games. */
  bytes: number;
  /** Number of sized games counted into this bucket. */
  count: number;
}

/** Group sized games by `game.platform` (or "Unknown" when empty). */
export function platformBuckets(games: Game[]): StorageBucket[] {
  const m = new Map<string, { bytes: number; count: number }>();
  for (const g of games) {
    if (g.sizeBytes == null || g.sizeBytes <= 0) continue;
    const key = g.platform || "Unknown";
    const cur = m.get(key) ?? { bytes: 0, count: 0 };
    cur.bytes += g.sizeBytes;
    cur.count += 1;
    m.set(key, cur);
  }
  return Array.from(m, ([label, v]) => ({ label, ...v })).sort(
    (a, b) => b.bytes - a.bytes
  );
}

/** Group sized games by the drive prefix of `sizeRootPath`. */
export function driveBuckets(games: Game[]): StorageBucket[] {
  const m = new Map<string, { bytes: number; count: number }>();
  for (const g of games) {
    if (g.sizeBytes == null || g.sizeBytes <= 0) continue;
    const key = driveOf(g.sizeRootPath);
    const cur = m.get(key) ?? { bytes: 0, count: 0 };
    cur.bytes += g.sizeBytes;
    cur.count += 1;
    m.set(key, cur);
  }
  return Array.from(m, ([label, v]) => ({ label, ...v })).sort(
    (a, b) => b.bytes - a.bytes
  );
}

/** Total bytes across every sized game (skips games whose sizeBytes is
 *  undefined or <= 0). */
export function totalBytes(games: Game[]): number {
  let total = 0;
  for (const g of games) {
    if (g.sizeBytes != null && g.sizeBytes > 0) total += g.sizeBytes;
  }
  return total;
}

/** How many sized games vs unsized games exist — used to label the
 *  total/totals card so the user sees the coverage at a glance. */
export function sizeCoverage(games: Game[]): { sized: number; unsized: number } {
  let sized = 0;
  let unsized = 0;
  for (const g of games) {
    if (g.sizeBytes != null && g.sizeBytes > 0) sized += 1;
    else unsized += 1;
  }
  return { sized, unsized };
}
