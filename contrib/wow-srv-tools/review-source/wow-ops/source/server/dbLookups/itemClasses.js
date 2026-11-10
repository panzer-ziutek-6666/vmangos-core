// item_template.Quality, .class, .subclass, .InventoryType and .bonding,
// from vmangos-core/src/game/Objects/ItemPrototype.h. An id this table does
// not know is rendered with its number rather than dropped.

// ItemQuality, vmangos-core/src/game/SharedDefines.h:194-200.
const QUALITY_NAMES = new Map([
  [0, 'Poor'], [1, 'Normal'], [2, 'Uncommon'], [3, 'Rare'], [4, 'Epic'],
  [5, 'Legendary'], [6, 'Artifact']
]);

// ItemClass, ItemPrototype.h:135-153.
const CLASS_NAMES = new Map([
  [0, 'Consumable'], [1, 'Container'], [2, 'Weapon'], [3, 'Gem'],
  [4, 'Armor'], [5, 'Reagent'], [6, 'Projectile'], [7, 'Trade goods'],
  [8, 'Generic'], [9, 'Recipe'], [10, 'Money'], [11, 'Quiver'],
  [12, 'Quest'], [13, 'Key'], [14, 'Permanent'], [15, 'Junk']
]);

// Subclass ids repeat across classes with unrelated meanings - subclass 2 is
// Bow under Weapon (2) and Cloth under Armor (4) - so this table is keyed on
// `${class}:${subclass}`, not on the subclass number alone. A flat table
// would be wrong for roughly half its entries.
const SUBCLASS_NAMES = new Map([
  // ItemSubclassConsumable, ItemPrototype.h:157-170. Only value 0 exists in
  // this client - the rest of the enum is commented out as "not used
  // pre-bc".
  ['0:0', 'Consumable'],

  // ItemSubclassContainer, ItemPrototype.h:174-188.
  ['1:0', 'Container'], ['1:1', 'Soul container'], ['1:2', 'Herb container'],
  ['1:3', 'Enchanting container'],

  // ItemSubclassWeapon, ItemPrototype.h:190-215.
  ['2:0', 'Axe (one-hand)'], ['2:1', 'Axe (two-hand)'], ['2:2', 'Bow'],
  ['2:3', 'Gun'], ['2:4', 'Mace (one-hand)'], ['2:5', 'Mace (two-hand)'],
  ['2:6', 'Polearm'], ['2:7', 'Sword (one-hand)'], ['2:8', 'Sword (two-hand)'],
  ['2:9', 'Obsolete'], ['2:10', 'Staff'], ['2:11', 'Exotic'],
  ['2:12', 'Exotic 2'], ['2:13', 'Fist weapon'], ['2:14', 'Miscellaneous'],
  ['2:15', 'Dagger'], ['2:16', 'Thrown'], ['2:17', 'Spear'],
  ['2:18', 'Crossbow'], ['2:19', 'Wand'], ['2:20', 'Fishing pole'],

  // ItemSubclassArmor, ItemPrototype.h:233-245.
  ['4:0', 'Miscellaneous'], ['4:1', 'Cloth'], ['4:2', 'Leather'],
  ['4:3', 'Mail'], ['4:4', 'Plate'], ['4:5', 'Buckler'], ['4:6', 'Shield'],
  ['4:7', 'Libram'], ['4:8', 'Idol'], ['4:9', 'Totem'],

  // ItemSubclassReagent, ItemPrototype.h:249-251.
  ['5:0', 'Reagent'],

  // ItemSubclassProjectile, ItemPrototype.h:256-263.
  ['6:0', 'Wand'], ['6:1', 'Bolt'], ['6:2', 'Arrow'], ['6:3', 'Bullet'],
  ['6:4', 'Thrown'],

  // ItemSubclassTradeGoods, ItemPrototype.h:267-284.
  ['7:0', 'Trade goods'], ['7:1', 'Parts'], ['7:2', 'Explosives'],
  ['7:3', 'Devices'],

  // ItemSubclassGeneric, ItemPrototype.h:288-290.
  ['8:0', 'Generic'],

  // ItemSubclassRecipe, ItemPrototype.h:295-307.
  ['9:0', 'Book'], ['9:1', 'Leatherworking pattern'],
  ['9:2', 'Tailoring pattern'], ['9:3', 'Engineering schematic'],
  ['9:4', 'Blacksmithing'], ['9:5', 'Cooking recipe'],
  ['9:6', 'Alchemy recipe'], ['9:7', 'First aid manual'],
  ['9:8', 'Enchanting formula'], ['9:9', 'Fishing manual'],

  // ItemSubclassMoney, ItemPrototype.h:311-313.
  ['10:0', 'Money'],

  // ItemSubclassQuiver, ItemPrototype.h:318-324. Values 0 and 1 are marked
  // "ABS" (unused placeholders) in the header, so only 2 and 3 are named.
  ['11:2', 'Quiver'], ['11:3', 'Ammo pouch'],

  // ItemSubclassQuest, ItemPrototype.h:328-330.
  ['12:0', 'Quest'],

  // ItemSubclassKey, ItemPrototype.h:335-339.
  ['13:0', 'Key'], ['13:1', 'Lockpick'],

  // ItemSubclassPermanent, ItemPrototype.h:343-345.
  ['14:0', 'Permanent'],

  // ItemSubclassJunk, ItemPrototype.h:350-352. Only value 0 exists in this
  // client - the rest of the enum is commented out as "not used pre-bc".
  ['15:0', 'Junk']
]);

