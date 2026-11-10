import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSpellPage } from '../server/views/db/spell.js';
import { loadSpell } from '../server/queries/db/spell.js';
import { dbStubPool } from './helpers/dbStubPool.js';

// Fireball rank 1 (entry 133) as spell_template holds it at build 5875.
const FIREBALL = {
  entry: 133, build: 5875, name: 'Fireball', nameSubtext: 'Rank 1', school: 2, spellLevel: 1,
  powerType: 0, manaCost: 30, manaCostPercentage: 0, castingTimeIndex: 16, durationIndex: 35, rangeIndex: 35,
  spellIconId: 185, recoveryTime: 0, categoryRecoveryTime: 0, requiresSpellFocus: 0, totem1: 0, totem2: 0,
  description: 'Hurls a fiery ball that causes $s1 Fire damage and an additional $o2 Fire damage over $d.', auraDescription: '',
  procChance: 0, procCharges: 0, stackAmount: 0,
  effect1: 2, effect2: 6, effect3: 0, effectApplyAuraName1: 0, effectApplyAuraName2: 3, effectApplyAuraName3: 0,
  effectBasePoints1: 13, effectBaseDice1: 1, effectDieSides1: 9, effectAmplitude1: 0,
  effectBasePoints2: 0, effectBaseDice2: 1, effectDieSides2: 1, effectAmplitude2: 2000,
  effectBasePoints3: 0, effectBaseDice3: 0, effectDieSides3: 0, effectAmplitude3: 0,
  effectRadiusIndex1: 0, effectRadiusIndex2: 0, effectRadiusIndex3: 0,
  effectImplicitTargetA1: 6, effectImplicitTargetA2: 6, effectImplicitTargetA3: 0,
  effectTriggerSpell1: 0, effectTriggerSpell2: 0, effectTriggerSpell3: 0,
  effectChainTarget1: 0, effectChainTarget2: 0, effectChainTarget3: 0,
  effectMiscValue1: 0, effectMiscValue2: 0, effectMiscValue3: 0
};
for (let i = 1; i <= 8; i++) { FIREBALL[`reagent${i}`] = 0; FIREBALL[`reagentCount${i}`] = 0; }

const FIXTURE = {
  entry: 133, row: FIREBALL, clientBuild: 5875,
  labels: { castMs: new Map([[133, 1500]]), durationMs: new Map([[133, 4000]]), range: new Map([[133, { min: 0, max: 35, name: 'Medium-Long Range' }]]), radius: new Map(), iconName: new Map([[133, 'Spell_Fire_FlameBolt']]) },
  referenced: new Map(),
  skills: [{ skillId: 8, name: 'Fire', reqSkillValue: 1, minValue: 0, maxValue: 0, learnOnGetSkill: false, classMask: 128, raceMask: 0, supersededBy: 143 }],
  trainers: [{ source: 'creature', entry: 198, cost: 10, reqLevel: 1, reqSkill: 0, reqSkillValue: 0, creatures: [198] }],
  items: [{ entry: 1111, slot: 1, trigger: 6 }],
  names: { item: new Map([[1111, 'Tome of Fireball']]), itemQuality: new Map([[1111, 1]]), spell: new Map([[143, 'Fireball']]), creature: new Map([[198, 'Khelden Bremen']]), skill: new Map([[8, 'Fire']]) }
};

test('summary line, description and effects', () => {
  const html = renderSpellPage(FIXTURE);
  for (const text of ['Fireball', 'Rank 1', 'Fire', '1.5 sec cast', '35 yd range', '4 sec duration', '30 Mana', '14 to 22 Fire damage', 'School Damage', 'Apply Aura', 'Periodic Damage']) {
    assert.ok(html.includes(text), text);
  }
});

test('taught by skill lines and trainers, cast by items, all linked with cards', () => {
  const html = renderSpellPage(FIXTURE);
  assert.match(html, /href="\/db\/skill\/8"/);
  assert.match(html, /href="\/db\/creature\/198"\s+hx-get="\/db\/tooltip\/creature\/198"/);
  assert.match(html, /href="\/db\/spell\/143"\s+hx-get="\/db\/tooltip\/spell\/143"/);
  assert.match(html, /<a class="q1" href="\/db\/item\/1111"/);
  assert.match(html, /Mage/);
});

// M1: 42,460 of 55,579 skill_line_ability rows carry no skill-up range
// (max_value 0), including every rank of Fireball (FIXTURE's own skill line)
// - the parenthetical is omitted entirely rather than printed as "(—)",
// exactly as the auto-learn note is already omitted when there is none.
test('a skill line with no skill-up range and no auto-learn note prints neither parenthetical', () => {
  const html = renderSpellPage(FIXTURE);
  assert.doesNotMatch(html, /\(—\)/);
});

