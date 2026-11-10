import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readConfigFile } from '../server/config.js';
import { createPools } from '../server/db.js';
import { fetchCreatureSpawns } from '../server/queries/db/spawns.js';

// Read-only against the real world database: every query below is a plain
// SELECT, so nothing here can change realm state.
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
  // Registered first, and node --test runs t.after hooks in registration
  // order, so nothing below can query a closed pool.
  t.after(() => pools.closeAll());
  return { config, pools };
}

test('a template spawned only through id2 is still found', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;
  const schema = config.mysql.world.database;
  const [[row]] = await pools.world.query(
    `SELECT id2 FROM \`${schema}\`.creature WHERE id2 > 0 LIMIT 1`
  );
  assert.ok(row, 'this realm has spawns that use id2');
  const { rows, total } = await fetchCreatureSpawns(pools.world, {
    schema, entry: row.id2, wowPatch: config.realm.wowPatch, limit: 50
  });
  assert.ok(total > 0, 'a lookup on id alone would have missed this');
  assert.ok(rows.every((r) => Number.isFinite(r.x)));
});
