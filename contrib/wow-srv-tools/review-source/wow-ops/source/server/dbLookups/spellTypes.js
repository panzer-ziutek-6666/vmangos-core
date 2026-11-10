import { spellSchoolName } from './itemClasses.js';

export { spellSchoolName };

// SpellEffects, vmangos-core/src/game/Spells/SpellDefines.h:249-385 (SPELL_EFFECT_NONE=0
// through SPELL_EFFECT_APPLY_AREA_AURA_OWNER=133; TOTAL_SPELL_EFFECTS=134 is not an entry).
// 134 entries, 0-133, contiguous, no gaps or duplicates. Transcribed mechanically: strip the
// SPELL_EFFECT_ prefix, split on '_', capitalise each word. SPELL_EFFECT_122/126/127 have no
// core name beyond the number, so their label is just the number.
const SPELL_EFFECT_NAMES = new Map([
  [0, 'None'], [1, 'Instakill'], [2, 'School Damage'], [3, 'Dummy'], [4, 'Portal Teleport'],
  [5, 'Teleport Units'], [6, 'Apply Aura'], [7, 'Environmental Damage'], [8, 'Power Drain'],
  [9, 'Health Leech'], [10, 'Heal'], [11, 'Bind'], [12, 'Portal'], [13, 'Ritual Base'],
  [14, 'Ritual Specialize'], [15, 'Ritual Activate Portal'], [16, 'Quest Complete'],
  [17, 'Weapon Damage Noschool'], [18, 'Resurrect'], [19, 'Add Extra Attacks'], [20, 'Dodge'],
  [21, 'Evade'], [22, 'Parry'], [23, 'Block'], [24, 'Create Item'], [25, 'Weapon'],
  [26, 'Defense'], [27, 'Persistent Area Aura'], [28, 'Summon'], [29, 'Leap'], [30, 'Energize'],
  [31, 'Weapon Percent Damage'], [32, 'Trigger Missile'], [33, 'Open Lock'],
  [34, 'Summon Change Item'], [35, 'Apply Area Aura Party'], [36, 'Learn Spell'],
  [37, 'Spell Defense'], [38, 'Dispel'], [39, 'Language'], [40, 'Dual Wield'],
  [41, 'Summon Wild'], [42, 'Summon Guardian'], [43, 'Teleport Units Face Caster'],
  [44, 'Skill Step'], [45, 'Add Honor'], [46, 'Spawn'], [47, 'Trade Skill'], [48, 'Stealth'],
  [49, 'Detect'], [50, 'Trans Door'], [51, 'Force Critical Hit'], [52, 'Guarantee Hit'],
  [53, 'Enchant Item'], [54, 'Enchant Item Temporary'], [55, 'Tamecreature'],
  [56, 'Summon Pet'], [57, 'Learn Pet Spell'], [58, 'Weapon Damage'], [59, 'Open Lock Item'],
  [60, 'Proficiency'], [61, 'Send Event'], [62, 'Power Burn'], [63, 'Threat'],
  [64, 'Trigger Spell'], [65, 'Health Funnel'], [66, 'Power Funnel'], [67, 'Heal Max Health'],
  [68, 'Interrupt Cast'], [69, 'Distract'], [70, 'Pull'], [71, 'Pickpocket'],
  [72, 'Add Farsight'], [73, 'Summon Possessed'], [74, 'Summon Totem'], [75, 'Heal Mechanical'],
  [76, 'Summon Object Wild'], [77, 'Script Effect'], [78, 'Attack'], [79, 'Sanctuary'],
  [80, 'Add Combo Points'], [81, 'Create House'], [82, 'Bind Sight'], [83, 'Duel'],
  [84, 'Stuck'], [85, 'Summon Player'], [86, 'Activate Object'], [87, 'Summon Totem Slot1'],
  [88, 'Summon Totem Slot2'], [89, 'Summon Totem Slot3'], [90, 'Summon Totem Slot4'],
  [91, 'Threat All'], [92, 'Enchant Held Item'], [93, 'Summon Phantasm'],
  [94, 'Self Resurrect'], [95, 'Skinning'], [96, 'Charge'], [97, 'Summon Critter'],
  [98, 'Knock Back'], [99, 'Disenchant'], [100, 'Inebriate'], [101, 'Feed Pet'],
  [102, 'Dismiss Pet'], [103, 'Reputation'], [104, 'Summon Object Slot1'],
  [105, 'Summon Object Slot2'], [106, 'Summon Object Slot3'], [107, 'Summon Object Slot4'],
  [108, 'Dispel Mechanic'], [109, 'Summon Dead Pet'], [110, 'Destroy All Totems'],
  [111, 'Durability Damage'], [112, 'Summon Demon'], [113, 'Resurrect New'],
  [114, 'Attack Me'], [115, 'Durability Damage Pct'], [116, 'Skin Player Corpse'],
  [117, 'Spirit Heal'], [118, 'Skill'], [119, 'Apply Area Aura Pet'],
  [120, 'Teleport Graveyard'], [121, 'Normalized Weapon Dmg'], [122, '122'],
  [123, 'Send Taxi'], [124, 'Player Pull'], [125, 'Modify Threat Percent'], [126, '126'],
  [127, '127'], [128, 'Apply Area Aura Friend'], [129, 'Apply Area Aura Enemy'],
  [130, 'Despawn Object'], [131, 'Nostalrius'], [132, 'Apply Area Aura Raid'],
  [133, 'Apply Area Aura Owner']
]);

