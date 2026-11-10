import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../server/app.js';
import { createAuditLog } from '../server/audit.js';

const CHARACTER_ROW = {
  guid: 5, name: 'Thrall', race: 2, class: 7, gender: 0, level: 60, online: 1,
  account: 3, account_name: 'TOMEK', map_id: 1, map_name: 'Kalimdor',
  zone_id: 1637, zone_name: 'Orgrimmar', logout_time: 0,
  money: 1234567, played_time_total: 7325, create_time: 1756000000,
  position_x: 1.5, position_y: -2.5, position_z: 3.5, character_flags: 0,
  account_online: 1, account_mutetime: 0, gmlevel: 0,
  ban_active: null, ban_reason: null, ban_bandate: null, ban_unbandate: null
};

function harness({ rows = [CHARACTER_ROW], soapResult, reachable = true } = {}) {
  const sent = [];
  const soap = {
    execute: async (command) => {
      sent.push(command);
      if (!reachable) return { ok: false, status: 'unreachable', output: 'Cannot reach mangosd', durationMs: 1 };
      if (command === '.server info') {
        return { ok: true, status: 'ok', output: 'Players online: 1\nServer uptime: 5 Minute(s)', durationMs: 1 };
      }
      return soapResult ?? { ok: true, status: 'ok', output: 'done', durationMs: 3 };
    },
    queueDepth: () => 0
  };
  const audit = createAuditLog(':memory:');
  const config = {
    soap: { user: 'ops' },
    bots: { accountPrefix: 'RNDBOT', playerSaveIntervalMs: 900000 },
    realm: { id: 1 },
    panel: { port: 80 },
    mysql: {
      logon: { database: 'realmd' },
      characters: { database: 'characters' },
      world: { database: 'mangos' }
    },
    characters: { charDeleteMethod: 0 }
  };
  const pools = {
    logon: { query: async () => [[]] },
    characters: { query: async () => [rows] }
  };
  const app = buildApp({ config, soap, pools, audit });
  return { app, audit, sent, pools };
}

test('the list page renders and marks the nav', async (t) => {
  const { app, audit } = harness();
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/characters' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Thrall/);
  assert.match(res.body, /class="nav-item active"[^>]*href="\/characters"/);
});

test('the list page renders the #result element htmx targets', async (t) => {
  // Every form on the page carries hx-target="#result"; htmx resolves that
  // selector before it issues the request, so a page without the element
  // makes every button inert with only a console targetError to show for it.
  // That shipped once already - see the panel's Accounts review.
  const { app, audit } = harness();
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/characters' });
  assert.match(res.body, /id="result"/);
});

test('the detail page renders one character', async (t) => {
  const { app, audit } = harness();
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/characters/Thrall' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Orgrimmar/);
  assert.match(res.body, /id="result"/);
});

test('an unknown character is a 404, not a blank detail page', async (t) => {
  const { app, audit } = harness({ rows: [] });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/characters/Nobody' });
  assert.equal(res.statusCode, 404);
});

test('the deleted path is a page of its own, not a character named "deleted"', async (t) => {
  const { app, audit } = harness({ rows: [] });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/characters/deleted' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /CharDelete\.Method/);
});

test('a name the panel could never act on is refused before it reaches SQL', async (t) => {
  const { app, audit } = harness();
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: `/characters/${encodeURIComponent('way too long a name')}` });
  assert.equal(res.statusCode, 400);
});

test('the search term reaches the query as a prefix', async (t) => {
  const { app, audit, pools } = harness();
  t.after(() => { audit.close(); return app.close(); });
  // Every call is captured, not just the last one: the status strip's own
  // bot count runs on this same pool concurrently, so whichever query
  // finishes last would otherwise overwrite the one under test.
  const calls = [];
  pools.characters.query = async (sql, params) => {
    calls.push({ sql, params });
    return [[CHARACTER_ROW]];
  };

  await app.inject({ method: 'GET', url: '/characters?search=Thr' });
  assert.ok(calls.some((c) => c.params.includes('Thr%')), 'no query carried the search prefix');
});

// ---- actions -------------------------------------------------------------

