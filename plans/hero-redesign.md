# Hero Redesign Plan — Cinematic + Info-Dense (Game + Store)

**Scope:** `GameHero.tsx` (in-library Game page) + `StoreHero.tsx` (Discover rotating featured).
**Direction:** Cinematic/expansive *and* info-dense.
**New surfaces:** (1) inline video/trailer, (2) friends-playing.
**Target:** desktop / big-screen layouts only (no mobile breakpoint work).

---

## 1. Shared building blocks (new components)

- **`HeroTrailer`** — muted, looping trailer tile overlaid on the banner.
  - Props: `videoUrl?` (webm/mp4) or `youtubeId?`, `poster`, `autoplay` (big-screen), `onReady`.
  - Click-to-play / hover-to-preview on desktop; autoplay-muted on big-screen. Graceful fallback to the still banner image when no video.
  - Respects `prefers-reduced-motion` (no autoplay, static poster).
- **`FriendsPlayingStrip`** — stacked friend avatars + session affordance.
  - Derives "friends playing this game" from `loadFriends()`: `friend.currentlyPlaying === game.name`, plus active `GameSession`s whose `gameId`/`gameName` matches.
  - Renders: avatar stack, "N playing", "In session" pill → opens the session. Empty state = hidden.

## 2. GameHero (in-library Game page)

Current: 120–180px compact banner + KPI overlay (Players Now / Play Time / Status) + info row (logo·title / meta / launch).

Redesign:
- **Taller full-bleed banner** (clamp ~340–440px), ken-burns ambient + stronger vignette/gradient scrim for legibility (reuse `store-hero-kenburns` pattern, theme the `game-hero` block).
- **`HeroTrailer`** layered over the banner using `game.videos` (existing `string[]`, YouTube/IGDB). Big-screen autoplay-muted; desktop click-to-play. Falls back to current `bannerUrl`/`coverArtUrl` art.
- **Larger floating 2:3 cover** overlapping the bottom edge.
- **Info-dense KPI glass strip** (keep current glass tiles, add): Players Now (Steam), Play Time, Status+dropdown, **Rating** (`igdbRating`/`criticRating`), **Time-to-Beat** (`timeToBeat.normally`), **Achievements %** (if `steamAppId` + achievements available).
- **`FriendsPlayingStrip`** above/under the info row.
- Restyle logo/title + meta + launch row for the larger scale.

## 3. StoreHero (Discover featured)

Current: rotating `coverUrl` bg, poster, eyebrow, title, genres, meta, rating, CTA, nav/dots/progress.

Redesign:
- Keep rotation + index/dots/progress/nav. Add **ken-burns + `HeroTrailer` per slide** when a trailer is available.
  - *Dependency:* `StoreGameSummary` currently has no video field. Plan to enrich the trending pool with a trailer source (IGDB `videos` / Steam `movies`) — see Open Questions.
- **Expanded info panel** per slide: eyebrow, title, genres, platforms, **rating**, **Players Now** (existing `SteamPlayerCount`), **Friends playing** (match `friend.currentlyPlaying` to slide name), and **time-to-beat** if present.
- **Info-dense footer strip** on the active slide: Players Now · Rating · Genres · "N friends in library".

## 4. CSS / theming

- New classes alongside existing `game-hero*` (`game-cards.css`) and `store-hero*` (`store-discover.css`).
- Drive accent from existing `--game-accent` (already wired via `useGameAccent`).
- All motion gated behind `prefers-reduced-motion` (already handled for Store; mirror for Game).
- Desktop/big-screen only; no new mobile breakpoints.

## 5. Data plumbing

- Friends: `loadFriends()` (localStorage, `friendsStorage.ts`) → `currentlyPlaying` + `GameSession` list from `loadFriendsDb`.
- Match strategy: `currentlyPlaying === game.name` (fuzzy/normalized) and `session.gameId === game.id` / `session.gameName === game.name`.
- Game page already has `game` (videos, ratings, timeToBeat, steamAppId); Store page needs trailer enrichment added to the `fetch_store_games` trending result.

## Open Questions / dependencies

1. **Store trailer source** — `StoreGameSummary` lacks video. Options: (a) add IGDB trailer URLs to the trending fetch, (b) resolve Steam `movies` by appid. Confirm preferred source.
2. **Achievements % on GameHero** — requires `steamAppId` + achievements sync; show only when data exists (already gated similarly to Players Now).
3. **Friends-match fidelity** — exact name match vs. fuzzy; confirm tolerance.

## Suggested file changes

- `src/components/game/GameHero.tsx` — restructure layout, add `HeroTrailer` + `FriendsPlayingStrip` + new KPI tiles.
- `src/components/store/StoreHero.tsx` — add per-slide trailer + friends + expanded info/footer strip.
- `src/components/hero/HeroTrailer.tsx` *(new)*, `src/components/hero/FriendsPlayingStrip.tsx` *(new)*.
- `src/styles/game-cards.css`, `src/styles/store-discover.css` — new hero styles.
- `src/types/game.ts` — optional: add `trailerUrl?` to `StoreGameSummary` fetch path.
