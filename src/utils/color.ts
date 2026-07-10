/**
 * Color utility — dynamic accent generation and hex/RGB helpers.
 *
 * Used by ThemeContext to auto-derive accent-adjacent colors
 * (hover, active, glow, soft) from a base accent hex so that
 * custom themes don't need to hand-tune every shade.
 */

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface AccentStates {
  base: string;
  hover: string;
  active: string;
  glow: string;
  soft: string;
}

/** Parse a 3- or 6-char hex string (with or without `#`) into RGB. */
export function hexToRgb(hex: string): RgbColor {
  let h = hex.replace("#", "");
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  const num = parseInt(h, 16);
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  };
}

/** Convert RGB object back to `#rrggbb` hex. */
export function rgbToHex({ r, g, b }: RgbColor): string {
  const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Lighten an RGB color by mixing it with white.
 * @param factor 0–1 where 0 = no change, 1 = full white.
 */
export function lighten(color: RgbColor, factor: number): RgbColor {
  const f = Math.min(1, Math.max(0, factor));
  return {
    r: color.r + (255 - color.r) * f,
    g: color.g + (255 - color.g) * f,
    b: color.b + (255 - color.b) * f,
  };
}

/**
 * Darken an RGB color by mixing it with black.
 * @param factor 0–1 where 0 = no change, 1 = full black.
 */
export function darken(color: RgbColor, factor: number): RgbColor {
  const f = Math.min(1, Math.max(0, factor));
  return {
    r: color.r * (1 - f),
    g: color.g * (1 - f),
    b: color.b * (1 - f),
  };
}

/**
 * Generate CSS-ready accent state tokens from a base hex color.
 *
 * Returns `color-mix()`-based strings for `hover`, `active`,
 * `glow`, and `soft`, which can be dropped directly into
 * CSS custom properties or inline styles.
 *
 * Also returns the base hex and an `rgb` object with
 * programmatically computed lighten/darken values for
 * canvas or dynamic style use.
 */
export function generateAccentStates(baseHex: string): {
  base: string;
  hover: string;
  active: string;
  glow: string;
  soft: string;
  /** JS-computed RGB equivalents (useful for canvas, inline style overrides). */
  js: { hover: string; active: string };
} {
  const rgb = hexToRgb(baseHex);

  return {
    base: baseHex,
    hover: `color-mix(in srgb, ${baseHex} 85%, white 15%)`,
    active: `color-mix(in srgb, ${baseHex} 70%, black 30%)`,
    glow: `color-mix(in srgb, ${baseHex} 25%, transparent)`,
    soft: `color-mix(in srgb, ${baseHex} 15%, var(--color-bg-secondary))`,
    js: {
      hover: rgbToHex(lighten(rgb, 0.15)),
      active: rgbToHex(darken(rgb, 0.3)),
    },
  };
}

/**
 * Compute relative luminance from RGB (sRGB, linearized).
 * Used for contrast-ratio calculations and determining whether
 * overlays should use light or dark text.
 */
export function luminance({ r, g, b }: RgbColor): number {
  const linearize = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
  );
}

/** WCAG AA contrast ratio between two hex colors (1–21). */
export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = luminance(hexToRgb(hex1));
  const l2 = luminance(hexToRgb(hex2));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Returns `#ffffff` or `#000000` depending on which has better
 * contrast against the given background hex.
 */
export function textColorFor(backgroundHex: string): "#ffffff" | "#000000" {
  return contrastRatio(backgroundHex, "#ffffff") >= 4.5
    ? "#ffffff"
    : "#000000";
}

/* ============================================================================
 * html2canvas compat: color-mix() removal
 * ========================================================================== */

/**
 * Placeholder rgba() substituted for any `color-mix()` call that
 * could not be resolved. We prefer a half-transparent gray blob in
 * the captured image over aborting the screenshot — a screenshot
 * with one gray patch is more useful than no screenshot at all.
 */
const FALLBACK_PLACEHOLDER = "rgba(127,127,127,0.5)";

