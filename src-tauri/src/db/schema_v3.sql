-- =====================================================================
-- Gamelib persistent storage — v3 schema.
-- =====================================================================
--
-- Fixes the `downloads_fts` mirror triggers so they no longer collide
-- across sources.
--
-- Bug: the AFTER INSERT/UPDATE/DELETE triggers on `downloads` used
-- `new.row_id` / `old.row_id` as the `downloads_fts` rowid. `row_id`
-- is a *per-source* index (0, 1, 2, …) that is only unique together
-- with `source_id` (the `downloads` PK is `(source_id, row_id)`).
-- `downloads_fts` is a single global FTS5 virtual table whose `rowid`
-- must be unique across *every* source. So the second source ever
-- refreshed would try to INSERT a row with `rowid = 0` (its first
-- download) and hit "constraint failed", surfacing to the UI as
-- "Refresh failed: downloads insert 0: constraint failed".
--
-- Fix: use the real `downloads.rowid` (SQLite's auto-assigned integer
-- rowid, globally unique) as the FTS rowid instead. Because FTS
-- virtual-table rowids are not tied to the source, the join in
-- `search` already keys off the stored `source_id` column, so the
-- change is transparent to readers.
--
-- Triggers can't be `CREATE OR REPLACE`, so drop then (re)create.

DROP TRIGGER IF EXISTS trg_downloads_ai;
DROP TRIGGER IF EXISTS trg_downloads_au;
DROP TRIGGER IF EXISTS trg_downloads_ad;

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
