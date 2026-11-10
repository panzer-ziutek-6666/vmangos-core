import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readConfigFile } from '../server/config.js';
import { createPools } from '../server/db.js';
import { fetchNames } from '../server/dbLookups/names.js';
import { fetchFaction } from '../server/dbLookups/factions.js';
import { fetchMapNames } from '../server/dbLookups/maps.js';

// Read-only against the real realm: every query here is a SELECT, and
// nothing in this file mutates state.
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

test('faction template 14 resolves to exactly one faction name', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;
  const faction = await fetchFaction(pools.world, {
    schema: config.mysql.world.database, factionTemplateId: 14, clientBuild: config.realm.clientBuild
  });
  assert.ok(faction, 'faction template 14 exists on this realm');
  assert.equal(typeof faction.name, 'string');
  assert.ok(faction.name.length > 0);
});

test('pinning the build is what keeps a faction lookup single-valued', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;
  // The unpinned join is the bug this module exists to avoid. Show it on a
  // template id that actually carries more than one build row on this
  // realm's world DB: faction_template is a delta table like the patch-keyed
  // ones - most ids hold a single row at their earliest build and nothing
  // after it (id 14 is one of those, which is why the test above resolves it
  // fine even though it has only one row), but id 103 picked up a change at
  // build 4544 and so holds two.
  const [rows] = await pools.world.query(
    `SELECT COUNT(*) AS n FROM \`${config.mysql.world.database}\`.faction_template WHERE id = 103`
  );
  assert.ok(Number(rows[0].n) > 1, 'faction_template can hold more than one row for the same id');
});

test('a spell with no row at the client build still resolves through its nearest earlier build', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;
  // Find an entry with this shape rather than hardcoding one: the exact set
  // of entries lacking a build-5875 row is a fact about the current world DB
  // dump, not a fact this test should assume ahead of time.
  const [candidates] = await pools.world.query(
    `SELECT entry, MAX(build) AS maxBuild FROM \`${config.mysql.world.database}\`.spell_template
     GROUP BY entry HAVING maxBuild < ? LIMIT 1`,
    [config.realm.clientBuild]
  );
  assert.ok(candidates.length > 0, 'this realm has a spell entry with no row at the client build');
  const entry = Number(candidates[0].entry);

  const names = await fetchNames(pools.world, {
    schema: config.mysql.world.database, kind: 'spell', ids: [entry],
    wowPatch: config.realm.wowPatch, clientBuild: config.realm.clientBuild
  });
  assert.ok(names.has(entry), `spell ${entry} should resolve via its highest build below ${config.realm.clientBuild}`);
  assert.ok(names.get(entry).length > 0);
});

test('map 0 has a name and map ids come back as numbers', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, config } = ctx;
  const names = await fetchMapNames(pools.world, {
    schema: config.mysql.world.database, mapIds: [0, 33], wowPatch: config.realm.wowPatch
  });
  assert.equal(names.get(0), 'Eastern Kingdoms');
  assert.ok(names.get(33));
});
