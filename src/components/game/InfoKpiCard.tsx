import { useMemo, type ReactNode } from "react";
import { KpiTile } from "../ui";
import { formatSize, PLAY_STATUS_DETAILS, type Game, type SizeUnit } from "../../types/game";
import {
  IconBuilding,
  IconCalendar,
  IconCheck,
  IconCollection,
  IconHardDrive,
  IconInfo,
  IconPlatform,
  IconStar,
  IconTag,
  IconUser,
  IconUsers,
  IconClock,
  IconX,
} from "./icons";
import { StatusDot } from "./shared";
import { useSteamGameStats, formatSteamPrice } from "../../hooks/useSteamGameStats";

/**
 * InfoKpiCard
 *
 *  Right-sidebar "Info" card. Redesigned from a dense 2-col grid
 *  of small uppercase labels into a hybrid layout that surfaces
 *  the highest-value metadata as a row of KPI tiles, with the
 *  remaining fields in a scannable definition list.
 *
 *  Layout:
 *    ┌─ Top KPI row ─────────────────────────────┐
 *    │  [Status]    [Play Time]    [Size] [Price]│  ← tiles, only the
 *    │                                             ones with data show
 *    ├─ Definition list ──────────────────────────┤
 *    │  Platform      [icon]  value              │  ← icon-prefixed,
 *    │  Developer     [icon]  value              │    one row per field
 *    │  Publisher     [icon]  value              │
 *    │  …                                           │
 *    └────────────────────────────────────────────┘
 *    [genre] [genre] [genre]  ← genre chip row at the bottom
 *
 *  Empty fields are silently dropped so the card never has
 *  meaningless `—` rows. The `clickable` size row opens the
 *  edit modal so users can re-detect / clear the size without
 *  hunting for the Edit button.
 */

interface InfoKpiCardProps {
  game: Game;
  sizeUnit: SizeUnit;
  onEditSize?: () => void;
  /** Hide the play-status KPI tile (used on store pages where "Backlog" is meaningless). */
  hideStatus?: boolean;
}

interface DetailRow {
  label: string;
  value: ReactNode;
  icon: ReactNode;
}

