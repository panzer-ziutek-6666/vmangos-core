import test from 'node:test';
import assert from 'node:assert/strict';
import { countBotAccounts, listBotLocations, listSuspendedBotAccounts } from '../server/queries/bots.js';

// These tests drive the query functions with a fake pool that records the SQL
// it was handed and replays canned rows. They deliberately do NOT create
// fixture tables in a real database the way test/db-accounts.test.js does:
// that file already borrows the `logs` database for tables named `account`
// and `account_banned`, and these queries name the very same tables, so a
// second file creating and dropping them concurrently would race it. The real
// schema is covered instead by test/db-bots-live.test.js, which is read-only.
function fakePool(rows) {
  const calls = [];
  return { calls, query: async (sql, params) => { calls.push({ sql, params }); return [rows]; } };
}

const CONFIG = {
  bots: { accountPrefix: 'RNDBOT' },
  mysql: {
    logon: { database: 'realmd' },
    characters: { database: 'characters' },
    world: { database: 'mangos' }
  }
};

test('countBotAccounts counts accounts by prefix on the logon pool', async () => {
  const logon = fakePool([{ c: 120 }]);
  const result = await countBotAccounts({ logon }, CONFIG);
  assert.equal(result, 120);
  assert.deepEqual(logon.calls[0].params, ['RNDBOT%']);
  assert.match(logon.calls[0].sql, /FROM account/);
});

test('countBotAccounts returns null without a logon pool', async () => {
  assert.equal(await countBotAccounts({}, CONFIG), null);
});

test('countBotAccounts returns null without a configured prefix', async () => {
  const logon = fakePool([{ c: 1 }]);
  assert.equal(await countBotAccounts({ logon }, { ...CONFIG, bots: {} }), null);
});

test('listBotLocations qualifies all three schemas and filters by prefix', async () => {
  const characters = fakePool([]);
  await listBotLocations({ characters }, CONFIG);
  const { sql, params } = characters.calls[0];
  assert.match(sql, /`characters`\.characters/);
  assert.match(sql, /`realmd`\.account/);
  assert.match(sql, /`mangos`\.map_template/);
  assert.deepEqual(params, ['RNDBOT%']);
});

test('listBotLocations deduplicates map_template on the highest patch', async () => {
  const characters = fakePool([]);
  await listBotLocations({ characters }, CONFIG);
  // map_template is keyed (entry, patch) and 18 entries really do carry more
  // than one patch row on this realm, so without this subquery the join
  // multiplies those maps' bot counts.
  assert.match(characters.calls[0].sql, /MAX\(m2\.patch\)/);
});

test('listBotLocations orders by bot count descending and map id ascending', async () => {
  const characters = fakePool([]);
  await listBotLocations({ characters }, CONFIG);
  // The view renders rows in the order the query returns them, so ordering
  // is behaviour, not cosmetics. The primary sort (descending bot count)
  // shows the most-populated map first; the tiebreaker (ascending map id)
  // ensures deterministic results when two maps have identical bot counts.
  assert.match(characters.calls[0].sql, /ORDER BY bots DESC, ch\.map ASC/);
});

test('listBotLocations maps rows and coerces the counts', async () => {
  const characters = fakePool([
    { map_id: 0, map_name: 'Eastern Kingdoms', map_type: 0, bots: '392' },
    { map_id: 529, map_name: 'Arathi Basin', map_type: 3, bots: '94' }
  ]);
  const rows = await listBotLocations({ characters }, CONFIG);
  assert.deepEqual(rows, [
    { mapId: 0, mapName: 'Eastern Kingdoms', mapType: 0, bots: 392 },
    { mapId: 529, mapName: 'Arathi Basin', mapType: 3, bots: 94 }
  ]);
});

test('listBotLocations survives a map id map_template does not know', async () => {
  // The LEFT JOIN is what produces this: a map id present in characters.map
  // with no map_template row leaves both columns null, and the row must still
  // be reported rather than silently dropped or crashing the view.
  const characters = fakePool([{ map_id: 4242, map_name: null, map_type: null, bots: 3 }]);
  const rows = await listBotLocations({ characters }, CONFIG);
  assert.deepEqual(rows, [{ mapId: 4242, mapName: null, mapType: null, bots: 3 }]);
});

test('listBotLocations returns null when the world database is not configured', async () => {
  const characters = fakePool([]);
  const config = { ...CONFIG, mysql: { logon: { database: 'realmd' }, characters: { database: 'characters' } } };
  assert.equal(await listBotLocations({ characters }, config), null);
  assert.equal(characters.calls.length, 0);
});

test('listBotLocations returns null without a characters pool', async () => {
  assert.equal(await listBotLocations({}, CONFIG), null);
});

test('listSuspendedBotAccounts marks a permanent ban', async () => {
  const logon = fakePool([
    { id: 7, username: 'RNDBOT7', bandate: 1000, unbandate: 1000, bannedby: 'ADMIN', banreason: 'stuck' },
    { id: 8, username: 'RNDBOT8', bandate: 1000, unbandate: 2000, bannedby: 'ADMIN', banreason: 'temp' }
  ]);
  const rows = await listSuspendedBotAccounts({ logon }, CONFIG);
  assert.equal(rows[0].permanent, true);
  assert.equal(rows[1].permanent, false);
  assert.deepEqual(logon.calls[0].params, ['RNDBOT%']);
});

test('listSuspendedBotAccounts returns an empty array when nothing is banned', async () => {
  const logon = fakePool([]);
  assert.deepEqual(await listSuspendedBotAccounts({ logon }, CONFIG), []);
});

test('listSuspendedBotAccounts returns null without a logon pool', async () => {
  assert.equal(await listSuspendedBotAccounts({}, CONFIG), null);
});
