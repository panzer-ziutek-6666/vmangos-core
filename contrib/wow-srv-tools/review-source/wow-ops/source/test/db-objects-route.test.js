import test from 'node:test';
import assert from 'node:assert/strict';
import { dbApp, HEADERS } from './helpers/dbApp.js';
import { dbStubPool } from './helpers/dbStubPool.js';

const OBJECT_ROW = {
  entry: 1731, name: 'Sunken Chest', type: 3, data0: 11, data1: 4700, data8: 0,
  spawn_count: 2, map_id: 0
};

// Route harness: see test/helpers/dbApp.js. `world: null` drops the world
// pool entirely, the shape the "not configured" test needs.
function harness({ world = dbStubPool({ gameobject_template: [OBJECT_ROW] }).pool } = {}) {
  return { app: dbApp({ world }).app };
}

test('GET /db/objects renders the whole page', async (t) => {
  const { app } = harness();
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/objects', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<!doctype html>/i);
  assert.match(res.body, /id="listview"/);
});

test('the same URL with HX-Request returns the fragment alone', async (t) => {
  const { app } = harness();
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/objects?q=chest', headers: { ...HEADERS, 'hx-request': 'true' } });
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /<!doctype html>/i);
  assert.match(res.body, /id="listview"/);
});

test('a junk filter value renders the listview rather than erroring', async (t) => {
  const { app } = harness();
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/objects?type=banana&page=-2', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /id="listview"/);
});

test('without a world database the page explains itself', async (t) => {
  const { app } = harness({ world: null });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/objects', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /not configured/);
});
