import test from 'node:test';
import assert from 'node:assert/strict';
import { renderZoneTooltip } from '../server/views/db/zoneTooltip.js';
import { renderFactionTooltip } from '../server/views/db/factionTooltip.js';
import { fetchZoneRow } from '../server/queries/db/zones.js';
import { fetchFactionRow } from '../server/queries/db/factions.js';
import { dbStubPool } from './helpers/dbStubPool.js';
import { dbApp, HEADERS } from './helpers/dbApp.js';

test('the zone card names the zone, its side and its continent', () => {
  const html = renderZoneTooltip({ entry: 12, name: 'Elwynn Forest', map_id: 0, zone_id: 0, team: 2, map_type: null });
  assert.match(html, /Elwynn Forest/);
  assert.match(html, /Alliance/);
  assert.match(html, /Eastern Kingdoms/);
});

// Ruling 4 (M2): the card gains the instance type through map_template,
// labelled via MAP_TYPES (DBCEnums.h:145-148) - a continent map_id keeps its
// CONTINENTS name regardless of map_type (tested above).
test('the zone card names an instanced zone\'s type, not its raw map id', () => {
  const html = renderZoneTooltip({ entry: 1581, name: 'The Deadmines', map_id: 36, zone_id: 0, team: 0, map_type: 1 });
  assert.match(html, /Dungeons/);
  assert.doesNotMatch(html, /Instance map/);
});

// I1: the card's team is fetchZoneRow's own COALESCE(z.team, a.team) - the
// same fact the zone page shows (Player.cpp:6796-6811 switches on the
// *zone's* Team, never a sub-area's own; db-zone-loader.test.js's "a
// sub-area reports its zone's team, not its own" is loadZone's version of
// this). Goldshire's own row is team 0; its card must still read Alliance.
test('the zone card names a sub-area\'s zone\'s side, not its own', () => {
  const html = renderZoneTooltip({ entry: 87, name: 'Goldshire', map_id: 0, zone_id: 12, team: 2, map_type: null });
  assert.match(html, /Alliance/);
});

test('the faction card names the faction and says whether it carries reputation', () => {
  assert.match(renderFactionTooltip({ id: 72, name: 'Stormwind', description: 'The capital.', reputation_list_id: 19 }), /Stormwind[\s\S]*The capital\./);
  assert.match(renderFactionTooltip({ id: 35, name: 'Friendly', description: '', reputation_list_id: -1 }), /no reputation/);
});

// Ruling 4 (M2): the card gains its parent faction's name as its side.
test('the faction card names its parent faction as its side', () => {
  const html = renderFactionTooltip({ id: 72, name: 'Stormwind', description: 'The capital.', reputation_list_id: 19, parent_name: 'Alliance' });
  assert.match(html, /Alliance/);
});

test('fetchZoneRow reads area_template by entry, one query, and null on a miss', async () => {
  const stub = dbStubPool({ area_template: [{ entry: 12, name: 'Elwynn Forest', map_id: 0, zone_id: 0, team: 2 }] });
  const row = await fetchZoneRow(stub.pool, { schema: 'mangos', id: 12, wowPatch: 10 });
  assert.equal(row.name, 'Elwynn Forest');
  assert.equal(stub.calls.length, 1);
  assert.equal(await fetchZoneRow(stub.pool, { schema: 'mangos', id: 999, wowPatch: 10 }), null);
});

// I1 at the query level: the stub cannot execute the join itself (it is a
// real MySQL feature, verified live in db-zones-live.test.js), so Goldshire's
// row here already carries the value the SQL's self-join and COALESCE would
// resolve it to (2, Elwynn's team) - what the SQL text asserts below is the
// join and COALESCE that make a real database do that resolution.
test('fetchZoneRow\'s query resolves a sub-area\'s team through its zone via a self-join', async () => {
  const stub = dbStubPool({ area_template: [{ entry: 87, name: 'Goldshire', map_id: 0, zone_id: 12, team: 2 }] });
  const row = await fetchZoneRow(stub.pool, { schema: 'mangos', id: 87, wowPatch: 10 });
  assert.equal(row.team, 2);
  assert.equal(stub.calls.length, 1);
  assert.match(stub.calls[0].sql, /COALESCE\(z\.team, a\.team\)/);
  assert.match(stub.calls[0].sql, /z\.entry = a\.zone_id/);
  assert.match(stub.calls[0].sql, /m\.entry = a\.map_id/);
  assert.deepEqual(stub.calls[0].params, [10, 87]);
});

test('fetchFactionRow reads faction through highestBuildClause, one query, and null on a miss', async () => {
  const stub = dbStubPool({ faction: [{ id: 72, name: 'Stormwind', description: '', reputation_list_id: 19 }] });
  const row = await fetchFactionRow(stub.pool, { schema: 'mangos', id: 72, clientBuild: 5875 });
  assert.equal(row.name, 'Stormwind');
  assert.equal(stub.calls.length, 1);
  assert.match(stub.calls[0].sql, /build/);
  // Ruling 4 (M2): a self-join for the parent's name, build-keyed like the
  // row itself - clientBuild is bound twice, once per join/where clause.
  assert.match(stub.calls[0].sql, /LEFT JOIN .*`faction` p ON p\.id = t1\.team/);
  assert.deepEqual(stub.calls[0].params, [5875, 72, 5875]);
  assert.equal(await fetchFactionRow(stub.pool, { schema: 'mangos', id: 999, clientBuild: 5875 }), null);
});

test('each card route issues exactly one query and never reaches SOAP', async (t) => {
  const stub = dbStubPool({ area_template: [{ entry: 12, name: 'Elwynn Forest', map_id: 0, zone_id: 0, team: 2 }], faction: [{ id: 72, name: 'Stormwind', description: '', reputation_list_id: 19 }] });
  const { app, executeCalls } = dbApp({ world: stub.pool });
  t.after(() => app.close());
  const zone = await app.inject({ method: 'GET', url: '/db/tooltip/zone/12', headers: HEADERS });
  assert.match(zone.body, /Elwynn Forest/);
  assert.doesNotMatch(zone.body, /<html/);
  assert.equal(stub.calls.length, 1);
  const faction = await app.inject({ method: 'GET', url: '/db/tooltip/faction/72', headers: HEADERS });
  assert.match(faction.body, /Stormwind/);
  assert.equal(stub.calls.length, 2);
  assert.equal((await app.inject({ method: 'GET', url: '/db/tooltip/zone/x', headers: HEADERS })).statusCode, 400);
  const empty = dbApp({ world: dbStubPool({}).pool });
  t.after(() => empty.app.close());
  assert.equal((await empty.app.inject({ method: 'GET', url: '/db/tooltip/faction/9', headers: HEADERS })).statusCode, 404);
  assert.equal(executeCalls(), 0);
});
