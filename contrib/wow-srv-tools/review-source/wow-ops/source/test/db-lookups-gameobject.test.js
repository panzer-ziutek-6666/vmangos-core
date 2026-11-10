import test from 'node:test';
import assert from 'node:assert/strict';
import { gameObjectTypeName, knownDataSlots } from '../server/dbLookups/gameObjectTypes.js';

test('gameobject types are named', () => {
  assert.equal(gameObjectTypeName(0), 'Door');
  assert.equal(gameObjectTypeName(3), 'Chest');
  assert.equal(gameObjectTypeName(10), 'Goober');
  assert.equal(gameObjectTypeName(77), 'Unknown (77)');
});

test('a chest names every slot the data union defines, not just data1', () => {
  // GAMEOBJECT_TYPE_CHEST's data union in
  // vmangos-core/src/game/Objects/GameObjectDefines.h:260-278: lockId is 0,
  // lootId is 1, maxSuccessOpens is 5. The union has 16 named fields (0-15);
  // slot 20 is past the end and stays a plain number.
  const chest = knownDataSlots(3);
  assert.equal(chest.get(0), 'lock id');
  assert.equal(chest.get(1), 'loot id');
  assert.equal(chest.get(5), 'max success opens');
  assert.equal(chest.has(20), false);
});

test('a door names every slot its data union defines', () => {
  // GAMEOBJECT_TYPE_DOOR's data union, GameObjectDefines.h:223-231: 6 fields,
  // startOpen (0) through closeTextID (5).
  const door = knownDataSlots(0);
  assert.equal(door.get(0), 'start open');
  assert.equal(door.get(5), 'close text id');
  assert.equal(door.size, 6);
});

test('a questgiver names data1 as its quest list and data4 as its custom anim', () => {
  // GameObjectDefines.h:246-258: questgiver.questList is slot 1 and slot 4 is
  // customAnim - both are named in the struct, so both are labelled.
  assert.equal(knownDataSlots(2).get(1), 'quest list');
  assert.equal(knownDataSlots(2).get(4), 'custom anim');
});

test('a goober names data1 as its quest id', () => {
  // GameObjectDefines.h:333-347: goober.questId is slot 1.
  assert.equal(knownDataSlots(10).get(1), 'quest id');
});

test('a type with no known slots returns an empty map, not undefined', () => {
  assert.equal(knownDataSlots(77).size, 0);
});
