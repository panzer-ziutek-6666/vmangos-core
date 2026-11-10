import test from 'node:test';
import assert from 'node:assert/strict';
import { dbStubPool } from './helpers/dbStubPool.js';
import { loadCreature } from '../server/queries/db/creature.js';
import { renderCreaturePage } from '../server/views/db/creature.js';

const CONFIG = {
  mysql: { world: { database: 'mangos' } },
  realm: { id: 1, wowPatch: 10, clientBuild: 5875 }
};

// The template row every test starts from. vendor_id 5 and the vendor bit in
// npc_flags (UNIT_NPC_FLAG_VENDOR is 0x4, UnitDefines.h:605) are what make the
// two-table vendor read fire.
const TEMPLATE = {
  entry: 448, patch: 0, name: 'Hogger', subname: null,
  loot_id: 1120, pickpocket_loot_id: 0, skinning_loot_id: 0,
  faction: 14, npc_flags: 4, type: 7, rank: 1, unit_class: 1,
  level_min: 9, level_max: 10, vendor_id: 5, trainer_id: 0,
  ai_name: '', script_name: '', movement_type: 1, inhabit_type: 3
};

// A complete loadCreature return value, written out literally rather than
// built by a helper - this is the interface contract Tasks 10-12 mirror for
// their own entity pages. The one addition beyond loadCreature's own return
// is `wowPatch`: the section route attaches the configured patch before
// calling renderCreaturePage, the same way it already knows it for the
// search page (server/sections/db.js), so loadCreature itself never needs to
// carry the server's own configuration back out through its return value.
const FIXTURE = {
  entry: 448,
  patch: 0,
  patches: [0],
  wowPatch: 10,
  row: {
    entry: 448, patch: 0, name: 'Hogger', subname: null,
    loot_id: 1120, pickpocket_loot_id: 0, skinning_loot_id: 0,
    faction: 14, npc_flags: 4, type: 7, pet_family: 0, rank: 1, unit_class: 1,
    level_min: 9, level_max: 10, vendor_id: 5, trainer_id: 0,
    ai_name: '', script_name: '', movement_type: 1, inhabit_type: 3
  },
  faction: { templateId: 14, factionId: 72, name: 'Monster' },
  spawns: {
    total: 1,
    rows: [{ guid: 12345, map: 0, x: -9448.0, y: 92.0, z: 57.0, column: 'id' }]
  },
  loot: [
    { item: 2586, chance: 50, groupId: 0, minCount: 1, maxCount: 1, conditionId: 0, viaReference: null }
  ],
  pickpocketLoot: [],
  skinningLoot: [],
  vendor: [
    { item: 159, maxCount: 20, incrTime: 3600, itemFlags: 0, conditionId: 0, source: 'template' }
  ],
  trainer: [],
  questsGiven: [176],
  questsEnded: [],
  names: {
    item: new Map([[2586, 'Wolf Meat'], [159, 'Refreshing Spring Water']]),
    quest: new Map([[176, 'Investigate Hogger']]),
    spell: new Map()
  },
  maps: new Map([[0, 'Eastern Kingdoms']])
};

test('loot is read from loot_id, not from the entry', async () => {
  // 21 templates on this realm have a loot_id that is not their entry, and
  // 9581 have none at all. This is the single most misleading join in the
  // world DB.
  const stub = dbStubPool({ creature_template: [TEMPLATE] });
  await loadCreature({ world: stub.pool }, CONFIG, 448);
  const [lootCall] = stub.callsFor('creature_loot_template');
  assert.equal(lootCall.params[0], 1120);
});

test('a creature that does not exist is null, so the route can 404', async () => {
  const stub = dbStubPool({});
  assert.equal(await loadCreature({ world: stub.pool }, CONFIG, 99999999), null);
});

test('a missing world pool is null too, not a crash', async () => {
  assert.equal(await loadCreature({}, CONFIG, 448), null);
});

test('vendor stock is read from both npc_vendor and npc_vendor_template', async () => {
  // vmangos-core/src/game/ObjectMgr.cpp:10911 reads both; reading only
  // npc_vendor shows an empty stock list for every template-driven vendor.
  const stub = dbStubPool({ creature_template: [TEMPLATE] });
  await loadCreature({ world: stub.pool }, CONFIG, 448);
  assert.equal(stub.callsFor('npc_vendor_template').length, 1);
  assert.ok(stub.calls.some((c) => c.sql.includes('npc_vendor') && !c.sql.includes('npc_vendor_template')));
});

test('the template vendor list is keyed on vendor_id, the per-creature one on the entry', async () => {
  const stub = dbStubPool({ creature_template: [TEMPLATE] });
  await loadCreature({ world: stub.pool }, CONFIG, 448);
  assert.equal(stub.callsFor('npc_vendor_template')[0].params[0], 5);
  const perCreature = stub.calls.find((c) => c.sql.includes('npc_vendor') && !c.sql.includes('npc_vendor_template'));
  assert.equal(perCreature.params[0], 448);
});

test('the page renders spawns as map and coordinates and claims no zone', () => {
  const html = renderCreaturePage(FIXTURE);
  assert.match(html, /Eastern Kingdoms/);
  assert.doesNotMatch(html, /zone/i);
});

