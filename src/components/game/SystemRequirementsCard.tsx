import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  IconLink,
  IconCpu,
  IconMemory,
  IconGpu,
  IconOs,
  IconGamepad,
  IconVrHeadset,
  IconNetwork,
  IconSoundCard,
  IconHardDrive,
  IconInfo,
} from "./icons";
import type {
  PcRequirementsPayload,
  RequirementsSpec,
} from "../../types/game";

/**
 * SystemRequirementsCard
 *
 *  Main-column card showing a game's Steam-published system
 *  requirements. Sourced Steam-first via the
 *  `get_recommended_config` Tauri command; falls back to rendering
 *  the raw `pc_requirements` HTML when the structured parser
 *  missed any spec (some games use unrecognised label formats).
 *
 *  Layout:
 *    ┌─ Card ────────────────────────────────────────────────┐
 *    │  System Requirements              from Steam          │  ← source pill
 *    │                                                        │
 *    │  [● Minimum]   [Recommended]                           │  ← segmented toggle
 *    │                                                        │
 *    │  💻 OS            Windows 10 64-bit                    │  ← spec rows
 *    │  ⚙️  Processor    Intel Core i5-8400 / AMD …          │     (icon + label +
 *    │  🧠  Memory       8 GB RAM                              │      value, with a
 *    │  🎮  Graphics     NVIDIA GeForce GTX 1060 / …          │      subtle left
 *    │  💾  Storage      60 GB available space                 │      rail colour
 *    │  🌐  Network      Broadband Internet connection        │      that flips
 *    │  🎧  Sound Card   DirectX compatible                   │      between the
 *    │  🥽  VR Support   SteamVR + Index controller           │      two tiers)
 *    │  ℹ️  Notes        Additional notes                     │
 *    │                                                        │
 *    │  View system requirements on Steam ↗                   │  ← footer link
 *    └────────────────────────────────────────────────────────┘
 *
 *  Rendering behaviour:
 *   - Self-fetches once per identity key (`steamAppId`). Re-fetches
 *     when the key changes (rare but possible after metadata
 *     enrichment resolves the steamAppId post-mount).
 *   - Last-write-wins render guards prevent the latest fetch's
 *     payload being overwritten by a stale in-flight one.
 *   - Auto-selects the more informative tier on first paint: if
 *     "recommended" exists it's the default; otherwise we lock
 *     to "minimum". The toggle disappears when only one tier has
 *     data so we never show a click target that flips to nothing.
 *   - Identical-value collapse: when the active tier equals the
 *     other tier for a given row, we render a single value with a
 *     subtle "same on both" hint, so the user can see at a glance
 *     which rows the publisher didn't differentiate between.
 *   - Falls back to the raw HTML sanitised render when the
 *     structured parser came back empty (rare — Steam usually
 *     uses canonical labels). Mirrors the AboutSection's
 *     HTML-sanitisation discipline.
 *   - Hides entirely when both Steam and the HTML fallback come
 *     back empty.
 */

interface SystemRequirementsCardProps {
  /** Steam app id — passed in so the card doesn't need to dig
   *  into the Game struct itself; lets callers override (e.g.
   *  for StoreGameDetail which derives the id from websites). */
  steamAppId?: number | null;
}

/** The two tiers Steam publishes. The card keys its UI off this
 *  enum and falls back to "minimum" when "recommended" is empty. */
type Tier = "minimum" | "recommended";

interface RowSpec {
  /** Canonical field name — matches the `RequirementsSpec` field
   *  exactly so the row renderer can read the value through a
   *  single property access without a switch ladder. */
  key: keyof RequirementsSpec;
  /** Human-readable label rendered in the left rail. */
  label: string;
  /** Icon component, sized to balance against neighbouring rows. */
  icon: React.ReactNode;
  /** Display order — rows are rendered top-to-bottom in this
   *  order so the most-glanced specs land first. */
  order: number;
}

const SPEC_ROWS: RowSpec[] = [
  { key: "os", label: "OS", icon: <IconOs size={14} />, order: 0 },
  { key: "processor", label: "Processor", icon: <IconCpu size={14} />, order: 1 },
  { key: "memory", label: "Memory", icon: <IconMemory size={14} />, order: 2 },
  { key: "graphics", label: "Graphics", icon: <IconGpu size={14} />, order: 3 },
  { key: "directX", label: "DirectX", icon: <IconInfo size={14} />, order: 4 },
  { key: "network", label: "Network", icon: <IconNetwork size={14} />, order: 5 },
  { key: "storage", label: "Storage", icon: <IconHardDrive size={14} />, order: 6 },
  { key: "soundCard", label: "Sound Card", icon: <IconSoundCard size={14} />, order: 7 },
  { key: "vrSupport", label: "VR Support", icon: <IconVrHeadset size={14} />, order: 8 },
  {
    key: "additionalNotes",
    label: "Additional Notes",
    icon: <IconGamepad size={14} />,
    order: 9,
  },
];

