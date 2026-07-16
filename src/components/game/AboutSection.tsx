import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Game, RichAboutPayload } from "../../types/game";
import { IconFileText, IconLink, IconChevronDown, IconPlay } from "./icons";

/**
 * AboutSection
 *
 *  Main-column "About" card. Sourced Steam-first (HTML body with
 *  embedded GIFs/images + `movies[]` trailers) via the
 *  `get_about_section` Tauri command; falls back to IGDB plain
 *  text when Steam is unavailable.
 *
 *  Collapse behaviour:
 *   - **Collapsed by default** with a peek of the first paragraph.
 *     A `max-height` clip on `.about-section__body-clip` shows the
 *     top of the prose + a bottom mask fade — the user always
 *     sees "what this section is about" without clicking.
 *   - The "Show about" / "Hide about" toggle sits **bottom-centre**
 *     of the card (not the header) so it reads as the section's
 *     primary action, mirroring the universal "Show More" pattern.
 *   - When the prose has no rich HTML and no trailers (plain IGDB
 *     fallback), the section auto-expands because the peek wouldn't
 *     add meaningful content — and the footer+toggle are not rendered.
 *   - Heavy children (images, headings, trailers, "View on" link) are
 *     hidden via CSS `display: none` in the collapsed state, which
 *     also removes them from the accessibility tree. So screen
 *     readers hear only the prose peek — matching the visual.
 *     Combined with the toggle button's `aria-expanded` +
 *     `aria-controls`, SC users can navigate state deliberately
 *     instead of sifting through dozens of `<img>` alt texts.
 *
 *  Rendering behaviour:
 *   - Self-fetches once per identity key (`steamAppId | slug | name`).
 *     Re-fetches when any of those change (rare but possible after
 *     metadata enrichment resolves the steamAppId post-mount).
 *   - Last-write-wins render guards prevent the latest fetch's
 *     payload being overwritten by a stale in-flight one.
 *   - Renders Steam `about_html` inside a sanitized container
 *     via `dangerouslySetInnerHTML`. Steam doesn't inject
 *     `<script>` or event handlers in practice, but we still
 *     scrub dangerous tags + `on*=` event attributes + `javascript:`
 *     URLs before insertion — defence in depth.
 *   - Falls back to the legacy `game.description` field if both
 *     Steam and IGDB come back empty.
 */

interface AboutSectionProps {
  game: Game;
  /** Steam app id — passed in so the section doesn't need to dig
   *  into the Game struct itself; lets callers override (e.g. for
   *  StoreGameDetail which derives the id from websites). */
  steamAppId?: number | null;
  /** IGDB slug — used by StoreGameDetail as a stable identity for
   *  fetch-routing. Forwarded to the Rust side as a fallback
   *  identifier when Steam is unavailable. */
  igdbSlug?: string | null;
  /** Optional user-provided game name override (used when the
   *  section is rendered before the library row has saved its
   *  name). */
  gameNameOverride?: string;
}

/**
 * Minimal HTML sanitizer for Steam's `about_the_game` payload. We
 * don't ship DOMPurify (heavyweight added bundle), so we use a
 * conservative regex set — Steam in practice only delivers
 * `<h1>`/`<h2>`/`<p>`/`<img>`/`<br>`/`<a>`/`<ul>`/`<li>` markup
 * inside this field, so a strict deny-list of dangerous tags +
 * event handlers still renders look great while blocking the only
 * realistic XSS vectors.
 *
 * Deny-list rationale (each tag stripped would let an attacker
 * embed script, exfiltrate data, or rewrite the page):
 *   - <script>, <style>          — obvious script / CSS injection
 *   - <iframe>, <object>, <embed> — embed arbitrary content /
 *                                   remote HTML (phishing surface)
 *   - <form>, <input>             — fake-login / credential theft
 *   - <link>, <meta>, <base>      — can override document URL /
 *                                   load external CSS + scripts
 *
 * Also scrubbed: `on*=` event handler attributes (any lowercase
 * prefix) and `javascript:` URLs in any `href` / `src`.
 *
 * Note: tag stripping is naive (no DOM/tree awareness). For a
 * fully-correct sanitizer we'd ship DOMPurify; for now this
 * covers the actual attack surface while staying small.
 */
function sanitizeSteamHtml(html: string): string {
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
  out = out.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // Neutralise javascript: URLs in href / src.
  out = out.replace(
    /\s(href|src)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]+)/gi,
    " $1=\"#\"",
  );
  return out;
}

