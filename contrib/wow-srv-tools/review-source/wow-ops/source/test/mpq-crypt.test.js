import test from 'node:test';
import assert from 'node:assert/strict';
import { hashString, decryptBuffer, HASH_TABLE_OFFSET, HASH_NAME_A, HASH_FILE_KEY } from '../tools/mpq/crypt.js';

test('hashing is case-insensitive and slash-insensitive', () => {
  const a = hashString('Interface\\Icons\\INV_Misc_Rune_01.blp', HASH_TABLE_OFFSET);
  const b = hashString('interface/icons/inv_misc_rune_01.BLP', HASH_TABLE_OFFSET);
  assert.equal(a, b);
});

test('the three hash types disagree on the same name', () => {
  const name = '(hash table)';
  const offset = hashString(name, HASH_TABLE_OFFSET);
  const nameA = hashString(name, HASH_NAME_A);
  const key = hashString(name, HASH_FILE_KEY);
  assert.notEqual(offset, nameA);
  assert.notEqual(nameA, key);
});

test('hashes are unsigned 32-bit', () => {
  for (const name of ['a', 'zzzz', '(block table)', 'Interface\\Icons\\Spell_Fire_Flamebolt.blp']) {
    const value = hashString(name, HASH_NAME_A);
    assert.ok(Number.isInteger(value) && value >= 0 && value <= 0xFFFFFFFF, `${name} -> ${value}`);
  }
});

test('decrypting is deterministic and depends on the key', () => {
  // A property test rather than a round trip: this module has no encrypt
  // function. The real round trip lives in test/mpq-archive.test.js, against
  // the encryptBuffer in test/helpers/mpqArchive.js, which is derived from the
  // format rather than from this file.
  const key = hashString('(block table)', HASH_FILE_KEY);
  const cipher = Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]);
  const first = Buffer.from(cipher);
  const second = Buffer.from(cipher);
  decryptBuffer(first, key);
  decryptBuffer(second, key);
  assert.deepEqual(first, second);

  const other = Buffer.from(cipher);
  decryptBuffer(other, key + 1);
  assert.notDeepEqual(first, other);
});

test('decryption leaves a trailing partial word untouched', () => {
  const buf = Buffer.from([1, 2, 3, 4, 9, 9]);
  decryptBuffer(buf, 0x1234);
  assert.deepEqual(buf.subarray(4), Buffer.from([9, 9]));
});
