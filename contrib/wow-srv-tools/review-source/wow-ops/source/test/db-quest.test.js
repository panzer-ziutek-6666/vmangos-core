import test from 'node:test';
import assert from 'node:assert/strict';
import { dbStubPool } from './helpers/dbStubPool.js';
import { loadQuest } from '../server/queries/db/quest.js';
import { renderQuestPage } from '../server/views/db/quest.js';

const CONFIG = {
  mysql: { world: { database: 'mangos' } },
  realm: { id: 1, wowPatch: 10, clientBuild: 5875 }
};

// Every numbered column family has to be present, because loadQuest reads all
// four (or six) slots of each and a missing key would read as undefined rather
// than as an empty slot.
function questRow(overrides = {}) {
  const row = { entry: 176, patch: 0, Title: 'Wanted: Hogger', Details: '', Objectives: '', OfferRewardText: '', RequestItemsText: '', EndText: '', RequiredRaces: 0, RequiredClasses: 0, QuestLevel: 10, MinLevel: 5, MaxLevel: 0, ZoneOrSort: 12, Type: 0, RewXP: 0, RewOrReqMoney: 0, RewSpell: 0, RewSpellCast: 0, PrevQuestId: 0, NextQuestId: 0, NextQuestInChain: 0, ExclusiveGroup: 0, BreadcrumbForQuestId: 0, SrcItemId: 0 };
  for (let i = 1; i <= 4; i++) {
    row[`ReqItemId${i}`] = 0; row[`ReqItemCount${i}`] = 0;
    row[`ReqSourceId${i}`] = 0; row[`ReqSourceCount${i}`] = 0;
    row[`ReqCreatureOrGOId${i}`] = 0; row[`ReqCreatureOrGOCount${i}`] = 0;
    row[`ReqSpellCast${i}`] = 0;
    row[`RewItemId${i}`] = 0; row[`RewItemCount${i}`] = 0;
  }
  for (let i = 1; i <= 6; i++) { row[`RewChoiceItemId${i}`] = 0; row[`RewChoiceItemCount${i}`] = 0; }
  for (let i = 1; i <= 5; i++) { row[`RewRepFaction${i}`] = 0; row[`RewRepValue${i}`] = 0; }
  return { ...row, ...overrides };
}

function questStub(overrides) {
  return dbStubPool({ quest_template: [questRow(overrides)] });
}

// A complete loadQuest return value, written out literally - this is the
// interface contract renderQuestPage is held to. `wowPatch` is not part of
// loadQuest's own return shape (server/sections/db.js attaches it before
// rendering, the Task 9 convention); it is included here because this
// fixture is renderQuestPage's actual input.
const FIXTURE = {
  entry: 176,
  patch: 0,
  patches: [0],
  wowPatch: 10,
  row: questRow(),
  objectives: { items: [], creaturesOrObjects: [], spells: [] },
  rewards: { items: [], choiceItems: [], xp: 0, money: 0, spell: 0, reputation: [] },
  givers: [],
  enders: [],
  names: {
    creature: new Map(),
    item: new Map(),
    gameobject: new Map(),
    quest: new Map(),
    spell: new Map()
  }
};

test('a negative ReqCreatureOrGOId is a gameobject, not a creature', async () => {
  // vmangos-core/src/game/ObjectMgr.cpp:5918. 36 quests on this realm use it.
  const stub = questStub({ ReqCreatureOrGOId1: -1617, ReqCreatureOrGOCount1: 1 });
  const data = await loadQuest({ world: stub.pool }, CONFIG, 176);
  assert.deepEqual(data.objectives.creaturesOrObjects, [{ kind: 'gameobject', id: 1617, count: 1 }]);
});

test('a positive one is a creature', async () => {
  const stub = questStub({ ReqCreatureOrGOId1: 448, ReqCreatureOrGOCount1: 3 });
  const data = await loadQuest({ world: stub.pool }, CONFIG, 176);
  assert.deepEqual(data.objectives.creaturesOrObjects, [{ kind: 'creature', id: 448, count: 3 }]);
});

test('empty objective slots are dropped', async () => {
  const stub = questStub();
  const data = await loadQuest({ world: stub.pool }, CONFIG, 176);
  assert.deepEqual(data.objectives.creaturesOrObjects, []);
  assert.deepEqual(data.objectives.items, []);
});

