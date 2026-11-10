// quest_template.ZoneOrSort, .Type and .RequiredRaces, named from the core.
// A positive ZoneOrSort is a zone (area_template.entry); a negative one is a
// QuestSort id stored negated. An id this table does not know is shown as
// its number, never dropped.

// QuestSort, vmangos-core/src/game/SharedDefines.h:886-920. The group is this
// panel's own grouping for the category select, not a core field.
export const QUEST_SORTS = new Map([
  [1, { name: 'Epic', group: 'other' }],
  [21, { name: 'Wailing Caverns (old)', group: 'other' }],
  [22, { name: 'Seasonal', group: 'other' }],
  [23, { name: 'Undercity (old)', group: 'other' }],
  [24, { name: 'Herbalism', group: 'profession' }],
  [25, { name: 'Scarlet Monastery (old)', group: 'other' }],
  [41, { name: 'Uldaman (old)', group: 'other' }],
  [61, { name: 'Warlock', group: 'class' }],
  [81, { name: 'Warrior', group: 'class' }],
  [82, { name: 'Shaman', group: 'class' }],
  [101, { name: 'Fishing', group: 'profession' }],
  [121, { name: 'Blacksmithing', group: 'profession' }],
  [141, { name: 'Paladin', group: 'class' }],
  [161, { name: 'Mage', group: 'class' }],
  [162, { name: 'Rogue', group: 'class' }],
  [181, { name: 'Alchemy', group: 'profession' }],
  [182, { name: 'Leatherworking', group: 'profession' }],
  [201, { name: 'Engineering', group: 'profession' }],
  [221, { name: 'Treasure Map', group: 'other' }],
  [241, { name: 'Sunken Temple (old)', group: 'other' }],
  [261, { name: 'Hunter', group: 'class' }],
  [262, { name: 'Priest', group: 'class' }],
  [263, { name: 'Druid', group: 'class' }],
  [264, { name: 'Tailoring', group: 'profession' }],
  [284, { name: 'Special', group: 'other' }],
  [304, { name: 'Cooking', group: 'profession' }],
  [324, { name: 'First Aid', group: 'profession' }],
  [344, { name: 'Legendary', group: 'other' }],
  [364, { name: 'Darkmoon Faire', group: 'other' }],
  [365, { name: "Ahn'Qiraj War", group: 'other' }],
  [366, { name: 'Lunar Festival', group: 'other' }],
  [367, { name: 'Reputation', group: 'other' }],
  [368, { name: 'Invasion', group: 'other' }],
  [369, { name: 'Midsummer', group: 'other' }],
  [370, { name: 'Brewfest', group: 'other' }]
]);

// QuestTypes, vmangos-core/src/game/QuestDef.h:133-144 ("values based at
// QuestInfo.dbc"). 0 is not in the enum: it is the column's default, a quest
// with no special type, and 3284 of 4433 quests carry it.
export const QUEST_TYPES = new Map([
  [0, 'Normal'], [1, 'Elite'], [21, 'Life'], [41, 'PvP'], [62, 'Raid'],
  [81, 'Dungeon'], [82, 'World Event'], [83, 'Legendary'], [84, 'Escort']
]);

export function questTypeName(type) {
  const key = Number(type);
  return QUEST_TYPES.has(key) ? QUEST_TYPES.get(key) : `Unknown (${type})`;
}

// RACEMASK_ALLIANCE and RACEMASK_HORDE, vmangos-core/src/game/SharedDefines.h:78-84:
// Human|Dwarf|NightElf|Gnome = 1|4|8|64 and Orc|Undead|Tauren|Troll = 2|16|32|128.
export const RACEMASK_ALLIANCE = 77;
export const RACEMASK_HORDE = 178;

// RACEMASK_ALL_PLAYABLE, vmangos-core/src/game/SharedDefines.h:72-75: the
// eight playable race bits (every race but Goblin). At load
// (vmangos-core/src/game/ObjectMgr.cpp:5681-5687) a non-zero RequiredRaces
// with no bit of this mask is logged and reset to 0 - "all races" - so this
// module treats the two the same rather than pretending the value survives.
export const RACEMASK_ALL_PLAYABLE = 255;

// RequiredRaces restricts which races can take the quest; it says nothing
// about faction. Player::SatisfyQuestRace (vmangos-core/src/game/Objects/
// Player.cpp:13726-13742) passes any race when the mask is 0, and a mask
// with no playable bit is reset to 0 at load (RACEMASK_ALL_PLAYABLE above) -
// but the quest giver's own faction can still limit who is offered the
// quest, and this function has no way to see that. It names the race
// restriction only.
export function questSide(requiredRaces) {
  const mask = Number(requiredRaces);
  if ((mask & RACEMASK_ALL_PLAYABLE) === 0) return 'Any';
  const alliance = (mask & RACEMASK_ALLIANCE) !== 0;
  const horde = (mask & RACEMASK_HORDE) !== 0;
  if (alliance && horde) return (mask & RACEMASK_ALL_PLAYABLE) === RACEMASK_ALL_PLAYABLE ? 'Any' : 'Mixed';
  return alliance ? 'Alliance' : 'Horde';
}

// GetQuestLevelForPlayer, vmangos-core/src/game/Objects/Player.h:1129: a
// QuestLevel of 0 does not mean level zero, it means the taking player's own
// level - the core substitutes GetLevel() for it everywhere a quest level is
// read.
export function questLevelLabel(questLevel) {
  return Number(questLevel) === 0 ? "player's level" : String(Number(questLevel));
}

export const CATEGORY_GROUPS = [
  'Eastern Kingdoms', 'Kalimdor', 'Dungeons and raids', 'Other zones',
  'Class', 'Profession', 'Seasonal and other'
];

const SORT_GROUP_LABELS = { class: 'Class', profession: 'Profession', other: 'Seasonal and other' };

export function categoryLabel(zoneOrSort, zoneName) {
  const value = Number(zoneOrSort);
  if (value === 0) return null;
  if (value > 0) return zoneName || `zone #${value}`;
  return QUEST_SORTS.get(-value)?.name ?? `sort #${-value}`;
}

// A zone is grouped by its area_template.map_id: 0 and 1 are the two
// continents; any other map is an instance. A zone that area_template does
// not name has no map and goes to "Other zones".
export function categoryGroup(zoneOrSort, mapId) {
  const value = Number(zoneOrSort);
  if (value > 0) {
    if (mapId === null || mapId === undefined) return 'Other zones';
    if (Number(mapId) === 0) return 'Eastern Kingdoms';
    if (Number(mapId) === 1) return 'Kalimdor';
    return 'Dungeons and raids';
  }
  return SORT_GROUP_LABELS[QUEST_SORTS.get(-value)?.group ?? 'other'];
}
