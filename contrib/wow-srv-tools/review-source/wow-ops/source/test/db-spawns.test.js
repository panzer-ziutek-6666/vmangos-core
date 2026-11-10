import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCreatureSpawns, fetchGameObjectSpawns } from '../server/queries/db/spawns.js';

function scriptedPool(script) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      return [script[calls.length - 1] ?? []];
    }
  };
}

test('a creature spawn lookup searches all five id columns', async () => {
  // The server picks one of id..id5 at spawn time. Only `id` is indexed, so
  // this scans - 66243 rows, which is cheaper than adding an index to a table
  // the released world dump owns.
  const pool = scriptedPool([[{ n: 2 }], []]);
  await fetchCreatureSpawns(pool, { schema: 'mangos', entry: 448, wowPatch: 10, limit: 50 });
  const { sql, params } = pool.calls[0];
  assert.match(sql, /id = \? OR id2 = \? OR id3 = \? OR id4 = \? OR id5 = \?/);
  assert.deepEqual(params, [448, 448, 448, 448, 448, 10, 10]);
});

test('spawns outside the running patch are excluded', async () => {
  const pool = scriptedPool([[{ n: 0 }], []]);
  await fetchCreatureSpawns(pool, { schema: 'mangos', entry: 448, wowPatch: 10, limit: 50 });
  assert.match(pool.calls[0].sql, /patch_min <= \? AND \? <= patch_max/);
});

test('the total is reported separately from the capped rows', async () => {
  const pool = scriptedPool([
    [{ n: 900 }],
    [{ guid: 1, id: 448, id2: 0, id3: 0, id4: 0, id5: 0, map: 0, position_x: 1.5, position_y: 2.5, position_z: 3.5 }]
  ]);
  const { rows, total } = await fetchCreatureSpawns(pool, { schema: 'mangos', entry: 448, wowPatch: 10, limit: 50 });
  assert.equal(total, 900);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { guid: 1, map: 0, x: 1.5, y: 2.5, z: 3.5, column: 'id' });
});

test('the row says which id column matched, because it is not always id', async () => {
  const pool = scriptedPool([
    [{ n: 1 }],
    [{ guid: 7, id: 999, id2: 448, id3: 0, id4: 0, id5: 0, map: 1, position_x: 0, position_y: 0, position_z: 0 }]
  ]);
  const { rows } = await fetchCreatureSpawns(pool, { schema: 'mangos', entry: 448, wowPatch: 10, limit: 50 });
  assert.equal(rows[0].column, 'id2');
});

test('the limit is inlined as a validated integer, never bound', async () => {
  // mysql2 would quote a bound LIMIT value; the guard is that nothing but an
  // integer ever reaches the string.
  const pool = scriptedPool([[{ n: 0 }], []]);
  await fetchCreatureSpawns(pool, { schema: 'mangos', entry: 448, wowPatch: 10, limit: 25 });
  assert.match(pool.calls[1].sql, /LIMIT 25/);
  await assert.rejects(
    () => fetchCreatureSpawns(pool, { schema: 'mangos', entry: 448, wowPatch: 10, limit: '25; DROP TABLE creature' }),
    /limit/
  );
});

test('gameobject spawns are looked up on the single id column', async () => {
  const pool = scriptedPool([[{ n: 1 }], []]);
  await fetchGameObjectSpawns(pool, { schema: 'mangos', entry: 32, wowPatch: 10, limit: 50 });
  assert.match(pool.calls[0].sql, /`gameobject`/);
  assert.deepEqual(pool.calls[0].params, [32, 10, 10]);
});
