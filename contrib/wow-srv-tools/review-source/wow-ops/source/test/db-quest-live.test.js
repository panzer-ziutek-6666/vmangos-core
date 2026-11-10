import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readConfigFile } from '../server/config.js';
import { createPools } from '../server/db.js';
import { loadQuest } from '../server/queries/db/quest.js';

// Read-only against the real world database: loadQuest issues nothing but
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

test('a quest with a negative ReqCreatureOrGOId resolves to a gameobject that exists', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;
  const schema = config.mysql.world.database;
  // vmangos-core/src/game/ObjectMgr.cpp:5918-5926: negative means gameobject,
  // stored negated. 36 quests on this realm use the negative form.
  const [[hit]] = await pools.world.query(
    `SELECT qt.entry AS quest, qt.ReqCreatureOrGOId1 AS raw, gt.entry AS go_entry, gt.name
     FROM \`${schema}\`.quest_template qt
     JOIN \`${schema}\`.gameobject_template gt ON gt.entry = -qt.ReqCreatureOrGOId1
     WHERE qt.ReqCreatureOrGOId1 < 0
     LIMIT 1`
  );
  assert.ok(hit, 'this realm has a quest whose ReqCreatureOrGOId1 is negative and resolves to a real gameobject');

  const data = await loadQuest(pools, config, hit.quest);
  assert.ok(data, `quest ${hit.quest} should load`);
  const objective = data.objectives.creaturesOrObjects.find((o) => o.id === hit.go_entry);
  assert.ok(objective, `quest ${hit.quest} should list gameobject ${hit.go_entry} among its objectives`);
  assert.equal(objective.kind, 'gameobject', 'a negative ReqCreatureOrGOId must resolve to a gameobject, not a creature');
});

test('a quest with patch variants reports them on the page', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;
  const schema = config.mysql.world.database;
  const [[hit]] = await pools.world.query(
    `SELECT entry, COUNT(*) AS variants
     FROM \`${schema}\`.quest_template
     GROUP BY entry
     HAVING COUNT(*) > 1
     LIMIT 1`
  );
  assert.ok(hit, 'this realm has a quest_template entry with more than one patch row');

  const data = await loadQuest(pools, config, hit.entry);
  assert.ok(data, `quest ${hit.entry} should load`);
  assert.equal(data.patches.length, Number(hit.variants), `quest ${hit.entry} should report all ${hit.variants} of its patch rows`);
});

test('a quest with a creature giver names the giver', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;
  const schema = config.mysql.world.database;
  const wowPatch = config.realm.wowPatch;
  const [[hit]] = await pools.world.query(
    `SELECT cqr.id AS creature_entry, cqr.quest, ct.name
     FROM \`${schema}\`.creature_questrelation cqr
     JOIN \`${schema}\`.creature_template ct ON ct.entry = cqr.id
     WHERE cqr.patch_min <= ? AND ? <= cqr.patch_max
     LIMIT 1`,
    [wowPatch, wowPatch]
  );
  assert.ok(hit, 'this realm has a quest offered by a creature');

  const data = await loadQuest(pools, config, hit.quest);
  assert.ok(data, `quest ${hit.quest} should load`);
  const giver = data.givers.find((g) => g.kind === 'creature' && g.id === hit.creature_entry);
  assert.ok(giver, `quest ${hit.quest} should list creature ${hit.creature_entry} among its givers`);
  assert.ok(giver.name, 'the giver should be named, not just numbered');
});

test('a quest reward reputation faction is named, not left blank', async (t) => {
  // RewRepFaction1..5 are `faction` table ids, resolved through
  // sObjectMgr.GetFactionEntry (vmangos-core/src/game/Objects/Player.cpp:6656)
  // - NOT `faction_template` ids like creature_template.faction (Creature.cpp:656,
  // resolved via GetFactionTemplateEntry). Different id spaces: joining this
  // through fetchFaction (the faction_template -> faction join) would name the
  // wrong faction on every quest reward. Do not "simplify" this back to
  // fetchFaction - it was tried, and it was wrong.
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;
  const schema = config.mysql.world.database;
  const [[hit]] = await pools.world.query(
    `SELECT entry AS quest, RewRepFaction1 AS faction
     FROM \`${schema}\`.quest_template
     WHERE RewRepFaction1 != 0
     LIMIT 1`
  );
  assert.ok(hit, 'this realm has a quest that rewards reputation');

  const data = await loadQuest(pools, config, hit.quest);
  assert.ok(data, `quest ${hit.quest} should load`);
  const reward = data.rewards.reputation.find((r) => r.faction === hit.faction);
  assert.ok(reward, `quest ${hit.quest} should list faction ${hit.faction} among its reputation rewards`);
  assert.ok(reward.name, `faction ${hit.faction} should resolve to a real name, not be left blank`);
});