// AuraType, vmangos-core/src/game/Spells/SpellAuraDefines.h:45-332 (SPELL_AURA_NONE=0 through
// SPELL_AURA_AURA_SPELL=192; TOTAL_AURAS=193 is not an entry). 193 entries, 0-192, contiguous,
// no gaps or duplicates. Same transcription rule as SPELL_EFFECT_NAMES; SPELL_AURA_164 has no
// core name beyond the number.
const AURA_NAMES = new Map([
  [0, 'None'], [1, 'Bind Sight'], [2, 'Mod Possess'], [3, 'Periodic Damage'], [4, 'Dummy'],
  [5, 'Mod Confuse'], [6, 'Mod Charm'], [7, 'Mod Fear'], [8, 'Periodic Heal'],
  [9, 'Mod Attackspeed'], [10, 'Mod Threat'], [11, 'Mod Taunt'], [12, 'Mod Stun'],
  [13, 'Mod Damage Done'], [14, 'Mod Damage Taken'], [15, 'Damage Shield'],
  [16, 'Mod Stealth'], [17, 'Mod Stealth Detect'], [18, 'Mod Invisibility'],
  [19, 'Mod Invisibility Detection'], [20, 'Obs Mod Health'], [21, 'Obs Mod Mana'],
  [22, 'Mod Resistance'], [23, 'Periodic Trigger Spell'], [24, 'Periodic Energize'],
  [25, 'Mod Pacify'], [26, 'Mod Root'], [27, 'Mod Silence'], [28, 'Reflect Spells'],
  [29, 'Mod Stat'], [30, 'Mod Skill'], [31, 'Mod Increase Speed'],
  [32, 'Mod Increase Mounted Speed'], [33, 'Mod Decrease Speed'], [34, 'Mod Increase Health'],
  [35, 'Mod Increase Energy'], [36, 'Mod Shapeshift'], [37, 'Effect Immunity'],
  [38, 'State Immunity'], [39, 'School Immunity'], [40, 'Damage Immunity'],
  [41, 'Dispel Immunity'], [42, 'Proc Trigger Spell'], [43, 'Proc Trigger Damage'],
  [44, 'Track Creatures'], [45, 'Track Resources'], [46, 'Mod Parry Skill'],
  [47, 'Mod Parry Percent'], [48, 'Mod Dodge Skill'], [49, 'Mod Dodge Percent'],
  [50, 'Mod Block Skill'], [51, 'Mod Block Percent'], [52, 'Mod Crit Percent'],
  [53, 'Periodic Leech'], [54, 'Mod Hit Chance'], [55, 'Mod Spell Hit Chance'],
  [56, 'Transform'], [57, 'Mod Spell Crit Chance'], [58, 'Mod Increase Swim Speed'],
  [59, 'Mod Damage Done Creature'], [60, 'Mod Pacify Silence'], [61, 'Mod Scale'],
  [62, 'Periodic Health Funnel'], [63, 'Periodic Mana Funnel'], [64, 'Periodic Mana Leech'],
  [65, 'Mod Casting Speed Not Stack'], [66, 'Feign Death'], [67, 'Mod Disarm'],
  [68, 'Mod Stalked'], [69, 'School Absorb'], [70, 'Extra Attacks'],
  [71, 'Mod Spell Crit Chance School'], [72, 'Mod Power Cost School Pct'],
  [73, 'Mod Power Cost School'], [74, 'Reflect Spells School'], [75, 'Mod Language'],
  [76, 'Far Sight'], [77, 'Mechanic Immunity'], [78, 'Mounted'],
  [79, 'Mod Damage Percent Done'], [80, 'Mod Percent Stat'], [81, 'Split Damage Pct'],
  [82, 'Water Breathing'], [83, 'Mod Base Resistance'], [84, 'Mod Regen'],
  [85, 'Mod Power Regen'], [86, 'Channel Death Item'], [87, 'Mod Damage Percent Taken'],
  [88, 'Mod Health Regen Percent'], [89, 'Periodic Damage Percent'],
  [90, 'Mod Resist Chance'], [91, 'Mod Detect Range'], [92, 'Prevents Fleeing'],
  [93, 'Mod Unattackable'], [94, 'Interrupt Regen'], [95, 'Ghost'], [96, 'Spell Magnet'],
  [97, 'Mana Shield'], [98, 'Mod Skill Talent'], [99, 'Mod Attack Power'],
  [100, 'Auras Visible'], [101, 'Mod Resistance Pct'],
  [102, 'Mod Melee Attack Power Versus'], [103, 'Mod Total Threat'], [104, 'Water Walk'],
  [105, 'Feather Fall'], [106, 'Hover'], [107, 'Add Flat Modifier'],
  [108, 'Add Pct Modifier'], [109, 'Add Target Trigger'], [110, 'Mod Power Regen Percent'],
  [111, 'Add Caster Hit Trigger'], [112, 'Override Class Scripts'],
  [113, 'Mod Ranged Damage Taken'], [114, 'Mod Ranged Damage Taken Pct'],
  [115, 'Mod Healing'], [116, 'Mod Regen During Combat'], [117, 'Mod Mechanic Resistance'],
  [118, 'Mod Healing Pct'], [119, 'Share Pet Tracking'], [120, 'Untrackable'],
  [121, 'Empathy'], [122, 'Mod Offhand Damage Pct'], [123, 'Mod Target Resistance'],
  [124, 'Mod Ranged Attack Power'], [125, 'Mod Melee Damage Taken'],
  [126, 'Mod Melee Damage Taken Pct'], [127, 'Ranged Attack Power Attacker Bonus'],
  [128, 'Mod Possess Pet'], [129, 'Mod Speed Always'], [130, 'Mod Mounted Speed Always'],
  [131, 'Mod Ranged Attack Power Versus'], [132, 'Mod Increase Energy Percent'],
  [133, 'Mod Increase Health Percent'], [134, 'Mod Mana Regen Interrupt'],
  [135, 'Mod Healing Done'], [136, 'Mod Healing Done Percent'],
  [137, 'Mod Total Stat Percentage'], [138, 'Mod Melee Haste'], [139, 'Force Reaction'],
  [140, 'Mod Ranged Haste'], [141, 'Mod Ranged Ammo Haste'],
  [142, 'Mod Base Resistance Pct'], [143, 'Mod Resistance Exclusive'], [144, 'Safe Fall'],
  [145, 'Charisma'], [146, 'Persuaded'], [147, 'Mechanic Immunity Mask'],
  [148, 'Retain Combo Points'], [149, 'Resist Pushback'],
  [150, 'Mod Shield Blockvalue Pct'], [151, 'Track Stealthed'],
  [152, 'Mod Detected Range'], [153, 'Split Damage Flat'], [154, 'Mod Stealth Level'],
  [155, 'Mod Water Breathing'], [156, 'Mod Reputation Gain'], [157, 'Pet Damage Multi'],
  [158, 'Mod Shield Blockvalue'], [159, 'No Pvp Credit'], [160, 'Mod Aoe Avoidance'],
  [161, 'Mod Health Regen In Combat'], [162, 'Power Burn Mana'],
  [163, 'Mod Crit Damage Bonus'], [164, '164'],
  [165, 'Melee Attack Power Attacker Bonus'], [166, 'Mod Attack Power Pct'],
  [167, 'Mod Ranged Attack Power Pct'], [168, 'Mod Damage Done Versus'],
  [169, 'Mod Crit Percent Versus'], [170, 'Detect Amore'], [171, 'Mod Speed Not Stack'],
  [172, 'Mod Mounted Speed Not Stack'], [173, 'Allow Champion Spells'],
  [174, 'Mod Spell Damage Of Stat Percent'], [175, 'Mod Spell Healing Of Stat Percent'],
  [176, 'Spirit Of Redemption'], [177, 'Aoe Charm'], [178, 'Mod Debuff Resistance'],
  [179, 'Mod Attacker Spell Crit Chance'], [180, 'Mod Flat Spell Damage Versus'],
  [181, 'Mod Flat Spell Crit Damage Versus'], [182, 'Mod Resistance Of Stat Percent'],
  [183, 'Mod Critical Threat'], [184, 'Mod Attacker Melee Hit Chance'],
  [185, 'Mod Attacker Ranged Hit Chance'], [186, 'Mod Attacker Spell Hit Chance'],
  [187, 'Mod Attacker Melee Crit Chance'], [188, 'Mod Attacker Ranged Crit Chance'],
  [189, 'Mod Rating'], [190, 'Mod Faction Reputation Gain'],
  [191, 'Use Normal Movement Speed'], [192, 'Aura Spell']
]);

