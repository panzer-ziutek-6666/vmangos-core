// Race, class and gender ids as stored in characters.characters
// (vmangos-core/sql/characters.sql:37-39). Only the 1.12 playable set is
// named: this realm's client has no other races or classes, so an id outside
// these tables is corrupt data and must read as unknown rather than borrow a
// name from a later expansion.
//
// Class 6 (Death Knight), class 10 (which no client has) and races 9 and
// above belong to later expansions. Their absence here is deliberate.
const RACES = {
  1: 'Human', 2: 'Orc', 3: 'Dwarf', 4: 'Night Elf',
  5: 'Undead', 6: 'Tauren', 7: 'Gnome', 8: 'Troll'
};

const CLASSES = {
  1: 'Warrior', 2: 'Paladin', 3: 'Hunter', 4: 'Rogue', 5: 'Priest',
  7: 'Shaman', 8: 'Mage', 9: 'Warlock', 11: 'Druid'
};

const GENDERS = { 0: 'Male', 1: 'Female' };

// The unknown branch interpolates the ORIGINAL argument, not the coerced
// number: `Number(null)` is 0 and `Number(undefined)` is NaN, and reporting
// either as "unknown (0)" would name a race id the row does not carry.
function lookup(table, id) {
  const key = Number(id);
  return Object.hasOwn(table, key) ? table[key] : `unknown (${id})`;
}

export function raceName(id) {
  return lookup(RACES, id);
}

export function className(id) {
  return lookup(CLASSES, id);
}

export function genderName(id) {
  return lookup(GENDERS, id);
}

// The literals ExtractRaceMask accepts, in the core's own order
// (vmangos-core/src/game/Chat/Chat.cpp:3864-3883). A .send mass command also
// accepts a raw numeric mask, which server/commands/validate.js allows
// separately.
export const RACE_MASK_NAMES = [
  'human', 'orc', 'dwarf', 'nightelf', 'undead', 'tauren', 'gnome', 'troll',
  'alliance', 'horde', 'all'
];