test('givers and enders come from the creature and gameobject relation tables', async () => {
  const stub = questStub();
  await loadQuest({ world: stub.pool }, CONFIG, 176);
  for (const table of ['creature_questrelation', 'creature_involvedrelation', 'gameobject_questrelation', 'gameobject_involvedrelation']) {
    assert.ok(stub.callsFor(table).length > 0, `${table} is read`);
  }
});

test('a quest that does not exist is null, so the route can 404', async () => {
  const stub = dbStubPool({});
  assert.equal(await loadQuest({ world: stub.pool }, CONFIG, 99999999), null);
});

test('quest text is escaped, including its newlines rendered as breaks', () => {
  const html = renderQuestPage({ ...FIXTURE, row: { ...FIXTURE.row, Details: 'a <b>bold</b> claim\nsecond line' } });
  assert.doesNotMatch(html, /<b>bold<\/b>/);
  assert.match(html, /claim<br>second line/);
});

test('quest level, minimum level and maximum level render as three separate facts, not a MinLevel-QuestLevel range', () => {
  // Quest 3401 on this realm: MinLevel 53, QuestLevel 48, MaxLevel 0. The old
  // `${MinLevel}-${QuestLevel}` rendering read "53-48", a backwards range,
  // for 35 quests on this realm, and dropped MaxLevel (nonzero on 219 quests)
  // entirely.
  const html = renderQuestPage({ ...FIXTURE, row: { ...FIXTURE.row, MinLevel: 53, QuestLevel: 48, MaxLevel: 0 } });
  assert.doesNotMatch(html, /53–48/);
  assert.doesNotMatch(html, /53-48/);
  assert.match(html, /<th>quest level<\/th><td>48<\/td>/);
  assert.match(html, /<th>minimum level<\/th><td>53<\/td>/);
  assert.match(html, /<th>maximum level<\/th><td>—<\/td>/);
});

test('a nonzero MaxLevel is rendered, not dropped', () => {
  const html = renderQuestPage({ ...FIXTURE, row: { ...FIXTURE.row, MinLevel: 10, QuestLevel: 12, MaxLevel: 15 } });
  assert.match(html, /<th>maximum level<\/th><td>15<\/td>/);
});

test('a race mask of 0 renders as all races', () => {
  const html = renderQuestPage({ ...FIXTURE, row: { ...FIXTURE.row, RequiredRaces: 0 } });
  assert.match(html, /All races/);
});

test('chain fields link to their quests', () => {
  const html = renderQuestPage({ ...FIXTURE, row: { ...FIXTURE.row, NextQuestInChain: 177 } });
  assert.match(html, /href="\/db\/quest\/177"/);
});

test('the page leads back to the quest list', () => {
  const html = renderQuestPage(FIXTURE);
  assert.match(html, /<a href="\/db\/quests">back to quests<\/a>/);
  assert.doesNotMatch(html, /back to search/);
});

test('a summary line names level, required level, races, category and type', () => {
  const html = renderQuestPage({ ...FIXTURE, names: { ...FIXTURE.names, area: new Map([[12, 'Elwynn Forest']]) } });
  assert.match(html, /<p class="summary">Level 10 · Requires level 5 · Races: Any · Elwynn Forest · Normal<\/p>/);
});

test('a required races mask of Human+Orc reads as Mixed, not Any or Both', () => {
  const html = renderQuestPage({ ...FIXTURE, row: { ...FIXTURE.row, RequiredRaces: 3 } });
  assert.match(html, /Races: Mixed/);
});

