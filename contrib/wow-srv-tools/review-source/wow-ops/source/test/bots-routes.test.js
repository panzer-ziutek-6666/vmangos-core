import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../server/app.js';
import { createAuditLog } from '../server/audit.js';

// 80 matches the Host header Fastify's inject() sends by default, which the
// Host/Origin guard in server/app.js checks - see test/accounts-routes.test.js.
const CONFIG = {
  soap: { user: 'ops' },
  bots: { accountPrefix: 'RNDBOT', playerSaveIntervalMs: 900000 },
  realm: { id: 1 },
  panel: { port: 80 },
  mysql: {
    logon: { database: 'realmd' },
    characters: { database: 'characters' },
    world: { database: 'mangos' }
  }
};

function harness({ logonQuery, charactersQuery, config = CONFIG } = {}) {
  const soap = {
    execute: async () => ({ ok: true, status: 'ok', output: 'Players online: 1\nServer uptime: 5 Minute(s)', durationMs: 1 }),
    queueDepth: () => 0
  };
  const audit = createAuditLog(':memory:');
  const pools = {
    logon: { query: logonQuery ?? (async () => [[]]) },
    characters: { query: charactersQuery ?? (async () => [[]]) }
  };
  const app = buildApp({ config, soap, pools, audit });
  return { app, audit };
}

// The logon pool serves two different queries in this section (the account
// count and the suspension list). Route them by the SQL they carry rather
// than by call order, so a test does not break when the section changes the
// order it issues them in.
function logonRouter({ botAccounts = 120, suspended = [] } = {}) {
  return async (sql) => {
    if (/account_banned/.test(sql)) return [suspended];
    return [[{ c: botAccounts }]];
  };
}

test('the page renders the four panels', async (t) => {
  const { app, audit } = harness({
    logonQuery: logonRouter({ botAccounts: 120 }),
    charactersQuery: async (sql) => {
      if (/map_template/.test(sql)) {
        return [[{ map_id: 0, map_name: 'Eastern Kingdoms', map_type: 0, bots: 392 },
                 { map_id: 529, map_name: 'Arathi Basin', map_type: 3, bots: 94 }]];
      }
      return [[{ c: 486 }]];
    }
  });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/bots' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Eastern Kingdoms/);
  assert.match(res.body, /Arathi Basin/);
  assert.match(res.body, /Battlegrounds/);
});

test('accounts and online characters are labelled as different figures', async (t) => {
  const { app, audit } = harness({
    logonQuery: logonRouter({ botAccounts: 120 }),
    charactersQuery: async (sql) => (/map_template/.test(sql) ? [[]] : [[{ c: 1000 }]])
  });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/bots' });
  // One account drives several bots at once, so the page must never present
  // 120 and 1000 as the same quantity or add them together.
  assert.match(res.body, /bot accounts/i);
  assert.match(res.body, /bot characters online/i);
  assert.match(res.body, /120/);
  assert.match(res.body, /1000/);
  assert.doesNotMatch(res.body, /1120/);
});

test('the breakdown carries an explicit staleness bound', async (t) => {
  const { app, audit } = harness({ logonQuery: logonRouter() });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/bots' });
  assert.match(res.body, /as of last save/i);
  assert.match(res.body, /15 minutes/);
});

test('the staleness bound follows the configured interval', async (t) => {
  const config = { ...CONFIG, bots: { accountPrefix: 'RNDBOT', playerSaveIntervalMs: 120000 } };
  const { app, audit } = harness({ config, logonQuery: logonRouter() });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/bots' });
  assert.match(res.body, /2 minutes/);
});

test('a sub-minute interval still reads as at least 1 minute, singular', async (t) => {
  const config = { ...CONFIG, bots: { accountPrefix: 'RNDBOT', playerSaveIntervalMs: 10000 } };
  const { app, audit } = harness({ config, logonQuery: logonRouter() });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/bots' });
  // Math.round(10000 / 60000) is 0, which would otherwise print "up to 0
  // minutes behind" - the opposite of what this sentence exists to say.
  assert.match(res.body, /up to 1 minute behind/);
  assert.doesNotMatch(res.body, /0 minutes/);
});

test('a config missing the player-save interval falls back to a sane default instead of NaN', async (t) => {
  const config = { ...CONFIG, bots: { accountPrefix: 'RNDBOT' } };
  const { app, audit } = harness({ config, logonQuery: logonRouter() });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/bots' });
  assert.doesNotMatch(res.body, /NaN/);
  assert.match(res.body, /15 minutes/);
});

test('the page explains that it has no controls and why', async (t) => {
  const { app, audit } = harness({ logonQuery: logonRouter() });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/bots' });
  assert.match(res.body, /no controls/i);
  assert.match(res.body, /\.bot/);
  // Nothing on this page may post anywhere or accept input - it is a
  // read-only section, so no form, no button (including an htmx
  // hx-post-only button with no <form> around it), and no bare <input>.
  assert.doesNotMatch(res.body, /<form/);
  assert.doesNotMatch(res.body, /<button/);
  assert.doesNotMatch(res.body, /<input/);
  assert.doesNotMatch(res.body, /hx-post/);
});