/**
 * Read a single field from a `RequirementsSpec`. Centralised so
 * the row renderer doesn't need a switch ladder for every key
 * (TypeScript's strict mode would otherwise force us to handle
 * each field explicitly). Returns `undefined` for any key the
 * parser didn't recognise.
 */
function readSpecField(
  spec: RequirementsSpec | undefined | null,
  key: keyof RequirementsSpec,
): string | undefined {
  if (!spec) return undefined;
  return spec[key];
}

/** Same conservative HTML denylist the AboutSection uses for
 *  Steam `about_the_game`. We don't ship DOMPurify (heavyweight
 *  added bundle), so a regex deny-list of script/handler vectors
 *  is good enough for a Steam-published spec block. The set of
 *  allowed tags (everything else) is intentionally broad so the
 *  raw fallback still renders the spec text legibly. */
function sanitizeRequirementsHtml(html: string): string {
  if (!html) return "";
  let out = html;
  // Drop entire dangerous blocks (paired opening + closing).
  out = out.replace(
    /<(script|style|iframe|object|embed|form)\b[\s\S]*?<\/\1>/gi,
    "",
  );
  // Drop self-closing dangerous tags (input, link, meta, base).
  out = out.replace(/<(input|link|meta|base)\b[^>]*\/?>/gi, "");
  // Drop any inline event handlers (onclick=, onerror=, etc.).
  out = out.replace(
    /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
    "",
  );
  // Neutralise javascript: URLs in href / src.
  out = out.replace(
    /\s(href|src)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]+)/gi,
    " $1=\"#\"",
  );
  return out;
}

