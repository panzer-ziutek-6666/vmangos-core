import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readConfigFile } from '../server/config.js';
import { createPools } from '../server/db.js';
import { worldSchema } from '../server/queries/db/sql.js';
import { listZones } from '../server/queries/db/zones.js';
import { loadZone } from '../server/queries/db/zone.js';
import { areaIndex, resolveArea, zoneIdOf, mapGrids, areaFlagAt } from '../server/dbLookups/areaGrid.js';
import { searchTemplates } from '../server/queries/db/search.js';
import { highestBuildClause } from '../server/queries/db/progressive.js';

// Read-only against the real world database: every call below issues nothing
// but SELECTs. The realm is running while these execute, so they assert
// shapes and invariants, never values.
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
    pool: pools.world,
    config,
    terrain: config.terrain,
    args: {
      schema: worldSchema(config),
      dbcSchema: config.mysql?.dbcSchema ?? null,
      wowPatch: config.realm?.wowPatch,
      clientBuild: config.realm?.clientBuild
    }
  };
}

// I2: listZones' `mapped` read INNER JOINs world_map_area to area_template
// (server/queries/db/zones.js) - a world_map_area row with no matching
// area_template.entry simply disappears from data.continents rather than
// failing anything, so a test that only walks listZones' own output can
// never catch one. Reading world_map_area directly, independent of
// listZones, and checking every one of its rows against area_template
// closes that gap.
test('every world_map_area row names an area_template zone, and every mapped zone has a tile directory', async (t) => {
  const ctx = await connectOrSkip(t); if (!ctx) return;
  const [orphans] = await ctx.pool.query(
    `SELECT w.area_id FROM \`${ctx.args.dbcSchema}\`.world_map_area w
     WHERE w.area_id <> 0 AND NOT EXISTS (SELECT 1 FROM \`${ctx.args.schema}\`.area_template a WHERE a.entry = w.area_id)`
  );
  assert.deepEqual(orphans.map((r) => Number(r.area_id)), [], 'world_map_area names an area_template row that does not exist');

  const data = await listZones(ctx.pool, ctx.args);
  const zones = data.continents.flatMap((c) => c.zones);
  assert.ok(zones.length > 0);
  const [rows] = await ctx.pool.query(`SELECT area_id, name FROM \`${ctx.args.dbcSchema}\`.world_map_area WHERE area_id <> 0`);
  for (const r of rows) assert.ok(String(r.name).length > 0, `world_map_area for area ${r.area_id} has no directory name`);
  for (const z of zones) assert.ok(z.name.length > 0);
});

// Goldshire's inn, a spawn nobody will move: it must resolve into Elwynn
// Forest (12) through the core's own terrain. Asserts the zone, which is the
// invariant this whole cycle rests on, not a count.
test('a Goldshire spawn resolves to Elwynn Forest through the terrain files', async (t) => {
  const ctx = await connectOrSkip(t); if (!ctx) return;
  if (!ctx.terrain) { t.skip('terrain.mapsDir not configured'); return; }
  const [areaRows] = await ctx.pool.query(`SELECT entry, map_id, zone_id, explore_flag FROM \`${ctx.args.schema}\`.area_template ORDER BY entry`);
  const index = areaIndex(areaRows.map((r) => ({ entry: Number(r.entry), mapId: Number(r.map_id), zoneId: Number(r.zone_id), exploreFlag: Number(r.explore_flag) })));
  const { grids } = mapGrids(ctx.terrain.mapsDir, 0);
  assert.equal(zoneIdOf(resolveArea(index, areaFlagAt(grids, -9464, 62), 0, 0)), 12);
});

test('every instance map\'s spawns resolve through the terrain files', async (t) => {
  const ctx = await connectOrSkip(t); if (!ctx) return;
  if (!ctx.terrain) { t.skip('terrain.mapsDir not configured'); return; }
  for (const id of [12, 14, 1583]) {
    const data = await loadZone(ctx.pools, ctx.config, id);
    assert.equal(data.terrain, 'ok');
    assert.ok(data.npcs.length > 0, `zone ${id} resolved no NPCs`);
    t.diagnostic(`zone ${id}: ${data.npcs.length} npcs, ${data.objects.length} objects, ${data.dots.length} dots`);
  }
});

