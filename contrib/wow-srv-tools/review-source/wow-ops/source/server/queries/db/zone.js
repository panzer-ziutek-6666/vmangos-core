import { worldSchema, withMissingReference, qualified } from './sql.js';
import { highestPatchClause } from './progressive.js';
import { fetchNames } from '../../dbLookups/names.js';
import { mapGrids, areaFlagAt, areaIndex, resolveArea, zoneIdOf } from '../../dbLookups/areaGrid.js';

const SPAWN_PATCH = 'patch_min <= ? AND ? <= patch_max';
const CREATURE_IDS = ['id', 'id2', 'id3', 'id4', 'id5'];

function toArea(r) {
  return { entry: Number(r.entry), mapId: Number(r.map_id), zoneId: Number(r.zone_id), exploreFlag: Number(r.explore_flag), name: r.name ?? '', team: Number(r.team) };
}

// The maps this page reads spawns from: the zone's own, bounded by its world
// map rectangle when it has one, and every instanced map that links to this
// zone - a flag-0 grid there resolves to map_template.linked_zone
// (vmangos-core/src/game/Maps/Map.h:161-162), which is how Blackrock Spire's
// spawns (map 229) belong to zone 1583 on map 0.
function spawnWhere(mapId, rect, linkedMaps) {
  // A zone with no world map (no row in world_map_area, mainland ids like
  // Blackrock Spire's 1583) reads its whole map instead of a rectangle:
  // measured at 51,911 rows in 99 ms for Blackrock Spire (map 0 plus
  // instance map 229). The terrain filter (`belongs`, below) is what keeps
  // only this zone's spawns - this WHERE only bounds which maps are read.
  const own = rect
    ? '(map = ? AND position_y BETWEEN ? AND ? AND position_x BETWEEN ? AND ?)'
    : '(map = ?)';
  const ownParams = rect
    ? [mapId, Math.min(rect.left, rect.right), Math.max(rect.left, rect.right), Math.min(rect.top, rect.bottom), Math.max(rect.top, rect.bottom)]
    : [mapId];
  const linked = linkedMaps.length ? ` OR map IN (${linkedMaps.map(() => '?').join(', ')})` : '';
  return { sql: `${SPAWN_PATCH} AND (${own}${linked})`, params: [...ownParams, ...linkedMaps] };
}

