//! Embedded SQL schema strings.
//!
//! Every table Gamelib uses lives in a constant here, so the schema
//! is reviewable in one place and can be unit-tested (we apply each
//! DDL against a temp DB and verify it's idempotent).
//!
//! ## Conventions
//!
//! - Timestamps: unix seconds (u64), nullable columns default NULL.
//! - Compact JSON columns: when a piece of state is "too varied to be
//!   worth its own columns", we serialize it as compact JSON into a
//!   single TEXT column. Reads accept the deserialization cost; writes
//!   skip the schema-overhead cost.
//! - Foreign keys with `ON DELETE CASCADE` model ownership. The
//!   `sources` table is the canonical source of truth; deleting a
//!   source cascades to its cache, downloads, and FTS5 mirrors.

/// DDL for v1 of the schema. Ordered so dependencies come first
/// (parents before children, tables before their `CREATE TRIGGER`
/// statements).
pub const V1_SCHEMA: &str = include_str!("schema_v1.sql");

/// DDL for v2 of the schema. Adds two columns to `games` to support
/// the GOG Galaxy integration (`gog_game_id`, `gog_playtime`).
/// Both default `NULL` to preserve backward-compat for installs
/// that have pre-existing rows without GOG metadata — the Rust DAO
/// uses `Option<..>` for both.
pub const V2_SCHEMA: &str = include_str!("schema_v2.sql");

/// DDL for v3 of the schema. Recreates the `downloads_fts` mirror
/// triggers so they key off the globally-unique `downloads.rowid`
/// rather than the per-source `row_id` (which collided across
/// sources and caused "Refresh failed: downloads insert N: constraint
/// failed" the second time a source was added).
pub const V3_SCHEMA: &str = include_str!("schema_v3.sql");

/// Bootstrap the schema-meta table on a fresh DB. This table is
/// itself part of v1, but we need to read `PRAGMA user_version`
/// *before* applying v1, so bootstrap is logically a separate step.
pub const META_BOOTSTRAP: &str = "
CREATE TABLE IF NOT EXISTS schema_meta (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
);
";

/// All currently known schema versions, oldest first.
///
/// `db::migrate::run_migrations` iterates this list, skipping versions
/// that are already in `PRAGMA user_version`, and applies the rest in
/// order inside individual transactions.
///
/// **Adding a new version**: append `(vN, &new_const)` at the end —
/// never renumber existing tuples (existing installs row-locked on
/// the corresponding `schema_meta` entry would otherwise miss the
/// bump). New columns should be appended via `ALTER TABLE … ADD
/// COLUMN`, never by editing the existing schema file's
/// `CREATE TABLE` clause (existing installs would never see the
/// edit because their `schema_version` is already past v1).
pub const SCHEMA_VERSIONS: &[(&str, &str)] = &[("v1", V1_SCHEMA), ("v2", V2_SCHEMA), ("v3", V3_SCHEMA)];
