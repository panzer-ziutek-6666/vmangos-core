import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  gridOf, gridFileName, cellIndex, parseGridFile, mapGrids, areaFlagAt,
  areaIndex, resolveArea, zoneIdOf, clearAreaGridCache
} from '../server/dbLookups/areaGrid.js';

// A terrain file as the core's extractor writes it: a 40-byte
// GridMapFileHeader (vmangos-core/src/game/Maps/GridMapDefines.h:5-17), then
// the area section at areaMapOffset - an 8-byte GridMapAreaHeader
// (GridMapDefines.h:21-26) and, unless flags has MAP_AREA_NO_AREA, 256 uint16.
function gridFile({ flat = null, cells = null, magic = 'MAPS', version = 'z1.4', areaMagic = 'AREA' } = {}) {
  const header = Buffer.alloc(40);
  header.write(magic, 0, 'latin1');
  header.write(version, 4, 'latin1');
  header.writeUInt32LE(40, 8);
  const area = Buffer.alloc(flat === null ? 8 + 512 : 8);
  area.write(areaMagic, 0, 'latin1');
  area.writeUInt16LE(flat === null ? 0 : 1, 4);
  area.writeUInt16LE(flat ?? 0, 6);
  if (flat === null) cells.forEach((v, i) => area.writeUInt16LE(v, 8 + i * 2));
  return Buffer.concat([header, area]);
}

// Goldshire, Elwynn Forest: x -9464, y 62. 32 - x/533.33333 = 49.745,
// 32 - y/533.33333 = 31.88 - so grid (gx 31, gy 49), exactly as
// TerrainInfo::GetGrid swaps the axes (GridMap.cpp:1135-1136), and the file
// is map, gy, gx (GridMap.cpp:1160): 0004931.map.
test('grid arithmetic follows the core, axes swapped', () => {
  assert.deepEqual(gridOf(-9464, 62), { gx: 31, gy: 49 });
  assert.equal(gridFileName(0, 31, 49), '0004931.map');
  // 16 * 49.745 = 795.9 -> & 15 = 11; 16 * 31.88 = 510.1 -> & 15 = 14.
  assert.equal(cellIndex(-9464, 62), 11 * 16 + 14);
});

// M4: nothing above pins an edge cell or the float32 rule itself - every
// case is far from a boundary, and still passes if every Math.fround is
// deleted. GridDefines.h:40's SIZE_OF_GRIDS is 533.33333f: at x = 13300,
// float64 arithmetic (16 * (32 - 13300/533.33333)) gives 112.99999750625,
// truncating into cell row 0; the core's own float32 arithmetic gives
// exactly 113.0, cell row 1 - the two disagree, so this only passes with
// every fround step kept.
test('cellIndex lands in the core\'s float32 cell at a boundary, not float64\'s', () => {
  assert.equal(cellIndex(13300, 0) >> 4, 1);
});

// x = SIZE_OF_GRIDS itself (one grid width, exactly on the line between grid
// 31 and grid 32): scaled(x) is exactly 31, so the cell fraction is exactly
// 0 - the boundary must truncate cleanly into the next grid's first cell,
// never spill into the last cell (15) of the grid behind it.
test('cellIndex truncates cleanly on an exact grid boundary', () => {
  const x = Math.fround(533.33333);
  assert.deepEqual(gridOf(x, 0), { gx: 32, gy: 31 });
  assert.equal(cellIndex(x, 0), 0);
});

test('parseGridFile reads a flat grid and a cell array, and refuses a wrong magic', () => {
  assert.deepEqual(parseGridFile(gridFile({ flat: 12 })), { gridArea: 12, cells: null });
  const cells = Array.from({ length: 256 }, (_, i) => i);
  const parsed = parseGridFile(gridFile({ cells }));
  assert.equal(parsed.cells[200], 200);
  assert.throws(() => parseGridFile(gridFile({ flat: 1, magic: 'XXXX' })), /^Error: not a terrain file/);
  assert.throws(() => parseGridFile(gridFile({ flat: 1, areaMagic: 'XXXX' })), /^Error: not a terrain file/);
});

