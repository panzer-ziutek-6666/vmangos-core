import test from 'node:test';
import assert from 'node:assert/strict';
import { mapPosition, renderZonePage } from '../server/views/db/zone.js';
import { dbStubPool } from './helpers/dbStubPool.js';
import { dbApp, HEADERS, CONFIG } from './helpers/dbApp.js';

const MAP = { name: 'Elwynn', left: 1535.42, right: -1935.42, top: -7939.58, bottom: -10254.2 };

function data(overrides = {}) {
  return {
    area: { id: 12, name: 'Elwynn Forest', mapId: 0, zoneId: 0, team: 2 },
    zone: null,
    subAreas: [{ id: 87, name: 'Goldshire' }],
    worldMap: MAP,
    terrain: 'ok',
    refused: [],
    npcs: [{ entry: 1, name: 'Guard', levelMin: 10, levelMax: 12, count: 2 }],
    objects: [{ entry: 2, name: 'Mailbox', count: 1 }],
    dots: [{ kind: 'creature', entry: 1, x: -9464, y: 62 }],
    levelRange: { min: 10, max: 12 },
    quests: [{ entry: 5, title: 'Kobold Camp Cleanup', level: 5 }],
    artAvailable: true,
    ...overrides
  };
}

// The map's corners are world_map_area's loc_* bounds (left/right in world y,
// top/bottom in world x); a point on a corner is 0% or 100%.
test('mapPosition maps the world rectangle onto the visible map', () => {
  assert.deepEqual(mapPosition(MAP, MAP.top, MAP.left), { left: 0, top: 0 });
  const corner = mapPosition(MAP, MAP.bottom, MAP.right);
  assert.ok(Math.abs(corner.left - 100) < 1e-9 && Math.abs(corner.top - 100) < 1e-9);
  assert.equal(mapPosition(MAP, 0, 0), null);
});

test('the page shows side, level range, map tiles with dots, lists and quests', () => {
  const html = renderZonePage(data());
  assert.match(html, /<h1>Elwynn Forest<\/h1>/);
  assert.match(html, /Alliance/);
  assert.match(html, /Creatures level 10–12/);
  assert.equal((html.match(/src="\/db\/art\/maps\/elwynn\/\d+\.png"/g) ?? []).length, 12);
  assert.match(html, /<a class="dot creature" href="\/db\/creature\/1" title="Guard" style="left:[\d.]+%;top:[\d.]+%"><\/a>/);
  assert.match(html, /href="\/db\/creature\/1"[\s\S]*?>Guard<\/a>[\s\S]*?<td>2<\/td>/);
  assert.match(html, /href="\/db\/zone\/87"/);
  assert.match(html, /href="\/db\/quest\/5"/);
});

test('each degradation explains itself instead of rendering blanks', () => {
  assert.match(renderZonePage(data({ terrain: 'unconfigured', npcs: [], objects: [], dots: [] })), /terrain\.mapsDir/);
  assert.match(renderZonePage(data({ terrain: 'missing', npcs: [], objects: [], dots: [] })), /maps directory .* not found/i);
  assert.match(renderZonePage(data({ terrain: 'missing', terrainErrorCode: 'ENOTDIR', npcs: [], objects: [], dots: [] })), /ENOTDIR/);
  // M5: a maps directory that lists fine but holds no .map file at all -
  // the likeliest cause is the key naming the server's data directory
  // instead of its extracted maps subdirectory.
  assert.match(renderZonePage(data({ terrain: 'empty', npcs: [], objects: [], dots: [] })), /holds no .*\.map.* files/i);
  assert.match(renderZonePage(data({ refused: ['0004932.map'] })), /0004932\.map/);
  assert.doesNotMatch(renderZonePage(data({ artAvailable: false })), /\/db\/art\/maps/);
  assert.doesNotMatch(renderZonePage(data({ worldMap: null })), /zone-map/);
  // M6: an old reference schema missing world_map_area.name 500'd every zone
  // page instead of explaining itself, same as the "not built at all" note
  // /db/zones already gives (zoneList.js).
  assert.match(renderZonePage(data({ worldMapOutdated: true })), /import-dbc/);
});

test('a sub-area names its parent zone', () => {
  assert.match(renderZonePage(data({ area: { id: 87, name: 'Goldshire', mapId: 0, zoneId: 12, team: 2 }, zone: { id: 12, name: 'Elwynn Forest' } })), /Part of .*href="\/db\/zone\/12"/s);
});

test('/db/zone/:id renders on the chrome, 404s an unknown id, 400s a bad one', async (t) => {
  const pool = dbStubPool({ map_template: [], quest_template: [], area_template: [{ entry: 12, map_id: 0, zone_id: 0, explore_flag: 12, name: 'Elwynn Forest', team: 2 }] }).pool;
  const { app, executeCalls } = dbApp({ world: pool });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/zone/12', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /class="nav-item active" href="\/db\/zones"/);
  assert.match(res.body, /Elwynn Forest/);
  const empty = dbApp({ world: dbStubPool({}).pool });
  t.after(() => empty.app.close());
  assert.equal((await empty.app.inject({ method: 'GET', url: '/db/zone/999', headers: HEADERS })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: '/db/zone/1e3', headers: HEADERS })).statusCode, 400);
  assert.equal(executeCalls(), 0);
});


// WorldMapFrame lays an overlay's 256-px tiles row by row from its offset in
// the 1002x668 map; the last column and row show only the remaining pixels of
// a texture whose file is the next power of two (a 300x200 overlay: tile 2 is
// 44 of a 64-px file wide, both tiles 200 of a 256-px file tall).
test('overlays are drawn tile by tile over the parchment, cropped to their size', () => {
  const html = renderZonePage(data({ overlays: [{ texture: 'NORTHSHIRE', width: 300, height: 200, x: 100, y: 50 }] }));
  assert.equal((html.match(/class="zone-overlay"/g) ?? []).length, 2);
  assert.match(html, /src="\/db\/art\/maps\/elwynn\/overlays\/northshire1\.png"/);
  assert.match(html, /left:9\.98%;top:7\.49%;width:25\.55%;height:29\.94%/);
  assert.match(html, /left:35\.53%;top:7\.49%;width:4\.39%;height:29\.94%[^>]*><img src="[^"]*northshire2\.png" alt="" style="width:145\.45%;height:128\.00%"/);
  assert.ok(html.indexOf('zone-overlay') < html.indexOf('class="dot'), 'overlays sit under the dots');
});
