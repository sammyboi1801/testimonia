# Schema modules

A **module** is an optional feature that adds its own tables to `core.db` without touching
`core.sql` — for example `syntax` (syntax-tree search), `audio` (verse audio), `maps`
(tile packs), or `ai_annotations` (reviewed machine-generated links).

## Writing a module

1. Create `schema/modules/<name>.sql` (`<name>` = lowercase letters, digits, underscores).
2. Declare the module's own schema version at the top: `PRAGMA user_version = 1;`
   (this does **not** change core.db's version; the installer strips it).
3. Prefix every table, index and view with the module name: `audio_track`, `audio_track_vkey`.
4. Use `STRICT` tables and `CHECK` constraints like the core schema.
5. Point at core data with stable keys only: `vkey` ranges, entity ids, or URIs
   (`verse:John.1.18`, `person:irenaeus`) — never core rowids.
6. Carry `source_id TEXT NOT NULL REFERENCES source(id)` on data rows so licensing and
   credits keep working.
7. Add an ingest module in `testimonia/ingest/` that fills the tables, and tests.

The build installs requested modules with `testimonia.db.install_module(con, "<name>")`,
which records them in the `module` table.

## Prefer generic tables first

Before writing a module, check whether the core's generic tables already fit:

| Need | Use |
|---|---|
| A new property on an existing entity | `entity_attr (uri, key, value JSON, …)` |
| A new relationship between items | `entity_link (src, rel, dst, confidence, review, …)` |
| Images / audio / facsimiles | `media` + `entity_link` (`depicts`, `audio_of`, `facsimile_of`) |
| Names in another language | `label (uri, lang, field, text)` |
| Anything model-dependent (embeddings, AI outputs) | `ai.db` (`schema/ai.sql`) |
