import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readConfigFile } from '../server/config.js';
import { createPools } from '../server/db.js';
import {
  listRealms, getRealm, insertRealm, updateRealm, deleteRealm, listUptimeHistory
} from '../server/queries/realms.js';
import { normalizeRealmInput } from '../server/realmFields.js';

// Against the real realm databases. The reads go to the live `realmd`; the
// writes go to a scratch table this file creates and drops inside `logs`,
// never to the live realmlist - that table is what the game client connects
// through, and a test has no business editing it. The `mangos` user cannot
// create databases, so a scratch schema is not an option and `logs` is the
// borrowed one (test/db-accounts.test.js borrows it for `account` and
// `account_banned`, so the table name here has to be, and is, different).
const here = dirname(fileURLToPath(import.meta.url));
const SCRATCH = 'zz_wowops_realmlist';

async function connectOrSkip(t) {
  let config;
  try {
    config = readConfigFile(join(here, '..', 'config.json'));
  } catch (err) {
    t.skip(`no usable config.json: ${err.message}`);
    return null;
  }
  const pools = createPools(config.mysql);
  try {
    await pools.logon.query('SELECT 1');
  } catch (err) {
    await pools.closeAll().catch(() => {});
    t.skip(`MySQL is not reachable: ${err.message}. Start it with ""Start MySQL.bat"" in the server directory`);
    return null;
  }
  t.after(() => pools.closeAll());
  return { config, pools };
}

test('the live realmlist has the columns this section writes', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;

  const realms = await listRealms(ctx.pools);
  assert.ok(Array.isArray(realms));
  if (realms.length === 0) {
    t.skip('no realms are registered on this realm');
    return;
  }
  for (const column of [
    'id', 'name', 'address', 'localAddress', 'localSubnetMask', 'port',
    'icon', 'realmflags', 'timezone', 'allowedSecurityLevel', 'realmbuilds'
  ]) {
    assert.ok(column in realms[0], `realmlist is missing ${column}`);
  }

  // getRealm has to agree with the listing for the same id.
  const one = await getRealm(ctx.pools, realms[0].id);
  assert.equal(one.name, realms[0].name);
});

test('the live uptime table answers the run history query', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;

  const rows = await listUptimeHistory(ctx.pools, 5);
  assert.ok(Array.isArray(rows));
  assert.ok(rows.length <= 5);
  for (const row of rows) {
    assert.ok(Number.isFinite(Number(row.starttime)));
    assert.ok(Number.isFinite(Number(row.uptime)));
  }
});

test('insert, update and delete run against a real realmlist-shaped table', async (t) => {
  const ctx = await connectOrSkip(t);
  if (!ctx) return;
  const logs = ctx.pools.logs;
  if (!logs) {
    t.skip('the logs database is not configured in config.json');
    return;
  }

  const logonSchema = ctx.config.mysql.logon.database;

  // Cleanup is inline at the end of this test, not in a t.after hook.
  // connectOrSkip already registered t.after(closeAll), hooks run in
  // registration order, and a DROP issued after the pool is closed fails
  // silently - which is exactly what happened the first time this ran and
  // left the scratch table behind. The DROP below therefore also runs first,
  // so a failed earlier run cleans itself up on the next one.
  await logs.query(`DROP TABLE IF EXISTS ${SCRATCH}`);
  await logs.query(`CREATE TABLE ${SCRATCH} LIKE \`${logonSchema}\`.realmlist`);

  // The query module names the table literally, so point it at the scratch
  // copy with a query wrapper rather than by duplicating the SQL here. Only
  // the table name is rewritten; no column name contains "realmlist".
  const scratch = {
    logon: {
      query: (sql, params) => logs.query(sql.replaceAll('realmlist', SCRATCH), params)
    }
  };

  const row = normalizeRealmInput({
    name: 'ScratchRealm', address: '127.0.0.1', localAddress: '127.0.0.1',
    localSubnetMask: '255.255.255.0', port: '8085', icon: '1',
    timezone: '8', allowedSecurityLevel: '0', realmbuilds: '5875'
  });

  const id = await insertRealm(scratch, row);
  assert.ok(id > 0);

  const afterInsert = await listRealms(scratch);
  assert.equal(afterInsert.length, 1);
  assert.equal(afterInsert[0].name, 'ScratchRealm');
  assert.equal(Number(afterInsert[0].icon), 1);
  assert.equal(afterInsert[0].realmbuilds, '5875');

  assert.equal(await updateRealm(scratch, id, { ...row, port: 8086 }), 1);
  assert.equal(Number((await listRealms(scratch))[0].port), 8086);

  assert.equal(await deleteRealm(scratch, id), 1);
  assert.deepEqual(await listRealms(scratch), []);

  await logs.query(`DROP TABLE IF EXISTS ${SCRATCH}`);
  const [left] = await logs.query(`SHOW TABLES LIKE '${SCRATCH}'`);
  assert.equal(left.length, 0, 'the scratch table outlived the test');
});