test('the page leads back to spells and shows the build it was read at', () => {
  const html = renderSpellPage(FIXTURE);
  assert.match(html, /<a href="\/db\/spells">back to spells<\/a>/);
  assert.match(html, /build 5875/);
});

// -1 duration ("permanent", vmangos-core/src/game/Spells/SpellEntry.cpp:708-713)
// reads "until cancelled" in the summary line too, not nothing - formatDuration
// is the one call site every duration display shares.
test('a permanent (-1) duration reads "until cancelled" in the summary line', () => {
  const html = renderSpellPage({ ...FIXTURE, labels: { ...FIXTURE.labels, durationMs: new Map([[133, -1]]) } });
  assert.match(html, /until cancelled/);
  assert.doesNotMatch(html, /until cancelled duration/);
});

// Finding 3, round 2: the spell page's own "taught by skill lines" list read
// req_skill_value the same wrong way the skill page did before this round -
// it now shares skillUpLabel/autoLearnLabel (fields.js) with the skill page
// instead of a second, independently wrong "(requires N)" tag.
test('a taught-by skill line shows the skill-up range and, only when set, an auto-learn note - not "(requires N)"', () => {
  const html = renderSpellPage({
    ...FIXTURE,
    skills: [
      { skillId: 164, name: 'Blacksmithing', reqSkillValue: 1, minValue: 325, maxValue: 350, learnOnGetSkill: false, classMask: 0, raceMask: 0, supersededBy: 0 },
      { skillId: 8, name: 'Fire', reqSkillValue: 1, minValue: 0, maxValue: 0, learnOnGetSkill: true, classMask: 128, raceMask: 0, supersededBy: 0 }
    ]
  });
  assert.match(html, /325–350/);
  assert.match(html, /auto-learned at 1/);
  assert.doesNotMatch(html, /requires \d/);
});

// A description token referencing another spell (`$3606r1`) must resolve
// through the same referencedContexts the hover card uses - the spell page
// used to build its own, dropping rangeYards (finding 6).
test('a description token referencing another spell resolves its range', () => {
  const referenced = new Map([[3606, { ...FIREBALL, entry: 3606, castingTimeIndex: 16, durationIndex: 35, rangeIndex: 35 }]]);
  const html = renderSpellPage({
    ...FIXTURE,
    row: { ...FIREBALL, description: 'Range: $3606r1 yards.' },
    referenced,
    labels: { ...FIXTURE.labels, range: new Map([...FIXTURE.labels.range, [3606, { min: 0, max: 40, name: '' }]]) }
  });
  assert.match(html, /Range: 40 yards\./);
});

const CONFIG = { mysql: { world: { database: 'mangos' } }, realm: { wowPatch: 10, clientBuild: 5875 } };

test('a spell that does not exist is null', async () => {
  const stub = dbStubPool({});
  assert.equal(await loadSpell({ world: stub.pool }, CONFIG, 999999), null);
});

// vmangos-core/src/game/ObjectMgr.cpp:10721-10735: a trainer row never names
// Fireball rank 2 (143) directly - it names a teaching spell (effect1 36,
// effectTriggerSpell1 143). Reading trainer rows on `spell = 143` finds none;
// the fix reads teaching ids first, then trainer rows on `spell IN (...)`.
test('a trainer row naming the teaching spell is found and the page lists it', async () => {
  const RANK2 = {
    entry: 143, build: 5875, name: 'Fireball', nameSubtext: 'Rank 2', description: '', auraDescription: '',
    totem1: 0, totem2: 0, effectTriggerSpell1: 0, effectTriggerSpell2: 0, effectTriggerSpell3: 0
  };
  for (let i = 1; i <= 8; i++) { RANK2[`reagent${i}`] = 0; RANK2[`reagentCount${i}`] = 0; }
  const stub = dbStubPool({
    effectTriggerSpell1: [{ entry: 1173 }],
    npc_trainer_template: [{ entry: 300, spellcost: 10, reqskill: 0, reqskillvalue: 0, reqlevel: 1 }],
    creature_template: [{ entry: 640, trainer_id: 300, patch: 0 }],
    spell_template: [RANK2]
  });
  const data = await loadSpell({ world: stub.pool }, CONFIG, 143);
  assert.equal(data.trainers.length, 1);
  assert.deepEqual(data.trainers[0].creatures, [640]);
  const html = renderSpellPage({ ...data, clientBuild: CONFIG.realm.clientBuild });
  assert.match(html, /href="\/db\/creature\/640"/);
  assert.doesNotMatch(html, /Not taught by a trainer/);
});