test('a GET of the page writes no audit row', async (t) => {
  const { app, audit } = harness({ logonQuery: logonRouter() });
  t.after(() => { audit.close(); return app.close(); });

  await app.inject({ method: 'GET', url: '/bots' });
  // This section is read-only: it sends no SOAP command, so there is nothing
  // for it to legitimately record. An audit row appearing here would mean
  // some code path treated a read as an action.
  assert.equal(audit.recent(10).length, 0);
});

test('a missing world database degrades to a note, not a broken page', async (t) => {
  const config = { ...CONFIG, mysql: { logon: { database: 'realmd' }, characters: { database: 'characters' } } };
  const { app, audit } = harness({ config, logonQuery: logonRouter() });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/bots' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /world database/i);
  assert.match(res.body, /bot accounts/i);
});

test('one failing query does not blank the other panels', async (t) => {
  const { app, audit } = harness({
    logonQuery: logonRouter({ botAccounts: 120 }),
    charactersQuery: async () => { throw new Error('Table characters.characters doesn\'t exist'); }
  });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/bots' });
  // The panel-level catch is the point: without it app.js's error handler
  // would replace the whole page with a 503, hiding the panels that worked.
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /120/);
  assert.match(res.body, /doesn&#39;t exist/);
});

test('a rejection that is not an Error still degrades to a panel note, not a 503', async (t) => {
  const { app, audit } = harness({
    logonQuery: logonRouter({ botAccounts: 120 }),
    // A thrown string (or any non-Error) has no .message. settle() must still
    // produce a string .error, or isError() in the view fails to recognise
    // it, falls through every render branch, and throws on the raw value -
    // which is exactly the containment hole this test pins.
    charactersQuery: async () => { throw 'connection reset'; }
  });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/bots' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /120/);
  assert.match(res.body, /connection reset/);
});

test('an Error with an empty message still produces a visible, non-empty error note', async (t) => {
  const { app, audit } = harness({
    logonQuery: logonRouter({ botAccounts: 120 }),
    // `new Error('')` has a .message that is the empty string, not nullish -
    // the regression this test pins is settle() using `??` instead of `||`
    // and letting that empty string through as-is, which renders a blank,
    // unexplained <p class="error"></p> that tells the operator nothing.
    charactersQuery: async () => { throw new Error(''); }
  });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/bots' });
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /<p class="error"><\/p>/);
  assert.match(res.body, /<p class="error">\S/);
});

test('an empty suspension list renders as an explicit none', async (t) => {
  const { app, audit } = harness({ logonQuery: logonRouter({ suspended: [] }) });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/bots' });
  assert.match(res.body, /No bot accounts are suspended/i);
});

test('a suspended bot account is listed with its ban', async (t) => {
  const suspended = [{ id: 7, username: 'RNDBOT7', bandate: 1000, unbandate: 1000, bannedby: 'ADMIN', banreason: 'wedged in a wall' }];
  const { app, audit } = harness({ logonQuery: logonRouter({ suspended }) });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/bots' });
  assert.match(res.body, /RNDBOT7/);
  assert.match(res.body, /wedged in a wall/);
  assert.match(res.body, /permanent/i);
});

test('operator-typed text in a suspension row is escaped, not injected', async (t) => {
  const suspended = [{
    id: 8,
    username: 'RNDBOT8<script>',
    bandate: 1000,
    unbandate: 1000,
    bannedby: 'ADMIN & CO',
    banreason: '<script>alert("x")</script>'
  }];
  const { app, audit } = harness({ logonQuery: logonRouter({ suspended }) });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/bots' });
  assert.match(res.body, /RNDBOT8&lt;script&gt;/);
  assert.match(res.body, /ADMIN &amp; CO/);
  assert.match(res.body, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(res.body, /<script>/);
});

test('the nav carries a Bots link and marks it active on this page', async (t) => {
  const { app, audit } = harness({ logonQuery: logonRouter() });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/bots' });
  assert.match(res.body, /<a class="nav-item active" href="\/bots">Bots<\/a>/);
});

test('a map id the world DB does not know still shows its bots', async (t) => {
  const { app, audit } = harness({
    logonQuery: logonRouter(),
    charactersQuery: async (sql) => (/map_template/.test(sql)
      ? [[{ map_id: 4242, map_name: null, map_type: null, bots: 3 }]]
      : [[{ c: 3 }]])
  });
  t.after(() => { audit.close(); return app.close(); });

  const res = await app.inject({ method: 'GET', url: '/bots' });
  assert.match(res.body, /Unknown maps/);
  assert.match(res.body, /4242/);
});
