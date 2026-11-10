import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readConfigFile } from '../server/config.js';
import { createPools } from '../server/db.js';
import { fetchLoot, fetchDropSources } from '../server/queries/db/loot.js';

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

test('a creature whose loot_id differs from its entry is read from loot_id', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;
  const schema = config.mysql.world.database;
  const [[odd]] = await pools.world.query(
    `SELECT entry, loot_id FROM \`${schema}\`.creature_template
     WHERE loot_id <> 0 AND loot_id <> entry LIMIT 1`
  );
  assert.ok(odd, 'this realm has creatures whose loot_id is not their entry');

  const byLootId = await fetchLoot(pools.world, {
    schema, table: 'creature_loot_template', lootId: odd.loot_id, wowPatch: config.realm.wowPatch
  });
  const byEntry = await fetchLoot(pools.world, {
    schema, table: 'creature_loot_template', lootId: odd.entry, wowPatch: config.realm.wowPatch
  });
  assert.notDeepEqual(byLootId, byEntry, 'keying on entry would show the wrong loot');
});

test('reference rows are expanded, so a referencing table yields items', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;
  const schema = config.mysql.world.database;
  const [[ref]] = await pools.world.query(
    `SELECT entry FROM \`${schema}\`.creature_loot_template WHERE mincountOrRef < 0 LIMIT 1`
  );
  const rows = await fetchLoot(pools.world, {
    schema, table: 'creature_loot_template', lootId: ref.entry, wowPatch: config.realm.wowPatch
  });
  assert.ok(rows.some((r) => r.viaReference !== null), 'inherited rows are marked');
  assert.ok(rows.every((r) => Number.isInteger(r.item) && r.item > 0), 'no raw reference row survives');
});

test('a reference row that merely points at an item-shaped entry number is not a dropper', async (t) => {
  // Item 2043 is a ring on this realm. creature_loot_template has exactly one
  // row with item = 2043: entry 10819 (Baron Bloodbane), mincountOrRef =
  // -2043 - a reference row pointing at reference_loot_template entry 2043
  // (a large "any junk item" table), not a real drop of item 2043. Before the
  // `mincountOrRef > 0` fix, fetchDropSources named Baron Bloodbane as a
  // dropper of item 2043 on that coincidence of numbering alone.
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;
  const schema = config.mysql.world.database;

  const [[bogus]] = await pools.world.query(
    `SELECT entry, item, mincountOrRef FROM \`${schema}\`.creature_loot_template WHERE item = 2043`
  );
  assert.ok(bogus, 'this realm still has the reference row this test depends on');
  assert.ok(Number(bogus.mincountOrRef) < 0, 'the row this test targets must be a reference row, not a real drop');

  const [[bloodbane]] = await pools.world.query(
    `SELECT entry FROM \`${schema}\`.creature_template WHERE loot_id = ?`,
    [bogus.entry]
  );
  assert.ok(bloodbane, 'the reference row must belong to a creature template');

  const sources = await fetchDropSources(pools.world, {
    schema, table: 'creature_loot_template', item: 2043, wowPatch: config.realm.wowPatch
  });
  assert.ok(
    sources.every((s) => s.lootEntry !== bloodbane.entry),
    'a creature whose loot table only references entry 2043 does not drop item 2043'
  );
});

test('an item only reachable through a reference still names its droppers', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;
  const schema = config.mysql.world.database;
  const [[borne]] = await pools.world.query(
    `SELECT r.item FROM \`${schema}\`.reference_loot_template r
     WHERE r.item NOT IN (SELECT item FROM \`${schema}\`.creature_loot_template) LIMIT 1`
  );
  if (!borne) return t.skip('no item is reference-only on this world DB');
  const sources = await fetchDropSources(pools.world, {
    schema, table: 'creature_loot_template', item: borne.item, wowPatch: config.realm.wowPatch
  });
  assert.ok(sources.length > 0, 'the reverse hop is what finds these');
  assert.ok(sources.every((s) => s.viaReference !== null));
});
