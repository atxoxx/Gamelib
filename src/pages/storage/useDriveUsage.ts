import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Game } from "../../types/game";
import { driveOf } from "./utils";

/** A single drive's capacity + availability, keyed by the same drive
 *  label the breakdown card uses (`C:`, `/mnt/games`, …). */
export interface DriveUsage {
  total: number;
  free: number;
  available: number;
}

interface DiskUsageResult {
  total: number;
  free: number;
  available: number;
}

/** Per-drive capacity for the "By drive" breakdown card.
 *
 *  Strategy:
 *    1. Derive the set of distinct drive labels from the sized games'
 *       `sizeRootPath` (same `driveOf()` logic the breakdown uses, so
 *       the labels line up exactly).
 *    2. For each distinct drive, invoke `disk_usage(path)` once to get
 *       total/free/available bytes. We pass a concrete path (not just
 *       the label) because `disk_usage` resolves the hosting volume. On
 *       Windows the label `C:` maps to `C:\`; on Unix `/mnt/games` is a
 *       real path already.
 *    3. Failures are isolated per drive — a disconnected mount returns
 *       an error and that drive simply has no usage row (the card still
 *       shows game bytes). The whole header never blanks on one bad
 *       volume.
 *
 *  The map is recomputed whenever the underlying games change, but each
 *  `disk_usage` call is fire-and-forget into local state so a slow
 *  filesystem stat doesn't block render. */
export function useDriveUsage(games: Game[]): Map<string, DriveUsage> {
  const [usage, setUsage] = useState<Map<string, DriveUsage>>(
    () => new Map()
  );

  // Distinct (label, samplePath) pairs to query — one per drive bucket.
  const targets = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of games) {
      if (g.sizeBytes == null || g.sizeBytes <= 0) continue;
      const path = g.sizeRootPath;
      if (!path) continue;
      const label = driveOf(path);
      if (!m.has(label)) m.set(label, path);
    }
    return Array.from(m, ([label, path]) => ({ label, path }));
  }, [games]);

  useEffect(() => {
    if (targets.length === 0) {
      setUsage(new Map());
      return;
    }
    let cancelled = false;
    const next = new Map<string, DriveUsage>();
    Promise.all(
      targets.map(({ label, path }) =>
        invoke<DiskUsageResult>("disk_usage", { path })
          .then((r) => ({ label, usage: r as DriveUsage }))
          .catch(() => null)
      )
    ).then((results) => {
      if (cancelled) return;
      for (const r of results) {
        if (r) next.set(r.label, r.usage);
      }
      setUsage(new Map(next));
    });
    return () => {
      cancelled = true;
    };
  }, [targets]);

  return usage;
}