export default function InfoKpiCard({
  game,
  sizeUnit,
  onEditSize,
  hideStatus,
}: InfoKpiCardProps) {
  // Fetch the combined Steam stats payload so the price tile has
  // its data ready without re-firing the IPC call the popover also
  // uses. The Rust backend caches `appdetails` for 24h, so concurrent
  // consumers (popover + this card) cost one Steam call, not two.
  const { data: steamStats } = useSteamGameStats(game.steamAppId);

  // Pull the price fields once so the dependency array on the
  // `kpis` memo stays stable. The card silently falls back to no
  // price tile when Steam returned no `details` block (offline,
  // appid has no `appdetails`, etc.).
  const priceCents = steamStats?.details?.priceCents ?? null;
  const priceCurrency = steamStats?.details?.currency ?? null;
  const priceIsFree = steamStats?.details?.isFree ?? false;
  const hasPrice =
    steamStats?.details != null &&
    (priceIsFree || (priceCents != null && priceCents > 0));

  // KPI tiles at the top: surface the most-glanced values first.
  // The Price tile only renders when Steam has a price for the
  // title, keeping the row tight for games that don't.
  const kpis = useMemo(() => {
    const items: ReactNode[] = [];

    if (!hideStatus) {
      items.push(
      <KpiTile
        key="play-status"
        size="sm"
        label="Status"
        icon={<IconStar size={12} />}
        value={
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <StatusDot color={PLAY_STATUS_DETAILS[game.playStatus || "backlog"].color} />
            {PLAY_STATUS_DETAILS[game.playStatus || "backlog"].label}
          </span>
        }
        intent={
          game.playStatus === "playing"
            ? "success"
            : game.playStatus === "completed"
              ? "info"
              : game.playStatus === "on_hold"
                ? "warning"
                : game.playStatus === "abandoned"
                  ? "danger"
                  : "default"
        }        />
      );
    }

    items.push(
      <KpiTile
        key="play-time"
        size="sm"
        label="Play Time"
        icon={<IconClock size={12} />}
        value={game.playTime}
        subtext={game.installed ? "Installed" : "Not installed"}
        intent={game.installed ? "success" : "default"}
      />
    );

    if (game.sizeBytes != null) {
      items.push(
        <KpiTile
          key="size"
          size="sm"
          label="Size"
          icon={<IconHardDrive size={12} />}
          value={formatSize(game.sizeBytes, sizeUnit)}
          subtext="Click to edit"
          {...(onEditSize
            ? {
                onClick: onEditSize,
                role: "button",
                tabIndex: 0,
                title: "Edit size",
              }
            : {})}
          className="kpi-tile--clickable"
        />
      );
    }

    // Price tile — always rendered as the 4th slot so the kpi-row
    // height stays stable while Steam's `appdetails` round-trip
    // resolves. While the fetch is in flight we show a "—" placeholder;
    // once the data arrives the real value (free / paid / etc.)
    // takes its place without reflowing the row above.
    const showPrice = hasPrice;
    items.push(
      <KpiTile
        key="price"
        size="sm"
        label="Price"
        icon={<IconTag size={12} />}
        value={showPrice ? formatSteamPrice(priceCents, priceCurrency, priceIsFree) : "—"}
        subtext={showPrice ? (priceIsFree ? "Steam" : "On Steam") : "Loading…"}
        intent={!showPrice ? "default" : priceIsFree ? "success" : "default"}
      />
    );

    return items;
  }, [
    game,
    sizeUnit,
    onEditSize,
    hasPrice,
    priceCents,
    priceCurrency,
    priceIsFree,
    hideStatus,
  ]);

  // Definition list rows: every field with a value renders.
  // Order: identity (platform, dates) → people (dev/pub) → series
  // → status (release status) → secondary (alt names).
  const rows = useMemo<DetailRow[]>(() => {
    const addedDate = new Date(game.addedAt).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const out: DetailRow[] = [
      { label: "Platform", value: game.platform, icon: <IconPlatform size={12} /> },
      { label: "Added", value: addedDate, icon: <IconCalendar size={12} /> },
    ];
    if (game.developer) {
      out.push({
        label: "Developer",
        value: game.developer,
        icon: <IconUser size={12} />,
      });
    }
    if (game.publisher) {
      out.push({
        label: "Publisher",
        value: game.publisher,
        icon: <IconBuilding size={12} />,
      });
    }
    if (game.releaseDate) {
      out.push({
        label: "Released",
        value: game.releaseDate,
        icon: <IconCalendar size={12} />,
      });
    }
    if (game.collection) {
      out.push({
        label: "Series",
        value: game.collection,
        icon: <IconCollection size={12} />,
      });
    }
    if (game.franchise) {
      out.push({
        label: "Franchise",
        value: game.franchise,
        icon: <IconCollection size={12} />,
      });
    }
    if (game.gameCategory) {
      out.push({
        label: "Game Type",
        value: game.gameCategory,
        icon: <IconInfo size={12} />,
      });
    }
    if (game.releaseStatus) {
      const intent =
        game.releaseStatus.toLowerCase().includes("released")
          ? "success"
          : game.releaseStatus.toLowerCase().includes("early")
            ? "warning"
            : "default";
      out.push({
        label: "Release Status",
        value: (
          <span className={`info-dl-value-tag info-dl-value-tag--${intent}`}>
            {game.releaseStatus}
          </span>
        ),
        icon: <IconCheck size={12} />,
      });
    }
    if (game.alternativeNames && game.alternativeNames.length > 0) {
      out.push({
        label: "Also Known As",
        value: game.alternativeNames.join(", "),
        icon: <IconUsers size={12} />,
      });
    }
    return out;
  }, [game]);

  return (
    <section className="game-section info-kpi-card">
      <h2 className="game-section-title">
        <span className="game-section-title__icon" aria-hidden>
          <IconInfo size={16} />
        </span>
        Info
      </h2>

      {kpis.length > 0 && <div className="kpi-row">{kpis}</div>}

      <dl className="info-dl">
        {rows.map((row) => (
          <div className="info-dl-row" key={row.label}>
            <dt className="info-dl-label">
              <span className="info-dl-icon" aria-hidden>
                {row.icon}
              </span>
              {row.label}
            </dt>
            <dd className="info-dl-value">{row.value}</dd>
          </div>
        ))}
        {!kpis.length && rows.length === 0 && (
          <div className="info-dl-empty">
            <IconX size={14} />
            No metadata available
          </div>
        )}
      </dl>

      {game.genres && game.genres.length > 0 && (
        <div className="info-genres">
          {game.genres.map((g) => (
            <span key={g} className="spec-pill">
              {g}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
