import { withMissingReference, qualified } from './sql.js';
import { highestPatchClause } from './progressive.js';

// The two continents the client's world map offers; every other map is an
// instance. Named as the world map's continent drop-down names them.
export const CONTINENTS = new Map([[0, 'Eastern Kingdoms'], [1, 'Kalimdor']]);

// map_template.map_type is the core's MapTypes (MAP_INSTANCE 1, MAP_RAID 2,
// MAP_BATTLEGROUND 3; vmangos-core/src/game/Database/DBCEnums.h:145-148).
export const MAP_TYPES = new Map([[1, 'Dungeons'], [2, 'Raids'], [3, 'Battlegrounds']]);

// area_template carries editor leftovers ("***On Map Dungeon***", "Unused The
// Deadmines 002") as real zone rows; they are not places a player can go.
function isPlaceName(name) {
  return !String(name).startsWith('*') && !/unused/i.test(String(name));
}

// map_template.map_name and area_template.name both name the same place for
// an instance's own zone, but not byte for byte: "Deadmines" (the map) vs
// "The Deadmines" (the zone). Case and a leading article are the only
// difference this realm's data shows, so both are dropped before comparing.
function ownZoneName(name) {
  return String(name).trim().replace(/^the\s+/i, '').toLowerCase();
}

// The zone row(s) an instance with no linked_zone links to. Matching the
// map's own name against the zone's name (ownZoneName) comes first: map 36
// (Deadmines) also carries area_template rows 206 "Westfall" and 207 "The
// Great Sea", genuine zone_id=0 rows on that map_id, not editor leftovers -
// isPlaceName alone can't tell them apart from the actual Deadmines zone
// (review finding, live realm 2026-09-23). Only when no row's name matches
// the map's does every place-named row on the map apply, as before - true of
// Emerald Dream and Caverns of Time, where the map name never equals any one
// zone's name because the instance covers more than one real zone.
function ownZones(m, zoneRows) {
  const mapId = Number(m.entry);
  const onMap = zoneRows.filter((z) => Number(z.map_id) === mapId);
  const byName = onMap.filter((z) => ownZoneName(z.name) === ownZoneName(m.map_name));
  return byName.length ? byName : onMap.filter((z) => isPlaceName(z.name));
}

// The zone hover card's whole read (GET /db/tooltip/zone/:id,
// server/sections/db.js), one query total, never loadZone. area_template
// carries no patch or build column - it is loaded with a plain
// sAreaStorage.Load() (ObjectMgr.cpp:12120), not LoadProgressive - so the
// only bounded read here is map_template's own patch clause.
//
// Two joins fold into this single statement:
// - I1: a sub-area's own team is never what the core acts on - UpdateZone
//   switches on the *zone's* Team (Player.cpp:6796-6811), not the area's own,
//   which is what loadZone's home.team already returns for the page. The
//   self-join plus COALESCE gives the card the same fact from one row instead
//   of loadZone's full-table read.
// - Ruling 4 (M2): map_template, patch-clause joined, gives the card the
//   instance type (renderZoneTooltip labels it through MAP_TYPES); the two
//   continent maps keep their CONTINENTS names instead.
// The row is picked out of the result set by id rather than trusted as
// rows[0], the same rule every other single-row read in this section follows.
export async function fetchZoneRow(pool, { schema, id, wowPatch }) {
  const areaTable = qualified(schema, 'area_template');
  const [rows] = await pool.query(
    `SELECT a.entry, a.name, a.map_id, a.zone_id, COALESCE(z.team, a.team) AS team, m.map_type
     FROM ${areaTable} a
     LEFT JOIN ${areaTable} z ON z.entry = a.zone_id AND a.zone_id <> 0
     LEFT JOIN ${qualified(schema, 'map_template')} m ON m.entry = a.map_id AND ${highestPatchClause(schema, 'map_template', 'm')}
     WHERE a.entry = ?`,
    [wowPatch, id]
  );
  return rows.find((r) => Number(r.entry) === id) ?? null;
}

// Three statements: the mapped zones (the reference schema's world_map_area,
// joined to the world's area_template for name and side), the instance maps
// (map_template, patch-keyed like every template table,
// vmangos-core/src/shared/Database/SQLStorageImpl.h:364), and the zone rows
// those maps can link to.
export async function listZones(pool, { schema, dbcSchema, wowPatch }) {
  const mapped = dbcSchema
    ? await withMissingReference(null, async () => (await pool.query(
        `SELECT w.area_id, w.map_id, a.name, a.team
         FROM ${qualified(dbcSchema, 'world_map_area')} w
         JOIN ${qualified(schema, 'area_template')} a ON a.entry = w.area_id
         WHERE w.area_id <> 0
         ORDER BY a.name`
      ))[0])
    : null;

  const [maps] = await pool.query(
    `SELECT t1.entry, t1.map_type, t1.linked_zone, t1.map_name
     FROM ${qualified(schema, 'map_template')} t1
     WHERE t1.map_type IN (1, 2, 3) AND ${highestPatchClause(schema, 'map_template', 't1')}
     ORDER BY t1.map_type, t1.map_name`,
    [wowPatch]
  );

  const mapIds = maps.map((m) => Number(m.entry));
  const linked = maps.map((m) => Number(m.linked_zone)).filter((z) => z > 0);
  const [zoneRows] = mapIds.length
    ? await pool.query(
        `SELECT entry, map_id, name FROM ${qualified(schema, 'area_template')}
         WHERE (zone_id = 0 AND map_id IN (${mapIds.map(() => '?').join(', ')}))${linked.length ? ` OR entry IN (${linked.map(() => '?').join(', ')})` : ''}
         ORDER BY entry`,
        [...mapIds, ...linked]
      )
    : [[]];

  const continents = [...CONTINENTS].map(([mapId, name]) => ({
    mapId,
    name,
    zones: (mapped ?? []).filter((r) => Number(r.map_id) === mapId)
      .map((r) => ({ id: Number(r.area_id), name: r.name ?? '', team: Number(r.team) }))
  })).filter((c) => c.zones.length > 0);

  // A map's own link first (the zone the core resolves a flag-0 grid there to,
  // vmangos-core/src/game/Maps/Map.h:161-162); else ownZones above.
  const instances = maps.map((m) => {
    const mapId = Number(m.entry);
    const linkedZone = Number(m.linked_zone);
    const rows = linkedZone > 0
      ? zoneRows.filter((z) => Number(z.entry) === linkedZone)
      : ownZones(m, zoneRows);
    return { mapId, type: Number(m.map_type), name: m.map_name ?? '', zones: rows.map((z) => ({ id: Number(z.entry), name: z.name ?? '' })) };
  }).filter((i) => i.zones.length > 0);

  return { continents, instances, referenceMissing: mapped === null };
}
