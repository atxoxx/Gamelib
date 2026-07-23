# Hydra API Download Sources — Specification

## Summary

Replace the current webview-based "Add Source" flow (and the direct HTTP fetch path) with the **Hydra API**. Instead of opening an in-app browser to capture JSON from a source URL, the app will POST the URL to Hydra's `/download-sources` endpoint. Hydra's server fetches, parses, and returns the full structured `DownloadSource` object. The response is persisted to disk locally. Source refresh also goes through the Hydra API (`/download-sources/sync`).

---

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Hydra API base URL | Hardcoded `https://hydra-api-us-east-1.losbroxas.org` | Production Hydra API; no env-var or settings UI needed |
| Authentication | Anonymous only (`needsAuth: false`) | No Hydra account login required |
| What gets replaced | Both `addSource` (direct reqwest) AND `addSourceViaWebview` (webview) | Single unified path via Hydra API |
| Source refresh | Hydra API `POST /download-sources/sync` | Single-source: `{ ids: [id] }`; bulk: `{ ids: [...] }` |
| Download data persistence | Persist full downloads array to disk | Separate cache files per source ID under app data dir |
| UI changes | Simple form: URL input + "Add Source" button, no webview hints | Clean, no Cloudflare mention |
| Webview code | Removed entirely | Including init script, chunked base64, navigation interception |

---

## Hydra API Endpoints

### Base URL
```
https://hydra-api-us-east-1.losbroxas.org
```

### 1. Add a Download Source
```
POST /download-sources
Content-Type: application/json
{ "url": "https://example.com/sources/my-source.json" }
```

**Response** (`DownloadSource`):
```json
{
  "id": "string — unique source ID assigned by Hydra",
  "url": "string — the original URL submitted",
  "name": "string — display name",
  "downloads": [
    {
      "title": "string — game name",
      "fileSize": "string — e.g. '62.4 GB'",
      "uris": ["string — magnet:.torrent URL"],
      "uploadDate": "string (optional)"
    }
  ]
}
```

- **Auth:** Not required (`needsAuth: false`)
- **Validation:** Hydra returns error if URL is unreachable or JSON invalid
- **Duplicate handling:** Hydra may return an existing source if the URL was already submitted by another user

### 2. Sync/Refresh Download Sources
```
POST /download-sources/sync
Content-Type: application/json
{ "ids": ["source-id-1", "source-id-2"] }
```

**Response** (`DownloadSource[]`):
Returns updated `DownloadSource` objects for each ID that had changes.

- **Auth:** Not required
- **Usage:** Single-source refresh (one ID) or bulk refresh (all IDs)

---

## Rust Backend Changes (`src-tauri/src/source_manager.rs`)

### Items to REMOVE

1. **Webview infrastructure (entirely):**
   - `add_source_via_webview` Tauri command and its implementation
   - `SOURCE_FETCHER_INIT_SCRIPT` constant (~200 lines of JS)
   - `SOURCE_FETCHER_USER_AGENT` constant
   - `decode_base64url` helper function
   - `ChunkState` struct
   - `SOURCE_FETCHER_ID_COUNTER` static
   - Imports: `WebviewUrl`, `WebviewWindowBuilder`, `base64::{Engine, general_purpose}`, `url::Url`

2. **Direct HTTP fetch path:**
   - `fetch_source` method (uses `reqwest` to fetch source JSON from URL)
   - `add_source` method (validates URL then calls `fetch_source` → `commit_source`)
   - `add_source_from_json` method (takes pre-fetched JSON text)
   - `commit_source` helper
   - The `reqwest::Client` field — replaced with a Hydra-specific HTTP client

3. **Old Tauri commands:**
   - `sources_add` (calls `add_source`)
   - `add_source_via_webview` (calls webview flow)

### Items to ADD

1. **Hydra API client (new `reqwest::Client`):**
    - `user_agent: "GameIndex/1.0 (+hydra-api)"`
   - `timeout: 15s`
   - Base URL constant: `HYDRA_API_BASE = "https://hydra-api-us-east-1.losbroxas.org"`

2. **`add_source_via_hydra(&mut self, url: String, name: String) -> Result<SourceLink, String>`:**
   - Validate URL (non-empty, starts with `http://` or `https://`)
   - Check for duplicate URL in `self.sources`
   - POST to `{HYDRA_API_BASE}/download-sources` with body `{ "url": url }`
   - Parse response as Hydra `DownloadSource` JSON
   - Generate local `id` using existing `SOURCE_ID_COUNTER` + timestamp
   - Store the Hydra-returned `id` separately (see "Data Model" below)
   - Create `SourceLink` metadata
   - Save full downloads to disk cache
   - Append to `self.sources`, persist `sources.json`

