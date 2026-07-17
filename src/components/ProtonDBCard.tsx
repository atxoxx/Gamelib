import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ProtonDBStatus, ProtonDBTier } from "../types/game";

interface ProtonDBCardProps {
  /** Steam appid, e.g. 730 for CS2. When undefined the card is hidden. */
  steamAppId?: number;
}

/** Visual + label metadata for each ProtonDB tier. */
const TIER_META: Record<
  ProtonDBTier,
  { label: string; color: string; bg: string; help: string }
> = {
  platinum: {
    label: "Platinum",
    color: "#e5e4e2",
    bg: "rgba(229,228,226,0.14)",
    help: "Runs perfectly out of the box",
  },
  gold: {
    label: "Gold",
    color: "#ffd24a",
    bg: "rgba(255,210,74,0.14)",
    help: "Runs perfectly after minor tweaks",
  },
  silver: {
    label: "Silver",
    color: "#c0c0c8",
    bg: "rgba(192,192,200,0.14)",
    help: "Runs with minor issues, but generally playable",
  },
  bronze: {
    label: "Bronze",
    color: "#cd7f32",
    bg: "rgba(205,127,50,0.16)",
    help: "Runs, but often crashes or has issues",
  },
  borked: {
    label: "Borked",
    color: "#ef4444",
    bg: "rgba(239,68,68,0.16)",
    help: "Either won't start or is completely broken",
  },
  pending: {
    label: "Pending",
    color: "var(--color-text-muted)",
    bg: "rgba(127,127,140,0.12)",
    help: "Not enough reports for a rating yet",
  },
};

/** Lower is worse, used to pick a fallback when a tier is "pending". */
function tierValue(t: ProtonDBTier | undefined): number {
  switch (t) {
    case "platinum": return 5;
    case "gold": return 4;
    case "silver": return 3;
    case "bronze": return 2;
    case "borked": return 0;
    default: return -1;
  }
}

function confidenceLabel(c?: ProtonDBStatus["confidence"]): string {
  switch (c) {
    case "inadequate": return "Inadequate";
    case "low": return "Low";
    case "moderate": return "Moderate";
    case "high": return "High";
    case "strong": return "Strong";
    default: return "Unknown";
  }
}

/** Fetch the ProtonDB summary for an appid via the Tauri command. The
 *  command fetches server-side (ProtonDB restricts CORS to its own
 *  origin), and returns `found: false` when the game has no reports. */
async function fetchProtonDB(appId: number): Promise<ProtonDBStatus> {
  return invoke<ProtonDBStatus>("fetch_protondb_status", { appId });
}

export default function ProtonDBCard({ steamAppId }: ProtonDBCardProps) {
  const [data, setData] = useState<ProtonDBStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!steamAppId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchProtonDB(steamAppId)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [steamAppId]);

  // Hide when there's no appid, while loading, or on error.
  if (!steamAppId || loading || error || !data) return null;

  // A game with no reports yet is not worth a full card — keep the side
  // column uncluttered.
  if (!data.found) return null;

  // Prefer the official tier; fall back to the provisional estimate when
  // the official verdict is still "pending".
  const effectiveTier: ProtonDBTier =
    data.tier === "pending" && data.provisionalTier
      ? data.provisionalTier
      : data.tier;

  const meta = TIER_META[effectiveTier];
  const trendMismatch =
    data.trendingTier &&
    data.trendingTier !== data.tier &&
    tierValue(data.trendingTier) !== tierValue(data.tier) &&
    tierValue(data.trendingTier) !== tierValue(data.provisionalTier);

  const protonUrl = `https://www.protondb.com/app/${steamAppId}`;
  const reportsUrl = `https://www.protondb.com/app/${steamAppId}#reports`;

  return (
    <section className="game-section pdb-card">
      <h2 className="game-section-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-4z" />
        </svg>
        ProtonDB
      </h2>

      <div className="pdb-card-body">
        {/* Tier badge */}
        <div
          className="pdb-tier-badge"
          style={{ background: meta.bg, borderColor: meta.color }}
          title={meta.help}
        >
          <span className="pdb-tier-dot" style={{ background: meta.color }} />
          <span className="pdb-tier-label" style={{ color: meta.color }}>
            {meta.label}
          </span>
        </div>

        {/* Meta rows */}
        <div className="pdb-meta-grid">
          <div className="pdb-meta-row">
            <span className="pdb-meta-label">Confidence</span>
            <span className="pdb-meta-val">
              {confidenceLabel(data.confidence)}
            </span>
          </div>
          <div className="pdb-meta-row">
            <span className="pdb-meta-label">Reports</span>
            <span className="pdb-meta-val">
              {data.total != null ? data.total.toLocaleString() : "—"}
            </span>
          </div>
          {typeof data.score === "number" && (
            <div className="pdb-meta-row">
              <span className="pdb-meta-label">Score</span>
              <span className="pdb-meta-val">
                {Math.round(data.score * 100)}%
              </span>
            </div>
          )}
          {data.bestReportedTier && data.bestReportedTier !== effectiveTier && (
            <div className="pdb-meta-row">
              <span className="pdb-meta-label">Best Reported</span>
              <span
                className="pdb-meta-val"
                style={{ color: TIER_META[data.bestReportedTier].color }}
              >
                {TIER_META[data.bestReportedTier].label}
              </span>
            </div>
          )}
        </div>

        {/* Trending note */}
        {trendMismatch && data.trendingTier && (
          <div className="pdb-trend-note">
            <span className="pdb-trend-dot" />
            Trending toward{" "}
            <strong style={{ color: TIER_META[data.trendingTier].color }}>
              {TIER_META[data.trendingTier].label}
            </strong>
          </div>
        )}

        {/* Links */}
        <div className="pdb-links">
          <a
            href={protonUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="pdb-source-link"
            title="View on ProtonDB"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            ProtonDB Page
          </a>
          <a
            href={reportsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="pdb-source-link"
            title="Read community reports"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Reports
          </a>
        </div>
      </div>
    </section>
  );
}
