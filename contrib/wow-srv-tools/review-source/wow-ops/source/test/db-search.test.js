import test from 'node:test';
import assert from 'node:assert/strict';
import { searchTemplates } from '../server/queries/db/search.js';
import { dbStubPool } from './helpers/dbStubPool.js';

function countingPool(rowsByCall) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      return [rowsByCall[calls.length - 1] ?? []];
    }
  };
}

test('a numeric query is offered as an id in every type', async () => {
  const pool = countingPool([[{ id: 448, name: 'Hogger' }], [], [], [], [], [], []]);
  const result = await searchTemplates(pool, { schema: 'mangos', query: '448', wowPatch: 10, clientBuild: 5875, limit: 50 });
  assert.equal(result.numeric, true);
  assert.equal(result.groups.length, 7);
  assert.deepEqual(result.groups[0], { kind: 'creature', rows: [{ id: 448, name: 'Hogger' }], total: 1 });
  assert.deepEqual(result.groups[1], { kind: 'item', rows: [], total: 0 });
  // An id lookup needs no COUNT: there is at most one row per type.
  assert.equal(pool.calls.length, 7);
});

test('a text query searches names and collapses patch variants', async () => {
  const pool = countingPool([
    [{ n: 2 }], [{ id: 448, name: 'Hogger' }],
    [{ n: 0 }], [],
    [{ n: 0 }], [],
    [{ n: 0 }], [],
    [{ n: 0 }], [],
    [{ n: 0 }], [],
    [{ n: 0 }], []
  ]);
  const result = await searchTemplates(pool, { schema: 'mangos', query: 'hogger', wowPatch: 10, clientBuild: 5875, limit: 50 });
  assert.equal(result.numeric, false);
  assert.equal(result.groups[0].total, 2);
  assert.equal(result.groups[0].rows.length, 1);
  assert.match(pool.calls[1].sql, /MAX\(t2\.patch\)/);
  assert.deepEqual(pool.calls[1].params, ['%hogger%', 10]);
});

test('a percent sign in the query is escaped, not treated as a wildcard', async () => {
  const pool = countingPool([
    [{ n: 0 }], [],
    [{ n: 0 }], [],
    [{ n: 0 }], [],
    [{ n: 0 }], [],
    [{ n: 0 }], [],
    [{ n: 0 }], [],
    [{ n: 0 }], []
  ]);
  await searchTemplates(pool, { schema: 'mangos', query: '100%', wowPatch: 10, clientBuild: 5875, limit: 50 });
  assert.deepEqual(pool.calls[1].params, ['%100\\%%', 10]);
});

test('an empty query asks the database nothing', async () => {
  const pool = countingPool([]);
  const result = await searchTemplates(pool, { schema: 'mangos', query: '   ', wowPatch: 10, clientBuild: 5875, limit: 50 });
  assert.equal(result.groups.length, 0);
  assert.equal(pool.calls.length, 0);
});

test('search reaches spells, zones and factions, each read the way its page reads it', async () => {
  const stub = dbStubPool({
    spell_template: [{ id: 133, name: 'Fireball' }],
    area_template: [{ id: 12, name: 'Elwynn Forest' }],
    faction: [{ id: 72, name: 'Stormwind' }]
  });
  const result = await searchTemplates(stub.pool, { schema: 'mangos', query: 'e', wowPatch: 10, clientBuild: 5875, limit: 50 });
  assert.deepEqual(result.groups.map((g) => g.kind), ['creature', 'item', 'quest', 'gameobject', 'spell', 'zone', 'faction']);
  const spellRows = stub.callsFor('spell_template').find((c) => !/COUNT/.test(c.sql));
  assert.match(spellRows.sql, /t2\.build <= \?/);
  assert.deepEqual(spellRows.params, ['%e%', 5875]);
  const zoneRows = stub.callsFor('area_template').find((c) => !/COUNT/.test(c.sql));
  assert.doesNotMatch(zoneRows.sql, /zone_id = 0/);
  assert.deepEqual(zoneRows.params, ['%e%']);
  const factionRows = stub.callsFor('`faction`').find((c) => !/COUNT/.test(c.sql));
  assert.match(factionRows.sql, /t2\.id = t1\.id AND t2\.build <= \?/);
});

test('an id search looks the id up in all seven kinds', async () => {
  const stub = dbStubPool({});
  const result = await searchTemplates(stub.pool, { schema: 'mangos', query: '12', wowPatch: 10, clientBuild: 5875, limit: 50 });
  assert.equal(result.groups.length, 7);
  assert.equal(stub.calls.length, 7);
});
