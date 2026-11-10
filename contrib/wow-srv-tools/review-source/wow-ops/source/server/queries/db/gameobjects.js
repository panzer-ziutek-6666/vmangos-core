import { quoteIdentifier } from './sql.js';
import { highestPatchClause } from './progressive.js';
import { GAMEOBJECT_SORTS, LOCK_ID_SQL, LOOT_ID_SQL, QUEST_ID_SQL } from './gameobjectFilters.js';

// gameobject_template is keyed (entry, patch), same as creature_template and
// item_template - see creatures.js and progressive.js for why both the page
// of rows and the count go through highestPatchClause. 11 distinct patch
// values measured on this realm; a count that skips it reports a pager with
// more pages than there are gameobjects.
//
// lock_id, loot_id and quest_id are each read from the slot the row's own
// type keeps them in - the same expressions the locked/loot filters test, so
// a column and its filter can never disagree (gameobjectFilters.js).
const COLUMNS = [
  't1.entry', 't1.name', 't1.type',
  `${LOCK_ID_SQL} AS lock_id`, `${LOOT_ID_SQL} AS loot_id`, `${QUEST_ID_SQL} AS quest_id`
];

// A spawn point names its template through `id` alone - unlike creature's
// id..id5, gameobject has a single id column (server/queries/db/spawns.js,
// fetchGameObjectSpawns), so this is a plain equality, not a five-way OR.
//
// Correlated subqueries once per listed row, but each is an index seek -
// `gameobject` indexes `id` (idx_id) - so a 50-row page measured 63 ms.
// creatures.js could not do the same: its five-column match has no index to
// use, so it reads a page's spawns in one statement instead.
function spawnSubqueries(schema) {
  const gameobject = `${quoteIdentifier(schema)}.${quoteIdentifier('gameobject')}`;
  const where = 'g.id = t1.entry AND g.patch_min <= ? AND ? <= g.patch_max';
  return {
    count: `(SELECT COUNT(*) FROM ${gameobject} g WHERE ${where}) AS spawn_count`,
    mapId: `(SELECT MIN(g.map) FROM ${gameobject} g WHERE ${where}) AS map_id`
  };
}

// Unlike creatures.js, this module makes no reference-schema read at all:
// none of q/type/locked/loot binds against a joined table, map_id is read
// straight off the world-schema `gameobject` spawn table, and resolving it
// to a display name is the route's job (Task 6, the same way
// server/sections/db.js resolves creature map names via
// server/dbLookups/maps.js's fetchMapNames rather than joining them inside
// listCreatures - one batched query per page instead of one correlated
// subquery per row). So there is nothing here for withMissingReference to
// guard, and dbcSchema is accepted only for signature symmetry with
// listCreatures/listItems, never read.
async function fetchRows(pool, { schema, filters, wowPatch }) {
  const table = `${quoteIdentifier(schema)}.${quoteIdentifier('gameobject_template')}`;
  const patchClause = highestPatchClause(schema, 'gameobject_template', 't1');
  const where = [...filters.conditions, patchClause].join(' AND ');
  const order = `${GAMEOBJECT_SORTS[filters.sort]} ${filters.dir}`;
  const offset = (filters.page - 1) * filters.pageSize;
  const { count, mapId } = spawnSubqueries(schema);

  // spawn_count and map_id each carry one patch-bound pair, both in the
  // SELECT list, ahead of WHERE in the SQL text - their four placeholders
  // have to be bound first, or mysql2 pairs them with the wrong `?`.
  const [rows] = await pool.query(
    `SELECT ${COLUMNS.join(', ')}, ${count}, ${mapId}
     FROM ${table} t1
     WHERE ${where}
     ORDER BY ${order}, t1.entry LIMIT ? OFFSET ?`,
    [wowPatch, wowPatch, wowPatch, wowPatch, ...filters.params, wowPatch, filters.pageSize, offset]
  );
  return rows;
}

export async function listGameObjects(pool, { schema, dbcSchema, filters, wowPatch }) {
  const rows = await fetchRows(pool, { schema, filters, wowPatch });

  const table = `${quoteIdentifier(schema)}.${quoteIdentifier('gameobject_template')}`;
  const patchClause = highestPatchClause(schema, 'gameobject_template', 't1');
  const where = [...filters.conditions, patchClause].join(' AND ');

  const [counted] = await pool.query(
    `SELECT COUNT(*) AS total FROM ${table} t1 WHERE ${where}`,
    [...filters.params, wowPatch]
  );

  return { rows, total: Number(counted[0]?.total ?? 0) };
}
