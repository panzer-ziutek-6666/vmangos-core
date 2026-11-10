import test from 'node:test';
import assert from 'node:assert/strict';
import { dbStubPool } from './helpers/dbStubPool.js';
import { loadGameObject } from '../server/queries/db/gameobject.js';
import { renderGameObjectPage } from '../server/views/db/gameobject.js';

const CONFIG = {
  mysql: { world: { database: 'mangos' } },
  realm: { id: 1, wowPatch: 10, clientBuild: 5875 }
};

function objectRow(overrides = {}) {
  const row = { entry: 32, patch: 0, name: 'Sunken Chest', type: 3, displayId: 259, faction: 0, flags: 0, size: 1, script_name: '' };
  for (let i = 0; i <= 23; i++) row[`data${i}`] = 0;
  row.data1 = 1683;
  return { ...row, ...overrides };
}

function objectStub(overrides) {
  return dbStubPool({
    gameobject_template: [objectRow(overrides)],
    gameobject_loot_template: [{ entry: 1683, item: 1234, ChanceOrQuestChance: 50, groupid: 0, mincountOrRef: 1, maxcount: 1, condition_id: 0 }]
  });
}

// A complete loadGameObject return value, written out literally - this is
// the interface contract renderGameObjectPage is held to, the same
// convention db-quest.test.js's FIXTURE follows for renderQuestPage.
// `wowPatch` is not part of loadGameObject's own return shape
// (server/sections/db.js attaches it before rendering, the Task 9
// convention); it is included here because this fixture is
// renderGameObjectPage's actual input.
const FIXTURE = {
  entry: 32,
  patch: 0,
  patches: [0],
  wowPatch: 10,
  row: objectRow(),
  faction: null,
  dataSlots: [
    { index: 0, value: 0, label: 'lock id' },
    { index: 1, value: 1683, label: 'loot id' },
    { index: 2, value: 0, label: 'chest restock time' },
    { index: 3, value: 0, label: 'consumable' },
    { index: 4, value: 0, label: 'min success opens' },
    { index: 5, value: 0, label: 'max success opens' },
    { index: 6, value: 0, label: 'event id' },
    { index: 7, value: 0, label: 'linked trap id' },
    { index: 8, value: 0, label: 'quest id' },
    { index: 9, value: 0, label: 'level' },
    { index: 10, value: 0, label: 'los ok' },
    { index: 11, value: 0, label: 'leave loot' },
    { index: 12, value: 0, label: 'not in combat' },
    { index: 13, value: 0, label: 'log loot' },
    { index: 14, value: 0, label: 'open text id' },
    { index: 15, value: 0, label: 'group loot rules' },
    ...Array.from({ length: 8 }, (_, i) => ({ index: 16 + i, value: 0, label: null }))
  ],
  spawns: { total: 0, rows: [] },
  loot: [{ item: 1234, chance: 50, groupId: 0, minCount: 1, maxCount: 1, conditionId: 0, viaReference: null }],
  questsGiven: [],
  questsEnded: [],
  names: { item: new Map([[1234, 'Worn Sea Chart']]), quest: new Map() },
  maps: new Map()
};

test('a chest reads its loot from data1, not from its entry', async () => {
  // gameobject_template holds the loot id in data1 for type 3. Keying on
  // entry would show a chest as empty.
  const stub = objectStub();
  await loadGameObject({ world: stub.pool }, CONFIG, 32);
  const [lootCall] = stub.callsFor('gameobject_loot_template');
  assert.equal(lootCall.params[0], 1683);
});

test('a type with no loot slot asks for no loot at all', async () => {
  const stub = objectStub({ type: 0, data1: 0, name: 'Stormwind Gate' });
  await loadGameObject({ world: stub.pool }, CONFIG, 32);
  assert.equal(stub.callsFor('gameobject_loot_template').length, 0);
});

test('data slots carry a label only where the type gives them meaning', async () => {
  // A chest's union names slots 0-13, so 1 and 5 are labelled and 20 is not.
  const stub = objectStub();
  const data = await loadGameObject({ world: stub.pool }, CONFIG, 32);
  assert.equal(data.dataSlots[1].label, 'loot id');
  assert.equal(data.dataSlots[5].label, 'max success opens');
  assert.equal(data.dataSlots[20].label, null);
});

test('all 24 data slots are present even when unlabelled', async () => {
  const stub = objectStub();
  const data = await loadGameObject({ world: stub.pool }, CONFIG, 32);
  assert.equal(data.dataSlots.length, 24);
});

test('a gameobject that does not exist is null, so the route can 404', async () => {
  const stub = dbStubPool({});
  assert.equal(await loadGameObject({ world: stub.pool }, CONFIG, 99999999), null);
});

test('the page links the loot id it used', () => {
  const html = renderGameObjectPage(FIXTURE);
  assert.match(html, /loot id/);
});

test('a nonzero faction resolves to a name through faction_template, not the plain faction id RewRepFaction uses', async () => {
  // gameobject_template.faction is a faction_template id
  // (vmangos-core/src/game/Objects/GameObject.cpp:2124, GetFactionTemplateEntry) -
  // the same id space Task 9's creature.js resolves through fetchFaction, not
  // the plain `faction` (Faction.dbc) id quest_template.RewRepFaction1..5 uses
  // (Task 11's fetchFactionNames, Player.cpp:6656).
  const stub = dbStubPool({
    gameobject_template: [objectRow({ faction: 14 })],
    gameobject_loot_template: [{ entry: 1683, item: 1234, ChanceOrQuestChance: 50, groupid: 0, mincountOrRef: 1, maxcount: 1, condition_id: 0 }],
    faction_template: [{ id: 14, faction_id: 72, name: 'Monster' }]
  });
  const data = await loadGameObject({ world: stub.pool }, CONFIG, 32);
  assert.equal(data.faction.name, 'Monster');
});

test('a quest drop shows a positive chance and says it needs the quest', () => {
  const html = renderGameObjectPage({
    ...FIXTURE,
    loot: [{ item: 1234, chance: 100, needsQuest: true, groupId: 0, minCount: 1, maxCount: 1, conditionId: 0, viaReference: null }]
  });
  assert.doesNotMatch(html, /-100%/);
  assert.match(html, /100%/);
  assert.match(html, /quest drop/);
});

// Same move as the creature page: browser chrome, a way back to the object
// listview, and item cross-links that carry the hover tooltip.
test('the page offers a way back to the object list, not the search page', () => {
  const html = renderGameObjectPage(FIXTURE);
  assert.match(html, /<a href="\/db\/objects">back to objects<\/a>/);
  assert.doesNotMatch(html, /back to search/);
});

test('item cross-links in the loot table carry the tooltip host', () => {
  const html = renderGameObjectPage(FIXTURE);
  assert.match(html, /<span class="tooltip-host"><a href="\/db\/item\/1234"\s+hx-get="\/db\/tooltip\/item\/1234"/);
});

test('loot links carry the item quality the loader read', () => {
  const html = renderGameObjectPage({ ...FIXTURE, names: { ...FIXTURE.names, itemQuality: new Map([[1234, 2]]) } });
  assert.match(html, /<a class="q2" href="\/db\/item\/1234"/);
});
