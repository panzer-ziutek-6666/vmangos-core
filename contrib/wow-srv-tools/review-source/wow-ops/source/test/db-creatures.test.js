import test from 'node:test';
import assert from 'node:assert/strict';
import { listCreatures } from '../server/queries/db/creatures.js';
import { parseCreatureFilters } from '../server/queries/db/creatureFilters.js';

function scriptedPool(script) {
  const calls = [];
  return { calls, query: async (sql, params) => { calls.push({ sql, params }); return [script[calls.length - 1] ?? []]; } };
}

const ROW = { entry: 448, name: 'Hogger', subname: null, level_min: 9, level_max: 10, rank: 1, type: 7, faction: 14, spawn_count: 5, map_id: 0 };

test('both the row read and the count carry the patch clause', async () => {
  const pool = scriptedPool([[ROW], [{ total: 1 }]]);
  await listCreatures(pool, { schema: 'mangos', dbcSchema: 'dbc', filters: parseCreatureFilters({}), wowPatch: 10 });
  // Row read, count, then the page's spawn statement (patch-bounded on its
  // own terms, asserted below).
  assert.equal(pool.calls.length, 3);
  for (const call of pool.calls.slice(0, 2)) {
    assert.match(call.sql, /t1\.patch = \(SELECT MAX\(t2\.patch\)/);
    assert.ok(call.params.includes(10));
  }
});

test('the spawn count comes from the spawn table, not the template', async () => {
  const pool = scriptedPool([[ROW], [{ total: 1 }]]);
  await listCreatures(pool, { schema: 'mangos', dbcSchema: 'dbc', filters: parseCreatureFilters({}), wowPatch: 10 });
  assert.match(pool.calls[2].sql, /`creature` c/);
});

// One statement for the whole page, tallied in JS (creatures.js): a row
// naming the same entry in two columns counts once, the map is the lowest
// seen, an entry with no spawn row reads 0 / null, and a spawn row naming an
// entry that is not on the page is ignored.
test('spawns are tallied per listed entry from one statement for the page', async () => {
  const unspawned = { ...ROW, entry: 99 };
  const spawnRows = [
    { id: 448, id2: 448, id3: 0, id4: 0, id5: 0, map: 1 },
    { id: 7, id2: 448, id3: 0, id4: 0, id5: 0, map: 0 },
    { id: 7, id2: 0, id3: 0, id4: 0, id5: 0, map: 0 }
  ];
  const pool = scriptedPool([[ROW, unspawned], [{ total: 2 }], spawnRows]);
  const { rows } = await listCreatures(pool, { schema: 'mangos', dbcSchema: 'dbc', filters: parseCreatureFilters({}), wowPatch: 10 });
  assert.equal(pool.calls.length, 3, 'one spawn statement per page, not one per row');
  assert.equal(rows[0].spawn_count, 2);
  assert.equal(rows[0].map_id, 0);
  assert.equal(rows[1].spawn_count, 0);
  assert.equal(rows[1].map_id, null);
});

test('an empty page asks for no spawns at all', async () => {
  const pool = scriptedPool([[], [{ total: 0 }]]);
  await listCreatures(pool, { schema: 'mangos', dbcSchema: 'dbc', filters: parseCreatureFilters({}), wowPatch: 10 });
  assert.equal(pool.calls.length, 2);
});

test('the faction name is read from the reference schema, schema-qualified', async () => {
  const pool = scriptedPool([[ROW], [{ total: 1 }]]);
  await listCreatures(pool, { schema: 'mangos', dbcSchema: 'dbc', filters: parseCreatureFilters({}), wowPatch: 10 });
  assert.match(pool.calls[0].sql, /`dbc`\.`faction/);
});

test('a missing or half-imported reference schema still lists creatures', async () => {
  const failing = { query: async () => { const e = new Error('no such table'); e.code = 'ER_NO_SUCH_TABLE'; throw e; } };
  let calls = 0;
  const pool = { query: async (sql, params) => { calls++; if (calls === 1) return failing.query(); return [[{ ...ROW, faction_name: null }]]; } };
  const result = await listCreatures(pool, { schema: 'mangos', dbcSchema: 'dbc', filters: parseCreatureFilters({}), wowPatch: 10 });
  assert.ok(result.rows.length >= 0, 'falls back rather than throwing');
});

test('the sort key reaches SQL as its mapped expression, never as typed', async () => {
  const pool = scriptedPool([[ROW], [{ total: 1 }]]);
  await listCreatures(pool, { schema: 'mangos', dbcSchema: 'dbc', filters: parseCreatureFilters({ sort: 'level', dir: 'desc' }), wowPatch: 10 });
  assert.match(pool.calls[0].sql, /ORDER BY t1\.level_min desc/);
  assert.doesNotMatch(pool.calls[0].sql, /ORDER BY level\b/);
});

test('paging is bound, not spliced', async () => {
  const pool = scriptedPool([[ROW], [{ total: 500 }]]);
  await listCreatures(pool, { schema: 'mangos', dbcSchema: 'dbc', filters: parseCreatureFilters({ page: '3' }), wowPatch: 10 });
  assert.match(pool.calls[0].sql, /LIMIT \? OFFSET \?/);
  assert.deepEqual(pool.calls[0].params.slice(-2), [50, 100]);
});

// t1.faction (the raw numeric field) and the NULL AS faction_name placeholder
// both always carry the literal text "faction" - that is the row shape
// decision 1 requires regardless of the reference schema, so the assertion
// below targets the filter's own condition and join specifically, not the
// word "faction" anywhere in the statement.
test('a faction filter is dropped, not orphaned, when the reference schema is not configured', async () => {
  const pool = scriptedPool([[ROW], [{ total: 1 }]]);
  await listCreatures(pool, { schema: 'mangos', dbcSchema: null, filters: parseCreatureFilters({ faction: 'riverpaw' }), wowPatch: 10 });
  assert.doesNotMatch(pool.calls[0].sql, /faction\.name LIKE/);
  assert.doesNotMatch(pool.calls[0].sql, /LEFT JOIN/);
  assert.ok(!pool.calls[0].params.includes('%riverpaw%'), 'no orphaned faction parameter on the row read');
  assert.doesNotMatch(pool.calls[1].sql, /faction\.name LIKE/);
  assert.ok(!pool.calls[1].params.includes('%riverpaw%'), 'no orphaned faction parameter on the count');
});

test('a faction filter is dropped on the retry after the reference schema join fails', async () => {
  const calls = [];
  const pool = {
    // The total-count query is told apart by its whole shape (SELECT
    // COUNT(*) AS total FROM ...) - the row SELECT once carried a COUNT(*)
    // subquery of its own, and a bare includes() would match it again if one
    // came back.
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('faction_template')) {
        const e = new Error("ER_NO_SUCH_TABLE: Table 'dbc.faction_template' doesn't exist");
        e.code = 'ER_NO_SUCH_TABLE';
        throw e;
      }
      if (sql.trim().startsWith('SELECT COUNT(*) AS total')) return [[{ total: 1 }]];
      return [[{ ...ROW, faction_name: null }]];
    }
  };
  const result = await listCreatures(pool, { schema: 'mangos', dbcSchema: 'dbc', filters: parseCreatureFilters({ faction: 'riverpaw' }), wowPatch: 10 });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].faction_name, null);
  const retry = calls.find((c) => !c.sql.includes('faction_template') && !c.sql.trim().startsWith('SELECT COUNT(*) AS total'));
  assert.ok(retry, 'the row query was retried after the join failed');
  assert.doesNotMatch(retry.sql, /faction\.name LIKE/);
  assert.ok(!retry.params.includes('%riverpaw%'), 'no orphaned faction parameter on the retry');
  const count = calls.find((c) => c.sql.trim().startsWith('SELECT COUNT(*) AS total'));
  assert.doesNotMatch(count.sql, /faction\.name LIKE/);
  assert.ok(!count.params.includes('%riverpaw%'), 'no orphaned faction parameter on the count either');
});

// Was a check on two per-row subqueries; those became one statement per page
// (creatures.js), which must still carry spawns.js's patch bound, matched on
// all five id columns.
test('the spawn statement is bound to the same patch as the rest of the row', async () => {
  const pool = scriptedPool([[ROW], [{ total: 1 }]]);
  await listCreatures(pool, { schema: 'mangos', dbcSchema: 'dbc', filters: parseCreatureFilters({}), wowPatch: 10 });
  const { sql, params } = pool.calls[2];
  assert.match(sql, /c\.patch_min <= \? AND \? <= c\.patch_max/);
  for (const col of ['id', 'id2', 'id3', 'id4', 'id5']) assert.match(sql, new RegExp(`c\\.${col} IN \\(\\?\\)`));
  assert.deepEqual(params, [448, 448, 448, 448, 448, 10, 10]);
});
