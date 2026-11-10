import test from 'node:test';
import assert from 'node:assert/strict';
import { listQuests, listQuestCategories, rewardItemIds } from '../server/queries/db/quests.js';
import { parseQuestFilters } from '../server/queries/db/questFilters.js';

function scriptedPool(script) {
  const calls = [];
  return { calls, query: async (sql, params) => { calls.push({ sql, params }); return [script[calls.length - 1] ?? []]; } };
}

const ROW = { entry: 176, Title: 'Wanted: Hogger', QuestLevel: 11, MinLevel: 5, RequiredRaces: 0, ZoneOrSort: 12, Type: 0, RewXP: 1050, RewOrReqMoney: 900, zone_name: 'Elwynn Forest' };
for (let i = 1; i <= 4; i++) { ROW[`RewItemId${i}`] = 0; ROW[`RewItemCount${i}`] = 0; }
for (let i = 1; i <= 6; i++) { ROW[`RewChoiceItemId${i}`] = 0; ROW[`RewChoiceItemCount${i}`] = 0; }

test('both the row read and the count carry the patch clause', async () => {
  const pool = scriptedPool([[ROW], [{ total: 1 }]]);
  const result = await listQuests(pool, { schema: 'mangos', filters: parseQuestFilters({}), wowPatch: 10 });
  assert.equal(pool.calls.length, 2);
  for (const call of pool.calls) {
    assert.match(call.sql, /t1\.patch = \(SELECT MAX\(t2\.patch\) FROM `mangos`\.`quest_template`/);
    assert.equal(call.params.at(call === pool.calls[0] ? -3 : -1), 10);
  }
  assert.equal(result.total, 1);
});

test('the zone name is a LEFT JOIN on the world area_template, not a reference-schema read', async () => {
  const pool = scriptedPool([[ROW], [{ total: 1 }]]);
  await listQuests(pool, { schema: 'mangos', filters: parseQuestFilters({}), wowPatch: 10 });
  assert.match(pool.calls[0].sql, /LEFT JOIN `mangos`\.`area_template` a ON a\.entry = t1\.ZoneOrSort/);
  assert.doesNotMatch(pool.calls[1].sql, /area_template/);
});

test('filters bind in WHERE order ahead of the patch and paging params', async () => {
  const pool = scriptedPool([[ROW], [{ total: 1 }]]);
  await listQuests(pool, { schema: 'mangos', filters: parseQuestFilters({ side: 'horde', category: '-61', page: '3' }), wowPatch: 10 });
  assert.deepEqual(pool.calls[0].params, [255, 178, -61, 10, 50, 100]);
  assert.deepEqual(pool.calls[1].params, [255, 178, -61, 10]);
});

test('the sort key reaches SQL as its mapped column', async () => {
  const pool = scriptedPool([[ROW], [{ total: 1 }]]);
  await listQuests(pool, { schema: 'mangos', filters: parseQuestFilters({ sort: 'level', dir: 'desc' }), wowPatch: 10 });
  assert.match(pool.calls[0].sql, /ORDER BY t1\.QuestLevel desc, t1\.entry LIMIT \? OFFSET \?/);
});

test('reward item ids are collected from fixed and choice slots, once each', () => {
  const rows = [{ ...ROW, RewItemId1: 5, RewChoiceItemId2: 7 }, { ...ROW, RewItemId3: 5 }];
  assert.deepEqual(rewardItemIds(rows).sort((a, b) => a - b), [5, 7]);
});

test('categories: one statement, labelled and grouped, sorted by label', async () => {
  const pool = scriptedPool([[
    { id: 12, zone_name: 'Elwynn Forest', map_id: 0 },
    { id: -61, zone_name: null, map_id: null },
    { id: 1581, zone_name: 'The Deadmines', map_id: 36 }
  ]]);
  const cats = await listQuestCategories(pool, { schema: 'mangos', wowPatch: 10 });
  assert.equal(pool.calls.length, 1);
  assert.match(pool.calls[0].sql, /t1\.ZoneOrSort <> 0/);
  assert.match(pool.calls[0].sql, /t1\.patch = \(SELECT MAX/);
  assert.deepEqual(cats, [
    { id: 12, label: 'Elwynn Forest', group: 'Eastern Kingdoms' },
    { id: 1581, label: 'The Deadmines', group: 'Dungeons and raids' },
    { id: -61, label: 'Warlock', group: 'Class' }
  ]);
});
