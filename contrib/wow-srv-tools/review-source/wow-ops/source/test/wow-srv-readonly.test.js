import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../server/app.js';
import { createDisabledSoapClient, createReadOnlyAudit } from '../server/wow-srv-readonly.js';
import { CONFIG, HEADERS } from './helpers/dbApp.js';

function fixture() {
  let sqlCalls = 0;
  const pools = {
    logon: { query: async () => { sqlCalls += 1; return [[]]; } },
    world: { query: async () => { sqlCalls += 1; return [[]]; } },
    characters: { query: async () => { sqlCalls += 1; return [[]]; } }
  };
  const app = buildApp({
    config: CONFIG,
    soap: createDisabledSoapClient(),
    audit: createReadOnlyAudit(),
    pools,
    readOnly: true
  });
  return { app, sqlCalls: () => sqlCalls };
}

test('WOW-SRV: all write methods and privileged endpoints are rejected before handlers', async (t) => {
  const { app, sqlCalls } = fixture();
  t.after(() => app.close());
  for (const url of [
    '/accounts/create', '/accounts/delete', '/server/announce', '/server/shutdown',
    '/characters/erase', '/events/start', '/tickets/reset',
    '/realms/create', '/realms/1/update', '/realms/1/delete'
  ]) {
    const result = await app.inject({ method: 'POST', url, headers: HEADERS, payload: {} });
    assert.equal(result.statusCode, 405, `route ${url} not blocked`);
    assert.equal(result.headers.allow, 'GET, HEAD');
  }
  for (const method of ['PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const result = await app.inject({ method, url: '/realms/1/delete', headers: HEADERS });
    assert.equal(result.statusCode, 405, `${method} not blocked`);
  }
  assert.equal(sqlCalls(), 0, 'no SQL must run for rejected mutations');
});

test('WOW-SRV: disabled SOAP never performs a network call and reports offline', async () => {
  const soap = createDisabledSoapClient();
  const result = await soap.execute('.server info');
  assert.equal(result.ok, false);
  assert.equal(result.status, 'disabled');
  assert.equal(soap.queueDepth(), 0);
});

test('WOW-SRV: GET /status and /events override a supplied live SOAP executor', async (t) => {
  let unexpectedSoapCalls = 0;
  const suppliedSoap = {
    execute: async () => { unexpectedSoapCalls += 1; throw new Error('LIVE SOAP MUST NOT RUN'); },
    queueDepth: () => 0
  };
  const pools = {
    logon: { query: async () => [[]] },
    world: { query: async () => [[]] }
  };
  const app = buildApp({
    config: CONFIG, soap: suppliedSoap, audit: createReadOnlyAudit(),
    pools, readOnly: true
  });
  t.after(() => app.close());
  const status = await app.inject({ method: 'GET', url: '/status', headers: HEADERS });
  assert.equal(status.statusCode, 200);
  const events = await app.inject({ method: 'GET', url: '/events', headers: HEADERS });
  assert.equal(events.statusCode, 200);
  assert.equal(unexpectedSoapCalls, 0);
});

test('WOW-SRV: read-only audit cannot accept action records', () => {
  const audit = createReadOnlyAudit();
  assert.deepEqual(audit.recent(100), []);
  assert.throws(() => audit.record({ command: '.server shutdown 1' }), /disabled/);
});

test('WOW-SRV: GET /status is served without real SOAP', async (t) => {
  const { app } = fixture();
  t.after(() => app.close());
  const result = await app.inject({ method: 'GET', url: '/status', headers: HEADERS });
  assert.equal(result.statusCode, 200);
  assert.match(result.body, /SOAP is disabled/);
});