test('a spell with no teaching spell issues no trainer read', async () => {
  const RANK2 = {
    entry: 143, build: 5875, name: 'Fireball', nameSubtext: 'Rank 2', description: '', auraDescription: '',
    totem1: 0, totem2: 0, effectTriggerSpell1: 0, effectTriggerSpell2: 0, effectTriggerSpell3: 0
  };
  for (let i = 1; i <= 8; i++) { RANK2[`reagent${i}`] = 0; RANK2[`reagentCount${i}`] = 0; }
  // `effectTriggerSpell1` (a substring unique to fetchTeachingSpellIds' own
  // WHERE clause) answers that specific query with no rows, while the plain
  // `spell_template` key still answers the main entry read with RANK2 -
  // dbStubPool matches by substring, so the two spell_template reads in this
  // flow need two distinguishable keys, ordered more specific first.
  const stub = dbStubPool({ effectTriggerSpell1: [], spell_template: [RANK2] });
  const data = await loadSpell({ world: stub.pool }, CONFIG, 143);
  assert.equal(data.trainers.length, 0);
  assert.ok(!stub.calls.some((c) => c.sql.includes('npc_trainer')), 'no npc_trainer/npc_trainer_template query was sent');
});

// I1: an item never names the spell it teaches directly (item 2881 "Plans:
// Runed Copper Breastplate" casts 2760, which teaches 2667) - the same
// indirection as a trainer row. fetchItemsCasting must match spellid_N
// against the teaching ids fetchTeachingSpellIds already found, not just
// this entry, and tag the hit `teaches` so the page says "teaches" rather
// than naming a trigger that describes the teaching spell's own cast.
test('an item naming only the teaching spell is found and labelled "teaches", not a trigger', async () => {
  const RANK3 = {
    entry: 2667, build: 5875, name: 'Fireball', nameSubtext: 'Rank 3', description: '', auraDescription: '',
    totem1: 0, totem2: 0, effectTriggerSpell1: 0, effectTriggerSpell2: 0, effectTriggerSpell3: 0
  };
  for (let i = 1; i <= 8; i++) { RANK3[`reagent${i}`] = 0; RANK3[`reagentCount${i}`] = 0; }
  const item = { entry: 2881, spellid_1: 2760, spelltrigger_1: 0 };
  for (let i = 2; i <= 5; i++) { item[`spellid_${i}`] = 0; item[`spelltrigger_${i}`] = 0; }
  const stub = dbStubPool({
    effectTriggerSpell1: [{ entry: 2760 }],
    item_template: [item],
    spell_template: [RANK3]
  });
  const data = await loadSpell({ world: stub.pool }, CONFIG, 2667);
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].entry, 2881);
  assert.equal(data.items[0].teaches, true);
  const html = renderSpellPage({ ...data, clientBuild: CONFIG.realm.clientBuild });
  assert.match(html, /<td>teaches<\/td>/);
  assert.doesNotMatch(html, /Not cast or taught by an item/);
});

test('a spell that is a talent rank links to its class calculator with the talent marked', async () => {
  const stub = dbStubPool({
    'dbc`.`talent`': [{ id: 26, tab_name: 'Fire', class_name: 'Mage', rank_1: 11069, rank_2: 12338, rank_3: 0, rank_4: 0, rank_5: 0 }],
    spell_template: [{ entry: 12338, build: 5875, name: 'Improved Fireball', description: '' }]
  });
  const config = { ...CONFIG, mysql: { ...CONFIG.mysql, dbcSchema: 'dbc' } };
  const data = await loadSpell({ world: stub.pool }, config, 12338);
  assert.deepEqual(data.talent, { talentId: 26, rank: 2, treeName: 'Fire', classSlug: 'mage' });
  const html = renderSpellPage({ ...data, clientBuild: 5875, wowPatch: 10 });
  assert.match(html, /href="\/db\/talents\/mage\?talent=26"/);
});

// I-1: a reference schema imported before this cycle (20c420a) has no
// talent_tab.name/background/dbc_row - the read fails with
// ER_BAD_FIELD_ERROR, not ER_NO_SUCH_TABLE/ER_BAD_DB_ERROR, which
// withMissingReference alone does not catch (sql.js). Before the fix this
// escaped as a raw 500 on every /db/spell page; the fix is to render the
// page normally, without the talent link, the same way an entry that is not
// a talent rank at all already does.
test('a spell page renders normally, talent: null, against an old reference schema missing talent_tab columns', async () => {
  const pool = {
    query: async (sql) => {
      if (sql.includes('`talent`')) {
        const e = new Error("Unknown column 'b.name' in 'field list'");
        e.code = 'ER_BAD_FIELD_ERROR';
        throw e;
      }
      if (sql.includes('spell_template')) return [[{ entry: 12338, build: 5875, name: 'Improved Fireball', description: '' }]];
      return [[]];
    }
  };
  const config = { ...CONFIG, mysql: { ...CONFIG.mysql, dbcSchema: 'dbc' } };
  const data = await loadSpell({ world: pool }, config, 12338);
  assert.equal(data.talent, null);
  const html = renderSpellPage({ ...data, clientBuild: 5875, wowPatch: 10 });
  assert.doesNotMatch(html, /Talent:/);
});
