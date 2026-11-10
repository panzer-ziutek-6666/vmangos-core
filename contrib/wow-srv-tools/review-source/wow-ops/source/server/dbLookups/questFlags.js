// quest_template.RequiredRaces, .RequiredClasses and .QuestFlags, from
// vmangos-core/src/game/SharedDefines.h (note: that file lives under
// src/game, not src/shared) and vmangos-core/src/game/QuestDef.h. A bit this
// table does not know is rendered with its value rather than dropped.

// Races, vmangos-core/src/game/SharedDefines.h:56-67.
const RACE_NAMES_BY_VALUE = new Map([
  [1, 'Human'], [2, 'Orc'], [3, 'Dwarf'], [4, 'Night Elf'], [5, 'Undead'],
  [6, 'Tauren'], [7, 'Gnome'], [8, 'Troll'], [9, 'Goblin']
]);

// Classes, SharedDefines.h:87-100. 6 (Death Knight) and 10 are not present
// in this client's DBC.
const CLASS_NAMES_BY_VALUE = new Map([
  [1, 'Warrior'], [2, 'Paladin'], [3, 'Hunter'], [4, 'Rogue'], [5, 'Priest'],
  [7, 'Shaman'], [8, 'Mage'], [9, 'Warlock'], [11, 'Druid']
]);

// QuestFlags, vmangos-core/src/game/QuestDef.h:146-161. 0x10 and 0x100 are
// left out: 0x10 has no name at all in the header (it is a commented-out
// "//QUEST_FLAGS_NONE2"), and 0x100 is named only "UNK2" by the core's own
// authors - inventing a label for either would be a guess, not a fact read
// off the source.
const QUEST_FLAG_NAMES = new Map([
  [0x00000001, 'Stay alive'],
  [0x00000002, 'Party accept'],
  [0x00000004, 'Exploration'],
  [0x00000008, 'Sharable'],
  [0x00000020, 'Epic'],
  [0x00000040, 'Raid'],
  [0x00000200, 'Hidden rewards'],
  [0x00000400, 'Auto rewarded']
]);

// A mask bit is `1 << (value - 1)`, not the enum value itself - RACE_DWARF
// is 3 and its bit is 4 (SharedDefines.h:60). Mapping the raw value straight
// to a bit would name the wrong races (and classes) for every mask.
function namesFromValueMask(mask, namesByValue) {
  const value = Number(mask) >>> 0;
  const names = [];
  for (const [id, name] of namesByValue) {
    const bit = (1 << (id - 1)) >>> 0;
    if (value & bit) names.push(name);
  }
  // Report bits this table cannot attribute to a known race/class value,
  // instead of silently folding them into the count of races that can take
  // the quest.
  for (let bitIndex = 0; bitIndex < 32; bitIndex++) {
    const bit = (1 << bitIndex) >>> 0;
    if (!(value & bit)) continue;
    const knownValue = bitIndex + 1;
    if (!namesByValue.has(knownValue)) names.push(`Unknown (0x${bit.toString(16)})`);
  }
  return names;
}

// RequiredRaces = 0 means "no restriction", not "no race can take this
// quest" - rendering it as an empty list would read as the opposite of the
// truth, so a zero mask is special-cased before walking bits.
export function raceNames(mask) {
  const value = Number(mask) >>> 0;
  if (value === 0) return ['All races'];
  return namesFromValueMask(value, RACE_NAMES_BY_VALUE);
}

export function classNames(mask) {
  const value = Number(mask) >>> 0;
  if (value === 0) return ['All classes'];
  return namesFromValueMask(value, CLASS_NAMES_BY_VALUE);
}

export function questFlagNames(mask) {
  const value = Number(mask) >>> 0;
  const names = [];
  for (let bit = 0; bit < 32; bit++) {
    const flag = (1 << bit) >>> 0;
    if (value & flag) {
      const known = QUEST_FLAG_NAMES.get(flag);
      names.push(known ?? `Unknown (0x${flag.toString(16)})`);
    }
  }
  return names;
}
