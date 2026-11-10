import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readConfigFile } from '../server/config.js';
import { createPools } from '../server/db.js';
import { fetchTemplateRow } from '../server/queries/db/progressive.js';

// Read-only against the real world database: every query here is a SELECT.
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

test('a quest with patch variants resolves to the row the server loaded', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;

  // Pick a real entry with more than one patch row rather than hardcoding
  // one: the world DB comes from a released dump and its contents can change.
  const [[variant]] = await pools.world.query(
    `SELECT entry FROM \`${config.mysql.world.database}\`.quest_template
     GROUP BY entry HAVING COUNT(*) > 1 LIMIT 1`
  );
  assert.ok(variant, 'expected at least one quest entry with patch variants');

  const found = await fetchTemplateRow(pools.world, {
    schema: config.mysql.world.database,
    table: 'quest_template',
    entry: variant.entry,
    wowPatch: config.realm.wowPatch
  });

  assert.ok(found.patches.length > 1, 'the entry should report its variants');
  assert.ok(found.patch <= config.realm.wowPatch, 'never a patch above the running one');
  assert.equal(found.patch, Math.max(...found.patches.filter((p) => p <= config.realm.wowPatch)));
});

test('an entry that does not exist comes back null', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;

  const found = await fetchTemplateRow(pools.world, {
    schema: config.mysql.world.database, table: 'creature_template',
    entry: 99999999, wowPatch: config.realm.wowPatch
  });
  assert.equal(found, null);
});
