import test from 'node:test';
import assert from 'node:assert/strict';
import { dbApp, HEADERS } from './helpers/dbApp.js';
import { dbStubPool } from './helpers/dbStubPool.js';

const ROW = { entry: 176, Title: 'Wanted: Hogger', QuestLevel: 11, MinLevel: 5, RequiredRaces: 0, ZoneOrSort: 12, Type: 0, RewXP: 0, RewOrReqMoney: 0, zone_name: 'Elwynn Forest', id: 12, map_id: 0 };
for (let i = 1; i <= 4; i++) { ROW[`RewItemId${i}`] = 0; ROW[`RewItemCount${i}`] = 0; }
for (let i = 1; i <= 6; i++) { ROW[`RewChoiceItemId${i}`] = 0; ROW[`RewChoiceItemCount${i}`] = 0; }

function harness() {
  const stub = dbStubPool({ quest_template: [ROW] });
  return { ...dbApp({ world: stub.pool }), stub };
}

test('GET /db/quests renders the whole page on the browser chrome with no SOAP call', async (t) => {
  const { app, executeCalls } = harness();
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/quests', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /class="db-browser"/);
  assert.match(res.body, /class="nav-item active" href="\/db\/quests"/);
  assert.match(res.body, /Wanted: Hogger/);
  assert.match(res.body, /name="category"/);
  assert.equal(executeCalls(), 0);
});

test('with HX-Request it returns the fragment alone and does not read the categories', async (t) => {
  const { app, stub } = harness();
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/quests?q=hogger', headers: { ...HEADERS, 'hx-request': 'true' } });
  assert.doesNotMatch(res.body, /<!doctype html>/i);
  assert.match(res.body, /id="listview"/);
  assert.equal(stub.calls.filter((c) => c.sql.includes('DISTINCT')).length, 0);
  assert.match(res.headers.vary, /HX-Request/);
});

test('a history restore gets the whole page', async (t) => {
  const { app } = harness();
  t.after(() => app.close());
  const res = await app.inject({
    method: 'GET', url: '/db/quests',
    headers: { ...HEADERS, 'hx-request': 'true', 'hx-history-restore-request': 'true' }
  });
  assert.match(res.body, /class="db-browser"/);
  assert.match(res.body, /<form[^>]*hx-get="\/db\/quests"/);
  assert.match(res.body, /id="listview"/);
});

test('without a world database the page explains itself', async (t) => {
  const { app } = dbApp({ world: null });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/quests', headers: HEADERS });
  assert.match(res.body, /not configured/);
});