/**
 * html2canvas 1.4.1 doesn't understand the CSS Color Module L4
 * `color-mix(in srgb, A pct%, B)` function (it throws "Attempting to
 * parse an unsupported color function 'color'"). This project uses
 * `color-mix()` heavily throughout theme tokens, so we pre-process the
 * cloned document — every `color-mix()` call is resolved against the
 * *original* document's computed style and replaced with an `rgba(...)`
 * literal html2canvas can parse.
 *
 * Call from html2canvas's `onclone` hook, *before* html2canvas reads
 * computed styles:
 *
 *   html2canvas(el, { onclone: resolveHtml2CanvasColorMix });
 *
 * The function scrubs four surfaces:
 *   1. **Recursive CSSOM walk** — every CSSStyleDeclaration reachable
 *      from the cloned document's stylesheets. Recurses into
 *      `@media`, `@supports`, `@keyframes`, `@container`, `@layer`
 *      grouping rules so nested `color-mix()` declarations are caught.
 *   2. **Raw `<style>` textContent** — belt-and-suspenders in case
 *      html2canvas re-parses style-tag text directly.
 *   3. **Inline `style="…"` attributes** — including programmatically
 *      assigned color-mix literals.
 *   4. **Cascading CSS custom properties** on `:root` / `html` /
 *      `[data-theme]` selectors — declared vars are force-set on the
 *      cloned `<html>` element with the resolved rgba so any
 *      downstream `var(--…)` lookup bypasses the unresolved
 *      `color-mix()` definition.
 *
 * Cross-origin stylesheets throw `SecurityError` on `.cssRules`
 * access; those are skipped silently.
 *
 * @param clonedDoc the Document html2canvas just cloned
 * @param _element  passed by html2canvas's `onclone` signature; unused
 *                  (kept for callback-type compatibility)
 * @param sourceDoc the live Document whose computed styles we resolve
 *                  from (defaults to `window.document`)
 */
export function resolveHtml2CanvasColorMix(
  clonedDoc: Document,
  _element?: HTMLElement,
  sourceDoc: Document =
    typeof window !== "undefined" ? window.document : clonedDoc
): void {
  // 1) Recursive CSSOM walker — handles @media, @supports, @keyframes,
  //    @container, @layer, and keyframe blocks in one pass.
  for (let s = 0; s < clonedDoc.styleSheets.length; s++) {
    const sheet = clonedDoc.styleSheets[s] as CSSStyleSheet;
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // Cross-origin sheet — can't read its rules, leave alone.
      continue;
    }
    walkClonedRules(rules, sourceDoc);
  }

  // 2) Scrub raw <style> element textContent. A successful Phase 1
  //    means this is a no-op; if some browser quirk left the original
  //    text in place (or html2canvas reads textContent directly), this
  //    catches it before html2canvas's parser sees it.
  clonedDoc.querySelectorAll("style").forEach((styleEl) => {
    const text = styleEl.textContent;
    if (!text || !text.includes("color-mix")) return;
    styleEl.textContent = rewriteColorMixValue(text, sourceDoc);
  });

  // 3) Inline [style] attributes on every element.
  clonedDoc.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
    const inline = el.getAttribute("style");
    if (!inline || !inline.includes("color-mix")) return;
    el.setAttribute("style", rewriteColorMixValue(inline, sourceDoc));
  });

  // 4) Force-overriding any `:root` / `html` / `[data-theme]`
  //    cascading CSS variable whose declared value is `color-mix(...)`.
  //    Note: because we read declarations from every theme selector in
  //    the live doc, the cloned `<html>` ends up with variables from
  //    every theme, but only the active theme's values affect
  //    `getComputedStyle()` so visual fidelity is preserved.
  overrideClonedCssVars(clonedDoc, sourceDoc);
}

/**
 * Recursive walker over a CSS rule list. Handles nested grouping
 * rules so a `color-mix()` declared inside a media-query body is
 * still rewritten. Caps recursion depth for safety on pathological
 * inputs.
 *
 * Rule type constants (MDN):
 *   - 1  = CSSStyleRule
 *   - 4  = CSSMediaRule
 *   - 7  = CSSKeyframesRule
 *   - 8  = CSSKeyframeRule (e.g. `0% { ... }`)
 *   - 12 = CSSSupportsRule
 *   - 13 = CSSLayerBlockRule
 *   - 14 = CSSContainerRule
 */
