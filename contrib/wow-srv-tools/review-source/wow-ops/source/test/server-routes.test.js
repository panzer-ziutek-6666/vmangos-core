import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../server/app.js';
import { createAuditLog } from '../server/audit.js';

const CONFIG = {
  soap: { user: 'ops' },
  bots: { accountPrefix: 'RNDBOT', playerSaveIntervalMs: 900000 },
  realm: { id: 1 },
  panel: { port: 80 },
  mysql: { logon: { database: 'realmd' }, characters: { database: 'characters' } }
};

function harness({ execute, logonQuery } = {}) {
  const sent = [];
  const soap = {
    execute: execute ?? (async (command) => {
      sent.push(command);
      return { ok: true, status: 'ok', output: 'done', durationMs: 2 };
    }),
    queueDepth: () => 0
  };
  const audit = createAuditLog(':memory:');
  const pools = {
    logon: { query: logonQuery ?? (async () => [[]]) },
    characters: { query: async () => [[{ c: 0 }]] }
  };
  const app = buildApp({ config: CONFIG, soap, pools, audit });
  return { app, audit, sent };
}

// The status strip's own .server info poll runs through the same fake, so a
// test asserting on what was sent has to ignore it.
const commandsSent = (sent) => sent.filter((c) => c !== '.server info');

test('the page renders, carries the htmx target, and lists the run history', async (t) => {
  const { app, audit } = harness({
    logonQuery: async (sql) => {
      if (/FROM uptime/.test(sql)) {
        return [[{ realmid: 1, starttime: 1788309225, uptime: 20470, onlineplayers: 3, maxplayers: 4, revision: '58b858214dab' }]];
      }
      return [[]];
    }
  });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/server' });
  assert.equal(res.statusCode, 200);
  // Every form on this page carries hx-target="#result"; without the element
  // htmx aborts with targetError and every button is inert in a browser.
  assert.match(res.body, /id="result"/);
  assert.match(res.body, /58b858214dab/);
  assert.match(res.body, /Run history/);
});

test('an announcement is sent verbatim and audited', async (t) => {
  const { app, audit, sent } = harness();
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({
    method: 'POST', url: '/server/announce',
    payload: { text: 'Restart in 5 minutes' }
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(commandsSent(sent), ['.announce Restart in 5 minutes']);

  const rows = audit.recent(10);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].section, 'server');
  assert.equal(rows[0].action, 'announce');
  assert.equal(rows[0].command, '.announce Restart in 5 minutes');
});

test('a rejected message never reaches the server and is never audited', async (t) => {
  const { app, audit, sent } = harness();
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'POST', url: '/server/announce', payload: { text: '' } });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(commandsSent(sent), []);
  assert.equal(audit.recent(10).length, 0);
});

