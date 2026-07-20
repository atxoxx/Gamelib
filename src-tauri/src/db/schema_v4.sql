-- =====================================================================
-- Gamelib persistent storage — v4 schema.
-- =====================================================================
-- Adds the human-readable game name to the `sessions` table so the
-- Activity dashboard can group / rank by name without a JOIN back to
-- `games` (whose `name` may differ from the name the watcher tracked
-- at session time, e.g. passive WMI-detected windows).
--
-- `ALTER TABLE … ADD COLUMN` is idempotent at the data level for a
-- fresh install that already went through v1–v3 (the column simply
-- lands last); the migration runner applies this exactly once per
-- install because `schema_version` advances to `v4` after it commits.

ALTER TABLE sessions ADD COLUMN game_name TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS ix_sessions_game_name ON sessions(game_name);
