import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCreatureTooltip } from '../server/views/db/creatureTooltip.js';
import { dbApp, HEADERS } from './helpers/dbApp.js';
import { dbStubPool } from './helpers/dbStubPool.js';

// Hogger, the same fixture test/db-creature.test.js starts from - a real row
// shape (faction 14, type 7 Humanoid, rank 1 Elite) rather than an invented
// one.
const ROW = {
  entry: 448, name: 'Hogger', subname: null,
  faction: 14, type: 7, rank: 1, level_min: 9, level_max: 10
};

test('the tooltip names the creature, its level range, rank, type and faction', () => {
  const html = renderCreatureTooltip(ROW);
  assert.match(html, /Hogger/);
  assert.match(html, /9-10/);
  assert.match(html, /Elite/);
  assert.match(html, /Humanoid/);
  assert.match(html, /14/);
});

test('a creature with a subname shows it under the name', () => {
  const html = renderCreatureTooltip({ ...ROW, subname: 'Riverpaw Outcast' });
  assert.match(html, /Riverpaw Outcast/);
});

test('a level_min equal to level_max shows one number, not a range', () => {
  const html = renderCreatureTooltip({ ...ROW, level_min: 30, level_max: 30 });
  assert.match(html, />Level 30</);
  assert.doesNotMatch(html, /30-30/);
});

test('nothing in the card invents wording the columns do not carry', () => {
  const html = renderCreatureTooltip(ROW);
  assert.doesNotMatch(html, /Requires/i);
  assert.doesNotMatch(html, /[Ll]oot/);
  assert.doesNotMatch(html, /[Vv]endor/);
  assert.doesNotMatch(html, /[Tt]rainer/);
});

// Route harness: see test/helpers/dbApp.js.
function harness(tables) {
  const stub = dbStubPool(tables);
  return { app: dbApp({ world: stub.pool }).app, stub };
}

test('the tooltip route answers with a bare fragment', async (t) => {
  const { app } = harness({ creature_template: [ROW] });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/tooltip/creature/448', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /<!doctype html>/i);
  assert.match(res.body, /class="tooltip"/);
});

test('an unknown id is a 404 fragment, not the browser chrome', async (t) => {
  const { app } = harness({ creature_template: [] });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/tooltip/creature/999999', headers: HEADERS });
  assert.equal(res.statusCode, 404);
  assert.doesNotMatch(res.body, /<!doctype html>/i);
});

test('a non-numeric id is refused before any query runs', async (t) => {
  const { app, stub } = harness({ creature_template: [ROW] });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/tooltip/creature/1e3', headers: HEADERS });
  assert.equal(res.statusCode, 400);
  assert.equal(stub.calls.length, 0);
});

// The defect cycle 3 shipped and had to fix: a hover that runs the full page
// loader (loadCreature, server/queries/db/creature.js) fans out over loot,
// vendor, trainer and quest tables - ~1000 queries across a 50-row listview
// against a pool with a connectionLimit of 4 (server/db.js). This pins the
// cost, not just the rendered output, so a future change that reintroduces
// that loader fails here even if the fragment still looks right.
test('the tooltip route issues at most two queries and touches no loot, vendor, trainer or quest table', async (t) => {
  const { app, stub } = harness({ creature_template: [ROW] });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/tooltip/creature/448', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.ok(stub.calls.length <= 2, `expected at most 2 queries, got ${stub.calls.length}`);
  for (const call of stub.calls) {
    assert.doesNotMatch(call.sql, /loot_template|npc_vendor|quest_template|npc_trainer/);
  }
});
