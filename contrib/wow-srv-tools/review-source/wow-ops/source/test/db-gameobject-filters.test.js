import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGameObjectFilters, GAMEOBJECT_SORTS, LOCK_ID_SQL, LOOT_ID_SQL, QUEST_ID_SQL } from '../server/queries/db/gameobjectFilters.js';

test('an empty query sorts by name, ascending, page 1', () => {
  const f = parseGameObjectFilters({});
  assert.deepEqual(f.conditions, []);
  assert.equal(f.sort, 'name');
  assert.equal(f.dir, 'asc');
  assert.equal(f.page, 1);
});

test('a name term is one bound LIKE with its wildcards escaped', () => {
  const f = parseGameObjectFilters({ q: '100%_chest' });
  assert.match(f.conditions[0], /t1\.name LIKE \?/);
  assert.deepEqual(f.params, ['%100\\%\\_chest%']);
});

test('type binds within the 27 types this realm carries', () => {
  // GameobjectTypes, vmangos-core/src/game/Objects/GameObjectDefines.h:24-67:
  // GAMEOBJECT_TYPE_DOOR = 0 (line 26) through GAMEOBJECT_TYPE_AURA_GENERATOR
  // = 30 (line 65), GAMEOBJECT_TYPE_MAX (line 67, not a real type) closes the
  // enum. 31 compiled-in values; this realm's gameobject_template carries 27
  // distinct ones.
  const f = parseGameObjectFilters({ type: '3' });
  assert.deepEqual(f.params, [3]);
});

test('type keeps the core enum edges and drops just past them', () => {
  const kept = parseGameObjectFilters({ type: '30' });
  assert.equal(kept.conditions.length, 1);
  assert.deepEqual(kept.params, [30]);

  const dropped = parseGameObjectFilters({ type: '31' });
  assert.deepEqual(dropped.conditions, []);
  assert.deepEqual(dropped.params, []);
});

// Both are "is it set", not a value to match, so they are boolean filters -
// and "it" is each type's own slot, not data0/data1 for every type: those
// are a spell focus's focus id and radius (walk finding, 2026-09-23).
test('locked and has-loot are presence filters, not value matches', () => {
  const f = parseGameObjectFilters({ locked: '1', loot: '1' });
  assert.equal(f.conditions.length, 2);
  assert.equal(f.conditions[0], `${LOCK_ID_SQL} <> 0`);
  assert.equal(f.conditions[1], `${LOOT_ID_SQL} <> 0`);
  assert.deepEqual(f.params, []);
});

// GetLockId (GameObjectDefines.h:559-581) and GetLootId (:670-680).
test('the lock slot follows the type and loot is chest and fishing hole only', () => {
  assert.ok(LOCK_ID_SQL.includes('WHEN t1.type IN (0, 1) THEN t1.data1'));
  assert.ok(LOCK_ID_SQL.includes('WHEN t1.type IN (25) THEN t1.data4'));
  assert.ok(LOCK_ID_SQL.includes('WHEN t1.type IN (2, 3, 6, 10, 12, 13, 24, 26) THEN t1.data0'));
  assert.ok(!/[(, ]8[,)]/.test(LOCK_ID_SQL), 'a spell focus (type 8) has no lock slot');
  assert.equal(LOOT_ID_SQL, '(CASE WHEN t1.type IN (3, 25) THEN t1.data1 ELSE 0 END)');
});

// GameObject.cpp:1227-1255 reads a quest id for these four types, each from
// its own slot.
test('the quest slot follows the type: chest, generic, spell focus and goober', () => {
  assert.ok(QUEST_ID_SQL.includes('WHEN t1.type IN (3) THEN t1.data8'));
  assert.ok(QUEST_ID_SQL.includes('WHEN t1.type IN (5) THEN t1.data5'));
  assert.ok(QUEST_ID_SQL.includes('WHEN t1.type IN (8) THEN t1.data4'));
  assert.ok(QUEST_ID_SQL.includes('WHEN t1.type IN (10) THEN t1.data1'));
});

test('an unknown sort key falls back rather than reaching SQL', () => {
  const f = parseGameObjectFilters({ sort: 'name); DROP TABLE gameobject_template; --' });
  assert.equal(f.sort, 'name');
  assert.ok(Object.hasOwn(GAMEOBJECT_SORTS, f.sort));
});

test('junk values are dropped and the listview still renders', () => {
  const f = parseGameObjectFilters({ type: 'banana', locked: '', loot: undefined });
  assert.deepEqual(f.conditions, []);
  assert.deepEqual(f.params, []);
});
