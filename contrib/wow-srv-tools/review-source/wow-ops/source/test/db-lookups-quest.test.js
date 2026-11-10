import test from 'node:test';
import assert from 'node:assert/strict';
import { raceNames, classNames, questFlagNames } from '../server/dbLookups/questFlags.js';

test('a zero race mask means every race, not none', () => {
  // RequiredRaces = 0 is "no restriction". Rendering it as an empty list would
  // read as "no race can take this quest", the opposite of the truth.
  assert.deepEqual(raceNames(0), ['All races']);
});

test('a race mask decodes to its races', () => {
  assert.deepEqual(raceNames(1), ['Human']);
  assert.deepEqual(raceNames(77), ['Human', 'Dwarf', 'Night Elf', 'Gnome']);
});

test('a class mask decodes the same way', () => {
  assert.deepEqual(classNames(0), ['All classes']);
  assert.deepEqual(classNames(1), ['Warrior']);
});

test('unknown bits are kept with their value', () => {
  assert.ok(raceNames(0x8000).some((n) => n.includes('0x8000')));
});
