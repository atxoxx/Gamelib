# Launch Splashscreen — Spec

A centered, cinematic splash that appears the moment the user clicks **Play** on a game, holds while the executable is being launched, then fades out. It surfaces time-to-beat, the user's last play session, and total play time — so even a 2-second splash gives the user a moment of context and delight before they disappear into the game.

---

## 1. Goal & motivation

Right now pressing **Play** on a game jumps from `game-exited` `runningGameIds` state to a Toast that says "Launched X" — that's the entire feedback loop right now. There's no moment to:

- Re-orient the user to *what* they're about to play
- Remind them of progress (time-to-beat, last session)
- Surface something visually rich that rewards the user for opening this launcher instead of just double-clicking the exe

A splashscreen fixes all three while also smoothing over the gap between the user clicking Play and the game process actually appearing (which can be 200ms–2s depending on the executable).

---

## 2. User-facing behavior

### 2.1 Trigger

- Splash appears whenever `launchGame(game)` is called from anywhere in the app (Sidebar, LibraryPage card, GamePage, store detail page, etc.).
- Skipped entirely if **Settings → Show launch splash** is OFF.
- **Default:** ON for first-time installs (existing users keep current behavior; new users see the splash immediately).

### 2.2 Lifecycle

1. **00 ms** — User clicks Play. Splash fades in (200 ms) over the current page (backdrop-blurred) showing the game's hero artwork, logo, title, time-to-beat card, last session card, and total play time.
2. **+200 ms** — Status pill at the bottom shows **`Launching…`** (animated dots, 1.5s loop). `invoke("launch_game", …)` is awaited.
3. **On Rust success** — Status pill flips to **`Game is launching`** (or similar concrete line) for a minimum of 1.4 s so the user actually sees it, then splash fades out (250 ms).
4. **On Rust failure** — **No splash ever opens.** The existing Toast (`Launch failed: <err>`) is shown immediately. Rationale: the splash carries metadata we don't want to fetch speculatively and we want failures to be fast/informative, not theatrical.

### 2.3 Content (what's on the splash)

The splash is a **centered card** (≈ 720px wide, capped at 90vw) sitting over a blurred snapshot of the underlying page. Inside the card:

| Region | Content | Fallback |
|---|---|---|
| Top half | Full-width hero/banner image (16:9). If missing, gradient fallback using theme accent. | Gradient |
| Logo overlay | `game.logoUrl` displayed large and centered (transparent PNG / SVG). | Render game title in display font instead |
| Title block | Game name + (developer • publisher) in small text | Title only if no dev/pub |
| Time-to-Beat card | Pill showing `Main ~Xh` and `Complete ~Yh` from `game.timeToBeat`. Format: convert IGDB seconds → whole hours. | Hide entirely if no time-to-beat data |
| Last Session card | "Last played: <relative date> · <Xh Ym> · <avg FPS> FPS" pulled from `useActivity().getGameSessions(game.id)`. | "First time playing" badge |
| Total Play Time | "Total: <Xh Ym>" from `game.playTime` (already-formatted string). | "0h" |
| Status pill | Animated `Launching…` → `Game is launching` → fade out | — |

### 2.4 Interactions

- **No click-to-dismiss.** Modals (ImportModal, edit modal) already use click-to-dismiss; we want a different feel here. The splash is a brief, deliberate moment — not an interactive card.
- **No keyboard dismissal initially.** Power users can request it later (suggested followup).
- **Splash does not block rerunning.** If the user clicks Play on a new game while another splash is still up, replace the current splash (not stack).
- **Splash does not block the running game.** Once `launch_game` returns success, the splash begins its fade-out independently of the game's actual window appearing.

### 2.5 Layout

- Centered on the **main screen** (the user specifically confirmed this).
- The splash itself is a card, not a full-window takeover. The visible page beneath is dimmed + blurred (`backdrop-filter: blur(8px)` + `rgba(0,0,0,0.4)`) so the focus is on the splash but the user isn't yanked out of context.
- Card has 1px accent border + soft shadow (consistent with the existing `modal-backdrop / modal` styling in `App.css`).
- Below ~720px viewport width, card switches to a smaller profile (full-width minus margin), hero aspect ratio preserved.