/**
 * Compute the human-readable "X articles, Y videos hidden" string
 * we render inside the collapsed-state toggle button. Counts
 * `<p>`/`<img>`/`<li>` from the HTML (rough) plus the trailers
 * count so the user knows what they'll reveal on click.
 */
function summarisePayload(payload: RichAboutPayload | null): string | null {
  if (!payload) return null;
  const html = payload.aboutHtml || "";
  const pCount = (html.match(/<p\b/gi) ?? []).length;
  const imgCount = (html.match(/<img\b/gi) ?? []).length;
  const movieCount = payload.movies.length;
  const bits: string[] = [];
  if (pCount > 0) bits.push(`${pCount} paragraphs`);
  if (imgCount > 0) bits.push(`${imgCount} images`);
  if (movieCount > 0) bits.push(`${movieCount} video${movieCount === 1 ? "" : "s"}`);
  if (bits.length === 0) return null;
  return bits.join(" \u00b7 ");
}

export default function AboutSection({
  game,
  steamAppId,
  igdbSlug,
  gameNameOverride,
}: AboutSectionProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [payload, setPayload] = useState<RichAboutPayload | null>(null);
  const [loaded, setLoaded] = useState(false);
  const fetchCounter = useRef(0);
  // Tracks the identity key we last kicked off a fetch for. If
  // the same key reappears in a re-render, we skip the refetch
  // (the Rust-side cache will satisfy a same-key remount from
  // a fresh component instance). When the key changes (e.g. the
  // parent enriches the game with a real steamAppId post-mount),
  // we re-fetch.
  const lastFetchedKey = useRef<string | null>(null);

  // Resolve the most useful identifiers to build the identity key.
  // Steam id first, game name as the IGDB fallback. Slug is
  // forwarded into the key so two IGDB-slugged games with the
  // same name don't share a fetch slot.
  const identityKey = useMemo(() => {
    const steam = steamAppId ?? game.steamAppId ?? "";
    const name = gameNameOverride ?? game.name ?? "";
    const slug = igdbSlug ?? "";
    return `${steam}|${slug}|${name}`;
  }, [steamAppId, game.steamAppId, gameNameOverride, game.name, igdbSlug]);

  useEffect(() => {
    // Skip refetches when React re-renders with the same identity.
    // `identityKey` already encodes all three backend-identifying
    // inputs (steam + slug + name) so the deps array intentionally
    // lists only it — the individual props never need to change
    // without identityKey changing first.
    if (lastFetchedKey.current === identityKey) return;
    lastFetchedKey.current = identityKey;

    // Reset synchronously so a single render paint doesn't show
    // the previous payload (with a now-stale source pill / movie
    // list) while the new fetch is in flight. The cost is one
    // extra render with `loaded=false`; the benefit is the user
    // never sees numbers/links that don't match the current game.
    setPayload(null);
    setLoaded(false);

    const steam = steamAppId ?? game.steamAppId ?? null;
    const name = gameNameOverride ?? game.name ?? null;
    const myCounter = ++fetchCounter.current;

    invoke<RichAboutPayload | null>("get_about_section", {
      steamAppId: steam ?? undefined,
      gameName: name ?? undefined,
    })
      .then((result) => {
        // Last-write-wins: ignore a stale response from a prior
        // mount (e.g. user navigated between games quickly).
        if (myCounter !== fetchCounter.current) return;
        setPayload(result);
        setLoaded(true);
      })
      .catch(() => {
        if (myCounter !== fetchCounter.current) return;
        setPayload(null);
        setLoaded(true);
      });
    // `identityKey` already captures `igdbSlug`; the individual
    // props are listed for clarity / lint-narrowing documentation
    // rather than as load-bearing deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    identityKey,
    steamAppId,
    gameNameOverride,
    game.name,
    game.steamAppId,
  ]);

  // If the fetch returned nothing AND the legacy description
  // field is also empty, hide the section entirely (preserve
  // pre-feature behaviour for games with zero description).
  if (loaded && !payload && !game.description) return null;
  if (!loaded && !game.description) return null;

  // Plain fallback path: no rich payload, only legacy description.
  // Auto-expand in that case so the user sees the text without
  // having to click a non-existent "more content" toggle.
  const plainTextOnly =
    loaded && !payload?.aboutHtml && (payload?.movies?.length ?? 0) === 0;
  const effectiveCollapsed = plainTextOnly ? false : collapsed;

  const sourceLabel =
    payload?.sourceName ?? (game.metadataSource as string | undefined) ?? null;
  const summaryHint = summarisePayload(payload);

  return (
    <section className="game-section about-section">
      <header className="about-section__header">
        <h2 className="game-section-title about-section__title">
          <span className="game-section-title__icon" aria-hidden>
            <IconFileText size={16} />
          </span>
          About
          {sourceLabel && (
            <span
              className={`about-section__source-pill about-section__source-pill--${payload?.source ?? "manual"}`}
              aria-label={`Source: ${sourceLabel}`}
            >
              from {sourceLabel}
            </span>
          )}
        </h2>
      </header>

      <div
        className={`about-section__body-clip${effectiveCollapsed ? " about-section__body-clip--collapsed" : " about-section__body-clip--expanded"}`}
      >
      <div
        id="about-section-body"
        className="about-section__body"
      >
        {payload?.aboutHtml ? (
          <div
            className="about-html"
            // Sanitized above via `sanitizeSteamHtml`. Steam's
            // `about_the_game` field is curated HTML but we still
            // scrub for script/handler vectors as defence in
            // depth. The output is intentional.
            dangerouslySetInnerHTML={{ __html: sanitizeSteamHtml(payload.aboutHtml) }}
          />
        ) : payload?.aboutText || game.description ? (
          <p className="game-description about-section__text">
            {payload?.aboutText ?? game.description}
          </p>
        ) : null}

        {payload && payload.movies.length > 0 && (
          <div className="about-movies" aria-label="Trailers & gameplay videos">
            {payload.movies.map((m) => (
              <AboutMovieTile key={m.id} movie={m} />
            ))}
          </div>
        )}

        {(payload?.sourceUrl || game.metadataUrl) && (
          <a
            className="metadata-source-link"
            href={payload?.sourceUrl ?? game.metadataUrl ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
          >
            <IconLink size={14} />
            View on {payload?.sourceName ?? game.metadataSource ?? "source"}
          </a>
        )}
      </div>
      </div>

      {!plainTextOnly && (
        <footer className="about-section__footer">
          <button
            type="button"
            className="about-section__toggle"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!effectiveCollapsed}
            aria-controls="about-section-body"
          >
            <span className="about-section__toggle-label">
              {effectiveCollapsed ? "Show about" : "Hide about"}
            </span>
            {summaryHint && effectiveCollapsed && (
              <span className="about-section__toggle-hint">{summaryHint}</span>
            )}
            <IconChevronDown
              size={14}
              className={`about-section__toggle-chevron${effectiveCollapsed ? " about-section__toggle-chevron--collapsed" : ""}`}
            />
          </button>
        </footer>
      )}
    </section>
  );
}

