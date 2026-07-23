import type { OwnershipResult } from "../../types/download";
import type { DownloadStep } from "./types";

/**
 * Build the ownership banner. The check can land in three states:
 *   1. Still in flight → muted "checking…" pill
 *   2. Game is owned on one or more stores → amber warning
 *   3. Game is not owned anywhere → no banner (return null)
 */
export function OwnershipBanner({
  ownership,
  step,
}: {
  ownership: OwnershipResult | null;
  step: DownloadStep;
}) {
  if (step === "checking" || !ownership) {
    return (
      <div className="dl-ownership checking">
        <svg
          className="dl-ownership-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <div className="dl-ownership-body">
          <div className="dl-ownership-title">Checking ownership…</div>
          <div className="dl-ownership-text">
            Looking up on Steam, Epic, and your local library.
          </div>
        </div>
      </div>
    );
  }

  if (!ownership.isOwnedAnywhere) return null;

  // Find the first "owned" store to surface in the headline. (We
  // could list all of them, but a single headline is more
  // attention-grabbing and the rest go in the body.)
  const ownedStores = ownership.ownedStores.filter((s) => s.owned);
  const primary = ownedStores[0];
  const others = ownedStores.slice(1);
  const othersText =
    others.length > 0
      ? ` Also owned on ${others.map((o) => o.store).join(", ")}.`
      : "";
  const detailsText = primary.details ? ` (${primary.details})` : "";

  return (
    <div className="dl-ownership owned">
      <svg
        className="dl-ownership-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <div className="dl-ownership-body">
        <div className="dl-ownership-title">
          You own this on {primary.store}
          {detailsText}
        </div>
        <div className="dl-ownership-text">
          Consider launching the game from your library rather than downloading
          it. Your purchase supports the developers.
          {othersText}
        </div>
      </div>
    </div>
  );
}
