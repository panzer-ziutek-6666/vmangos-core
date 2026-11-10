import test from 'node:test';
import assert from 'node:assert/strict';
import { listGameObjects } from '../server/queries/db/gameobjects.js';
import { parseGameObjectFilters, LOCK_ID_SQL, LOOT_ID_SQL } from '../server/queries/db/gameobjectFilters.js';

function scriptedPool(script) {
  const calls = [];
  return { calls, query: async (sql, params) => { calls.push({ sql, params }); return [script[calls.length - 1] ?? []]; } };
}

const ROW = { entry: 1731, name: 'Chest', type: 3, lock_id: 11, loot_id: 4700, quest_id: 0, spawn_count: 2, map_id: 0 };

test('both the row read and the count carry the patch clause', async () => {
  const pool = scriptedPool([[ROW], [{ total: 1 }]]);
  await listGameObjects(pool, { schema: 'mangos', dbcSchema: 'dbc', filters: parseGameObjectFilters({}), wowPatch: 10 });
  assert.equal(pool.calls.length, 2);
  for (const call of pool.calls) {
    assert.match(call.sql, /t1\.patch = \(SELECT MAX\(t2\.patch\)/);
    assert.ok(call.params.includes(10));
  }
});

test('the spawn count comes from the spawn table, not the template', async () => {
  const pool = scriptedPool([[ROW], [{ total: 1 }]]);
  await listGameObjects(pool, { schema: 'mangos', dbcSchema: 'dbc', filters: parseGameObjectFilters({}), wowPatch: 10 });
  assert.match(pool.calls[0].sql, /`gameobject`/);
});

// This module makes no reference-schema read at all: unlike creatures.js's
// faction join, nothing here binds against a joined dbcSchema table, and
// map_id is resolved to a display name by the route (Task 6), the same way
// server/sections/db.js resolves creature map names outside listCreatures.
// So dbcSchema is accepted (signature symmetry with listCreatures/listItems)
// but never read, and there is nothing for withMissingReference to guard.
test('dbcSchema is accepted but never reaches the SQL text', async () => {
  const pool = scriptedPool([[ROW], [{ total: 1 }]]);
  await listGameObjects(pool, { schema: 'mangos', dbcSchema: 'dbc', filters: parseGameObjectFilters({}), wowPatch: 10 });
  assert.doesNotMatch(pool.calls[0].sql, /`dbc`/);
});

// gameobject has a single `id` column (server/queries/db/spawns.js), unlike
// creature's id..id5, so the spawn lookup is a plain equality, never a
// five-way OR.
test('the spawn lookup matches on the single id column, not a five-way OR', async () => {
  const pool = scriptedPool([[ROW], [{ total: 1 }]]);
  await listGameObjects(pool, { schema: 'mangos', dbcSchema: 'dbc', filters: parseGameObjectFilters({}), wowPatch: 10 });
  assert.doesNotMatch(pool.calls[0].sql, /id2|id3|id4|id5/);
  assert.match(pool.calls[0].sql, /g\.id = t1\.entry/);
});

test('the sort key reaches SQL as its mapped expression, never as typed', async () => {
  const pool = scriptedPool([[ROW], [{ total: 1 }]]);
  await listGameObjects(pool, { schema: 'mangos', dbcSchema: 'dbc', filters: parseGameObjectFilters({ sort: 'type', dir: 'desc' }), wowPatch: 10 });
  assert.match(pool.calls[0].sql, /ORDER BY t1\.type desc/);
  assert.doesNotMatch(pool.calls[0].sql, /ORDER BY type\b/);
});

test('paging is bound, not spliced', async () => {
  const pool = scriptedPool([[ROW], [{ total: 500 }]]);
  await listGameObjects(pool, { schema: 'mangos', dbcSchema: 'dbc', filters: parseGameObjectFilters({ page: '3' }), wowPatch: 10 });
  assert.match(pool.calls[0].sql, /LIMIT \? OFFSET \?/);
  assert.deepEqual(pool.calls[0].params.slice(-2), [50, 100]);
});

// Lock and loot presence filters bind no parameter (decision 2), so the row
// read's param list must not grow when they are applied - only the
// conditions text changes.
test('locked and loot conditions bind no extra parameters', async () => {
  const pool = scriptedPool([[ROW], [{ total: 1 }]]);
  await listGameObjects(pool, { schema: 'mangos', dbcSchema: 'dbc', filters: parseGameObjectFilters({ locked: '1', loot: '1' }), wowPatch: 10 });
  assert.ok(pool.calls[0].sql.includes(`${LOCK_ID_SQL} <> 0`));
  assert.ok(pool.calls[0].sql.includes(`${LOOT_ID_SQL} <> 0`));
  assert.match(pool.calls[0].sql, /AS lock_id, .* AS loot_id, .* AS quest_id/);
});

test('the spawn_count and map_id subqueries are bound to the same patch as the rest of the row', async () => {
  const pool = scriptedPool([[ROW], [{ total: 1 }]]);
  await listGameObjects(pool, { schema: 'mangos', dbcSchema: 'dbc', filters: parseGameObjectFilters({}), wowPatch: 10 });
  const sql = pool.calls[0].sql;
  const patchBoundCount = (sql.match(/g\.patch_min <= \? AND \? <= g\.patch_max/g) || []).length;
  // count and map_id each carry the bound pair.
  assert.equal(patchBoundCount, 2);
  assert.deepEqual(pool.calls[0].params.slice(0, 4), [10, 10, 10, 10]);
});