test('the shutdown family refuses to fire without the typed confirmation', async (t) => {
  const { app, audit, sent } = harness();
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({
    method: 'POST', url: '/server/shutdown',
    payload: { delay: '300', confirm: 'shutdow' }
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.body, /type shutdown/i);
  assert.deepEqual(commandsSent(sent), []);
  assert.equal(audit.recent(10).length, 0);
});

test('a confirmed shutdown carries the delay and no exit code', async (t) => {
  const { app, audit, sent } = harness();
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({
    method: 'POST', url: '/server/shutdown',
    payload: { delay: '300', confirm: 'shutdown' }
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(commandsSent(sent), ['.server shutdown 300']);
});

test('each shutdown kind needs its own word typed', async (t) => {
  const { app, audit, sent } = harness();
  t.after(() => { audit.close(); return app.close(); });

  await app.inject({ method: 'POST', url: '/server/restart', payload: { delay: '60', confirm: 'shutdown' } });
  assert.deepEqual(commandsSent(sent), []);

  await app.inject({ method: 'POST', url: '/server/restart', payload: { delay: '60', confirm: 'restart' } });
  assert.deepEqual(commandsSent(sent), ['.server restart 60']);
});

test('resetallraids is confirmed too, and cancel is not', async (t) => {
  const { app, audit, sent } = harness();
  t.after(() => { audit.close(); return app.close(); });

  await app.inject({ method: 'POST', url: '/server/resetallraids', payload: {} });
  assert.deepEqual(commandsSent(sent), []);

  await app.inject({ method: 'POST', url: '/server/resetallraids', payload: { confirm: 'resetallraids' } });
  await app.inject({ method: 'POST', url: '/server/cancel', payload: {} });
  assert.deepEqual(commandsSent(sent), ['.server resetallraids', '.server shutdown cancel']);
});

test('the maintenance commands are exactly their spellings', async (t) => {
  const { app, audit, sent } = harness();
  t.after(() => { audit.close(); return app.close(); });

  await app.inject({ method: 'POST', url: '/server/saveall', payload: {} });
  await app.inject({ method: 'POST', url: '/server/corpses', payload: {} });
  await app.inject({ method: 'POST', url: '/server/plimit', payload: { value: 'gamemaster' } });
  await app.inject({ method: 'POST', url: '/server/motd', payload: {} });
  await app.inject({ method: 'POST', url: '/server/setmotd', payload: { text: 'Welcome' } });
  assert.deepEqual(commandsSent(sent), [
    '.saveall', '.server corpses', '.server plimit gamemaster', '.server motd', '.server set motd Welcome'
  ]);
});

test('an unknown action does not resolve through Object.prototype', async (t) => {
  const { app, audit, sent } = harness();
  t.after(() => { audit.close(); return app.close(); });

  for (const action of ['constructor', 'toString', 'hasOwnProperty', 'exit']) {
    const res = await app.inject({ method: 'POST', url: `/server/${action}`, payload: {} });
    assert.equal(res.statusCode, 404);
  }
  assert.deepEqual(commandsSent(sent), []);
});

test('nothing is sent while mangosd is unreachable', async (t) => {
  const sent = [];
  const { app, audit } = harness({
    execute: async (command) => {
      sent.push(command);
      return { ok: false, status: 'unreachable', output: 'connect ECONNREFUSED', durationMs: 1 };
    }
  });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'POST', url: '/server/saveall', payload: {} });
  assert.equal(res.statusCode, 503);
  assert.deepEqual(commandsSent(sent), []);
});

const REALM_ROW = {
  id: 1, name: 'VMaNGOS', address: '127.0.0.1', localAddress: '127.0.0.1',
  localSubnetMask: '255.255.255.0', port: 8085, icon: 0, realmflags: 0,
  timezone: 8, allowedSecurityLevel: 0, realmbuilds: '5875 6005 6141',
  population: 0, flag: 0
};

const REALM_FORM = {
  name: 'Second', address: '127.0.0.1', localAddress: '127.0.0.1',
  localSubnetMask: '255.255.255.0', port: '8086', icon: '1',
  timezone: '8', allowedSecurityLevel: '0', realmbuilds: '5875'
};

function realmHarness({ realms = [REALM_ROW], writeResult = { insertId: 2, affectedRows: 1 } } = {}) {
  const calls = [];
  const logonQuery = async (sql, params) => {
    calls.push({ sql, params });
    if (/FROM uptime/.test(sql)) return [[]];
    if (/^\s*SELECT/.test(sql)) return [realms];
    return [writeResult];
  };
  return { calls, ...harness({ logonQuery }) };
}

test('the registry lists realms with the labels the client shows', async (t) => {
  const { app, audit } = realmHarness();
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/server' });
  assert.match(res.body, /id="realms"/);
  assert.match(res.body, /VMaNGOS/);
  assert.match(res.body, /Normal/);
  assert.match(res.body, /English/);
  // A realmlist row is an advertisement, not a server. Say so on the page.
  assert.match(res.body, /does not start a server/i);
});

test('creating a realm inserts the normalized row and audits it', async (t) => {
  const { app, audit, calls, sent } = realmHarness();
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'POST', url: '/realms/create', payload: REALM_FORM });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /id="realms"/);

  const insert = calls.find((c) => /INSERT INTO realmlist/.test(c.sql));
  assert.ok(insert);
  assert.deepEqual(insert.params, ['Second', '127.0.0.1', '127.0.0.1', '255.255.255.0', 8086, 1, 0, 8, 0, '5875']);
  // A SQL write is not a SOAP command, and nothing was sent to the server.
  assert.deepEqual(commandsSent(sent), []);

  const rows = audit.recent(10);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].section, 'realms');
  assert.equal(rows[0].action, 'create');
  assert.match(rows[0].command, /^SQL realmlist insert /);
  assert.match(rows[0].command, /name=Second/);
});

