import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRealmInput, assertSubnetMask } from '../server/realmFields.js';

const GOOD = {
  name: 'VMaNGOS', address: '127.0.0.1', localAddress: '127.0.0.1',
  localSubnetMask: '255.255.255.0', port: '8085', icon: '0',
  timezone: '8', allowedSecurityLevel: '0', realmbuilds: '5875 6005 6141'
};

test('a good row normalizes to typed values', () => {
  assert.deepEqual(normalizeRealmInput(GOOD), {
    name: 'VMaNGOS', address: '127.0.0.1', localAddress: '127.0.0.1',
    localSubnetMask: '255.255.255.0', port: 8085, icon: 0, realmflags: 0,
    timezone: 8, allowedSecurityLevel: 0, realmbuilds: '5875 6005 6141'
  });
});

test('checked flag boxes combine into a mask, and hidden sets bit 1', () => {
  assert.equal(normalizeRealmInput({ ...GOOD, flags: ['2', '64'] }).realmflags, 66);
  assert.equal(normalizeRealmInput({ ...GOOD, flags: '4' }).realmflags, 4);
  assert.equal(normalizeRealmInput({ ...GOOD, hidden: 'on' }).realmflags, 1);
  assert.equal(normalizeRealmInput({ ...GOOD, flags: '2', hidden: 'on' }).realmflags, 3);
});

test('a flag realmd would strip is refused rather than silently dropped', () => {
  assert.throws(() => normalizeRealmInput({ ...GOOD, flags: '128' }), /realm flag/);
  assert.throws(() => normalizeRealmInput({ ...GOOD, flags: '8' }), /realm flag/);
});

test('the name has to fit the column and carry no control characters', () => {
  assert.throws(() => normalizeRealmInput({ ...GOOD, name: '' }), /realm name is required/);
  assert.throws(() => normalizeRealmInput({ ...GOOD, name: 'x'.repeat(33) }), /32 characters/);
  assert.throws(() => normalizeRealmInput({ ...GOOD, name: 'a\tb' }), /control character/);
});

test('addresses have to look resolvable, because realmd skips the realm if they are not', () => {
  assert.equal(normalizeRealmInput({ ...GOOD, address: 'realm.example.com' }).address, 'realm.example.com');
  assert.throws(() => normalizeRealmInput({ ...GOOD, address: '127.0.0.1 ' }), /address/);
  assert.throws(() => normalizeRealmInput({ ...GOOD, address: 'has space' }), /address/);
  assert.throws(() => normalizeRealmInput({ ...GOOD, address: 'x'.repeat(33) }), /32 characters/);
  assert.throws(() => normalizeRealmInput({ ...GOOD, localAddress: '' }), /local address is required/);
});

test('the subnet mask must be contiguous, the same check realmd makes', () => {
  assert.equal(assertSubnetMask('255.255.255.0'), '255.255.255.0');
  assert.equal(assertSubnetMask('0.0.0.0'), '0.0.0.0');
  assert.equal(assertSubnetMask('255.255.255.255'), '255.255.255.255');
  // 255.255.0.255 has a hole; realmd skips the realm outright.
  assert.throws(() => assertSubnetMask('255.255.0.255'), /contiguous/);
  assert.throws(() => assertSubnetMask('255.255.255'), /four numbers/);
  assert.throws(() => assertSubnetMask('255.255.255.256'), /0 and 255/);
});

test('port, type, zone and security level are range checked', () => {
  assert.throws(() => normalizeRealmInput({ ...GOOD, port: '0' }), /port/);
  assert.throws(() => normalizeRealmInput({ ...GOOD, port: '70000' }), /port/);
  assert.throws(() => normalizeRealmInput({ ...GOOD, icon: '11' }), /realm type/);
  assert.throws(() => normalizeRealmInput({ ...GOOD, timezone: '99' }), /realm zone/);
  assert.throws(() => normalizeRealmInput({ ...GOOD, allowedSecurityLevel: '7' }), /security level/);
});

test('realmbuilds is a space separated build list, and may be empty', () => {
  assert.equal(normalizeRealmInput({ ...GOOD, realmbuilds: '' }).realmbuilds, '');
  assert.equal(normalizeRealmInput({ ...GOOD, realmbuilds: '  5875   6005 ' }).realmbuilds, '5875 6005');
  assert.throws(() => normalizeRealmInput({ ...GOOD, realmbuilds: '5875, 6005' }), /build numbers/);
  // 20 builds is 99 characters once joined; the column holds 64.
  assert.throws(
    () => normalizeRealmInput({ ...GOOD, realmbuilds: Array(20).fill('5875').join(' ') }),
    /64 characters/
  );
  // A single token that is not a build number is refused before length even
  // comes into it.
  assert.throws(() => normalizeRealmInput({ ...GOOD, realmbuilds: '1'.repeat(65) }), /build numbers/);
});

test('a repeated form field is rejected instead of being coerced', () => {
  assert.throws(() => normalizeRealmInput({ ...GOOD, name: ['a', 'b'] }), /realm name is required/);
  assert.throws(() => normalizeRealmInput({ ...GOOD, port: ['8085', '8086'] }), /port/);
});
