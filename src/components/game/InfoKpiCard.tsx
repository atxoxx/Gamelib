import { useCallback, useMemo, type ReactNode } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { KpiTile } from "../ui";
import {
  formatSize,
  PLAY_STATUS_DETAILS,
  type Game,
  type SizeUnit,
} from "../../types/game";
import {
  IconBuilding,
  IconCalendar,
  IconCheck,
  IconCollection,
  IconExternalLink,
  IconFolder,
  IconHardDrive,
  IconInfo,
  IconPencil,
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
import { useToast } from "../../context/ToastContext";

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
 *    │  …                                          │
 *    ├─ Genre chips (when present) ───────────────┤
 *    │  [genre] [genre] [genre]                   │
 *    ├─ Executable path footer (when present) ────┤
 *    │  📁 Executable                              │  ← visual click target
 *    │  C:\…\game.exe   ↗                         │    opens parent folder
 *    └────────────────────────────────────────────┘
 *
 *  Empty fields are silently dropped so the card never has
 *  meaningless `—` rows. The `clickable` size row opens the
 *  edit modal so users can re-detect / clear the size without
 *  hunting for the Edit button. The executable-path footer
 *  opens the *parent folder* in the OS file manager (Explorer
 *  on Windows, Finder on macOS, the default FM on Linux) — we
 *  explicitly do NOT launch the .exe, so a misclick just shows
 *  the user where the file lives instead of starting the game.
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

/**
 * Extract the containing directory of a path, working on both
 * Windows (`\`) and Unix (`/`) separators. Returns `null` for any
 * input we can't sensibly open as a folder — a bare filename, a
 * drive-root string like `"C:"`, an absolute root like `"/"`, or
 * an empty / whitespace-only string. The caller uses `null` to
 * decide not to render the "Open in Explorer" button at all, so
 * we never surface a clickable action that would just toast an
 * error.
 *
 * We do this in JS rather than via `@tauri-apps/api/path::dirname`
 * so the operation is pure string work — no IPC round-trip — and
 * works the same way regardless of which OS the user is on.
 */
function getParentDir(filePath: string): string | null {
  if (!filePath) return null;
  // Strip any trailing separators so "C:\foo\" collapses to "C:\foo"
  // before we search for the parent's separator.
  const trimmed = filePath.replace(/[\\/]+$/, "");
  if (!trimmed) return null;
  const lastSep = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  if (lastSep < 0) return null; // bare filename — no parent
  if (lastSep === 0) return null; // absolute-root parent like "/" → empty parent
  const parent = trimmed.slice(0, lastSep);
  if (!parent) return null;
  // Windows drive-only parent (e.g. "C:") maps to the current
  // directory on that drive, which is meaningless to "open". Refuse
  // it so the caller can skip rendering the button.
  if (/^[A-Za-z]:$/.test(parent)) return null;
  return parent;
}

/**
 * Compute a "short" version of the path string for display in a
 * narrow card. When the full path fits within `MAX_CHARS` we show
 * it verbatim; when it overflows, we elide the middle with a single
 * Unicode HORIZONTAL ELLIPSIS and surface the most identifier-
 * dense portion (the tail) — that way the file name (which the
 * user mentally associates with the game) stays visible even on a
 * deeply-nested Steam install, without resorting to a CSS bidi
 * trick that can re-order `\` / `:` / drive letters unpredictably.
 * The full path is still available on hover via the button's
 * `title` attribute.
 */
const EXE_PATH_DISPLAY_MAX = 56;
function shortExePath(filePath: string): string {
  if (filePath.length <= EXE_PATH_DISPLAY_MAX) return filePath;
  // Keep enough of the tail to leave ~48 visible characters (incl.
  // the ellipsis prefix). The leading `"… "` (one ellipsis + space)
  // reads cleanly across CSS-only fallback paths too.
  const TAIL_LEN = EXE_PATH_DISPLAY_MAX - 2;
  return "…" + filePath.slice(-TAIL_LEN);
}

export default function InfoKpiCard({
  game,
  sizeUnit,
  onEditSize,
  hideStatus,
}: InfoKpiCardProps) {
  const { showToast } = useToast();

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

  // Resolve the executable path up front so we can both display it
  // AND decide whether the "Open in Explorer" button should render.
  // Store-page mock games have an empty `path` and skip the block;
  // paths that resolve to a drive-root or a bare filename also skip
  // the block rather than render an action that would just toast an
  // error on click. Computed up here (before `handleOpenInExplorer`)
  // so the handler can capture `parentDir` in its dependency list
  // without a "used before declaration" ordering bug.
  const exePath = game.path?.trim() ?? "";
  const parentDir = exePath ? getParentDir(exePath) : null;
  const showExecutable = Boolean(parentDir);
  // `shortExePath` is a constant-time string slice — no need to
  // memoize. It runs on every render but the JS work is trivial
  // (a length check + a slice).
  const displayPath = shortExePath(exePath);

  /**
   * Reveal the executable on disk by opening its parent folder in
   * the OS file manager. Uses `tauri-plugin-opener`'s `openPath` —
   * on Windows that maps to `explorer.exe <dir>`, on macOS to
   * Finder's "Open Enclosing Folder", and on Linux to the
   * appropriate xdg-open handler.
   *
   * We open the *parent* directory rather than the .exe itself so
   * a single click lands the user in Explorer to drag,
   * right-click, or share the file — never accidentally launches
   * the game. The button is only rendered when `parentDir` is a
   * real, openable directory, so this handler can assume the path
   * exists; the `try/catch` covers OS-side failures (deleted
   * folder, permissions) and surfaces them as a toast.
   */
  const handleOpenInExplorer = useCallback(async () => {
    if (!parentDir) return;
    try {
      await openPath(parentDir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`Could not open folder: ${message}`, "error");
    }
  }, [parentDir, showToast]);

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
          trailing={<IconPencil size={12} className="kpi-tile__pencil" />}
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
      // IGDB's `status` field can be stale or wrong for upcoming games
      // (e.g. GTA 6 with releaseDate 2026-11-19 still tagged "Released"
      // because IGDB flipped it to "Released" before launch). Override
      // to "Upcoming" when the release date is still in the future so
      // users aren't misled into thinking a not-yet-released title is
      // already out. We only override when the raw status is "Released"
      // — Alpha/Beta/Early Access/Cancelled are correctly independent
      // of the public release date.
      const isFutureRelease =
        !!game.releaseDate &&
        (() => {
          const t = new Date(game.releaseDate).getTime();
          return Number.isFinite(t) && t > Date.now();
        })();
      const effectiveStatus =
        isFutureRelease && game.releaseStatus.toLowerCase().includes("released")
          ? "Upcoming"
          : game.releaseStatus;
      const intent = effectiveStatus.toLowerCase().includes("released")
        ? "success"
        : effectiveStatus.toLowerCase().includes("early")
          ? "warning"
          : effectiveStatus.toLowerCase() === "upcoming"
            ? "info"
            : "default";
      out.push({
        label: "Release Status",
        value: (
          <span className={`info-dl-value-tag info-dl-value-tag--${intent}`}>
            {effectiveStatus}
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

      {/*
        Executable-path footer sits between the definition list and
        the genre chips. Placing it just above the genres — rather
        than below them — keeps the click target from being pushed
        far down on cards with many tags, while still reading as the
        card's natural footer band.
      */}
      {showExecutable && (
        <button
          type="button"
          className="info-exe-path"
          onClick={handleOpenInExplorer}
          title={`Open folder containing ${exePath}`}
          aria-label={`Open folder containing ${exePath}`}
        >
          <span className="info-exe-path__head">
            <span className="info-exe-path__folder" aria-hidden>
              <IconFolder size={12} />
            </span>
            <span className="info-exe-path__label">Executable</span>
          </span>
          <span className="info-exe-path__body">
            <span className="info-exe-path__text">{displayPath}</span>
            <span className="info-exe-path__arrow" aria-hidden>
              <IconExternalLink size={14} />
            </span>
          </span>
        </button>
      )}

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