test('an invalid field never reaches SQL and is never audited', async (t) => {
  const { app, audit, calls } = realmHarness();
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({
    method: 'POST', url: '/realms/create',
    payload: { ...REALM_FORM, localSubnetMask: '255.255.0.255' }
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.body, /contiguous/);
  // The error has to come back as the realms panel itself. These forms target
  // #realms, so answering with a #result div would replace the panel with an
  // element the next submit cannot find, and every realm button on the page
  // would go inert - the same htmx targetError that shipped in the Accounts
  // section and was caught only in a browser.
  assert.match(res.body, /id="realms"/);
  assert.equal(calls.filter((c) => /INSERT/.test(c.sql)).length, 0);
  assert.equal(audit.recent(10).length, 0);
});

test('updating passes the id last and reports when nothing matched', async (t) => {
  const { app, audit, calls } = realmHarness({ writeResult: { affectedRows: 1 } });
  t.after(() => { audit.close(); return app.close(); });

  await app.inject({ method: 'POST', url: '/realms/1/update', payload: REALM_FORM });
  const update = calls.find((c) => /UPDATE realmlist/.test(c.sql));
  assert.ok(update);
  assert.equal(update.params.at(-1), 1);

  const missing = realmHarness({ writeResult: { affectedRows: 0 } });
  t.after(() => { missing.audit.close(); return missing.app.close(); });
  const res = await missing.app.inject({ method: 'POST', url: '/realms/9/update', payload: REALM_FORM });
  assert.match(res.body, /no realm with id 9/i);
});

test('deleting needs the realm name typed, and warns about the panel realm', async (t) => {
  const { app, audit, calls } = realmHarness();
  t.after(() => { audit.close(); return app.close(); });

  const refused = await app.inject({ method: 'POST', url: '/realms/1/delete', payload: { confirm: 'wrong' } });
  assert.equal(refused.statusCode, 400);
  assert.match(refused.body, /id="realms"/);
  assert.equal(calls.filter((c) => /DELETE/.test(c.sql)).length, 0);
  assert.equal(audit.recent(10).length, 0);

  const done = await app.inject({ method: 'POST', url: '/realms/1/delete', payload: { confirm: 'VMaNGOS' } });
  assert.equal(done.statusCode, 200);
  assert.equal(calls.filter((c) => /DELETE FROM realmlist/.test(c.sql)).length, 1);
  assert.match(done.body, /realm.id in config.json|panel is configured for/i);
  const rows = audit.recent(10);
  assert.equal(rows[0].section, 'realms');
  assert.equal(rows[0].action, 'delete');
  assert.match(rows[0].command, /^SQL realmlist delete id=1 name=VMaNGOS$/);
});

test('a duplicate realm name comes back as an explanation, not a stack trace', async (t) => {
  const dupe = Object.assign(new Error("Duplicate entry 'VMaNGOS' for key 'idx_name'"), { code: 'ER_DUP_ENTRY' });
  const audit = createAuditLog(':memory:');
  const soap = {
    execute: async () => ({ ok: true, status: 'ok', output: '', durationMs: 1 }),
    queueDepth: () => 0
  };
  const pools = {
    logon: {
      query: async (sql) => {
        if (/INSERT/.test(sql)) throw dupe;
        if (/FROM uptime/.test(sql)) return [[]];
        return [[REALM_ROW]];
      }
    },
    characters: { query: async () => [[{ c: 0 }]] }
  };
  const app = buildApp({ config: CONFIG, soap, pools, audit });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'POST', url: '/realms/create', payload: REALM_FORM });
  assert.equal(res.statusCode, 400);
  assert.match(res.body, /already a realm named/i);
  assert.match(res.body, /id="realms"/);
});

