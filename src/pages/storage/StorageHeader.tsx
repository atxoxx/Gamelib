import { useMemo } from "react";
import type { Game, SizeUnit } from "../../types/game";
import { formatSize } from "../../types/game";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import {
  driveBuckets,
  platformBuckets,
  sizeCoverage,
  totalBytes,
  type StorageBucket,
} from "./utils";
import { useDriveUsage } from "./useDriveUsage";

interface Props {
  games: Game[];
  /** Number of sized games whose `sizeRootPath` no longer resolves on
   *  disk. Surfaced in the totals card meta line so the user can see
   *  the staleness coverage at a glance. */
  staleCount?: number;
}

/** Phase-5 Storage header — totals card + per-platform + per-drive
 *  breakdown bars. Pure presentational: receives the unsorted games
 *  array (the orchestrator handles sorting) and aggregates internally.
 *
 *  Note: the page title/subtitle are rendered by StoragePage itself
 *  so this component just produces the three breakdown cards. */
export function StorageHeader({ games, staleCount = 0 }: Props) {
  const { unit } = useSizeUnit();
  const total = useMemo(() => totalBytes(games), [games]);
  const coverage = useMemo(() => sizeCoverage(games), [games]);
  const platforms = useMemo(() => platformBuckets(games), [games]);
  const drives = useMemo(() => driveBuckets(games), [games]);
  const driveUsage = useDriveUsage(games);
  const uncategorized = coverage.unsized;

  return (
    <div className="storage__header-grid">
        {/* Totals card */}
        <section className="storage__card storage__card--totals">
          <span className="storage__card-label">Tracked size</span>
          <span className="storage__card-value">{formatSize(total, unit)}</span>
          <span className="storage__card-meta">
            {coverage.sized} sized game{coverage.sized === 1 ? "" : "s"}
            {uncategorized > 0 &&
              `  ${"·"}  ${uncategorized} missing${uncategorized === 1 ? "" : "s"}`}
            {staleCount > 0 && (
              <>
                {`  ${"·"}  `}
                <span className="storage__card-meta-stale">
                  {staleCount} stale
                </span>
              </>
            )}
          </span>
        </section>

        <BreakdownCard title="By platform" buckets={platforms} total={total} unit={unit} />
        <BreakdownCard title="By drive" buckets={drives} total={total} unit={unit} usage={driveUsage} />
    </div>
  );
}

/** One breakdown card. Renders an empty-state row when no sized
 *  games are bucketed into this dimension.
 *
 *  For the "By drive" card (when `usage` is supplied) each row also
 *  shows a volume-utilization mini-bar beneath the game-bytes bar: how
 *  much of the drive's total capacity the tracked games consume, plus a
 *  "free" label. Drives whose capacity query failed simply omit that
 *  sub-row. */
function BreakdownCard({
  title,
  buckets,
  total,
  unit,
  usage,
}: {
  title: string;
  buckets: StorageBucket[];
  total: number;
  unit: SizeUnit;
  /** Optional per-drive capacity map (only the "By drive" card passes
   *  this). Keyed by the same label `driveBuckets` produces. */
  usage?: Map<string, { total: number; free: number; available: number }>;
}) {
  return (
    <section className="storage__card storage__card--breakdown">
      <span className="storage__card-label">{title}</span>
      {buckets.length === 0 ? (
        <span className="storage__breakdown-empty">No measurements yet.</span>
      ) : (
        <ul className="storage__breakdown-list">
          {buckets.map((b) => {
            const pct = total > 0 ? (b.bytes / total) * 100 : 0;
            const u = usage?.get(b.label);
            const usedPct =
              u && u.total > 0 ? (b.bytes / u.total) * 100 : 0;
            return (
                <li
                key={b.label}
                className="storage__breakdown-row"
                role="meter"
                aria-valuenow={Math.round(pct)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${b.label}: ${formatSize(b.bytes, unit)} across ${b.count} game${b.count === 1 ? "" : "s"}`}
                title={`${b.label}: ${formatSize(b.bytes, unit)} across ${b.count} game${b.count === 1 ? "" : "s"}`}
              >
                <span className="storage__breakdown-label">{b.label}</span>
                <div className="storage__breakdown-track">
                  <div
                    className="storage__breakdown-fill"
                    style={{ width: `${pct.toFixed(1)}%` }}
                  />
                </div>
                <span className="storage__breakdown-value">
                  {formatSize(b.bytes, unit)}
                </span>
                {u && u.total > 0 && (
                  <span className="storage__drive-usage">
                    <span className="storage__drive-usage-track">
                      <span
                        className="storage__drive-usage-fill"
                        style={{ width: `${usedPct.toFixed(1)}%` }}
                      />
                    </span>
                    <span className="storage__drive-usage-label">
                      {formatSize(u.total - u.available, unit)} of{" "}
                      {formatSize(u.total, unit)} used
                    </span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
