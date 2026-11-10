import test from 'node:test';
import assert from 'node:assert/strict';
import { creatureTypeName, creatureRankName, unitClassName, npcFlagNames, movementTypeName, inhabitTypeNames } from '../server/dbLookups/creatureTypes.js';

test('creature types are named, and an unknown one says so with its number', () => {
  assert.equal(creatureTypeName(1), 'Beast');
  assert.equal(creatureTypeName(7), 'Humanoid');
  assert.equal(creatureTypeName(99), 'Unknown (99)');
});

test('ranks are named', () => {
  // CREATURE_ELITE_* in vmangos-core/src/game/Objects/CreatureDefines.h:89-93.
  // 3 is the world boss and 4 is the plain rare - not the other way round.
  assert.equal(creatureRankName(0), 'Normal');
  assert.equal(creatureRankName(1), 'Elite');
  assert.equal(creatureRankName(2), 'Rare elite');
  assert.equal(creatureRankName(3), 'World boss');
  assert.equal(creatureRankName(4), 'Rare');
});

test('unit classes are named', () => {
  // creature_template.unit_class holds Classes values
  // (vmangos-core/src/game/SharedDefines.h:87-97); this realm uses 1, 2 and 8.
  assert.equal(unitClassName(1), 'Warrior');
  assert.equal(unitClassName(2), 'Paladin');
  assert.equal(unitClassName(8), 'Mage');
});

test('npc flags decode to names, and unnamed bits are kept as numbers', () => {
  // UNIT_NPC_FLAG_* in vmangos-core/src/game/Objects/UnitDefines.h:602-617.
  // Vendor is 0x4, not 0x80 - 0x80 is the innkeeper.
  //
  // A bit this table does not know must not vanish: a silently dropped flag is
  // how an operator concludes an NPC is not a vendor when the DB says it is.
  assert.deepEqual(npcFlagNames(0), []);
  assert.deepEqual(npcFlagNames(4), ['Vendor']);
  assert.deepEqual(npcFlagNames(128), ['Innkeeper']);
  assert.deepEqual(npcFlagNames(3), ['Gossip', 'Quest giver']);
  assert.ok(npcFlagNames(0x80000000).some((n) => n.includes('0x80000000')));
});

test('movement types are named', () => {
  // MovementGeneratorType, vmangos-core/src/game/Movement/MotionMaster.h:36-42.
  assert.equal(movementTypeName(0), 'Idle');
  assert.equal(movementTypeName(1), 'Random');
  assert.equal(movementTypeName(2), 'Waypoint');
  assert.equal(movementTypeName(3), 'Cyclic');
});

test('inhabit type is a bitmask of ground/water/air, and 7 is all three, not a fourth value', () => {
  // InhabitTypeValues, vmangos-core/src/game/Objects/CreatureDefines.h:460-466.
  assert.deepEqual(inhabitTypeNames(1), ['Ground']);
  assert.deepEqual(inhabitTypeNames(2), ['Water']);
  assert.deepEqual(inhabitTypeNames(7), ['Ground', 'Water', 'Air']);
  assert.ok(inhabitTypeNames(8).some((n) => n.includes('0x8')));
});
