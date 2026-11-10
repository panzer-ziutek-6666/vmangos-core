import test from 'node:test';
import assert from 'node:assert/strict';
import { dbApp, HEADERS } from './helpers/dbApp.js';
import { dbStubPool } from './helpers/dbStubPool.js';

const ROW = { entry: 133, name: 'Fireball', nameSubtext: 'Rank 1', spellLevel: 1, school: 2, spellIconId: 185, castingTimeIndex: 16, recoveryTime: 0, categoryRecoveryTime: 0, total: 1 };
function harness() {
  const stub = dbStubPool({ spell_template: [ROW], skill_line_ability: [{ spell_id: 133, skill_id: 8 }] });
  return { ...dbApp({ world: stub.pool }), stub };
}

test('GET /db/spells renders the whole page with Spells active and no SOAP call', async (t) => {
  const { app, executeCalls } = harness();
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/spells', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /class="nav-item active" href="\/db\/spells"/);
  assert.match(res.body, /Fireball/);
  assert.equal(executeCalls(), 0);
});

test('with HX-Request it returns the fragment; a history restore gets the whole page', async (t) => {
  const { app } = harness();
  t.after(() => app.close());
  const frag = await app.inject({ method: 'GET', url: '/db/spells?q=fire', headers: { ...HEADERS, 'hx-request': 'true' } });
  assert.doesNotMatch(frag.body, /<!doctype html>/i);
  assert.match(frag.headers.vary, /HX-Request/);
  const restore = await app.inject({ method: 'GET', url: '/db/spells', headers: { ...HEADERS, 'hx-request': 'true', 'hx-history-restore-request': 'true' } });
  assert.match(restore.body, /class="db-browser"/);
  assert.match(restore.body, /<form[^>]*hx-get="\/db\/spells"/);
});

test('without a world database the page explains itself', async (t) => {
  const { app } = dbApp({ world: null });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/spells', headers: HEADERS });
  assert.match(res.body, /not configured/);
});
