import test from 'node:test';
import assert from 'node:assert/strict';
import { listZones } from '../server/queries/db/zones.js';
import { renderZoneIndex } from '../server/views/db/zoneList.js';
import { dbStubPool } from './helpers/dbStubPool.js';
import { dbApp, HEADERS, CONFIG } from './helpers/dbApp.js';

const ARGS = { schema: 'mangos', dbcSchema: 'dbc', wowPatch: 10 };

function stub() {
  return dbStubPool({
    world_map_area: [
      { area_id: 12, map_id: 0, name: 'Elwynn Forest', team: 2 },
      { area_id: 14, map_id: 1, name: 'Durotar', team: 4 }
    ],
    map_template: [
      { entry: 36, map_type: 1, linked_zone: 0, map_name: 'Deadmines' },
      { entry: 229, map_type: 1, linked_zone: 1583, map_name: 'Blackrock Spire' },
      { entry: 29, map_type: 1, linked_zone: 0, map_name: 'CashTest' }
    ],
    area_template: [
      { entry: 1581, map_id: 36, name: 'The Deadmines' },
      { entry: 210, map_id: 36, name: '***On Map Dungeon***' },
      { entry: 1579, map_id: 36, name: 'Unused The Deadmines 002' },
      { entry: 1583, map_id: 0, name: 'Blackrock Spire' },
      // The Deadmines collision (task-3-review.md): map 36 also carries two
      // genuine zone_id=0 rows that share a name with real Eastern Kingdoms
      // zones but are not Deadmines - neither is junk by isPlaceName's shape,
      // so only the map-name match tells them apart from 1581.
      { entry: 206, map_id: 36, name: 'Westfall' },
      { entry: 207, map_id: 36, name: 'The Great Sea' }
    ]
  });
}

test('listZones groups mapped zones by continent and instances by map, three statements', async () => {
  const s = stub();
  const data = await listZones(s.pool, ARGS);
  assert.equal(s.calls.length, 3);
  assert.deepEqual(data.continents.map((c) => [c.name, c.zones.map((z) => z.id)]), [['Eastern Kingdoms', [12]], ['Kalimdor', [14]]]);
  // Deadmines: its own zone rows, junk names dropped. Blackrock Spire: its
  // linked zone (vmangos-core/src/game/Maps/Map.h:161-162). CashTest: nothing
  // to link, so it is omitted.
  assert.deepEqual(data.instances.map((i) => [i.name, i.zones.map((z) => z.id)]), [['Deadmines', [1581]], ['Blackrock Spire', [1583]]]);
  assert.equal(data.referenceMissing, false);
  const templateCall = s.callsFor('map_template')[0];
  assert.deepEqual(templateCall.params, [10]);
});

test('a missing reference schema still lists instances and says why continents are empty', async () => {
  const pool = {
    query: async (sql) => {
      if (sql.includes('world_map_area')) { const e = new Error('x'); e.code = 'ER_BAD_DB_ERROR'; throw e; }
      return stub().pool.query(sql);
    }
  };
  const data = await listZones(pool, ARGS);
  assert.equal(data.referenceMissing, true);
  assert.equal(data.continents.length, 0);
  assert.equal(data.instances.length, 2);
  assert.match(renderZoneIndex(data), /reference schema/);
});

test('the index renders zone links with their side, and instances under their map type', () => {
  const html = renderZoneIndex({
    continents: [{ mapId: 0, name: 'Eastern Kingdoms', zones: [{ id: 12, name: 'Elwynn Forest', team: 2 }] }],
    instances: [{ mapId: 36, type: 1, name: 'Deadmines', zones: [{ id: 1581, name: 'The Deadmines' }] }],
    referenceMissing: false
  });
  assert.match(html, /<h2>Eastern Kingdoms<\/h2>/);
  assert.match(html, /href="\/db\/zone\/12"[^>]*>Elwynn Forest<\/a>/);
  assert.match(html, /Alliance/);
  assert.match(html, /<h2>Dungeons<\/h2>/);
  assert.match(html, /href="\/db\/zone\/1581"/);
});

test('/db/zones renders on the browser chrome with Zones active', async (t) => {
  const { app, executeCalls } = dbApp({ world: stub().pool, config: { ...CONFIG, mysql: { ...CONFIG.mysql, dbcSchema: 'dbc' } } });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/zones', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /class="nav-item active" href="\/db\/zones"/);
  assert.match(res.body, /Elwynn Forest/);
  assert.equal(executeCalls(), 0);
});

// M1: with no world database, /db/zones used to render a bare heading
// instead of the explanatory note every other listview gives.
test('/db/zones explains itself, not a bare heading, with no world database', async (t) => {
  const { app, executeCalls } = dbApp({ world: null });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/zones', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Zones are not available: the world database is not configured/);
  assert.equal(executeCalls(), 0);
});
