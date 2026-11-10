// gameobject_template.type and its per-type `data` slots, from
// vmangos-core/src/game/Objects/GameObjectDefines.h. All 31 types are
// compiled in for this realm's 1.12.1 client build (the higher types are
// gated behind `#if SUPPORTED_CLIENT_BUILD > CLIENT_BUILD_1_x_y` checks that
// are all satisfied by 1.12.1, GameObjectDefines.h:50-67). An id this table
// does not know is rendered with its number rather than dropped.
const TYPE_NAMES = new Map([
  [0, 'Door'], [1, 'Button'], [2, 'Quest giver'], [3, 'Chest'],
  [4, 'Binder'], [5, 'Generic'], [6, 'Trap'], [7, 'Chair'],
  [8, 'Spell focus'], [9, 'Text'], [10, 'Goober'], [11, 'Transport'],
  [12, 'Area damage'], [13, 'Camera'], [14, 'Map object'],
  [15, 'Transport (map object)'], [16, 'Duel arbiter'], [17, 'Fishing node'],
  [18, 'Summoning ritual'], [19, 'Mailbox'], [20, 'Auction house'],
  [21, 'Guard post'], [22, 'Spellcaster'], [23, 'Meeting stone'],
  [24, 'Flag stand'], [25, 'Fishing hole'], [26, 'Flag drop'],
  [27, 'Mini game'], [28, 'Lottery kiosk'], [29, 'Capture point'],
  [30, 'Aura generator']
]);

export function gameObjectTypeName(id) {
  const key = Number(id);
  return TYPE_NAMES.has(key) ? TYPE_NAMES.get(key) : `Unknown (${id})`;
}

