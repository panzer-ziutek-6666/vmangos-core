import { quoteIdentifier } from './sql.js';

// creature_template, item_template, quest_template and gameobject_template are
// all keyed (entry, patch). The core does not read them with a plain
// WHERE entry = ?: SQLStorageLoaderBase::LoadProgressive takes, per entry, the
// row with the highest patch not above sWorld.GetWowPatch()
// (vmangos-core/src/shared/Database/SQLStorageImpl.h:364), and
// ObjectMgr::LoadCreatureTemplates issues that same shape by hand
// (vmangos-core/src/game/ObjectMgr.cpp:1203).
//
// 287 quest entries carry more than one patch row on this realm. Reading them
// without this clause shows rows the server never loaded - the artefact that
// faked a 294-quest gap in the pfQuest diff of 2026-09-01.
export function highestPatchClause(schema, table, alias = 't1') {
  const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  return `${alias}.patch = (SELECT MAX(t2.patch) FROM ${qualified} t2 WHERE t2.entry = ${alias}.entry AND t2.patch <= ?)`;
}

// faction, faction_template and spell_template are keyed (id or entry, build)
// instead of (entry, patch), but the core loads them with the exact same
// "highest value not above the running one" shape - just correlated on
// `build` instead of `patch`:
// `build = (SELECT max(build) FROM t2 WHERE t1.entry = t2.entry AND build <= SUPPORTED_CLIENT_BUILD)`
// at vmangos-core/src/game/Spells/SpellMgr.cpp:3722 (spell_template) and
// vmangos-core/src/game/ObjectMgr.cpp:8743 (faction, keyed by `id` there,
// not `entry`). An exact `build = ?` match is wrong: on this realm's world
// DB only 1003 of 22381 distinct spell_template entries carry a row at
// build 5875, so exact match would blank the name for the other ~95%
// instead of falling back to their nearest earlier build.
export function highestBuildClause(schema, table, alias = 't1', keyColumn = 'entry') {
  const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  return `${alias}.build = (SELECT MAX(t2.build) FROM ${qualified} t2 WHERE t2.${keyColumn} = ${alias}.${keyColumn} AND t2.build <= ?)`;
}

// The same rule as highestBuildClause (SpellMgr.cpp:3722), as a JOIN against
// a derived per-key max-build table instead of a correlated subquery. Use
// this, not highestBuildClause, for skill_line_ability's learnable-spell
// subquery (spellFilters.js): its primary key is (id, build), so `id` is
// indexed, but a correlated MAX(build) subquery still executes once for
// every one of the table's rows (about 55k on this realm) before the outer
// query can apply, because that is how a correlated subquery runs regardless
// of indexing - `spell_id`, the column the subquery is actually filtered on,
// genuinely is unindexed on top of that. The derived table computes each
// id's highest build <= ? a single time; the outer query is then a plain
// equi-join on (id, build). Measured against the live realm 2026-09-23: the
// /db/spells default page's learnable condition (highestBuildClause,
// correlated) took ~1.1s for listSpells's rows statement; the same condition
// rewritten with this join took ~257ms.
export function highestBuildJoin(schema, table, alias = 't1', keyColumn = 'entry') {
  const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  return `JOIN (SELECT ${keyColumn}, MAX(build) AS build FROM ${qualified} WHERE build <= ? GROUP BY ${keyColumn}) m ON m.${keyColumn} = ${alias}.${keyColumn} AND m.build = ${alias}.build`;
}

// The row alone, patch-bounded, with no read of the entry's other patch rows
// - for a caller that will never render the variant banner (a hover card)
// and has to spend its query budget elsewhere instead: the quest tooltip's
// zone name (GET /db/tooltip/quest/:id, at most two queries total - the row,
// then the zone only when ZoneOrSort names one). fetchTemplateRow below
// shares this statement rather than repeating it, for the same row its own
// first query needs.
export async function fetchTemplateRowOnly(pool, { schema, table, entry, wowPatch }) {
  const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  const [rows] = await pool.query(
    `SELECT t1.* FROM ${qualified} t1 WHERE t1.entry = ? AND ${highestPatchClause(schema, table, 't1')}`,
    [entry, wowPatch]
  );
  return rows[0] ?? null;
}

// The (entry, build) twin of fetchTemplateRowOnly, for spell_template.
export async function fetchBuildRowOnly(pool, { schema, table, entry, clientBuild }) {
  const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  const [rows] = await pool.query(
    `SELECT t1.* FROM ${qualified} t1 WHERE t1.entry = ? AND ${highestBuildClause(schema, table, 't1')}`,
    [entry, clientBuild]
  );
  return rows[0] ?? null;
}

// Returns the row the server would have loaded, the patch it came from, and
// every patch value that entry has. The page shows the last of those: an entry
// with variants is exactly where a hand-written query goes wrong, so the browser
// says so out loud instead of quietly picking one.
export async function fetchTemplateRow(pool, { schema, table, entry, wowPatch }) {
  const row = await fetchTemplateRowOnly(pool, { schema, table, entry, wowPatch });
  if (!row) return null;

  const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  const [patchRows] = await pool.query(
    `SELECT patch FROM ${qualified} WHERE entry = ? ORDER BY patch`,
    [entry]
  );

  return {
    row,
    patch: Number(row.patch),
    patches: patchRows.map((r) => Number(r.patch))
  };
}
