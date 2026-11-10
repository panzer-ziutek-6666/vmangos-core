import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REALM_TYPES, realmTypeName, REALM_ZONES, realmZoneName,
  realmCategoryForClassic, REALM_FLAGS, ALLOWED_FLAG_MASK, HIDDEN_FLAG_BIT, realmFlagNames
} from '../server/realmTypes.js';

test('the realm type table is the one this client actually ships', () => {
  // Cfg_Configs.dbc from the 1.12.1 client's patch.MPQ: 11 rows
  // of (ID, RealmType, PvP, RP). Anything else is a guess, and guessing is
  // what this table exists to stop.
  assert.equal(REALM_TYPES.length, 11);
  assert.deepEqual(REALM_TYPES.map((t) => t.icon), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('types map to the labels the client renders', () => {
  for (const icon of [0, 2, 4, 9]) assert.equal(realmTypeName(icon), 'Normal');
  for (const icon of [1, 3, 5, 10]) assert.equal(realmTypeName(icon), 'PvP');
  for (const icon of [6, 7]) assert.equal(realmTypeName(icon), 'RP');
  assert.equal(realmTypeName(8), 'RP PvP');
});

test('a type outside the table renders the way the client renders it', () => {
  // GetRealmInfo finds no matching Cfg_Configs row, so pvp and rp stay false
  // and RealmList.lua falls through to GAMETYPE_NORMAL.
  assert.equal(realmTypeName(200), 'Normal');
  assert.equal(realmTypeName(undefined), 'Normal');
});

test('realm zones carry the names the core uses', () => {
  assert.equal(realmZoneName(8), 'English');
  assert.equal(realmZoneName(1), 'Development');
  assert.equal(realmZoneName(0), 'Unknown');
  assert.equal(realmZoneName(999), 'unknown');
  assert.ok(REALM_ZONES.length >= 30);
});

test('a 1.12 client collapses most zones onto one realm-list tab', () => {
  // RealmCategoryIdsByRealmZoneByMajorVersion[1], RealmList.cpp:70-88.
  assert.equal(realmCategoryForClassic(0), 0);
  assert.equal(realmCategoryForClassic(8), 1);
  assert.equal(realmCategoryForClassic(2), 1);
  assert.equal(realmCategoryForClassic(3), 5);
  assert.equal(realmCategoryForClassic(9), 2);
  assert.equal(realmCategoryForClassic(10), 3);
  assert.equal(realmCategoryForClassic(11), 5);
  assert.equal(realmCategoryForClassic(999), 1);
});

test('only the flags realmd keeps are offered', () => {
  assert.deepEqual(REALM_FLAGS.map((f) => f.bit), [2, 4, 0x20, 0x40]);
  assert.equal(ALLOWED_FLAG_MASK, 2 | 4 | 0x20 | 0x40);
  assert.equal(HIDDEN_FLAG_BIT, 1);
});

test('flag names describe a mask', () => {
  assert.deepEqual(realmFlagNames(0), []);
  assert.deepEqual(realmFlagNames(2 | 0x40), ['offline', 'recommended']);
});
