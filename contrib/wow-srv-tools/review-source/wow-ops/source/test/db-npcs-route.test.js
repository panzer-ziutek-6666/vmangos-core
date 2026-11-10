import test from 'node:test';
import assert from 'node:assert/strict';
import { dbApp, HEADERS } from './helpers/dbApp.js';
import { dbStubPool } from './helpers/dbStubPool.js';

const CREATURE_ROW = {
  entry: 448, name: 'Hogger', subname: null, level_min: 9, level_max: 10,
  rank: 1, type: 7, faction: 14, faction_name: null, spawn_count: 5, map_id: 0
};

// Route harness: see test/helpers/dbApp.js. `world: null` drops the world
// pool entirely, the shape the "not configured" test needs.
function harness({ world = dbStubPool({ creature_template: [CREATURE_ROW] }).pool } = {}) {
  return { app: dbApp({ world }).app };
}

test('GET /db/npcs renders the whole page', async (t) => {
  const { app } = harness();
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/npcs', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<!doctype html>/i);
  assert.match(res.body, /id="listview"/);
});

test('the same URL with HX-Request returns the fragment alone', async (t) => {
  const { app } = harness();
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/npcs?q=hogger', headers: { ...HEADERS, 'hx-request': 'true' } });
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /<!doctype html>/i);
  assert.match(res.body, /id="listview"/);
  assert.match(res.headers.vary, /HX-Request/);
});

// On a history-cache miss htmx 2.0.4 sends HX-Request *and*
// HX-History-Restore-Request, then swaps the response into <body> - a
// fragment there would leave a bare table with no shell or form
// (whole-branch review, 2026-09-23). The same helper serves /db/items and
// /db/objects.
test('a history restore gets the whole page even though it carries HX-Request', async (t) => {
  const { app } = harness();
  t.after(() => app.close());
  const res = await app.inject({
    method: 'GET', url: '/db/npcs?q=hogger',
    headers: { ...HEADERS, 'hx-request': 'true', 'hx-history-restore-request': 'true' }
  });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /class="db-browser"/);
  assert.match(res.body, /<form[^>]*hx-get="\/db\/npcs"/);
  assert.match(res.headers.vary, /HX-History-Restore-Request/);
});

// Same helper, but /db/items answers htmx with its own out-of-band shape, so
// it gets its own check that a restore request still gets the whole page.
test('/db/items and /db/objects answer a history restore with the whole page too', async (t) => {
  const { app } = harness();
  t.after(() => app.close());
  for (const url of ['/db/items', '/db/objects']) {
    const res = await app.inject({
      method: 'GET', url,
      headers: { ...HEADERS, 'hx-request': 'true', 'hx-history-restore-request': 'true' }
    });
    assert.equal(res.statusCode, 200, url);
    assert.match(res.body, /class="db-browser"/, url);
    assert.doesNotMatch(res.body, /hx-swap-oob/, url);
    // The "world database not configured" page is also whole-page chrome
    // with no out-of-band swap; the form and listview are what tell the
    // real page apart from it.
    assert.match(res.body, /id="listview"/, url);
    assert.match(res.body, new RegExp(`<form[^>]*hx-get="${url}"`), url);
  }
});

test('a junk filter value renders the listview rather than erroring', async (t) => {
  const { app } = harness();
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/npcs?rank=banana&page=-2', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /id="listview"/);
});

test('without a world database the page explains itself', async (t) => {
  const { app } = harness({ world: null });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/npcs', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /not configured/);
});
