-- =====================================================================
-- Gamelib persistent storage — v2 schema.
-- =====================================================================
--
-- Adds two columns to `games` to support the GOG Galaxy integration:
--   * `gog_game_id`    — GOG numeric product id (e.g. "1207658925").
--                        Used as the dedup key on sync.
--   * `gog_playtime`   — Playtime in MINUTES, from the GOG gameplay
--                        endpoint `https://gameplay.gog.com/clients/
--                        <user_id>/playtime`.
--
-- Why a separate migration file rather than appending to schema_v1.sql?
--
--   We don't get to retro-rewrite schema_v1.sql in place because
--   `db::migrate::run_migrations` uses a **string `schema_version`
--   row** in `schema_meta` (not `PRAGMA user_version`) to gate each
--   version. Existing installs reporting `v1` need the v2 ALTER
--   applied explicitly; bundling new columns into v1 would silently
--   skip them on any DB that already migrated past v1. The
--   `IF NOT EXISTS` plumbed into each ALTER is belt-and-braces —
--   idempotent if the DB is at v2 already or if a future rollback
--   re-runs v2 against a schema that has the columns.
--
-- Both ALTERs default `NULL` (i.e. absent for rows that pre-date
-- the GOG integration), which is exactly what `GameRow`'s
-- `#[serde(skip_serializing_if = "Option::is_none")]` decoration
-- on the new fields expects.

ALTER TABLE games ADD COLUMN gog_game_id TEXT;
ALTER TABLE games ADD COLUMN gog_playtime INTEGER;
