import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../server/app.js';
import { createDisabledSoapClient, createReadOnlyAudit } from '../server/wow-srv-readonly.js';
import { CONFIG } from './helpers/dbApp.js';

test('WOW-SRV: GET /accounts renders with config.soap=null in read-only mode', async (t) => {
  const config = { ...CONFIG, soap: null, panel: { port: 8420 } };
  let queryCount = 0;
  const pools = {
    logon: { query: async () => { queryCount++; return [[]]; } },
    characters: { query: async () => { queryCount++; return [[]]; } },
    world: { query: async () => { queryCount++; return [[]]; } }
  };
  const app = buildApp({
    config, pools, soap: createDisabledSoapClient(),
    audit: createReadOnlyAudit(), readOnly: true
  });
  t.after(() => app.close());
  const headers = { host: '127.0.0.1:8420' };
  const result = await app.inject({ method: 'GET', url: '/accounts', headers });
  assert.equal(result.statusCode, 200, 'accounts page should not dereference null SOAP config');
  assert.match(result.body, /Accounts/i);
  const beforePost = queryCount;
  const blocked = await app.inject({ method: 'POST', url: '/accounts/create', headers, payload: {} });
  assert.equal(blocked.statusCode, 405);
  assert.equal(queryCount, beforePost, 'POST must be blocked before SQL');
});
