import test from 'node:test';
import assert from 'node:assert/strict';
import { dbApp, HEADERS } from './helpers/dbApp.js';
import { dbStubPool } from './helpers/dbStubPool.js';

const ITEM_ROW = {
  entry: 19019, name: 'Thunderfury', quality: 5, class: 2, subclass: 7,
  item_level: 80, required_level: 60, inventory_type: 13, set_id: 0,
  inventory_icon: 'INV_Sword_39'
};

// Route harness: see test/helpers/dbApp.js. `world: null` drops the world
// pool entirely, the shape the "not configured" test needs.
function harness({ world = dbStubPool({ item_template: [ITEM_ROW] }).pool } = {}) {
  return { app: dbApp({ world }).app };
}

test('GET /db/items renders the whole page', async (t) => {
  const { app } = harness();
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/items', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<!doctype html>/i);
  assert.match(res.body, /id="listview"/);
});

test('the same URL with HX-Request returns the fragment alone', async (t) => {
  const { app } = harness();
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/items?q=sword', headers: { ...HEADERS, 'hx-request': 'true' } });
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /<!doctype html>/i);
  assert.match(res.body, /id="listview"/);
});

test('a junk filter value renders the listview rather than erroring', async (t) => {
  const { app } = harness();
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/items?quality=banana&page=-2&sort=%3Bdrop', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /id="listview"/);
});

test('without a world database the page explains itself instead of failing', async (t) => {
  const { app } = harness({ world: null });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/items', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /not configured/);
});
