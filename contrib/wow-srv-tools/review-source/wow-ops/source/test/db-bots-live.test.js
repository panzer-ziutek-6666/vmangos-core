import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readConfigFile } from '../server/config.js';
import { createPools } from '../server/db.js';
import { countOnlineBots, countBotAccounts, listBotLocations, listSuspendedBotAccounts } from '../server/queries/bots.js';

// Strictly read-only, against the real realm databases. It creates no fixture
// tables - test/db-accounts.test.js already borrows the `logs` database for
// tables named `account` and `account_banned`, which are exactly the tables
// these queries name, and node --test runs files concurrently. Read-only means
// the two files cannot collide.
//
// It asserts shapes and invariants, never values: the bot population changes
// every second this realm is running.
const here = dirname(fileURLToPath(import.meta.url));

async function connectOrSkip(t) {
  let config;
  try {
    config = readConfigFile(join(here, '..', 'config.json'));
  } catch (err) {
    t.skip(`no usable config.json: ${err.message}`);
    return null;
  }
  const pools = createPools(config.mysql);
  try {
    await pools.logon.query('SELECT 1');
  } catch (err) {
    await pools.closeAll().catch(() => {});
    t.skip(`MySQL is not reachable: ${err.message}. Start it with ""Start MySQL.bat"" in the server directory`);
    return null;
  }
  t.after(() => pools.closeAll());
  return { config, pools };
}

test('countBotAccounts answers with a count against the real logon database', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const count = await countBotAccounts(ctx.pools, ctx.config);
  assert.ok(Number.isInteger(count) && count >= 0, `expected a non-negative integer, got ${count}`);
});

test('countOnlineBots answers with a count against the real characters database', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const count = await countOnlineBots(ctx.pools, ctx.config);
  assert.ok(count === null || (Number.isInteger(count) && count >= 0));
});

test('listBotLocations parses and returns one row per map', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const rows = await listBotLocations(ctx.pools, ctx.config);
  if (rows === null) {
    t.skip('the characters or world database is not configured in config.json');
    return;
  }
  assert.ok(Array.isArray(rows));

  const seen = new Set();
  for (const row of rows) {
    assert.ok(Number.isInteger(row.mapId), `mapId not an integer: ${row.mapId}`);
    assert.ok(Number.isInteger(row.bots) && row.bots > 0, `bots not a positive integer: ${row.bots}`);
    assert.ok(row.mapName === null || typeof row.mapName === 'string');
    // The assertion that actually proves the map_template deduplication:
    // map_template is keyed (entry, patch) and 18 entries carry several patch
    // rows on this realm, so a join on entry alone would emit the same map id
    // more than once and inflate every one of those counts.
    assert.equal(seen.has(row.mapId), false, `map ${row.mapId} appeared twice - the (entry, patch) deduplication is broken`);
    seen.add(row.mapId);
  }
});

test('listSuspendedBotAccounts parses against the real logon database', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const rows = await listSuspendedBotAccounts(ctx.pools, ctx.config);
  assert.ok(Array.isArray(rows));
  for (const row of rows) {
    assert.equal(typeof row.username, 'string');
    assert.equal(typeof row.permanent, 'boolean');
  }
});
