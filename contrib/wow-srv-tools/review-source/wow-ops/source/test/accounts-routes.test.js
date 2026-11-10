import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../server/app.js';
import { createAuditLog } from '../server/audit.js';

function harness({ soapResult, accounts = [] } = {}) {
  const sent = [];
  const soap = {
    execute: async (command) => {
      sent.push(command);
      if (command === '.server info') {
        return { ok: true, status: 'ok', output: 'Players online: 1\nServer uptime: 5 Minute(s)', durationMs: 1 };
      }
      if (command === '.bot info') {
        return { ok: true, status: 'ok', output: 'Loading : 0, Online : 12, Chat : 0', durationMs: 1 };
      }
      return soapResult ?? { ok: true, status: 'ok', output: 'Account created: TOMEK', durationMs: 7 };
    },
    queueDepth: () => 0
  };
  const audit = createAuditLog(':memory:');
  // 80 matches the Host header (`localhost:80`) that Fastify's `inject()`
  // sends by default when a test does not set one explicitly - see the
  // Host/Origin/Sec-Fetch-Site guard in server/app.js.
  const config = { soap: { user: 'ops' }, bots: { accountPrefix: 'RNDBOT' }, realm: { id: 1 }, panel: { port: 80 }, mysql: {} };
  const pools = { logon: { query: async () => [accounts] } };
  const app = buildApp({ config, soap, pools, audit });
  return { app, soap, sent, audit };
}

function unreachableHarness({ accounts = [] } = {}) {
  const sent = [];
  const soap = {
    execute: async (command) => {
      sent.push(command);
      return { ok: false, status: 'unreachable', output: 'Cannot reach mangosd at 127.0.0.1:7878', durationMs: 1 };
    },
    queueDepth: () => 0
  };
  const audit = createAuditLog(':memory:');
  const config = { soap: { user: 'ops' }, bots: { accountPrefix: 'RNDBOT' }, realm: { id: 1 }, panel: { port: 80 }, mysql: {} };
  const pools = { logon: { query: async () => [accounts] } };
  const app = buildApp({ config, soap, pools, audit });
  return { app, soap, sent, audit };
}

const ROW = {
  id: 1, username: 'TOMEK', gmlevel: 4, online: 1, last_login: null, last_ip: '127.0.0.1',
  locked: 0, mutetime: 0,
  ban_active: null, ban_reason: null, ban_unbandate: null, ban_bandate: null
};

test('the list renders accounts', async (t) => {
  const { app, audit } = harness({ accounts: [ROW] });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/accounts' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /TOMEK/);
  assert.match(res.body, /class="nav-item active"[^>]*href="\/accounts"/);
});