### 2.6 Animation

- **Smooth + minimal.** No dramatic scale, no Ken Burns.
- Fade in: 200ms ease-out
- Hold: until `launch_game` resolves + minimum 1.4 s
- Fade out: 250ms ease-in
- Status pill dot: 1.5s ease-in-out loop, 3 dots staggered

---

## 3. Architecture

### 3.1 New component

`src/components/Splashscreen.tsx` — a portal-rendered, root-level component.

```
<Splashscreen loading={state} game={state?.game} status={state?.status} />
```

Props (minimal):
- `loading: boolean` — anchored to `game-exited`-adjacent state
- `game: Game | null` — the game whose splash is showing
- `status: "launching" | "started" | null` — drives the status pill copy

### 3.2 Rendered at the root

In `src/App.tsx` (or wherever `GameProvider` is mounted), add `<Splashscreen />` next to `<Toast />`. The splash reads its state from a new lightweight context, **`SplashContext`**, that mirrors what ToastContext does:

```
interface SplashContextType {
  showSplash: (game: Game) => void;
  setStatus: (status: "launching" | "started") => void;
  hideSplash: () => void;
}
```

This decouples `GameContext.launchGame` from the splash UI, so adding future splash triggers (e.g. a CLI arg, plugin) doesn't require editing the launching logic.

### 3.3 Wiring

Modify **`src/context/GameContext.tsx`** so `launchGame` invokes the splash:

```ts
const launchGame = useCallback((game: Game) => {
  if (runningGameIds.includes(game.id)) { showToast(...); return; }
  setRunningGameIds((prev) => [...prev, game.id]);

  if (splashEnabled) showSplash(game);
  setStatus("launching");

  invoke("launch_game", { ... })
    .then(() => { setStatus("started"); showToast(`Launched ${game.name}`, "success"); })
    .catch((err) => {
      setRunningGameIds((prev) => prev.filter((id) => id !== game.id));
      hideSplash();  // failure path: drop the splash immediately
      showToast(`Launch failed: ${err}`, "error");
    });
}, [...]);
```

The splash itself watches `status` and begins fade-out when status flips to `"started"`. No new Rust changes are needed — `launch_game` already returns `Ok(())` after the `Command::new(...).spawn()` succeeds, which is what we treat as "process is launching."

---

## 4. State & data plumbing

| Field | Source | Used for |
|---|---|---|
| `game` | `GameContext.games.find(id)` via the launch call | Title, logo, banner, TTB, play time, dev/publisher |
| `game.bannerUrl` | GameContext | Hero image |
| `game.logoUrl` | GameContext | Logo overlay on hero |
| `game.timeToBeat` | GameContext (IGDB-sourced, seconds) | TTB pill (formatted to hours) |
| `game.playTime` | GameContext (string like "12h 30m") | Total play time card |
| Last session | `useActivity().getGameSessions(game.id)[0]` | Last played date, duration, avg FPS |
| Setting | `localStorage.getItem("gamelib-show-splash") ?? "true"` | Master toggle |

No backend changes — all rendering data already lives in the frontend.

---

## 5. Storage

New localStorage key:

- `gamelib-show-splash`: `"true" | "false"` — master toggle. Read in `launchGame` to decide whether to call `showSplash`.

No persisted splash state. The splash is ephemeral by design.

---

## 6. Settings UI

In `src/pages/SettingsPage.tsx`, inside the **System & Metadata** section, add a new checkbox directly after the existing minimize-on-launch checkbox so they read naturally together:

> ☑ **Show launch splash**
> Display a brief splash with game artwork, time-to-beat, and last session info when launching a game.

Persistence pattern matches the existing checkboxes — `setShowSplash(value)` + write to localStorage.

If localStorage value is unset (first run for new users), default to **true**. Existing users get whatever they had — no migration needed.

---

## 7. Component API (detailed)

```tsx
interface SplashscreenProps {}

interface SplashscreenState {
  gameId: string | null;
  status: "launching" | "started";
  visibleAt: number; // performance.now() — for min-visibility enforcement
}

interface SplashContextType {
  showSplash: (game: Game) => void;
  setStatus: (status: "launching" | "started") => void;
  hideSplash: () => void;
  splashEnabled: () => boolean;
}
```

