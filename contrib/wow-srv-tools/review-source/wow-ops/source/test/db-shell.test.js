import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderBrowserPage } from '../server/views/db/shell.js';
import { buildApp } from '../server/app.js';

const BASE = { title: 'Items', active: 'items', body: '<p>body</p>', wowPatch: 10, clientBuild: 5875, artAvailable: true };

test('the shell renders a whole document with the browser scope on it', () => {
  const html = renderBrowserPage(BASE);
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /class="db-browser"/);
  assert.match(html, /<p>body<\/p>/);
});

test('the shell states the patch and build every page is read at', () => {
  const html = renderBrowserPage(BASE);
  assert.match(html, /patch 10/);
  assert.match(html, /build 5875/);
});

test('the active nav entry is marked and the others are not', () => {
  const html = renderBrowserPage(BASE);
  assert.match(html, /class="nav-item active"[^>]*href="\/db\/items"/);
  assert.doesNotMatch(html, /class="nav-item active"[^>]*href="\/db\/itemsets"/);
});

// The panel's status strip polls mangosd every five seconds. A reference page
// has nothing to say about whether the realm is up, and the strip costs a SOAP
// round trip per page render.
test('the browser carries no status strip and no SOAP-backed markup', () => {
  const html = renderBrowserPage(BASE);
  assert.doesNotMatch(html, /id="status"/);
  assert.doesNotMatch(html, /hx-get="\/status"/);
});

test('a missing asset root is stated on the page rather than left as empty frames', () => {
  const html = renderBrowserPage({ ...BASE, artAvailable: false });
  assert.match(html, /extract-art/);
});

test('GET /db with artAvailable true omits the art extraction note from the response', async (t) => {
  // artAvailable is real now (server/app.js), not the Task 1 placeholder, so
  // this needs an actual asset root with an icons/ directory to be true.
  const root = await mkdtemp(join(tmpdir(), 'wow-ops-art-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'icons'), { recursive: true });

  const CONFIG = {
    panel: { port: 8099 },
    soap: { host: '127.0.0.1', port: 7878, user: 'ADMIN', pass: 'x' },
    mysql: { logon: { database: 'realmd' }, world: { database: 'mangos' } },
    bots: { accountPrefix: 'RNDBOT', playerSaveIntervalMs: 900000 },
    realm: { id: 1, wowPatch: 10, clientBuild: 5875 },
    characters: { charDeleteMethod: 0 }, events: { wowPatch: 10 },
    assets: { root }
  };
  const pools = { logon: { query: async () => [[]] } };
  const soap = {
    execute: async () => ({ ok: false, output: 'offline', status: 'error', durationMs: 1 }),
    queueDepth: () => 0
  };
  const audit = { record: () => 1, recent: () => [] };
  const app = buildApp({ config: CONFIG, soap, pools, audit });
  t.after(() => app.close());

  const HEADERS = { host: '127.0.0.1:8099' };
  const res = await app.inject({ method: 'GET', url: '/db', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /extract-art/);
});
