# GameLib UI Design Direction — Modern · Unique · Impacting

**Status:** Plan approved. Phase 0 (identity tokens) in progress.
**Constraint:** UI only — no animation/motion work. Design choices expressed through
color, layout, typography, and material.

## Approved direction (from stakeholder round)

| Dimension | Decision |
|-----------|----------|
| Material language | **Bold gradient + depth** (poster-like gradients, layered 3D lift) |
| Core layout | **Keep sidebar + topnav, modernize** (proportions, whitespace, home) |
| Library grid | **Editorial mixed sizes** (feature cards interleaved with uniform cards) |
| Signature differentiator | **Data-as-art dashboards** (broadcast-grade stats/activity) |
| Theme system | **Fewer, signature defaults** — 3: `dark` (refined), `light` (refined), `aurora` (bold statement) |
| Build priority | 1) Home/first-run · 2) Library · 3) Game detail · 4) Brand & identity |

## Design language

- **Brand gradient identity** — a consistent violet → cyan → magenta mesh that signals
  "GameLib" across every surface (logo glow, hero backdrops, primary buttons, active states).
- **Depth, not flatness** — panels physically stack via a layered shadow "depth scale"
  (`--depth-1..3`, `--depth-float`, `--shadow-brand`) so the UI reads as a tangible console OS.
- **Editorial rhythm** — the library stops being a uniform wall; a few weighted "feature"
  tiles create visual cadence and a sense of curation.
- **Data-as-art** — the Activity/Stats views become the unmistakable GameLib signature:
  big broadcast numbers, glowing SVG sparklines, session "cards" like match summaries.

## Phases

- **Phase 0 — Identity tokens (this PR)**
  - Add `--brand-1/2/3`, `--brand-gradient`, `--mesh-gradient` tokens.
  - Add layered `--depth-*` shadow scale + `--shadow-brand`.
  - Bolden the default dark + light `--color-bg-gradient` (more pronounced mesh).
  - Add the `aurora` signature theme (vivid violet/cyan/magenta mesh).
  - Reduce built-in themes to 3 signature defaults (`dark`, `light`, `aurora`).
- **Phase 1 — Home hub:** bold gradient hero, Continue / Deals / New editorial rows, strong first-run "wow".
- **Phase 2 — Editorial library grid:** weighted mosaic (feature + uniform cards) via `grid-row/col span`.
- **Phase 3 — Game detail pages:** gradient hero, immersive media, info-dense KPI strip.
- **Phase 4 — Data-as-art dashboards:** broadcast-style Activity/Stats.
- **Phase 5 — Brand & identity sweep:** logo, typography pairing, icon set.

## Conventions honored
- All colors via `var(--…)` tokens; never hardcode hex in components.
- Theme tokens defined in `App.css`; per-theme overrides via `[data-theme="…"]`.
- `ThemeContext.BUILTIN_THEMES` is the source of truth for the selector.
