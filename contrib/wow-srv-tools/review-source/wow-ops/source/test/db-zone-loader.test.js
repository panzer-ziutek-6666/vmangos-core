import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadZone } from '../server/queries/db/zone.js';
import { clearAreaGridCache } from '../server/dbLookups/areaGrid.js';
import { dbStubPool } from './helpers/dbStubPool.js';
import { CONFIG } from './helpers/dbApp.js';

// One flat grid over Goldshire (grid 0004931.map) whose flag is 87, Goldshire's
// sub-area of Elwynn (zone 12).
function terrainDir() {
  const dir = mkdtempSync(join(tmpdir(), 'zone-'));
  const header = Buffer.alloc(40);
  header.write('MAPS', 0, 'latin1'); header.write('z1.4', 4, 'latin1'); header.writeUInt32LE(40, 8);
  const area = Buffer.alloc(8);
  area.write('AREA', 0, 'latin1'); area.writeUInt16LE(1, 4); area.writeUInt16LE(87, 6);
  writeFileSync(join(dir, '0004931.map'), Buffer.concat([header, area]));
  return dir;
}

const AREAS = [
  { entry: 12, map_id: 0, zone_id: 0, explore_flag: 12, name: 'Elwynn Forest', team: 2 },
  { entry: 87, map_id: 0, zone_id: 12, explore_flag: 87, name: 'Goldshire', team: 2 }
];

function stub(areas = AREAS) {
  return dbStubPool({
    world_map_overlay: [{ texture_name: 'GOLDSHIRE', texture_width: 240, texture_height: 220, offset_x: 250, offset_y: 270 }],
    world_map_area: [{ id: 30, map_id: 0, name: 'Elwynn', loc_left: 1535.42, loc_right: -1935.42, loc_top: -7939.58, loc_bottom: -10254.2 }],
    map_template: [{ entry: 0, linked_zone: 0 }],
    creature_template: [{ entry: 1, name: 'Guard', level_min: 10, level_max: 12 }],
    gameobject_template: [{ entry: 2, name: 'Mailbox' }],
    quest_template: [{ entry: 5, Title: 'Kobold Camp Cleanup', QuestLevel: 5 }],
    creature: [
      { guid: 1, id: 1, id2: 0, id3: 0, id4: 0, id5: 0, map: 0, position_x: -9464, position_y: 62 },
      { guid: 2, id: 1, id2: 0, id3: 0, id4: 0, id5: 0, map: 0, position_x: -9465, position_y: 63 },
      { guid: 3, id: 1, id2: 0, id3: 0, id4: 0, id5: 0, map: 0, position_x: 100, position_y: 100 }
    ],
    gameobject: [{ guid: 9, id: 2, map: 0, position_x: -9464, position_y: 62 }],
    area_template: areas
  });
}

test('a zone keeps only the spawns that resolve to it, tallies them, and issues ten statements', async (t) => {
  const dir = terrainDir();
  t.after(() => { rmSync(dir, { recursive: true, force: true }); clearAreaGridCache(); });
  const s = stub();
  const config = { ...CONFIG, mysql: { ...CONFIG.mysql, dbcSchema: 'dbc' }, terrain: { mapsDir: dir } };
  const data = await loadZone({ world: s.pool }, config, 12);
  // Ten: the nine the page always read, plus the world map's overlays.
  assert.equal(s.calls.length, 10);
  assert.deepEqual(data.overlays, [{ texture: 'GOLDSHIRE', width: 240, height: 220, x: 250, y: 270 }]);
  assert.deepEqual(s.callsFor('world_map_overlay')[0].params, [30]);
  assert.equal(data.area.name, 'Elwynn Forest');
  assert.equal(data.terrain, 'ok');
  assert.deepEqual(data.npcs, [{ entry: 1, name: 'Guard', levelMin: 10, levelMax: 12, count: 2 }]);
  assert.deepEqual(data.objects, [{ entry: 2, name: 'Mailbox', count: 1 }]);
  assert.equal(data.dots.length, 3);
  assert.deepEqual(data.levelRange, { min: 10, max: 12 });
  assert.deepEqual(data.subAreas, [{ id: 87, name: 'Goldshire' }]);
  assert.deepEqual(data.quests, [{ entry: 5, title: 'Kobold Camp Cleanup', level: 5 }]);
  assert.equal(data.worldMap.name, 'Elwynn');
});

test('the spawn read is bounded by map, rectangle and patch, all bound', async (t) => {
  const dir = terrainDir();
  t.after(() => { rmSync(dir, { recursive: true, force: true }); clearAreaGridCache(); });
  const s = stub();
  await loadZone({ world: s.pool }, { ...CONFIG, mysql: { ...CONFIG.mysql, dbcSchema: 'dbc' }, terrain: { mapsDir: dir } }, 12);
  const call = s.calls.find((c) => /FROM `mangos`\.`creature` /.test(c.sql));
  assert.match(call.sql, /patch_min <= \? AND \? <= patch_max/);
  assert.match(call.sql, /position_y BETWEEN \? AND \? AND position_x BETWEEN \? AND \?/);
  assert.deepEqual(call.params.slice(0, 3), [10, 10, 0]);
  // FLOAT columns read over the text protocol arrive rounded to six digits;
  // the cell arithmetic needs the stored float32, so both spawn reads cast.
  for (const table of ['creature', 'gameobject']) {
    const read = s.calls.find((c) => new RegExp(`FROM \`mangos\`\\.\`${table}\` `).test(c.sql));
    assert.match(read.sql, /CAST\(position_x AS DOUBLE\) AS position_x, CAST\(position_y AS DOUBLE\) AS position_y/);
  }
});

