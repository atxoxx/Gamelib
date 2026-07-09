import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CrackWatchStatus } from "../types/game";

interface CrackWatchCardProps {
  gameName: string;
}

/** Status badge colors — green for cracked, red for uncracked. */
function statusColor(status: string | null): string {
  if (status === "cracked") return "#10b981";
  if (status === "uncracked") return "#ef4444";
  return "var(--color-text-muted)";
}

export default function CrackWatchCard({ gameName }: CrackWatchCardProps) {
  const [data, setData] = useState<CrackWatchStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!gameName) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    invoke<CrackWatchStatus>("fetch_crackwatch_status", { gameName })
      .then((result) => {
        if (cancelled) return;
        // Only render if the page was found (status is non-null)
        if (result.status) {
          setData(result);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [gameName]);

  // Don't render anything while loading, on error, or when no data
  if (loading || error || !data || !data.status) return null;

  const color = statusColor(data.status);

  return (
    <section className="game-section cw-card">
      <h2 className="game-section-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        CrackWatch Status
      </h2>

      {/* Status header */}
      <div className="cw-card-header">
        <div
          className="cw-status-pill"
          style={{ background: color, color: color }}
        >
          {data.statusLabel || "UNKNOWN"}
        </div>
        {data.counter && (
          <div className="cw-counter">{data.counter}</div>
        )}
      </div>

      {/* Meta grid */}
      <div className="cw-meta-grid-inner">
        {data.releaseDate && (
          <div className="cw-meta-row">
            <span className="cw-meta-label">Release Date</span>
            <span className="cw-meta-val">{data.releaseDate}</span>
          </div>
        )}
        {data.crackDate && (
          <div className="cw-meta-row">
            <span className="cw-meta-label">Crack Date</span>
            <span
              className={`cw-meta-val${data.crackDate === "TBD" ? " cw-meta-val-tbd" : ""}`}
            >
              {data.crackDate}
            </span>
          </div>
        )}
        {data.drmProtection && (
          <div className="cw-meta-row">
            <span className="cw-meta-label">DRM</span>
            <span className="cw-meta-val">{data.drmProtection}</span>
          </div>
        )}
        {data.sceneGroup && (
          <div className="cw-meta-row">
            <span className="cw-meta-label">Scene Group</span>
            <span
              className={`cw-meta-val${data.sceneGroup === "TBD" ? " cw-meta-val-tbd" : ""}`}
            >
              {data.sceneGroup}
            </span>
          </div>
        )}
      </div>

      {/* Link to crackrelease page */}
      {data.pageUrl && (
        <a
          href={data.pageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="cw-source-link"
          title="View on CrackRelease.com"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          View on CrackRelease
        </a>
      )}
    </section>
  );
}
