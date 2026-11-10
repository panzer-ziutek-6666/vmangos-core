import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, referencedSpellIds, substituteSpellText } from '../server/dbLookups/spellText.js';

// Fireball rank 1 (entry 133), copied from spell_template at build 5875. Its
// in-game tooltip reads: "Hurls a fiery ball that causes 14 to 22 Fire damage
// and an additional 2 Fire damage over 4 sec."
function spell(overrides = {}) {
  const row = { entry: 133, procChance: 0, procCharges: 0, stackAmount: 0 };
  for (const i of [1, 2, 3]) {
    Object.assign(row, {
      [`effectBasePoints${i}`]: 0, [`effectBaseDice${i}`]: 0, [`effectDieSides${i}`]: 0,
      [`effectAmplitude${i}`]: 0, [`effectChainTarget${i}`]: 0, [`effectMiscValue${i}`]: 0
    });
  }
  return { ...row, ...overrides };
}
const FIREBALL = spell({
  effectBasePoints1: 13, effectBaseDice1: 1, effectDieSides1: 9,
  effectBasePoints2: 0, effectBaseDice2: 1, effectDieSides2: 1, effectAmplitude2: 2000
});
const CTX = { spell: FIREBALL, durationMs: 4000, rangeYards: 35, radiusYards: [null, null, null], referenced: new Map() };

test('Fireball rank 1 reads as its in-game tooltip', () => {
  assert.equal(
    substituteSpellText('Hurls a fiery ball that causes $s1 Fire damage and an additional $o2 Fire damage over $d.', CTX),
    'Hurls a fiery ball that causes 14 to 22 Fire damage and an additional 2 Fire damage over 4 sec.'
  );
});

// vmangos-core/src/game/Objects/SpellCaster.cpp:1162-1189: base points plus
// EffectBaseDice when EffectDieSides is 0 or 1, else plus a roll between the two.
test('$s is a single value when the die has one side, and $m is always the minimum', () => {
  const ctx = { ...CTX, spell: spell({ effectBasePoints1: 49, effectBaseDice1: 1, effectDieSides1: 1 }) };
  assert.equal(substituteSpellText('$s1 and $m1', ctx), '50 and 50');
  assert.equal(substituteSpellText('$m1', CTX), '14');
});

test('negative amounts are shown as magnitudes', () => {
  const ctx = { ...CTX, spell: spell({ effectBasePoints1: -11, effectBaseDice1: 1, effectDieSides1: 1 }) };
  assert.equal(substituteSpellText('Reduces armor by $s1.', ctx), 'Reduces armor by 10.');
});

test('negative EffectDieSides triggers a roll, not a single value (spell 14147 effect 2)', () => {
  const ctx = { ...CTX, spell: spell({ effectBasePoints2: -761, effectBaseDice2: 1, effectDieSides2: -79, effectAmplitude2: 2000 }) };
  assert.equal(substituteSpellText('Armor reduced by $s2.', ctx), 'Armor reduced by 760 to 840.');
});

test('a range crossing zero has magnitude 0 to max(|lo|, |hi|)', () => {
  const ctx = { ...CTX, spell: spell({ effectBasePoints1: 0, effectBaseDice1: -3, effectDieSides1: 5 }) };
  assert.equal(substituteSpellText('$s1', ctx), '0 to 5');
});

test('EffectDieSides exactly 0 gives a single value like sides 1', () => {
  const ctx = { ...CTX, spell: spell({ effectBasePoints1: 5, effectBaseDice1: 2, effectDieSides1: 0 }) };
  assert.equal(substituteSpellText('$s1', ctx), '7');
});

test('$o multiplies the per-tick value by duration over amplitude; $t is the amplitude in seconds', () => {
  const ctx = { ...CTX, durationMs: 15000, spell: spell({ effectBasePoints1: 8, effectBaseDice1: 1, effectDieSides1: 1, effectAmplitude1: 3000 }) };
  assert.equal(substituteSpellText('$o1 over $d, every $t1 sec', ctx), '45 over 15 sec, every 3 sec');
});

test('$o with no amplitude is left as written rather than guessing an interval', () => {
  assert.equal(substituteSpellText('$o1 total', CTX), '$o1 total');
});

test('$a, $r, $h, $n, $u, $x and $q read their own columns', () => {
  const ctx = {
    ...CTX, rangeYards: 30, radiusYards: [8, null, null],
    spell: spell({ procChance: 10, procCharges: 3, stackAmount: 5, effectChainTarget1: 4, effectMiscValue1: 7 })
  };
  assert.equal(substituteSpellText('$a1 $r $h $n $u $x1 $q1', ctx), '8 30 10 3 5 4 7');
});