test('realm routes work while mangosd is down, because they are SQL', async (t) => {
  const audit = createAuditLog(':memory:');
  const calls = [];
  const soap = {
    execute: async () => ({ ok: false, status: 'unreachable', output: 'connect ECONNREFUSED', durationMs: 1 }),
    queueDepth: () => 0
  };
  const pools = {
    logon: {
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (/FROM uptime/.test(sql)) return [[]];
        if (/^\s*SELECT/.test(sql)) return [[REALM_ROW]];
        return [{ insertId: 2 }];
      }
    },
    characters: { query: async () => [[{ c: 0 }]] }
  };
  const app = buildApp({ config: CONFIG, soap, pools, audit });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'POST', url: '/realms/create', payload: REALM_FORM });
  assert.equal(res.statusCode, 200);
  assert.equal(calls.filter((c) => /INSERT/.test(c.sql)).length, 1);
});

test('a realm id that is not a number never reaches SQL', async (t) => {
  // mysql2 serializes NaN into the query as the bare token NaN, which MySQL
  // reads as a column name: "Unknown column 'NaN' in 'where clause'". That is
  // ER_BAD_FIELD_ERROR, which app.js's handler does not classify, so it would
  // surface as a raw 500 carrying a driver message.
  const { app, audit, calls } = realmHarness();
  t.after(() => { audit.close(); return app.close(); });

  for (const url of ['/realms/abc/update', '/realms/abc/delete']) {
    const res = await app.inject({ method: 'POST', url, payload: { ...REALM_FORM, confirm: 'VMaNGOS' } });
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /id="realms"/);
    assert.match(res.body, /not a realm id/i);
  }
  assert.equal(calls.filter((c) => /UPDATE|DELETE/.test(c.sql)).length, 0);
  assert.equal(audit.recent(10).length, 0);
});

test('a row carrying flags the form cannot set says so before it clears them', async (t) => {
  // realmd keeps only OFFLINE, SPECIFYBUILD, NEW_PLAYERS and RECOMMENDED and
  // strips anything else, so the form offers no checkbox for FULL (0x80).
  // Saving such a row therefore drops that bit; the panel must not do it
  // silently.
  const { app, audit } = realmHarness({ realms: [{ ...REALM_ROW, realmflags: 0x80 }] });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/server' });
  assert.match(res.body, /flag bits 0x80/);
  assert.match(res.body, /Saving the realm clears them/);
});

test('a row with only supported flags carries no such warning', async (t) => {
  const { app, audit } = realmHarness({ realms: [{ ...REALM_ROW, realmflags: 0x40 }] });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/server' });
  assert.doesNotMatch(res.body, /flag bits 0x/);
});

test('the offline note says the registry still works', async (t) => {
  const audit = createAuditLog(':memory:');
  const soap = {
    execute: async () => ({ ok: false, status: 'unreachable', output: 'connect ECONNREFUSED', durationMs: 1 }),
    queueDepth: () => 0
  };
  const pools = {
    logon: {
      query: async (sql) => {
        if (/FROM uptime/.test(sql)) return [[]];
        return [[REALM_ROW]];
      }
    },
    characters: { query: async () => [[{ c: 0 }]] }
  };
  const app = buildApp({ config: CONFIG, soap, pools, audit });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/server' });
  assert.match(res.body, /commands on this page are disabled/);
  assert.match(res.body, /realm registry below still works/);
  // The registry's own buttons are not disabled with them.
  assert.match(res.body, /<button type="submit">Save<\/button>/);
});
