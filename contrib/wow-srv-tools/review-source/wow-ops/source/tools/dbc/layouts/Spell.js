import { defineLayout, uint, int, float, locstring, loctext } from '../layout.js';

// This core has no SpellEntry struct and no SpellEntryfmt: Spell.dbc is never
// parsed directly (grep of DBCStructure.h/DBCfmt.h for either symbol finds
// nothing). Instead the world DB carries `spell_template`, a pre-parsed,
// per-build copy loaded positionally in SpellMgr::LoadSpell
// (src/game/Spells/SpellMgr.cpp) from `SELECT * FROM spell_template`, whose
// column order is therefore the field order proof this layout leans on:
// fields[2] is school, fields[4] is the unused "castUI", fields[124] is
// SpellName (the `name` column), and so on down to fields[150], `script_name`.
// Column names below are copied from `SHOW COLUMNS FROM spell_template`
// verbatim, typos included (`manCostPerLevel`, `modelNextSpell`), because
// Task 12's cross-check joins the two tables by name and a corrected typo
// here would just be a second, silent name mismatch there.
//
// spell_template has 151 columns but this file has 173 fields, and the two
// numbers don't reconcile by simple subtraction of `entry`/`build`/
// `script_name` (the three columns with no DBC origin at all). Two more
// gaps had to be found by direct measurement against the real Spell.dbc
// (build 5875) for spells matched by id, comparing the raw field at a
// candidate offset to the SQL column's value:
//
// - `effectBonusCoefficient1/2/3` hold real per-row data (-1, 0 or 1; never
//   a fraction) that matches no raw field at any offset - the values are a
//   scripting override, not client data, and the gap between the confirmed
//   anchors on either side (`effectBasePoints3` at field 78,
//   `effectMechanic1` at field 79 with no coefficient fields between) is
//   exactly 3 columns wide and 0 fields wide. They are dropped rather than
//   declared.
// - `minTargetLevel` is 0 for every one of the 1003 build-5875 rows and
//   matches no field either, while `maxTargetLevel` matches field 159
//   exactly for spell 10723 (value 60) - confirmed by reading that record
//   directly. `minTargetLevel` is dropped; `maxTargetLevel` is field 159.
// - `customFlags` is the last column before `script_name` and, like the
//   above, corresponds to no field: the three fields left after
//   `dmgMultiplier3` (167-169) are exactly `minFactionId`, `minReputation`
//   and `requiredAuraVision` (170-172, the DBC's last field), all 0 for
//   every sampled row but required to make the count land on 173.
//
// `spellFamilyFlags` is the one field that is genuinely 64-bit: build
// 5875's data holds values above 2^32 (spell 10723's family aside, the
// dataset's max is 6,442,450,944), so it spans two raw fields. The low
// dword keeps the spell_template name (spellFamilyFlags itself, so Task 12's
// join still matches); the high dword has none in spell_template, so it is
// named spellFamilyFlagsHigh here. Confirmed against real records: spell 526
// has low=0, high=8 (combined 34,359,738,368, matching spell_template
// exactly), spell 66 has low=2,147,483,648, high=0. Task 13's cross-check
// only compares columns that exist in both tables, so it will report roughly
// 32 `spellFamilyFlags` differences by construction - every build-5875 spell
// whose flags exceed 2^32, where spell_template holds the full 64-bit value
// and this layout's `spellFamilyFlags` column holds only the low dword. That
// is this split working as intended, not a layout error.
// `effectItemType1/2/3` are stored as SQL BIGINT too, and also
// exceed 2^32 in this data, but the gap between the confirmed anchors
// bracketing them (`effectChainTarget3` at field 102, `effectMiscValue1`
// at field 106) is exactly 3 columns and 3 fields - one field each, not
// two. Whatever produced those oversized values did so after the DBC was
// read, not by widening the field; they are declared `uint` like any
// other single field.
//
// The three effect indexes are structure-of-arrays, not array-of-structures:
// the record holds effect1/2/3, then effectDieSides1/2/3, then
// effectBaseDice1/2/3, and so on - the same grouping `SHOW COLUMNS FROM
// spell_template` prints and the same order SpellMgr::LoadSpell reads
// (`spell->Effect[0..2] = fields[62..64]`, then
// `spell->EffectDieSides[0..2] = fields[65..67]`). Confirmed against real
// records rather than assumed: spell 568 has effect1=2, effect2=98,
// effect3=6, so DBC fields 61/62/63 read 2/98/6 - field 62 is effect2, not
// effectDieSides1 - and the same spell's effectImplicitTargetA=(22,22,22),
// effectImplicitTargetB=(15,15,15), effectRadiusIndex=(13,13,13) and
// effectMiscValue=(0,180,0) land exactly at fields 82-84, 85-87, 88-90 and
// 106-108, proving the grouping holds in the middle of the block and not
// only at its edges. The fields are still written out by index rather than
// generated, so the file reads as a description of the record it names.
export default defineLayout({
  table: 'spell',
  file: 'Spell.dbc',
  columns: [
    uint('id'), uint('school'), uint('category'), uint('castUI'), uint('dispel'), uint('mechanic'),
    uint('attributes'), uint('attributesEx'), uint('attributesEx2'), uint('attributesEx3'), uint('attributesEx4'),
    uint('stances'), uint('stancesNot'), uint('targets'), uint('targetCreatureType'),
    uint('requiresSpellFocus'), uint('casterAuraState'), uint('targetAuraState'),
    uint('castingTimeIndex'), uint('recoveryTime'), uint('categoryRecoveryTime'),
    uint('interruptFlags'), uint('auraInterruptFlags'), uint('channelInterruptFlags'),
    uint('procFlags'), uint('procChance'), uint('procCharges'),
    uint('maxLevel'), uint('baseLevel'), uint('spellLevel'), uint('durationIndex'),
    uint('powerType'), uint('manaCost'), uint('manCostPerLevel'), uint('manaPerSecond'), uint('manaPerSecondPerLevel'),
    uint('rangeIndex'), float('speed'), uint('modelNextSpell'), uint('stackAmount'),
    uint('totem1'), uint('totem2'),
    int('reagent1'), int('reagent2'), int('reagent3'), int('reagent4'), int('reagent5'), int('reagent6'), int('reagent7'), int('reagent8'),
    uint('reagentCount1'), uint('reagentCount2'), uint('reagentCount3'), uint('reagentCount4'),
    uint('reagentCount5'), uint('reagentCount6'), uint('reagentCount7'), uint('reagentCount8'),
    int('equippedItemClass'), int('equippedItemSubClassMask'), int('equippedItemInventoryTypeMask'),

    // Structure-of-arrays: each row below is one field type across all
    // three effect indexes, in the order spell_template and SpellMgr.cpp
    // read them - not three effect-shaped blocks. See header for proof.
    uint('effect1'), uint('effect2'), uint('effect3'),
    int('effectDieSides1'), int('effectDieSides2'), int('effectDieSides3'),
    uint('effectBaseDice1'), uint('effectBaseDice2'), uint('effectBaseDice3'),
    float('effectDicePerLevel1'), float('effectDicePerLevel2'), float('effectDicePerLevel3'),
    float('effectRealPointsPerLevel1'), float('effectRealPointsPerLevel2'), float('effectRealPointsPerLevel3'),
    int('effectBasePoints1'), int('effectBasePoints2'), int('effectBasePoints3'),
    // effectBonusCoefficient1/2/3 dropped here - see header.
    uint('effectMechanic1'), uint('effectMechanic2'), uint('effectMechanic3'),
    uint('effectImplicitTargetA1'), uint('effectImplicitTargetA2'), uint('effectImplicitTargetA3'),
    uint('effectImplicitTargetB1'), uint('effectImplicitTargetB2'), uint('effectImplicitTargetB3'),
    uint('effectRadiusIndex1'), uint('effectRadiusIndex2'), uint('effectRadiusIndex3'),
    uint('effectApplyAuraName1'), uint('effectApplyAuraName2'), uint('effectApplyAuraName3'),
    uint('effectAmplitude1'), uint('effectAmplitude2'), uint('effectAmplitude3'),
    float('effectMultipleValue1'), float('effectMultipleValue2'), float('effectMultipleValue3'),
    uint('effectChainTarget1'), uint('effectChainTarget2'), uint('effectChainTarget3'),
    uint('effectItemType1'), uint('effectItemType2'), uint('effectItemType3'),
    int('effectMiscValue1'), int('effectMiscValue2'), int('effectMiscValue3'),
    uint('effectTriggerSpell1'), uint('effectTriggerSpell2'), uint('effectTriggerSpell3'),
    float('effectPointsPerComboPoint1'), float('effectPointsPerComboPoint2'), float('effectPointsPerComboPoint3'),

    uint('spellVisual1'), uint('spellVisual2'), uint('spellIconId'), uint('activeIconId'), uint('spellPriority'),

    // The four localized strings: name, rank, description, tooltip in the
    // community's vocabulary - spell_template's own names are name,
    // nameSubtext, description and auraDescription (confirmed by
    // SpellMgr.cpp assigning fields[126]/spell_template's `nameSubtext` to
    // spell->Rank, and the commented-out fields[130]/`auraDescription` to
    // spell->ToolTip).
    locstring('name'), locstring('nameSubtext'), loctext('description'), loctext('auraDescription'),

    uint('manaCostPercentage'), uint('startRecoveryCategory'), uint('startRecoveryTime'),
    // minTargetLevel dropped here - see header.
    uint('maxTargetLevel'),
    uint('spellFamilyName'), uint('spellFamilyFlags'), uint('spellFamilyFlagsHigh'),
    uint('maxAffectedTargets'), uint('dmgClass'), uint('preventionType'), int('stanceBarOrder'),
    float('dmgMultiplier1'), float('dmgMultiplier2'), float('dmgMultiplier3'),
    uint('minFactionId'), uint('minReputation'), uint('requiredAuraVision')
    // customFlags dropped here - see header.
  ]
});
