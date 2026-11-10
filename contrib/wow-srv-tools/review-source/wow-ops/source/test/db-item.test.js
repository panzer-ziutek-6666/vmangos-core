import test from 'node:test';
import assert from 'node:assert/strict';
import { dbStubPool } from './helpers/dbStubPool.js';
import { loadItem } from '../server/queries/db/item.js';
import { renderItemPage } from '../server/views/db/item.js';

const CONFIG = {
  mysql: { world: { database: 'mangos' } },
  realm: { id: 1, wowPatch: 10, clientBuild: 5875 }
};

const ITEM = {
  entry: 2586, patch: 0, name: "Hogger's Trousers", class: 4, subclass: 1,
  quality: 2, item_level: 10, required_level: 5, inventory_type: 7, bonding: 1,
  start_quest: 0, display_id: 1234
};

// The keys are matched against the SQL in order, so the more specific table
// name has to come first wherever one name contains another.
function itemStub() {
  return dbStubPool({
    item_template: [ITEM],
    reference_loot_template: [{ entry: 34567 }],
    creature_loot_template: [{ entry: 1120 }],
    creature_template: [{ entry: 448, patch: 0, name: 'Hogger', loot_id: 1120 }]
  });
}

// A complete loadItem return value, written out literally - this is the
// interface contract renderItemPage is held to. `wowPatch` is not part of
// loadItem's own return shape (server/sections/db.js attaches it before
// rendering, the Task 9 convention); it is included here because this
// fixture is renderItemPage's actual input.
const FIXTURE = {
  entry: 2586,
  patch: 0,
  patches: [0],
  wowPatch: 10,
  row: ITEM,
  droppedBy: [{ entry: 448, name: 'Hogger', viaReference: null }],
  containedIn: [],
  objectLoot: [],
  gatheredFrom: { skinning: [], pickpocketing: [], fishing: [] },
  soldBy: [],
  questsRequiring: [],
  questsRewarding: [],
  names: {
    creature: new Map([[448, 'Hogger']]),
    item: new Map(),
    gameobject: new Map(),
    area: new Map(),
    quest: new Map(),
    spell: new Map()
  }
};

test('drop sources come from creature loot and from reference loot', async () => {
  const stub = itemStub();
  await loadItem({ world: stub.pool }, CONFIG, 2586);
  assert.ok(stub.callsFor('creature_loot_template').length > 0);
  assert.ok(stub.callsFor('reference_loot_template').length > 0);
});

test('a creature that drops the item is named, not just numbered', async () => {
  const stub = itemStub();
  const data = await loadItem({ world: stub.pool }, CONFIG, 2586);
  assert.equal(data.names.creature.get(448), 'Hogger');
});

test('a drop source is mapped back to its creature by loot_id, not by entry', async () => {
  // The mirror of the creature page's join, and wrong the same way: loot entry
  // 1120 is not creature entry 1120 for the 21 templates whose loot_id differs.
  const stub = itemStub();
  await loadItem({ world: stub.pool }, CONFIG, 2586);
  assert.ok(stub.callsFor('creature_template').some((c) => c.sql.includes('loot_id')));
});

test('vendors are read from both vendor tables', async () => {
  const stub = itemStub();
  await loadItem({ world: stub.pool }, CONFIG, 2586);
  assert.ok(stub.callsFor('npc_vendor_template').length > 0);
  assert.ok(stub.calls.some((c) => c.sql.includes('npc_vendor') && !c.sql.includes('npc_vendor_template')));
});

test('quests that require or reward the item are found across both column families', async () => {
  const stub = itemStub();
  await loadItem({ world: stub.pool }, CONFIG, 2586);
  const call = stub.callsFor('quest_template').find((c) => c.sql.includes('ReqItemId1'));
  assert.match(call.sql, /RewChoiceItemId6/);
});

test('an item that does not exist is null, so the route can 404', async () => {
  const stub = dbStubPool({});
  assert.equal(await loadItem({ world: stub.pool }, CONFIG, 99999999), null);
});

test('the page links every source', () => {
  const html = renderItemPage(FIXTURE);
  assert.match(html, /href="\/db\/creature\/448"/);
});

test('a plain item with no stats, damage, resistances or spells renders none of them as blank rows', () => {
  // Spec line 185 requires these in the decoded summary, but a slot at its
  // zero default must not print as "Mana: 0" ten times over.
  const html = renderItemPage(FIXTURE);
  assert.match(html, /No stats\./);
  assert.match(html, /No damage\./);
  assert.match(html, /No resistances\./);
  assert.match(html, /No spells\./);
});

