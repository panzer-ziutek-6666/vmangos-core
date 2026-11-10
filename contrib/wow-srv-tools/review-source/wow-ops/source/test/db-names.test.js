import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchNames, fetchItemSummaries, fetchItemNamesWithQuality } from '../server/dbLookups/names.js';
import { fetchFaction } from '../server/dbLookups/factions.js';
import { fetchMapNames, fetchAreaNames } from '../server/dbLookups/maps.js';

function fakePool(capture, rows = []) {
  return {
    query: async (sql, params) => {
      capture.sql = sql;
      capture.params = params;
      return [rows];
    }
  };
}

function scriptedPool(script) {
  const calls = [];
  return { calls, query: async (sql, params) => { calls.push({ sql, params }); const r = script[calls.length - 1]; if (r instanceof Error) throw r; return [r ?? []]; } };
}

test('an empty id list asks the database nothing', async () => {
  // A page with no loot rows must not issue `IN ()`, which is a syntax error.
  const capture = {};
  const names = await fetchNames(fakePool(capture), { schema: 'mangos', kind: 'item', ids: [], wowPatch: 10, clientBuild: 5875 });
  assert.equal(names.size, 0);
  assert.equal(capture.sql, undefined);
});

test('names are fetched in one statement for the whole list', async () => {
  const capture = {};
  await fetchNames(fakePool(capture), { schema: 'mangos', kind: 'item', ids: [2586, 1234], wowPatch: 10, clientBuild: 5875 });
  assert.match(capture.sql, /`mangos`\.`item_template`/);
  assert.match(capture.sql, /entry IN \(\?, \?\)/);
  assert.deepEqual(capture.params, [2586, 1234, 10]);
});

test('quest names come from Title, not name', async () => {
  const capture = {};
  await fetchNames(fakePool(capture), { schema: 'mangos', kind: 'quest', ids: [176], wowPatch: 10, clientBuild: 5875 });
  assert.match(capture.sql, /Title AS name/);
});

test('spells are keyed by build, not by patch', async () => {
  // spell_template is keyed (entry, build) like the faction tables; the
  // progressive patch rule does not apply to it at all. It still resolves
  // by "highest build not above the running one", not an exact match: only
  // 1003 of 22381 spell entries on this realm's world DB carry a row at
  // build 5875, so an exact `build = ?` would blank most spell names.
  const capture = {};
  await fetchNames(fakePool(capture), { schema: 'mangos', kind: 'spell', ids: [133], wowPatch: 10, clientBuild: 5875 });
  assert.match(capture.sql, /`spell_template`/);
  assert.match(capture.sql, /MAX\(t2\.build\)/);
  assert.match(capture.sql, /t2\.build <= \?/);
  assert.deepEqual(capture.params, [133, 5875]);
});

test('an unknown kind is a programming error and throws', async () => {
  await assert.rejects(
    () => fetchNames(fakePool({}), { schema: 'mangos', kind: 'banana', ids: [1], wowPatch: 10, clientBuild: 5875 }),
    /banana/
  );
});

test('a faction lookup pins the client build on both tables', async () => {
  const capture = {};
  await fetchFaction(fakePool(capture, [{ id: 14, faction_id: 14, name: 'Monster' }]), {
    schema: 'mangos', factionTemplateId: 14, clientBuild: 5875
  });
  assert.deepEqual(capture.params, [14, 5875, 5875]);
});

test('map names use the progressive patch rule', async () => {
  const capture = {};
  await fetchMapNames(fakePool(capture), { schema: 'mangos', mapIds: [0, 33], wowPatch: 10 });
  assert.match(capture.sql, /MAX\(t2\.patch\)/);
  assert.deepEqual(capture.params, [0, 33, 10]);
});

test('an empty area id list asks the database nothing', async () => {
  const capture = {};
  const names = await fetchAreaNames(fakePool(capture), { schema: 'mangos', areaIds: [] });
  assert.equal(names.size, 0);
  assert.equal(capture.sql, undefined);
});

test('area names are fetched in one statement, unfiltered by patch or build', async () => {
  // area_template carries no patch_min/patch_max and no build column at all
  // (unlike map_template beside it) - a patch or build clause here would be
  // a column that does not exist, not merely an unnecessary one.
  const capture = {};
  await fetchAreaNames(fakePool(capture, [{ entry: 12, name: 'Elwynn Forest' }]), {
    schema: 'mangos', areaIds: [12, 12, 40]
  });
  assert.match(capture.sql, /`mangos`\.`area_template`/);
  assert.match(capture.sql, /entry IN \(\?, \?\)/);
  assert.doesNotMatch(capture.sql, /patch/i);
  assert.doesNotMatch(capture.sql, /build/i);
  assert.deepEqual(capture.params, [12, 40]);
});

test('item summaries carry name, quality and icon from one patch-bounded statement', async () => {
  const pool = scriptedPool([[{ entry: 19019, name: 'Thunderfury', quality: 5, inventory_icon: 'INV_Sword_39' }]]);
  const map = await fetchItemSummaries(pool, { schema: 'mangos', dbcSchema: 'dbc', ids: [19019, 19019], wowPatch: 10 });
  assert.deepEqual(map.get(19019), { name: 'Thunderfury', quality: 5, icon: 'INV_Sword_39' });
  assert.equal(pool.calls.length, 1);
  assert.match(pool.calls[0].sql, /t1\.patch = \(SELECT MAX\(t2\.patch\)/);
  assert.match(pool.calls[0].sql, /`dbc`\.`item_display_info`/);
  assert.deepEqual(pool.calls[0].params, [19019, 10]);
});

test('a missing reference schema drops the icon, not the names', async () => {
  const missing = Object.assign(new Error('no table'), { code: 'ER_NO_SUCH_TABLE' });
  const pool = scriptedPool([missing, [{ entry: 1, name: 'Stick', quality: 0, inventory_icon: null }]]);
  const map = await fetchItemSummaries(pool, { schema: 'mangos', dbcSchema: 'dbc', ids: [1], wowPatch: 10 });
  assert.deepEqual(map.get(1), { name: 'Stick', quality: 0, icon: null });
  assert.doesNotMatch(pool.calls[1].sql, /item_display_info/);
});

test('no ids asks nothing', async () => {
  const pool = scriptedPool([]);
  assert.equal((await fetchItemSummaries(pool, { schema: 'mangos', ids: [], wowPatch: 10 })).size, 0);
  assert.equal(pool.calls.length, 0);
});

test('names and qualities come back as two maps, quality 0 kept', async () => {
  const pool = scriptedPool([[{ entry: 1, name: 'Stick', quality: 0, inventory_icon: null }]]);
  const { names, qualities } = await fetchItemNamesWithQuality(pool, { schema: 'mangos', ids: [1], wowPatch: 10 });
  assert.equal(names.get(1), 'Stick');
  assert.equal(qualities.get(1), 0);
  assert.doesNotMatch(pool.calls[0].sql, /item_display_info/);
});
