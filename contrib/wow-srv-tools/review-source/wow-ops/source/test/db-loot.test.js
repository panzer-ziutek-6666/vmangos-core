import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchLoot, fetchDropSources } from '../server/queries/db/loot.js';

function scriptedPool(script) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      const step = script[calls.length - 1];
      return [step ?? []];
    }
  };
}

const DIRECT = { entry: 1120, item: 2586, ChanceOrQuestChance: 100, groupid: 0, mincountOrRef: 1, maxcount: 1, condition_id: 0 };
const REFERENCE = { entry: 1120, item: 0, ChanceOrQuestChance: 100, groupid: 0, mincountOrRef: -34567, maxcount: 1, condition_id: 0 };
const REFERENCED = { entry: 34567, item: 999, ChanceOrQuestChance: 20, groupid: 0, mincountOrRef: 1, maxcount: 2, condition_id: 0 };

test('the patch range and forbidden_items filter mirror the core', async () => {
  // vmangos-core/src/game/LootMgr.cpp:105
  const pool = scriptedPool([[DIRECT]]);
  await fetchLoot(pool, { schema: 'mangos', table: 'creature_loot_template', lootId: 1120, wowPatch: 10 });
  const { sql, params } = pool.calls[0];
  assert.match(sql, /patch_min <= \? AND \? <= patch_max/);
  assert.match(sql, /forbidden_items/);
  assert.deepEqual(params, [1120, 10, 10, 10, 10]);
});

test('a direct row keeps its counts and is not marked as inherited', async () => {
  const pool = scriptedPool([[DIRECT]]);
  const rows = await fetchLoot(pool, { schema: 'mangos', table: 'creature_loot_template', lootId: 1120, wowPatch: 10 });
  assert.deepEqual(rows, [{ item: 2586, chance: 100, needsQuest: false, groupId: 0, minCount: 1, maxCount: 1, conditionId: 0, viaReference: null }]);
});

test('a negative mincountOrRef is followed into reference_loot_template', async () => {
  // 28364 creature loot rows on this realm are references. A resolver that
  // does not follow them shows most creatures as dropping nothing.
  const pool = scriptedPool([[REFERENCE], [REFERENCED]]);
  const rows = await fetchLoot(pool, { schema: 'mangos', table: 'creature_loot_template', lootId: 1120, wowPatch: 10 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].item, 999);
  assert.equal(rows[0].viaReference, 34567);
  assert.match(pool.calls[1].sql, /`reference_loot_template`/);
  assert.deepEqual(pool.calls[1].params, [34567, 10, 10, 10, 10]);
});

test('a reference cycle terminates instead of hanging the page', async () => {
  const selfReferencing = { ...REFERENCE, entry: 34567, mincountOrRef: -34567 };
  const pool = scriptedPool([[REFERENCE], [selfReferencing]]);
  const rows = await fetchLoot(pool, { schema: 'mangos', table: 'creature_loot_template', lootId: 1120, wowPatch: 10 });
  assert.deepEqual(rows, []);
});

test('the direct-drop and reference-drop queries exclude reference rows by mincountOrRef, not by item', async () => {
  // A reference row's `item` column holds -mincountOrRef (the reference entry
  // it points at), not a real item id, so `item = ?` alone can accidentally
  // match a reference row whose target entry happens to equal the item being
  // searched for (server/queries/db/loot.js, fetchDropSources). Live-confirmed
  // for item 2043 against Baron Bloodbane's loot table (db-loot-live.test.js).
  const pool = scriptedPool([[], []]);
  await fetchDropSources(pool, { schema: 'mangos', table: 'creature_loot_template', item: 2043, wowPatch: 10 });
  assert.match(pool.calls[0].sql, /mincountOrRef > 0/);
  assert.match(pool.calls[1].sql, /mincountOrRef > 0/);
});

test('the reverse lookup finds both direct droppers and reference holders', async () => {
  const pool = scriptedPool([
    [{ entry: 1120 }],
    [{ entry: 34567 }],
    [{ entry: 2000 }]
  ]);
  const sources = await fetchDropSources(pool, { schema: 'mangos', table: 'creature_loot_template', item: 999, wowPatch: 10 });
  assert.deepEqual(sources, [
    { lootEntry: 1120, viaReference: null },
    { lootEntry: 2000, viaReference: 34567 }
  ]);
});

// A negative ChanceOrQuestChance is not a negative chance. The core reads the
// column as two values - vmangos-core/src/game/LootMgr.h:119: the drop chance
// is its absolute value, and the sign is the quest-drop flag, which only
// players on the quest ever see.
test('a negative ChanceOrQuestChance is read as a quest drop at its absolute chance', async () => {
  const pool = scriptedPool([[{ ...DIRECT, ChanceOrQuestChance: -100 }]]);
  const rows = await fetchLoot(pool, { schema: 'mangos', table: 'creature_loot_template', lootId: 1120, wowPatch: 10 });
  assert.equal(rows[0].chance, 100);
  assert.equal(rows[0].needsQuest, true);
});

test('a positive ChanceOrQuestChance is not a quest drop', async () => {
  const pool = scriptedPool([[DIRECT]]);
  const rows = await fetchLoot(pool, { schema: 'mangos', table: 'creature_loot_template', lootId: 1120, wowPatch: 10 });
  assert.equal(rows[0].needsQuest, false);
});