/**
 * Lightweight `<video>` tile rendering one Steam movie entry.
 * Plays inline on hover / click; respects native controls so the
 * user can scrub, fullscreen, or adjust volume. Uses webm when
 * available, mp4 as the universal fallback — declared via
 * `<source>` so the browser picks the best supported codec.
 */
function AboutMovieTile({ movie }: { movie: RichAboutPayload["movies"][number] }) {
  const sources: { src: string; type: string }[] = [];
  if (movie.webm) sources.push({ src: movie.webm, type: "video/webm" });
  if (movie.mp4) sources.push({ src: movie.mp4, type: "video/mp4" });
  const hasAny = sources.length > 0;
  const accessibleName = movie.name || (movie.highlight ? "Highlight reel" : "Trailer");

  return (
    <div
      className={`about-movie-tile${movie.highlight ? " about-movie-tile--highlight" : ""}`}
    >
      {hasAny ? (
        <video
          controls
          preload="none"
          poster={movie.thumbnail || undefined}
          playsInline
          aria-label={accessibleName}
          className="about-movie-tile__video"
        >
          {sources.map((s) => (
            <source key={s.src} src={s.src} type={s.type} />
          ))}
        </video>
      ) : (
        <div
          className="about-movie-tile__poster-only"
          style={
            movie.thumbnail
              ? { backgroundImage: `url(${movie.thumbnail})` }
              : undefined
          }
          aria-label={accessibleName}
          role="img"
        />
      )}
      <div className="about-movie-tile__meta">
        {!hasAny && (
          <span className="about-movie-tile__play-icon" aria-hidden>
            <IconPlay size={16} />
          </span>
        )}
        <span className="about-movie-tile__name">{accessibleName}</span>
      </div>
    </div>
  );
}
