import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../server/app.js';
import { createAuditLog } from '../server/audit.js';

const DB_ROW = {
  ticket_id: 3, guid: 5, name: 'Thrall', message: 'stuck in a rock',
  create_time: 1756800000, last_modified_time: 1756800100,
  map: 1, map_name: 'Kalimdor', position_x: 1.5, position_y: 2.5, position_z: 3.5,
  closed_by: 0, assigned_to: 0, assigned_to_name: null, closer_name: null,
  comment: '', response: '', completed: 0, escalated: 0, viewed: 0,
  ticket_type: 1, security_needed: 0
};

function harness({ rows = [DB_ROW], reachable = true } = {}) {
  const sent = [];
  const soap = {
    execute: async (command) => {
      sent.push(command);
      if (!reachable) return { ok: false, status: 'unreachable', output: 'Cannot reach mangosd', durationMs: 1 };
      if (command === '.server info') {
        return { ok: true, status: 'ok', output: 'Players online: 1\nServer uptime: 5 Minute(s)', durationMs: 1 };
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
    characters: { query: async () => [rows] },
    world: { query: async () => [[]] }
  };
  const app = buildApp({ config, soap, pools, audit });
  return { app, audit, sent };
}

test('the list page renders, marks the nav and carries the htmx target', async (t) => {
  const { app, audit } = harness();
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/tickets' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Thrall/);
  assert.match(res.body, /class="nav-item active"[^>]*href="\/tickets"/);
  assert.match(res.body, /id="result"/);
});

test('the detail page renders one ticket', async (t) => {
  const { app, audit } = harness();
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/tickets/3' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /stuck in a rock/);
});

test('an unknown ticket is a 404 and a bad id is a 400', async (t) => {
  const { app, audit } = harness({ rows: [] });
  t.after(() => { audit.close(); return app.close(); });

  assert.equal((await app.inject({ method: 'GET', url: '/tickets/99' })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: '/tickets/abc' })).statusCode, 400);
});

test('an action builds, sends and audits under the tickets section', async (t) => {
  const { app, audit, sent } = harness();
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'POST', url: '/tickets/comment', payload: { id: '3', text: 'moved the player' } });
  assert.equal(res.statusCode, 200);
  assert.ok(sent.includes('.ticket comment 3 moved the player'));
  assert.equal(audit.recent(10)[0].section, 'tickets');
});

test('every shipped action is reachable and spelled as the core spells it', async (t) => {
  const { app, audit, sent } = harness();
  t.after(() => { audit.close(); return app.close(); });

  const cases = [
    ['view', { id: '3' }, '.ticket viewid 3'],
    ['viewname', { name: 'Thrall' }, '.ticket viewname Thrall'],
    ['list', {}, '.ticket list'],
    ['list', { category: 'stuck' }, '.ticket list stuck'],
    ['onlinelist', {}, '.ticket onlinelist'],
    ['closedlist', {}, '.ticket closedlist'],
    ['escalatedlist', {}, '.ticket escalatedlist'],
    ['assign', { id: '3', name: 'Thrall' }, '.ticket assign 3 Thrall'],
    ['unassign', { id: '3' }, '.ticket unassign 3'],
    ['append', { id: '3', text: 'on it' }, '.ticket response append 3 on it'],
    ['appendln', { id: '3', text: 'thanks' }, '.ticket response appendln 3 thanks'],
    ['responsereset', { id: '3' }, '.ticket response reset 3'],
    ['complete', { id: '3' }, '.ticket complete 3'],
    ['complete', { id: '3', text: 'sorted' }, '.ticket complete 3 sorted'],
    ['close', { id: '3' }, '.ticket close 3'],
    ['reload', { id: '3' }, '.ticket reload 3']
  ];

  for (const [action, payload, expected] of cases) {
    const res = await app.inject({ method: 'POST', url: `/tickets/${action}`, payload });
    assert.equal(res.statusCode, 200, action);
    assert.ok(sent.includes(expected), `${action} sent ${JSON.stringify(sent.at(-1))}`);
  }
});

test('delete, reset and togglesystem need their confirmation', async (t) => {
  const { app, audit, sent } = harness();
  t.after(() => { audit.close(); return app.close(); });

  assert.equal((await app.inject({ method: 'POST', url: '/tickets/delete', payload: { id: '3', confirm: '2' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/tickets/reset', payload: { confirm: 'no' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/tickets/togglesystem', payload: {} })).statusCode, 400);
  assert.ok(!sent.some((c) => c.startsWith('.ticket delete') || c === '.ticket reset' || c === '.ticket togglesystem'));

  assert.equal((await app.inject({ method: 'POST', url: '/tickets/delete', payload: { id: '3', confirm: '3' } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/tickets/reset', payload: { confirm: 'DELETE ALL TICKETS' } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/tickets/togglesystem', payload: { confirm: 'toggle' } })).statusCode, 200);
  assert.ok(sent.includes('.ticket delete 3'));
  assert.ok(sent.includes('.ticket reset'));
  assert.ok(sent.includes('.ticket togglesystem'));
});

test('a bad id or an unknown category is refused, never sent, never audited', async (t) => {
  const { app, audit, sent } = harness();
  t.after(() => { audit.close(); return app.close(); });

  assert.equal((await app.inject({ method: 'POST', url: '/tickets/close', payload: { id: 'abc' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/tickets/list', payload: { category: 'urgent' } })).statusCode, 400);
  assert.equal(audit.recent(10).length, 0);
  assert.ok(sent.every((c) => c === '.server info'));
});

test('a repeated id field is rejected rather than coerced', async (t) => {
  const { app, audit, sent } = harness();
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({
    method: 'POST', url: '/tickets/close', payload: 'id=3&id=4',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });
  assert.equal(res.statusCode, 400);
  assert.ok(!sent.some((c) => c.startsWith('.ticket close')));
});

test('an unknown action is a 404 and does not resolve through Object.prototype', async (t) => {
  const { app, audit, sent } = harness();
  t.after(() => { audit.close(); return app.close(); });

  for (const action of ['nope', 'constructor', 'toString']) {
    assert.equal((await app.inject({ method: 'POST', url: `/tickets/${action}`, payload: { id: '3' } })).statusCode, 404, action);
  }
  assert.ok(!sent.some((c) => c.includes('object Object')));
});

test('nothing is sent while mangosd is unreachable', async (t) => {
  const { app, audit, sent } = harness({ reachable: false });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'POST', url: '/tickets/close', payload: { id: '3' } });
  assert.equal(res.statusCode, 503);
  assert.ok(!sent.includes('.ticket close 3'));
  assert.equal(audit.recent(10).length, 0);
});