test('an action builds the command, sends it and audits it', async (t) => {
  const { app, audit, sent } = harness();
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({
    method: 'POST', url: '/characters/level',
    payload: { name: 'Thrall', level: '60' }
  });
  assert.equal(res.statusCode, 200);
  assert.ok(sent.includes('.character level Thrall 60'));
  assert.equal(audit.recent(10)[0].command, '.character level Thrall 60');
  assert.equal(audit.recent(10)[0].section, 'characters');
});

test('a rejected argument is never sent and never audited', async (t) => {
  const { app, audit, sent } = harness();
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({
    method: 'POST', url: '/characters/level',
    payload: { name: 'Thrall', level: '99' }
  });
  assert.equal(res.statusCode, 400);
  assert.ok(!sent.some((c) => c.startsWith('.character level')));
  assert.equal(audit.recent(10).length, 0);
});

test('a repeated form field is rejected rather than coerced', async (t) => {
  // A field submitted twice arrives as an array; Number.parseInt on an array
  // coerces through toString() ("60,1" -> 60) and silently succeeds - the
  // trap the Accounts section documents.
  const { app, audit, sent } = harness();
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({
    method: 'POST', url: '/characters/level',
    payload: 'name=Thrall&level=60&level=1',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });
  assert.equal(res.statusCode, 400);
  assert.ok(!sent.some((c) => c.startsWith('.character level')));
});

test('an unknown action is a 404 and does not resolve through Object.prototype', async (t) => {
  const { app, audit, sent } = harness();
  t.after(() => { audit.close(); return app.close(); });

  for (const action of ['nope', 'constructor', 'toString', 'hasOwnProperty']) {
    const res = await app.inject({ method: 'POST', url: `/characters/${action}`, payload: { name: 'Thrall' } });
    assert.equal(res.statusCode, 404, action);
  }
  assert.ok(!sent.some((c) => c.includes('object Object')));
});

test('erase refuses without the typed confirmation', async (t) => {
  const { app, audit, sent } = harness();
  t.after(() => { audit.close(); return app.close(); });

  const refused = await app.inject({ method: 'POST', url: '/characters/erase', payload: { name: 'Thrall', confirm: 'thrall' } });
  assert.equal(refused.statusCode, 400);
  assert.ok(!sent.some((c) => c.startsWith('.character erase')));

  const accepted = await app.inject({ method: 'POST', url: '/characters/erase', payload: { name: 'Thrall', confirm: 'Thrall' } });
  assert.equal(accepted.statusCode, 200);
  assert.ok(sent.includes('.character erase Thrall'));
});

test('the two bulk deleted actions refuse without the typed search confirmation', async (t) => {
  const { app, audit, sent } = harness();
  t.after(() => { audit.close(); return app.close(); });

  for (const action of ['deletedrestore', 'deleteddelete']) {
    const refused = await app.inject({ method: 'POST', url: `/characters/${action}`, payload: { search: 'Thr', confirm: 'wrong' } });
    assert.equal(refused.statusCode, 400, action);
  }
  assert.ok(!sent.some((c) => c.includes('character deleted')));

  const ok = await app.inject({ method: 'POST', url: '/characters/deleteddelete', payload: { search: 'Thr', confirm: 'Thr' } });
  assert.equal(ok.statusCode, 200);
  assert.ok(sent.includes('.character deleted delete Thr'));
});

test('a mass send refuses without the typed race-mask confirmation', async (t) => {
  const { app, audit, sent } = harness();
  t.after(() => { audit.close(); return app.close(); });

  const refused = await app.inject({
    method: 'POST', url: '/characters/massmail',
    payload: { raceMask: 'all', subject: 'Notice', body: 'Hello', confirm: 'horde' }
  });
  assert.equal(refused.statusCode, 400);
  assert.ok(!sent.some((c) => c.startsWith('.send mass')));

  const ok = await app.inject({
    method: 'POST', url: '/characters/massmail',
    payload: { raceMask: 'all', subject: 'Notice', body: 'Hello', confirm: 'all' }
  });
  assert.equal(ok.statusCode, 200);
  assert.ok(sent.includes('.send mass mail all "Notice" "Hello"'));
});

