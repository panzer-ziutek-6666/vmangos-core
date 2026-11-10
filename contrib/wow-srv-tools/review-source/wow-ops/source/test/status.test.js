import test from 'node:test';
import assert from 'node:assert/strict';
import { readStatus } from '../server/status.js';
import { renderStatusStrip, renderPage } from '../server/views/layout.js';

const fakeSoap = (result) => ({
  execute: async () => result,
  queueDepth: () => 0
});

// Records every command it was asked to run, so a test can assert on the
// exact set of commands issued - in particular, that `.bot info` is never
// among them (see server/status.js for why: it reports a bot subsystem this
// realm does not use and always answers zero).
const commandSoap = (responses) => {
  const calls = [];
  return {
    calls,
    execute: async (command) => {
      calls.push(command);
      return responses[command] ?? { ok: false, status: 'failed', output: `no fixture response for ${command}` };
    },
    queueDepth: () => 0
  };
};

const SERVER_INFO_OK = {
  ok: true, status: 'ok', durationMs: 5,
  output: 'Core revision: 1.12.1\nPlayers online: 3 (0 queued). Max online: 9 (0 queued).\nServer uptime: 2 Hour(s) 5 Minute(s)'
};

const CONFIG = {
  mysql: {
    logon: { database: 'realmd' },
    characters: { database: 'characters' }
  },
  bots: { accountPrefix: 'RNDBOT' }
};

// A fake pool shaped like the mysql2 pool passed to characters.query() in
// server/queries/bots.js: records the SQL and params it was called with, and
// answers with a fixed count (or throws, for the failure-path test below).
const fakePools = (count) => ({
  characters: {
    calls: [],
    query: async function (sql, params) {
      this.calls.push({ sql, params });
      return [[{ c: count }]];
    }
  }
});

const throwingPools = () => ({
  characters: {
    query: async () => {
      throw new Error('connection refused');
    }
  }
});

test('reads uptime and player count out of the prose', async () => {
  const soap = fakeSoap({
    ok: true, status: 'ok', durationMs: 5,
    output: 'Core revision: 1.12.1\nPlayers online: 3 (0 queued). Max online: 9 (0 queued).\nServer uptime: 2 Hour(s) 5 Minute(s)'
  });
  const status = await readStatus({ soap, pools: null, config: CONFIG });

  assert.equal(status.reachable, true);
  assert.equal(status.playersOnline, 3);
  assert.equal(status.uptime, '2 Hour(s) 5 Minute(s)');
});

test('degrades to nulls rather than throwing when the wording changes', async () => {
  const soap = fakeSoap({ ok: true, status: 'ok', durationMs: 5, output: 'something entirely different' });
  const status = await readStatus({ soap, pools: null, config: CONFIG });

  assert.equal(status.reachable, true);
  assert.equal(status.playersOnline, null);
  assert.equal(status.uptime, null);
});

test('reports an unreachable server', async () => {
  const soap = fakeSoap({ ok: false, status: 'unreachable', durationMs: 1, output: 'Cannot reach mangosd' });
  const status = await readStatus({ soap, pools: null, config: CONFIG });

  assert.equal(status.reachable, false);
  assert.match(status.error, /Cannot reach mangosd/);
});

test('the strip shows an offline warning when unreachable', () => {
  const html = renderStatusStrip({ reachable: false, error: 'Cannot reach mangosd at 127.0.0.1:7878' });
  assert.match(html, /mangosd is not reachable/);
  assert.match(html, /Cannot reach mangosd at 127\.0\.0\.1:7878/);
});

test('the strip shows the numbers when reachable', () => {
  const html = renderStatusStrip({ reachable: true, uptime: '2 Hour(s)', playersOnline: 3, botsOnline: 120, queueDepth: 0 });
  assert.match(html, /2 Hour\(s\)/);
  assert.match(html, />3</);
  assert.match(html, />120</);
});

test('the strip escapes text coming from the server', () => {
  const html = renderStatusStrip({ reachable: false, error: '<script>alert(1)</script>' });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test('the page marks the active section', () => {
  const html = renderPage({
    title: 'Accounts', active: 'accounts', body: '<p>hi</p>',
    status: { reachable: true, uptime: '1m', playersOnline: 0, botsOnline: 0, queueDepth: 0 }
  });
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<title>Accounts — wow-ops<\/title>/);
  assert.match(html, /class="nav-item active"[^>]*href="\/accounts"/);
  assert.match(html, /<p>hi<\/p>/);
});

test('reads the bot count from SQL, not from .bot info', async () => {
  const soap = commandSoap({ '.server info': SERVER_INFO_OK });
  const pools = fakePools(1008);

  const status = await readStatus({ soap, pools, config: CONFIG });

  assert.equal(status.botsOnline, 1008);
  // The regression guard for the fix: this realm's `.bot info` reports an
  // unrelated, unused bot subsystem (PlayerBotMgr.cpp:760) and always
  // answers zero, so the panel must never issue it.
  assert.deepEqual(soap.calls, ['.server info']);
});

test('qualifies the cross-database query with the configured schema names and bot prefix', async () => {
  const soap = commandSoap({ '.server info': SERVER_INFO_OK });
  const pools = fakePools(1008);

  await readStatus({ soap, pools, config: CONFIG });

  assert.equal(pools.characters.calls.length, 1);
  const { sql, params } = pools.characters.calls[0];
  assert.match(sql, /`characters`\.characters/);
  assert.match(sql, /`realmd`\.account/);
  assert.deepEqual(params, ['RNDBOT%']);
});

test('degrades the bot count to null, without throwing, when the SQL query fails', async () => {
  const soap = commandSoap({ '.server info': SERVER_INFO_OK });
  const pools = throwingPools();

  const status = await readStatus({ soap, pools, config: CONFIG });

  assert.equal(status.reachable, true);
  assert.equal(status.botsOnline, null);
  // The rest of the strip is unaffected by the bot query failing.
  assert.equal(status.playersOnline, 3);
  assert.equal(status.uptime, '2 Hour(s) 5 Minute(s)');
});

test('reports a null bot count, without throwing, when no characters pool is configured', async () => {
  const soap = commandSoap({ '.server info': SERVER_INFO_OK });

  const status = await readStatus({ soap, pools: null, config: CONFIG });

  assert.equal(status.reachable, true);
  assert.equal(status.botsOnline, null);
});

test('single-flights concurrent status reads: one SOAP command, one shared result', async () => {
  const soap = commandSoap({ '.server info': SERVER_INFO_OK });
  const pools = fakePools(1008);

  const [a, b, c] = await Promise.all([
    readStatus({ soap, pools, config: CONFIG }),
    readStatus({ soap, pools, config: CONFIG }),
    readStatus({ soap, pools, config: CONFIG })
  ]);

  assert.deepEqual(soap.calls, ['.server info']);
  assert.equal(a.botsOnline, 1008);
  assert.equal(b, a);
  assert.equal(c, a);
});

test('serves a cached status within the TTL instead of issuing new SOAP commands', async () => {
  const soap = commandSoap({ '.server info': SERVER_INFO_OK });
  const pools = fakePools(1008);

  const first = await readStatus({ soap, pools, config: CONFIG });
  assert.deepEqual(soap.calls, ['.server info']);

  const second = await readStatus({ soap, pools, config: CONFIG });
  assert.deepEqual(soap.calls, ['.server info']); // no new round trip
  assert.equal(second, first);
});
