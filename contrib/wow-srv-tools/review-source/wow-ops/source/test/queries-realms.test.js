import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listRealms, getRealm, insertRealm, updateRealm, deleteRealm, listUptimeHistory
} from '../server/queries/realms.js';

const ROW = {
  name: 'VMaNGOS', address: '127.0.0.1', localAddress: '127.0.0.1',
  localSubnetMask: '255.255.255.0', port: 8085, icon: 0, realmflags: 0,
  timezone: 8, allowedSecurityLevel: 0, realmbuilds: '5875'
};

function pool(result = [[]]) {
  const calls = [];
  return {
    calls,
    pools: { logon: { query: async (sql, params) => { calls.push({ sql, params }); return result; } } }
  };
}

test('listRealms reads every column the panel edits, oldest id first', async () => {
  const p = pool([[{ id: 1, name: 'VMaNGOS' }]]);
  const rows = await listRealms(p.pools);
  assert.deepEqual(rows, [{ id: 1, name: 'VMaNGOS' }]);
  assert.match(p.calls[0].sql, /FROM realmlist/);
  assert.match(p.calls[0].sql, /ORDER BY id/);
});

test('getRealm looks one row up by id and returns null when it is gone', async () => {
  const found = pool([[{ id: 1, name: 'VMaNGOS' }]]);
  assert.deepEqual(await getRealm(found.pools, 1), { id: 1, name: 'VMaNGOS' });
  assert.deepEqual(found.calls[0].params, [1]);

  const missing = pool([[]]);
  assert.equal(await getRealm(missing.pools, 99), null);
});

test('insertRealm passes every field as a parameter, never interpolated', async () => {
  const p = pool([{ insertId: 7 }]);
  const id = await insertRealm(p.pools, ROW);
  assert.equal(id, 7);
  assert.match(p.calls[0].sql, /^\s*INSERT INTO realmlist/);
  assert.equal(p.calls[0].params.length, 10);
  assert.deepEqual(p.calls[0].params, [
    'VMaNGOS', '127.0.0.1', '127.0.0.1', '255.255.255.0', 8085, 0, 0, 8, 0, '5875'
  ]);
  assert.ok(!p.calls[0].sql.includes('VMaNGOS'));
});

test('updateRealm sets the same ten fields and takes the id last', async () => {
  const p = pool([{ affectedRows: 1 }]);
  const affected = await updateRealm(p.pools, 3, ROW);
  assert.equal(affected, 1);
  assert.match(p.calls[0].sql, /^\s*UPDATE realmlist/);
  assert.equal(p.calls[0].params.at(-1), 3);
  assert.equal(p.calls[0].params.length, 11);
});

test('deleteRealm reports how many rows went', async () => {
  const p = pool([{ affectedRows: 1 }]);
  assert.equal(await deleteRealm(p.pools, 3), 1);
  assert.match(p.calls[0].sql, /DELETE FROM realmlist WHERE id = \?/);
  assert.deepEqual(p.calls[0].params, [3]);
});

test('uptime history is newest first and bounded', async () => {
  const p = pool([[{ realmid: 1, starttime: 1788309225, uptime: 20470 }]]);
  const rows = await listUptimeHistory(p.pools, 5);
  assert.equal(rows.length, 1);
  assert.match(p.calls[0].sql, /FROM uptime/);
  assert.match(p.calls[0].sql, /ORDER BY starttime DESC/);
  assert.deepEqual(p.calls[0].params, [5]);
});

test('a limit that is not a positive integer cannot reach the SQL', async () => {
  const p = pool([[]]);
  await listUptimeHistory(p.pools, '5; DROP TABLE uptime');
  assert.deepEqual(p.calls[0].params, [20]);
});

test('every function answers null or empty when the logon pool is absent', async () => {
  assert.deepEqual(await listRealms({}), []);
  assert.equal(await getRealm({}, 1), null);
  assert.deepEqual(await listUptimeHistory({}, 5), []);
  await assert.rejects(() => insertRealm({}, ROW), /logon database/);
  await assert.rejects(() => updateRealm({}, 1, ROW), /logon database/);
  await assert.rejects(() => deleteRealm({}, 1), /logon database/);
});

test('the queries refuse an id that is not a positive integer', async () => {
  const p = pool([{ affectedRows: 1 }]);
  await assert.rejects(() => updateRealm(p.pools, 'abc', ROW), /realm id/);
  await assert.rejects(() => deleteRealm(p.pools, 'abc'), /realm id/);
  await assert.rejects(() => getRealm(p.pools, 'abc'), /realm id/);
  assert.equal(p.calls.length, 0);
});