test('creating an account sends the built command and audits it', async (t) => {
  const { app, sent, audit } = harness({ accounts: [ROW] });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({
    method: 'POST', url: '/accounts/create',
    payload: new URLSearchParams({ name: 'FRIEND', pass: 'hunter2' }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });

  assert.equal(res.statusCode, 200);
  assert.ok(sent.includes('.account create FRIEND hunter2'));
  assert.match(res.body, /Account created: TOMEK/);

  const [row] = audit.recent();
  assert.equal(row.command, '.account create FRIEND <redacted>');
  assert.equal(row.action, 'create');
  assert.equal(row.status, 'ok');
});

test('the real password reaches SOAP while the audit row and the rendered fragment are redacted', async (t) => {
  const { app, sent, audit } = harness({ accounts: [ROW] });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({
    method: 'POST', url: '/accounts/create',
    payload: new URLSearchParams({ name: 'FRIEND', pass: 'hunter2' }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });

  assert.equal(res.statusCode, 200);
  // The SOAP client is the only place the real password may appear.
  assert.ok(sent.includes('.account create FRIEND hunter2'));

  const [row] = audit.recent();
  assert.equal(row.command, '.account create FRIEND <redacted>');
  assert.doesNotMatch(row.command, /hunter2/);

  // The rendered fragment HTML-escapes the command, so the placeholder shows as &lt;redacted&gt;.
  assert.match(res.body, /\.account create FRIEND &lt;redacted&gt;/);
  assert.doesNotMatch(res.body, /hunter2/);
});

test('setting a password sends both real passwords to SOAP but redacts both in the audit log and the rendered fragment', async (t) => {
  const { app, sent, audit } = harness({ accounts: [ROW] });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({
    method: 'POST', url: '/accounts/password',
    payload: new URLSearchParams({ name: 'FRIEND', pass: 'hunter2' }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });

  assert.equal(res.statusCode, 200);
  assert.ok(sent.includes('.account set password FRIEND hunter2 hunter2'));

  const [row] = audit.recent();
  assert.equal(row.command, '.account set password FRIEND <redacted> <redacted>');
  assert.doesNotMatch(row.command, /hunter2/);

  assert.match(res.body, /\.account set password FRIEND &lt;redacted&gt; &lt;redacted&gt;/);
  assert.doesNotMatch(res.body, /hunter2/);
});

test('a validation failure never reaches SOAP and is not audited', async (t) => {
  const { app, sent, audit } = harness({ accounts: [ROW] });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({
    method: 'POST', url: '/accounts/create',
    payload: new URLSearchParams({ name: 'FRIEND', pass: 'two words' }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.body, /password contains whitespace/);
  assert.equal(sent.filter((c) => c.startsWith('.account')).length, 0);
  assert.equal(audit.recent().length, 0);
});

test('a bad ban duration is refused before it becomes a permanent ban', async (t) => {
  const { app, sent, audit } = harness({ accounts: [ROW] });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({
    method: 'POST', url: '/accounts/ban',
    payload: new URLSearchParams({ name: 'FRIEND', duration: '30', reason: 'spam' }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.body, /duration must be digits/);
  assert.equal(sent.filter((c) => c.startsWith('.ban')).length, 0);
});

test('deleting requires the typed confirmation to match', async (t) => {
  const { app, sent, audit } = harness({ accounts: [ROW] });
  t.after(() => { audit.close(); return app.close(); });

  const wrong = await app.inject({
    method: 'POST', url: '/accounts/delete',
    payload: new URLSearchParams({ name: 'FRIEND', confirm: 'FRIEN' }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });
  assert.equal(wrong.statusCode, 400);
  assert.match(wrong.body, /type the account name/i);
  assert.equal(sent.filter((c) => c.startsWith('.account delete')).length, 0);

  const right = await app.inject({
    method: 'POST', url: '/accounts/delete',
    payload: new URLSearchParams({ name: 'FRIEND', confirm: 'FRIEND' }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });
  assert.equal(right.statusCode, 200);
  assert.ok(sent.includes('.account delete FRIEND'));
});

test('unban requires a reason, since the core silently no-ops without one', async (t) => {
  const { app, sent, audit } = harness({ accounts: [ROW] });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({
    method: 'POST', url: '/accounts/unban',
    payload: new URLSearchParams({ name: 'FRIEND' }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.body, /reason is required/);
  assert.equal(sent.filter((c) => c.startsWith('.unban')).length, 0);
  assert.equal(audit.recent().length, 0);
});

test('a failed command shows the core message verbatim and is audited as failed', async (t) => {
  const { app, audit } = harness({
    accounts: [ROW],
    soapResult: { ok: false, status: 'failed', output: 'There is no such account.', durationMs: 3 }
  });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({
    method: 'POST', url: '/accounts/unban',
    payload: new URLSearchParams({ name: 'NOBODY', reason: 'appeal accepted' }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });

  assert.equal(res.statusCode, 200);
  assert.match(res.body, /There is no such account\./);
  assert.match(res.body, /class="output failed"/);
  assert.equal(audit.recent()[0].status, 'failed');
});

test('unbanning sends the two-argument command with the quoted reason', async (t) => {
  const { app, sent, audit } = harness({ accounts: [ROW] });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({
    method: 'POST', url: '/accounts/unban',
    payload: new URLSearchParams({ name: 'FRIEND', reason: 'appeal accepted' }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });

  assert.equal(res.statusCode, 200);
  assert.ok(sent.includes('.unban account FRIEND "appeal accepted"'));
});

test('a timeout is audited and never retried', async (t) => {
  const { app, sent, audit } = harness({
    accounts: [ROW],
    soapResult: { ok: false, status: 'timeout', output: 'No response within 10000 ms.', durationMs: 10000 }
  });
  t.after(() => { audit.close(); return app.close(); });

  await app.inject({
    method: 'POST', url: '/accounts/gmlevel',
    payload: new URLSearchParams({ name: 'FRIEND', level: '2' }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });

  assert.equal(sent.filter((c) => c.startsWith('.account set gmlevel')).length, 1);
  assert.equal(audit.recent()[0].status, 'timeout');
});

test('an unknown action is rejected', async (t) => {
  const { app, audit } = harness({ accounts: [ROW] });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({
    method: 'POST', url: '/accounts/nonsense',
    payload: new URLSearchParams({ name: 'FRIEND' }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });
  assert.equal(res.statusCode, 404);
});

test('the command that was sent is shown alongside its output, with the password redacted', async (t) => {
  const { app, audit } = harness({ accounts: [ROW] });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({
    method: 'POST', url: '/accounts/create',
    payload: new URLSearchParams({ name: 'FRIEND', pass: 'hunter2' }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });
  assert.match(res.body, /\.account create FRIEND &lt;redacted&gt;/);
  assert.doesNotMatch(res.body, /hunter2/);
});

// --- Finding 1: a fresh GET /accounts must always carry an element every
// form's hx-target="#result" can resolve, or htmx refuses to ever issue the
// POST in a real browser. ---

test('a fresh GET /accounts contains id="result" so htmx can target it', async (t) => {
  const { app, audit } = harness({ accounts: [ROW] });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/accounts' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /id="result"/);
  // Every form's target must actually resolve against this page.
  const targetCount = (res.body.match(/hx-target="#result"/g) ?? []).length;
  assert.ok(targetCount >= 6, 'all six action forms are present');
});

test('a POST response still returns a populated #result fragment', async (t) => {
  const { app, audit } = harness({ accounts: [ROW] });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({
    method: 'POST', url: '/accounts/create',
    payload: new URLSearchParams({ name: 'FRIEND', pass: 'hunter2' }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /id="result"/);
  assert.match(res.body, /Sent: <code class="command">/);
});

// --- Finding 2: cross-origin and DNS-rebinding requests are rejected in
// server/app.js's onRequest hook, before any route runs. ---

test('a POST with a foreign Origin is rejected 403 and sends no command', async (t) => {
  const { app, sent, audit } = harness({ accounts: [ROW] });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({
    method: 'POST', url: '/accounts/delete',
    payload: new URLSearchParams({ name: 'FRIEND', confirm: 'FRIEND' }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example' }
  });

  assert.equal(res.statusCode, 403);
  assert.equal(sent.length, 0, 'nothing - not even a status poll - is sent before the request is rejected');
  assert.equal(audit.recent().length, 0);
});

test('a POST with no Origin header and Sec-Fetch-Site: same-origin succeeds', async (t) => {
  const { app, sent, audit } = harness({ accounts: [ROW] });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({
    method: 'POST', url: '/accounts/create',
    payload: new URLSearchParams({ name: 'FRIEND', pass: 'hunter2' }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin' }
  });

  assert.equal(res.statusCode, 200);
  assert.ok(sent.includes('.account create FRIEND hunter2'));
});

test('a POST whose Origin matches the panel itself succeeds', async (t) => {
  const { app, sent, audit } = harness({ accounts: [ROW] });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({
    method: 'POST', url: '/accounts/create',
    payload: new URLSearchParams({ name: 'FRIEND', pass: 'hunter2' }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost:80' }
  });

  assert.equal(res.statusCode, 200);
  assert.ok(sent.includes('.account create FRIEND hunter2'));
});

test('a request with a foreign Host header is rejected 403 (DNS rebinding)', async (t) => {
  const { app, sent, audit } = harness({ accounts: [ROW] });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({
    method: 'GET', url: '/accounts',
    headers: { host: 'evil.example' }
  });

  assert.equal(res.statusCode, 403);
  assert.equal(sent.length, 0);
});

// --- Finding 3: an action name reached only through Object.prototype must
// not resolve to anything runnable, and a repeated form field must not
// silently coerce into a valid gm level. ---

test('prototype-chain action names are rejected as unknown, not executed', async (t) => {
  const { app, sent, audit } = harness({ accounts: [ROW] });
  t.after(() => { audit.close(); return app.close(); });

  for (const action of ['constructor', 'toString', 'hasOwnProperty']) {
    const res = await app.inject({
      method: 'POST', url: `/accounts/${action}`,
      payload: new URLSearchParams({ name: 'FRIEND' }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    });
    assert.equal(res.statusCode, 404, `action=${action}`);
  }
  assert.equal(sent.length, 0, 'no command, not even [object Object], was ever sent');
  assert.equal(audit.recent().length, 0);
});

test('a repeated level field is refused, not silently coerced to a single value', async (t) => {
  const { app, sent, audit } = harness({ accounts: [ROW] });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({
    method: 'POST', url: '/accounts/gmlevel',
    payload: 'name=FRIEND&level=3&level=9',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.body, /gm level must be an integer from 0 to 6/);
  assert.equal(sent.filter((c) => c.startsWith('.account set gmlevel')).length, 0);
  assert.equal(audit.recent().length, 0);
});

// --- Finding 4: the offline banner's claim ("commands are disabled") must
// actually be enforced, both in the rendered page and server-side. ---

test('the accounts page disables every action button when mangosd is unreachable', async (t) => {
  const { app, audit } = unreachableHarness({ accounts: [ROW] });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/accounts' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<button type="submit" disabled>Create<\/button>/);
  assert.match(res.body, /<button type="submit" disabled>Delete permanently<\/button>/);
  assert.match(res.body, /mangosd is not reachable; commands are disabled/);
});

test('the accounts page does not disable action buttons when mangosd is reachable', async (t) => {
  const { app, audit } = harness({ accounts: [ROW] });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/accounts' });
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /<button type="submit" disabled>/);
});

test('a POST is refused with 503 when SOAP is unreachable, and nothing is audited', async (t) => {
  const { app, sent, audit } = unreachableHarness({ accounts: [ROW] });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({
    method: 'POST', url: '/accounts/delete',
    payload: new URLSearchParams({ name: 'FRIEND', confirm: 'FRIEND' }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });

  assert.equal(res.statusCode, 503);
  assert.equal(sent.filter((c) => c.startsWith('.account delete')).length, 0);
  assert.equal(audit.recent().length, 0);
});

// --- Finding 6: unbandate (epoch seconds) and last_login (a JS Date) must
// render as readable local timestamps, not a raw epoch integer or a
// verbose Date#toString() with a timezone name. ---

test('ban expiry and last login render as readable dates', async (t) => {
  const bannedRow = {
    ...ROW,
    username: 'FRIEND',
    last_login: new Date('2026-08-29T22:12:18+02:00'),
    ban_active: 1,
    ban_permanent: false,
    ban_reason: 'spam',
    ban_unbandate: 1790592000
  };
  const { app, audit } = harness({ accounts: [bannedRow] });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/accounts' });
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /until 1790592000/);
  assert.doesNotMatch(res.body, /GMT/);
  assert.match(res.body, /until \d{4}-\d{2}-\d{2} \d{2}:\d{2}: spam/);
  assert.match(res.body, /<td>\d{4}-\d{2}-\d{2} \d{2}:\d{2}<\/td>/);
});

test('an account with no last_login renders the placeholder, not "null"', async (t) => {
  const { app, audit } = harness({ accounts: [{ ...ROW, last_login: null }] });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/accounts' });
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, />null</);
  assert.match(res.body, /<td>—<\/td>/);
});

// --- Finding 7: the operator must be warned in the rendered fragment when
// the audit write itself failed, since the action still happened. ---

test('warns in the rendered fragment when the audit write itself failed', async (t) => {
  const sent = [];
  const soap = {
    execute: async (command) => {
      sent.push(command);
      if (command === '.server info') {
        return { ok: true, status: 'ok', output: 'Players online: 1\nServer uptime: 5 Minute(s)', durationMs: 1 };
      }
      if (command === '.bot info') {
        return { ok: true, status: 'ok', output: 'Loading : 0, Online : 12, Chat : 0', durationMs: 1 };
      }
      return { ok: true, status: 'ok', output: 'Account created: FRIEND', durationMs: 3 };
    },
    queueDepth: () => 0
  };
  // A stub that mimics audit.js's own contract: record() returns null on a
  // write failure instead of throwing.
  const audit = { record: () => null, recent: () => [], close: () => {} };
  const config = { soap: { user: 'ops' }, bots: { accountPrefix: 'RNDBOT' }, realm: { id: 1 }, panel: { port: 80 }, mysql: {} };
  const pools = { logon: { query: async () => [[ROW]] } };
  const app = buildApp({ config, soap, pools, audit });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST', url: '/accounts/create',
    payload: new URLSearchParams({ name: 'FRIEND', pass: 'hunter2' }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });

  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Account created: FRIEND/);
  assert.match(res.body, /was NOT recorded in the audit log/i);
});

// --- Finding 3: the same hook must not reject a plain cross-site link to the
// panel. A top-level GET navigation arrives with Sec-Fetch-Site: cross-site
// whenever the operator reaches a page from anything but the panel itself or
// the address bar, and it is not a CSRF vector: every mutating route is a
// POST, and a cross-origin navigation gives the other page no read of the
// response. ---

test('a cross-site top-level GET navigation is served', async (t) => {
  const { app, audit } = harness({ accounts: [ROW] });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({
    method: 'GET', url: '/accounts',
    headers: {
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document'
    }
  });

  assert.equal(res.statusCode, 200);
});

test('a cross-site POST is still rejected 403 and sends no command', async (t) => {
  const { app, sent, audit } = harness({ accounts: [ROW] });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({
    method: 'POST', url: '/accounts/delete',
    payload: new URLSearchParams({ name: 'FRIEND', confirm: 'FRIEND' }).toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document'
    }
  });

  assert.equal(res.statusCode, 403);
  assert.equal(sent.length, 0);
  assert.equal(audit.recent().length, 0);
});

test('a cross-site GET that is not a navigation is still rejected 403', async (t) => {
  const { app, audit } = harness({ accounts: [ROW] });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({
    method: 'GET', url: '/accounts',
    headers: {
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty'
    }
  });

  assert.equal(res.statusCode, 403);
});