// InventoryType, ItemPrototype.h:100-131.
const INVENTORY_TYPE_NAMES = new Map([
  [0, 'Non-equip'], [1, 'Head'], [2, 'Neck'], [3, 'Shoulders'], [4, 'Body'],
  [5, 'Chest'], [6, 'Waist'], [7, 'Legs'], [8, 'Feet'], [9, 'Wrists'],
  [10, 'Hands'], [11, 'Finger'], [12, 'Trinket'], [13, 'Weapon'],
  [14, 'Shield'], [15, 'Ranged'], [16, 'Cloak'], [17, 'Two-hand weapon'],
  [18, 'Bag'], [19, 'Tabard'], [20, 'Robe'], [21, 'Main hand weapon'],
  [22, 'Off hand weapon'], [23, 'Holdable'], [24, 'Ammo'], [25, 'Thrown'],
  [26, 'Ranged (right)'], [27, 'Quiver'], [28, 'Relic']
]);

// ItemBondingType, ItemPrototype.h:49-59.
const BONDING_NAMES = new Map([
  [0, 'No binding'], [1, 'Binds when picked up'], [2, 'Binds when equipped'],
  [3, 'Binds when used'], [4, 'Quest item'], [5, 'Quest item (unused)']
]);

// ItemModType, ItemPrototype.h:27-36. There is no value 2 in the enum (the
// gap is real, not an omission here) - the rest of the ten stat_type/stat_value
// slots on item_template use only 0..7.
const STAT_NAMES = new Map([
  [0, 'Mana'], [1, 'Health'], [3, 'Agility'], [4, 'Strength'],
  [5, 'Intellect'], [6, 'Spirit'], [7, 'Stamina']
]);

// SpellSchools, vmangos-core/src/game/Spells/SpellDefines.h:760-769. Used to
// label item_template's dmg_type1..5 (a damage roll's school), not spells.
const SPELL_SCHOOL_NAMES = new Map([
  [0, 'Physical'], [1, 'Holy'], [2, 'Fire'], [3, 'Nature'],
  [4, 'Frost'], [5, 'Shadow'], [6, 'Arcane']
]);

// ItemSpelltriggerType, ItemPrototype.h:40-45. Labels item_template's
// spelltrigger_1..5, paired with spellid_1..5.
const SPELL_TRIGGER_NAMES = new Map([
  [0, 'On use'], [1, 'On equip'], [2, 'Chance on hit']
]);

function lookup(table, id) {
  const key = Number(id);
  return table.has(key) ? table.get(key) : `Unknown (${id})`;
}

export function itemQualityName(id) {
  return lookup(QUALITY_NAMES, id);
}

export function itemClassName(cls) {
  return lookup(CLASS_NAMES, cls);
}

export function itemSubclassName(cls, sub) {
  const key = `${Number(cls)}:${Number(sub)}`;
  return SUBCLASS_NAMES.has(key) ? SUBCLASS_NAMES.get(key) : `Unknown (${cls}:${sub})`;
}

export function inventoryTypeName(id) {
  return lookup(INVENTORY_TYPE_NAMES, id);
}

export function bondingName(id) {
  return lookup(BONDING_NAMES, id);
}

export function itemStatName(id) {
  return lookup(STAT_NAMES, id);
}

export function spellSchoolName(id) {
  return lookup(SPELL_SCHOOL_NAMES, id);
}

export function itemSpellTriggerName(id) {
  return lookup(SPELL_TRIGGER_NAMES, id);
}
