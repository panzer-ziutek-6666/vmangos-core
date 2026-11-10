import test from 'node:test';
import assert from 'node:assert/strict';
import { listFactions } from '../server/queries/db/factions.js';
import { loadFaction } from '../server/queries/db/faction.js';
import { repRank, repLabel, renderFactionIndex, renderFactionPage } from '../server/views/db/faction.js';
import { dbStubPool } from './helpers/dbStubPool.js';
import { dbApp, HEADERS, CONFIG } from './helpers/dbApp.js';

// ReputationMgr::ReputationToRank (vmangos-core/src/game/ReputationMgr.cpp:32-42)
// with PointsInRank (:30) and Reputation_Cap 42999 (ReputationMgr.h:71).
test('repRank uses the core thresholds', () => {
  assert.deepEqual([-42000, -6001, -6000, -3000, -1, 0, 2999, 3000, 9000, 21000, 42000, 42999].map(repRank),
    [0, 0, 1, 2, 2, 3, 3, 4, 5, 6, 7, 7]);
  assert.equal(repLabel(3100), '3100 (Friendly)');
});

// Stormwind's real live rows (task-6-review.md, confirmed live 2026-09-23):
// {Dwarf,NightElf,Gnome: 3100}, {Orc,Undead,Tauren,Troll: -42000},
// {Human: 4000}, {any race, any class: 0}. The first three, all class-
// unrestricted, already cover every playable race (76 | 178 | 1 == 255,
// RACEMASK_ALL_PLAYABLE) - the fourth is Walk finding B's dead set.
const STORMWIND = {
  id: 72, reputation_list_id: 19, team: 469, name: 'Stormwind', description: 'The capital.',
  base_rep_race_mask1: 76, base_rep_class_mask1: 0, base_rep_value1: 3100,
  base_rep_race_mask2: 178, base_rep_class_mask2: 0, base_rep_value2: -42000,
  base_rep_race_mask3: 1, base_rep_class_mask3: 0, base_rep_value3: 4000,
  base_rep_race_mask4: 0, base_rep_class_mask4: 0, base_rep_value4: 0
};

function stub() {
  return dbStubPool({
    faction_template: [{ id: 11 }, { id: 12 }],
    creature_onkill_reputation: [{ creature_id: 68, RewOnKillRepFaction1: 72, RewOnKillRepValue1: 25, MaxStanding1: 7, RewOnKillRepFaction2: 0, RewOnKillRepValue2: 0, MaxStanding2: 0 }],
    creature_template: [{ entry: 68, name: 'Stormwind City Guard', level_min: 55, level_max: 56 }],
    quest_template: [{ entry: 7, Title: 'A Stormwind Errand', QuestLevel: 10, RewRepFaction1: 72, RewRepValue1: 250, RewRepFaction2: 0, RewRepValue2: 0, RewRepFaction3: 0, RewRepValue3: 0, RewRepFaction4: 0, RewRepValue4: 0, RewRepFaction5: 0, RewRepValue5: 0 }],
    item_template: [{ entry: 9, name: 'Stormwind Tabard', quality: 1, required_reputation_rank: 7 }],
    faction: [STORMWIND, { id: 469, name: 'Alliance' }]
  });
}

test('loadFaction reads the faction, its members and how to earn it, each through its key', async () => {
  const s = stub();
  const data = await loadFaction({ world: s.pool }, CONFIG, 72);
  assert.equal(data.faction.name, 'Stormwind');
  assert.deepEqual(data.faction.parent, { id: 469, name: 'Alliance' });
  // GetIndexFitTo (vmangos-core/src/game/Database/DBCStructure.h:328-338)
  // takes the first set that matches. Walk finding B: sets 1-3 are all
  // class-unrestricted and already cover every playable race between them
  // (RACEMASK_ALL_PLAYABLE, SharedDefines.h:72-75), so the 4th set (any
  // race, any class: 0) can never be reached and baseRep lists three, not
  // four.
  assert.deepEqual(data.baseRep.map((b) => b.value), [3100, -42000, 4000]);
  assert.deepEqual(data.npcs.map((n) => n.entry), [68]);
  assert.deepEqual(data.onKill, [{ entry: 68, name: 'Stormwind City Guard', value: 25, maxStanding: 7 }]);
  assert.deepEqual(data.quests, [{ entry: 7, title: 'A Stormwind Errand', level: 10, value: 250 }]);
  assert.equal(data.items[0].rank, 7);
  const npcCall = s.calls.find((c) => /t1\.faction IN/.test(c.sql));
  assert.deepEqual(npcCall.params, [11, 12, 10]);
  const factionCall = s.callsFor('`faction` t1')[0];
  assert.match(factionCall.sql, /t2\.id = t1\.id AND t2\.build <= \?/);
  // M7: pin the count instead of a loose upper bound.
  assert.equal(s.calls.length, 8);
});