test('movement type and inhabit type are rendered in the summary', () => {
  // Spec line 171: the creature summary must include movement and inhabit
  // type. FIXTURE.row carries movement_type: 1 (Random) and inhabit_type: 3
  // (Ground | Water).
  const html = renderCreaturePage(FIXTURE);
  assert.match(html, /<th>movement type<\/th><td>Random<\/td>/);
  assert.match(html, /<th>inhabit type<\/th><td>Ground, Water<\/td>/);
});

test('every related id is a link, including the faction', () => {
  const html = renderCreaturePage(FIXTURE);
  assert.match(html, /href="\/db\/item\/2586"/);
  assert.match(html, /href="\/db\/quest\/176"/);
  assert.match(html, /<th>faction<\/th><td><span class="tooltip-host"><a href="\/db\/faction\/72"\s+hx-get="\/db\/tooltip\/faction\/72"[^>]*>Monster<\/a><\/span><\/td>/);
});

// loadCreature returns faction: null when the template's faction_template id
// resolves to nothing (server/dbLookups/factions.js) - the page still names
// the raw faction_template id rather than a dead link.
test('an unresolved faction template falls back to plain text, not a link', () => {
  const html = renderCreaturePage({ ...FIXTURE, faction: null });
  assert.match(html, /<th>faction<\/th><td>faction template 14<\/td>/);
});

// A quest drop reads as its absolute chance, with the quest requirement named
// rather than smuggled into the number as a minus sign.
test('a quest drop shows a positive chance and says it needs the quest', () => {
  const html = renderCreaturePage({
    ...FIXTURE,
    loot: [{ item: 2586, chance: 100, needsQuest: true, groupId: 0, minCount: 1, maxCount: 1, conditionId: 0, viaReference: null }]
  });
  assert.doesNotMatch(html, /-100%/);
  assert.match(html, /100%/);
  assert.match(html, /quest drop/);
});

// The page lives on the browser's chrome now (server/sections/db.js), so it
// leads back to the NPC listview rather than the old search page, and every
// item it names carries the same hover tooltip the listviews do.
test('the page offers a way back to the NPC list, not the search page', () => {
  const html = renderCreaturePage(FIXTURE);
  assert.match(html, /<a href="\/db\/npcs">back to NPCs<\/a>/);
  assert.doesNotMatch(html, /back to search/);
});

test('item cross-links in loot and vendor tables carry the tooltip host', () => {
  const html = renderCreaturePage(FIXTURE);
  assert.match(html, /<span class="tooltip-host"><a href="\/db\/item\/2586"\s+hx-get="\/db\/tooltip\/item\/2586"/);
  assert.match(html, /hx-get="\/db\/tooltip\/item\/159"/);
});

// The loot read carries no quality, so the link claims none: q1 would colour
// an epic drop as Common (whole-branch review, 2026-09-23).
test('a loot link whose quality is unknown carries no quality class', () => {
  assert.doesNotMatch(renderCreaturePage(FIXTURE), /class="q\d"/);
});

test('an item whose name is unknown still links with its id as the label', () => {
  const html = renderCreaturePage({ ...FIXTURE, names: { ...FIXTURE.names, item: new Map() } });
  assert.match(html, /hx-get="\/db\/tooltip\/item\/2586"[^>]*>#2586<\/a>/);
});

test('loot and vendor links carry the item quality the loader read', () => {
  const html = renderCreaturePage({
    ...FIXTURE,
    names: { ...FIXTURE.names, itemQuality: new Map([[2586, 4], [159, 1]]) }
  });
  assert.match(html, /<a class="q4" href="\/db\/item\/2586"/);
  assert.match(html, /<a class="q1" href="\/db\/item\/159"/);
});

test('quests the creature gives carry their hover card', () => {
  const html = renderCreaturePage(FIXTURE);
  assert.match(html, /href="\/db\/quest\/176"\s+hx-get="\/db\/tooltip\/quest\/176"/);
});

test('trainer spells link to the spell page with its hover card', () => {
  const html = renderCreaturePage({ ...FIXTURE, trainer: [{ spell: 133, taughtSpell: 133, spellCost: 10, reqLevel: 1, source: 'creature' }], names: { ...FIXTURE.names, spell: new Map([[133, 'Fireball']]) } });
  assert.match(html, /href="\/db\/spell\/133"\s+hx-get="\/db\/tooltip\/spell\/133"/);
});

// vmangos-core/src/game/ObjectMgr.cpp:10721-10735: a trainer row's own
// `spell` often names a teaching spell (effect1 36), not the spell it
// grants - the link must follow effectTriggerSpell1 (loadCreature's
// resolveTaughtSpellIds), never the row's own spell column.
test('a trainer row naming a teaching spell links the taught spell, not the teaching spell', async () => {
  const stub = dbStubPool({
    creature_template: [TEMPLATE],
    spell_template: [{ entry: 1173, effect1: 36, effectTriggerSpell1: 143 }],
    npc_trainer: [{ entry: 448, spell: 1173, spellcost: 10, reqskill: 0, reqskillvalue: 0, reqlevel: 1 }]
  });
  const data = await loadCreature({ world: stub.pool }, CONFIG, 448);
  assert.equal(data.trainer.length, 1);
  assert.equal(data.trainer[0].spell, 1173);
  assert.equal(data.trainer[0].taughtSpell, 143);
  const html = renderCreaturePage({ ...data, wowPatch: 10 });
  assert.match(html, /href="\/db\/spell\/143"/);
  assert.doesNotMatch(html, /href="\/db\/spell\/1173"/);
});
