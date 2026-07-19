-- =====================================================================
-- Gamelib persistent storage — v1 schema.
-- =====================================================================
-- Goals:
--   1. Replace every pretty-printed JSON file in <app_data_dir> with
--      a single SQLite database.
--   2. Atomic, transactional writes (no more corrupt-on-crash risk).
--   3. Indexed search for the Hydra download catalog (FTS5).
--   4. Per-row updates so a `last_played` bump no longer rewrites
--      the entire games library.
--
-- Conventions:
--   - Timestamps are unix seconds (u64). NULL means "never / unknown".
--   - JSON columns hold COMPACT (no pretty) payloads. The frontend
--     never sees these directly; it routes through Rust commands.
--   - Foreign keys are ON (the pool sets `PRAGMA foreign_keys=ON` on
--     every connection) so `ON DELETE CASCADE` actually fires.

-- ---- Sources + cache + downloads (Phase 2) --------------------------

CREATE TABLE IF NOT EXISTS sources (
    id              TEXT PRIMARY KEY,        -- "src_<nanos>_<counter>"
    hydra_source_id TEXT NOT NULL DEFAULT '',
    url             TEXT NOT NULL,
    name            TEXT NOT NULL,
    enabled         INTEGER NOT NULL,        -- 0/1, compact SQL instead of bool
    last_fetched    INTEGER,                 -- unix seconds, NULL = never
    game_count      INTEGER NOT NULL DEFAULT 0,
    added_at        INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sources_url ON sources(url);

CREATE TABLE IF NOT EXISTS sources_cache (
    source_id       TEXT PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
    hydra_source_id TEXT NOT NULL DEFAULT '',
    fetched_at      INTEGER NOT NULL,
    payload_json    TEXT NOT NULL            -- compact JSON of GameSource
);

CREATE TABLE IF NOT EXISTS downloads (
    source_id    TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    row_id       INTEGER NOT NULL,
    title        TEXT NOT NULL,
    file_size    TEXT NOT NULL,
    upload_date  TEXT,
    uris_json    TEXT NOT NULL,              -- compact JSON array
    magnet       TEXT,
    PRIMARY KEY (source_id, row_id)
);
CREATE INDEX IF NOT EXISTS ix_downloads_source ON downloads(source_id);

-- FTS5 virtual table full-text-indexes the (title) column. The
-- `bm25(downloads_fts)` ranker powers the per-source `search` command.
-- UNINDEXED columns let us filter by source_id / lookup the URI in
-- post-processing without bloating the index.
CREATE VIRTUAL TABLE IF NOT EXISTS downloads_fts USING fts5(
    title,
    source_id UNINDEXED,
    download_uri UNINDEXED,
    file_size UNINDEXED,
    upload_date UNINDEXED,
    tokenize = 'unicode61 remove_diacritics 2'
);

-- Triggers keep downloads_fts in sync with downloads. We ROWID-align
-- fts rows to `downloads.row_id` so JOINs look natural; the actual
-- FTS5 rowid is whatever SQLite assigns — the `rowid` column in the
-- index records the documents' source row_id so we can join.
CREATE TRIGGER IF NOT EXISTS trg_downloads_ai AFTER INSERT ON downloads BEGIN
  INSERT INTO downloads_fts(rowid, title, source_id, download_uri, file_size, upload_date)
  VALUES (new.rowid, new.title, new.source_id,
          json_extract(new.uris_json, '$[0]'), new.file_size, new.upload_date);
END;

CREATE TRIGGER IF NOT EXISTS trg_downloads_au AFTER UPDATE ON downloads BEGIN
  DELETE FROM downloads_fts WHERE rowid = old.rowid;
  INSERT INTO downloads_fts(rowid, title, source_id, download_uri, file_size, upload_date)
  VALUES (new.rowid, new.title, new.source_id,
          json_extract(new.uris_json, '$[0]'), new.file_size, new.upload_date);
END;

CREATE TRIGGER IF NOT EXISTS trg_downloads_ad AFTER DELETE ON downloads BEGIN
  DELETE FROM downloads_fts WHERE rowid = old.rowid;
END;

-- ---- Games (Phase 3) -----------------------------------------------

CREATE TABLE IF NOT EXISTS games (
    id                    TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    path                  TEXT NOT NULL DEFAULT '',
    platform              TEXT NOT NULL DEFAULT '',
    installed             INTEGER NOT NULL,
    play_time             TEXT NOT NULL DEFAULT '0h',
    added_at              INTEGER NOT NULL,
    -- The frontend `Game` struct has many optional fields. To keep
    -- the schema reviewable, we collapse the optional metadata into
    -- three compact-JSON columns + a handful of indexed scalars.
    cover_art_url         TEXT,
    notes                 TEXT,
    size_bytes            INTEGER,
    size_detected_at      TEXT,
    size_root_path        TEXT,
    icon_url              TEXT,
    banner_url            TEXT,
    logo_url              TEXT,
    description           TEXT,
    developer             TEXT,
    publisher             TEXT,
    release_date          TEXT,
    metadata_source       TEXT,
    metadata_url          TEXT,
    storyline             TEXT,
    igdb_rating           REAL,
    critic_rating         REAL,
    steam_app_id          INTEGER UNIQUE,
    steam_playtime        INTEGER,
    store_source          TEXT,
    epic_namespace        TEXT,
    epic_catalog_item_id  TEXT,
    launch_arguments      TEXT,
    run_as_admin          INTEGER,
    last_played           INTEGER,
    play_status           TEXT,
    -- Compact JSON arrays / nested objects kept as compact JSON.
    genres_json                  TEXT,
    themes_json                  TEXT,
    game_modes_json              TEXT,
    player_perspectives_json     TEXT,
    screenshots_json             TEXT,
    videos_json                  TEXT,
    websites_json                TEXT,
    time_to_beat_json            TEXT,
    similar_games_json           TEXT,
    releases_json                TEXT,
    igdb_reviews_json            TEXT,
    alternative_names_json       TEXT,
    steam_achievements_json      TEXT,
    language_supports_json        TEXT,
    collection                   TEXT,
    franchise                    TEXT,
    game_category                TEXT,
    release_status               TEXT
);
CREATE INDEX IF NOT EXISTS ix_games_last_played ON games(last_played DESC);
CREATE INDEX IF NOT EXISTS ix_games_name        ON games(name);
CREATE INDEX IF NOT EXISTS ix_games_steam_appid ON games(steam_app_id);

-- ---- Sessions (Phase 3) ---------------------------------------------

-- One row per finished or in-progress game session. `end_ts` is NULL
-- for the active row. `metrics_json` holds the full
-- `SessionMetrics` payload as compact JSON so we don't lose any
-- fields when the watcher adds new ones.
CREATE TABLE IF NOT EXISTS sessions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id       TEXT NOT NULL,
    started_at    INTEGER NOT NULL,         -- unix ms — UI-friendly granularity
    ended_at      INTEGER,
    elapsed_seconds INTEGER,                -- denormalized for quick aggregates
    avg_fps       REAL,
    avg_cpu       REAL,
    avg_gpu       REAL,
    avg_ram       REAL,
    metrics_json  TEXT
);
CREATE INDEX IF NOT EXISTS ix_sessions_game   ON sessions(game_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ix_sessions_active ON sessions(ended_at) WHERE ended_at IS NULL;

-- ---- Wishlist (Phase 1) --------------------------------------------

CREATE TABLE IF NOT EXISTS wishlist (
    slug        TEXT PRIMARY KEY,            -- IGDB slug, naturally unique
    payload_json TEXT NOT NULL,             -- compact StoreGameSummary
    added_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_wishlist_added ON wishlist(added_at DESC);

-- ---- Store cache (Phase 1) ------------------------------------------

CREATE TABLE IF NOT EXISTS store_cache (
    category     TEXT NOT NULL,
    page         INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    fetched_at   INTEGER NOT NULL,
    PRIMARY KEY (category, page)
);

CREATE TABLE IF NOT EXISTS store_detail (
    slug         TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    fetched_at   INTEGER NOT NULL
);

-- ---- Achievements (Phase 1) ----------------------------------------

CREATE TABLE IF NOT EXISTS achievements_cache (
    game_id      TEXT PRIMARY KEY,
    steam_app_id INTEGER NOT NULL,
    payload_json TEXT NOT NULL,             -- compact GameAchievementData
    last_synced  INTEGER
);

-- ---- News cache (mention in plan; minimal schema) ------------------

CREATE TABLE IF NOT EXISTS news_cache (
    source_url  TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    fetched_at  INTEGER NOT NULL
);

-- ---- Generic key/value store (Phase 4 auth meta) -----------------
-- Holds non-sensitive metadata tied to authentication state
-- (e.g. Steam library-sync timestamps, last Epic login time)
-- that we want to survive a logout/login cycle without forcing a
-- full remote re-fetch. Compact JSON values — values are opaque to
-- the schema.
CREATE TABLE IF NOT EXISTS kv_store (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