Internal behavior:
- Two CSS transitions on a single root `.splashscreen-root`:
  - `opacity`: 0 → 1 (in), 1 → 0 (out)
  - `pointer-events`: none (so it never blocks clicks)
- Min-visibility timer: when `status === "started"` AND `now - visibleAt < 1400`, hold; otherwise begin fade.
- Single-flight: if `showSplash` is called while a splash is up, replace `gameId` cleanly (don't queue).
- Cleared on unmount via `useEffect` cleanup.

---

## 8. Styling (`App.css` additions)

```css
.splashscreen-root {
  position: fixed; inset: 0; z-index: 9000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.4);
  backdrop-filter: blur(8px);
  opacity: 0; pointer-events: none;
  transition: opacity 200ms ease-out;
}
.splashscreen-root.visible { opacity: 1; }
.splashscreen-root.fading  { opacity: 0; transition: opacity 250ms ease-in; }

.splashscreen-card {
  width: min(720px, 90vw);
  border-radius: var(--radius-xl);
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-accent);
  box-shadow: 0 24px 80px rgba(0,0,0,0.45);
  overflow: hidden;
}

/* …hero, logo overlay, info cards, status pill … */
```

Theme integration via existing CSS custom properties — no hardcoded colors.

---

## 9. Accessibility

- Splash uses `role="dialog"` with `aria-modal="true"` and `aria-label="Launching {game.name}"` so screen-reader users hear the context.
- Status updates (`Launching…` → `Game is launching`) are mirrored in an `aria-live="polite"` region inside the card.
- Reduced-motion: if `prefers-reduced-motion`, skip the fade animations (snap to visible/hidden).
- `pointer-events: none` on the backdrop so it doesn't trap clicks; the card itself is non-interactive.

---

## 10. Edge cases

| Scenario | Behavior |
|---|---|
| User re-launches the same game while it's "running" | Toast only ("X is already running") — splash NOT shown (matches current code) |
| User launches a different game while splash is up | Replace splash content; pill cycle restarts |
| Rust returns Ok in <300 ms | Hold for full 1.4 s min visibility |
| Rust takes >5 s | Splash still showing "Launching…" the whole time (acceptable — games do take a moment to spawn) |
| Rust throws / spawn fails | Splash **never opens** OR opens then closes on the same tick. Chosen: never opens. Toast handles it. |
| Network/IGDB fetch missing data | Graceful fallbacks (hide TTB card, show "First time playing" badge, no broken hero) |
| Game has no banner/logo/cover | Hero falls back to a vertical gradient using `var(--color-accent)` |
| Game has no metadata at all (just path) | Splash shows title + minimal info — never a blank card |
| User toggles splash OFF mid-session | New launches skip the splash; existing splash completes its fade-out naturally |
| Multiple parallel launches (rapid double-click) | First splash wins; second click is debounced by `runningGameIds.includes(...)` check |

---

## 11. What's NOT in this spec

- Keyboard skip (Esc/Space to dismiss) — possible future polish; not in v1.
- Showing recent user Achievement progress — Steam achievement data isn't in this app; not in scope.
- Real-time FPS overlay on the splash itself — that lives in the existing Activity page; do not duplicate.
- Dismissing to a "Stop" button — splash is non-interactive by design; use the existing global game-stop mechanic.

---

## 12. Acceptance criteria

1. Pressing Play on any game with the splash enabled shows a centered card with hero/logo + TTB + last session + play-time.
2. Splash fades in (200 ms), holds at minimum 1.4 s, fades out (250 ms).
3. Settings checkbox in System & Metadata section toggles splash on/off; default ON.
4. Disabled setting means clicking Play shows only the toast, no splash.
5. Failed `launch_game` shows toast only — no splash element opened (or it closes within one tick).
6. Games with no metadata still get a usable splash (gradient hero + title only).
7. Re-clicking Play on the running game shows toast, not a second splash.
8. Reduced-motion users see no fade animations.
9. Splash reads `splashEnabled()` from localStorage on every launch — no in-memory cache.
10. Visuals match the existing app theme (CSS custom properties, no hardcoded colors).
