import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSpellTooltip, costLabel, referencedContexts } from '../server/views/db/spellTooltip.js';
import { dbApp, HEADERS, CONFIG } from './helpers/dbApp.js';
import { dbStubPool } from './helpers/dbStubPool.js';

const FIREBALL = {
  entry: 133, name: 'Fireball', nameSubtext: 'Rank 1', powerType: 0, manaCost: 30, manaCostPercentage: 0,
  castingTimeIndex: 16, durationIndex: 35, rangeIndex: 35, spellIconId: 185, recoveryTime: 0, categoryRecoveryTime: 0,
  description: 'Hurls a fiery ball that causes $s1 Fire damage and an additional $o2 Fire damage over $d.',
  procChance: 0, procCharges: 0, stackAmount: 0,
  effectBasePoints1: 13, effectBaseDice1: 1, effectDieSides1: 9, effectAmplitude1: 0,
  effectBasePoints2: 0, effectBaseDice2: 1, effectDieSides2: 1, effectAmplitude2: 2000,
  effectBasePoints3: 0, effectBaseDice3: 0, effectDieSides3: 0, effectAmplitude3: 0,
  effectRadiusIndex1: 0, effectRadiusIndex2: 0, effectRadiusIndex3: 0
};
const LABELS = { castMs: new Map([[133, 1500]]), durationMs: new Map([[133, 4000]]), range: new Map([[133, { min: 0, max: 35, name: '' }]]), radius: new Map(), iconName: new Map([[133, 'Spell_Fire_FlameBolt']]) };

test('the card shows name, rank, cost, cast time, range and the substituted description', () => {
  const html = renderSpellTooltip({ row: FIREBALL, labels: LABELS, referenced: new Map() });
  for (const text of ['Fireball', 'Rank 1', '30 Mana', '1.5 sec cast', '35 yd range', '14 to 22 Fire damage', '2 Fire damage over 4 sec']) {
    assert.ok(html.includes(text), text);
  }
});

test('description text is escaped once', () => {
  const html = renderSpellTooltip({ row: { ...FIREBALL, description: 'a <b> & $s1' }, labels: LABELS, referenced: new Map() });
  assert.match(html, /a &lt;b&gt; &amp; 14 to 22/);
});

// M2: 43 build-5875 descriptions carry CRLFs, Kidney Shot (408) among them
// with a five-line combo-point table - the card used to collapse it into one
// run-on line because only views/db/spell.js converted \n to <br>. Escaped
// exactly once: replaceAll runs on the already-escaped string.
test('a multi-line description keeps its line breaks as <br>, escaped exactly once', () => {
  const html = renderSpellTooltip({ row: { ...FIREBALL, description: 'Line one <b>\nLine two & three' }, labels: LABELS, referenced: new Map() });
  assert.match(html, /Line one &lt;b&gt;<br>Line two &amp; three/);
});

test('the route answers in two queries without a cross-spell reference, never loading the page', async (t) => {
  const stub = dbStubPool({ spell_template: [{ ...FIREBALL, build: 5875 }] });
  const config = { ...CONFIG, mysql: { ...CONFIG.mysql, dbcSchema: 'dbc' } };
  const { app } = dbApp({ world: stub.pool, config });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/db/tooltip/spell/133', headers: HEADERS });
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /<!doctype html>/i);
  assert.ok(stub.calls.length <= 2, `got ${stub.calls.length}`);
  for (const c of stub.calls) assert.doesNotMatch(c.sql, /npc_trainer|item_template|skill_line_ability/);
});

test('a cross-spell reference costs exactly one more query', async (t) => {
  const stub = dbStubPool({ spell_template: [{ ...FIREBALL, build: 5875, description: 'see $12654o1' }] });
  const config = { ...CONFIG, mysql: { ...CONFIG.mysql, dbcSchema: 'dbc' } };
  const { app } = dbApp({ world: stub.pool, config });
  t.after(() => app.close());
  await app.inject({ method: 'GET', url: '/db/tooltip/spell/133', headers: HEADERS });
  assert.ok(stub.calls.length <= 3, `got ${stub.calls.length}`);
});

test('unknown id 404s, malformed id 400s', async (t) => {
  const { app } = dbApp({ world: dbStubPool({}).pool });
  t.after(() => app.close());
  assert.equal((await app.inject({ method: 'GET', url: '/db/tooltip/spell/999999', headers: HEADERS })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: '/db/tooltip/spell/1e3', headers: HEADERS })).statusCode, 400);
});

// Rage is stored tenths-scaled (vmangos-core/src/game/Objects/Unit.cpp:8321-8322,
// src/game/Objects/Player.cpp:2423); manaCost is taken off that pool unscaled
// (src/game/Spells/Spell.cpp:6988, 5085), so a rage spell's manaCost column is
// itself tenths-scaled. Heroic Strike (entry 78) is manaCost 150, shown as "15 Rage".
test('costLabel divides a rage spell\'s manaCost by ten', () => {
  assert.equal(costLabel({ powerType: 1, manaCost: 150, manaCostPercentage: 0 }), '15 Rage');
});

test('costLabel leaves energy unscaled', () => {
  assert.equal(costLabel({ powerType: 3, manaCost: 40, manaCostPercentage: 0 }), '40 Energy');
});

// The Searing Totem ranks name each other by range ($3606r1) - referencedContexts
// used to drop rangeYards building the map, so that token never resolved.
test('referencedContexts keeps rangeYards, so a referenced spell\'s range resolves', () => {
  const refRows = new Map([[3606, { ...FIREBALL, entry: 3606, rangeIndex: 35 }]]);
  const labels = { ...LABELS, range: new Map([...LABELS.range, [3606, { min: 0, max: 20, name: '' }]]) };
  const ctx = referencedContexts(refRows, labels);
  assert.equal(ctx.get(3606).rangeYards, 20);
});

test('the tooltip of a Heroic-Strike-shaped row shows "15 Rage", not "150"', () => {
  const HEROIC_STRIKE = { ...FIREBALL, name: 'Heroic Strike', nameSubtext: '', powerType: 1, manaCost: 150, description: 'A strong strike.' };
  const html = renderSpellTooltip({ row: HEROIC_STRIKE, labels: LABELS, referenced: new Map() });
  assert.ok(html.includes('15 Rage'));
  assert.ok(!html.includes('150'));
});
