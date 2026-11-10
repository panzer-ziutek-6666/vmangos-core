import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readConfigFile } from '../server/config.js';
import { createPools } from '../server/db.js';
import { loadCreature } from '../server/queries/db/creature.js';

// Read-only against the real world database: loadCreature issues nothing but
// SELECTs, so nothing here can change realm state.
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

test('a creature with loot resolves a non-empty list with every item named', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;
  const schema = config.mysql.world.database;
  const [[hit]] = await pools.world.query(
    `SELECT entry FROM \`${schema}\`.creature_template WHERE loot_id <> 0 LIMIT 1`
  );
  assert.ok(hit, 'this realm has a creature template with a loot_id');

  const data = await loadCreature(pools, config, hit.entry);
  assert.ok(data, `creature ${hit.entry} should load`);
  assert.ok(data.loot.length > 0, `creature ${hit.entry} should have loot rows`);
  for (const row of data.loot) {
    assert.ok(data.names.item.has(row.item), `item ${row.item} should resolve to a name`);
  }
});

test('a creature whose loot_id differs from its entry shows the loot_id table, not the entry', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;
  const schema = config.mysql.world.database;
  const [[odd]] = await pools.world.query(
    `SELECT entry, loot_id FROM \`${schema}\`.creature_template WHERE loot_id <> 0 AND loot_id <> entry LIMIT 1`
  );
  assert.ok(odd, 'this realm has a creature whose loot_id is not its entry');

  const data = await loadCreature(pools, config, odd.entry);
  assert.ok(data, `creature ${odd.entry} should load`);

  // mincountOrRef < 0 marks a reference row: it points at
  // reference_loot_template rather than naming an item of its own
  // (vmangos-core/src/game/LootMgr.cpp:105), even on a row where the `item`
  // column happens to carry a non-zero value - fetchLoot walks those into
  // their reference entry (server/queries/db/loot.js) rather than reading
  // `item` off the pointer row itself, so the direct comparison here must
  // exclude them the same way.
  const [expected] = await pools.world.query(
    `SELECT item FROM \`${schema}\`.creature_loot_template
     WHERE entry = ? AND patch_min <= ? AND ? <= patch_max AND mincountOrRef >= 0`,
    [odd.loot_id, config.realm.wowPatch, config.realm.wowPatch]
  );
  const expectedItems = new Set(expected.map((r) => Number(r.item)).filter((item) => item > 0));
  const pageItems = new Set(data.loot.filter((l) => l.viaReference === null).map((l) => l.item));
  assert.deepEqual(pageItems, expectedItems, `the page's loot should come from loot_id ${odd.loot_id}, not entry ${odd.entry}`);
});

test('a creature flagged as a vendor comes back with a non-empty vendor list', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;
  const schema = config.mysql.world.database;
  // UNIT_NPC_FLAG_VENDOR is 0x4 (vmangos-core/src/game/Objects/UnitDefines.h).
  // Find a template that actually stocks something, not merely a template
  // that carries the flag with an empty npc_vendor - the flag alone does not
  // guarantee stock on a released dump.
  const [[hit]] = await pools.world.query(
    `SELECT ct.entry FROM \`${schema}\`.creature_template ct
     JOIN \`${schema}\`.npc_vendor v ON v.entry = ct.entry
     WHERE ct.npc_flags & 4 <> 0 LIMIT 1`
  );
  assert.ok(hit, 'this realm has a stocked vendor creature');

  const data = await loadCreature(pools, config, hit.entry);
  assert.ok(data, `creature ${hit.entry} should load`);
  assert.ok(data.vendor.length > 0, `creature ${hit.entry} should have vendor stock`);
});
