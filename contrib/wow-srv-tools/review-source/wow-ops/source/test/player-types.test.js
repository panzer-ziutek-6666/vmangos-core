import test from 'node:test';
import assert from 'node:assert/strict';
import { raceName, className, genderName, RACE_MASK_NAMES } from '../server/playerTypes.js';

test('vanilla races are named', () => {
  assert.equal(raceName(1), 'Human');
  assert.equal(raceName(2), 'Orc');
  assert.equal(raceName(3), 'Dwarf');
  assert.equal(raceName(4), 'Night Elf');
  assert.equal(raceName(5), 'Undead');
  assert.equal(raceName(6), 'Tauren');
  assert.equal(raceName(7), 'Gnome');
  assert.equal(raceName(8), 'Troll');
});

test('races the 1.12 client does not have are not invented', () => {
  // 9 (goblin) and 10 (blood elf) are not playable on this realm; a row
  // carrying one is data corruption, and must read as unknown rather than
  // as a race the operator could believe in.
  assert.equal(raceName(9), 'unknown (9)');
  assert.equal(raceName(0), 'unknown (0)');
});

test('vanilla classes are named and the missing id 6 is not', () => {
  assert.equal(className(1), 'Warrior');
  assert.equal(className(2), 'Paladin');
  assert.equal(className(3), 'Hunter');
  assert.equal(className(4), 'Rogue');
  assert.equal(className(5), 'Priest');
  // Class 6 is Death Knight, which does not exist in 1.12.
  assert.equal(className(6), 'unknown (6)');
  assert.equal(className(7), 'Shaman');
  assert.equal(className(8), 'Mage');
  assert.equal(className(9), 'Warlock');
  assert.equal(className(11), 'Druid');
});

test('gender is named from the characters.gender column', () => {
  assert.equal(genderName(0), 'Male');
  assert.equal(genderName(1), 'Female');
  assert.equal(genderName(2), 'unknown (2)');
});

test('the race mask names match the core list in order', () => {
  assert.deepEqual(RACE_MASK_NAMES, [
    'human', 'orc', 'dwarf', 'nightelf', 'undead', 'tauren', 'gnome', 'troll',
    'alliance', 'horde', 'all'
  ]);
});

test('a non-numeric id does not crash the renderer', () => {
  assert.equal(raceName(null), 'unknown (null)');
  assert.equal(className(undefined), 'unknown (undefined)');
});