// Powers, vmangos-core/src/game/SharedDefines.h:160-168. spell_template.powerType holds the
// enum value; POWER_HEALTH is 0xFFFFFFFE, read back as -2 from a signed column.
const POWER_NAMES = new Map([
  [0, 'Mana'], [1, 'Rage'], [2, 'Focus'], [3, 'Energy'], [4, 'Happiness'],
  [-2, 'Health'], [4294967294, 'Health']
]);

// SkillCategory, vmangos-core/src/game/SharedDefines.h:1102-1112. Labels are this panel's; the
// order is the one the grouped skill select uses.
const SKILL_CATEGORY_NAMES = new Map([
  [5, 'Attributes'], [6, 'Weapon skills'], [7, 'Class skills'], [8, 'Armor proficiencies'],
  [9, 'Secondary skills'], [10, 'Languages'], [11, 'Professions'], [12, 'Other']
]);
export const SKILL_CATEGORY_ORDER = [7, 11, 9, 6, 8, 10, 5, 12];

function lookup(table, id) {
  const key = Number(id);
  return table.has(key) ? table.get(key) : `Unknown (${id})`;
}

export const spellEffectName = (id) => lookup(SPELL_EFFECT_NAMES, id);
export const auraName = (id) => lookup(AURA_NAMES, id);
export const powerTypeName = (id) => lookup(POWER_NAMES, id);
export const skillCategoryName = (id) => SKILL_CATEGORY_NAMES.get(Number(id)) ?? 'Other';
