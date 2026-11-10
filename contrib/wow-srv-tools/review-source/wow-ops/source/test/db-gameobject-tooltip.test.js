import test from 'node:test';
import assert from 'node:assert/strict';
import { renderGameObjectTooltip } from '../server/views/db/gameobjectTooltip.js';
import { dbApp, HEADERS } from './helpers/dbApp.js';
import { dbStubPool } from './helpers/dbStubPool.js';

// A real row shape, the same fixture test/db-gameobject.test.js starts from
// (entry 1731 is that test's Sunken Chest, type 3, lock id 11 at data0, loot
// id 4700 at data1).
const ROW = { entry: 1731, name: 'Sunken Chest', type: 3, faction: 35, data0: 11, data1: 4700 };

test('the tooltip names the gameobject and its type', () => {
  const html = renderGameObjectTooltip(ROW);
  assert.match(html, /Sunken Chest/);
  assert.match(html, /Chest/);
  assert.match(html, /35/);
});

test('a locked gameobject shows the lock id', () => {
  const html = renderGameObjectTooltip(ROW);
  assert.match(html, /Locked/);
  assert.match(html, /11/);
});

test('an unlocked gameobject (data0 zero) shows no locked line', () => {
  const html = renderGameObjectTooltip({ ...ROW, data0: 0 });
  assert.doesNotMatch(html, /Locked/i);
});

// The lock id sits in a different slot per type (GameObjectInfo::GetLockId,
// GameObjectDefines.h:559-581): data1 for a door, and nowhere at all for a
// spell focus, whose data0 is its focus id.
test('a door reads its lock from data1, a spell focus has none', () => {
  assert.match(renderGameObjectTooltip({ ...ROW, type: 0, data0: 0, data1: 99 }), /Locked \(id 99\)/);
  assert.doesNotMatch(renderGameObjectTooltip({ ...ROW, type: 8, data0: 4, data1: 10 }), /Locked/);
});

test('nothing in the card invents wording the columns do not carry', () => {
  const html = renderGameObjectTooltip(ROW);
  assert.doesNotMatch(html, /Requires/i);
  assert.doesNotMatch(html, /[Ll]oot/);
  assert.doesNotMatch(html, /[Qq]uest/);
  assert.doesNotMatch(html, /[Vv]endor/);
  assert.doesNotMatch(html, /[Tt]rainer/);
});

// Route harness: see test/helpers/dbApp.js.
function harness(tables) {
  const stub = dbStubPool(tables);
  return { app: dbApp({ world: stub.pool }).app, stub };
}

test('the tooltip route answers with a bare fragment', async (t) => {
  const { app } = harness({ gameobject_template: [ROW] });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/tooltip/gameobject/1731', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /<!doctype html>/i);
  assert.match(res.body, /class="tooltip"/);
});

test('an unknown id is a 404 fragment, not the browser chrome', async (t) => {
  const { app } = harness({ gameobject_template: [] });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/tooltip/gameobject/999999', headers: HEADERS });
  assert.equal(res.statusCode, 404);
  assert.doesNotMatch(res.body, /<!doctype html>/i);
});

test('a non-numeric id is refused before any query runs', async (t) => {
  const { app, stub } = harness({ gameobject_template: [ROW] });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/tooltip/gameobject/1e3', headers: HEADERS });
  assert.equal(res.statusCode, 400);
  assert.equal(stub.calls.length, 0);
});

// loadGameObject (server/queries/db/gameobject.js) fans out over
// gameobject_loot_template, gameobject_questrelation and
// gameobject_involvedrelation to build the whole entity page; the tooltip
// route must never call it, the same defect the creature tooltip
// (test/db-creature-tooltip.test.js) was built to avoid. This pins the cost,
// not just the rendered output.
test('the tooltip route issues at most two queries and touches no loot or quest-relation table', async (t) => {
  const { app, stub } = harness({ gameobject_template: [ROW] });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/tooltip/gameobject/1731', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.ok(stub.calls.length <= 2, `expected at most 2 queries, got ${stub.calls.length}`);
  for (const call of stub.calls) {
    assert.doesNotMatch(call.sql, /gameobject_loot_template|gameobject_questrelation|gameobject_involvedrelation|quest_template|npc_vendor|npc_trainer/);
  }
});
