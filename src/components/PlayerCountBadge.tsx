import { useRef, useState } from "react";
import useSteamPlayerCount from "../hooks/useSteamPlayerCount";
import useHydraGameStats from "../hooks/useHydraGameStats";
import PlayerCountPopover from "./PlayerCountPopover";
import { formatCompactPlayerCount } from "./SteamPlayerCount";

/**
 * PlayerCountBadge
 * ────────────────
 * Unified "X playing" glass pill that sums the live player counts
 * from Steam (`get_steam_player_count`) and the Hydra launcher
 * community (`get_hydra_game_stats`). Supersedes the side-by-side
 * `<SteamPlayerCount>` + `<HydraPlayerCount>` pair on every banner.
 *
 * Visuals: the familiar pill with up to two pulsing dots — green for
 * Steam, purple for Hydra — one per source currently contributing
 * players, so the badge doubles as a legend for where the number
 * comes from.
 *
 * Click-to-expand
 * ───────────────
 * Opens `<PlayerCountPopover>`, a tabbed card with a Steam tab (live
 * count, review breakdown, 24h activity sparkline, store link) and a
 * Hydra tab (active players, community downloads, 1–5 star score).
 *
 * Behavior:
 *  - Both sources poll every 60s + refetch on window focus (owned by
 *    their hooks, in lockstep with the Rust-side cache TTLs).
 *  - Renders nothing silently when appId is missing or both sources
 *    report zero/no players — a "0 playing" badge is noise.
 *  - Each source degrades independently: a Steam hiccup leaves the
 *    Hydra share visible, and vice versa.
 */
export interface PlayerCountBadgeProps {
  /** Steam appid (Hydra keys its catalog on Steam appids too). When
   *  undefined the badge is hidden. */
  appId?: number;
  /** Extra className merged onto the root pill element for per-banner
   *  positioning (e.g. "hero-player-count" for absolute top-right). */
  className?: string;
}

export default function PlayerCountBadge({
  appId,
  className = "",
}: PlayerCountBadgeProps) {
  const steamCount = useSteamPlayerCount(appId);
  const hydraStats = useHydraGameStats(appId);

  // Open on click only (per product decision). The popover closes via
  // its own click-outside / Escape / X handlers.
  const [popoverOpen, setPopoverOpen] = useState(false);

  // Anchor + click-outside exclusion for the popover, same contract
  // as the original Steam badge (see SteamPlayerCount.tsx).
  const badgeRef = useRef<HTMLDivElement>(null);

  const steam = steamCount ?? 0;
  const hydra = hydraStats?.playerCount ?? 0;
  const total = steam + hydra;

  if (!appId || total <= 0) return null;

  const breakdown = [
    steam > 0 ? `${steam.toLocaleString()} on Steam` : null,
    hydra > 0 ? `${hydra.toLocaleString()} on Hydra` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const title = `${total.toLocaleString()} playing right now (${breakdown}) — click for details`;

  return (
    <>
      <div
        ref={badgeRef}
        className={`steam-player-count steam-player-count--clickable ${className}`.trim()}
        title={title}
        role="button"
        tabIndex={0}
        aria-label={`${total.toLocaleString()} players currently in this game (${breakdown}). Click for Steam and Hydra stats.`}
        aria-haspopup="dialog"
        aria-expanded={popoverOpen}
        onClick={() => setPopoverOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setPopoverOpen((o) => !o);
          }
        }}
        data-count={total}
      >
        {/* One dot per contributing source — green Steam, purple
            Hydra — so the pill self-documents its composition. */}
        {steam > 0 && (
          <span className="steam-player-count-dot" aria-hidden="true" />
        )}
        {hydra > 0 && (
          <span
            className="steam-player-count-dot hydra-player-count-dot"
            aria-hidden="true"
          />
        )}
        <span
          className="steam-player-count-text"
          aria-live="polite"
          aria-atomic="true"
        >
          {formatCompactPlayerCount(total)}
          <span className="steam-player-count-suffix"> playing</span>
        </span>
      </div>
      {popoverOpen && (
        <PlayerCountPopover
          appId={appId}
          anchorRef={badgeRef}
          steamCount={steam}
          hydraStats={hydraStats}
          onClose={() => setPopoverOpen(false)}
        />
      )}
    </>
  );
}