// The `data` union in GameObjectInfo (GameObjectDefines.h:220-529) reuses
// the same data0..data23 columns for a different, type-specific struct per
// gameobject type. That struct is the authority on what each slot means for
// that type, so every field it names is transcribed here (camelCase field
// name -> lowercase, space-separated label, e.g. `lockId` -> "lock id",
// `maxSuccessOpens` -> "max success opens", `autoCloseTime` -> "auto close
// time"). A slot the struct does not define - past the end of a shorter
// type's field list, or for a type with no struct at all (4 BINDER, 14
// MAPOBJECT, 16 DUELFLAG, 19 MAILBOX, 28 LOTTERY_KIOSK) - is simply absent
// from that type's Map, and the page always shows the raw slot number
// regardless: an honest gap costs nothing, while a guessed label costs
// trust. Slot 0 of 17 FISHINGNODE is the one exception inside an otherwise
// defined struct: the header itself names that field `_data0`
// (GameObjectDefines.h:400), i.e. it does not name it either, so it is left
// out the same way as an undefined slot.
const SLOT_FIELDS = new Map([
  // 0 GAMEOBJECT_TYPE_DOOR, GameObjectDefines.h:223-231
  [0, ['start open', 'lock id', 'auto close time', 'no damage immune', 'open text id', 'close text id']],
  // 1 GAMEOBJECT_TYPE_BUTTON, :233-244
  [1, ['start open', 'lock id', 'auto close time', 'linked trap id', 'no damage immune', 'large', 'open text id', 'close text id', 'los ok']],
  // 2 GAMEOBJECT_TYPE_QUESTGIVER, :246-258
  [2, ['lock id', 'quest list', 'page material', 'gossip id', 'custom anim', 'no damage immune', 'open text id', 'los ok', 'allow mounted', 'large']],
  // 3 GAMEOBJECT_TYPE_CHEST, :260-278
  [3, ['lock id', 'loot id', 'chest restock time', 'consumable', 'min success opens', 'max success opens', 'event id', 'linked trap id', 'quest id', 'level', 'los ok', 'leave loot', 'not in combat', 'log loot', 'open text id', 'group loot rules']],
  // 4 GAMEOBJECT_TYPE_BINDER - no struct in the union, :279
  [4, []],
  // 5 GAMEOBJECT_TYPE_GENERIC, :281-289
  [5, ['floating tooltip', 'highlight', 'server only', 'large', 'float on water', 'quest id']],
  // 6 GAMEOBJECT_TYPE_TRAP, :291-307
  [6, ['lock id', 'level', 'radius', 'spell id', 'charges', 'cooldown', 'auto close time', 'start delay', 'server only', 'stealthed', 'large', 'stealth affected', 'open text id', 'close text id']],
  // 7 GAMEOBJECT_TYPE_CHAIR, :309-314
  [7, ['slots', 'height', 'only creator use']],
  // 8 GAMEOBJECT_TYPE_SPELL_FOCUS, :316-324
  [8, ['focus id', 'dist', 'linked trap id', 'server only', 'quest id', 'large']],
  // 9 GAMEOBJECT_TYPE_TEXT, :326-332
  [9, ['page id', 'language', 'page material', 'allow mounted']],
  // 10 GAMEOBJECT_TYPE_GOOBER, :334-356
  [10, ['lock id', 'quest id', 'event id', 'auto close time', 'custom anim', 'consumable', 'cooldown', 'page id', 'language', 'page material', 'spell id', 'no damage immune', 'linked trap id', 'large', 'open text id', 'close text id', 'los ok', 'allow mounted', 'floating tooltip', 'gossip id']],
  // 11 GAMEOBJECT_TYPE_TRANSPORT, :358-363
  [11, ['pause', 'start open', 'auto close time']],
  // 12 GAMEOBJECT_TYPE_AREADAMAGE, :365-375
  [12, ['lock id', 'radius', 'damage min', 'damage max', 'damage school', 'auto close time', 'open text id', 'close text id']],
  // 13 GAMEOBJECT_TYPE_CAMERA, :377-383
  [13, ['lock id', 'cinematic id', 'event id', 'open text id']],
  // 14 GAMEOBJECT_TYPE_MAPOBJECT - no struct in the union, :384
  [14, []],
  // 15 GAMEOBJECT_TYPE_MO_TRANSPORT, :386-395
  [15, ['taxi path id', 'move speed', 'accel rate', 'start event id', 'stop event id', 'transport physics', 'map id']],
  // 16 GAMEOBJECT_TYPE_DUELFLAG - no struct in the union, :396
  [16, []],
  // 17 GAMEOBJECT_TYPE_FISHINGNODE, :398-402 - slot 0 is itself named
  // `_data0` in the header, so it is left unlabelled.
  [17, [null, 'loot id']],
  // 18 GAMEOBJECT_TYPE_SUMMONING_RITUAL, :404-414
  [18, ['req participants', 'spell id', 'anim spell', 'ritual persistent', 'caster target spell', 'caster target spell targets', 'casters grouped', 'ritual no target check']],
  // 19 GAMEOBJECT_TYPE_MAILBOX - no struct in the union, :415
  [19, []],
  // 20 GAMEOBJECT_TYPE_AUCTIONHOUSE, :417-420
  [20, ['auction house id']],
  // 21 GAMEOBJECT_TYPE_GUARDPOST, :422-426
  [21, ['creature id', 'charges']],
  // 22 GAMEOBJECT_TYPE_SPELLCASTER, :428-436
  [22, ['spell id', 'charges', 'party only', 'allow mounted', 'large', 'condition id']],
  // 23 GAMEOBJECT_TYPE_MEETINGSTONE, :438-443
  [23, ['min level', 'max level', 'area id']],
  // 24 GAMEOBJECT_TYPE_FLAGSTAND, :446-456
  [24, ['lock id', 'pickup spell', 'radius', 'return aura', 'return spell', 'no damage immune', 'open text id', 'los ok']],
  // 25 GAMEOBJECT_TYPE_FISHINGHOLE, :460-467
  [25, ['radius', 'loot id', 'min success opens', 'max success opens', 'lock id']],
  // 26 GAMEOBJECT_TYPE_FLAGDROP, :472-478
  [26, ['lock id', 'event id', 'pickup spell', 'no damage immune', 'open text id']],
  // 27 GAMEOBJECT_TYPE_MINI_GAME, :483-485
  [27, ['game type']],
  // 28 GAMEOBJECT_TYPE_LOTTERY_KIOSK - declared in the type enum
  // (GameObjectDefines.h:61) but has no data struct in the union.
  [28, []],
  // 29 GAMEOBJECT_TYPE_CAPTURE_POINT, :489-511
  [29, ['radius', 'spell', 'world state 1', 'world state 2', 'win event id 1', 'win event id 2', 'contested event id 1', 'contested event id 2', 'progress event id 1', 'progress event id 2', 'neutral event id 1', 'neutral event id 2', 'neutral percent', 'world state 3', 'min superiority', 'max superiority', 'min time', 'max time', 'large', 'highlight']],
  // 30 GAMEOBJECT_TYPE_AURA_GENERATOR, :513-522
  [30, ['start open', 'radius', 'aura id 1', 'condition id 1', 'aura id 2', 'condition id 2', 'server only']]
]);

// Every type whose struct names `label`, grouped by the data slot it sits in
// - 'lock id' is data1 for door and button, data4 for fishing hole and data0
// for the rest, exactly the fields GameObjectInfo::GetLockId() switches over
// (GameObjectDefines.h:559-581). The listview reads these slots per type in
// SQL (gameobjectFilters.js) rather than one fixed column for all types,
// because data0 of a spell focus is its focus id and data1 its radius, not a
// lock or a loot table.
export function typesBySlot(label) {
  const bySlot = new Map();
  for (const [type, fields] of SLOT_FIELDS) {
    const index = fields.indexOf(label);
    if (index !== -1) bySlot.set(index, [...(bySlot.get(index) ?? []), type]);
  }
  return bySlot;
}

// The same lookup for one row already in hand: the value of the slot its
// type names `label`, or 0 for a type that names no such slot.
export function namedSlotValue(row, label) {
  const index = SLOT_FIELDS.get(Number(row.type))?.indexOf(label) ?? -1;
  return index === -1 ? 0 : Number(row[`data${index}`]);
}

export function knownDataSlots(type) {
  const fields = SLOT_FIELDS.get(Number(type));
  const slots = new Map();
  if (!fields) return slots;
  fields.forEach((label, index) => {
    if (label != null) slots.set(index, label);
  });
  return slots;
}
