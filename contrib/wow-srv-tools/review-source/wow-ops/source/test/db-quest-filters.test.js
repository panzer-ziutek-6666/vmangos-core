import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuestFilters, QUEST_SORT_KEYS } from '../server/queries/db/questFilters.js';

test('no filters: no conditions, default sort', () => {
  const f = parseQuestFilters({});
  assert.deepEqual(f.conditions, []);
  assert.equal(f.sort, 'name');
  assert.equal(f.dir, 'asc');
  assert.equal(f.page, 1);
  assert.equal(f.pageSize, 50);
});

test('the name is a LIKE with its wildcards escaped', () => {
  const f = parseQuestFilters({ q: '100%' });
  assert.deepEqual(f.conditions, ['t1.Title LIKE ?']);
  assert.deepEqual(f.params, ['%100\\%%']);
});

test('a side takes quests with no playable-race restriction plus quests open to that side', () => {
  const a = parseQuestFilters({ side: 'alliance' });
  assert.deepEqual(a.conditions, ['((t1.RequiredRaces & ?) = 0 OR t1.RequiredRaces & ? <> 0)']);
  assert.deepEqual(a.params, [255, 77]);
  assert.deepEqual(parseQuestFilters({ side: 'horde' }).params, [255, 178]);
  assert.deepEqual(parseQuestFilters({ side: 'both' }).conditions, []);
});

test('a type must be one the core names, 0 included', () => {
  assert.deepEqual(parseQuestFilters({ type: '81' }).params, [81]);
  assert.deepEqual(parseQuestFilters({ type: '0' }).params, [0]);
  assert.deepEqual(parseQuestFilters({ type: '7' }).conditions, []);
});

// ZoneOrSort is a signed smallint: a zone is 1..32767, a sort is a negated id
// the core's QuestSort names. The parser has no database, so it bounds.
test('a category is a bounded zone id or a known negated sort id', () => {
  assert.deepEqual(parseQuestFilters({ category: '12' }).params, [12]);
  assert.deepEqual(parseQuestFilters({ category: '-61' }).params, [-61]);
  assert.deepEqual(parseQuestFilters({ category: '-999' }).conditions, []);
  assert.deepEqual(parseQuestFilters({ category: '40000' }).conditions, []);
  assert.deepEqual(parseQuestFilters({ category: '0' }).conditions, []);
  assert.deepEqual(parseQuestFilters({ category: '1e3' }).conditions, []);
  assert.equal(parseQuestFilters({ category: '-61' }).conditions[0], 't1.ZoneOrSort = ?');
});

// QuestLevel and MinLevel are tinyint unsigned: bounded by the column.
test('level and required-level ranges are bounded by their columns', () => {
  const f = parseQuestFilters({ minlevel: '10', maxlevel: '20', minreq: '5', maxreq: '255' });
  assert.deepEqual(f.conditions, ['t1.QuestLevel >= ?', 't1.QuestLevel <= ?', 't1.MinLevel >= ?', 't1.MinLevel <= ?']);
  assert.deepEqual(f.params, [10, 20, 5, 255]);
  assert.deepEqual(parseQuestFilters({ maxlevel: '256' }).conditions, []);
});

test('an unknown sort key falls back rather than reaching SQL', () => {
  const f = parseQuestFilters({ sort: 'Title); DROP TABLE quest_template; --' });
  assert.equal(f.sort, 'name');
  assert.ok(Object.hasOwn(QUEST_SORT_KEYS, f.sort));
});