3. **`refresh_source_via_hydra(&mut self, id: &str) -> Result<(), String>`:**
   - Find the source in `self.sources` to get the Hydra source ID
   - POST to `{HYDRA_API_BASE}/download-sources/sync` with `{ "ids": [hydra_source_id] }`
   - Parse response, update cached downloads on disk
   - Update `last_fetched` and `game_count` on metadata

4. **`refresh_all_via_hydra(&mut self) -> Result<(), String>`:**
   - Collect Hydra source IDs for all enabled sources
   - POST to `{HYDRA_API_BASE}/download-sources/sync` with `{ "ids": [...] }`
   - Update each cached source's downloads
   - Update `last_fetched` and `game_count` for each updated source

5. **Disk persistence for downloads:**
   - Store cached downloads as JSON files: `<app_data_dir>/sources_cache/{source_id}.json`
   - Each file: `{ "source_id": "...", "hydra_source_id": "...", "data": { "name": "...", "downloads": [...] }, "fetched_at": 1234567890 }`
   - Load cache files on startup (if file exists, populate `self.cache`)
   - Write cache file after add/refresh

6. **New/updated Tauri commands:**
   - `sources_add(url, name)` → calls `add_source_via_hydra`
   - `sources_refresh(id)` → calls `refresh_source_via_hydra`
   - `sources_refresh_all()` → calls `refresh_all_via_hydra`
   - Keep existing: `sources_list`, `sources_remove`, `sources_toggle`, `sources_search_game`

### Data Model Changes

Add a `hydra_source_id` field:
```rust
pub struct SourceLink {
    pub id: String,                // Local ID (src_<nanos>_<counter>)
    pub hydra_source_id: String,   // ID returned by Hydra API (used for sync)
    pub url: String,
    pub name: String,
    pub enabled: bool,
    pub last_fetched: Option<u64>,
    pub game_count: usize,
}
```

Persist `hydra_source_id` alongside metadata in `sources.json`.

### Error Handling

- **Hydra API unreachable:** Return `"Hydra API unreachable: {error}"` — no fallback to direct fetch/webview
- **Hydra returns error:** Surface the Hydra error message (e.g., "Source URL is invalid JSON")
- **Duplicate URL:** Still check locally; Hydra may also return the source if it already exists
- **Sync returns partial results:** Update only the sources that were returned (some may not have changed)

---

## Frontend Changes

### `src/types/source.ts`

Add `hydraSourceId`:
```ts
export interface SourceLink {
  id: string;
  hydraSourceId: string;  // NEW — ID from Hydra API
  url: string;
  name: string;
  enabled: boolean;
  lastFetched: number | null;
  gameCount: number;
}
```

### `src/context/SourceContext.tsx`

1. **Remove:**
   - `addSource` function (direct HTTP fetch)
   - `addSourceViaWebview` function (webview flow)
   - The `addSourceViaWebview` invoke call

2. **Replace with:**
   ```ts
   const addSource = useCallback(
     async (url: string, name: string): Promise<SourceLink> => {
       const created = await invoke<SourceLink>("sources_add", { url, name });
       setSources((prev) => [...prev, created]);
       showToast(`Added source "${created.name}"`, "success");
       return created;
     },
     [showToast],
   );
   ```
   This now calls the unified `sources_add` command (which calls Hydra API backend).

3. **Update `refreshSource`:**
   - Calls `sources_refresh` (which now uses Hydra API sync)
   - Re-fetch list after refresh (unchanged)

4. **Update `refreshAllSources`:**
   - Calls `sources_refresh_all` (which now uses Hydra API bulk sync)
   - Re-fetch list after refresh (unchanged)

5. **Update context interface:**
   - Remove `addSourceViaWebview` from `SourceContextValue`
   - Keep only `addSource` (now Hydra-powered)

### `src/components/SourceManager.tsx`

1. **Remove:**
   - `addSourceViaWebview` from destructured `useSources()`
   - `adding` state (tracks webview in-flight)
   - The "Open Webview" button text/behavior
   - The webview hint paragraph (`src-form-hint`)
   - The Cloudflare-related text in description and empty state

2. **Change:**
   - `handleAdd` calls `addSource` (Hydra) instead of `addSourceViaWebview`
   - Remove `adding` check from all disabled states
   - Submit button text: **"Add Source"** instead of "Open Webview"
   - Loading state: show a spinner while the Hydra API call is in flight (replacing the "Waiting for Webview…" text)

