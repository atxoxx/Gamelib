import { useRef, useState } from "react";
import useHydraGameStats from "../hooks/useHydraGameStats";
import HydraStatsPopover from "./HydraStatsPopover";
import { formatCompactPlayerCount } from "./SteamPlayerCount";

/**
 * HydraPlayerCount
 * ────────────────
 * Compact, pulsing "X playing on Hydra" badge powered by the Hydra
 * launcher's public community-stats API (`get_hydra_game_stats` →
 * `GET /games/stats?objectId={appid}&shop=steam`). Visual twin of
 * `<SteamPlayerCount>` (same glass pill), differentiated by a purple
 * dot + the "on Hydra" suffix. Sits next to the Steam badge on the
 * Store hero, Store game detail, Library game detail, and the Big
 * Screen variants.
 *
 * Click-to-expand
 * ───────────────
 * The badge is a button that opens `<HydraStatsPopover>` next to
 * itself, showing active players, total community downloads, and the
 * Hydra community score (1–5 stars from user reviews).
 *
 * Behavior:
 *  - Data fetch/polling is owned by `useHydraGameStats` (60s + focus
 *    refresh, mirroring the Rust-side cache TTL).
 *  - Renders nothing silently when:
 *      * appId is missing / falsy
 *      * the backend reports no Hydra data for the appid
 *      * both playerCount and downloadCount are 0 (information-free)
 *  - Headline metric prefers live players; when nobody is in-game the
 *    pill falls back to the download count so quiet-but-popular games
 *    still surface their community footprint.
 */
export interface HydraPlayerCountProps {
  /** Steam appid (Hydra keys its catalog on Steam appids). When
   *  undefined the badge is hidden. */
  appId?: number;
  /** Extra className merged onto the root pill element for per-banner
   *  positioning, mirroring `SteamPlayerCountProps.className`. */
  className?: string;
}

export default function HydraPlayerCount({
  appId,
  className = "",
}: HydraPlayerCountProps) {
  const stats = useHydraGameStats(appId);

  const [popoverOpen, setPopoverOpen] = useState(false);

  // Anchor + click-outside exclusion for the popover, same contract
  // as the Steam badge (see SteamPlayerCount.tsx).
  const badgeRef = useRef<HTMLDivElement>(null);

  if (!appId || !stats) return null;

  const hasPlayers = stats.playerCount > 0;
  const hasDownloads = stats.downloadCount > 0;
  if (!hasPlayers && !hasDownloads) return null;

  const headline = hasPlayers ? stats.playerCount : stats.downloadCount;
  const suffix = hasPlayers ? " playing" : " downloads";

  const titleParts = [
    `${stats.playerCount.toLocaleString()} playing on Hydra right now`,
    `${stats.downloadCount.toLocaleString()} community downloads`,
  ];
  if (stats.reviewCount > 0) {
    titleParts.push(
      `rated ${stats.averageScore.toFixed(1)}/5 by ${stats.reviewCount.toLocaleString()} players`
    );
  }
  const title = `${titleParts.join(" · ")} — click for details`;

  return (
    <>
      <div
        ref={badgeRef}
        className={`steam-player-count steam-player-count--clickable hydra-player-count ${className}`.trim()}
        title={title}
        role="button"
        tabIndex={0}
        aria-label={`${title.replace(" — click for details", "")}. Click for Hydra community stats.`}
        aria-haspopup="dialog"
        aria-expanded={popoverOpen}
        onClick={() => setPopoverOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setPopoverOpen((o) => !o);
          }
        }}
        data-count={headline}
      >
        <span
          className="steam-player-count-dot hydra-player-count-dot"
          aria-hidden="true"
        />
        <span
          className="steam-player-count-text"
          aria-live="polite"
          aria-atomic="true"
        >
          {formatCompactPlayerCount(headline)}
          <span className="steam-player-count-suffix">{suffix}</span>
        </span>
      </div>
      {popoverOpen && (
        <HydraStatsPopover
          stats={stats}
          anchorRef={badgeRef}
          onClose={() => setPopoverOpen(false)}
        />
      )}
    </>
  );
}
