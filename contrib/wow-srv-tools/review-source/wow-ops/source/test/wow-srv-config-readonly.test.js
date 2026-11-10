import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../server/config.js';

const MYSQL = Object.freeze({
  host: '127.0.0.1', port: 3306, user: 'offline_fixture_user',
  password: 'offline_fixture_password', database: 'realmd_dev'
});

function minimal() {
  return { panel: { port: 8420 }, mysql: { logon: { ...MYSQL } } };
}

test('WOW-SRV config: readOnly accepts no SOAP section or credentials', () => {
  const config = loadConfig(minimal(), { readOnly: true });
  assert.equal(config.soap, null);
  assert.equal(config.mysql.logon.database, 'realmd_dev');
  assert.equal(config.panel.port, 8420);
  assert.ok(Object.isFrozen(config));
});

test('WOW-SRV config: readOnly discards any supplied SOAP credentials', () => {
  const raw = minimal();
  raw.soap = { host: 'not-used', port: 9, user: 'forbidden-user', pass: 'forbidden-secret' };
  const config = loadConfig(raw, { readOnly: true });
  assert.equal(config.soap, null);
  assert.ok(!JSON.stringify(config).includes('forbidden-secret'));
});

test('WOW-SRV config: ordinary mode still requires a SOAP section', () => {
  assert.throws(() => loadConfig(minimal()), /missing section "soap"/);
});

test('WOW-SRV config: ordinary mode still requires SOAP user and password', () => {
  const raw = minimal();
  raw.soap = { host: '127.0.0.1', port: 7878, user: 'operator' };
  assert.throws(() => loadConfig(raw), /soap.pass is required/);
  raw.soap.pass = 'fixture-only';
  delete raw.soap.user;
  assert.throws(() => loadConfig(raw), /soap.user is required/);
});

test('WOW-SRV config: existing full SOAP configuration remains valid in ordinary mode', () => {
  const raw = minimal();
  raw.soap = { host: '127.0.0.1', port: 7878, user: 'operator', pass: 'fixture-only' };
  const config = loadConfig(raw);
  assert.equal(config.soap.user, 'operator');
  assert.equal(config.soap.port, 7878);
});

test('WOW-SRV config: readOnly option is strictly boolean', () => {
  assert.throws(() => loadConfig(minimal(), { readOnly: 'true' }), /readOnly must be a boolean/);
  assert.throws(() => loadConfig(minimal(), { readOnly: 1 }), /readOnly must be a boolean/);
});