export default function SystemRequirementsCard({
  steamAppId,
}: SystemRequirementsCardProps) {
  const [activeTier, setActiveTier] = useState<Tier>("recommended");
  const [payload, setPayload] = useState<PcRequirementsPayload | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Tracks whether the user has explicitly chosen a tier via the
  // segmented toggle. Until they click, the card derives the
  // active tier from the loaded payload (recommended > minimum).
  const userPickedTier = useRef(false);
  const fetchCounter = useRef(0);
  // Tracks the steamAppId we last kicked off a fetch for. Skips
  // redundant refetches when React re-renders with the same id;
  // mirrors the AboutSection's lastFetchedKey discipline.
  const lastFetchedId = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    // Same identity as last paint — skip the round-trip.
    if (lastFetchedId.current === steamAppId) return;
    lastFetchedId.current = steamAppId;

    // Reset synchronously so a re-render never shows stale tier
    // data while the new fetch is in flight. The cost is one
    // extra render with `loaded=false`; the benefit is the user
    // never sees numbers that don't match the current game.
    setPayload(null);
    setLoaded(false);

    // No Steam appid → nothing to fetch; we still flip `loaded`
    // so the component can render its empty/hidden state
    // deterministically rather than spinner-ing forever.
    if (steamAppId == null) {
      setLoaded(true);
      return;
    }

    const myCounter = ++fetchCounter.current;
    invoke<PcRequirementsPayload | null>("get_recommended_config", {
      steamAppId,
    })
      .then((result) => {
        if (myCounter !== fetchCounter.current) return;
        setPayload(result);
        setLoaded(true);
      })
      .catch(() => {
        if (myCounter !== fetchCounter.current) return;
        setPayload(null);
        setLoaded(true);
      });
  }, [steamAppId]);

  // Default the active tier to the more informative one. Steam
  // sometimes omits the recommended block entirely (e.g. older
  // indie titles), in which case we lock the toggle to "minimum"
  // and the UI hides the toggle itself so the user never sees a
  // click target that flips to nothing.
  const hasRecommended = useMemo(() => {
    const r = payload?.recommended;
    if (!r) return false;
    return Object.values(r).some(
      (v) => typeof v === "string" && v.length > 0,
    );
  }, [payload]);

  // Resolve the active tier synchronously from the loaded payload
  // — keeps the toggle's initial state consistent on first paint
  // and avoids the guaranteed mismatch an effect-driven default
  // would create. The user's explicit click (via `setActiveTier`
  // in the toggle handlers below) wins once they've interacted.
  const tier: Tier =
    loaded && !hasRecommended && !userPickedTier.current
      ? "minimum"
      : activeTier;

  // Hide the card entirely when we have nothing to show. This
  // matches the AboutSection's empty-state discipline (silently
  // drop the section rather than render a "no data" placeholder
  // card that adds visual noise).
  const hasAnyMinimum = !!payload?.minimum;
  const hasAnyRecommended = !!payload?.recommended;
  const hasAnyHtml =
    !!payload?.minimumHtml || !!payload?.recommendedHtml;
  if (loaded && !hasAnyMinimum && !hasAnyRecommended && !hasAnyHtml) {
    return null;
  }
  // No Steam appid and not yet loaded — keep the card hidden so
  // we don't flash a spinner for the store-detail path before
  // the parent resolves the steamAppId from websites.
  if (!loaded && steamAppId == null) return null;

  const sourceLabel = payload?.sourceName ?? null;
  const minimum = payload?.minimum ?? null;
  const recommended = payload?.recommended ?? null;
  const minimumHtml = payload?.minimumHtml ?? "";
  const recommendedHtml = payload?.recommendedHtml ?? "";
  const sourceUrl = payload?.sourceUrl ?? null;

  // Active vs. other tier slot. Declared BEFORE `visibleRows`
  // because the filter callback below reads these — declaring
  // them in the wrong order would hit the const TDZ the first
  // time `visibleRows.length` forces the filter to evaluate.
  const activeSpec =
    tier === "recommended" ? recommended : minimum;
  const otherSpec = tier === "recommended" ? minimum : recommended;

  // Render rows that have a value on EITHER tier so the
  // comparison stays vertically aligned. A row with only an
  // "other tier" value gets a "—" placeholder on the active
  // side — keeps the eye-locked column from jumping when the
  // user toggles between tiers.
  const visibleRows = SPEC_ROWS.filter((row) => {
    const a = readSpecField(activeSpec, row.key);
    const b = readSpecField(otherSpec, row.key);
    return !!a || !!b;
  }).sort((a, b) => a.order - b.order);

  const showToggle = hasRecommended && hasAnyMinimum;
  const totalRowCount = visibleRows.length;

  return (
    <section className="game-section system-requirements-card">
      <header className="system-requirements-card__header">
        <h2 className="game-section-title system-requirements-card__title">
          <span className="game-section-title__icon" aria-hidden>
            <IconCpu size={16} />
          </span>
          System Requirements
          {sourceLabel && (
            <span
              className={`system-requirements-card__source-pill system-requirements-card__source-pill--${payload?.source ?? "steam"}`}
              aria-label={`Source: ${sourceLabel}`}
            >
              from {sourceLabel}
            </span>
          )}
        </h2>
        {showToggle && (
          <div
            className="system-requirements-card__toggle"
            role="tablist"
            aria-label="System requirements tier"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tier === "minimum"}
              className={`system-requirements-card__toggle-option${tier === "minimum" ? " system-requirements-card__toggle-option--active" : ""}`}
              onClick={() => {
                userPickedTier.current = true;
                setActiveTier("minimum");
              }}
            >
              Minimum
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tier === "recommended"}
              className={`system-requirements-card__toggle-option${tier === "recommended" ? " system-requirements-card__toggle-option--active" : ""}`}
              onClick={() => {
                userPickedTier.current = true;
                setActiveTier("recommended");
              }}
            >
              Recommended
            </button>
          </div>
        )}
      </header>

      {/* Structured-spec renderer. We fall through to the raw-HTML
       *  renderer when the parser returned nothing usable but
       *  Steam did publish HTML — keeps the user informed for
       *  the rare game whose spec block uses non-canonical
       *  labels. */}
      {totalRowCount > 0 ? (
        <div className="system-requirements-card__rows" role="tabpanel">
          {visibleRows.map((row) => {
            const activeValue = readSpecField(activeSpec, row.key);
            const otherValue = readSpecField(otherSpec, row.key);
            const sameAsOther =
              !!activeValue &&
              !!otherValue &&
              activeValue.trim().toLowerCase() ===
                otherValue.trim().toLowerCase();
            return (
              <div
                key={row.key}
                className={`system-requirements-card__row${sameAsOther ? " system-requirements-card__row--identical" : ""}`}
              >
                <span className="system-requirements-card__row-icon" aria-hidden>
                  {row.icon}
                </span>
                <span className="system-requirements-card__row-label">
                  {row.label}
                </span>
                <span className="system-requirements-card__row-value">
                  {activeValue ?? (
                    <span className="system-requirements-card__row-empty">
                      —
                    </span>
                  )}
                  {sameAsOther && (
                    <span
                      className="system-requirements-card__row-tag"
                      aria-label="Same on minimum"
                      title="Same value on the other tier"
                    >
                      same
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <RawRequirementsHtml
          html={
            tier === "recommended"
              ? recommendedHtml || minimumHtml
              : minimumHtml || recommendedHtml
          }
        />
      )}

      {(payload?.sourceUrl || sourceUrl) && (
        <a
          className="metadata-source-link system-requirements-card__source-link"
          href={sourceUrl ?? payload?.sourceUrl ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
        >
          <IconLink size={14} />
          View system requirements on {sourceLabel ?? "Steam"}
        </a>
      )}
    </section>
  );
}

/**
 * Fallback renderer for games whose Steam pc_requirements block
 * uses non-canonical labels our parser doesn't recognise.
 * Mirrors the AboutSection's HTML-sanitisation pipeline so the
 * unrecognised block doesn't introduce an XSS vector.
 */
function RawRequirementsHtml({ html }: { html: string }) {
  if (!html) return null;
  const safe = sanitizeRequirementsHtml(html);
  if (!safe) return null;
  return (
    <div
      className="system-requirements-card__raw"
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}