3. **Update description text:**
   ```
   "Add JSON-formatted source URLs to find download mirrors for your games.
   Sources use the Hydra-compatible format and are fetched via the Hydra API."
   ```

4. **Update empty state text:**
   ```
   "Click Add Source to paste a JSON source URL. The source will be
   fetched and validated through the Hydra API."
   ```

5. **Remove:** `addSourceViaWebview` from the `addSourceViaWebview` call in `handleAdd`, replaced with `addSource`.

### `src/pages/SettingsPage.tsx`

No structural changes needed since it just renders `<SourceManager />`. The description at the top of the Downloads section should be updated:
```
"Add JSON-formatted source URLs to find download mirrors for
your games. Sources use the Hydra-compatible format with a
name and a downloads array. The Download button on any game's
page will search your enabled sources."
```
(Remove the webview/Cloudflare mention.)

---

## Files Summary

### Modified Files

| File | Changes |
|---|---|
| `src-tauri/src/source_manager.rs` | Major refactor: remove webview + direct-fetch code; add Hydra API client, `add_source_via_hydra`, `refresh_source_via_hydra`, `refresh_all_via_hydra`; add disk cache persistence; update Tauri commands |
| `src-tauri/src/lib.rs` | Update command registration (remove `add_source_via_webview`, update others) |
| `src/types/source.ts` | Add `hydraSourceId` field to `SourceLink` |
| `src/context/SourceContext.tsx` | Remove `addSourceViaWebview`; simplify `addSource` (single Hydra path); update refresh to use new backend |
| `src/components/SourceManager.tsx` | Simplify form UI: "Add Source" button, no webview hints; remove webview-specific state and callbacks |
| `src/pages/SettingsPage.tsx` | Update Downloads section description text (minor) |
| `src/styles/source-manager.css` | No structural changes needed (keep existing styles) |

### Removed Items (no separate files)

- `SOURCE_FETCHER_INIT_SCRIPT` (~200-line JS constant in `source_manager.rs`)
- `ChunkState` struct and all chunked-navigation logic
- `decode_base64url` helper
- `base64` crate import (if not used elsewhere)
- `WebviewUrl`, `WebviewWindowBuilder` imports
- `url::Url` import (if not used elsewhere)

---

## Migration Path

1. Add the `hydraSourceId` field to `SourceLink` with a default (empty string or the local ID) for existing sources
2. On startup, existing sources without a `hydraSourceId` will:
   - Still show in the list (with their existing data)
   - On next refresh, the Hydra API `/download-sources/sync` with the local ID may not work — need a migration: on first refresh of a legacy source, call `POST /download-sources` with the URL to register it with Hydra, get back the `hydraSourceId`, then save it
   - OR: add a "Re-register with Hydra" step for existing sources
   
   **Recommended approach:** On startup, for any source where `hydraSourceId` is empty/missing, automatically call `POST /download-sources` with the URL to get the Hydra ID. On success, update `hydraSourceId` and persist. Sources that fail this hydration will still show but won't be refreshable via Hydra until a successful re-registration.

3. Cache directory migration: on first run with new code, if `sources_cache/` doesn't exist, create it. Existing in-memory cache entries are lost on restart anyway (current behavior), so no migration needed.

---

## Error States to Handle

| Scenario | Behavior |
|---|---|
| Hydra API unreachable (network error) | Show error toast: "Hydra API unreachable. Check your internet connection." |
| Hydra returns HTTP error (4xx/5xx) | Show the error message from Hydra's response |
| URL has already been added locally | Show: "This source URL has already been added" |
| Hydra returns a source with 0 downloads | Accept it (empty source is valid); show "0 games" in the list |
| Hydra API slow (>15s) | Timeout, show: "Hydra API request timed out" |
| Refresh of a single source fails | Show error toast but keep the source (don't remove it) |
| Bulk refresh: some fail, some succeed | Show partial success toast: "X sources refreshed, Y failed" |
| Legacy source without `hydraSourceId` | Show in list; on refresh attempt, auto-register with Hydra first |

---

## Open Questions for Future Iterations

1. **Rate limiting:** Does Hydra API have rate limits? Add retry logic with backoff if needed.
2. **Offline mode:** If the user is offline, should the UI still show cached downloads from disk? Yes — since we persist to disk.
3. **Hydra API versioning:** If Hydra changes the API, how do we handle it? Consider adding an API version header.
4. **Hydra source catalog browsing:** Future feature — browse Hydra's curated list of sources without pasting URLs manually.