// I2: loadZone's own return value never counts a spawn that resolves to no
// area at all - belongs() only ever asks "is this spawn mine?", so a spawn
// nothing claims is silently absent from every list. This is the one
// measurement the spec made binding for the interiors risk ("the figure is
// recorded, not hidden"), so it is done here directly: the rectangle's own
// spawns (map, x, y, bounded the same way loadZone's spawnWhere bounds them),
// resolved through the same areaGrid.js calls loadZone uses, counting a null
// resolveArea result - never routed back through loadZone's own return
// value, which has no such count to read.
test('the count of a zone rectangle\'s spawns that resolve to no area is reported', async (t) => {
  const ctx = await connectOrSkip(t); if (!ctx) return;
  if (!ctx.terrain) { t.skip('terrain.mapsDir not configured'); return; }
  const [areaRows] = await ctx.pool.query(`SELECT entry, map_id, zone_id, explore_flag FROM \`${ctx.args.schema}\`.area_template ORDER BY entry`);
  const index = areaIndex(areaRows.map((r) => ({ entry: Number(r.entry), mapId: Number(r.map_id), zoneId: Number(r.zone_id), exploreFlag: Number(r.explore_flag) })));

  const [rectRows] = await ctx.pool.query(
    `SELECT area_id, map_id, loc_left, loc_right, loc_top, loc_bottom FROM \`${ctx.args.dbcSchema}\`.world_map_area WHERE area_id IN (12, 14)`
  );
  for (const row of rectRows) {
    const mapId = Number(row.map_id);
    const yMin = Math.min(Number(row.loc_left), Number(row.loc_right));
    const yMax = Math.max(Number(row.loc_left), Number(row.loc_right));
    const xMin = Math.min(Number(row.loc_top), Number(row.loc_bottom));
    const xMax = Math.max(Number(row.loc_top), Number(row.loc_bottom));
    const [spawnRows] = await ctx.pool.query(
      `SELECT CAST(position_x AS DOUBLE) AS position_x, CAST(position_y AS DOUBLE) AS position_y
       FROM \`${ctx.args.schema}\`.creature
       WHERE patch_min <= ? AND ? <= patch_max AND map = ? AND position_y BETWEEN ? AND ? AND position_x BETWEEN ? AND ?`,
      [ctx.args.wowPatch, ctx.args.wowPatch, mapId, yMin, yMax, xMin, xMax]
    );
    const { grids } = mapGrids(ctx.terrain.mapsDir, mapId);
    const unresolved = spawnRows.filter((r) => {
      const flag = areaFlagAt(grids, Number(r.position_x), Number(r.position_y));
      return !resolveArea(index, flag, mapId, 0);
    }).length;
    t.diagnostic(`zone ${row.area_id}: ${unresolved}/${spawnRows.length} spawns resolve to no area`);
    assert.ok(Number.isInteger(unresolved) && unresolved <= spawnRows.length);
  }
});

test('every faction template names a faction the world database has', async (t) => {
  const ctx = await connectOrSkip(t); if (!ctx) return;
  const [rows] = await ctx.pool.query(
    `SELECT COUNT(*) AS n FROM \`${ctx.args.schema}\`.faction_template t1
     WHERE ${highestBuildClause(ctx.args.schema, 'faction_template', 't1', 'id')}
       AND NOT EXISTS (SELECT 1 FROM \`${ctx.args.schema}\`.faction f WHERE f.id = t1.faction_id AND f.build <= ?)`,
    [ctx.args.clientBuild, ctx.args.clientBuild]
  );
  assert.equal(Number(rows[0].n), 0);
});

test('search finds a spell, a zone and a faction by name', async (t) => {
  const ctx = await connectOrSkip(t); if (!ctx) return;
  const result = await searchTemplates(ctx.pool, { ...ctx.args, query: 'Elwynn', limit: 5 });
  assert.ok(result.groups.find((g) => g.kind === 'zone').total > 0);
  const storm = await searchTemplates(ctx.pool, { ...ctx.args, query: 'Stormwind', limit: 5 });
  assert.ok(storm.groups.find((g) => g.kind === 'faction').total > 0);
  const fire = await searchTemplates(ctx.pool, { ...ctx.args, query: 'Fireball', limit: 5 });
  assert.ok(fire.groups.find((g) => g.kind === 'spell').total > 0);
});
