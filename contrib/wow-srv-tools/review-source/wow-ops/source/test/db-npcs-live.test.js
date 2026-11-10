import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readConfigFile } from '../server/config.js';
import { createPools } from '../server/db.js';
import { worldSchema } from '../server/queries/db/sql.js';
import { listCreatures } from '../server/queries/db/creatures.js';
import { parseCreatureFilters } from '../server/queries/db/creatureFilters.js';
import { listGameObjects } from '../server/queries/db/gameobjects.js';
import { parseGameObjectFilters } from '../server/queries/db/gameobjectFilters.js';
import { fetchMapNames } from '../server/dbLookups/maps.js';

// Read-only against the real world database: listCreatures, listGameObjects
// and fetchMapNames issue nothing but SELECTs. The realm is running while
// these execute, so they assert shapes and invariants, never values.
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
  return {
    pools,
    args: { schema: worldSchema(config), dbcSchema: config.mysql?.dbcSchema ?? null, wowPatch: config.realm?.wowPatch }
  };
}

const LISTVIEWS = [
  ['NPCs', listCreatures, parseCreatureFilters, { rank: '1' }],
  ['objects', listGameObjects, parseGameObjectFilters, { type: '3' }]
];

for (const [label, list, parse, narrowing] of LISTVIEWS) {
  test(`the first page of ${label} is non-empty and within the page size`, async (t) => {
    const ctx = await connectOrSkip(t);
    if (!ctx) return;
    const filters = parse({});
    const { rows, total } = await list(ctx.pools.world, { ...ctx.args, filters });
    assert.ok(total > 0, `expected at least one ${label} row for this patch`);
    assert.ok(rows.length > 0, 'expected the first page to be non-empty');
    assert.ok(rows.length <= filters.pageSize, 'expected the page to be no larger than the page size');
    for (const row of rows) {
      assert.equal(typeof row.name, 'string');
      assert.ok(Number.isInteger(Number(row.entry)), `expected entry ${row.entry} to be an integer`);
    }
  });

  test(`no entry appears twice on a page of ${label}, which is what the patch clause is for`, async (t) => {
    const ctx = await connectOrSkip(t);
    if (!ctx) return;
    const { rows } = await list(ctx.pools.world, { ...ctx.args, filters: parse({}) });
    const entries = rows.map((r) => Number(r.entry));
    assert.equal(new Set(entries).size, entries.length, 'expected every entry on the page to be distinct');
  });

  test(`a filtered count of ${label} is never larger than the unfiltered one`, async (t) => {
    const ctx = await connectOrSkip(t);
    if (!ctx) return;
    const all = await list(ctx.pools.world, { ...ctx.args, filters: parse({}) });
    const narrowed = await list(ctx.pools.world, { ...ctx.args, filters: parse(narrowing) });
    assert.ok(narrowed.total <= all.total, 'expected a filter to never add rows');
  });
}

// GetLootId (vmangos-core GameObjectDefines.h:670-680) returns a loot id for
// chest and fishing hole only. A realm-wide data1 check once listed spell
// foci as lootable; this holds the filter to the core's own rule.
test('the loot filter lists only chests and fishing holes', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { rows, total } = await listGameObjects(ctx.pools.world, { ...ctx.args, filters: parseGameObjectFilters({ loot: '1' }) });
  assert.ok(total > 0, 'this realm has lootable gameobjects');
  for (const row of rows) {
    assert.ok([3, 25].includes(Number(row.type)), `object ${row.entry} of type ${row.type} should not be listed as lootable`);
    assert.ok(Number(row.loot_id) > 0);
  }
});

test('a spawned creature lists a spawn count above zero and a map id that resolves to a name', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const { pools, args } = ctx;
  // Picked from the spawn table itself, under the same patch bound the list
  // query's spawn subqueries carry (creatures.js), so the creature is one
  // this patch really spawns.
  const [[spawned]] = await pools.world.query(
    `SELECT ct.entry, ct.name FROM \`${args.schema}\`.creature c
     JOIN \`${args.schema}\`.creature_template ct ON ct.entry = c.id
     WHERE c.patch_min <= ? AND ? <= c.patch_max LIMIT 1`,
    [args.wowPatch, args.wowPatch]
  );
  assert.ok(spawned, 'this realm spawns at least one creature');

  // Sorted by entry and narrowed to the name, so the creature is on page 1
  // unless 50 lower entries share its name.
  const { rows } = await listCreatures(pools.world, {
    ...args, filters: parseCreatureFilters({ q: spawned.name, sort: 'entry' })
  });
  const row = rows.find((r) => Number(r.entry) === Number(spawned.entry));
  assert.ok(row, `creature ${spawned.entry} should be listed when filtering by its own name`);
  assert.ok(Number(row.spawn_count) > 0, `creature ${spawned.entry} should report a spawn count above zero`);
  assert.notEqual(row.map_id, null, `creature ${spawned.entry} should report a map id`);

  const names = await fetchMapNames(pools.world, { schema: args.schema, mapIds: [row.map_id], wowPatch: args.wowPatch });
  assert.ok(names.get(Number(row.map_id)), `map ${row.map_id} should resolve to a name`);
});
