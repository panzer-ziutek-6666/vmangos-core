import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUEST_SORTS, QUEST_TYPES, questTypeName, questSide, questLevelLabel, categoryLabel, categoryGroup,
  CATEGORY_GROUPS, RACEMASK_ALL_PLAYABLE
} from '../server/dbLookups/questCategories.js';

// The 29 negative ZoneOrSort values quest_template uses at patch 10
// (measured 2026-09-23); every one must have a name.
const SORTS_IN_USE = [1, 22, 24, 61, 81, 82, 101, 121, 141, 161, 162, 181, 182, 201, 221,
  261, 262, 263, 264, 284, 304, 324, 344, 364, 365, 366, 367, 368, 369];

test('every quest sort in use has a name and a group', () => {
  for (const id of SORTS_IN_USE) {
    assert.ok(QUEST_SORTS.has(id), `sort ${id}`);
    assert.ok(['class', 'profession', 'other'].includes(QUEST_SORTS.get(id).group));
  }
});

test('class and profession sorts land in their groups', () => {
  assert.equal(QUEST_SORTS.get(61).group, 'class');       // Warlock
  assert.equal(QUEST_SORTS.get(263).group, 'class');      // Druid
  assert.equal(QUEST_SORTS.get(182).group, 'profession'); // Leatherworking
  assert.equal(QUEST_SORTS.get(365).group, 'other');      // Ahn'Qiraj War
});

test('every quest type in use has a name, 0 is Normal', () => {
  for (const t of [0, 1, 21, 41, 62, 81, 82]) assert.ok(QUEST_TYPES.has(t), `type ${t}`);
  assert.equal(questTypeName(0), 'Normal');
  assert.equal(questTypeName(81), 'Dungeon');
  assert.equal(questTypeName(99), 'Unknown (99)');
});

test('side comes from the core race masks - it names a race restriction, not a faction', () => {
  assert.equal(RACEMASK_ALL_PLAYABLE, 255);
  assert.equal(questSide(0), 'Any');
  assert.equal(questSide(77), 'Alliance');
  assert.equal(questSide(178), 'Horde');
  assert.equal(questSide(255), 'Any');     // every playable race bit set
  assert.equal(questSide(8), 'Alliance');  // Night Elf only
  assert.equal(questSide(32), 'Horde');    // Tauren only
  assert.equal(questSide(3), 'Mixed');     // Human + Orc: both sides, not every race
  assert.equal(questSide(256), 'Any');     // Goblin bit alone: no playable bit, core resets it to 0
});

test('a quest level of 0 means the player\'s own level, not level zero', () => {
  assert.equal(questLevelLabel(0), "player's level");
  assert.equal(questLevelLabel(11), '11');
});

test('category labels: zone name, sort name, or the id when unknown', () => {
  assert.equal(categoryLabel(12, 'Elwynn Forest'), 'Elwynn Forest');
  assert.equal(categoryLabel(12, null), 'zone #12');
  assert.equal(categoryLabel(-61, null), 'Warlock');
  assert.equal(categoryLabel(-999, null), 'sort #999');
  assert.equal(categoryLabel(0, null), null);
});

test('category groups: zones by map, sorts by their group', () => {
  assert.equal(categoryGroup(12, 0), 'Eastern Kingdoms');
  assert.equal(categoryGroup(14, 1), 'Kalimdor');
  assert.equal(categoryGroup(1581, 36), 'Dungeons and raids');
  assert.equal(categoryGroup(5000, null), 'Other zones');
  assert.equal(categoryGroup(-61, null), 'Class');
  assert.equal(categoryGroup(-182, null), 'Profession');
  assert.equal(categoryGroup(-22, null), 'Seasonal and other');
  assert.equal(categoryGroup(-999, null), 'Seasonal and other');
  for (const g of ['Eastern Kingdoms', 'Class', 'Other zones']) assert.ok(CATEGORY_GROUPS.includes(g));
});