test('a sub-area keeps spawns resolving to itself and names its parent', async (t) => {
  const dir = terrainDir();
  t.after(() => { rmSync(dir, { recursive: true, force: true }); clearAreaGridCache(); });
  const data = await loadZone({ world: stub().pool }, { ...CONFIG, mysql: { ...CONFIG.mysql, dbcSchema: 'dbc' }, terrain: { mapsDir: dir } }, 87);
  assert.deepEqual(data.zone, { id: 12, name: 'Elwynn Forest' });
  assert.equal(data.npcs[0].count, 2);
});

test('without terrain configured the spawn reads are skipped and the page says so', async () => {
  const s = stub();
  const data = await loadZone({ world: s.pool }, { ...CONFIG, mysql: { ...CONFIG.mysql, dbcSchema: 'dbc' } }, 12);
  assert.equal(data.terrain, 'unconfigured');
  assert.equal(s.callsFor('`creature`').length, 0);
  assert.deepEqual(data.npcs, []);
  // Six: area row, all areas, world map, its overlays, map_template, quests.
  assert.equal(s.calls.length, 6);
});

test('an unknown area is null', async () => {
  assert.equal(await loadZone({ world: dbStubPool({}).pool }, CONFIG, 999), null);
});

// world_map_overlay arrived after world_map_area: a reference schema imported
// in between has the map but not the overlay table, and the page must still
// draw its parchment and dots rather than 500.
test('a reference schema without world_map_overlay draws the map without overlays', async (t) => {
  const dir = terrainDir();
  t.after(() => { rmSync(dir, { recursive: true, force: true }); clearAreaGridCache(); });
  const inner = stub().pool;
  const pool = {
    query: async (sql, params) => {
      if (sql.includes('world_map_overlay')) {
        const err = new Error("Table 'dbc.world_map_overlay' doesn't exist");
        err.code = 'ER_NO_SUCH_TABLE';
        throw err;
      }
      return inner.query(sql, params);
    }
  };
  const data = await loadZone({ world: pool }, { ...CONFIG, mysql: { ...CONFIG.mysql, dbcSchema: 'dbc' }, terrain: { mapsDir: dir } }, 12);
  assert.deepEqual(data.overlays, []);
  assert.equal(data.worldMap.name, 'Elwynn');
  assert.equal(data.npcs.length, 1);
});

// M6: a reference schema built before this cycle added world_map_area.name
// lacks the column, so MySQL raises ER_BAD_FIELD_ERROR - a code
// withMissingReference does not catch (it only catches a schema that was
// never built at all: ER_NO_SUCH_TABLE/ER_BAD_DB_ERROR). Unguarded, this
// 500'd every zone page ("Unknown column 'name'") instead of explaining
// itself the way a missing reference schema already does.
test('an old reference schema missing world_map_area.name degrades instead of 500ing', async (t) => {
  const dir = terrainDir();
  t.after(() => { rmSync(dir, { recursive: true, force: true }); clearAreaGridCache(); });
  const inner = stub().pool;
  const pool = {
    query: async (sql, params) => {
      if (sql.includes('world_map_area')) {
        const err = new Error("Unknown column 'name' in 'field list'");
        err.code = 'ER_BAD_FIELD_ERROR';
        throw err;
      }
      return inner.query(sql, params);
    }
  };
  const config = { ...CONFIG, mysql: { ...CONFIG.mysql, dbcSchema: 'dbc' }, terrain: { mapsDir: dir } };
  const data = await loadZone({ world: pool }, config, 12);
  assert.equal(data.worldMap, null);
  assert.equal(data.worldMapOutdated, true);
});

// The core never reads a sub-area's own team: UpdateZone looks up the zone
// entry (not the area) and switches on its Team alone
// (vmangos-core/src/game/Objects/Player.cpp:6772, 6796-6811). Goldshire's own
// row carries team 0 here on purpose, to prove the page reports its zone's
// team (2) rather than its own.
test('a sub-area reports its zone\'s team, not its own', async (t) => {
  const dir = terrainDir();
  t.after(() => { rmSync(dir, { recursive: true, force: true }); clearAreaGridCache(); });
  const areas = [
    { entry: 12, map_id: 0, zone_id: 0, explore_flag: 12, name: 'Elwynn Forest', team: 2 },
    { entry: 87, map_id: 0, zone_id: 12, explore_flag: 87, name: 'Goldshire', team: 0 }
  ];
  const config = { ...CONFIG, mysql: { ...CONFIG.mysql, dbcSchema: 'dbc' }, terrain: { mapsDir: dir } };
  const data = await loadZone({ world: stub(areas).pool }, config, 87);
  assert.equal(data.area.team, 2);
});