test('a nonzero stat, damage roll, resistance and spell slot are each decoded and shown', () => {
  const row = {
    ...ITEM,
    stat_type1: 4, stat_value1: 15,
    dmg_min1: 3, dmg_max1: 9, dmg_type1: 2,
    fire_res: 10,
    spellid_1: 21987, spelltrigger_1: 1
  };
  const html = renderItemPage({ ...FIXTURE, row });
  assert.match(html, /Strength: 15/);
  assert.match(html, /3–9 Fire/);
  assert.match(html, /Fire: 10/);
  assert.match(html, /href="\/db\/spell\/21987"\s+hx-get="\/db\/tooltip\/spell\/21987"[^>]*>#21987<\/a>.*On equip/);
});

test('an item that drops only through a reference says so on the row', () => {
  const html = renderItemPage({ ...FIXTURE, droppedBy: [{ entry: 2000, name: 'Defias Thug', viaReference: 34567 }] });
  assert.match(html, /reference 34567/);
});

test('a fishing source is resolved through fishing_loot_template and area_template', async () => {
  const stub = dbStubPool({
    item_template: [ITEM],
    fishing_loot_template: [{ entry: 12 }],
    area_template: [{ entry: 12, name: 'Elwynn Forest' }]
  });
  const data = await loadItem({ world: stub.pool }, CONFIG, 2586);
  assert.ok(stub.callsFor('fishing_loot_template').length > 0);
  assert.ok(stub.callsFor('area_template').length > 0);
  assert.equal(data.gatheredFrom.fishing[0].name, 'Elwynn Forest');
});

test('a fishing source prints the area name beside the id, not the bare id alone', () => {
  const html = renderItemPage({
    ...FIXTURE,
    gatheredFrom: { skinning: [], pickpocketing: [], fishing: [{ entry: 12, name: 'Elwynn Forest', viaReference: null }] }
  });
  assert.match(html, /Elwynn Forest \(area #12\)/);
});

test('inventoryIcon and setName are read from the reference schema, schema-qualified', async () => {
  const stub = dbStubPool({
    item_template: [{ ...ITEM, display_id: 1234, set_id: 181 }],
    item_display_info: [{ inventory_icon: 'INV_Sword_39' }],
    item_set: [{ name: 'Might' }]
  });
  const config = { ...CONFIG, mysql: { ...CONFIG.mysql, dbcSchema: 'dbc' } };
  const data = await loadItem({ world: stub.pool }, config, 2586);
  assert.equal(data.inventoryIcon, 'INV_Sword_39');
  assert.equal(data.setName, 'Might');
  const iconCall = stub.callsFor('item_display_info')[0];
  assert.match(iconCall.sql, /`dbc`\.`item_display_info`/);
  const setCall = stub.callsFor('item_set')[0];
  assert.match(setCall.sql, /`dbc`\.`item_set`/);
});

test('without a configured reference schema, inventoryIcon and setName are both null', async () => {
  const stub = itemStub();
  const data = await loadItem({ world: stub.pool }, CONFIG, 2586);
  assert.equal(data.inventoryIcon, null);
  assert.equal(data.setName, null);
});

// A configured dbcSchema is not proof the importer ever finished -
// tools/import-dbc.js documents that a failed run leaves a partial schema.
// The reference reads must fall back to the same nulls the unconfigured path
// returns, not surface the driver's raw error as a 500.
test('a missing or half-imported reference schema falls back to null icon and set name, not an error', async () => {
  const pool = {
    query: async (sql, params) => {
      if (sql.includes('item_display_info') || sql.includes('item_set')) {
        const err = new Error("ER_NO_SUCH_TABLE: Table 'dbc.item_display_info' doesn't exist");
        err.code = 'ER_NO_SUCH_TABLE';
        throw err;
      }
      if (sql.includes('item_template')) return [[{ ...ITEM, display_id: 1234, set_id: 181 }]];
      return [[]];
    }
  };
  const config = { ...CONFIG, mysql: { ...CONFIG.mysql, dbcSchema: 'dbc' } };
  const data = await loadItem({ world: pool }, config, 2586);
  assert.equal(data.inventoryIcon, null);
  assert.equal(data.setName, null);
});

test('a gameobject drop is read from gameobject_loot_template and mapped back through the chest/fishinghole type filter', async () => {
  // gameobject_loot_template's entry is not a gameobject_template entry
  // either (server/queries/db/item.js, fetchOwningGameobjects) - only
  // GAMEOBJECT_TYPE_CHEST (3) and GAMEOBJECT_TYPE_FISHINGHOLE (25) ever carry
  // a loot table, both through their template's data1 column.
  const stub = dbStubPool({
    item_template: [ITEM],
    gameobject_loot_template: [{ entry: 1683 }],
    gameobject_template: [{ entry: 32, patch: 0, name: 'Chest', type: 3, data1: 1683 }]
  });
  const data = await loadItem({ world: stub.pool }, CONFIG, 2586);
  assert.ok(stub.callsFor('gameobject_loot_template').length > 0);
  const gtCall = stub.callsFor('gameobject_template').find((c) => c.sql.includes('data1'));
  assert.ok(gtCall, 'the reverse join reads data1, not entry');
  assert.match(gtCall.sql, /type IN \(3, 25\)/);
  assert.equal(data.objectLoot[0].entry, 32);
  assert.equal(data.objectLoot[0].name, 'Chest');
});

test('the item page shows its icon and its name in the quality colour', () => {
  const html = renderItemPage({ ...FIXTURE, inventoryIcon: 'INV_Sword_39' });
  assert.match(html, /\/db\/art\/icons\/INV_Sword_39\.png/);
  assert.match(html, /class="q\d"/);
});

test('an item in a set links to the set page', () => {
  const html = renderItemPage({ ...FIXTURE, row: { ...FIXTURE.row, set_id: 181 }, setName: 'Might' });
  assert.match(html, /href="\/db\/itemset\/181"/);
  assert.match(html, /Might/);
});

test('an item in no set renders no set link', () => {
  const html = renderItemPage({ ...FIXTURE, row: { ...FIXTURE.row, set_id: 0 } });
  assert.doesNotMatch(html, /\/db\/itemset\//);
});

test('spell slots are listed as ids and triggers, with no invented wording', () => {
  const html = renderItemPage({
    ...FIXTURE,
    row: { ...FIXTURE.row, spellid_1: 21179, spelltrigger_1: 1 }
  });
  assert.match(html, /21179/);
  assert.match(html, /On equip/i);
  assert.doesNotMatch(html, /Equip: /);
});

test('the reverse sources the old page carried are still rendered', () => {
  const html = renderItemPage(FIXTURE);
  assert.match(html, /Dropped by/);
});

// The item page's own cross-links used to be plain dbLinks, so the tooltip
// README claims for "an item page's own cross-links" never actually fired
// there (final review, 2026-09-22). Only "Contained in" is an item-kind
// cross-link on this page - creatures, gameobjects and quests are linked
// through dbLink still, since they have no item tooltip to fetch.
test('an item contained in another item is a tooltip-wired link, not a bare dbLink', () => {
  const html = renderItemPage({
    ...FIXTURE,
    containedIn: [{ entry: 5555, name: 'A Sturdy Chest', viaReference: null }]
  });
  const hostMatch = html.match(/<span class="tooltip-host">(<a\b[^>]*>)/);
  assert.ok(hostMatch, 'the contained-in link should be inside a span.tooltip-host');
  assert.match(hostMatch[1], /hx-get="\/db\/tooltip\/item\/5555"/);
});

// dbStubPool matches the first key whose name appears in the SQL, so
// item_loot_template (the container lookup) must come before item_template.
// The page's own row comes first in item_template, since fetchTemplateRow
// reads the first row it is given.
test('a "contained in" source carries the container item\'s quality', async () => {
  const stub = dbStubPool({
    item_loot_template: [{ entry: 5555 }],
    reference_loot_template: [],
    item_template: [ITEM, { entry: 5555, patch: 0, name: 'A Sturdy Chest', quality: 3 }]
  });
  const data = await loadItem({ world: stub.pool }, CONFIG, 2586);
  assert.equal(data.containedIn[0].entry, 5555);
  assert.equal(data.containedIn[0].quality, 3);
});

test('a "contained in" link is coloured by the container\'s quality', () => {
  const html = renderItemPage({ ...FIXTURE, containedIn: [{ entry: 5555, name: 'A Sturdy Chest', quality: 3, viaReference: null }] });
  assert.match(html, /<a class="q3" href="\/db\/item\/5555"/);
});

test('item spell slots link to the spell page with its hover card', () => {
  const html = renderItemPage({ ...FIXTURE, row: { ...FIXTURE.row, spellid_1: 133, spelltrigger_1: 0 }, names: { ...FIXTURE.names, spell: new Map([[133, 'Fireball']]) } });
  assert.match(html, /href="\/db\/spell\/133"\s+hx-get="\/db\/tooltip\/spell\/133"[^>]*>Fireball</);
});
