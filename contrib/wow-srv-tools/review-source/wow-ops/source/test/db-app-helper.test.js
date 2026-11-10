import test from 'node:test';
import assert from 'node:assert/strict';
import { dbApp, CONFIG, HEADERS } from './helpers/dbApp.js';
import { dbStubPool } from './helpers/dbStubPool.js';

test('dbApp builds the panel over a stub world pool and counts SOAP calls', async (t) => {
  const { app, executeCalls } = dbApp({ world: dbStubPool({}).pool });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.equal(executeCalls(), 0);
});

test('a world of null drops the world pool, and config can be overridden', async (t) => {
  const config = { ...CONFIG, mysql: { ...CONFIG.mysql, dbcSchema: 'dbc' } };
  const { app } = dbApp({ world: null, config });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/npcs', headers: HEADERS });
  assert.match(res.body, /not configured/);
});