function walkClonedRules(
  rules: CSSRuleList,
  sourceDoc: Document,
  depth: number = 0
): void {
  if (depth > 32 || !rules) return;
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i] as CSSRule;
    let type: number;
    try {
      type = rule.type;
    } catch {
      continue;
    }
    // Style / Keyframe declaration blocks — both expose `.style`.
    if (type === 1 || type === 8) {
      const styleRule = rule as CSSStyleRule | CSSKeyframeRule;
      if (!styleRule.style) continue;
      rewriteDeclaration(styleRule.style, sourceDoc);
      continue;
    }
    // Grouping rules — recurse into their nested cssRules.
    if (
      type === 4 || // CSSMediaRule
      type === 7 || // CSSKeyframesRule
      type === 12 || // CSSSupportsRule
      type === 13 || // CSSLayerBlockRule
      type === 14 // CSSContainerRule
    ) {
      try {
        const nested = (rule as CSSGroupingRule | CSSKeyframesRule).cssRules;
        if (nested) walkClonedRules(nested, sourceDoc, depth + 1);
      } catch {
        /* nested access can throw on cross-origin rules */
      }
    }
  }
}

/**
 * Rewrite every property on `style` whose value contains `color-mix(`.
 *
 * Snapshots the property list first because `setProperty` may shift
 * property indices, and preserves the original priority — adding
 * `!important` to a declaration that didn't have one would change the
 * cascade and could flip what html2canvas renders vs. what the live
 * page showed.
 */
function rewriteDeclaration(
  style: CSSStyleDeclaration,
  sourceDoc: Document
): void {
  const props: string[] = [];
  for (let p = 0; p < style.length; p++) {
    props.push(style.item(p));
  }
  for (const prop of props) {
    const val = style.getPropertyValue(prop);
    if (typeof val !== "string" || !val.includes("color-mix")) continue;
    const next = rewriteColorMixValue(val, sourceDoc);
    if (!next || next === val) continue;
    const priority = style.getPropertyPriority(prop);
    try {
      // Empty-string priority means "no `!important`" — preserve
      // original semantics exactly.
      style.setProperty(prop, next, priority || "");
    } catch {
      /* property is invalid for this declaration; ignore */
    }
  }
}

/**
 * For every `color-mix()` declaration on `:root` / `html` /
 * `[data-theme]` in the source doc, force the resolved rgba onto the
 * cloned document's `<html>` element so the cascade no longer relies
 * on the unresolved `color-mix()` value (which html2canvas may walk).
 *
 * Restricts `[data-theme="…"]` selectors to the *active* theme on the
 * cloned doc — the previous revision wrote vars for every theme,
 * letting whichever theme's rule was processed last override the
 * active theme's vars and skew capture colour fidelity.
 */
function overrideClonedCssVars(
  clonedDoc: Document,
  sourceDoc: Document
): void {
  if (!sourceDoc || !sourceDoc.styleSheets) return;
  // Read the active theme *once* from the cloned doc's <html> and
  // pass it down so theme-specific rules are filtered correctly.
  const activeTheme = (
    clonedDoc.documentElement.getAttribute("data-theme") || ""
  ).toLowerCase();
  for (let s = 0; s < sourceDoc.styleSheets.length; s++) {
    let rules: CSSRuleList;
    try {
      rules = sourceDoc.styleSheets[s].cssRules;
    } catch {
      continue;
    }
    collectAndOverrideCssVars(rules, clonedDoc, sourceDoc, activeTheme);
  }
}