test('the $/N; and $*N; prefixes divide or multiply the value that follows', () => {
  const ctx = { ...CTX, spell: spell({ effectBasePoints1: 9999, effectBaseDice1: 1, effectDieSides1: 1 }) };
  assert.equal(substituteSpellText('$/1000;s1 sec and $*2;s1', ctx), '10 sec and 20000');
});

test('$l picks singular or plural by the last number written; $g shows both forms', () => {
  const ctx = { ...CTX, spell: spell({ effectBasePoints1: 0, effectBaseDice1: 1, effectDieSides1: 1 }) };
  assert.equal(substituteSpellText('$s1 $lcharge:charges;', ctx), '1 charge');
  assert.equal(substituteSpellText('$s1 $lcharge:charges;', CTX), '14 to 22 charges');
  assert.equal(substituteSpellText('$ghis:her; weapon', CTX), 'his/her weapon');
});

// Uppercase S and D resolve exactly as lowercase; uppercase M is the maximum
// of the effect's range where lowercase m is the minimum (Flametongue Weapon
// 8024: "$/77;8026m1 to $/25;8026M1 additional Fire damage").
test('$S1 equals $s1, and $M1 is the maximum where $m1 is the minimum', () => {
  assert.equal(substituteSpellText('$S1', CTX), substituteSpellText('$s1', CTX));
  assert.equal(substituteSpellText('$m1 to $M1', CTX), '14 to 22');
});

test('$D resolves the same as $d', () => {
  assert.equal(substituteSpellText('Lasts $D.', CTX), substituteSpellText('Lasts $d.', CTX));
});

test('a cross-spell token reads the referenced spell', () => {
  const referenced = new Map([[12654, { spell: spell({ effectBasePoints1: 1, effectBaseDice1: 1, effectDieSides1: 1, effectAmplitude1: 2000 }), durationMs: 4000, radiusYards: [null, null, null] }]]);
  assert.equal(substituteSpellText('burns for $12654o1 over $12654d', { ...CTX, referenced }), 'burns for 4 over 4 sec');
  assert.deepEqual(referencedSpellIds('$12654o1 and $12654d and $999s1'), [12654, 999]);
});

test('an uppercase cross-spell token resolves and is picked up by referencedSpellIds', () => {
  const referenced = new Map([[123, { spell: spell({ effectBasePoints1: 13, effectBaseDice1: 1, effectDieSides1: 9 }), durationMs: 0, radiusYards: [null, null, null] }]]);
  assert.equal(substituteSpellText('$123M1', { ...CTX, referenced }), '22');
  assert.deepEqual(referencedSpellIds('$123M1'), [123]);
});

test('an unresolvable cross-spell token and any unknown token are left as written', () => {
  assert.equal(substituteSpellText('$999s1 and $i and $?x', CTX), '$999s1 and $i and $?x');
});

test('$$ is a literal dollar sign', () => {
  assert.equal(substituteSpellText('costs $$5', CTX), 'costs $5');
});

test('durations read as the client writes them', () => {
  assert.equal(formatDuration(4000), '4 sec');
  assert.equal(formatDuration(1500), '1.5 sec');
  assert.equal(formatDuration(120000), '2 min');
  assert.equal(formatDuration(3600000), '1 hour');
  assert.equal(formatDuration(10800000), '3 hours');
  assert.equal(formatDuration(0), '');
});

// spell_duration's -1 is the core's "permanent" sentinel
// (vmangos-core/src/game/Spells/SpellEntry.cpp:708-713); every caller that
// cares tests `!= -1`, never a length (SpellAuras.cpp:6929). Find Treasure
// (entry 2481) is durationIndex 21, spell_duration -1.
test('formatDuration(-1) reads "until cancelled", not nothing', () => {
  assert.equal(formatDuration(-1), 'until cancelled');
});

test('$d on a permanent (-1) duration reads "until cancelled"', () => {
  const ctx = { ...CTX, durationMs: -1 };
  assert.equal(substituteSpellText('Lasts $d.', ctx), 'Lasts until cancelled.');
});

test('text with no tokens comes back unchanged, including markup characters', () => {
  assert.equal(substituteSpellText('<b>&</b>', CTX), '<b>&</b>');
});