test('mapGrids loads one map, caches it, and reports refused and missing files', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'grid-'));
  t.after(() => { rmSync(dir, { recursive: true, force: true }); clearAreaGridCache(); });
  const cells = Array(256).fill(9);
  cells[11 * 16 + 14] = 87;
  writeFileSync(join(dir, '0004931.map'), gridFile({ cells }));
  writeFileSync(join(dir, '0004932.map'), gridFile({ flat: 1, magic: 'XXXX' }));
  writeFileSync(join(dir, '0014931.map'), gridFile({ flat: 5 }));

  const { grids, refused } = mapGrids(dir, 0);
  assert.equal(grids.size, 1);
  assert.deepEqual(refused, ['0004932.map']);
  assert.equal(areaFlagAt(grids, -9464, 62), 87);
  assert.equal(areaFlagAt(grids, -9464, 70), 9);
  assert.equal(areaFlagAt(grids, 0, 0), 0);
  assert.equal(mapGrids(dir, 0), mapGrids(dir, 0));
  assert.equal(mapGrids(join(dir, 'nope'), 0).missing, true);
});

// M5: a maps directory that cannot be listed (ENOTDIR - the key points at a
// file, or a permissions error) used to throw straight out of mapGrids and
// 500 every zone page; existsSync alone does not catch this, since the path
// exists, it just cannot be read as a directory.
test('mapGrids treats an unlistable directory as missing, not a throw, and keeps the error code', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'grid-'));
  t.after(() => { rmSync(dir, { recursive: true, force: true }); clearAreaGridCache(); });
  const notADir = join(dir, 'file.txt');
  writeFileSync(notADir, 'not a directory');

  const result = mapGrids(notADir, 0);
  assert.equal(result.missing, true);
  assert.equal(result.errorCode, 'ENOTDIR');
  assert.deepEqual(result.grids, new Map());
});

// M5: a directory that lists fine but holds no .map file at all is the
// likeliest sign of terrain.mapsDir pointing at the server's data directory
// (the role the key names) instead of its extracted maps subdirectory -
// every spawn silently resolves to nothing with no distinct state to say so.
test('mapGrids reports a directory with no .map file as empty, not ok', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'grid-'));
  t.after(() => { rmSync(dir, { recursive: true, force: true }); clearAreaGridCache(); });
  writeFileSync(join(dir, 'realmd.conf'), 'not terrain');

  const result = mapGrids(dir, 0);
  assert.equal(result.missing, false);
  assert.equal(result.empty, true);
  assert.equal(result.grids.size, 0);
});

// AreaEntry::GetByAreaFlagAndMap (vmangos-core/src/game/Maps/Map.h:143-165):
// ascending entry order; the first non-zero flag match on the same map wins;
// else the last match on any map; else the map's linked zone.
test('resolveArea mirrors GetByAreaFlagAndMap, and zoneIdOf its IsZone rule', () => {
  const areas = [
    { entry: 12, mapId: 0, zoneId: 0, exploreFlag: 12 },
    { entry: 87, mapId: 0, zoneId: 12, exploreFlag: 87 },
    { entry: 300, mapId: 1, zoneId: 0, exploreFlag: 50 },
    { entry: 301, mapId: 1, zoneId: 0, exploreFlag: 50 },
    { entry: 400, mapId: 0, zoneId: 0, exploreFlag: 50 },
    { entry: 1583, mapId: 0, zoneId: 0, exploreFlag: 60 }
  ];
  const index = areaIndex(areas);
  assert.equal(resolveArea(index, 87, 0, 0).entry, 87);
  assert.equal(resolveArea(index, 50, 0, 0).entry, 400);
  assert.equal(resolveArea(index, 50, 9, 0).entry, 400);
  assert.equal(resolveArea(index, 0, 229, 1583).entry, 1583);
  assert.equal(resolveArea(index, 0, 229, 0), null);
  assert.equal(zoneIdOf(resolveArea(index, 87, 0, 0)), 12);
  assert.equal(zoneIdOf(resolveArea(index, 12, 0, 0)), 12);
  assert.equal(zoneIdOf(null), 0);
});
