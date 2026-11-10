import test from 'node:test';
import assert from 'node:assert/strict';
import { itemQualityName, itemClassName, itemSubclassName, inventoryTypeName, bondingName, itemStatName, spellSchoolName, itemSpellTriggerName } from '../server/dbLookups/itemClasses.js';

test('qualities are named', () => {
  assert.equal(itemQualityName(0), 'Poor');
  assert.equal(itemQualityName(4), 'Epic');
  assert.equal(itemQualityName(9), 'Unknown (9)');
});

test('a subclass is named within its class, because the numbers repeat', () => {
  // subclass 2 means Bow under Weapon (2) and Cloth under Armor (4). A
  // subclass table that ignored the class would be wrong half the time.
  assert.equal(itemClassName(2), 'Weapon');
  assert.equal(itemSubclassName(2, 2), 'Bow');
  assert.equal(itemSubclassName(4, 1), 'Cloth');
});

test('inventory type and bonding are named', () => {
  assert.equal(inventoryTypeName(1), 'Head');
  assert.equal(bondingName(1), 'Binds when picked up');
});

test('item stats, damage school and spell triggers are named', () => {
  // ItemModType (ItemPrototype.h:27-36) has no value 2 - the gap is real.
  assert.equal(itemStatName(4), 'Strength');
  assert.equal(itemStatName(2), 'Unknown (2)');
  assert.equal(spellSchoolName(0), 'Physical');
  assert.equal(spellSchoolName(5), 'Shadow');
  assert.equal(itemSpellTriggerName(1), 'On equip');
});
