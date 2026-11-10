import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteIdentifier, worldSchema } from '../server/queries/db/sql.js';
import { highestPatchClause, highestBuildClause, highestBuildJoin, fetchTemplateRow, fetchBuildRowOnly } from '../server/queries/db/progressive.js';

function fakePool(capture, results) {
  let call = 0;
  return {
    query: async (sql, params) => {
      capture.calls = capture.calls ?? [];
      capture.calls.push({ sql, params });
      return [results[call++] ?? []];
    }
  };
}

test('an identifier with a backtick cannot break out of its quotes', () => {
  assert.equal(quoteIdentifier('a`b'), '`a``b`');
});

test('worldSchema returns null when no world database is configured', () => {
  assert.equal(worldSchema({ mysql: {} }), null);
  assert.equal(worldSchema({ mysql: { world: { database: 'mangos' } } }), 'mangos');
});

test('the clause is the core rule: highest patch not above the running one', () => {
  // vmangos-core/src/shared/Database/SQLStorageImpl.h:364
  const clause = highestPatchClause('mangos', 'creature_template', 't1');
  assert.match(clause, /t1\.patch = \(SELECT MAX\(t2\.patch\)/);
  assert.match(clause, /FROM `mangos`\.`creature_template` t2/);
  assert.match(clause, /t2\.entry = t1\.entry/);
  assert.match(clause, /t2\.patch <= \?/);
});

test('the build clause is the same core rule, correlated on build instead of patch', () => {
  // vmangos-core/src/game/Spells/SpellMgr.cpp:3722,
  // vmangos-core/src/game/ObjectMgr.cpp:8743
  const clause = highestBuildClause('mangos', 'spell_template', 't1');
  assert.match(clause, /t1\.build = \(SELECT MAX\(t2\.build\)/);
  assert.match(clause, /FROM `mangos`\.`spell_template` t2/);
  assert.match(clause, /t2\.entry = t1\.entry/);
  assert.match(clause, /t2\.build <= \?/);
});

test('the build clause takes an id column for tables not keyed on entry', () => {
  // faction and faction_template are keyed `id`, not `entry`.
  const clause = highestBuildClause('mangos', 'faction_template', 't1', 'id');
  assert.match(clause, /t2\.id = t1\.id/);
});

test('the build join is the same rule as a derived per-key max-build table', () => {
  // vmangos-core/src/game/Spells/SpellMgr.cpp:3722 - same rule as
  // highestBuildClause, but as a join against a derived per-key max-build
  // table instead of a correlated subquery: skill_line_ability's primary key
  // is (id, build), so a correlated MAX(build) subquery on id still runs
  // once per outer row of the whole table (about 55k on this realm) rather
  // than once total. This computes each key's highest build <= ? a single
  // time up front instead.
  const join = highestBuildJoin('mangos', 'skill_line_ability', 's', 'id');
  assert.equal(
    join,
    'JOIN (SELECT id, MAX(build) AS build FROM `mangos`.`skill_line_ability` WHERE build <= ? GROUP BY id) m ON m.id = s.id AND m.build = s.build'
  );
});

test('fetchTemplateRow binds the entry and the patch in that order', async () => {
  const capture = {};
  const pool = fakePool(capture, [[{ entry: 448, patch: 0, name: 'Hogger' }], [{ patch: 0 }]]);
  await fetchTemplateRow(pool, { schema: 'mangos', table: 'creature_template', entry: 448, wowPatch: 10 });
  assert.deepEqual(capture.calls[0].params, [448, 10]);
});

test('fetchTemplateRow reports every patch variant the entry has', async () => {
  const pool = fakePool({}, [
    [{ entry: 176, patch: 7, Title: 'Wanted: Hogger' }],
    [{ patch: 0 }, { patch: 7 }]
  ]);
  const found = await fetchTemplateRow(pool, { schema: 'mangos', table: 'quest_template', entry: 176, wowPatch: 10 });
  assert.equal(found.patch, 7);
  assert.deepEqual(found.patches, [0, 7]);
  assert.equal(found.row.Title, 'Wanted: Hogger');
});

test('a missing entry is null, not an empty row', async () => {
  const pool = fakePool({}, [[], []]);
  const found = await fetchTemplateRow(pool, { schema: 'mangos', table: 'item_template', entry: 1, wowPatch: 10 });
  assert.equal(found, null);
});

test('fetchBuildRowOnly reads one row under the highest-build rule', async () => {
  const calls = [];
  const pool = { query: async (sql, params) => { calls.push({ sql, params }); return [[{ entry: 133, build: 5875 }]]; } };
  const row = await fetchBuildRowOnly(pool, { schema: 'mangos', table: 'spell_template', entry: 133, clientBuild: 5875 });
  assert.equal(row.build, 5875);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [133, 5875]);
  assert.match(calls[0].sql, /t1\.build = \(SELECT MAX\(t2\.build\)/);
});