test('a quest level of 0 in the summary reads as the player\'s own level', () => {
  const html = renderQuestPage({ ...FIXTURE, row: { ...FIXTURE.row, QuestLevel: 0 } });
  assert.match(html, /<p class="summary">Level player&#39;s level/);
});

test('the zone/sort fact is labelled, not a bare number', () => {
  const html = renderQuestPage({ ...FIXTURE, row: { ...FIXTURE.row, ZoneOrSort: -61 } });
  assert.match(html, /<th>category<\/th><td>Warlock<\/td>/);
});

// FIXTURE.row.ZoneOrSort is 12, positive - a zone, not a QuestSort - so the
// category cell links to it rather than showing the name as plain text.
test('a zone category links to the zone with its hover card', () => {
  const html = renderQuestPage({ ...FIXTURE, names: { ...FIXTURE.names, area: new Map([[12, 'Elwynn Forest']]) } });
  assert.match(html, /<th>category<\/th><td><span class="tooltip-host"><a href="\/db\/zone\/12"\s+hx-get="\/db\/tooltip\/zone\/12"[^>]*>Elwynn Forest<\/a><\/span><\/td>/);
});

test('a reputation reward links to its faction, with the value after it', () => {
  const html = renderQuestPage({
    ...FIXTURE,
    rewards: { ...FIXTURE.rewards, reputation: [{ faction: 72, name: 'Stormwind', value: 250 }] }
  });
  assert.match(html, /<li><span class="tooltip-host"><a href="\/db\/faction\/72"\s+hx-get="\/db\/tooltip\/faction\/72"[^>]*>Stormwind<\/a><\/span>: 250<\/li>/);
  assert.doesNotMatch(html, /\(faction #/);
});

test('every linked entity carries a hover card, items with their quality', () => {
  const html = renderQuestPage({
    ...FIXTURE,
    row: { ...FIXTURE.row, NextQuestInChain: 177 },
    objectives: { items: [{ id: 2586, count: 1, kind: 'required' }], creaturesOrObjects: [{ kind: 'creature', id: 448, count: 1 }], spells: [] },
    rewards: { ...FIXTURE.rewards, items: [{ id: 159, count: 5 }] },
    givers: [{ kind: 'creature', id: 197, name: 'Marshal' }],
    names: {
      ...FIXTURE.names,
      item: new Map([[2586, 'Claw'], [159, 'Water']]),
      itemQuality: new Map([[2586, 0], [159, 1]]),
      creature: new Map([[448, 'Hogger']])
    }
  });
  for (const path of ['/db/quest/177', '/db/item/2586', '/db/item/159', '/db/creature/448', '/db/creature/197']) {
    const kind = path.split('/')[2];
    const id = path.split('/')[3];
    assert.match(html, new RegExp(`href="${path.replaceAll('/', '\\/')}"\\s+hx-get="\\/db\\/tooltip\\/${kind}\\/${id}"`), path);
  }
  assert.match(html, /<a class="q0" href="\/db\/item\/2586"/);
});

// vmangos-core/src/game/Objects/Player.cpp:13431: the core casts
// RewSpellCast when set, else RewSpell. Quest 31 "Aquatic Form" has
// RewSpell 0 and RewSpellCast 1446 (a Learn Spell teaching 1066) - the old
// RewSpell-only read showed "spell —" for it and the ~226 quests shaped
// like it.
test('a RewSpellCast-only reward resolves through the teaching spell to what it actually grants', async () => {
  const stub = dbStubPool({
    quest_template: [questRow({ RewSpell: 0, RewSpellCast: 1446 })],
    spell_template: [{ entry: 1446, effect1: 36, effectTriggerSpell1: 1066 }]
  });
  const data = await loadQuest({ world: stub.pool }, CONFIG, 176);
  assert.equal(data.rewards.spell, 1066);
});

test('a quest with only RewSpell (no RewSpellCast) links it unchanged', async () => {
  const stub = questStub({ RewSpell: 133, RewSpellCast: 0 });
  const data = await loadQuest({ world: stub.pool }, CONFIG, 176);
  assert.equal(data.rewards.spell, 133);
});

test('the loader reads the zone name for a zone category', async () => {
  const stub = dbStubPool({ quest_template: [questRow({ ZoneOrSort: 12 })], area_template: [{ entry: 12, name: 'Elwynn Forest' }] });
  const data = await loadQuest({ world: stub.pool }, CONFIG, 176);
  assert.equal(data.names.area.get(12), 'Elwynn Forest');
});

test('the reward spell and spell objectives link to the spell page', () => {
  const html = renderQuestPage({ ...FIXTURE, rewards: { ...FIXTURE.rewards, spell: 133 }, objectives: { ...FIXTURE.objectives, spells: [116] }, names: { ...FIXTURE.names, spell: new Map([[133, 'Fireball'], [116, 'Frostbolt']]) } });
  assert.match(html, /href="\/db\/spell\/133"\s+hx-get="\/db\/tooltip\/spell\/133"/);
  assert.match(html, /href="\/db\/spell\/116"/);
});
