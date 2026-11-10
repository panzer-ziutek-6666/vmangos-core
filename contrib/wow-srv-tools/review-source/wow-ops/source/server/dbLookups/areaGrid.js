import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Neither `creature` nor `gameobject` stores a zone: the core derives one from
// terrain every time it asks (TerrainInfo::GetZoneId,
// vmangos-core/src/game/Maps/GridMap.cpp:964-967). This module answers the
// same question the same way, from the server's own extracted .map files. It
// does no SQL; the area rows it resolves against are passed in.
//
// The arithmetic is float32 in the core (SIZE_OF_GRIDS is 533.33333f,
// vmangos-core/src/game/Maps/GridDefines.h:40), so every step is rounded
// through Math.fround to land in the same cell at a boundary.
const SIZE_OF_GRIDS = Math.fround(533.33333);
const HEADER_BYTES = 40;
const MAP_AREA_NO_AREA = 0x0001; // GridMapDefines.h:19

const f = Math.fround;
const scaled = (v) => f(32 - f(f(v) / SIZE_OF_GRIDS));

// TerrainInfo::GetGrid (GridMap.cpp:1132-1144): grid x comes from world y and
// grid y from world x - "It's reversed. That's ok" - truncated like a C cast.
export function gridOf(x, y) {
  return { gx: Math.trunc(scaled(y)), gy: Math.trunc(scaled(x)) };
}

// "maps/%03u%02u%02u.map" with (map, y, x) - GridMap.cpp:1158-1160.
export function gridFileName(mapId, gx, gy) {
  return `${String(mapId).padStart(3, '0')}${String(gy).padStart(2, '0')}${String(gx).padStart(2, '0')}.map`;
}

// GridMap::getArea (GridMap.cpp:257-266): 16 cells per grid on each axis, the
// cell index lx * 16 + ly with lx from world x and ly from world y.
export function cellIndex(x, y) {
  const lx = Math.trunc(f(16 * scaled(x))) & 15;
  const ly = Math.trunc(f(16 * scaled(y))) & 15;
  return lx * 16 + ly;
}

// GridMap::loadData / loadAreaData (GridMap.cpp:80-100, 151-166): the header
// must carry MAPS and z1.4 (GridMap.cpp:35-36) and the area section AREA
// (GridMap.cpp:37). No area offset means no area data: flag 0.
export function parseGridFile(buf) {
  if (buf.length < HEADER_BYTES || buf.toString('latin1', 0, 4) !== 'MAPS' || buf.toString('latin1', 4, 8) !== 'z1.4') {
    throw new Error('not a terrain file (header magic)');
  }
  const offset = buf.readUInt32LE(8);
  if (offset === 0) return { gridArea: 0, cells: null };
  if (buf.length < offset + 8 || buf.toString('latin1', offset, offset + 4) !== 'AREA') {
    throw new Error('not a terrain file (area magic)');
  }
  const flags = buf.readUInt16LE(offset + 4);
  const gridArea = buf.readUInt16LE(offset + 6);
  if (flags & MAP_AREA_NO_AREA) return { gridArea, cells: null };
  const cells = new Uint16Array(256);
  for (let i = 0; i < 256; i++) cells[i] = buf.readUInt16LE(offset + 8 + i * 2);
  return { gridArea, cells };
}

// Read on first use per map, then held: 1114 of this realm's 2429 grid files
// carry a 512-byte cell array and the rest one flag, 570 KB in all. A cold
// disk took 8.5 s to read every map's files and a warm one 116 ms, so nothing
// is read at boot.
// ponytail: whole-map load, no eviction; per-grid lazy reads if memory ever matters.
const cache = new Map();

// A misconfigured mapsDir must never turn into a 500 (the spec's own rule):
// existsSync failing is handled below as before, but a directory that exists
// and cannot be listed (ENOTDIR - mapsDir points at a file; EACCES) used to
// let readdirSync throw straight out of this function. It is now caught the
// same way existsSync's false already was - `missing: true`, with the
// listing error's code kept so the page's note can say which it was.
//
// A directory that lists fine but holds no `.map` file at all is a second,
// silent failure mode: the likeliest cause is pointing the key at the
// server's data directory (the role the key itself names) rather than at
// its `maps` subdirectory. Every spawn then resolves to nothing, and with no
// distinct state `terrain` stayed 'ok' and the page said "NPCs (0)" with no
// explanation - `empty: true` gives the page something to say instead.
export function mapGrids(mapsDir, mapId) {
  const key = `${mapsDir}\0${mapId}`;
  if (cache.has(key)) return cache.get(key);

  let result;
  if (!existsSync(mapsDir)) {
    result = { grids: new Map(), refused: [], missing: true, empty: false, errorCode: null };
  } else {
    let names;
    try {
      names = readdirSync(mapsDir);
    } catch (err) {
      result = { grids: new Map(), refused: [], missing: true, empty: false, errorCode: err.code ?? null };
      cache.set(key, result);
      return result;
    }

    const prefix = String(mapId).padStart(3, '0');
    const grids = new Map();
    const refused = [];
    let anyMapFile = false;
    for (const name of names) {
      if (!name.endsWith('.map')) continue;
      anyMapFile = true;
      if (name.length !== 11 || !name.startsWith(prefix)) continue;
      const gy = Number(name.slice(3, 5));
      const gx = Number(name.slice(5, 7));
      try {
        grids.set(`${gx},${gy}`, parseGridFile(readFileSync(join(mapsDir, name))));
      } catch {
        refused.push(name);
      }
    }
    result = { grids, refused, missing: false, empty: !anyMapFile, errorCode: null };
  }
  cache.set(key, result);
  return result;
}

export function clearAreaGridCache() {
  cache.clear();
}

// A grid with no file is loaded empty by the core (GridMap::loadData returns
// true with no data, GridMap.cpp:84-86), so its flag is 0, and so is a refused one.
export function areaFlagAt(grids, x, y) {
  const { gx, gy } = gridOf(x, y);
  const grid = grids.get(`${gx},${gy}`);
  if (!grid) return 0;
  return grid.cells ? grid.cells[cellIndex(x, y)] : grid.gridArea;
}

// AreaEntry::GetByAreaFlagAndMap (vmangos-core/src/game/Maps/Map.h:143-165)
// scans every area in entry order for each lookup; the index groups rows by
// flag once so the page can resolve thousands of spawns without that scan.
export function areaIndex(areas) {
  const byFlag = new Map();
  const byEntry = new Map();
  for (const a of areas) {
    byEntry.set(a.entry, a);
    if (!a.exploreFlag) continue;
    if (!byFlag.has(a.exploreFlag)) byFlag.set(a.exploreFlag, []);
    byFlag.get(a.exploreFlag).push(a);
  }
  return { byFlag, byEntry };
}

// The first match on the same map; else the last match on any map ("1.12.1
// areatable have duplicates for areaflag"); else the map's linked zone,
// map_template.linked_zone (Map.h:161-162). Flag 0 never matches a row.
export function resolveArea(index, flag, mapId, linkedZone) {
  const candidates = flag ? index.byFlag.get(flag) : undefined;
  if (candidates?.length) {
    return candidates.find((a) => a.mapId === mapId) ?? candidates[candidates.length - 1];
  }
  return index.byEntry.get(linkedZone) ?? null;
}

// TerrainManager::GetZoneIdByAreaFlag (GridMap.cpp:1299-1305) with
// AreaEntry::IsZone (Map.h:119): a row with no parent is its own zone.
export function zoneIdOf(area) {
  if (!area) return 0;
  return area.zoneId === 0 ? area.entry : area.zoneId;
}