export async function loadZone(pools, config, id) {
  const pool = pools?.world;
  const schema = worldSchema(config);
  if (!pool || !schema) return null;
  const wowPatch = config.realm.wowPatch;
  const dbcSchema = config.mysql?.dbcSchema ?? null;
  const areaId = Number(id);

  const areaTable = qualified(schema, 'area_template');
  const [areaRows] = await pool.query(
    `SELECT entry, map_id, zone_id, explore_flag, name, team FROM ${areaTable} WHERE entry = ?`,
    [areaId]
  );
  const asked = areaRows.map(toArea).find((a) => a.entry === areaId);
  if (!asked) return null;

  // Every row, in entry order: the resolver needs the whole table
  // (AreaEntry::GetByAreaFlagAndMap scans all of it, Map.h:147), and the page
  // needs this zone's sub-areas and its parent's name from the same rows.
  const [allRows] = await pool.query(
    `SELECT entry, map_id, zone_id, explore_flag, name, team FROM ${areaTable} ORDER BY entry`
  );
  const areas = allRows.map(toArea);
  const byEntry = new Map(areas.map((a) => [a.entry, a]));
  const zoneRow = asked.zoneId ? byEntry.get(asked.zoneId) ?? null : null;
  const home = zoneRow ?? asked;

  // withMissingReference alone catches a reference schema that was never
  // built (ER_NO_SUCH_TABLE/ER_BAD_DB_ERROR); a schema built before this
  // cycle added world_map_area.name exists but lacks the column, which MySQL
  // reports as ER_BAD_FIELD_ERROR instead - caught here, not there, so the
  // page still renders with a note to rebuild it rather than a 500.
  let worldMapOutdated = false;
  const worldMap = dbcSchema
    ? await withMissingReference(null, async () => {
        try {
          const [rows] = await pool.query(
            `SELECT id, map_id, name, loc_left, loc_right, loc_top, loc_bottom FROM ${qualified(dbcSchema, 'world_map_area')} WHERE area_id = ?`,
            [home.entry]
          );
          const r = rows[0];
          return r ? { id: Number(r.id), name: r.name ?? '', left: Number(r.loc_left), right: Number(r.loc_right), top: Number(r.loc_top), bottom: Number(r.loc_bottom) } : null;
        } catch (err) {
          if (err.code === 'ER_BAD_FIELD_ERROR') { worldMapOutdated = true; return null; }
          throw err;
        }
      })
    : null;

  // The textures the client paints over the parchment for each explored area
  // (WorldMapOverlay.dbc, keyed to its world map area,
  // vmangos-core/src/game/Database/DBCStructure.h:752-768); the page draws all
  // of them, as a fully explored map. A reference schema built before the
  // table existed has none, which leaves the bare parchment, not a 500.
  const overlays = worldMap
    ? await withMissingReference([], async () => (await pool.query(
        `SELECT texture_name, texture_width, texture_height, offset_x, offset_y FROM ${qualified(dbcSchema, 'world_map_overlay')} WHERE world_map_area_id = ? ORDER BY id`,
        [worldMap.id]
      ))[0].map((o) => ({ texture: o.texture_name ?? '', width: Number(o.texture_width), height: Number(o.texture_height), x: Number(o.offset_x), y: Number(o.offset_y) })).filter((o) => o.texture))
    : [];

  const [mapRows] = await pool.query(
    `SELECT t1.entry, t1.linked_zone FROM ${qualified(schema, 'map_template')} t1 WHERE ${highestPatchClause(schema, 'map_template', 't1')}`,
    [wowPatch]
  );
  const linkedZoneOf = new Map(mapRows.map((m) => [Number(m.entry), Number(m.linked_zone)]));
  const linkedMaps = asked.zoneId === 0
    ? [...linkedZoneOf].filter(([mapId, zone]) => zone === asked.entry && mapId !== asked.mapId).map(([mapId]) => mapId)
    : [];

  const mapsDir = config.terrain?.mapsDir ?? null;
  let terrain = mapsDir ? 'ok' : 'unconfigured';
  let terrainErrorCode = null;
  const refused = [];
  let npcs = [];
  let objects = [];
  let dots = [];

  if (mapsDir) {
    const index = areaIndex(areas);
    const gridsByMap = new Map();
    for (const mapId of [home.mapId, ...linkedMaps]) {
      const loaded = mapGrids(mapsDir, mapId);
      if (loaded.missing) { terrain = 'missing'; terrainErrorCode = loaded.errorCode; }
      else if (loaded.empty && terrain === 'ok') terrain = 'empty';
      refused.push(...loaded.refused);
      gridsByMap.set(mapId, loaded.grids);
    }

    if (terrain === 'ok') {
      // A zone keeps spawns whose area's zone is this zone; a sub-area keeps
      // spawns whose area is this area (GetZoneAndAreaIdByAreaFlag,
      // vmangos-core/src/game/Maps/GridMap.cpp:1308-1314).
      const belongs = (map, x, y) => {
        const area = resolveArea(index, areaFlagAt(gridsByMap.get(map), x, y), map, linkedZoneOf.get(map) ?? 0);
        return asked.zoneId === 0 ? zoneIdOf(area) === asked.entry : area?.entry === asked.entry;
      };
      const where = spawnWhere(home.mapId, worldMap, linkedMaps);

      // position_x/position_y are FLOAT columns; read over the text protocol
      // they come back rounded to six digits (2,508 of 104,226 spawns on maps
      // 0 and 1, e.g. -10350.8 for a stored -10350.7587890625) - areaGrid.js's
      // Math.fround rounding exists precisely to land in the core's cell at a
      // boundary, so the value it rounds must be the stored float32, not a
      // second, coarser rounding MySQL's text protocol already applied.
      const [creatureRows] = await pool.query(
        `SELECT guid, ${CREATURE_IDS.join(', ')}, map, CAST(position_x AS DOUBLE) AS position_x, CAST(position_y AS DOUBLE) AS position_y FROM ${qualified(schema, 'creature')} WHERE ${where.sql}`,
        [wowPatch, wowPatch, ...where.params]
      );
      const [objectRows] = await pool.query(
        `SELECT guid, id, map, CAST(position_x AS DOUBLE) AS position_x, CAST(position_y AS DOUBLE) AS position_y FROM ${qualified(schema, 'gameobject')} WHERE ${where.sql}`,
        [wowPatch, wowPatch, ...where.params]
      );

      const creatureCount = new Map();
      const objectCount = new Map();
      for (const r of creatureRows) {
        const map = Number(r.map); const x = Number(r.position_x); const y = Number(r.position_y);
        if (!belongs(map, x, y)) continue;
        // Any of id..id5 may be the one spawned here (server/queries/db/spawns.js).
        const entries = [...new Set(CREATURE_IDS.map((c) => Number(r[c])).filter((e) => e > 0))];
        for (const e of entries) creatureCount.set(e, (creatureCount.get(e) ?? 0) + 1);
        if (map === home.mapId && worldMap && entries.length) dots.push({ kind: 'creature', entry: entries[0], x, y });
      }
      for (const r of objectRows) {
        const map = Number(r.map); const x = Number(r.position_x); const y = Number(r.position_y);
        if (!belongs(map, x, y)) continue;
        const e = Number(r.id);
        objectCount.set(e, (objectCount.get(e) ?? 0) + 1);
        if (map === home.mapId && worldMap) dots.push({ kind: 'gameobject', entry: e, x, y });
      }

      const creatureIds = [...creatureCount.keys()];
      const [creatureInfo] = creatureIds.length
        ? await pool.query(
            `SELECT t1.entry, t1.name, t1.level_min, t1.level_max FROM ${qualified(schema, 'creature_template')} t1
             WHERE t1.entry IN (${creatureIds.map(() => '?').join(', ')}) AND ${highestPatchClause(schema, 'creature_template', 't1')}`,
            [...creatureIds, wowPatch]
          )
        : [[]];
      const info = new Map(creatureInfo.map((r) => [Number(r.entry), r]));
      npcs = creatureIds.map((e) => ({
        entry: e,
        name: info.get(e)?.name ?? '',
        levelMin: Number(info.get(e)?.level_min ?? 0),
        levelMax: Number(info.get(e)?.level_max ?? 0),
        count: creatureCount.get(e)
      })).sort((a, b) => a.name.localeCompare(b.name) || a.entry - b.entry);

      const objectNames = await fetchNames(pool, { schema, kind: 'gameobject', ids: [...objectCount.keys()], wowPatch });
      objects = [...objectCount].map(([e, count]) => ({ entry: e, name: objectNames.get(e) ?? '', count }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.entry - b.entry);
    }
  }

  const [questRows] = await pool.query(
    `SELECT t1.entry, t1.Title, t1.QuestLevel FROM ${qualified(schema, 'quest_template')} t1
     WHERE t1.ZoneOrSort = ? AND ${highestPatchClause(schema, 'quest_template', 't1')}
     ORDER BY t1.QuestLevel, t1.Title`,
    [asked.entry, wowPatch]
  );

  const levels = npcs.flatMap((n) => [n.levelMin, n.levelMax]).filter((l) => l > 0);
  return {
    // A sub-area's own team is never read by the core: UpdateZone looks up
    // zoneEntry by the *zone* id and switches on zoneEntry->Team alone
    // (vmangos-core/src/game/Objects/Player.cpp:6772 `AreaEntry::GetById(newZone)`,
    // 6796-6811 `switch (zoneEntry->Team)`) - home is the zone row for a
    // sub-area (zoneRow) and the area's own row when it is already a zone
    // (asked, zoneRow null), so home.team is always the value the core acts on.
    area: { id: asked.entry, name: asked.name, mapId: asked.mapId, zoneId: asked.zoneId, team: home.team },
    zone: zoneRow ? { id: zoneRow.entry, name: zoneRow.name } : null,
    subAreas: areas.filter((a) => a.zoneId === asked.entry).map((a) => ({ id: a.entry, name: a.name })),
    worldMap,
    overlays,
    worldMapOutdated,
    terrain,
    terrainErrorCode,
    refused,
    npcs,
    objects,
    dots,
    levelRange: levels.length ? { min: Math.min(...levels), max: Math.max(...levels) } : null,
    quests: questRows.map((r) => ({ entry: Number(r.entry), title: r.Title ?? '', level: Number(r.QuestLevel) }))
  };
}