test('purging with zero keep days needs a confirmation, other day counts do not', async (t) => {
  // DeleteOldCharacters(0) purges every deleted character rather than the old
  // ones, so it carries the same blast radius as the bulk delete.
  const { app, audit, sent } = harness();
  t.after(() => { audit.close(); return app.close(); });

  const refused = await app.inject({ method: 'POST', url: '/characters/deletedold', payload: { keepDays: '0' } });
  assert.equal(refused.statusCode, 400);
  assert.ok(!sent.includes('.character deleted old 0'));

  const confirmed = await app.inject({ method: 'POST', url: '/characters/deletedold', payload: { keepDays: '0', confirm: '0' } });
  assert.equal(confirmed.statusCode, 200);
  assert.ok(sent.includes('.character deleted old 0'));

  const ordinary = await app.inject({ method: 'POST', url: '/characters/deletedold', payload: { keepDays: '90' } });
  assert.equal(ordinary.statusCode, 200);
  assert.ok(sent.includes('.character deleted old 90'));
});

test('a malformed name answers a whole page, not a bare fragment', async (t) => {
  // This route is reached by a link or a typed URL, so its error must be a
  // page with the panel's own navigation, not the fragment htmx swaps in.
  const { app, audit } = harness();
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: `/characters/${encodeURIComponent('way too long a name')}` });
  assert.equal(res.statusCode, 400);
  assert.match(res.body, /<html/);
  assert.match(res.body, /nav-item/);
});

test('nothing is sent while mangosd is unreachable', async (t) => {
  const { app, audit, sent } = harness({ reachable: false });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'POST', url: '/characters/revive', payload: { name: 'Thrall' } });
  assert.equal(res.statusCode, 503);
  assert.ok(!sent.includes('.revive Thrall'));
  assert.equal(audit.recent(10).length, 0);
});

test('every shipped action is reachable and spelled as the core spells it', async (t) => {
  const { app, audit, sent } = harness();
  t.after(() => { audit.close(); return app.close(); });

  const cases = [
    ['rename', { name: 'Thrall' }, '.character rename Thrall'],
    ['revive', { name: 'Thrall' }, '.revive Thrall'],
    ['repairitems', { name: 'Thrall' }, '.repairitems Thrall'],
    ['kick', { name: 'Thrall' }, '.kick Thrall'],
    ['mute', { name: 'Thrall', minutes: '30', reason: 'spam' }, '.mute Thrall 30 "spam"'],
    ['unmute', { name: 'Thrall' }, '.unmute Thrall'],
    ['ban', { name: 'Thrall', duration: '30d', reason: 'cheating' }, '.ban character Thrall 30d "cheating"'],
    ['unban', { name: 'Thrall', reason: 'appeal' }, '.unban character Thrall "appeal"'],
    ['hasitem', { name: 'Thrall', itemId: '12345' }, '.character hasitem 12345 Thrall'],
    ['reputation', { name: 'Thrall' }, '.character reputation Thrall'],
    ['message', { name: 'Thrall', text: 'restarting soon' }, '.send message Thrall restarting soon'],
    ['mail', { name: 'Thrall', subject: 'Hi', body: 'There' }, '.send mail Thrall "Hi" "There"'],
    ['items', { name: 'Thrall', subject: 'Hi', body: 'There', itemId: '12345', count: '1' }, '.send items Thrall "Hi" "There" 12345:1'],
    ['money', { name: 'Thrall', subject: 'Hi', body: 'There', copper: '500' }, '.send money Thrall "Hi" "There" 500'],
    ['massitems', { raceMask: 'horde', subject: 'Hi', body: 'There', itemId: '1', count: '1', confirm: 'horde' }, '.send mass items horde "Hi" "There" 1:1'],
    ['massmoney', { raceMask: 'horde', subject: 'Hi', body: 'There', copper: '5', confirm: 'horde' }, '.send mass money horde "Hi" "There" 5'],
    ['deletedrestore', { search: 'Thr', confirm: 'Thr' }, '.character deleted restore Thr'],
    ['deletedold', { keepDays: '30' }, '.character deleted old 30']
  ];

  for (const [action, payload, expected] of cases) {
    const res = await app.inject({ method: 'POST', url: `/characters/${action}`, payload });
    assert.equal(res.statusCode, 200, action);
    assert.ok(sent.includes(expected), `${action} sent ${JSON.stringify(sent.at(-1))}`);
  }
});
