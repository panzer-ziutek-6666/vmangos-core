import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readConfigFile } from '../server/config.js';
import { createPools } from '../server/db.js';
import { loadItem } from '../server/queries/db/item.js';

// Read-only against the real world database: loadItem issues nothing but
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

test('an item dropped by a creature whose loot_id differs from its entry still resolves the dropper', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;
  const schema = config.mysql.world.database;
  // The same loot_id-not-entry trap Task 9 verified, seen from the other
  // side: joining creature_loot_template to creature_template through
  // loot_id (not entry) picks an item whose only known dropper fails to
  // resolve if loadItem ever joined on entry instead.
  const [[hit]] = await pools.world.query(
    `SELECT clt.item, ct.entry AS creature_entry
     FROM \`${schema}\`.creature_loot_template clt
     JOIN \`${schema}\`.creature_template ct ON ct.loot_id = clt.entry
     WHERE clt.mincountOrRef >= 0 AND clt.item > 0 AND ct.loot_id <> ct.entry
     LIMIT 1`
  );
  assert.ok(hit, 'this realm has an item dropped by a creature whose loot_id is not its entry');

  const data = await loadItem(pools, config, hit.item);
  assert.ok(data, `item ${hit.item} should load`);
  assert.ok(
    data.droppedBy.some((d) => d.entry === hit.creature_entry),
    `item ${hit.item} should list creature ${hit.creature_entry} among its droppers`
  );
  const dropper = data.droppedBy.find((d) => d.entry === hit.creature_entry);
  assert.ok(dropper.name, 'the dropper should be named, not just numbered');
});

test('an item reachable only through reference_loot_template still lists a source', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;
  const schema = config.mysql.world.database;
  const [[borne]] = await pools.world.query(
    `SELECT r.item
     FROM \`${schema}\`.reference_loot_template r
     WHERE r.item NOT IN (SELECT item FROM \`${schema}\`.creature_loot_template WHERE item > 0)
     LIMIT 1`
  );
  if (!borne) return t.skip('no item is reference-only on this world DB');

  const data = await loadItem(pools, config, borne.item);
  assert.ok(data, `item ${borne.item} should load`);
  assert.ok(data.droppedBy.length > 0, `item ${borne.item} should still list a dropper via the reference hop`);
  assert.ok(data.droppedBy.every((d) => d.viaReference !== null), 'a reference-only item has no direct droppers');
});

test('an item sold through npc_vendor_template lists its vendor', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;
  const schema = config.mysql.world.database;
  const [[hit]] = await pools.world.query(
    `SELECT vt.item, ct.entry AS creature_entry
     FROM \`${schema}\`.npc_vendor_template vt
     JOIN \`${schema}\`.creature_template ct ON ct.vendor_id = vt.entry
     LIMIT 1`
  );
  assert.ok(hit, 'this realm has an item sold through a template vendor');

  const data = await loadItem(pools, config, hit.item);
  assert.ok(data, `item ${hit.item} should load`);
  assert.ok(
    data.soldBy.some((v) => v.entry === hit.creature_entry && v.source === 'template'),
    `item ${hit.item} should list creature ${hit.creature_entry} as a template vendor`
  );
});

test('an item dropped from a real gameobject resolves through the chest/fishinghole type filter', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;
  const schema = config.mysql.world.database;
  const [[hit]] = await pools.world.query(
    `SELECT golt.item, gt.entry AS go_entry
     FROM \`${schema}\`.gameobject_loot_template golt
     JOIN \`${schema}\`.gameobject_template gt ON gt.type IN (3, 25) AND gt.data1 = golt.entry
     WHERE golt.item > 0 AND golt.mincountOrRef >= 0
     LIMIT 1`
  );
  assert.ok(hit, 'this realm has an item dropped from a chest or fishing hole gameobject');

  const data = await loadItem(pools, config, hit.item);
  assert.ok(data, `item ${hit.item} should load`);
  assert.ok(
    data.objectLoot.some((o) => o.entry === hit.go_entry),
    `item ${hit.item} should list gameobject ${hit.go_entry} among its object drops`
  );
});

test('an item caught by fishing resolves the area name, not just its id', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;
  const schema = config.mysql.world.database;
  const [[hit]] = await pools.world.query(
    `SELECT flt.item, flt.entry AS area_id, at.name
     FROM \`${schema}\`.fishing_loot_template flt
     JOIN \`${schema}\`.area_template at ON at.entry = flt.entry
     WHERE flt.item > 0 AND flt.mincountOrRef >= 0
     LIMIT 1`
  );
  assert.ok(hit, 'this realm has a fishable item whose area resolves through area_template');

  const data = await loadItem(pools, config, hit.item);
  assert.ok(data, `item ${hit.item} should load`);
  const caught = data.gatheredFrom.fishing.find((f) => f.entry === hit.area_id);
  assert.ok(caught, `item ${hit.item} should list area ${hit.area_id} among its fishing sources`);
  assert.equal(caught.name, hit.name, `area ${hit.area_id} should resolve to its real name, not print bare`);
});

// The 18-column OR across ReqItemId1..4, ReqSourceId1..4, RewItemId1..4 and
// RewChoiceItemId1..6 (fetchQuestRows, server/queries/db/item.js) is the
// kind of query a later edit can silently break into returning nothing -
// wrong column order, a dropped OR, a patch clause bound to the wrong
// parameter would all still "succeed" with zero rows. Proven against a real
// quest on this realm rather than left as the one-off script used while
// building it.
test('an item required or rewarded by a real quest is reported by loadItem', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;
  const schema = config.mysql.world.database;
  const [[rewarded]] = await pools.world.query(
    `SELECT entry AS quest, RewItemId1 AS item FROM \`${schema}\`.quest_template WHERE RewItemId1 > 0 LIMIT 1`
  );
  assert.ok(rewarded, 'this realm has a quest that rewards an item outright');

  const rewardData = await loadItem(pools, config, rewarded.item);
  assert.ok(rewardData, `item ${rewarded.item} should load`);
  assert.ok(
    rewardData.questsRewarding.includes(rewarded.quest),
    `item ${rewarded.item} should list quest ${rewarded.quest} as rewarding it`
  );

  const [[required]] = await pools.world.query(
    `SELECT entry AS quest, ReqItemId1 AS item FROM \`${schema}\`.quest_template WHERE ReqItemId1 > 0 LIMIT 1`
  );
  assert.ok(required, 'this realm has a quest that requires an item as a turn-in');

  const requireData = await loadItem(pools, config, required.item);
  assert.ok(requireData, `item ${required.item} should load`);
  assert.ok(
    requireData.questsRequiring.includes(required.quest),
    `item ${required.item} should list quest ${required.quest} as requiring it`
  );
});
