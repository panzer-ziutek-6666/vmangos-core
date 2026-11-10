// creature_template.type, .rank, .unit_class and .npc_flags, from
// vmangos-core/src/game/Objects/CreatureDefines.h and UnitDefines.h. An id or
// bit this table does not know is rendered with its number rather than
// dropped: a missing flag reads as a fact about the creature when it is a
// fact about this table, not about the creature.

// CreatureType (CreatureType.dbc), vmangos-core/src/game/Objects/
// CreatureDefines.h:40-53. There is no value 0 in the enum - the struct
// field itself defaults to 0 (CreatureDefines.h:253), but that is "unset",
// not a named type, so 0 falls through to the Unknown branch below.
const TYPE_NAMES = new Map([
  [1, 'Beast'], [2, 'Dragonkin'], [3, 'Demon'], [4, 'Elemental'],
  [5, 'Giant'], [6, 'Undead'], [7, 'Humanoid'], [8, 'Critter'],
  [9, 'Mechanical'], [10, 'Not specified'], [11, 'Totem']
]);

// CreatureFamily (CreatureFamily.dbc), CreatureDefines.h:59-85. Gaps (13, 14,
// 18, 22) are real: those ids are not assigned in the DBC.
const FAMILY_NAMES = new Map([
  [1, 'Wolf'], [2, 'Cat'], [3, 'Spider'], [4, 'Bear'], [5, 'Boar'],
  [6, 'Crocolisk'], [7, 'Carrion bird'], [8, 'Crab'], [9, 'Gorilla'],
  [10, 'Horse'], [11, 'Raptor'], [12, 'Tallstrider'], [15, 'Felhunter'],
  [16, 'Voidwalker'], [17, 'Succubus'], [19, 'Doomguard'], [20, 'Scorpid'],
  [21, 'Turtle'], [23, 'Imp'], [24, 'Bat'], [25, 'Hyena'], [26, 'Owl'],
  [27, 'Wind serpent'], [28, 'Remote control']
]);

// CreatureEliteType, CreatureDefines.h:87-94. 3 is the world boss and 4 is
// the plain rare - the numbers do not sort by toughness.
const RANK_NAMES = new Map([
  [0, 'Normal'], [1, 'Elite'], [2, 'Rare elite'], [3, 'World boss'], [4, 'Rare']
]);

// creature_template.unit_class stores Classes values (vmangos-core/src/game/
// SharedDefines.h:87-100 - note that file lives under src/game, not
// src/shared). Only 1, 2, 3, 4, 5, 7, 8, 9 and 11 exist; 6 (Death Knight) and
// 10 belong to later expansions and are absent from this client's DBC.
const UNIT_CLASS_NAMES = new Map([
  [1, 'Warrior'], [2, 'Paladin'], [3, 'Hunter'], [4, 'Rogue'], [5, 'Priest'],
  [7, 'Shaman'], [8, 'Mage'], [9, 'Warlock'], [11, 'Druid']
]);

// NPCFlags, vmangos-core/src/game/Objects/UnitDefines.h:600-618. Vendor is
// 0x4; 0x80 is the innkeeper - the two are easy to swap by mis-reading order.
const NPC_FLAG_NAMES = new Map([
  [0x00000001, 'Gossip'],
  [0x00000002, 'Quest giver'],
  [0x00000004, 'Vendor'],
  [0x00000008, 'Flight master'],
  [0x00000010, 'Trainer'],
  [0x00000020, 'Spirit healer'],
  [0x00000040, 'Spirit guide'],
  [0x00000080, 'Innkeeper'],
  [0x00000100, 'Banker'],
  [0x00000200, 'Petitioner'],
  [0x00000400, 'Tabard designer'],
  [0x00000800, 'Battlemaster'],
  [0x00001000, 'Auctioneer'],
  [0x00002000, 'Stable master'],
  [0x00004000, 'Repair']
]);

// MovementGeneratorType, vmangos-core/src/game/Movement/MotionMaster.h:36-42.
// Only 0..3 (MAX_DB_MOTION_TYPE) can ever be set from the database - the
// generator types above that are runtime-only states (confused, fleeing,
// ...) and never appear in creature_template.movement_type.
const MOVEMENT_TYPE_NAMES = new Map([
  [0, 'Idle'], [1, 'Random'], [2, 'Waypoint'], [3, 'Cyclic']
]);

// InhabitTypeValues, CreatureDefines.h:460-466 - a 3-bit mask, not an enum:
// ground (1), water (2) and air (4) combine, and 7 is "anywhere" (all three
// set), not a fourth distinct value.
const INHABIT_TYPE_NAMES = new Map([
  [0x1, 'Ground'], [0x2, 'Water'], [0x4, 'Air']
]);

function lookup(table, id) {
  const key = Number(id);
  return table.has(key) ? table.get(key) : `Unknown (${id})`;
}

export function creatureTypeName(id) {
  return lookup(TYPE_NAMES, id);
}

export function creatureFamilyName(id) {
  return lookup(FAMILY_NAMES, id);
}

export function creatureRankName(id) {
  return lookup(RANK_NAMES, id);
}

export function unitClassName(id) {
  return lookup(UNIT_CLASS_NAMES, id);
}

export function movementTypeName(id) {
  return lookup(MOVEMENT_TYPE_NAMES, id);
}

// Walks the 3 known bits the same way npcFlagNames walks NPCFlags, so an
// unrecognised bit is reported rather than silently dropped.
export function inhabitTypeNames(mask) {
  const value = Number(mask) >>> 0;
  const names = [];
  for (const [flag, name] of INHABIT_TYPE_NAMES) {
    if (value & flag) names.push(name);
  }
  const known = [...INHABIT_TYPE_NAMES.keys()].reduce((acc, f) => acc | f, 0);
  const unknownBits = value & ~known;
  if (unknownBits) names.push(`Unknown (0x${unknownBits.toString(16)})`);
  return names;
}

// Walks all 32 bits of the mask rather than only the ones this table knows,
// so an unrecognised bit is reported (with its hex value) instead of
// vanishing - a silently dropped flag is how an operator concludes an NPC is
// not a vendor when the DB says it is.
export function npcFlagNames(mask) {
  const value = Number(mask) >>> 0;
  const names = [];
  for (let bit = 0; bit < 32; bit++) {
    const flag = (1 << bit) >>> 0;
    if (value & flag) {
      const known = NPC_FLAG_NAMES.get(flag);
      names.push(known ?? `Unknown (0x${flag.toString(16)})`);
    }
  }
  return names;
}