// The other direction of walk finding B: sets that never cover every playable
// race between them are all reachable, so all four are listed.
test('starting reputation keeps every set while the races they cover stay incomplete', async () => {
  const partial = { ...STORMWIND, base_rep_race_mask3: 0, base_rep_class_mask3: 128, base_rep_value3: 500, base_rep_race_mask4: 0, base_rep_class_mask4: 256, base_rep_value4: 600 };
  const s = dbStubPool({ faction: [partial, { id: 469, name: 'Alliance' }] });
  const data = await loadFaction({ world: s.pool }, CONFIG, 72);
  assert.deepEqual(data.baseRep.map((b) => b.value), [3100, -42000, 500, 600]);
});

test('an unknown faction is null', async () => {
  assert.equal(await loadFaction({ world: dbStubPool({}).pool }, CONFIG, 99999), null);
});

test('the faction page shows starting standing by race, members and ways to earn it', () => {
  const html = renderFactionPage({
    faction: { id: 72, name: 'Stormwind', description: 'The capital.', reputationListId: 19, parent: { id: 469, name: 'Alliance' } },
    baseRep: [{ raceMask: 76, classMask: 0, value: 3100 }],
    npcs: [{ entry: 68, name: 'Stormwind City Guard', levelMin: 55, levelMax: 56 }],
    onKill: [{ entry: 68, name: 'Stormwind City Guard', value: -25, maxStanding: 7 }],
    quests: [{ entry: 7, title: 'A Stormwind Errand', level: 10, value: 250 }],
    items: [{ entry: 9, name: 'Stormwind Tabard', quality: 1, rank: 7 }],
    names: { item: new Map([[9, 'Stormwind Tabard']]), itemQuality: new Map([[9, 1]]) }
  });
  assert.match(html, /<h1>Stormwind<\/h1>/);
  assert.match(html, /href="\/db\/faction\/469"/);
  assert.match(html, /3100 \(Friendly\)/);
  // Mask 76 is bits 2, 3 and 6: races 3, 4 and 7 (server/dbLookups/questFlags.js).
  assert.match(html, /Dwarf, Night Elf, Gnome/);
  assert.match(html, /href="\/db\/creature\/68"/);
  assert.match(html, /-25/);
  assert.match(html, /href="\/db\/quest\/7"/);
  assert.match(html, /Exalted/);
});

test('/db/factions groups by parent and puts internal factions last; /db/faction/:id renders', async (t) => {
  const pool = dbStubPool({ faction: [
    { id: 72, name: 'Stormwind', reputation_list_id: 19, team: 469 },
    { id: 469, name: 'Alliance', reputation_list_id: -1, team: 0 },
    { id: 35, name: 'Friendly', reputation_list_id: -1, team: 0 }
  ] }).pool;
  const data = await listFactions(pool, { schema: 'mangos', clientBuild: 5875 });
  assert.deepEqual(data.groups.map((g) => [g.name, g.factions.map((f) => f.id)]), [['Alliance', [72]]]);
  assert.deepEqual(data.internal.map((f) => f.id), [469, 35]);
  assert.match(renderFactionIndex(data), /href="\/db\/faction\/72"/);

  const { app, executeCalls } = dbApp({ world: pool });
  t.after(() => app.close());
  const index = await app.inject({ method: 'GET', url: '/db/factions', headers: HEADERS });
  assert.match(index.body, /class="nav-item active" href="\/db\/factions"/);
  assert.equal((await app.inject({ method: 'GET', url: '/db/faction/abc', headers: HEADERS })).statusCode, 400);
  // M7: the 404 path was untested.
  assert.equal((await app.inject({ method: 'GET', url: '/db/faction/99999', headers: HEADERS })).statusCode, 404);
  assert.equal(executeCalls(), 0);
});

// M1: with no world database, /db/factions used to render a bare heading
// instead of the explanatory note every other listview gives.
test('/db/factions explains itself, not a bare heading, with no world database', async (t) => {
  const { app, executeCalls } = dbApp({ world: null });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/factions', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Factions are not available: the world database is not configured/);
  assert.equal(executeCalls(), 0);
});
