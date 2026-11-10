import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../server/app.js';

const CONFIG = {
  panel: { port: 8099 },
  soap: { host: '127.0.0.1', port: 7878, user: 'ADMIN', pass: 'x' },
  mysql: { logon: { database: 'realmd' }, world: { database: 'mangos' } },
  bots: { accountPrefix: 'RNDBOT', playerSaveIntervalMs: 900000 },
  realm: { id: 1, wowPatch: 10, clientBuild: 5875 },
  characters: { charDeleteMethod: 0 }, events: { wowPatch: 10 }
};

const HEADERS = { host: '127.0.0.1:8099' };

function appWith(config) {
  const pools = { world: { query: async () => [[]] }, logon: { query: async () => [[]] } };
  // queueDepth is not optional: the status strip on every page calls it
  // (server/status.js:54), so a stub without it makes each route render the
  // error page instead of the section.
  const soap = {
    execute: async () => ({ ok: false, output: 'offline', status: 'error', durationMs: 1 }),
    queueDepth: () => 0
  };
  const audit = { record: () => 1, recent: () => [] };
  return buildApp({ config, soap, pools, audit });
}

// The panel boots with no art root configured at all - a fresh clone has never
// run the extractor - and must still serve every page.
test('an absent asset root leaves the panel working and says so', async (t) => {
  const app = appWith({ ...CONFIG, assets: undefined });
  t.after(() => app.close());
  assert.equal(app.deps.artAvailable, false);
  const res = await app.inject({ method: 'GET', url: '/db', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /extract-art/);
});

test('a configured asset root is served read-only under /db/art/', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wow-ops-art-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'icons'), { recursive: true });
  await writeFile(join(root, 'icons', 'INV_Sword_39.png'), 'not really a png');

  const app = appWith({ ...CONFIG, assets: { root } });
  t.after(() => app.close());
  assert.equal(app.deps.artAvailable, true);

  const res = await app.inject({ method: 'GET', url: '/db/art/icons/INV_Sword_39.png', headers: HEADERS });
  assert.equal(res.statusCode, 200);

  const missing = await app.inject({ method: 'GET', url: '/db/art/icons/nothing-here.png', headers: HEADERS });
  assert.equal(missing.statusCode, 404);
});
