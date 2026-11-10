import test from 'node:test';
import assert from 'node:assert/strict';
import { dbApp, HEADERS } from './helpers/dbApp.js';
import { dbStubPool } from './helpers/dbStubPool.js';

// Route harness: see test/helpers/dbApp.js.
function appWith({ worldRows = [] } = {}) {
  return dbApp({ world: { query: async () => [worldRows] } }).app;
}

// The ENTITY_LOADERS dispatch (server/sections/db.js) maps a path type to a
// loader and a renderer; nothing before this drove it over HTTP, so a typo in
// either the Map or the route wiring would only ever surface as a live bug.
// One stub pool per entity type, matched by table name the same way
// helpers/dbStubPool.js is used in the unit tests for each entity page.
function appWithWorld(tables) {
  return dbApp({ world: dbStubPool(tables).pool }).app;
}

test('GET /db/search?q= returns an empty fragment, not an error', async () => {
  const app = appWithWorld({});
  const res = await app.inject({ method: 'GET', url: '/db/search?q=', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.trim(), '');
});

test('GET /db/search?q=<id> dispatches to the numeric search path and links the match', async () => {
  const app = appWithWorld({ creature_template: [{ id: 448, name: 'Hogger' }] });
  const res = await app.inject({ method: 'GET', url: '/db/search?q=448', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /href="\/db\/creature\/448"/);
});

// dbApp's soap stub counts execute() calls: the browser chrome has no status
// strip, so a page rendered on it must never reach readStatus and so never
// soap.execute.
function countingApp(tables) {
  return dbApp({ world: dbStubPool(tables).pool });
}

const CREATURE_ROW = {
  entry: 448, patch: 0, name: 'Hogger', subname: null,
  loot_id: 0, pickpocket_loot_id: 0, skinning_loot_id: 0,
  faction: 0, npc_flags: 0, type: 7, pet_family: 0, rank: 0, unit_class: 1,
  level_min: 9, level_max: 10, vendor_id: 0, trainer_id: 0,
  ai_name: '', script_name: '', movement_type: 0, inhabit_type: 3
};

function questRow() {
  const row = { entry: 176, patch: 0, Title: 'Investigate Hogger', Details: '', Objectives: '', OfferRewardText: '', RequestItemsText: '', EndText: '', RequiredRaces: 0, RequiredClasses: 0, QuestLevel: 10, MinLevel: 5, MaxLevel: 0, ZoneOrSort: 12, Type: 0, RewXP: 0, RewOrReqMoney: 0, RewSpell: 0, PrevQuestId: 0, NextQuestId: 0, NextQuestInChain: 0, ExclusiveGroup: 0, BreadcrumbForQuestId: 0, SrcItemId: 0 };
  for (let i = 1; i <= 4; i++) {
    row[`ReqItemId${i}`] = 0; row[`ReqItemCount${i}`] = 0;
    row[`ReqSourceId${i}`] = 0; row[`ReqSourceCount${i}`] = 0;
    row[`ReqCreatureOrGOId${i}`] = 0; row[`ReqCreatureOrGOCount${i}`] = 0;
    row[`ReqSpellCast${i}`] = 0;
    row[`RewItemId${i}`] = 0; row[`RewItemCount${i}`] = 0;
  }
  for (let i = 1; i <= 6; i++) { row[`RewChoiceItemId${i}`] = 0; row[`RewChoiceItemCount${i}`] = 0; }
  for (let i = 1; i <= 5; i++) { row[`RewRepFaction${i}`] = 0; row[`RewRepValue${i}`] = 0; }
  return row;
}

function gameObjectRow() {
  const row = { entry: 32, patch: 0, name: 'Sunken Chest', type: 3, displayId: 259, faction: 0, flags: 0, size: 1, script_name: '' };
  for (let i = 0; i <= 23; i++) row[`data${i}`] = 0;
  return row;
}

test('GET /db/creature/:id dispatches to loadCreature and renderCreaturePage', async () => {
  const app = appWithWorld({ creature_template: [CREATURE_ROW] });
  const res = await app.inject({ method: 'GET', url: '/db/creature/448', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Hogger/);
});

test('GET /db/item/:id dispatches to loadItem and renderItemPage', async () => {
  const app = appWithWorld({
    item_template: [{
      entry: 2586, patch: 0, name: 'Trousers of Hogger', class: 4, subclass: 1,
      quality: 2, item_level: 10, required_level: 5, inventory_type: 7, bonding: 1,
      start_quest: 0
    }]
  });
  const res = await app.inject({ method: 'GET', url: '/db/item/2586', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Trousers of Hogger/);
});

test('GET /db/quest/:id dispatches to loadQuest and renderQuestPage', async () => {
  const app = appWithWorld({ quest_template: [questRow()] });
  const res = await app.inject({ method: 'GET', url: '/db/quest/176', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Investigate Hogger/);
});

test('GET /db/gameobject/:id dispatches to loadGameObject and renderGameObjectPage', async () => {
  const app = appWithWorld({ gameobject_template: [gameObjectRow()] });
  const res = await app.inject({ method: 'GET', url: '/db/gameobject/32', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Sunken Chest/);
});

test('GET /db/creature/:id renders on the browser chrome and makes no SOAP call', async () => {
  const { app, executeCalls } = countingApp({ creature_template: [CREATURE_ROW] });
  const res = await app.inject({ method: 'GET', url: '/db/creature/448', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /class="db-browser"/);
  assert.doesNotMatch(res.body, /id="status"/);
  assert.match(res.body, /<title>[^<]*NPC 448/);
  assert.equal(executeCalls(), 0);
});

test('GET /db/gameobject/:id renders on the browser chrome and makes no SOAP call', async () => {
  const { app, executeCalls } = countingApp({ gameobject_template: [gameObjectRow()] });
  const res = await app.inject({ method: 'GET', url: '/db/gameobject/32', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /class="db-browser"/);
  assert.doesNotMatch(res.body, /id="status"/);
  assert.match(res.body, /<title>[^<]*Object 32/);
  assert.equal(executeCalls(), 0);
});

// Quest was the last /db page on the operator layout; since cycle 5a it is on
// the browser chrome like the other three, and sends nothing to mangosd.
test('the quest page renders on the browser chrome and makes no SOAP call', async () => {
  const { app, executeCalls } = countingApp({ quest_template: [questRow()] });
  const res = await app.inject({ method: 'GET', url: '/db/quest/176', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /class="db-browser"/);
  assert.doesNotMatch(res.body, /id="status"/);
  assert.match(res.body, /<title>[^<]*Quest 176/);
  assert.equal(executeCalls(), 0);
});

test('its 404 is on the browser chrome and leads back to quests', async () => {
  const { app, executeCalls } = countingApp({});
  const res = await app.inject({ method: 'GET', url: '/db/quest/99999999', headers: HEADERS });
  assert.equal(res.statusCode, 404);
  assert.match(res.body, /class="db-browser"/);
  assert.match(res.body, /href="\/db\/quests">back to quests/);
  assert.equal(executeCalls(), 0);
});

// Was an operator-layout 404 until the creature page moved onto the browser
// chrome. It still names the type and id; it now also carries the browser's
// chrome, leads back to the NPC list, and issues no SOAP call.
test('GET /db/creature/:id for an id that does not exist is a 404 on the browser chrome naming the type and id', async () => {
  const { app, executeCalls } = countingApp({});
  const res = await app.inject({ method: 'GET', url: '/db/creature/99999999', headers: HEADERS });
  assert.equal(res.statusCode, 404);
  assert.match(res.body, /creature/);
  assert.match(res.body, /99999999/);
  assert.match(res.body, /class="db-browser"/);
  assert.match(res.body, /href="\/db\/npcs">back to NPCs/);
  assert.equal(executeCalls(), 0);
});

test('GET /db/gameobject/:id for an id that does not exist is a 404 on the browser chrome', async () => {
  const { app, executeCalls } = countingApp({});
  const res = await app.inject({ method: 'GET', url: '/db/gameobject/99999999', headers: HEADERS });
  assert.equal(res.statusCode, 404);
  assert.match(res.body, /gameobject/);
  assert.match(res.body, /99999999/);
  assert.match(res.body, /class="db-browser"/);
  assert.match(res.body, /href="\/db\/objects">back to objects/);
  assert.equal(executeCalls(), 0);
});

// The browser branch (server/sections/db.js) renders through
// renderBrowserPage, not renderPage, and deliberately skips readStatus - every
// /db entity page goes through it now - so this 404 both carries the
// browser's own chrome (not the operator panel's) and never issues the SOAP
// call the panel layout's status strip needs.
test('GET /db/item/:id for an id that does not exist is a 404 on the browser chrome, with no SOAP call', async () => {
  const { app, executeCalls } = dbApp({ world: dbStubPool({}).pool });

  const res = await app.inject({ method: 'GET', url: '/db/item/99999999', headers: HEADERS });
  assert.equal(res.statusCode, 404);
  assert.match(res.body, /item/);
  assert.match(res.body, /99999999/);
  assert.match(res.body, /class="db-browser"/);
  assert.match(res.body, /wow-ops db/);
  assert.equal(executeCalls(), 0, 'the browser layout has no status strip, so readStatus/soap.execute must never run');
});

test('a non-integer-looking id like 1e3 is a 400, not silently coerced to 1000', async () => {
  const res = await appWith().inject({ method: 'GET', url: '/db/creature/1e3', headers: HEADERS });
  assert.equal(res.statusCode, 400);
});

test('a negative id is a 400', async () => {
  const res = await appWith().inject({ method: 'GET', url: '/db/creature/-5', headers: HEADERS });
  assert.equal(res.statusCode, 400);
});

test('the search page renders with an empty box', async () => {
  const res = await appWith().inject({ method: 'GET', url: '/db', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /name="q"/);
});

test('an unknown entity type is a 400, not a 500', async () => {
  const res = await appWith().inject({ method: 'GET', url: '/db/banana/1', headers: HEADERS });
  assert.equal(res.statusCode, 400);
});

test('a non-numeric id is a 400', async () => {
  const res = await appWith().inject({ method: 'GET', url: '/db/creature/abc', headers: HEADERS });
  assert.equal(res.statusCode, 400);
});

test('the nav carries the Database entry', async () => {
  const res = await appWith().inject({ method: 'GET', url: '/db', headers: HEADERS });
  assert.match(res.body, /href="\/db"/);
});

// htmx resolves hx-target before it issues the request. The search form
// carries hx-target="#db-results", so that element must already be in the
// freshly loaded page's HTML - not only in the /db/search fragment - or every
// submit aborts with a targetError and the form is inert. curl driving the
// routes would never catch this, because curl never runs htmx.
test('the freshly loaded page already carries the #db-results target', async () => {
  const res = await appWith().inject({ method: 'GET', url: '/db', headers: HEADERS });
  assert.match(res.body, /id="db-results"/);
  assert.match(res.body, /hx-target="#db-results"/);
});

// The search box was reachable only from /db itself, so leaving that page
// meant going home first to search again - on a reference browser the
// most-used control there is (final review, 2026-09-22). The shell now
// carries a plain GET form to /db on every browser page, not just the ones
// that render #db-results.
test('a header search form is present on /db/items and on an item page', async () => {
  const app = appWithWorld({
    item_template: [{
      entry: 2586, patch: 0, name: 'Trousers of Hogger', class: 4, subclass: 1,
      quality: 2, item_level: 10, required_level: 5, inventory_type: 7, bonding: 1,
      start_quest: 0
    }]
  });

  const itemsRes = await app.inject({ method: 'GET', url: '/db/items', headers: HEADERS });
  assert.match(itemsRes.body, /<form[^>]*method="get"[^>]*action="\/db"[^>]*>[\s\S]*?name="q"/);

  const itemRes = await app.inject({ method: 'GET', url: '/db/item/2586', headers: HEADERS });
  assert.match(itemRes.body, /<form[^>]*method="get"[^>]*action="\/db"[^>]*>[\s\S]*?name="q"/);
});

// The header form is a plain GET to /db with no hx- attributes: it must work
// from a page that never rendered #db-results, so it cannot depend on htmx
// swapping into an id that page never had.
//
// A text query runs searchText (server/queries/db/search.js), a COUNT then a
// SELECT per entity type - dbStubPool always answers a table's queries with
// the same rows array, which breaks COUNT(*)'s "always exactly one row"
// shape for the three types this test does not care about, so this pool is
// scripted by hand instead, the same way test/db-search.test.js's own
// countingPool is.
test('GET /db?q=hogger renders the match in the page without htmx', async () => {
  const pool = {
    query: async (sql) => {
      if (!sql.includes('creature_template')) return [sql.includes('COUNT(*)') ? [{ n: 0 }] : []];
      return [sql.includes('COUNT(*)') ? [{ n: 1 }] : [{ id: 448, name: 'Hogger' }]];
    }
  };
  const { app } = dbApp({ world: pool });

  const res = await app.inject({ method: 'GET', url: '/db?q=hogger', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /href="\/db\/creature\/448"/);
});

// dbStubPool matches a query by table name alone, not by its bound params
// (helpers/dbStubPool.js) - so a populated spell_template stub answers a
// lookup for ANY entry, never a genuine miss. Every other entity's 404 test
// in this file (GET /db/creature, /db/gameobject, /db/item above) reads that
// case from a second, empty countingApp instead of reusing the populated
// one; this follows the same pattern rather than asserting a 404 the stub
// itself makes unreachable.
test('GET /db/spell/:id renders on the browser chrome with no SOAP call, and its 404 leads back to spells', async () => {
  const { app, executeCalls } = countingApp({ spell_template: [{ entry: 133, build: 5875, name: 'Fireball', nameSubtext: 'Rank 1', description: '' }] });
  const ok = await app.inject({ method: 'GET', url: '/db/spell/133', headers: HEADERS });
  assert.equal(ok.statusCode, 200);
  assert.match(ok.body, /class="db-browser"/);
  assert.match(ok.body, /class="nav-item active" href="\/db\/spells"/);
  assert.equal(executeCalls(), 0);

  const { app: missingApp, executeCalls: missingCalls } = countingApp({});
  const missing = await missingApp.inject({ method: 'GET', url: '/db/spell/999999', headers: HEADERS });
  assert.equal(missing.statusCode, 404);
  assert.match(missing.body, /back to spells/);
  assert.equal(missingCalls(), 0);
});
