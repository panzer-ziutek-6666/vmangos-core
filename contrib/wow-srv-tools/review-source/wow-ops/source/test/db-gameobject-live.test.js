import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readConfigFile } from '../server/config.js';
import { createPools } from '../server/db.js';
import { loadGameObject } from '../server/queries/db/gameobject.js';

// Read-only against the real world database: loadGameObject issues nothing
// but SELECTs, so nothing here can change realm state.
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

test('a real chest reads its loot from data1 and its items resolve to names', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;
  const schema = config.mysql.world.database;
  const [[hit]] = await pools.world.query(
    `SELECT entry FROM \`${schema}\`.gameobject_template WHERE type = 3 AND data1 <> 0 LIMIT 1`
  );
  assert.ok(hit, 'this realm has a chest gameobject with a nonzero data1');

  const data = await loadGameObject(pools, config, hit.entry);
  assert.ok(data, `gameobject ${hit.entry} should load`);
  assert.ok(data.loot.length > 0, `chest ${hit.entry} should have a non-empty loot table`);
  for (const l of data.loot) {
    const name = data.names.item.get(l.item);
    assert.ok(name, `item ${l.item} in chest ${hit.entry}'s loot should resolve to a name`);
  }
});

test('a door has no loot, and no loot query is ever attempted for it', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;
  const schema = config.mysql.world.database;
  const [[hit]] = await pools.world.query(
    `SELECT entry FROM \`${schema}\`.gameobject_template WHERE type = 0 LIMIT 1`
  );
  assert.ok(hit, 'this realm has a door gameobject');

  // A spy pool that forwards every query to the real pool but records
  // whether gameobject_loot_template was ever touched - the door case must
  // never issue that query at all, not merely receive an empty result from it.
  let lootQueried = false;
  const spyPool = {
    query: async (sql, params) => {
      if (sql.includes('gameobject_loot_template')) lootQueried = true;
      return pools.world.query(sql, params);
    }
  };

  const data = await loadGameObject({ world: spyPool }, config, hit.entry);
  assert.ok(data, `gameobject ${hit.entry} should load`);
  assert.deepEqual(data.loot, []);
  assert.equal(lootQueried, false, `a door (type 0) should never query gameobject_loot_template`);
});
