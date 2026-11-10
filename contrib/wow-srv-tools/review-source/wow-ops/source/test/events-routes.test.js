import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../server/app.js';
import { createAuditLog } from '../server/audit.js';

const DB_ROW = {
  entry: 13, description: 'Elemental Invasion', start_time: new Date('2026-09-02T02:33:49Z'),
  end_time: null, occurence: 1440, length: 60, holiday: 0, hardcoded: 0, disabled: 0,
  patch_min: 2, patch_max: 10
};

function harness({ rows = [DB_ROW], listOutput = '13 - Elemental Invasion  [active]', reachable = true } = {}) {
  const sent = [];
  const soap = {
    execute: async (command) => {
      sent.push(command);
      if (!reachable) return { ok: false, status: 'unreachable', output: 'Cannot reach mangosd', durationMs: 1 };
      if (command === '.server info') {
        return { ok: true, status: 'ok', output: 'Players online: 1\nServer uptime: 5 Minute(s)', durationMs: 1 };
      }
      if (command === '.event list all') {
        return { ok: true, status: 'ok', output: listOutput, durationMs: 2 };
      }
      return { ok: true, status: 'ok', output: 'done', durationMs: 3 };
    },
    queueDepth: () => 0
  };
  const audit = createAuditLog(':memory:');
  const config = {
    soap: { user: 'ops' }, bots: { accountPrefix: 'RNDBOT', playerSaveIntervalMs: 900000 },
    realm: { id: 1 }, panel: { port: 80 },
    mysql: { logon: { database: 'realmd' }, characters: { database: 'characters' }, world: { database: 'mangos' } },
    characters: { charDeleteMethod: 0 }, events: { wowPatch: 10 }
  };
  const pools = {
    logon: { query: async () => [[]] },
    characters: { query: async () => [[]] },
    world: { query: async () => [rows] }
  };
  const app = buildApp({ config, soap, pools, audit });
  return { app, audit, sent };
}

test('the page renders, marks the nav and carries the htmx target', async (t) => {
  const { app, audit } = harness();
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/events' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Elemental Invasion/);
  assert.match(res.body, /class="nav-item active"[^>]*href="\/events"/);
  assert.match(res.body, /id="result"/);
});

test('the live state comes from .event list all, not from the disabled column', async (t) => {
  const { app, audit, sent } = harness();
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/events' });
  assert.ok(sent.includes('.event list all'));
  assert.match(res.body, /active/);
});

test('an event the live list does not mention renders as unknown, not as inactive', async (t) => {
  const { app, audit } = harness({ listOutput: 'No event found!' });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/events' });
  assert.match(res.body, /unknown/i);
});

test('an event excluded by the running patch is flagged', async (t) => {
  const { app, audit } = harness({ rows: [{ ...DB_ROW, patch_min: 0, patch_max: 1 }] });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/events' });
  assert.match(res.body, /excluded by patch/i);
});

test('an action builds the command, sends it and audits it under the events section', async (t) => {
  const { app, audit, sent } = harness();
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'POST', url: '/events/start', payload: { id: '13' } });
  assert.equal(res.statusCode, 200);
  assert.ok(sent.includes('.event start 13'));
  assert.equal(audit.recent(10)[0].command, '.event start 13');
  assert.equal(audit.recent(10)[0].section, 'events');
});

test('info is `.event <id>` with no subcommand word', async (t) => {
  const { app, audit, sent } = harness();
  t.after(() => { audit.close(); return app.close(); });

  await app.inject({ method: 'POST', url: '/events/info', payload: { id: '13' } });
  assert.ok(sent.includes('.event 13'));
});

test('a bad id is refused, never sent and never audited', async (t) => {
  const { app, audit, sent } = harness();
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'POST', url: '/events/start', payload: { id: '13; .server exit' } });
  assert.equal(res.statusCode, 400);
  assert.ok(!sent.some((c) => c.startsWith('.event start')));
  assert.equal(audit.recent(10).length, 0);
});

test('a repeated id field is rejected rather than coerced', async (t) => {
  const { app, audit, sent } = harness();
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({
    method: 'POST', url: '/events/start', payload: 'id=13&id=14',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });
  assert.equal(res.statusCode, 400);
  assert.ok(!sent.some((c) => c.startsWith('.event start')));
});

test('enable and disable refuse without the id typed back', async (t) => {
  const { app, audit, sent } = harness();
  t.after(() => { audit.close(); return app.close(); });

  for (const action of ['enable', 'disable']) {
    const refused = await app.inject({ method: 'POST', url: `/events/${action}`, payload: { id: '13', confirm: '12' } });
    assert.equal(refused.statusCode, 400, action);
  }
  assert.ok(!sent.some((c) => c.startsWith('.event enable') || c.startsWith('.event disable')));

  const ok = await app.inject({ method: 'POST', url: '/events/disable', payload: { id: '13', confirm: '13' } });
  assert.equal(ok.statusCode, 200);
  assert.ok(sent.includes('.event disable 13'));
});

test('an unknown action is a 404 and does not resolve through Object.prototype', async (t) => {
  const { app, audit, sent } = harness();
  t.after(() => { audit.close(); return app.close(); });

  for (const action of ['nope', 'constructor', 'toString']) {
    const res = await app.inject({ method: 'POST', url: `/events/${action}`, payload: { id: '13' } });
    assert.equal(res.statusCode, 404, action);
  }
  assert.ok(!sent.some((c) => c.includes('object Object')));
});

test('nothing is sent while mangosd is unreachable', async (t) => {
  const { app, audit, sent } = harness({ reachable: false });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'POST', url: '/events/start', payload: { id: '13' } });
  assert.equal(res.statusCode, 503);
  assert.ok(!sent.includes('.event start 13'));
  assert.equal(audit.recent(10).length, 0);
});

test('the page still renders when the live list cannot be read', async (t) => {
  const { app, audit } = harness({ reachable: false });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/events' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Elemental Invasion/);
});
