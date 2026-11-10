import test from 'node:test';
import assert from 'node:assert/strict';
import { spellEffectName, auraName, powerTypeName, spellSchoolName, skillCategoryName, SKILL_CATEGORY_ORDER } from '../server/dbLookups/spellTypes.js';

test('effects are named from SpellDefines.h, 0 through 133', () => {
  assert.equal(spellEffectName(0), 'None');
  assert.equal(spellEffectName(1), 'Instakill');
  assert.equal(spellEffectName(2), 'School Damage');
  assert.equal(spellEffectName(6), 'Apply Aura');
  assert.equal(spellEffectName(133), spellEffectName(133)); // exists
  assert.doesNotMatch(spellEffectName(133), /^Unknown/);
  assert.equal(spellEffectName(134), 'Unknown (134)');
});

test('auras are named from SpellAuraDefines.h, 0 through 192', () => {
  assert.equal(auraName(0), 'None');
  assert.equal(auraName(1), 'Bind Sight');
  assert.equal(auraName(3), 'Periodic Damage');
  assert.doesNotMatch(auraName(192), /^Unknown/);
  assert.equal(auraName(193), 'Unknown (193)');
});

test('power types, schools and skill categories', () => {
  assert.equal(powerTypeName(0), 'Mana');
  assert.equal(powerTypeName(1), 'Rage');
  assert.equal(powerTypeName(3), 'Energy');
  assert.equal(powerTypeName(-2), 'Health');
  assert.equal(spellSchoolName(2), 'Fire');
  assert.equal(skillCategoryName(11), 'Professions');
  assert.equal(skillCategoryName(9), 'Secondary skills');
  assert.equal(skillCategoryName(99), 'Other');
  assert.deepEqual(SKILL_CATEGORY_ORDER, [7, 11, 9, 6, 8, 10, 5, 12]);
});

test('enum maps cover the core exactly: 134 effects, 193 auras, no gaps', () => {
  for (let i = 0; i <= 133; i++) assert.doesNotMatch(spellEffectName(i), /^Unknown/, `effect ${i}`);
  assert.equal(spellEffectName(134), 'Unknown (134)');
  for (let i = 0; i <= 192; i++) assert.doesNotMatch(auraName(i), /^Unknown/, `aura ${i}`);
  assert.equal(auraName(193), 'Unknown (193)');
});