function collectAndOverrideCssVars(
  rules: CSSRuleList,
  clonedDoc: Document,
  sourceDoc: Document,
  activeTheme: string = "",
  depth: number = 0
): void {
  if (depth > 32 || !rules) return;
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i] as CSSRule;
    let type: number;
    try {
      type = rule.type;
    } catch {
      continue;
    }
    if (type === 1) {
      const styleRule = rule as CSSStyleRule;
      if (!styleRule.style) continue;
      const sel = (styleRule.selectorText || "").toLowerCase().trim();
      // Decide whether this rule's variables should override the
      // cloned root. `:root` and `html` apply unconditionally;
      // `[data-theme="X"]` only applies if `X` is the active theme;
      // `[data-theme]` (no value) applies when any theme is set.
      let shouldInclude = false;
      if (sel.includes(":root")) {
        shouldInclude = true;
      } else if (sel.split(",").some((part) => /^html\b/.test(part.trim()))) {
        // Compounds like `html.foo`, `html#id`, `html[lang]`, `html:hover`
        // all start with `html` as a complete identifier; comma-splitting
        // handles `html, body` style lists correctly.
        shouldInclude = true;
      } else if (sel.includes("[data-theme")) {
        const m = sel.match(/data-theme\s*=\s*"?([^"\]]+)/);
        if (m) {
          shouldInclude = m[1].trim().toLowerCase() === activeTheme;
        } else {
          shouldInclude = activeTheme.length > 0;
        }
      }
      if (!shouldInclude) continue;
      for (let p = 0; p < styleRule.style.length; p++) {
        const prop = styleRule.style.item(p);
        if (!prop.startsWith("--")) continue;
        const val = styleRule.style.getPropertyValue(prop);
        if (!val || !val.includes("color-mix")) continue;
        const next = rewriteColorMixValue(val, sourceDoc);
        if (!next || next === val) continue;
        try {
          clonedDoc.documentElement.style.setProperty(prop, next, "important");
        } catch {
          /* ignore */
        }
      }
    } else if (
      type === 4 || type === 7 || type === 12 || type === 13 || type === 14
    ) {
      try {
        const nested = (rule as CSSGroupingRule | CSSKeyframesRule).cssRules;
        if (nested) {
          // Carry `activeTheme` through recursion so nested theme-scoped
          // rules (e.g. `[data-theme="dark"]` inside an `@media` block)
          // still see the active theme and are included.
          collectAndOverrideCssVars(
            nested,
            clonedDoc,
            sourceDoc,
            activeTheme,
            depth + 1
          );
        }
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Replace every `color-mix(in srgb, A, B)` substring inside a CSS
 * declaration with a computed `rgba(...)` literal.
 *
 * This is a *linear left-to-right* scanner with balanced-paren call
 * detection — earlier revisions tried to fold nested calls in a
 * iterative loop and produced incorrect output for multi-call
 * declarations. We also append a final safety pass that substitutes
 * `rgba(127,127,127,0.5)` for any remaining `color-mix(...)` (e.g.
 * in a browser that doesn't support `in oklab`, etc.) so html2canvas
 * never sees an unrecognized color-function literal.
 */
function rewriteColorMixValue(value: string, sourceDoc: Document): string {
  if (!value.includes("color-mix")) return value;
  if (!sourceDoc || !sourceDoc.body) return value;

  const probe = sourceDoc.createElement("div");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.top = "-9999px";
  probe.style.left = "-9999px";
  sourceDoc.body.appendChild(probe);

  try {
    let out = "";
    let cursor = 0;
    let i = 0;
    while (i < value.length) {
      const idx = value.indexOf("color-mix(", i);
      if (idx === -1) break;
      // Emit the unchanged gap before this call.
      out += value.slice(cursor, idx);
      // Find the matching close paren of this color-mix(...) call.
      let d = 1;
      let j = idx + "color-mix(".length;
      while (j < value.length && d > 0) {
        const c = value[j];
        if (c === "(") d++;
        else if (c === ")") d--;
        j++;
      }
      if (d !== 0) {
        // Malformed — emit the rest verbatim and bail.
        out += value.slice(idx);
        cursor = value.length;
        break;
      }
      const raw = value.slice(idx, j);
      out += resolveColorMixCall(raw, sourceDoc, probe, 0);
      cursor = j;
      i = j;
    }
    out += value.slice(cursor);

    // Safety pass: any `color-mix(...)` that survives (unsupported
    // color space, malformed argument, etc.) is replaced with a
    // neutral placeholder. Without this we'd re-throw the same
    // html2canvas parse error on a single regression.
    return out.replace(/color-mix\s*\([^)]*\)/gi, FALLBACK_PLACEHOLDER);
  } finally {
    if (probe.parentNode) sourceDoc.body.removeChild(probe);
  }
}

/**
 * Resolve a single `color-mix(...)` call (raw text including the
 * `color-mix(` prefix and the closing `)`) to a CSS `rgba(...)`
 * literal. Recursively handles nested `color-mix(...)` inside args.
 */
function resolveColorMixCall(
  raw: string,
  sourceDoc: Document,
  probe: HTMLElement,
  depth: number
): string {
  if (depth > 32) return FALLBACK_PLACEHOLDER;
  const inner = raw.slice("color-mix(".length, -1);
  const args = splitTopComma(inner);
  if (args.length < 3) {
    // ES legacy 2-arg form (no color space keyword) — unsupported.
    return FALLBACK_PLACEHOLDER;
  }
  if (!/^\s*in\s+srgb\s*$/i.test(args[0].trim())) {
    // Only `in srgb` is wired up. Don't silently swallow; warn so
    // the dev knows to extend the resolver.
    if (typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.warn("[color-mix] Unsupported color space:", args[0]);
    }
    return FALLBACK_PLACEHOLDER;
  }

  let aTok = args[1].trim();
  let pct = 50;
  const aPct = aTok.match(/^(.+?)\s+([\d.]+)%\s*$/);
  if (aPct) {
    aTok = aPct[1].trim();
    pct = parseFloat(aPct[2]);
  }
  const bTok = args[2].trim();

  const a = resolveSingleColor(aTok, sourceDoc, probe, depth + 1);
  const b = resolveSingleColor(bTok, sourceDoc, probe, depth + 1);
  if (!a || !b) return FALLBACK_PLACEHOLDER;
  const w = Math.min(1, Math.max(0, pct / 100));
  const [r, g, bl, al] = mixLinearRgb(a, b, w);
  return `rgba(${r}, ${g}, ${bl}, ${al})`;
}

/**
 * Resolve a CSS color expression — hex, rgb()/rgba(), hsl()/hsla(),
 * a keyword (`white`, `black`, `transparent`), a `var(--…)` chain,
 * or a *nested* `color-mix(...)` call — to a `[r, g, b, a]` tuple.
 *
 * Defining a single helper lets us pre-fold nested color-mix
 * without depending on the runtime browser's color-mix support
 * (Tauri 2.x's WebView on older Windows builds may pre-date Chromium
 * 111 and choke on the function).
 */
function resolveSingleColor(
  token: string,
  sourceDoc: Document,
  probe: HTMLElement,
  depth: number
): [number, number, number, number] | null {
  const trimmed = token.trim();
  if (!trimmed) return null;

  // Nested color-mix(...) — recurse. Bump depth so the cap at 32
  // correctly truncates truly deep nesting rather than collapsing it.
  if (/^color-mix\s*\(/i.test(trimmed)) {
    let d = 1;
    let j = "color-mix(".length;
    while (j < trimmed.length && d > 0) {
      const c = trimmed[j];
      if (c === "(") d++;
      else if (c === ")") d--;
      j++;
    }
    if (d !== 0) return null;
    const raw = trimmed.slice(0, j);
    const rgba = resolveColorMixCall(raw, sourceDoc, probe, depth + 1);
    return parseColorString(rgba);
  }

  // Fold any var() chains so we end up with a single literal/varname
  // pointer that the browser can resolve through getComputedStyle.
  let cur = trimmed;
  let safety = 0;
  while (cur.includes("var(") && safety++ < 32) {
    const idx = cur.indexOf("var(");
    const close = findCloseParen(cur, idx + "var".length);
    if (close < 0) break;
    const varExpr = cur.slice(idx, close + 1);
    const m = varExpr.match(/^var\(\s*(--[\w-]+)/);
    if (!m) break;
    const name = m[1].trim();
    let fallback = "";
    const argContent = varExpr.slice(name.length + "var(".length, -1);
    const topComma = findTopComma(argContent);
    if (topComma >= 0) fallback = argContent.slice(topComma + 1).trim();

    probe.style.color = `var(${name}${fallback ? ", " + fallback : ""})`;
    let resolved = parseColorString(getComputedStyle(probe).color);
    if (!resolved && fallback) {
      probe.style.color = fallback;
      resolved = parseColorString(getComputedStyle(probe).color);
    }
    if (!resolved) return null;
    cur =
      `rgba(${resolved[0]}, ${resolved[1]}, ${resolved[2]}, ${resolved[3]})` +
      cur.slice(close + 1);
  }
  probe.style.color = cur;
  return parseColorString(getComputedStyle(probe).color);
}

/**
 * Split a string on commas that exist at parenthesis depth 0.
 * Useful for splitting `color-mix(...)` / `var(...)` arguments
 * without breaking on commas inside parentheses (e.g. inside the
 * fallback `var(--a, var(--b))`).
 */
function splitTopComma(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.length) out.push(buf);
  return out;
}

function findCloseParen(s: string, openIdx: number): number {
  let depth = 1;
  for (let j = openIdx; j < s.length; j++) {
    if (s[j] === "(") depth++;
    else if (s[j] === ")") {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

function findTopComma(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) return i;
  }
  return -1;
}

/**
 * Parse a `getComputedStyle().color`-style string back to `[r,g,b,a]`.
 * Handles `rgb()` / `rgba()` forms and the `transparent` keyword.
 * Returns `null` for unrecognised strings.
 */
function parseColorString(
  raw: string
): [number, number, number, number] | null {
  const v = raw.trim().toLowerCase();
  if (v === "transparent") return [0, 0, 0, 0];
  // Match `rgb(r, g, b)` and `rgba(r, g, b, a)`.
  const m = v.match(
    /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i
  );
  if (!m) return null;
  const r = Math.max(0, Math.min(255, Math.round(Number(m[1]))));
  const g = Math.max(0, Math.min(255, Math.round(Number(m[2]))));
  const b = Math.max(0, Math.min(255, Math.round(Number(m[3]))));
  let a = 1;
  if (m[4] != null) {
    const av = m[4];
    a = av.endsWith("%") ? Number(av.slice(0, -1)) / 100 : Number(av);
    a = Number.isFinite(a) ? Math.max(0, Math.min(1, a)) : 1;
  }
  return [r, g, b, a];
}

/** Linear interpolation between two RGBA colors, weight on `a`. */
function mixLinearRgb(
  a: [number, number, number, number],
  b: [number, number, number, number],
  weightA: number
): [number, number, number, number] {
  const w = Math.min(1, Math.max(0, weightA));
  const r = Math.round(a[0] * w + b[0] * (1 - w));
  const g = Math.round(a[1] * w + b[1] * (1 - w));
  const bl = Math.round(a[2] * w + b[2] * (1 - w));
  const al = +(a[3] * w + b[3] * (1 - w)).toFixed(3);
  return [r, g, bl, al];
}

/* ============================================================================
 * Capture-time SVG bridge
 * ========================================================================== */

/**
 * Walk every <svg> element in the cloned document and pin its
 * rendered size to the actual displayed pixel dimensions.
 *
 * html2canvas 1.4.1 has limited SVG support: when an SVG declares
 * its size via `width="100%"` (or any percentage) with a `viewBox`,
 * the rasterizer either draws content at the viewBox native
 * coordinate space or applies its own inconsistent scaling. The
 * result is that chart lines / bars / data-point circles escape
 * past the card that contains them — the line-chart "spillover"
 * visible on the Performance tab of the Activity page.
 *
 * This function replaces the percentage / viewBox-relative width &
 * height attributes with their actual `getBoundingClientRect()`
 * pixel values, and pins `preserveAspectRatio` to the SVG spec
 * default (`xMidYMid meet`). That guarantees html2canvas applies
 * the same viewBox scaling the live browser would, including
 * letterboxing if the rendered aspect ratio doesn't match the
 * viewBox aspect.
 *
 * Skips any SVG whose rect is zero — those are detached / not
 * rendered and forcing dimensions would break sibling layouts.
 */
export function bridgeSvgsForCanvasCapture(clonedDoc: Document): void {
  clonedDoc.querySelectorAll("svg").forEach((svg) => {
    let rect: { width: number; height: number };
    try {
      rect = svg.getBoundingClientRect();
    } catch {
      return;
    }
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    svg.setAttribute("width", String(Math.round(rect.width)));
    svg.setAttribute("height", String(Math.round(rect.height)));
    // Pin preserveAspectRatio so html2canvas's SVG rasterizer scales
    // the viewBox content uniformly with letterboxing, matching the
    // browser's default behavior. Don't override an explicit caller
    // choice — the original may have used `none` deliberately.
    if (!svg.getAttribute("preserveAspectRatio")) {
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    }
  });
}

/**
 * One-shot pre-processor for html2canvas capture: chains every
 * `clone-side` fix the Activity & Game pages need into a single
 * callback the user wires to html2canvas's `onclone` option.
 *
 * Currently delegates to:
 *   1. `resolveHtml2CanvasColorMix` — walks the cloned CSSOM to
 *      rewrite every CSS Color Module L4 `color-mix()` call into
 *      an rgba() literal (html2canvas 1.4.1's parser throws on
 *      `color-mix`).
 *   2. `bridgeSvgsForCanvasCapture` — sets explicit pixel
 *      width/height on every cloned <svg> so html2canvas's SVG
 *      rasterizer scales the viewBox content correctly (instead of
 *      letting chart geometry spill past the card).
 *
 * The signature matches html2canvas's `onclone(doc, element)`
 * shape, so it can be passed directly:
 *
 *   html2canvas(el, { onclone: prepareClonedDocumentForCanvasCapture });
 */
export function prepareClonedDocumentForCanvasCapture(
  clonedDoc: Document,
  _element?: HTMLElement,
  sourceDoc: Document =
    typeof window !== "undefined" ? window.document : clonedDoc
): void {
  resolveHtml2CanvasColorMix(clonedDoc, _element, sourceDoc);
  bridgeSvgsForCanvasCapture(clonedDoc);
}
