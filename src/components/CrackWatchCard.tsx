import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CrackWatchStatus } from "../types/game";

/** Skeleton shimmer used while the status is loading. */
function Skeleton({ height = 16, width = "100%" }: { height?: number; width?: number | string }) {
  return (
    <span
      className="cw-skeleton"
      style={{ height, width, display: "block", borderRadius: 6 }}
    />
  );
}

/** Pure presentational card, mirroring Hydra's `CrackWatchSection`.
 *
 *  Receives the already-fetched `data` and an `isLoading` flag. While
 *  `isLoading` (and no data yet) it renders a skeleton; when `data` is
 *  present it renders the CRACKED/UNCRACKED badge plus the crack info
 *  rows (protection, group, date). Renders nothing when there is no
 *  data and loading is complete (title couldn't be resolved). */
export function CrackWatchSection({
  data,
  isLoading,
}: {
  data: CrackWatchStatus | null;
  isLoading: boolean;
}) {
  if (!isLoading && !data) return null;

  return (
    <section className="game-section cw-card">
      <h2 className="game-section-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        CrackWatch Status
      </h2>

      <div className="cw-card-body">
        {data ? (
          <>
            <div className="cw-card-header">
              <span
                className={`cw-status-pill${data.isCracked ? " cw-cracked" : " cw-uncracked"}`}
              >
                {data.isCracked ? "CRACKED" : "UNCRACKED"}
              </span>
            </div>

            <div className="cw-meta-grid-inner">
              {data.protection && (
                <div className="cw-meta-row">
                  <span className="cw-meta-label">Protection</span>
                  <span className="cw-meta-val">{data.protection}</span>
                </div>
              )}
              {data.crackGroup && (
                <div className="cw-meta-row">
                  <span className="cw-meta-label">Group</span>
                  <span className="cw-meta-val">{data.crackGroup}</span>
                </div>
              )}
              {data.crackDate && (
                <div className="cw-meta-row">
                  <span className="cw-meta-label">Crack Date</span>
                  <span className="cw-meta-val">{data.crackDate}</span>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="cw-card-header">
              <Skeleton height={28} width={120} />
            </div>
            <div className="cw-meta-grid-inner">
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/** Convenience wrapper that fetches the status for a game by name and
 *  renders the `CrackWatchSection`. This is what the game page sidebar
 *  and store cards mount. */
export default function CrackWatchCard({
  gameName,
  appId,
}: {
  gameName: string;
  appId?: number | null;
}) {
  const [data, setData] = useState<CrackWatchStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!gameName) return;
    let cancelled = false;
    setIsLoading(true);
    setData(null);

    invoke<CrackWatchStatus | null>("fetch_crackwatch_status", {
      gameName,
      appId: appId != null ? String(appId) : null,
    })
      .then((result) => {
        if (!cancelled) setData(result ?? null);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [gameName, appId]);

  return <CrackWatchSection data={data} isLoading={isLoading} />;
}
